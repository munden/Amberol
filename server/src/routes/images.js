/**
 * Image routes: upload, edit and delete the photographs attached to a
 * collection item or to a shared catalog record.
 *
 * The upload pipeline, in order, for every file in the request:
 *
 *   1. multer writes the raw upload to a temporary file under the upload root,
 *      enforcing MAX_UPLOAD_MB. Nothing is buffered whole in memory.
 *   2. The file is hashed (SHA-256) and looked up. A hash we already hold is a
 *      re-upload of the same photograph: it is linked to the owner and returned
 *      with `duplicate: true`, and no new file is written.
 *   3. sharp reads the file's real format from its bytes. The client-supplied
 *      mimetype and filename extension are never trusted — a file sharp cannot
 *      decode is not an image, whatever it claims to be, and is rejected 422.
 *   4. sharp re-encodes through `.rotate()`, which bakes in the EXIF
 *      orientation and drops the metadata block on the way out. That is what
 *      strips the GPS coordinates a phone stamps into a photograph.
 *   5. Both the full image and a thumbnail are written under `YYYY/MM/` with a
 *      content-hashed filename, because index.js serves /uploads with
 *      immutable caching — a given URL must never change what it points at.
 *   6. Only then does the database work happen, inside one transaction.
 */

import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';

import { query, transaction } from '../lib/db.js';
import { ApiError, asyncHandler, isNumericId, sendOne } from '../lib/http.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Mirrors the UPLOAD_DIR that index.js exports and serves at /uploads.
 * Resolved from the environment here rather than imported from index.js so
 * this router carries no dependency on the application entry point.
 */
export const UPLOAD_DIR = path.resolve(here, '..', '..', process.env.UPLOAD_DIR || './uploads');

/** Incoming uploads land here first; `dotfiles: 'deny'` keeps it unservable. */
const TMP_DIR = path.join(UPLOAD_DIR, '.incoming');

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 25);
const MAX_UPLOAD_BYTES = Math.round(MAX_UPLOAD_MB * 1024 * 1024);
const MAX_FILES_PER_REQUEST = 20;
const THUMB_EDGE = 480;

export const IMAGE_VIEWS = ['label', 'surface', 'box', 'lid', 'end', 'damage', 'other'];

/**
 * The formats we accept, keyed by what sharp reports after sniffing the bytes.
 * HEIF/HEIC is transcoded to JPEG because no browser renders it reliably, and
 * the register exists to be looked at.
 */
const ACCEPTED_FORMATS = {
  jpeg: { ext: 'jpg', mime: 'image/jpeg' },
  png: { ext: 'png', mime: 'image/png' },
  webp: { ext: 'webp', mime: 'image/webp' },
  gif: { ext: 'gif', mime: 'image/gif', animated: true },
  heif: { ext: 'jpg', mime: 'image/jpeg', encodeAs: 'jpeg' },
};

const ACCEPTED_LABEL = 'JPEG, PNG, WebP, HEIC/HEIF or GIF';

const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      mkdir(TMP_DIR, { recursive: true }).then(() => cb(null, TMP_DIR), cb);
    },
    filename(_req, _file, cb) {
      cb(null, `${randomUUID()}.part`);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_FILES_PER_REQUEST },
});

// `any()` rather than `array('files')` so a client posting `file` or `files[]`
// is not met with an unexplained 500 from multer's unexpected-field error.
const acceptUploads = upload.any();

const router = Router();

// ------------------------------------------------------------------ helpers

/** `2024/06/<sha>.jpg` → `2024/06/<sha>_thumb.jpg`. */
export function thumbPathFor(storagePath) {
  const ext = path.extname(storagePath);
  return `${storagePath.slice(0, storagePath.length - ext.length)}_thumb${ext}`;
}

const toIso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

/**
 * Builds the Image object from docs/API.md. `extra` carries the parts that
 * live on the owner rather than on the image itself: which view it was shot
 * from, where it sits in the gallery, and whether it is the owner's primary.
 */
export function serializeImage(row, extra = {}) {
  const out = {
    id: row.id,
    url: `/uploads/${row.storage_path}`,
    thumbUrl: `/uploads/${thumbPathFor(row.storage_path)}`,
    view: extra.view !== undefined ? extra.view : row.view ?? null,
    caption: row.caption ?? null,
    altText: row.alt_text ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
    byteSize: Number(row.byte_size),
    mimeType: row.mime_type,
    sortOrder: extra.sortOrder !== undefined ? extra.sortOrder : row.sort_order ?? 1,
    isPrimary: Boolean(extra.isPrimary !== undefined ? extra.isPrimary : row.is_primary),
    createdAt: toIso(row.created_at),
  };
  if (extra.duplicate) out.duplicate = true;
  return out;
}

/** The image columns serializeImage needs, for reuse by the collection router. */
export const IMAGE_COLUMNS = `i.id, i.storage_path, i.original_name, i.mime_type,
  i.byte_size, i.width, i.height, i.caption, i.alt_text, i.created_at`;

/** Loads the gallery for one collection item, newest ordering left to sort_order. */
export async function loadItemImages(itemId, client = { query }) {
  const { rows } = await client.query(
    `SELECT ${IMAGE_COLUMNS}, ii.view, ii.sort_order,
            (ci.primary_image_id = i.id) AS is_primary
       FROM item_images ii
       JOIN images i ON i.id = ii.image_id
       JOIN collection_items ci ON ci.id = ii.item_id
      WHERE ii.item_id = $1
      ORDER BY ii.sort_order, i.id`,
    [itemId],
  );
  return rows.map((row) => serializeImage(row));
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(filePath)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** Best-effort removal; a file that is already gone is not a failure. */
async function quietUnlink(absolutePath) {
  try {
    await unlink(absolutePath);
  } catch (err) {
    if (err?.code !== 'ENOENT') console.warn('[images] could not unlink', absolutePath, err.message);
  }
}

function monthFolder(now = new Date()) {
  return `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function assertView(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!IMAGE_VIEWS.includes(value)) {
    throw ApiError.unprocessable('That is not a recognised view.', {
      view: `Must be one of: ${IMAGE_VIEWS.join(', ')}.`,
    });
  }
  return value;
}

/**
 * Reads the true format from the file's own bytes. Anything sharp cannot
 * decode, or decodes as a format we do not accept, is rejected here.
 */
async function sniffFormat(filePath, originalName) {
  let metadata;
  try {
    metadata = await sharp(filePath, { failOn: 'error' }).metadata();
  } catch {
    throw ApiError.unprocessable(
      `"${originalName}" is not an image the register can read. Accepted formats are ${ACCEPTED_LABEL}.`,
      { files: 'The file could not be decoded as an image.' },
    );
  }
  const spec = ACCEPTED_FORMATS[metadata.format];
  if (!spec) {
    throw ApiError.unprocessable(
      `"${originalName}" is a ${metadata.format || 'unrecognised'} file. Accepted formats are ${ACCEPTED_LABEL}.`,
      { files: `Unsupported image format: ${metadata.format || 'unknown'}.` },
    );
  }
  return { metadata, spec };
}

/**
 * Re-encodes one upload into its stored form and its thumbnail.
 * `.rotate()` with no argument applies the EXIF orientation and, because we
 * never call `.withMetadata()`, sharp writes the output with no metadata block
 * at all — which is how the GPS tag from a phone photo is removed.
 */
async function writeDerivatives(tempPath, sha, spec, metadata) {
  const folder = monthFolder();
  const storagePath = `${folder}/${sha}.${spec.ext}`;
  const thumbPath = thumbPathFor(storagePath);
  const absMain = path.join(UPLOAD_DIR, storagePath);
  const absThumb = path.join(UPLOAD_DIR, thumbPath);

  await mkdir(path.dirname(absMain), { recursive: true });

  // Animated GIFs are read as a page stack so the animation survives the
  // re-encode; auto-rotation is meaningless (and unsupported) for them.
  const readOptions = spec.animated ? { animated: true, failOn: 'error' } : { failOn: 'error' };
  const orient = (pipeline) => (spec.animated ? pipeline : pipeline.rotate());

  const main = orient(sharp(tempPath, readOptions));
  if (spec.encodeAs) main.toFormat(spec.encodeAs, { quality: 88 });
  const info = await main.toFile(absMain);

  try {
    const thumb = orient(sharp(tempPath, readOptions)).resize({
      width: THUMB_EDGE,
      height: THUMB_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    });
    if (spec.encodeAs) thumb.toFormat(spec.encodeAs, { quality: 80 });
    await thumb.toFile(absThumb);
  } catch (err) {
    await quietUnlink(absMain);
    throw err;
  }

  const { size } = await stat(absMain);
  return {
    storagePath,
    thumbPath,
    mimeType: spec.mime,
    byteSize: size,
    // For an animated GIF `info.height` is the height of the whole page stack.
    width: info.width ?? metadata.width ?? null,
    height: (spec.animated ? metadata.pageHeight ?? info.height : info.height) ?? null,
  };
}

/**
 * Turns one temporary upload into a row in `images`, reusing the existing row
 * when the same bytes have been uploaded before.
 * Returns `{ row, duplicate, writtenPaths }`; `writtenPaths` is what to remove
 * if the surrounding request later fails.
 */
async function ingestFile(file) {
  const sha = await sha256File(file.path);

  const existing = await query('SELECT * FROM images WHERE sha256 = $1', [sha]);
  if (existing.rows.length) return { row: existing.rows[0], duplicate: true, writtenPaths: [] };

  const { metadata, spec } = await sniffFormat(file.path, file.originalname);
  const derived = await writeDerivatives(file.path, sha, spec, metadata);
  const writtenPaths = [derived.storagePath, derived.thumbPath];

  try {
    // Two uploads of the same photograph can race between the SELECT above and
    // this INSERT; the upsert makes the loser a duplicate rather than a 409.
    const { rows } = await query(
      `INSERT INTO images (storage_path, original_name, mime_type, byte_size,
                           width, height, sha256, caption, alt_text)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (sha256) DO UPDATE SET sha256 = EXCLUDED.sha256
       RETURNING *, (xmax = 0) AS was_inserted`,
      [
        derived.storagePath,
        file.originalname || null,
        derived.mimeType,
        derived.byteSize,
        derived.width,
        derived.height,
        sha,
        null,
        null,
      ],
    );
    const row = rows[0];
    const duplicate = row.was_inserted === false;
    return { row, duplicate, writtenPaths: duplicate ? [] : writtenPaths };
  } catch (err) {
    for (const rel of writtenPaths) await quietUnlink(path.join(UPLOAD_DIR, rel));
    throw err;
  }
}

/** Applies `caption`/`altText` from the request to a freshly created row only. */
async function applyUploadText(client, imageId, caption, altText) {
  if (caption === undefined && altText === undefined) return null;
  const { rows } = await client.query(
    `UPDATE images
        SET caption = coalesce($2, caption), alt_text = coalesce($3, alt_text)
      WHERE id = $1 RETURNING *`,
    [imageId, caption ?? null, altText ?? null],
  );
  return rows[0];
}

function collectFiles(req) {
  const files = Array.isArray(req.files) ? req.files : [];
  if (!files.length) {
    throw ApiError.unprocessable('No image files were uploaded.', {
      files: 'Attach at least one file under the field name "files".',
    });
  }
  return files;
}

async function removeTempFiles(files) {
  for (const file of files) await quietUnlink(file.path);
}

// ------------------------------------------------------- upload: collection

router.post(
  '/collection/:id/images',
  acceptUploads,
  asyncHandler(async (req, res) => {
    const files = collectFiles(req);
    const cleanup = [];
    try {
      const view = assertView(req.body?.view);
      const caption = req.body?.caption || undefined;
      const altText = req.body?.altText ?? req.body?.alt_text ?? undefined;

      const owner = await query('SELECT id, primary_image_id FROM collection_items WHERE id = $1', [
        req.params.id,
      ]);
      if (!owner.rows.length) throw ApiError.notFound('No such collection item.');

      const ingested = [];
      for (const file of files) {
        const result = await ingestFile(file);
        cleanup.push(...result.writtenPaths);
        ingested.push(result);
      }

      const payload = await transaction(async (client) => {
        const out = [];
        for (const { row, duplicate } of ingested) {
          const updated = duplicate ? null : await applyUploadText(client, row.id, caption, altText);
          const link = await client.query(
            `INSERT INTO item_images (item_id, image_id, view, sort_order)
                  VALUES ($1, $2, $3,
                          coalesce((SELECT max(sort_order) FROM item_images WHERE item_id = $1), 0) + 1)
             ON CONFLICT (item_id, image_id)
               DO UPDATE SET view = coalesce(EXCLUDED.view, item_images.view)
             RETURNING view, sort_order`,
            [req.params.id, row.id, view],
          );
          // The first photograph of a copy becomes its primary unless one is set.
          const primary = await client.query(
            `UPDATE collection_items SET primary_image_id = $2
              WHERE id = $1 AND primary_image_id IS NULL
              RETURNING id`,
            [req.params.id, row.id],
          );
          out.push(
            serializeImage(updated ?? row, {
              view: link.rows[0].view,
              sortOrder: link.rows[0].sort_order,
              isPrimary: primary.rowCount > 0 || owner.rows[0].primary_image_id === row.id,
              duplicate,
            }),
          );
        }
        return out;
      });

      sendOne(res, payload, 201);
    } catch (err) {
      for (const rel of cleanup) await quietUnlink(path.join(UPLOAD_DIR, rel));
      throw err;
    } finally {
      await removeTempFiles(files);
    }
  }),
);

// ---------------------------------------------------------- upload: catalog

router.post(
  '/catalog/:idOrSlug/images',
  acceptUploads,
  asyncHandler(async (req, res) => {
    const files = collectFiles(req);
    const cleanup = [];
    try {
      // `view` is accepted for symmetry with collection uploads but the shared
      // catalog gallery has no per-view column, so it is not stored.
      assertView(req.body?.view);
      const caption = req.body?.caption || undefined;
      const altText = req.body?.altText ?? req.body?.alt_text ?? undefined;

      const key = req.params.idOrSlug;
      const owner = await query(
        isNumericId(key)
          ? 'SELECT id, primary_image_id FROM catalog_records WHERE id = $1'
          : 'SELECT id, primary_image_id FROM catalog_records WHERE slug = $1',
        [key],
      );
      if (!owner.rows.length) throw ApiError.notFound('No such catalog record.');
      const recordId = owner.rows[0].id;

      const ingested = [];
      for (const file of files) {
        const result = await ingestFile(file);
        cleanup.push(...result.writtenPaths);
        ingested.push(result);
      }

      const payload = await transaction(async (client) => {
        const out = [];
        for (const { row, duplicate } of ingested) {
          const updated = duplicate ? null : await applyUploadText(client, row.id, caption, altText);
          const link = await client.query(
            `INSERT INTO record_images (record_id, image_id, sort_order)
                  VALUES ($1, $2,
                          coalesce((SELECT max(sort_order) FROM record_images WHERE record_id = $1), 0) + 1)
             ON CONFLICT (record_id, image_id) DO UPDATE SET sort_order = record_images.sort_order
             RETURNING sort_order`,
            [recordId, row.id],
          );
          const primary = await client.query(
            `UPDATE catalog_records SET primary_image_id = $2
              WHERE id = $1 AND primary_image_id IS NULL
              RETURNING id`,
            [recordId, row.id],
          );
          out.push(
            serializeImage(updated ?? row, {
              view: null,
              sortOrder: link.rows[0].sort_order,
              isPrimary: primary.rowCount > 0 || owner.rows[0].primary_image_id === row.id,
              duplicate,
            }),
          );
        }
        return out;
      });

      sendOne(res, payload, 201);
    } catch (err) {
      for (const rel of cleanup) await quietUnlink(path.join(UPLOAD_DIR, rel));
      throw err;
    } finally {
      await removeTempFiles(files);
    }
  }),
);

// --------------------------------------------------------------- edit image

/** Every owner an image hangs off: collection items first, then catalog records. */
async function loadOwners(client, imageId) {
  const items = await client.query(
    `SELECT ii.item_id, ii.view, ii.sort_order, (ci.primary_image_id = $1) AS is_primary
       FROM item_images ii JOIN collection_items ci ON ci.id = ii.item_id
      WHERE ii.image_id = $1 ORDER BY ii.item_id`,
    [imageId],
  );
  const records = await client.query(
    `SELECT ri.record_id, ri.sort_order, (cr.primary_image_id = $1) AS is_primary
       FROM record_images ri JOIN catalog_records cr ON cr.id = ri.record_id
      WHERE ri.image_id = $1 ORDER BY ri.record_id`,
    [imageId],
  );
  return { items: items.rows, records: records.rows };
}

router.patch(
  '/images/:imageId',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const hasView = Object.hasOwn(body, 'view');
    const hasSort = Object.hasOwn(body, 'sortOrder');
    const hasPrimary = Object.hasOwn(body, 'isPrimary');
    const view = hasView ? assertView(body.view) : undefined;

    let sortOrder;
    if (hasSort) {
      sortOrder = Number.parseInt(body.sortOrder, 10);
      if (!Number.isFinite(sortOrder)) {
        throw ApiError.unprocessable('sortOrder must be a whole number.', {
          sortOrder: 'Expected an integer.',
        });
      }
    }

    const payload = await transaction(async (client) => {
      const found = await client.query('SELECT * FROM images WHERE id = $1', [req.params.imageId]);
      if (!found.rows.length) throw ApiError.notFound('No such image.');
      let image = found.rows[0];

      if (Object.hasOwn(body, 'caption') || Object.hasOwn(body, 'altText')) {
        const updated = await client.query(
          `UPDATE images
              SET caption  = CASE WHEN $2::boolean THEN $3 ELSE caption END,
                  alt_text = CASE WHEN $4::boolean THEN $5 ELSE alt_text END
            WHERE id = $1 RETURNING *`,
          [
            image.id,
            Object.hasOwn(body, 'caption'),
            body.caption === '' ? null : body.caption ?? null,
            Object.hasOwn(body, 'altText'),
            body.altText === '' ? null : body.altText ?? null,
          ],
        );
        image = updated.rows[0];
      }

      const owners = await loadOwners(client, image.id);
      if (!owners.items.length && !owners.records.length && (hasView || hasSort || hasPrimary)) {
        throw ApiError.unprocessable('That image is not attached to anything yet.', {
          image: 'Nothing owns this image, so view, order and primary cannot be set.',
        });
      }

      for (const link of owners.items) {
        if (hasView || hasSort) {
          await client.query(
            `UPDATE item_images
                SET view = CASE WHEN $3::boolean THEN $4 ELSE view END,
                    sort_order = CASE WHEN $5::boolean THEN $6 ELSE sort_order END
              WHERE item_id = $1 AND image_id = $2`,
            [link.item_id, image.id, hasView, view, hasSort, sortOrder ?? null],
          );
        }
        // primary_image_id is a single column on the owner, so promoting one
        // image demotes whichever held the slot — exclusivity in one statement.
        if (hasPrimary) {
          await client.query(
            body.isPrimary
              ? 'UPDATE collection_items SET primary_image_id = $2 WHERE id = $1'
              : 'UPDATE collection_items SET primary_image_id = NULL WHERE id = $1 AND primary_image_id = $2',
            [link.item_id, image.id],
          );
        }
      }

      for (const link of owners.records) {
        if (hasSort) {
          await client.query(
            'UPDATE record_images SET sort_order = $3 WHERE record_id = $1 AND image_id = $2',
            [link.record_id, image.id, sortOrder],
          );
        }
        if (hasPrimary) {
          await client.query(
            body.isPrimary
              ? 'UPDATE catalog_records SET primary_image_id = $2 WHERE id = $1'
              : 'UPDATE catalog_records SET primary_image_id = NULL WHERE id = $1 AND primary_image_id = $2',
            [link.record_id, image.id],
          );
        }
      }

      const after = await loadOwners(client, image.id);
      const first = after.items[0] ?? after.records[0] ?? {};
      return serializeImage(image, {
        view: after.items[0]?.view ?? null,
        sortOrder: first.sort_order ?? 1,
        isPrimary: Boolean(first.is_primary),
      });
    });

    sendOne(res, payload);
  }),
);

// ------------------------------------------------------------- delete image

router.delete(
  '/images/:imageId',
  asyncHandler(async (req, res) => {
    // The row goes first, inside the transaction, and the files only once that
    // has committed: a failed delete therefore never orphans a file, and a
    // failed unlink never leaves a row pointing at nothing.
    const removed = await transaction(async (client) => {
      const { rows } = await client.query('DELETE FROM images WHERE id = $1 RETURNING *', [
        req.params.imageId,
      ]);
      if (!rows.length) throw ApiError.notFound('No such image.');
      return rows[0];
    });

    await quietUnlink(path.join(UPLOAD_DIR, removed.storage_path));
    await quietUnlink(path.join(UPLOAD_DIR, thumbPathFor(removed.storage_path)));

    res.status(204).end();
  }),
);

/**
 * Unlinks stored files after the transaction that removed their rows has
 * committed. Used by the collection router when a copy is deleted and takes
 * the photographs that belonged only to it with it.
 */
export async function unlinkStoredFiles(storagePaths) {
  for (const rel of storagePaths) {
    await quietUnlink(path.join(UPLOAD_DIR, rel));
    await quietUnlink(path.join(UPLOAD_DIR, thumbPathFor(rel)));
  }
}

export default router;

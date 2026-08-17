/**
 * The master catalog: search, read, create, edit, delete, and the revision
 * history that makes every edit reversible.
 *
 * Contract: docs/API.md, "Catalog — the master list".
 *
 * Several helpers here (Params, revision writing, the CatalogSummary shape)
 * are shared with routes/wiki.js, which imports them from this module.
 */

import { Router } from 'express';
import { query, transaction } from '../lib/db.js';
import {
  ApiError,
  asyncHandler,
  sendOne,
  sendList,
  parsePaging,
  asArray,
  asBool,
  asInt,
  parseSort,
  camelKeys,
  pickColumns,
  buildUpdate,
  slugify,
  isNumericId,
} from '../lib/http.js';

const router = Router();

// ===================================================================== params

/**
 * Collects bind values and hands back the `$n` placeholder for each one, so a
 * query can be assembled in pieces without a value ever being interpolated
 * into the SQL text.
 */
export class Params {
  constructor() {
    this.values = [];
  }

  add(value) {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/**
 * `?maker=edison&maker=7` — a filter that accepts either a slug or an id.
 * Builds `(id = ANY(...) OR slug = ANY(...))` from one mixed list.
 */
function refCondition(idColumn, slugColumn, refs, p) {
  const ids = refs.filter((r) => isNumericId(r)).map(Number);
  const slugs = refs.filter((r) => !isNumericId(r)).map(String);
  const parts = [];
  if (ids.length) parts.push(`${idColumn} = ANY(${p.add(ids)}::bigint[])`);
  if (slugs.length) parts.push(`${slugColumn} = ANY(${p.add(slugs)}::text[])`);
  return parts.length ? `(${parts.join(' OR ')})` : null;
}

// ============================================================ shared SQL bits

const UPLOAD_PREFIX = '/uploads/';

/** `/uploads/<path>`, or NULL when the record has no primary image. */
const imageUrlSql = (col) =>
  `CASE WHEN ${col} IS NOT NULL THEN '${UPLOAD_PREFIX}' || ${col} END`;

/**
 * Every column a CatalogSummary needs. Read from the catalog_record_summary
 * view, with catalog_records joined for the two `*_precision` columns the view
 * does not carry and for created_at (used by the `newest` sort).
 */
const SUMMARY_COLUMNS = `
  v.id, v.slug, v.catalog_number, v.catalog_sort, v.title, v.subtitle,
  v.genre, v.work_type, v.credit_line, v.performers, v.authors,
  v.released_on::text AS released_on, r.released_precision,
  v.release_supplement,
  v.recorded_on::text AS recorded_on, r.recorded_precision,
  v.description, v.confidence, v.is_stub,
  v.maker_id, v.maker_slug, v.maker_name,
  v.series_id, v.series_slug, v.series_name,
  v.material, v.play_minutes, v.series_colour,
  ${imageUrlSql('pi.storage_path')} AS primary_image_url,
  v.link_count, v.owned_count,
  r.created_at`;

const SUMMARY_FROM = `
  FROM catalog_record_summary v
  JOIN catalog_records r ON r.id = v.id
  LEFT JOIN images pi ON pi.id = v.primary_image_id`;

/** Maps a summary row onto the CatalogSummary shape in docs/API.md. */
export function toSummary(row) {
  if (!row) return null;
  const r = camelKeys(row);
  const summary = {
    id: r.id,
    slug: r.slug,
    catalogNumber: r.catalogNumber,
    title: r.title,
    subtitle: r.subtitle ?? null,
    genre: r.genre ?? null,
    workType: r.workType ?? null,
    creditLine: r.creditLine ?? null,
    performers: r.performers ?? null,
    authors: r.authors ?? null,
    releasedOn: r.releasedOn ?? null,
    releasedPrecision: r.releasedPrecision ?? null,
    releaseSupplement: r.releaseSupplement ?? null,
    recordedOn: r.recordedOn ?? null,
    recordedPrecision: r.recordedPrecision ?? null,
    description: r.description ?? null,
    confidence: r.confidence,
    isStub: r.isStub,
    maker: { id: r.makerId, slug: r.makerSlug, name: r.makerName },
    series: {
      id: r.seriesId,
      slug: r.seriesSlug,
      name: r.seriesName,
      material: r.material,
      playMinutes: r.playMinutes ?? null,
      colour: r.seriesColour ?? null,
    },
    primaryImageUrl: r.primaryImageUrl ?? null,
    linkCount: Number(r.linkCount ?? 0),
    ownedCount: Number(r.ownedCount ?? 0),
  };
  // `rank` is only meaningful on a relevance-sorted search, and the contract
  // says it is present only then.
  if (r.rank !== undefined && r.rank !== null) summary.rank = Number(r.rank);
  return summary;
}

// ================================================================= revisions

const REVISION_IGNORED = new Set(['id', 'catalogSort', 'createdAt', 'updatedAt']);

/**
 * Genuine before/after comparison — the changed-field list must reflect what
 * actually moved, not merely which keys the client happened to send.
 */
export function diffFields(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const changed = [];
  for (const key of keys) {
    if (REVISION_IGNORED.has(key)) continue;
    if (JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after?.[key] ?? null)) {
      changed.push(key);
    }
  }
  return changed.sort();
}

export async function writeRevision(client, {
  recordId = null,
  entityType,
  entityId,
  action,
  before = null,
  after = null,
  changedFields,
  editor,
  editSummary = null,
}) {
  const fields = changedFields ?? diffFields(before, after);
  const { rows } = await client.query(
    `INSERT INTO catalog_revisions
       (record_id, entity_type, entity_id, action, before_data, after_data,
        changed_fields, editor, edit_summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      recordId,
      entityType,
      entityId,
      action,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      fields,
      editor || 'collector',
      editSummary ?? null,
    ],
  );
  return rows[0].id;
}

/** `editor` / `editSummary` ride along on the body of every mutating call. */
export function auditFrom(body = {}) {
  const editor = typeof body.editor === 'string' && body.editor.trim() ? body.editor.trim() : 'collector';
  const editSummary =
    typeof body.editSummary === 'string' && body.editSummary.trim() ? body.editSummary.trim() : null;
  return { editor, editSummary };
}

/**
 * A complete, camelCase snapshot of a catalog record including its credits and
 * links, which is what a revision stores and what a restore replays.
 */
async function snapshotRecord(client, id) {
  const { rows } = await client.query(
    `SELECT to_jsonb(r) AS record,
       (SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'personId', c.person_id, 'personSlug', p.slug,
                 'role', c.role, 'detail', c.detail, 'billingOrder', c.billing_order)
               ORDER BY c.billing_order, p.name), '[]'::jsonb)
          FROM record_credits c JOIN people p ON p.id = c.person_id
         WHERE c.record_id = r.id) AS credits,
       (SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'kind', l.kind, 'label', l.label, 'url', l.url,
                 'sourceName', l.source_name, 'sortOrder', l.sort_order)
               ORDER BY l.sort_order, l.id), '[]'::jsonb)
          FROM record_links l WHERE l.record_id = r.id) AS links
     FROM catalog_records r WHERE r.id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  return { ...camelKeys(rows[0].record), credits: rows[0].credits, links: rows[0].links };
}

// ==================================================================== search

/**
 * Mirrors amberola_tsquery(): a search of only punctuation carries no terms
 * and is treated as "no text filter" rather than "match nothing".
 */
function normaliseQ(value) {
  if (typeof value !== 'string') return null;
  const stripped = value.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return stripped ? value.trim() : null;
}

// How close a word has to be before the trigram fallback accepts it. Loose
// enough that `feding` reaches `Feeding`, tight enough that unrelated words do
// not flood in.
const WORD_SIMILARITY_THRESHOLD = 0.4;

const CATALOG_SORTS = {
  relevance: { expr: 'f.rank', desc: true },
  catalog: { expr: 'f.catalog_sort', desc: false },
  title: { expr: 'immutable_unaccent(lower(f.title))', desc: false },
  year: { expr: 'f.year_value', desc: false },
  newest: { expr: 'f.created_at', desc: true },
  maker: { expr: 'immutable_unaccent(lower(f.maker_name))', desc: false },
};

function catalogOrderBy(sortParam, hasQuery) {
  const fallback = hasQuery ? 'relevance' : 'catalog';
  const { key, desc } = parseSort(sortParam, Object.keys(CATALOG_SORTS), fallback);
  const spec = CATALOG_SORTS[key];
  // The `-` prefix reverses whatever that key's natural direction is, so
  // `newest` is newest-first and `-newest` is oldest-first.
  const direction = (desc ? !spec.desc : spec.desc) ? 'DESC' : 'ASC';
  return { key, sql: `${spec.expr} ${direction} NULLS LAST, f.catalog_sort ASC, f.id ASC` };
}

/**
 * Builds the one statement that answers a catalog list request: the page of
 * rows, the total, and all four facet breakdowns.
 *
 * The `filtered` CTE holds the whole matching set once. Because it is
 * referenced more than once Postgres materialises it, so the facets are
 * counted over the entire filtered set — not the page — without re-running the
 * filters five times.
 */
function buildCatalogListQuery(reqQuery, { mode, page, pageSize, offset }) {
  const p = new Params();
  const where = [];
  let rankExpr = 'NULL::real';
  let searchJoin = '';

  const q = normaliseQ(reqQuery.q);
  if (q && mode === 'fulltext') {
    const qp = p.add(q);
    searchJoin = 'JOIN catalog_search cs ON cs.record_id = v.id';
    where.push(`cs.document @@ amberola_tsquery(${qp})`);
    // ts_rank_cd honours the A/B/C/D weights the index was built with, so a hit
    // in the title outranks one buried in the lyrics.
    rankExpr = `ts_rank_cd(cs.document, amberola_tsquery(${qp}))`;
  } else if (q && mode === 'fuzzy') {
    const qp = p.add(q);
    searchJoin = 'JOIN catalog_search cs ON cs.record_id = v.id';
    // `%>` is the commutator of `<%`, written with the indexed column on the
    // left so the gin_trgm_ops index on haystack can be used.
    where.push(`cs.haystack %> ${qp}`);
    rankExpr = `word_similarity(${qp}, cs.haystack)`;
  }

  const makerCond = refCondition('v.maker_id', 'v.maker_slug', asArray(reqQuery.maker), p);
  if (makerCond) where.push(makerCond);

  const seriesCond = refCondition('v.series_id', 'v.series_slug', asArray(reqQuery.series), p);
  if (seriesCond) where.push(seriesCond);

  const people = asArray(reqQuery.person);
  if (people.length) {
    const cond = refCondition('p2.id', 'p2.slug', people, p);
    where.push(`EXISTS (SELECT 1 FROM record_credits c2
                          JOIN people p2 ON p2.id = c2.person_id
                         WHERE c2.record_id = v.id AND ${cond})`);
  }

  const genres = asArray(reqQuery.genre);
  if (genres.length) where.push(`v.genre = ANY(${p.add(genres.map(String))}::text[])`);

  if (reqQuery.material) where.push(`v.material = ${p.add(String(reqQuery.material))}::cylinder_material`);

  if (reqQuery.playMinutes !== undefined && reqQuery.playMinutes !== '') {
    const minutes = Number(reqQuery.playMinutes);
    if (!Number.isFinite(minutes)) throw ApiError.badRequest('playMinutes must be a number.');
    where.push(`v.play_minutes = ${p.add(minutes)}::numeric`);
  }

  // Release year, falling back to the recording year when the issue date is
  // unknown — otherwise a record dated only by session would vanish from a
  // year filter.
  const yearExpr = 'EXTRACT(YEAR FROM coalesce(v.released_on, v.recorded_on))::int';
  const yearFrom = asInt(reqQuery.yearFrom);
  const yearTo = asInt(reqQuery.yearTo);
  if (yearFrom !== undefined) where.push(`${yearExpr} >= ${p.add(yearFrom)}`);
  if (yearTo !== undefined) where.push(`${yearExpr} <= ${p.add(yearTo)}`);

  const confidence = asArray(reqQuery.confidence);
  if (confidence.length) {
    where.push(`v.confidence = ANY(${p.add(confidence.map(String))}::data_confidence[])`);
  }

  const owned = asBool(reqQuery.owned);
  if (owned === true) where.push('v.owned_count > 0');
  if (owned === false) where.push('v.owned_count = 0');

  if (asBool(reqQuery.hasAudio) === true) {
    where.push(`EXISTS (SELECT 1 FROM record_links l2
                         WHERE l2.record_id = v.id AND l2.kind = 'audio')`);
  }

  const order = catalogOrderBy(reqQuery.sort, Boolean(q));
  const limitParam = p.add(pageSize);
  const offsetParam = p.add(offset);

  const text = `
    WITH filtered AS (
      SELECT ${SUMMARY_COLUMNS},
             ${rankExpr} AS rank,
             ${yearExpr} AS year_value
      ${SUMMARY_FROM}
      ${searchJoin}
      ${where.length ? 'WHERE ' + where.join('\n        AND ') : ''}
    ),
    page AS (
      SELECT f.*, row_number() OVER (ORDER BY ${order.sql}) AS rn
        FROM filtered f
       ORDER BY ${order.sql}
       LIMIT ${limitParam} OFFSET ${offsetParam}
    )
    SELECT
      (SELECT count(*)::int FROM filtered) AS total,
      (SELECT coalesce(jsonb_agg(to_jsonb(pg) ORDER BY pg.rn), '[]'::jsonb) FROM page pg) AS rows,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', t.slug, 'name', t.name, 'count', t.c)
                                 ORDER BY t.c DESC, t.name), '[]'::jsonb)
         FROM (SELECT maker_slug AS slug, maker_name AS name, count(*)::int AS c
                 FROM filtered GROUP BY 1, 2) t) AS maker_facets,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', t.slug, 'name', t.name, 'count', t.c)
                                 ORDER BY t.c DESC, t.name), '[]'::jsonb)
         FROM (SELECT series_slug AS slug, series_name AS name, count(*)::int AS c
                 FROM filtered GROUP BY 1, 2) t) AS series_facets,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('value', t.value, 'count', t.c)
                                 ORDER BY t.c DESC, t.value), '[]'::jsonb)
         FROM (SELECT genre AS value, count(*)::int AS c
                 FROM filtered WHERE genre IS NOT NULL AND genre <> '' GROUP BY 1) t) AS genre_facets,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('value', t.value, 'count', t.c)
                                 ORDER BY t.value), '[]'::jsonb)
         FROM (SELECT (year_value / 10) * 10 AS value, count(*)::int AS c
                 FROM filtered WHERE year_value IS NOT NULL GROUP BY 1) t) AS decade_facets
  `;

  return { text, values: p.values, sortKey: order.key, q, page, pageSize };
}

function shapeListResult(row, { sortKey }) {
  const withRank = sortKey === 'relevance';
  const data = (row.rows || []).map((r) => {
    const summary = toSummary(r);
    if (!withRank) delete summary.rank;
    return summary;
  });
  return {
    data,
    total: row.total,
    facets: {
      makers: row.maker_facets || [],
      series: row.series_facets || [],
      genres: row.genre_facets || [],
      decades: row.decade_facets || [],
    },
  };
}

/**
 * GET /api/catalog — the searchable master list.
 *
 * Full text first; if that finds nothing, the same filters are re-run with the
 * trigram fallback so a misspelling still lands. `matchMode` tells the UI which
 * path produced what it is looking at.
 */
router.get(
  '/catalog',
  asyncHandler(async (req, res) => {
    const paging = parsePaging(req.query);
    const hasQuery = Boolean(normaliseQ(req.query.q));

    const built = buildCatalogListQuery(req.query, { mode: 'fulltext', ...paging });
    const { rows } = await query(built.text, built.values);
    let result = shapeListResult(rows[0], built);
    let matchMode = hasQuery ? 'fulltext' : undefined;

    if (hasQuery && result.total === 0) {
      const fuzzy = buildCatalogListQuery(req.query, { mode: 'fuzzy', ...paging });
      // word_similarity_threshold is a per-session GUC; SET LOCAL keeps the
      // looser threshold inside this one transaction.
      const fuzzyRows = await transaction(async (client) => {
        await client.query('SELECT set_config($1, $2, true)', [
          'pg_trgm.word_similarity_threshold',
          String(WORD_SIMILARITY_THRESHOLD),
        ]);
        const r = await client.query(fuzzy.text, fuzzy.values);
        return r.rows;
      });
      result = shapeListResult(fuzzyRows[0], fuzzy);
      matchMode = result.total > 0 ? 'fuzzy' : 'none';
    }

    const extra = { facets: result.facets };
    if (matchMode) extra.matchMode = matchMode;
    return sendList(
      res,
      result.data,
      { page: paging.page, pageSize: paging.pageSize, total: result.total },
      extra,
    );
  }),
);

// ==================================================================== lookup

/** Resolves `:idOrSlug` to a catalog record id, or throws 404. */
async function resolveRecordId(idOrSlug, client = null) {
  const runner = client ? client.query.bind(client) : query;
  const { rows } = await runner(
    isNumericId(idOrSlug)
      ? 'SELECT id FROM catalog_records WHERE id = $1'
      : 'SELECT id FROM catalog_records WHERE slug = $1',
    [isNumericId(idOrSlug) ? Number(idOrSlug) : String(idOrSlug)],
  );
  if (!rows[0]) throw ApiError.notFound('No catalog record with that id or slug.');
  return rows[0].id;
}

// ==================================================================== detail

const CREDITS_SQL = `
  SELECT c.id, c.role, c.detail, c.billing_order,
         jsonb_build_object(
           'id', p.id, 'slug', p.slug, 'name', p.name, 'fullName', p.full_name,
           'isGroup', p.is_group, 'voiceOrInstrument', p.voice_or_instrument,
           'summary', p.summary) AS person
    FROM record_credits c
    JOIN people p ON p.id = c.person_id
   WHERE c.record_id = $1
   ORDER BY c.billing_order, p.name`;

const LINKS_SQL = `
  SELECT id, kind, label, url, source_name
    FROM record_links WHERE record_id = $1 ORDER BY sort_order, id`;

const IMAGES_SQL = `
  SELECT i.id, i.storage_path, i.caption, i.alt_text, i.width, i.height,
         i.byte_size, i.mime_type, ri.sort_order, i.created_at,
         (i.id = r.primary_image_id) AS is_primary
    FROM record_images ri
    JOIN images i ON i.id = ri.image_id
    JOIN catalog_records r ON r.id = ri.record_id
   WHERE ri.record_id = $1
   ORDER BY (i.id = r.primary_image_id) DESC, ri.sort_order, i.id`;

/**
 * Thumbnails follow the naming in docs/API.md — `abc123.jpg` alongside
 * `abc123_thumb.jpg` — since the images table stores only the original path.
 */
function thumbUrlFor(storagePath) {
  if (!storagePath) return null;
  const dot = storagePath.lastIndexOf('.');
  const thumb = dot > 0 ? `${storagePath.slice(0, dot)}_thumb${storagePath.slice(dot)}` : `${storagePath}_thumb`;
  return UPLOAD_PREFIX + thumb;
}

function toImage(row) {
  const r = camelKeys(row);
  return {
    id: r.id,
    url: UPLOAD_PREFIX + r.storagePath,
    thumbUrl: thumbUrlFor(r.storagePath),
    view: r.view ?? null,
    caption: r.caption ?? null,
    altText: r.altText ?? null,
    width: r.width ?? null,
    height: r.height ?? null,
    byteSize: r.byteSize ?? null,
    mimeType: r.mimeType ?? null,
    sortOrder: r.sortOrder ?? 1,
    isPrimary: Boolean(r.isPrimary),
    createdAt: r.createdAt ?? null,
  };
}

const MAKER_DETAIL_SQL = `
  SELECT m.*, (SELECT count(*)::int FROM catalog_records cr WHERE cr.maker_id = m.id) AS record_count
    FROM makers m WHERE m.id = $1`;

const SERIES_DETAIL_SQL = `
  SELECT s.*, (SELECT count(*)::int FROM catalog_records cr WHERE cr.series_id = s.id) AS record_count,
         m.id AS m_id, m.slug AS m_slug, m.name AS m_name
    FROM series s JOIN makers m ON m.id = s.maker_id WHERE s.id = $1`;

export function toMakerDetail(row, links = []) {
  if (!row) return null;
  const r = camelKeys(row);
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    shortName: r.shortName ?? null,
    country: r.country ?? null,
    city: r.city ?? null,
    foundedYear: r.foundedYear ?? null,
    dissolvedYear: r.dissolvedYear ?? null,
    summary: r.summary ?? null,
    history: r.history ?? null,
    notes: r.notes ?? null,
    links,
    recordCount: Number(r.recordCount ?? 0),
    createdAt: r.createdAt ?? null,
    updatedAt: r.updatedAt ?? null,
  };
}

export function toSeriesDetail(row, links = []) {
  if (!row) return null;
  const r = camelKeys(row);
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    maker: { id: r.mId, slug: r.mSlug, name: r.mName },
    playMinutes: r.playMinutes ?? null,
    material: r.material,
    threadsPerInch: r.threadsPerInch ?? null,
    colour: r.colour ?? null,
    introducedYear: r.introducedYear ?? null,
    discontinuedYear: r.discontinuedYear ?? null,
    summary: r.summary ?? null,
    description: r.description ?? null,
    notes: r.notes ?? null,
    links,
    recordCount: Number(r.recordCount ?? 0),
    createdAt: r.createdAt ?? null,
    updatedAt: r.updatedAt ?? null,
  };
}

export async function entityLinks(entityType, entityId) {
  const { rows } = await query(
    `SELECT id, kind, label, url, NULL::text AS source_name
       FROM entity_links WHERE entity_type = $1 AND entity_id = $2
      ORDER BY sort_order, id`,
    [entityType, entityId],
  );
  return rows.map((r) => camelKeys(r));
}

/**
 * The cross-references a collector actually wants on a record page, fetched as
 * one tagged query rather than four.
 *
 * - originalIssue / reissues: the dubbing chain via original_issue_id
 * - alsoOnOtherSeries: the same title issued on a different series
 * - otherByPerformers: other titles sharing a credited performer
 */
async function fetchRelated(id) {
  const { rows } = await query(
    `WITH me AS (SELECT * FROM catalog_records WHERE id = $1)
     SELECT 'originalIssue' AS relation, 0 AS ord, ${SUMMARY_COLUMNS}
       ${SUMMARY_FROM}
      WHERE v.id = (SELECT original_issue_id FROM me)
     UNION ALL
     SELECT 'reissues', 1, ${SUMMARY_COLUMNS}
       ${SUMMARY_FROM}
      WHERE r.original_issue_id = $1
     UNION ALL
     SELECT 'alsoOnOtherSeries', 2, ${SUMMARY_COLUMNS}
       ${SUMMARY_FROM}
      WHERE v.id <> $1
        AND v.series_id IS DISTINCT FROM (SELECT series_id FROM me)
        AND lower(immutable_unaccent(v.title)) = (SELECT lower(immutable_unaccent(title)) FROM me)
     UNION ALL
     SELECT * FROM (
       SELECT 'otherByPerformers', 3, ${SUMMARY_COLUMNS}
         ${SUMMARY_FROM}
        WHERE v.id <> $1
          AND EXISTS (
            SELECT 1 FROM record_credits c
             WHERE c.record_id = v.id
               AND c.person_id IN (SELECT person_id FROM record_credits WHERE record_id = $1))
        ORDER BY v.catalog_sort
        LIMIT 12) top_performers`,
    [id],
  );

  const grouped = { originalIssue: [], reissues: [], alsoOnOtherSeries: [], otherByPerformers: [] };
  for (const row of rows) grouped[row.relation].push(toSummary(row));
  return grouped;
}

/**
 * The collector's own copies of this title. Same shape as the collection
 * list's CollectionItemSummary, built here so the record page can show
 * "you own two of these" without a second round trip from the browser.
 */
async function fetchMyCopies(recordId, recordSummary) {
  const { rows } = await query(
    `SELECT ci.id, ci.collection_id, ci.copy_label,
            ci.unmatched_title, ci.unmatched_maker, ci.unmatched_number,
            ci.acquired_on::text AS acquired_on, ci.acquired_from,
            ci.acquired_price, ci.acquired_currency, ci.estimated_value,
            ci.has_original_box, ci.has_original_lid, ci.playback_rating,
            ci.surface_noise, ci.is_playable, ci.storage_location,
            ci.personal_notes, ci.condition_notes, ci.is_favourite, ci.is_for_trade,
            ci.created_at, ci.updated_at,
            CASE WHEN cg.id IS NOT NULL THEN jsonb_build_object(
              'id', cg.id, 'code', cg.code, 'label', cg.label, 'score', cg.score) END AS condition_grade,
            CASE WHEN bg.id IS NOT NULL THEN jsonb_build_object(
              'id', bg.id, 'code', bg.code, 'label', bg.label, 'score', bg.score) END AS box_grade,
            (SELECT coalesce(jsonb_agg(jsonb_build_object(
                      'id', d.id, 'severity', d.severity, 'location', d.location,
                      'notes', d.notes, 'isResolved', d.is_resolved,
                      'notedOn', d.noted_on::text,
                      'defectType', jsonb_build_object(
                        'id', dt.id, 'code', dt.code, 'label', dt.label,
                        'category', dt.category, 'careAdvice', dt.care_advice,
                        'isTerminal', dt.is_terminal))
                    ORDER BY d.id), '[]'::jsonb)
               FROM item_defects d JOIN defect_types dt ON dt.id = d.defect_type_id
              WHERE d.item_id = ci.id) AS defects,
            jsonb_build_object(
              'isCleaned', coalesce(cl.is_cleaned, false),
              'cleaningCount', coalesce(cl.cleaning_count, 0),
              'lastCleanedAt', cl.last_cleaned_at,
              'lastMethod', cl.last_cleaning_method,
              'lastNotes', cl.last_cleaning_notes) AS cleaning,
            ${imageUrlSql('pim.storage_path')} AS primary_image_url,
            (SELECT count(*)::int FROM item_images ii WHERE ii.item_id = ci.id) AS image_count
       FROM collection_items ci
       LEFT JOIN condition_grades cg ON cg.id = ci.condition_grade_id
       LEFT JOIN condition_grades bg ON bg.id = ci.box_grade_id
       LEFT JOIN collection_item_cleaning cl ON cl.item_id = ci.id
       LEFT JOIN images pim ON pim.id = ci.primary_image_id
      WHERE ci.record_id = $1
      ORDER BY ci.acquired_on DESC NULLS LAST, ci.id`,
    [recordId],
  );

  return rows.map((row) => {
    const r = camelKeys(row);
    return {
      ...r,
      record: recordSummary,
      displayTitle: recordSummary?.title ?? r.unmatchedTitle ?? null,
    };
  });
}

/** Assembles the full record page described in docs/API.md. */
async function loadRecordDetail(id) {
  const [main, credits, links, images, related] = await Promise.all([
    query(
      `SELECT ${SUMMARY_COLUMNS},
              r.matrix_number, r.take, r.language, r.recorded_place, r.duration_seconds,
              r.notes, r.lyrics, r.trivia, r.provenance, r.withdrawn_on::text AS withdrawn_on,
              r.original_issue_id, r.updated_at,
              (SELECT count(*)::int FROM catalog_revisions cv
                WHERE cv.entity_type = 'catalog_record' AND cv.entity_id = r.id) AS revision_count
       ${SUMMARY_FROM}
       WHERE v.id = $1`,
      [id],
    ),
    query(CREDITS_SQL, [id]),
    query(LINKS_SQL, [id]),
    query(IMAGES_SQL, [id]),
    fetchRelated(id),
  ]);

  const row = main.rows[0];
  if (!row) throw ApiError.notFound('No catalog record with that id or slug.');

  const [seriesRow, makerRow, seriesLinks, makerLinks, myCopies] = await Promise.all([
    query(SERIES_DETAIL_SQL, [row.series_id]),
    query(MAKER_DETAIL_SQL, [row.maker_id]),
    entityLinks('series', row.series_id),
    entityLinks('maker', row.maker_id),
    fetchMyCopies(id, toSummary(row)),
  ]);

  const r = camelKeys(row);
  return {
    ...toSummary(row),
    matrixNumber: r.matrixNumber ?? null,
    take: r.take ?? null,
    language: r.language ?? null,
    recordedPlace: r.recordedPlace ?? null,
    durationSeconds: r.durationSeconds ?? null,
    notes: r.notes ?? null,
    lyrics: r.lyrics ?? null,
    trivia: r.trivia ?? null,
    provenance: r.provenance ?? null,
    withdrawnOn: r.withdrawnOn ?? null,
    credits: credits.rows.map((c) => camelKeys(c)),
    links: links.rows.map((l) => camelKeys(l)),
    images: images.rows.map(toImage),
    seriesDetail: toSeriesDetail(seriesRow.rows[0], seriesLinks),
    makerDetail: toMakerDetail(makerRow.rows[0], makerLinks),
    originalIssue: related.originalIssue[0] ?? null,
    reissues: related.reissues,
    alsoOnOtherSeries: related.alsoOnOtherSeries,
    otherByPerformers: related.otherByPerformers,
    myCopies,
    revisionCount: r.revisionCount ?? 0,
    createdAt: r.createdAt ?? null,
    updatedAt: r.updatedAt ?? null,
  };
}

router.get(
  '/catalog/:idOrSlug',
  asyncHandler(async (req, res) => {
    const id = await resolveRecordId(req.params.idOrSlug);
    return sendOne(res, await loadRecordDetail(id));
  }),
);

// ============================================================ create / update

const RECORD_COLUMNS = [
  'slug', 'series_id', 'maker_id', 'catalog_number', 'matrix_number', 'take',
  'title', 'subtitle', 'work_type', 'genre', 'language', 'credit_line',
  'recorded_on', 'recorded_precision', 'recorded_place',
  'released_on', 'released_precision', 'release_supplement', 'withdrawn_on',
  'duration_seconds', 'description', 'notes', 'lyrics', 'trivia', 'provenance',
  'original_issue_id', 'confidence', 'is_stub', 'primary_image_id',
];

/** Accepts `seriesId` or `seriesSlug` (likewise makers) and returns the row. */
async function resolveSeries(client, body) {
  if (body.seriesId !== undefined && body.seriesId !== null) {
    const { rows } = await client.query('SELECT id, slug, maker_id FROM series WHERE id = $1', [body.seriesId]);
    if (!rows[0]) throw ApiError.unprocessable('That series does not exist.', { seriesId: 'No such series.' });
    return rows[0];
  }
  if (body.seriesSlug) {
    const { rows } = await client.query('SELECT id, slug, maker_id FROM series WHERE slug = $1', [body.seriesSlug]);
    if (!rows[0]) throw ApiError.unprocessable('That series does not exist.', { seriesSlug: 'No such series.' });
    return rows[0];
  }
  return null;
}

/**
 * `edison-blue-amberol-2848`. Collisions — a reissue of the same number, or a
 * second take — get a numeric suffix rather than failing the insert.
 */
async function uniqueSlug(client, table, base) {
  const stem = slugify(base) || 'record';
  for (let n = 1; n < 200; n += 1) {
    const candidate = n === 1 ? stem : `${stem}-${n}`;
    const { rows } = await client.query(`SELECT 1 FROM ${table} WHERE slug = $1`, [candidate]);
    if (!rows[0]) return candidate;
  }
  throw ApiError.conflict('Could not derive a free slug for that record.');
}

/** Resolves the `personId` / `personSlug` on every inline credit in one query. */
async function resolvePeople(client, credits) {
  const ids = credits.map((c) => c.personId).filter((v) => v !== undefined && v !== null).map(Number);
  const slugs = credits.map((c) => c.personSlug).filter(Boolean).map(String);
  const { rows } = await client.query(
    'SELECT id, slug FROM people WHERE id = ANY($1::bigint[]) OR slug = ANY($2::text[])',
    [ids, slugs],
  );
  const byId = new Map(rows.map((r) => [Number(r.id), Number(r.id)]));
  const bySlug = new Map(rows.map((r) => [r.slug, Number(r.id)]));

  const details = {};
  const resolved = credits.map((credit, index) => {
    const id = credit.personId != null ? byId.get(Number(credit.personId))
      : credit.personSlug ? bySlug.get(String(credit.personSlug))
        : undefined;
    if (id === undefined) {
      details[`credits[${index}].person`] =
        credit.personId != null || credit.personSlug
          ? 'No person with that id or slug.'
          : 'A credit needs personId or personSlug.';
    }
    return { ...credit, personId: id };
  });
  if (Object.keys(details).length) throw ApiError.unprocessable('Some credits could not be resolved.', details);
  return resolved;
}

async function replaceCredits(client, recordId, credits) {
  await client.query('DELETE FROM record_credits WHERE record_id = $1', [recordId]);
  if (!credits.length) return;
  const resolved = await resolvePeople(client, credits);
  for (const [index, credit] of resolved.entries()) {
    await client.query(
      `INSERT INTO record_credits (record_id, person_id, role, detail, billing_order)
       VALUES ($1, $2, coalesce($3, 'performer')::credit_role, $4, $5)
       ON CONFLICT DO NOTHING`,
      [recordId, credit.personId, credit.role ?? null, credit.detail ?? null, credit.billingOrder ?? index + 1],
    );
  }
}

async function replaceLinks(client, recordId, links) {
  await client.query('DELETE FROM record_links WHERE record_id = $1', [recordId]);
  const details = {};
  links.forEach((link, index) => {
    if (!link.url) details[`links[${index}].url`] = 'A link needs a url.';
    else if (!/^https?:\/\//i.test(String(link.url))) details[`links[${index}].url`] = 'Links must be http or https.';
    if (!link.label) details[`links[${index}].label`] = 'A link needs a label.';
  });
  if (Object.keys(details).length) throw ApiError.unprocessable('Some links are not valid.', details);

  for (const [index, link] of links.entries()) {
    await client.query(
      `INSERT INTO record_links (record_id, kind, label, url, source_name, sort_order)
       VALUES ($1, coalesce($2, 'other')::link_kind, $3, $4, $5, $6)
       ON CONFLICT (record_id, url) DO NOTHING`,
      [recordId, link.kind ?? null, link.label, link.url, link.sourceName ?? null, link.sortOrder ?? index + 1],
    );
  }
}

router.post(
  '/catalog',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const { editor, editSummary } = auditFrom(body);

    const details = {};
    if (!body.catalogNumber) details.catalogNumber = 'A catalog number is required.';
    if (!body.title) details.title = 'A title is required.';
    if (body.seriesId === undefined && !body.seriesSlug) details.seriesId = 'seriesId or seriesSlug is required.';
    if (Object.keys(details).length) throw ApiError.unprocessable('That record is missing required fields.', details);

    const record = await transaction(async (client) => {
      const series = await resolveSeries(client, body);
      const columns = pickColumns(body, RECORD_COLUMNS);
      columns.series_id = series.id;
      columns.maker_id = body.makerId ?? series.maker_id;
      columns.catalog_number = String(body.catalogNumber);
      columns.title = String(body.title);
      columns.slug = body.slug
        ? await uniqueSlug(client, 'catalog_records', body.slug)
        : await uniqueSlug(client, 'catalog_records', `${series.slug}-${body.catalogNumber}`);

      const keys = Object.keys(columns);
      const { rows } = await client.query(
        `INSERT INTO catalog_records (${keys.join(', ')})
         VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})
         RETURNING id`,
        keys.map((k) => columns[k]),
      );
      const id = rows[0].id;

      if (Array.isArray(body.credits)) await replaceCredits(client, id, body.credits);
      if (Array.isArray(body.links)) await replaceLinks(client, id, body.links);

      const after = await snapshotRecord(client, id);
      await writeRevision(client, {
        recordId: id,
        entityType: 'catalog_record',
        entityId: id,
        action: 'create',
        before: null,
        after,
        changedFields: diffFields(null, after),
        editor,
        editSummary,
      });
      return id;
    });

    return sendOne(res, await loadRecordDetail(record), 201);
  }),
);

router.patch(
  '/catalog/:idOrSlug',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const { editor, editSummary } = auditFrom(body);
    const id = await resolveRecordId(req.params.idOrSlug);

    await transaction(async (client) => {
      // Lock the row so a concurrent edit cannot slip between the before and
      // after snapshots and leave a revision that describes neither.
      await client.query('SELECT id FROM catalog_records WHERE id = $1 FOR UPDATE', [id]);
      const before = await snapshotRecord(client, id);

      const columns = pickColumns(body, RECORD_COLUMNS);
      // The slug is NOT NULL, so a blank one means "leave it alone" rather
      // than "clear it".
      if (columns.slug) columns.slug = slugify(columns.slug);
      else delete columns.slug;
      if (Object.keys(columns).length) {
        const { clause, values } = buildUpdate(columns, 2);
        await client.query(`UPDATE catalog_records SET ${clause} WHERE id = $1`, [id, ...values]);
      }

      if (Array.isArray(body.credits)) await replaceCredits(client, id, body.credits);
      if (Array.isArray(body.links)) await replaceLinks(client, id, body.links);

      const after = await snapshotRecord(client, id);
      const changedFields = diffFields(before, after);
      await writeRevision(client, {
        recordId: id,
        entityType: 'catalog_record',
        entityId: id,
        action: 'update',
        before,
        after,
        changedFields,
        editor,
        editSummary,
      });
    });

    return sendOne(res, await loadRecordDetail(id));
  }),
);

router.delete(
  '/catalog/:idOrSlug',
  asyncHandler(async (req, res) => {
    const { editor, editSummary } = auditFrom(req.body ?? {});
    const id = await resolveRecordId(req.params.idOrSlug);

    // The collector's own copies are the irreplaceable half of this database.
    // collection_items.record_id is ON DELETE SET NULL, so deleting the record
    // would quietly orphan them; refuse instead and name what is in the way.
    const blocking = await query(
      `SELECT ci.id, ci.copy_label, c.name AS collection_name
         FROM collection_items ci JOIN collections c ON c.id = ci.collection_id
        WHERE ci.record_id = $1 ORDER BY ci.id`,
      [id],
    );
    if (blocking.rows.length) {
      const named = blocking.rows
        .map((r) => `#${r.id}${r.copy_label ? ` (${r.copy_label})` : ''} in ${r.collection_name}`)
        .join(', ');
      throw ApiError.conflict(
        'That record still has copies in the collection, so it cannot be deleted.',
        {
          collectionItems: named,
          collectionItemIds: blocking.rows.map((r) => r.id).join(','),
        },
      );
    }

    await transaction(async (client) => {
      const before = await snapshotRecord(client, id);
      await writeRevision(client, {
        recordId: id,
        entityType: 'catalog_record',
        entityId: id,
        action: 'delete',
        before,
        after: null,
        changedFields: diffFields(before, null),
        editor,
        editSummary,
      });
      await client.query('DELETE FROM catalog_records WHERE id = $1', [id]);
    });

    return res.status(204).end();
  }),
);

// ================================================================= revisions

function toRevision(row) {
  const r = camelKeys(row);
  return {
    id: r.id,
    action: r.action,
    editor: r.editor,
    editSummary: r.editSummary ?? null,
    changedFields: r.changedFields ?? [],
    beforeData: r.beforeData ?? null,
    afterData: r.afterData ?? null,
    createdAt: r.createdAt,
  };
}

router.get(
  '/catalog/:idOrSlug/revisions',
  asyncHandler(async (req, res) => {
    const id = await resolveRecordId(req.params.idOrSlug);
    const { rows } = await query(
      `SELECT id, action, editor, edit_summary, changed_fields, before_data, after_data, created_at
         FROM catalog_revisions
        WHERE entity_type = 'catalog_record' AND entity_id = $1
        ORDER BY created_at DESC, id DESC`,
      [id],
    );
    return sendOne(res, rows.map(toRevision));
  }),
);

/**
 * Puts a record back the way a revision found it. The restore is itself an
 * edit, so it writes a `restore` revision of its own and stays undoable.
 */
router.post(
  '/catalog/:idOrSlug/revisions/:revisionId/restore',
  asyncHandler(async (req, res) => {
    const { editor, editSummary } = auditFrom(req.body ?? {});
    const id = await resolveRecordId(req.params.idOrSlug);
    if (!isNumericId(req.params.revisionId)) throw ApiError.badRequest('revisionId must be numeric.');

    await transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT id, before_data FROM catalog_revisions
          WHERE id = $1 AND entity_type = 'catalog_record' AND entity_id = $2`,
        [Number(req.params.revisionId), id],
      );
      const revision = rows[0];
      if (!revision) throw ApiError.notFound('No such revision for that record.');
      if (!revision.before_data) {
        throw ApiError.unprocessable('That revision has no earlier state to restore.', {
          revisionId: 'This revision created the record; there is nothing before it.',
        });
      }

      await client.query('SELECT id FROM catalog_records WHERE id = $1 FOR UPDATE', [id]);
      const before = await snapshotRecord(client, id);

      const target = revision.before_data;
      const columns = pickColumns(target, RECORD_COLUMNS);
      if (!columns.slug) delete columns.slug;
      if (Object.keys(columns).length) {
        const { clause, values } = buildUpdate(columns, 2);
        await client.query(`UPDATE catalog_records SET ${clause} WHERE id = $1`, [id, ...values]);
      }
      if (Array.isArray(target.credits)) await replaceCredits(client, id, target.credits);
      if (Array.isArray(target.links)) await replaceLinks(client, id, target.links);

      const after = await snapshotRecord(client, id);
      await writeRevision(client, {
        recordId: id,
        entityType: 'catalog_record',
        entityId: id,
        action: 'restore',
        before,
        after,
        changedFields: diffFields(before, after),
        editor,
        editSummary: editSummary ?? `Restored revision #${revision.id}`,
      });
    });

    return sendOne(res, await loadRecordDetail(id));
  }),
);

// Exposed for routes/wiki.js, which lists CatalogSummary rows on every
// maker, series and person page.
export { SUMMARY_COLUMNS, SUMMARY_FROM, uniqueSlug, snapshotRecord };
export default router;

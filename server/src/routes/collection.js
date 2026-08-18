/**
 * The collector's own shelf: owned copies, their condition, their defects,
 * the cleaning log, the play log, the wishlist, the dashboard statistics and
 * the export.
 *
 * Two things about this half of the database are worth stating plainly.
 *
 * First, the "cleaned" flag is never stored. It is read from the
 * `collection_item_cleaning` view, which derives it from the cleaning log
 * itself, so the summary the collector sees on the shelf can never drift out
 * of step with the events it summarises.
 *
 * Second, the cleaning log exists to prevent one specific mistake. Water and
 * alcohol destroy a wax cylinder; celluloid tolerates a careful wash. Every
 * cleaning method records the materials it suits in `cleaning_methods.safe_for`,
 * and logging a method against a material it does not suit returns a warning.
 * The warning never blocks the write: the collector may be recording something
 * already done, and an accurate history is worth more than a tidy one.
 */

import { Router } from 'express';

import { query, transaction } from '../lib/db.js';
import {
  ApiError,
  asArray,
  asBool,
  asyncHandler,
  camelKeys,
  isNumericId,
  parsePaging,
  parseSort,
  pickColumns,
  buildUpdate,
  sendList,
  sendOne,
} from '../lib/http.js';
import { IMAGE_COLUMNS, loadItemImages, serializeImage, unlinkStoredFiles } from './images.js';

const router = Router();

const MATERIALS = ['brown_wax', 'black_wax', 'metallic_soap', 'celluloid', 'condensite', 'unknown'];
const SURFACE_NOISE = ['none', 'light', 'moderate', 'heavy', 'severe'];
const CLEANING_OUTCOMES = ['improved', 'no_change', 'worsened', 'unknown'];

const MATERIAL_LABELS = {
  brown_wax: 'brown wax',
  black_wax: 'black wax',
  metallic_soap: 'metallic soap',
  celluloid: 'celluloid',
  condensite: 'condensite',
  unknown: 'unknown',
};

// ------------------------------------------------------------- small helpers

/** Collects per-field validation problems so one response reports all of them. */
class Problems {
  constructor() {
    this.details = {};
  }

  add(field, message) {
    this.details[field] = message;
    return this;
  }

  throwIfAny(message) {
    if (Object.keys(this.details).length) throw ApiError.unprocessable(message, this.details);
  }
}

/** Postgres timestamps rendered exactly the way the JSON encoder renders a Date. */
const ts = (expr) => `to_char(${expr} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const toIso = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

/** Escapes the LIKE metacharacters so a typed `%` searches for a percent sign. */
const likeLiteral = (text) => String(text).replace(/([\\%_])/g, '\\$1');

function requireNumericId(value, what) {
  if (!isNumericId(value)) throw ApiError.notFound(`No such ${what}.`);
  return value;
}

async function resolveCollectionId(value) {
  if (value === undefined || value === null || value === '') {
    const { rows } = await query('SELECT id FROM collections WHERE is_default ORDER BY id LIMIT 1');
    if (!rows.length) throw ApiError.notFound('There is no default collection yet.');
    return rows[0].id;
  }
  const { rows } = await query(
    isNumericId(value)
      ? 'SELECT id FROM collections WHERE id = $1'
      : 'SELECT id FROM collections WHERE slug = $1',
    [value],
  );
  if (!rows.length) throw ApiError.notFound('No such collection.');
  return rows[0].id;
}

// ------------------------------------------------------- item serialisation

/**
 * The catalog half of a CollectionItemSummary, or null for an unmatched copy.
 * Built in the database as jsonb so one round trip returns the whole row;
 * camelKeys turns the snake_case keys into the contract's names.
 */
const RECORD_JSON = `(
  SELECT jsonb_build_object(
    'id', crs.id, 'slug', crs.slug, 'catalog_number', crs.catalog_number,
    'title', crs.title, 'subtitle', crs.subtitle, 'genre', crs.genre,
    'work_type', crs.work_type, 'credit_line', crs.credit_line,
    'performers', crs.performers, 'authors', crs.authors,
    'released_on', crs.released_on::text, 'released_precision', cr.released_precision,
    'release_supplement', crs.release_supplement,
    'recorded_on', crs.recorded_on::text, 'recorded_precision', cr.recorded_precision,
    'description', crs.description, 'confidence', crs.confidence, 'is_stub', crs.is_stub,
    'maker', jsonb_build_object('id', crs.maker_id, 'slug', crs.maker_slug, 'name', crs.maker_name),
    'series', jsonb_build_object('id', crs.series_id, 'slug', crs.series_slug,
                                 'name', crs.series_name, 'material', crs.material,
                                 'play_minutes', crs.play_minutes, 'colour', crs.series_colour),
    'primary_image_url',
      (SELECT '/uploads/' || im.storage_path FROM images im WHERE im.id = crs.primary_image_id),
    'link_count', crs.link_count, 'owned_count', crs.owned_count)
  FROM catalog_record_summary crs
  JOIN catalog_records cr ON cr.id = crs.id
  WHERE crs.id = ci.record_id)`;

const gradeJson = (alias) => `CASE WHEN ${alias}.id IS NULL THEN NULL ELSE jsonb_build_object(
    'id', ${alias}.id, 'code', ${alias}.code, 'label', ${alias}.label, 'score', ${alias}.score,
    'description', ${alias}.description, 'sort_order', ${alias}.sort_order) END`;

const DEFECTS_JSON = `coalesce((
  SELECT jsonb_agg(jsonb_build_object(
    'id', d.id, 'severity', d.severity, 'location', d.location, 'notes', d.notes,
    'is_resolved', d.is_resolved, 'noted_on', d.noted_on::text,
    'defect_type', jsonb_build_object(
      'id', dt.id, 'code', dt.code, 'label', dt.label, 'category', dt.category,
      'description', dt.description, 'care_advice', dt.care_advice,
      'is_terminal', dt.is_terminal, 'sort_order', dt.sort_order))
    ORDER BY dt.sort_order, d.id)
  FROM item_defects d
  JOIN defect_types dt ON dt.id = d.defect_type_id
  WHERE d.item_id = ci.id), '[]'::jsonb)`;

/** Derived, never stored — see the note at the top of this file. */
const CLEANING_JSON = `jsonb_build_object(
  'is_cleaned', coalesce(cic.is_cleaned, false),
  'cleaning_count', coalesce(cic.cleaning_count, 0),
  'last_cleaned_at', ${ts('cic.last_cleaned_at')},
  'last_method', cic.last_cleaning_method,
  'last_notes', cic.last_cleaning_notes)`;

const PRIMARY_IMAGE_URL = `'/uploads/' || coalesce(
  (SELECT i.storage_path FROM images i WHERE i.id = ci.primary_image_id),
  (SELECT i2.storage_path FROM item_images ii JOIN images i2 ON i2.id = ii.image_id
    WHERE ii.item_id = ci.id ORDER BY ii.sort_order, ii.image_id LIMIT 1))`;

const ITEM_COLUMNS = `
  ci.id, ci.collection_id, ci.copy_label,
  ci.unmatched_title, ci.unmatched_maker, ci.unmatched_number,
  coalesce(r.title, ci.unmatched_title) AS display_title,
  ci.acquired_on::text AS acquired_on, ci.acquired_from,
  ci.acquired_price, ci.acquired_currency, ci.estimated_value,
  ci.has_original_box, ci.has_original_lid,
  ci.playback_rating, ci.surface_noise, ci.is_playable,
  ci.storage_location, ci.personal_notes, ci.condition_notes,
  ci.is_favourite, ci.is_for_trade,
  ${RECORD_JSON} AS record,
  ${gradeJson('cg')} AS condition_grade,
  ${gradeJson('bg')} AS box_grade,
  ${CLEANING_JSON} AS cleaning,
  ${DEFECTS_JSON} AS defects,
  ${PRIMARY_IMAGE_URL} AS primary_image_url,
  (SELECT count(*)::int FROM item_images ii WHERE ii.item_id = ci.id) AS image_count,
  ${ts('ci.created_at')} AS created_at,
  ${ts('ci.updated_at')} AS updated_at`;

const ITEM_FROM = `
  FROM collection_items ci
  LEFT JOIN catalog_records r ON r.id = ci.record_id
  LEFT JOIN series s ON s.id = r.series_id
  LEFT JOIN makers m ON m.id = r.maker_id
  LEFT JOIN condition_grades cg ON cg.id = ci.condition_grade_id
  LEFT JOIN condition_grades bg ON bg.id = ci.box_grade_id
  LEFT JOIN collection_item_cleaning cic ON cic.item_id = ci.id`;

async function loadItem(id, client = { query }) {
  const { rows } = await client.query(
    `SELECT ${ITEM_COLUMNS} ${ITEM_FROM} WHERE ci.id = $1`,
    [id],
  );
  return rows.length ? camelKeys(rows[0]) : null;
}

async function loadItemOr404(id, client = { query }) {
  const item = await loadItem(requireNumericId(id, 'collection item'), client);
  if (!item) throw ApiError.notFound('No such collection item.');
  return item;
}

// ------------------------------------------------------------ list filtering

/**
 * Every filter is bound as a parameter and every user-supplied sort or column
 * name is checked against an allowlist before it is anywhere near the SQL.
 */
function buildItemFilters(q, collectionId) {
  const params = [collectionId];
  const clauses = ['ci.collection_id = $1'];
  const bind = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (typeof q.q === 'string' && q.q.trim()) {
    const raw = bind(q.q.trim());
    const like = bind(likeLiteral(q.q.trim()));
    const needle = `'%' || lower(immutable_unaccent(${like})) || '%'`;
    // The three expressions below are written to match the trigram indexes in
    // 0002_search.sql character for character, so the indexes are actually used.
    clauses.push(`(
      (ci.record_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM catalog_search cs
         WHERE cs.record_id = ci.record_id
           AND (cs.document @@ amberola_tsquery(${raw})
                OR cs.haystack LIKE ${needle})))
      OR lower(immutable_unaccent(coalesce(ci.personal_notes, '') || ' ' ||
                                  coalesce(ci.condition_notes, '') || ' ' ||
                                  coalesce(ci.storage_location, '') || ' ' ||
                                  coalesce(ci.unmatched_title, ''))) LIKE ${needle}
      OR EXISTS (
        SELECT 1 FROM cleaning_events ce
         WHERE ce.item_id = ci.id
           AND lower(immutable_unaccent(coalesce(ce.notes, '') || ' ' ||
                                        coalesce(ce.products_used, '') || ' ' ||
                                        coalesce(ce.method_other, ''))) LIKE ${needle}))`);
  }

  const grades = asArray(q.grade);
  if (grades.length) clauses.push(`cg.code = ANY(${bind(grades)}::text[])`);

  const defects = asArray(q.defect);
  if (defects.length) {
    clauses.push(`EXISTS (
      SELECT 1 FROM item_defects d JOIN defect_types dt2 ON dt2.id = d.defect_type_id
       WHERE d.item_id = ci.id AND dt2.code = ANY(${bind(defects)}::text[]))`);
  }

  const seriesKeys = asArray(q.series);
  if (seriesKeys.length) {
    const p = bind(seriesKeys.map(String));
    clauses.push(`(s.slug = ANY(${p}::text[]) OR s.id::text = ANY(${p}::text[]))`);
  }

  const makerKeys = asArray(q.maker);
  if (makerKeys.length) {
    const p = bind(makerKeys.map(String));
    clauses.push(`(m.slug = ANY(${p}::text[]) OR m.id::text = ANY(${p}::text[]))`);
  }

  if (q.material) {
    if (!MATERIALS.includes(q.material)) {
      throw ApiError.badRequest('That is not a cylinder material.', {
        material: `Must be one of: ${MATERIALS.join(', ')}.`,
      });
    }
    clauses.push(`s.material = ${bind(q.material)}::cylinder_material`);
  }

  const cleaned = asBool(q.cleaned);
  if (cleaned === true) clauses.push('coalesce(cic.is_cleaned, false)');
  if (cleaned === false) clauses.push('NOT coalesce(cic.is_cleaned, false)');

  if (asBool(q.needsCleaning) === true) {
    clauses.push("(cic.last_cleaned_at IS NULL OR cic.last_cleaned_at < now() - interval '1 year')");
  }

  const playable = asBool(q.playable);
  if (playable !== undefined) clauses.push(`ci.is_playable = ${bind(playable)}`);

  const favourite = asBool(q.favourite);
  if (favourite !== undefined) clauses.push(`ci.is_favourite = ${bind(favourite)}`);

  const forTrade = asBool(q.forTrade);
  if (forTrade !== undefined) clauses.push(`ci.is_for_trade = ${bind(forTrade)}`);

  return { where: `WHERE ${clauses.join(' AND ')}`, params };
}

/**
 * Sort keys, their expression, and the direction that reads as "natural" for
 * each: newest, best and highest first where that is what a collector means.
 * A `-` prefix reverses whichever direction that is.
 */
const ITEM_SORTS = {
  acquired: { expr: 'ci.acquired_on', descByDefault: true },
  title: { expr: "coalesce(r.title, ci.unmatched_title)", descByDefault: false },
  catalog: { expr: 'r.catalog_sort', descByDefault: false },
  grade: { expr: 'cg.score', descByDefault: true },
  cleaned: { expr: 'cic.last_cleaned_at', descByDefault: true },
  rating: { expr: 'ci.playback_rating', descByDefault: true },
  value: { expr: 'ci.estimated_value', descByDefault: true },
};

function itemOrderBy(sortParam) {
  const { key, desc } = parseSort(sortParam, Object.keys(ITEM_SORTS), 'acquired');
  const spec = ITEM_SORTS[key];
  const descending = spec.descByDefault ? !desc : desc;
  const direction = descending ? 'DESC' : 'ASC';
  return `ORDER BY ${spec.expr} ${direction} NULLS LAST, ci.id ${direction}`;
}

// ------------------------------------------------------------ GET /collection

router.get(
  '/collection',
  asyncHandler(async (req, res) => {
    const collectionId = await resolveCollectionId(req.query.collection);
    const { page, pageSize, offset } = parsePaging(req.query);
    const { where, params } = buildItemFilters(req.query, collectionId);

    const counted = await query(`SELECT count(*)::int AS total ${ITEM_FROM} ${where}`, params);
    const total = counted.rows[0].total;

    const { rows } = await query(
      `SELECT ${ITEM_COLUMNS} ${ITEM_FROM} ${where} ${itemOrderBy(req.query.sort)}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    );

    sendList(res, camelKeys(rows), { page, pageSize, total });
  }),
);

// ------------------------------------------------------ GET /collection/stats

const STATS_SQL = `
WITH scope AS (
  SELECT ci.id, ci.record_id, ci.acquired_price, ci.estimated_value, ci.is_playable,
         ci.condition_grade_id, r.series_id, r.maker_id,
         coalesce(r.released_on, r.recorded_on) AS dated
    FROM collection_items ci
    LEFT JOIN catalog_records r ON r.id = ci.record_id
   WHERE ci.collection_id = $1
),
cleaned AS (
  SELECT ce.item_id,
         count(*) FILTER (WHERE ce.cleaned_at >= date_trunc('year', now())) AS this_year
    FROM cleaning_events ce JOIN scope sc ON sc.id = ce.item_id
   GROUP BY ce.item_id
),
attention AS (
  SELECT DISTINCT d.item_id
    FROM item_defects d
    JOIN defect_types dt ON dt.id = d.defect_type_id
    JOIN scope sc ON sc.id = d.item_id
   WHERE NOT d.is_resolved AND (dt.is_terminal OR d.severity >= 4)
)
SELECT
  (SELECT count(*) FROM scope)                                            AS total_items,
  (SELECT count(*) FROM scope WHERE record_id IS NOT NULL)                AS matched_items,
  (SELECT count(*) FROM scope WHERE record_id IS NULL)                    AS unmatched_items,
  (SELECT count(DISTINCT record_id) FROM scope)                           AS distinct_records,
  (SELECT coalesce(sum(acquired_price), 0) FROM scope)                    AS total_spend,
  (SELECT coalesce(sum(estimated_value), 0) FROM scope)                   AS estimated_value,
  (SELECT count(*) FROM cleaned)                                          AS cleaned,
  (SELECT count(*) FROM cleaned WHERE this_year > 0)                      AS cleaned_this_year,
  (SELECT count(*) FROM attention)                                        AS needs_attention,
  (SELECT count(*) FROM scope WHERE is_playable)                          AS playable_count,
  (SELECT round(avg(cg.score)::numeric, 1) FROM scope
     JOIN condition_grades cg ON cg.id = scope.condition_grade_id)        AS average_grade_score,
  (SELECT count(*) FROM catalog_records)                                  AS catalog_total,
  coalesce((SELECT jsonb_agg(x) FROM (
     SELECT cg.code, cg.label, count(*)::int AS count
       FROM scope JOIN condition_grades cg ON cg.id = scope.condition_grade_id
      GROUP BY cg.code, cg.label, cg.sort_order ORDER BY cg.sort_order) x), '[]'::jsonb) AS by_grade,
  coalesce((SELECT jsonb_agg(x) FROM (
     SELECT s.slug, s.name, count(*)::int AS count
       FROM scope JOIN series s ON s.id = scope.series_id
      GROUP BY s.slug, s.name ORDER BY count(*) DESC, s.name) x), '[]'::jsonb) AS by_series,
  coalesce((SELECT jsonb_agg(x) FROM (
     SELECT mk.slug, mk.name, count(*)::int AS count
       FROM scope JOIN makers mk ON mk.id = scope.maker_id
      GROUP BY mk.slug, mk.name ORDER BY count(*) DESC, mk.name) x), '[]'::jsonb) AS by_maker,
  coalesce((SELECT jsonb_agg(x) FROM (
     SELECT (extract(year FROM dated)::int / 10) * 10 AS decade, count(*)::int AS count
       FROM scope WHERE dated IS NOT NULL GROUP BY 1 ORDER BY 1) x), '[]'::jsonb) AS by_decade,
  coalesce((SELECT jsonb_agg(x) FROM (
     SELECT dt.code, dt.label, count(*)::int AS count
       FROM item_defects d
       JOIN defect_types dt ON dt.id = d.defect_type_id
       JOIN scope sc ON sc.id = d.item_id
      GROUP BY dt.code, dt.label ORDER BY count(*) DESC, dt.label LIMIT 10) x), '[]'::jsonb) AS top_defects`;

router.get(
  '/collection/stats',
  asyncHandler(async (req, res) => {
    const collectionId = await resolveCollectionId(req.query.collection);

    const [aggregate, recentlyAcquired, recentlyCleaned] = await Promise.all([
      query(STATS_SQL, [collectionId]),
      query(
        `SELECT ${ITEM_COLUMNS} ${ITEM_FROM}
          WHERE ci.collection_id = $1
          ORDER BY ci.acquired_on DESC NULLS LAST, ci.id DESC LIMIT 5`,
        [collectionId],
      ),
      query(
        `SELECT ${ITEM_COLUMNS} ${ITEM_FROM}
          WHERE ci.collection_id = $1 AND cic.last_cleaned_at IS NOT NULL
          ORDER BY cic.last_cleaned_at DESC LIMIT 5`,
        [collectionId],
      ),
    ]);

    const a = aggregate.rows[0];
    const totalItems = Number(a.total_items);
    const unmatched = Number(a.unmatched_items);
    const distinctRecords = Number(a.distinct_records);
    // An unmatched copy is its own title: there is nothing in the catalog to
    // collapse it against. Catalog coverage, by contrast, can only count the
    // copies that are matched to a catalog entry.
    const distinctTitles = distinctRecords + unmatched;
    const catalogTotal = Number(a.catalog_total);

    sendOne(res, {
      totalItems,
      matchedItems: Number(a.matched_items),
      unmatchedItems: unmatched,
      distinctTitles,
      duplicates: totalItems - distinctTitles,
      totalSpend: Number(a.total_spend),
      estimatedValue: Number(a.estimated_value),
      cleaned: Number(a.cleaned),
      neverCleaned: totalItems - Number(a.cleaned),
      cleanedThisYear: Number(a.cleaned_this_year),
      needsAttention: Number(a.needs_attention),
      playableCount: Number(a.playable_count),
      averageGradeScore: a.average_grade_score === null ? null : Number(a.average_grade_score),
      byGrade: a.by_grade,
      bySeries: a.by_series,
      byMaker: a.by_maker,
      byDecade: a.by_decade,
      topDefects: a.top_defects,
      recentlyAcquired: camelKeys(recentlyAcquired.rows),
      recentlyCleaned: camelKeys(recentlyCleaned.rows),
      catalogCoverage: {
        catalogTotal,
        owned: distinctRecords,
        percent: catalogTotal ? Math.round((distinctRecords / catalogTotal) * 1000) / 10 : 0,
      },
    });
  }),
);

// ------------------------------------------------------- GET /collection/:id

router.get(
  '/collection/:id',
  asyncHandler(async (req, res) => {
    const item = await loadItemOr404(req.params.id);
    const [images, cleanings, playEvents] = await Promise.all([
      loadItemImages(item.id),
      loadCleanings(item.id),
      loadPlays(item.id),
    ]);
    sendOne(res, { ...item, images, cleanings, playEvents });
  }),
);

// ------------------------------------------------------ POST/PATCH/DELETE

const ITEM_WRITABLE = [
  'record_id',
  'unmatched_title',
  'unmatched_maker',
  'unmatched_number',
  'copy_label',
  'acquired_on',
  'acquired_from',
  'acquired_price',
  'acquired_currency',
  'estimated_value',
  'condition_grade_id',
  'box_grade_id',
  'has_original_box',
  'has_original_lid',
  'playback_rating',
  'surface_noise',
  'is_playable',
  'storage_location',
  'personal_notes',
  'condition_notes',
  'is_favourite',
  'is_for_trade',
];

async function resolveRecordId(body) {
  if (body.recordSlug) {
    const { rows } = await query('SELECT id FROM catalog_records WHERE slug = $1', [body.recordSlug]);
    if (!rows.length) {
      throw ApiError.unprocessable('No catalog record has that slug.', {
        recordSlug: 'Unknown catalog record.',
      });
    }
    return rows[0].id;
  }
  return undefined;
}

function validateItemColumns(columns, problems) {
  if (columns.surface_noise != null && !SURFACE_NOISE.includes(columns.surface_noise)) {
    problems.add('surfaceNoise', `Must be one of: ${SURFACE_NOISE.join(', ')}.`);
  }
  if (columns.playback_rating != null) {
    const n = Number(columns.playback_rating);
    if (!Number.isInteger(n) || n < 1 || n > 5) problems.add('playbackRating', 'Must be 1 to 5.');
  }
  for (const money of ['acquired_price', 'estimated_value']) {
    if (columns[money] != null && !Number.isFinite(Number(columns[money]))) {
      problems.add(money === 'acquired_price' ? 'acquiredPrice' : 'estimatedValue', 'Must be a number.');
    }
  }
  if (columns.acquired_currency != null && String(columns.acquired_currency).length > 8) {
    problems.add('acquiredCurrency', 'Currency codes are at most 8 characters.');
  }
  return problems;
}

function validateDefectInput(defect, problems, prefix) {
  const typeId = defect.defectTypeId ?? defect.defect_type_id;
  if (typeId === undefined || typeId === null || !Number.isFinite(Number(typeId))) {
    problems.add(`${prefix}.defectTypeId`, 'A defect type id is required.');
  }
  if (defect.severity !== undefined && defect.severity !== null) {
    const n = Number(defect.severity);
    if (!Number.isInteger(n) || n < 1 || n > 5) problems.add(`${prefix}.severity`, 'Must be 1 to 5.');
  }
  return {
    defect_type_id: typeId,
    severity: defect.severity ?? 2,
    location: defect.location ?? null,
    notes: defect.notes ?? null,
    noted_on: defect.notedOn ?? defect.noted_on ?? null,
    is_resolved: defect.isResolved ?? defect.is_resolved ?? false,
  };
}

async function insertDefects(client, itemId, defects) {
  for (const d of defects) {
    await client.query(
      `INSERT INTO item_defects (item_id, defect_type_id, severity, location, notes, noted_on, is_resolved)
       VALUES ($1, $2, $3, $4, $5, coalesce($6::date, current_date), $7)`,
      [itemId, d.defect_type_id, d.severity, d.location, d.notes, d.noted_on, d.is_resolved],
    );
  }
}

router.post(
  '/collection',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const problems = new Problems();

    const collectionId = await resolveCollectionId(body.collectionSlug ?? body.collectionId);
    const columns = pickColumns(body, ITEM_WRITABLE);

    const slugRecordId = await resolveRecordId(body);
    if (slugRecordId !== undefined) columns.record_id = slugRecordId;

    if (columns.record_id == null && !columns.unmatched_title) {
      problems.add(
        'unmatchedTitle',
        'Give a recordId (or recordSlug), or a title for the unidentified copy.',
      );
    }
    validateItemColumns(columns, problems);

    const rawDefects = Array.isArray(body.defects) ? body.defects : [];
    const defects = rawDefects.map((d, i) => validateDefectInput(d, problems, `defects[${i}]`));
    problems.throwIfAny('That copy could not be added.');

    columns.collection_id = collectionId;

    const id = await transaction(async (client) => {
      const keys = Object.keys(columns);
      const { rows } = await client.query(
        `INSERT INTO collection_items (${keys.join(', ')})
         VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        keys.map((k) => columns[k]),
      );
      await insertDefects(client, rows[0].id, defects);
      return rows[0].id;
    });

    sendOne(res, await loadItem(id), 201);
  }),
);

router.patch(
  '/collection/:id',
  asyncHandler(async (req, res) => {
    const id = requireNumericId(req.params.id, 'collection item');
    const body = req.body ?? {};
    const problems = new Problems();

    const columns = pickColumns(body, ITEM_WRITABLE);
    const slugRecordId = await resolveRecordId(body);
    if (slugRecordId !== undefined) columns.record_id = slugRecordId;

    if (body.collectionSlug !== undefined || body.collectionId !== undefined) {
      columns.collection_id = await resolveCollectionId(body.collectionSlug ?? body.collectionId);
    }
    validateItemColumns(columns, problems);
    problems.throwIfAny('That copy could not be updated.');

    if (!Object.keys(columns).length) return sendOne(res, await loadItemOr404(id));

    const { clause, values } = buildUpdate(columns, 2);
    const { rowCount } = await query(
      `UPDATE collection_items SET ${clause} WHERE id = $1`,
      [id, ...values],
    );
    if (!rowCount) throw ApiError.notFound('No such collection item.');

    sendOne(res, await loadItem(id));
  }),
);

router.delete(
  '/collection/:id',
  asyncHandler(async (req, res) => {
    const id = requireNumericId(req.params.id, 'collection item');

    // Deleting the row cascades its defects, cleaning log, play log and image
    // links. The image *rows* do not cascade, so any photograph that belonged
    // only to this copy is removed here and its files unlinked after commit.
    const orphaned = await transaction(async (client) => {
      const exists = await client.query('SELECT id FROM collection_items WHERE id = $1 FOR UPDATE', [id]);
      if (!exists.rows.length) throw ApiError.notFound('No such collection item.');

      const { rows } = await client.query(
        `SELECT i.id, i.storage_path
           FROM item_images ii
           JOIN images i ON i.id = ii.image_id
          WHERE ii.item_id = $1
            AND NOT EXISTS (SELECT 1 FROM item_images o WHERE o.image_id = i.id AND o.item_id <> $1)
            AND NOT EXISTS (SELECT 1 FROM record_images ri WHERE ri.image_id = i.id)`,
        [id],
      );

      await client.query('DELETE FROM collection_items WHERE id = $1', [id]);
      if (rows.length) {
        await client.query('DELETE FROM images WHERE id = ANY($1::bigint[])', [rows.map((r) => r.id)]);
      }
      return rows.map((r) => r.storage_path);
    });

    await unlinkStoredFiles(orphaned);
    res.status(204).end();
  }),
);

// -------------------------------------------------------------------- defects

const DEFECT_SELECT = `
  SELECT jsonb_build_object(
    'id', d.id, 'severity', d.severity, 'location', d.location, 'notes', d.notes,
    'is_resolved', d.is_resolved, 'noted_on', d.noted_on::text,
    'defect_type', jsonb_build_object(
      'id', dt.id, 'code', dt.code, 'label', dt.label, 'category', dt.category,
      'description', dt.description, 'care_advice', dt.care_advice,
      'is_terminal', dt.is_terminal, 'sort_order', dt.sort_order)) AS defect
    FROM item_defects d JOIN defect_types dt ON dt.id = d.defect_type_id`;

async function loadDefects(itemId, client = { query }) {
  const { rows } = await client.query(
    `${DEFECT_SELECT} WHERE d.item_id = $1 ORDER BY dt.sort_order, d.id`,
    [itemId],
  );
  return camelKeys(rows.map((r) => r.defect));
}

async function loadDefect(defectId, client = { query }) {
  const { rows } = await client.query(`${DEFECT_SELECT} WHERE d.id = $1`, [defectId]);
  return rows.length ? camelKeys(rows[0].defect) : null;
}

async function assertItemExists(id, client = { query }) {
  const { rows } = await client.query('SELECT id FROM collection_items WHERE id = $1', [id]);
  if (!rows.length) throw ApiError.notFound('No such collection item.');
  return rows[0].id;
}

router.put(
  '/collection/:id/defects',
  asyncHandler(async (req, res) => {
    const id = requireNumericId(req.params.id, 'collection item');
    const problems = new Problems();
    const incoming = Array.isArray(req.body?.defects) ? req.body.defects : null;
    if (!incoming) {
      throw ApiError.unprocessable('Send the whole set as { "defects": [ … ] }.', {
        defects: 'Expected an array.',
      });
    }
    const defects = incoming.map((d, i) => validateDefectInput(d, problems, `defects[${i}]`));
    problems.throwIfAny('Those defects could not be recorded.');

    await transaction(async (client) => {
      await assertItemExists(id, client);
      await client.query('DELETE FROM item_defects WHERE item_id = $1', [id]);
      await insertDefects(client, id, defects);
    });

    sendOne(res, await loadDefects(id));
  }),
);

router.post(
  '/collection/:id/defects',
  asyncHandler(async (req, res) => {
    const id = requireNumericId(req.params.id, 'collection item');
    const problems = new Problems();
    const defect = validateDefectInput(req.body ?? {}, problems, 'defect');
    problems.throwIfAny('That defect could not be recorded.');

    const newId = await transaction(async (client) => {
      await assertItemExists(id, client);
      const { rows } = await client.query(
        `INSERT INTO item_defects (item_id, defect_type_id, severity, location, notes, noted_on, is_resolved)
         VALUES ($1, $2, $3, $4, $5, coalesce($6::date, current_date), $7) RETURNING id`,
        [id, defect.defect_type_id, defect.severity, defect.location, defect.notes, defect.noted_on, defect.is_resolved],
      );
      return rows[0].id;
    });

    sendOne(res, await loadDefect(newId), 201);
  }),
);

const DEFECT_WRITABLE = ['defect_type_id', 'severity', 'location', 'notes', 'noted_on', 'is_resolved'];

router.patch(
  '/defects/:defectId',
  asyncHandler(async (req, res) => {
    const id = requireNumericId(req.params.defectId, 'defect');
    const columns = pickColumns(req.body ?? {}, DEFECT_WRITABLE);
    const problems = new Problems();
    if (columns.severity != null) {
      const n = Number(columns.severity);
      if (!Number.isInteger(n) || n < 1 || n > 5) problems.add('severity', 'Must be 1 to 5.');
    }
    problems.throwIfAny('That defect could not be updated.');

    if (Object.keys(columns).length) {
      const { clause, values } = buildUpdate(columns, 2);
      const { rowCount } = await query(`UPDATE item_defects SET ${clause} WHERE id = $1`, [id, ...values]);
      if (!rowCount) throw ApiError.notFound('No such defect.');
    }

    const defect = await loadDefect(id);
    if (!defect) throw ApiError.notFound('No such defect.');
    sendOne(res, defect);
  }),
);

router.delete(
  '/defects/:defectId',
  asyncHandler(async (req, res) => {
    const { rowCount } = await query('DELETE FROM item_defects WHERE id = $1', [
      requireNumericId(req.params.defectId, 'defect'),
    ]);
    if (!rowCount) throw ApiError.notFound('No such defect.');
    res.status(204).end();
  }),
);

// --------------------------------------------------------------- cleaning log

const CLEANING_WRITABLE = [
  'cleaned_at',
  'method_id',
  'method_other',
  'products_used',
  'performed_by',
  'duration_minutes',
  'outcome',
  'notes',
  'before_image_id',
  'after_image_id',
];

/**
 * The material a copy is made of, resolved through its catalog entry's series.
 * An unmatched copy has no known material, and so can never raise a warning.
 */
async function materialForItem(itemId, client = { query }) {
  const { rows } = await client.query(
    `SELECT s.material
       FROM collection_items ci
       JOIN catalog_records r ON r.id = ci.record_id
       JOIN series s ON s.id = r.series_id
      WHERE ci.id = $1`,
    [itemId],
  );
  return rows.length ? rows[0].material : null;
}

/**
 * The point of the cleaning log. `cleaning_methods.safe_for` lists the
 * materials a method suits; anything else is the wax-versus-celluloid mistake
 * this register exists partly to prevent. Returns warnings, never an error —
 * the collector may be recording a cleaning they have already carried out.
 */
async function safetyWarnings(itemId, methodId, client = { query }) {
  if (!methodId) return [];
  const material = await materialForItem(itemId, client);
  if (!material) return [];

  // safe_for is `cylinder_material[]`; pg has no parser for an enum array, so
  // it is cast to text[] to arrive as a JS array rather than as `{a,b,c}`.
  const { rows } = await client.query(
    'SELECT label, safe_for::text[] AS safe_for FROM cleaning_methods WHERE id = $1',
    [methodId],
  );
  if (!rows.length) return [];
  const { label, safe_for: safeFor } = rows[0];
  if (Array.isArray(safeFor) && safeFor.includes(material)) return [];

  return [
    {
      code: 'method_unsafe_for_material',
      message:
        material === 'unknown'
          ? `${label} is not a safe treatment for a cylinder of unknown material.`
          : `${label} is not a safe treatment for a ${MATERIAL_LABELS[material]} cylinder.`,
    },
  ];
}

async function loadCleanings(itemId, client = { query }) {
  const { rows } = await client.query(
    `SELECT ce.id, ce.cleaned_at, ce.method_other, ce.products_used, ce.performed_by,
            ce.duration_minutes, ce.outcome, ce.notes, ce.created_at,
            ce.before_image_id, ce.after_image_id,
            cm.id AS m_id, cm.code AS m_code, cm.label AS m_label, cm.description AS m_description,
            cm.safe_for::text[] AS m_safe_for, cm.is_risky AS m_is_risky, cm.sort_order AS m_sort_order
       FROM cleaning_events ce
       LEFT JOIN cleaning_methods cm ON cm.id = ce.method_id
      WHERE ce.item_id = $1
      ORDER BY ce.cleaned_at DESC, ce.id DESC`,
    [itemId],
  );
  return decorateCleanings(rows, client);
}

async function loadCleaning(cleaningId, client = { query }) {
  const { rows } = await client.query(
    `SELECT ce.id, ce.cleaned_at, ce.method_other, ce.products_used, ce.performed_by,
            ce.duration_minutes, ce.outcome, ce.notes, ce.created_at,
            ce.before_image_id, ce.after_image_id,
            cm.id AS m_id, cm.code AS m_code, cm.label AS m_label, cm.description AS m_description,
            cm.safe_for::text[] AS m_safe_for, cm.is_risky AS m_is_risky, cm.sort_order AS m_sort_order
       FROM cleaning_events ce
       LEFT JOIN cleaning_methods cm ON cm.id = ce.method_id
      WHERE ce.id = $1`,
    [cleaningId],
  );
  const [event] = await decorateCleanings(rows, client);
  return event ?? null;
}

/** Attaches the method object and any before/after photographs. */
async function decorateCleanings(rows, client = { query }) {
  const imageIds = [
    ...new Set(rows.flatMap((r) => [r.before_image_id, r.after_image_id]).filter(Boolean)),
  ];
  const images = new Map();
  if (imageIds.length) {
    const found = await client.query(`SELECT ${IMAGE_COLUMNS} FROM images i WHERE i.id = ANY($1::bigint[])`, [
      imageIds,
    ]);
    for (const row of found.rows) images.set(row.id, serializeImage(row));
  }

  return rows.map((r) => ({
    id: r.id,
    cleanedAt: toIso(r.cleaned_at),
    method: r.m_id
      ? {
          id: r.m_id,
          code: r.m_code,
          label: r.m_label,
          description: r.m_description,
          safeFor: r.m_safe_for,
          isRisky: r.m_is_risky,
          sortOrder: r.m_sort_order,
        }
      : null,
    methodOther: r.method_other,
    productsUsed: r.products_used,
    performedBy: r.performed_by,
    durationMinutes: r.duration_minutes,
    outcome: r.outcome,
    notes: r.notes,
    beforeImage: images.get(r.before_image_id) ?? null,
    afterImage: images.get(r.after_image_id) ?? null,
    createdAt: toIso(r.created_at),
  }));
}

function validateCleaningColumns(columns, problems) {
  if (columns.outcome != null && !CLEANING_OUTCOMES.includes(columns.outcome)) {
    problems.add('outcome', `Must be one of: ${CLEANING_OUTCOMES.join(', ')}.`);
  }
  if (columns.duration_minutes != null) {
    const n = Number(columns.duration_minutes);
    if (!Number.isInteger(n) || n < 0) problems.add('durationMinutes', 'Must be a whole number of minutes.');
  }
  return problems;
}

router.get(
  '/collection/:id/cleanings',
  asyncHandler(async (req, res) => {
    const id = requireNumericId(req.params.id, 'collection item');
    await assertItemExists(id);
    sendOne(res, await loadCleanings(id));
  }),
);

router.post(
  '/collection/:id/cleanings',
  asyncHandler(async (req, res) => {
    const id = requireNumericId(req.params.id, 'collection item');
    const columns = pickColumns(req.body ?? {}, CLEANING_WRITABLE);
    const problems = new Problems();

    if (columns.method_id == null && !columns.method_other) {
      problems.add('methodId', 'Give a methodId, or describe the method in methodOther.');
    }
    validateCleaningColumns(columns, problems);
    problems.throwIfAny('That cleaning could not be logged.');

    const created = await transaction(async (client) => {
      await assertItemExists(id, client);
      if (columns.method_id != null) {
        const method = await client.query('SELECT id FROM cleaning_methods WHERE id = $1', [columns.method_id]);
        if (!method.rows.length) {
          throw ApiError.unprocessable('No such cleaning method.', { methodId: 'Unknown method.' });
        }
      }
      const keys = ['item_id', ...Object.keys(columns)];
      const values = [id, ...Object.keys(columns).map((k) => columns[k])];
      const { rows } = await client.query(
        `INSERT INTO cleaning_events (${keys.join(', ')})
         VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id, method_id`,
        values,
      );
      return rows[0];
    });

    const warnings = await safetyWarnings(id, created.method_id);
    sendOne(res, await loadCleaning(created.id), 201, warnings.length ? { warnings } : {});
  }),
);

router.patch(
  '/cleanings/:cleaningId',
  asyncHandler(async (req, res) => {
    const id = requireNumericId(req.params.cleaningId, 'cleaning event');
    const columns = pickColumns(req.body ?? {}, CLEANING_WRITABLE);
    const problems = new Problems();
    validateCleaningColumns(columns, problems);
    problems.throwIfAny('That cleaning could not be updated.');

    const row = await transaction(async (client) => {
      const found = await client.query('SELECT item_id, method_id, method_other FROM cleaning_events WHERE id = $1', [id]);
      if (!found.rows.length) throw ApiError.notFound('No such cleaning event.');

      const after = { ...found.rows[0], ...columns };
      if (after.method_id == null && !after.method_other) {
        throw ApiError.unprocessable('A cleaning event must keep a method.', {
          methodId: 'Give a methodId, or describe the method in methodOther.',
        });
      }

      if (Object.keys(columns).length) {
        const { clause, values } = buildUpdate(columns, 2);
        await client.query(`UPDATE cleaning_events SET ${clause} WHERE id = $1`, [id, ...values]);
      }
      return after;
    });

    const warnings = await safetyWarnings(row.item_id, row.method_id);
    sendOne(res, await loadCleaning(id), 200, warnings.length ? { warnings } : {});
  }),
);

router.delete(
  '/cleanings/:cleaningId',
  asyncHandler(async (req, res) => {
    const { rowCount } = await query('DELETE FROM cleaning_events WHERE id = $1', [
      requireNumericId(req.params.cleaningId, 'cleaning event'),
    ]);
    if (!rowCount) throw ApiError.notFound('No such cleaning event.');
    res.status(204).end();
  }),
);

// ------------------------------------------------------------------- play log

const PLAY_WRITABLE = ['played_at', 'machine', 'stylus', 'notes'];

async function loadPlays(itemId, client = { query }) {
  const { rows } = await client.query(
    `SELECT id, ${ts('played_at')} AS played_at, machine, stylus, notes
       FROM play_events WHERE item_id = $1 ORDER BY played_at DESC, id DESC`,
    [itemId],
  );
  return camelKeys(rows);
}

router.get(
  '/collection/:id/plays',
  asyncHandler(async (req, res) => {
    const id = requireNumericId(req.params.id, 'collection item');
    await assertItemExists(id);
    sendOne(res, await loadPlays(id));
  }),
);

router.post(
  '/collection/:id/plays',
  asyncHandler(async (req, res) => {
    const id = requireNumericId(req.params.id, 'collection item');
    const columns = pickColumns(req.body ?? {}, PLAY_WRITABLE);

    const newId = await transaction(async (client) => {
      await assertItemExists(id, client);
      const keys = ['item_id', ...Object.keys(columns)];
      const values = [id, ...Object.keys(columns).map((k) => columns[k])];
      const { rows } = await client.query(
        `INSERT INTO play_events (${keys.join(', ')})
         VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        values,
      );
      return rows[0].id;
    });

    const { rows } = await query(
      `SELECT id, ${ts('played_at')} AS played_at, machine, stylus, notes FROM play_events WHERE id = $1`,
      [newId],
    );
    sendOne(res, camelKeys(rows[0]), 201);
  }),
);

router.delete(
  '/plays/:playId',
  asyncHandler(async (req, res) => {
    const { rowCount } = await query('DELETE FROM play_events WHERE id = $1', [
      requireNumericId(req.params.playId, 'play event'),
    ]);
    if (!rowCount) throw ApiError.notFound('No such play event.');
    res.status(204).end();
  }),
);

// -------------------------------------------------------------------- wishlist

const WISHLIST_WRITABLE = ['record_id', 'free_text', 'priority', 'max_price', 'notes'];

const WISHLIST_SELECT = `
  SELECT w.id, w.collection_id, w.free_text, w.priority, w.max_price, w.notes,
         ${ts('w.created_at')} AS created_at,
         (SELECT jsonb_build_object(
            'id', crs.id, 'slug', crs.slug, 'catalog_number', crs.catalog_number,
            'title', crs.title, 'subtitle', crs.subtitle, 'genre', crs.genre,
            'performers', crs.performers, 'authors', crs.authors,
            'released_on', crs.released_on::text,
            'maker', jsonb_build_object('id', crs.maker_id, 'slug', crs.maker_slug, 'name', crs.maker_name),
            'series', jsonb_build_object('id', crs.series_id, 'slug', crs.series_slug,
                                         'name', crs.series_name, 'material', crs.material,
                                         'play_minutes', crs.play_minutes, 'colour', crs.series_colour),
            'owned_count', crs.owned_count)
            FROM catalog_record_summary crs WHERE crs.id = w.record_id) AS record,
         coalesce((SELECT crs2.title FROM catalog_record_summary crs2 WHERE crs2.id = w.record_id),
                  w.free_text) AS display_title
    FROM wishlist_items w`;

router.get(
  '/wishlist',
  asyncHandler(async (req, res) => {
    const collectionId = await resolveCollectionId(req.query.collection);
    const { page, pageSize, offset } = parsePaging(req.query);

    const counted = await query('SELECT count(*)::int AS total FROM wishlist_items WHERE collection_id = $1', [
      collectionId,
    ]);
    const { rows } = await query(
      `${WISHLIST_SELECT} WHERE w.collection_id = $1
       ORDER BY w.priority ASC, w.created_at DESC LIMIT $2 OFFSET $3`,
      [collectionId, pageSize, offset],
    );

    sendList(res, camelKeys(rows), { page, pageSize, total: counted.rows[0].total });
  }),
);

function validateWishlist(columns, problems) {
  if (columns.priority != null) {
    const n = Number(columns.priority);
    if (!Number.isInteger(n) || n < 1 || n > 5) problems.add('priority', 'Must be 1 to 5.');
  }
  if (columns.max_price != null && !Number.isFinite(Number(columns.max_price))) {
    problems.add('maxPrice', 'Must be a number.');
  }
  return problems;
}

router.post(
  '/wishlist',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const collectionId = await resolveCollectionId(body.collectionSlug ?? body.collectionId);
    const columns = pickColumns(body, WISHLIST_WRITABLE);

    const slugRecordId = await resolveRecordId(body);
    if (slugRecordId !== undefined) columns.record_id = slugRecordId;

    const problems = new Problems();
    if (columns.record_id == null && !columns.free_text) {
      problems.add('freeText', 'Give a recordId, or describe the title you are hunting for.');
    }
    validateWishlist(columns, problems);
    problems.throwIfAny('That wish could not be added.');

    columns.collection_id = collectionId;
    const keys = Object.keys(columns);
    const { rows } = await query(
      `INSERT INTO wishlist_items (${keys.join(', ')})
       VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      keys.map((k) => columns[k]),
    );

    const created = await query(`${WISHLIST_SELECT} WHERE w.id = $1`, [rows[0].id]);
    sendOne(res, camelKeys(created.rows[0]), 201);
  }),
);

router.patch(
  '/wishlist/:id',
  asyncHandler(async (req, res) => {
    const id = requireNumericId(req.params.id, 'wishlist entry');
    const columns = pickColumns(req.body ?? {}, WISHLIST_WRITABLE);
    const slugRecordId = await resolveRecordId(req.body ?? {});
    if (slugRecordId !== undefined) columns.record_id = slugRecordId;

    const problems = new Problems();
    validateWishlist(columns, problems);
    problems.throwIfAny('That wish could not be updated.');

    if (Object.keys(columns).length) {
      const { clause, values } = buildUpdate(columns, 2);
      const { rowCount } = await query(`UPDATE wishlist_items SET ${clause} WHERE id = $1`, [id, ...values]);
      if (!rowCount) throw ApiError.notFound('No such wishlist entry.');
    }

    const { rows } = await query(`${WISHLIST_SELECT} WHERE w.id = $1`, [id]);
    if (!rows.length) throw ApiError.notFound('No such wishlist entry.');
    sendOne(res, camelKeys(rows[0]));
  }),
);

router.delete(
  '/wishlist/:id',
  asyncHandler(async (req, res) => {
    const { rowCount } = await query('DELETE FROM wishlist_items WHERE id = $1', [
      requireNumericId(req.params.id, 'wishlist entry'),
    ]);
    if (!rowCount) throw ApiError.notFound('No such wishlist entry.');
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------------- export

const CSV_COLUMNS = [
  ['id', (i) => i.id],
  ['displayTitle', (i) => i.displayTitle],
  ['catalogNumber', (i) => i.record?.catalogNumber ?? i.unmatchedNumber],
  ['maker', (i) => i.record?.maker?.name ?? i.unmatchedMaker],
  ['series', (i) => i.record?.series?.name],
  ['material', (i) => i.record?.series?.material],
  ['copyLabel', (i) => i.copyLabel],
  ['acquiredOn', (i) => i.acquiredOn],
  ['acquiredFrom', (i) => i.acquiredFrom],
  ['acquiredPrice', (i) => i.acquiredPrice],
  ['acquiredCurrency', (i) => i.acquiredCurrency],
  ['estimatedValue', (i) => i.estimatedValue],
  ['conditionGrade', (i) => i.conditionGrade?.code],
  ['boxGrade', (i) => i.boxGrade?.code],
  ['hasOriginalBox', (i) => i.hasOriginalBox],
  ['hasOriginalLid', (i) => i.hasOriginalLid],
  ['playbackRating', (i) => i.playbackRating],
  ['surfaceNoise', (i) => i.surfaceNoise],
  ['isPlayable', (i) => i.isPlayable],
  ['storageLocation', (i) => i.storageLocation],
  ['isFavourite', (i) => i.isFavourite],
  ['isForTrade', (i) => i.isForTrade],
  ['defects', (i) => i.defects.map((d) => d.defectType.code).join('; ')],
  ['cleaningCount', (i) => i.cleaning.cleaningCount],
  ['lastCleanedAt', (i) => i.cleaning.lastCleanedAt],
  ['lastCleaningMethod', (i) => i.cleaning.lastMethod],
  ['personalNotes', (i) => i.personalNotes],
  ['conditionNotes', (i) => i.conditionNotes],
];

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /["\n\r,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

router.get(
  '/export/collection',
  asyncHandler(async (req, res) => {
    const format = (req.query.format || 'json').toString().toLowerCase();
    if (!['json', 'csv'].includes(format)) {
      throw ApiError.badRequest('Export format must be json or csv.', { format: 'Unsupported format.' });
    }

    const collectionId = await resolveCollectionId(req.query.collection);
    const { where, params } = buildItemFilters(req.query, collectionId);
    const { rows } = await query(
      `SELECT ${ITEM_COLUMNS} ${ITEM_FROM} ${where} ${itemOrderBy(req.query.sort)}`,
      params,
    );
    const items = camelKeys(rows);
    const stamp = new Date().toISOString().slice(0, 10);

    if (format === 'csv') {
      const lines = [CSV_COLUMNS.map(([name]) => name).join(',')];
      for (const item of items) lines.push(CSV_COLUMNS.map(([, get]) => csvCell(get(item))).join(','));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="collection-${stamp}.csv"`);
      return res.send(`${lines.join('\n')}\n`);
    }

    res.setHeader('Content-Disposition', `attachment; filename="collection-${stamp}.json"`);
    sendOne(res, items, 200, { count: items.length, exportedAt: new Date().toISOString() });
  }),
);

export default router;

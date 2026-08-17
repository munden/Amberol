/**
 * The wiki half of the register: makers, series and people.
 *
 * All three are the same kind of page — long-form prose, outbound links, and
 * the catalog records that belong to them — so they are described here as
 * three configurations of one set of handlers rather than three copies of it.
 *
 * Contract: docs/API.md, "Makers, series, people".
 */

import { Router } from 'express';
import { query, transaction } from '../lib/db.js';
import {
  ApiError,
  asyncHandler,
  sendOne,
  sendList,
  parsePaging,
  parseSort,
  camelKeys,
  pickColumns,
  buildUpdate,
  slugify,
  isNumericId,
} from '../lib/http.js';
import {
  Params,
  SUMMARY_COLUMNS,
  SUMMARY_FROM,
  toSummary,
  toMakerDetail,
  toSeriesDetail,
  uniqueSlug,
  writeRevision,
  diffFields,
  auditFrom,
} from './catalog.js';

const router = Router();

// ============================================================== entity shapes

function toPerson(row, links = []) {
  if (!row) return null;
  const r = camelKeys(row);
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    fullName: r.fullName ?? null,
    sortName: r.sortName ?? null,
    aliases: r.aliases ?? [],
    isGroup: Boolean(r.isGroup),
    birthYear: r.birthYear ?? null,
    deathYear: r.deathYear ?? null,
    nationality: r.nationality ?? null,
    voiceOrInstrument: r.voiceOrInstrument ?? null,
    summary: r.summary ?? null,
    biography: r.biography ?? null,
    notes: r.notes ?? null,
    links,
    recordCount: Number(r.recordCount ?? 0),
    createdAt: r.createdAt ?? null,
    updatedAt: r.updatedAt ?? null,
  };
}

/** All the outbound links for a set of entities of one type, grouped by id. */
async function linksByEntity(entityType, ids) {
  const grouped = new Map(ids.map((id) => [Number(id), []]));
  if (!ids.length) return grouped;
  const { rows } = await query(
    `SELECT entity_id, id, kind, label, url, NULL::text AS source_name
       FROM entity_links
      WHERE entity_type = $1 AND entity_id = ANY($2::bigint[])
      ORDER BY sort_order, id`,
    [entityType, ids.map(Number)],
  );
  for (const row of rows) {
    const { entity_id: entityId, ...link } = row;
    grouped.get(Number(entityId))?.push(camelKeys(link));
  }
  return grouped;
}

// ========================================================= entity definitions

/**
 * One entry per wiki entity. `select` is the list/detail projection,
 * `searchable` is the text a `q` is matched against, and `recordsWhere` finds
 * the catalog records the page should list.
 */
const ENTITIES = {
  makers: {
    path: 'makers',
    table: 'makers',
    entityType: 'maker',
    label: 'maker',
    columns: [
      'slug', 'name', 'short_name', 'country', 'city',
      'founded_year', 'dissolved_year', 'summary', 'history', 'notes', 'logo_image_id',
    ],
    select: `e.*, (SELECT count(*)::int FROM catalog_records cr WHERE cr.maker_id = e.id) AS record_count`,
    from: 'FROM makers e',
    searchable: `concat_ws(' ', e.name, e.short_name, e.country, e.city, e.summary)`,
    nameOrder: 'immutable_unaccent(lower(e.name))',
    recordsWhere: 'v.maker_id = $1',
    shape: toMakerDetail,
  },

  series: {
    path: 'series',
    table: 'series',
    entityType: 'series',
    label: 'series',
    columns: [
      'slug', 'maker_id', 'name', 'play_minutes', 'material', 'threads_per_inch',
      'colour', 'introduced_year', 'discontinued_year', 'summary', 'description', 'notes',
    ],
    select: `e.*, (SELECT count(*)::int FROM catalog_records cr WHERE cr.series_id = e.id) AS record_count,
             mk.id AS m_id, mk.slug AS m_slug, mk.name AS m_name`,
    from: 'FROM series e JOIN makers mk ON mk.id = e.maker_id',
    searchable: `concat_ws(' ', e.name, e.colour, e.summary, e.description, mk.name)`,
    nameOrder: 'immutable_unaccent(lower(e.name))',
    recordsWhere: 'v.series_id = $1',
    shape: toSeriesDetail,
  },

  people: {
    path: 'people',
    table: 'people',
    entityType: 'person',
    label: 'person',
    columns: [
      'slug', 'name', 'full_name', 'sort_name', 'aliases', 'is_group',
      'birth_year', 'death_year', 'nationality', 'voice_or_instrument',
      'summary', 'biography', 'notes',
    ],
    select: `e.*, (SELECT count(DISTINCT rc.record_id) FROM record_credits rc WHERE rc.person_id = e.id)::int AS record_count`,
    from: 'FROM people e',
    searchable: `concat_ws(' ', e.name, e.full_name, e.sort_name, array_to_string(e.aliases, ' '),
                              e.nationality, e.voice_or_instrument, e.summary)`,
    // Sort on the filing name where one is recorded, so Van Brunt files under V.
    nameOrder: 'immutable_unaccent(lower(coalesce(e.sort_name, e.name)))',
    recordsWhere: `EXISTS (SELECT 1 FROM record_credits rc WHERE rc.record_id = v.id AND rc.person_id = $1)`,
    shape: toPerson,
  },
};

// ======================================================================= list

/**
 * `q` on a wiki list is a plain substring match over that entity's own text —
 * these lists are short and browsed rather than searched, and the weighted
 * full-text index covers catalog records, not wiki pages.
 */
function listWhere(entity, q, p) {
  if (!q) return '';
  return `WHERE lower(immutable_unaccent(${entity.searchable}))
                LIKE '%' || lower(immutable_unaccent(${p.add(q)})) || '%'`;
}

function listHandler(entity) {
  return asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = parsePaging(req.query);
    const q = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : null;
    const { key, desc } = parseSort(req.query.sort, ['name', 'records'], 'name');
    const orderExpr = key === 'records' ? 'record_count' : 'name_order';
    // Most-recorded-first is the useful direction for `records`; `-records`
    // flips it, as `-` does everywhere else.
    const direction = (key === 'records' ? !desc : desc) ? 'DESC' : 'ASC';

    const p = new Params();
    const where = listWhere(entity, q, p);
    const limit = p.add(pageSize);
    const skip = p.add(offset);

    const { rows } = await query(
      `WITH matched AS (
         SELECT ${entity.select}, ${entity.nameOrder} AS name_order
         ${entity.from}
         ${where}
       )
       SELECT *, count(*) OVER () AS total
         FROM matched
        ORDER BY ${orderExpr} ${direction} NULLS LAST, name_order ASC
        LIMIT ${limit} OFFSET ${skip}`,
      p.values,
    );

    const total = rows.length ? Number(rows[0].total) : 0;
    const links = await linksByEntity(entity.entityType, rows.map((r) => r.id));
    const data = rows.map((row) => entity.shape(row, links.get(Number(row.id)) ?? []));
    return sendList(res, data, { page, pageSize, total });
  });
}

// ===================================================================== detail

async function loadEntity(entity, idOrSlug) {
  const numeric = isNumericId(idOrSlug);
  const { rows } = await query(
    `SELECT ${entity.select} ${entity.from} WHERE ${numeric ? 'e.id' : 'e.slug'} = $1`,
    [numeric ? Number(idOrSlug) : String(idOrSlug)],
  );
  if (!rows[0]) throw ApiError.notFound(`No ${entity.label} with that id or slug.`);
  return rows[0];
}

const DETAIL_RECORD_LIMIT = 50;

async function entityRecords(entity, id) {
  const { rows } = await query(
    `SELECT ${SUMMARY_COLUMNS}
     ${SUMMARY_FROM}
     WHERE ${entity.recordsWhere}
     ORDER BY v.catalog_sort
     LIMIT ${DETAIL_RECORD_LIMIT}`,
    [id],
  );
  return rows.map(toSummary);
}

function detailHandler(entity) {
  return asyncHandler(async (req, res) => {
    const row = await loadEntity(entity, req.params.idOrSlug);
    const [links, records] = await Promise.all([
      linksByEntity(entity.entityType, [row.id]),
      entityRecords(entity, row.id),
    ]);

    const data = entity.shape(row, links.get(Number(row.id)) ?? []);
    data.records = records;

    if (entity.entityType === 'maker') {
      // A maker's page leads with its product lines.
      const { rows: seriesRows } = await query(
        `SELECT ${ENTITIES.series.select} ${ENTITIES.series.from}
          WHERE e.maker_id = $1
          ORDER BY e.introduced_year NULLS LAST, immutable_unaccent(lower(e.name))`,
        [row.id],
      );
      const seriesLinks = await linksByEntity('series', seriesRows.map((s) => s.id));
      data.series = seriesRows.map((s) => toSeriesDetail(s, seriesLinks.get(Number(s.id)) ?? []));
    }

    if (entity.entityType === 'person') {
      const { rows: roleRows } = await query(
        `SELECT role, count(DISTINCT record_id)::int AS count
           FROM record_credits WHERE person_id = $1
          GROUP BY role ORDER BY count DESC, role`,
        [row.id],
      );
      data.roles = roleRows.map((r) => ({ role: r.role, count: r.count }));
    }

    return sendOne(res, data);
  });
}

// ============================================================ create / update

/** A camelCase snapshot of one wiki entity plus its links, for the audit trail. */
async function snapshotEntity(client, entity, id) {
  const { rows } = await client.query(
    `SELECT to_jsonb(e) AS row,
            (SELECT coalesce(jsonb_agg(jsonb_build_object(
                      'kind', l.kind, 'label', l.label, 'url', l.url, 'sortOrder', l.sort_order)
                    ORDER BY l.sort_order, l.id), '[]'::jsonb)
               FROM entity_links l
              WHERE l.entity_type = $2 AND l.entity_id = e.id) AS links
       FROM ${entity.table} e WHERE e.id = $1`,
    [id, entity.entityType],
  );
  if (!rows[0]) return null;
  return { ...camelKeys(rows[0].row), links: rows[0].links };
}

async function replaceEntityLinks(client, entity, id, links) {
  await client.query('DELETE FROM entity_links WHERE entity_type = $1 AND entity_id = $2', [
    entity.entityType,
    id,
  ]);
  const details = {};
  links.forEach((link, index) => {
    if (!link.url || !/^https?:\/\//i.test(String(link.url))) {
      details[`links[${index}].url`] = 'Links must be an http or https URL.';
    }
    if (!link.label) details[`links[${index}].label`] = 'A link needs a label.';
  });
  if (Object.keys(details).length) throw ApiError.unprocessable('Some links are not valid.', details);

  for (const [index, link] of links.entries()) {
    await client.query(
      `INSERT INTO entity_links (entity_type, entity_id, kind, label, url, sort_order)
       VALUES ($1, $2, coalesce($3, 'other')::link_kind, $4, $5, $6)
       ON CONFLICT (entity_type, entity_id, url) DO NOTHING`,
      [entity.entityType, id, link.kind ?? null, link.label, link.url, link.sortOrder ?? index + 1],
    );
  }
}

/** Series belong to a maker; accept either `makerId` or `makerSlug`. */
async function resolveMakerId(client, body) {
  if (body.makerId !== undefined && body.makerId !== null) {
    const { rows } = await client.query('SELECT id FROM makers WHERE id = $1', [body.makerId]);
    if (!rows[0]) throw ApiError.unprocessable('That maker does not exist.', { makerId: 'No such maker.' });
    return rows[0].id;
  }
  if (body.makerSlug) {
    const { rows } = await client.query('SELECT id FROM makers WHERE slug = $1', [body.makerSlug]);
    if (!rows[0]) throw ApiError.unprocessable('That maker does not exist.', { makerSlug: 'No such maker.' });
    return rows[0].id;
  }
  return null;
}

function createHandler(entity) {
  return asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const { editor, editSummary } = auditFrom(body);
    if (!body.name) {
      throw ApiError.unprocessable('That entry is missing required fields.', { name: 'A name is required.' });
    }

    const id = await transaction(async (client) => {
      const columns = pickColumns(body, entity.columns);
      columns.name = String(body.name);
      columns.slug = await uniqueSlug(client, entity.table, body.slug || body.name);

      if (entity.entityType === 'series') {
        const makerId = await resolveMakerId(client, body);
        if (!makerId) {
          throw ApiError.unprocessable('A series must belong to a maker.', {
            makerId: 'makerId or makerSlug is required.',
          });
        }
        columns.maker_id = makerId;
      }

      const keys = Object.keys(columns);
      const { rows } = await client.query(
        `INSERT INTO ${entity.table} (${keys.join(', ')})
         VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})
         RETURNING id`,
        keys.map((k) => columns[k]),
      );
      const newId = rows[0].id;

      if (Array.isArray(body.links)) await replaceEntityLinks(client, entity, newId, body.links);

      const after = await snapshotEntity(client, entity, newId);
      await writeRevision(client, {
        entityType: entity.entityType,
        entityId: newId,
        action: 'create',
        after,
        changedFields: diffFields(null, after),
        editor,
        editSummary,
      });
      return newId;
    });

    const row = await loadEntity(entity, String(id));
    const links = await linksByEntity(entity.entityType, [id]);
    return sendOne(res, entity.shape(row, links.get(Number(id)) ?? []), 201);
  });
}

function updateHandler(entity) {
  return asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const { editor, editSummary } = auditFrom(body);
    const existing = await loadEntity(entity, req.params.idOrSlug);
    const id = existing.id;

    await transaction(async (client) => {
      await client.query(`SELECT id FROM ${entity.table} WHERE id = $1 FOR UPDATE`, [id]);
      const before = await snapshotEntity(client, entity, id);

      const columns = pickColumns(body, entity.columns);
      if (columns.slug) columns.slug = slugify(columns.slug);
      else delete columns.slug;
      if (entity.entityType === 'series' && (body.makerId !== undefined || body.makerSlug)) {
        columns.maker_id = await resolveMakerId(client, body);
      }
      if (Object.keys(columns).length) {
        const { clause, values } = buildUpdate(columns, 2);
        await client.query(`UPDATE ${entity.table} SET ${clause} WHERE id = $1`, [id, ...values]);
      }

      if (Array.isArray(body.links)) await replaceEntityLinks(client, entity, id, body.links);

      const after = await snapshotEntity(client, entity, id);
      await writeRevision(client, {
        entityType: entity.entityType,
        entityId: id,
        action: 'update',
        before,
        after,
        changedFields: diffFields(before, after),
        editor,
        editSummary,
      });
    });

    const row = await loadEntity(entity, String(id));
    const links = await linksByEntity(entity.entityType, [id]);
    const data = entity.shape(row, links.get(Number(id)) ?? []);
    data.records = await entityRecords(entity, id);
    return sendOne(res, data);
  });
}

// The revision history of a wiki page, mirroring the catalog's own route.
function revisionsHandler(entity) {
  return asyncHandler(async (req, res) => {
    const row = await loadEntity(entity, req.params.idOrSlug);
    const { rows } = await query(
      `SELECT id, action, editor, edit_summary, changed_fields, before_data, after_data, created_at
         FROM catalog_revisions
        WHERE entity_type = $1 AND entity_id = $2
        ORDER BY created_at DESC, id DESC`,
      [entity.entityType, row.id],
    );
    return sendOne(res, rows.map((r) => camelKeys(r)));
  });
}

for (const entity of Object.values(ENTITIES)) {
  router.get(`/${entity.path}`, listHandler(entity));
  router.post(`/${entity.path}`, createHandler(entity));
  router.get(`/${entity.path}/:idOrSlug`, detailHandler(entity));
  router.patch(`/${entity.path}/:idOrSlug`, updateHandler(entity));
  router.get(`/${entity.path}/:idOrSlug/revisions`, revisionsHandler(entity));
}

export default router;

/**
 * GET /api/lookups — everything the UI needs to fill its dropdowns, in one
 * call, so no screen has to fire six requests before it can render a form.
 *
 * Contract: docs/API.md, "GET /api/lookups".
 */

import { Router } from 'express';
import { query } from '../lib/db.js';
import { asyncHandler, sendOne } from '../lib/http.js';

const router = Router();

// Assembled as a single statement: these are small reference tables, and one
// round trip beats seven.
const LOOKUPS_SQL = `
  SELECT
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
              'id', g.id, 'code', g.code, 'label', g.label, 'score', g.score,
              'description', g.description, 'sortOrder', g.sort_order)
            ORDER BY g.sort_order, g.id), '[]'::jsonb)
       FROM condition_grades g) AS condition_grades,

    (SELECT coalesce(jsonb_agg(jsonb_build_object(
              'id', d.id, 'code', d.code, 'label', d.label, 'category', d.category,
              'description', d.description, 'careAdvice', d.care_advice,
              'isTerminal', d.is_terminal, 'sortOrder', d.sort_order)
            ORDER BY d.sort_order, d.id), '[]'::jsonb)
       FROM defect_types d) AS defect_types,

    (SELECT coalesce(jsonb_agg(jsonb_build_object(
              'id', c.id, 'code', c.code, 'label', c.label, 'description', c.description,
              'safeFor', to_jsonb(c.safe_for), 'isRisky', c.is_risky, 'sortOrder', c.sort_order)
            ORDER BY c.sort_order, c.id), '[]'::jsonb)
       FROM cleaning_methods c) AS cleaning_methods,

    (SELECT coalesce(jsonb_agg(jsonb_build_object(
              'id', t.id, 'slug', t.slug, 'name', t.name, 'recordCount', t.record_count)
            ORDER BY t.name), '[]'::jsonb)
       FROM (SELECT m.id, m.slug, m.name,
                    (SELECT count(*)::int FROM catalog_records r WHERE r.maker_id = m.id) AS record_count
               FROM makers m) t) AS makers,

    (SELECT coalesce(jsonb_agg(jsonb_build_object(
              'id', t.id, 'slug', t.slug, 'name', t.name, 'makerSlug', t.maker_slug,
              'material', t.material, 'playMinutes', t.play_minutes, 'colour', t.colour,
              'recordCount', t.record_count)
            ORDER BY t.maker_name, t.name), '[]'::jsonb)
       FROM (SELECT s.id, s.slug, s.name, mk.slug AS maker_slug, mk.name AS maker_name,
                    s.material, s.play_minutes, s.colour,
                    (SELECT count(*)::int FROM catalog_records r WHERE r.series_id = s.id) AS record_count
               FROM series s JOIN makers mk ON mk.id = s.maker_id) t) AS series,

    (SELECT coalesce(jsonb_agg(g.genre ORDER BY g.genre), '[]'::jsonb)
       FROM (SELECT DISTINCT genre FROM catalog_records
              WHERE genre IS NOT NULL AND genre <> '') g) AS genres,

    (SELECT coalesce(jsonb_agg(jsonb_build_object(
              'id', c.id, 'slug', c.slug, 'name', c.name, 'isDefault', c.is_default)
            ORDER BY c.is_default DESC, c.name), '[]'::jsonb)
       FROM collections c) AS collections
`;

router.get(
  '/lookups',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(LOOKUPS_SQL);
    const row = rows[0];
    return sendOne(res, {
      conditionGrades: row.condition_grades,
      defectTypes: row.defect_types,
      cleaningMethods: row.cleaning_methods,
      makers: row.makers,
      series: row.series,
      genres: row.genres,
      collections: row.collections,
    });
  }),
);

export default router;

#!/usr/bin/env node
// Loads db/seed/*.json into the database. Idempotent: slugs are the identity,
// so re-running updates in place rather than duplicating.
//
//   node src/scripts/seed.js                     load every seed file
//   node src/scripts/seed.js --check [file...]   validate only, no database
//   node src/scripts/seed.js file.json           load just these files
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { pool, closePool, transaction } from '../lib/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.resolve(here, '../../../db/seed');

const MATERIALS = new Set([
  'brown_wax', 'black_wax', 'metallic_soap', 'celluloid', 'condensite', 'unknown',
]);
const ROLES = new Set([
  'performer', 'vocalist', 'instrumentalist', 'ensemble', 'orchestra', 'band',
  'conductor', 'composer', 'lyricist', 'arranger', 'speaker', 'comedian',
  'whistler', 'accompanist', 'announcer', 'other',
]);
const LINK_KINDS = new Set([
  'audio', 'discography', 'encyclopedia', 'catalog_scan', 'sheet_music',
  'image', 'article', 'video', 'other',
]);
const CONFIDENCE = new Set(['verified', 'probable', 'uncertain']);
const PRECISION = new Set(['day', 'month', 'year', 'decade']);
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------------------------------------------------------------- validation

function validateBundle(bundle, file, known) {
  const errors = [];
  const at = (p) => `${file}: ${p}`;

  const checkSlug = (slug, p) => {
    if (!slug || typeof slug !== 'string') errors.push(at(`${p} missing slug`));
    else if (!SLUG_RE.test(slug)) errors.push(at(`${p} slug "${slug}" is not lowercase-hyphenated`));
  };

  const checkLinks = (links, p) => {
    if (links === undefined || links === null) return;
    if (!Array.isArray(links)) return errors.push(at(`${p}.links must be an array`));
    for (const [i, l] of links.entries()) {
      const lp = `${p}.links[${i}]`;
      if (!l || typeof l !== 'object') { errors.push(at(`${lp} must be an object`)); continue; }
      if (!l.label) errors.push(at(`${lp} missing label`));
      if (!l.url || !/^https?:\/\//i.test(l.url)) errors.push(at(`${lp} url must start http(s)://`));
      if (l.kind && !LINK_KINDS.has(l.kind)) errors.push(at(`${lp} bad kind "${l.kind}"`));
    }
  };

  const checkPlaceholder = (obj, p, keys) => {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v !== 'string') continue;
      if (v.trim() === '') errors.push(at(`${p}.${k} is an empty string — omit the key instead`));
      else if (/\b(tbd|lorem ipsum|placeholder|description here|todo)\b/i.test(v)) {
        errors.push(at(`${p}.${k} contains placeholder text`));
      }
    }
  };

  for (const [i, m] of (bundle.makers || []).entries()) {
    const p = `makers[${i}]`;
    checkSlug(m.slug, p);
    if (!m.name) errors.push(at(`${p} missing name`));
    checkPlaceholder(m, p, ['summary', 'history', 'notes']);
    checkLinks(m.links, p);
    known.makers.add(m.slug);
  }

  for (const [i, s] of (bundle.series || []).entries()) {
    const p = `series[${i}] (${s.slug})`;
    checkSlug(s.slug, p);
    if (!s.name) errors.push(at(`${p} missing name`));
    if (!s.maker_slug) errors.push(at(`${p} missing maker_slug`));
    if (s.material && !MATERIALS.has(s.material)) errors.push(at(`${p} bad material "${s.material}"`));
    checkPlaceholder(s, p, ['summary', 'description', 'notes']);
    checkLinks(s.links, p);
    known.series.set(s.slug, s.maker_slug);
  }

  for (const [i, pe] of (bundle.people || []).entries()) {
    const p = `people[${i}] (${pe.slug})`;
    checkSlug(pe.slug, p);
    if (!pe.name) errors.push(at(`${p} missing name`));
    if (pe.aliases && !Array.isArray(pe.aliases)) errors.push(at(`${p}.aliases must be an array`));
    checkPlaceholder(pe, p, ['summary', 'biography', 'notes']);
    checkLinks(pe.links, p);
    known.people.add(pe.slug);
  }

  for (const [i, r] of (bundle.records || []).entries()) {
    const p = `records[${i}] (${r.slug})`;
    checkSlug(r.slug, p);
    if (!r.title) errors.push(at(`${p} missing title`));
    if (!r.catalog_number) errors.push(at(`${p} missing catalog_number`));
    if (!r.series_slug) errors.push(at(`${p} missing series_slug`));
    if (r.confidence && !CONFIDENCE.has(r.confidence)) errors.push(at(`${p} bad confidence "${r.confidence}"`));
    for (const k of ['recorded_precision', 'released_precision']) {
      if (r[k] && !PRECISION.has(r[k])) errors.push(at(`${p} bad ${k} "${r[k]}"`));
    }
    checkPlaceholder(r, p, ['description', 'notes', 'trivia', 'provenance']);
    checkLinks(r.links, p);
    for (const [j, c] of (r.credits || []).entries()) {
      const cp = `${p}.credits[${j}]`;
      if (!c.person_slug) errors.push(at(`${cp} missing person_slug`));
      if (c.role && !ROLES.has(c.role)) errors.push(at(`${cp} bad role "${c.role}"`));
    }
    if (known.records.has(r.slug)) errors.push(at(`${p} duplicate record slug "${r.slug}"`));
    known.records.add(r.slug);
    known.recordRefs.push({ file, p, series: r.series_slug, credits: (r.credits || []).map((c) => c.person_slug) });
  }

  return errors;
}

// Cross-file reference check, run once every file has been read.
function validateReferences(known) {
  const errors = [];
  for (const [slug, makerSlug] of known.series) {
    if (!known.makers.has(makerSlug)) {
      errors.push(`series "${slug}" references unknown maker "${makerSlug}"`);
    }
  }
  for (const ref of known.recordRefs) {
    if (!known.series.has(ref.series)) {
      errors.push(`${ref.file}: ${ref.p} references unknown series "${ref.series}"`);
    }
    for (const person of ref.credits) {
      if (person && !known.people.has(person)) {
        errors.push(`${ref.file}: ${ref.p} references unknown person "${person}"`);
      }
    }
  }
  return errors;
}

// -------------------------------------------------------------------- upsert

const nn = (v) => (v === undefined || v === '' ? null : v);

async function loadBundle(client, bundle, ids) {
  for (const m of bundle.makers || []) {
    const { rows } = await client.query(
      `INSERT INTO makers (slug, name, short_name, country, city, founded_year,
                           dissolved_year, summary, history, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name, short_name = EXCLUDED.short_name,
         country = EXCLUDED.country, city = EXCLUDED.city,
         founded_year = EXCLUDED.founded_year, dissolved_year = EXCLUDED.dissolved_year,
         summary = EXCLUDED.summary, history = EXCLUDED.history, notes = EXCLUDED.notes
       RETURNING id`,
      [m.slug, m.name, nn(m.short_name), nn(m.country), nn(m.city), nn(m.founded_year),
       nn(m.dissolved_year), nn(m.summary), nn(m.history), nn(m.notes)],
    );
    ids.makers.set(m.slug, rows[0].id);
    await loadEntityLinks(client, 'maker', rows[0].id, m.links);
  }

  for (const s of bundle.series || []) {
    const makerId = ids.makers.get(s.maker_slug) ?? (await lookup(client, 'makers', s.maker_slug));
    const { rows } = await client.query(
      `INSERT INTO series (slug, maker_id, name, play_minutes, material, threads_per_inch,
                           colour, introduced_year, discontinued_year, summary, description, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (slug) DO UPDATE SET
         maker_id = EXCLUDED.maker_id, name = EXCLUDED.name,
         play_minutes = EXCLUDED.play_minutes, material = EXCLUDED.material,
         threads_per_inch = EXCLUDED.threads_per_inch, colour = EXCLUDED.colour,
         introduced_year = EXCLUDED.introduced_year,
         discontinued_year = EXCLUDED.discontinued_year, summary = EXCLUDED.summary,
         description = EXCLUDED.description, notes = EXCLUDED.notes
       RETURNING id`,
      [s.slug, makerId, s.name, nn(s.play_minutes), s.material || 'unknown',
       nn(s.threads_per_inch), nn(s.colour), nn(s.introduced_year), nn(s.discontinued_year),
       nn(s.summary), nn(s.description), nn(s.notes)],
    );
    ids.series.set(s.slug, { id: rows[0].id, makerId });
    await loadEntityLinks(client, 'series', rows[0].id, s.links);
  }

  for (const p of bundle.people || []) {
    const { rows } = await client.query(
      `INSERT INTO people (slug, name, full_name, sort_name, aliases, is_group, birth_year,
                           death_year, nationality, voice_or_instrument, summary, biography, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       -- A person is referenced by several seed files: the artist roster
       -- carries the biography, while a record file may mention the same
       -- singer with only a name. Merging rather than overwriting means the
       -- richest value for each field survives, whatever order files load in.
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         full_name = COALESCE(EXCLUDED.full_name, people.full_name),
         sort_name = COALESCE(EXCLUDED.sort_name, people.sort_name),
         aliases = COALESCE(
           (SELECT array_agg(DISTINCT a ORDER BY a)
              FROM unnest(people.aliases || EXCLUDED.aliases) a
             WHERE a IS NOT NULL AND a <> ''),
           '{}'),
         is_group = EXCLUDED.is_group OR people.is_group,
         birth_year = COALESCE(EXCLUDED.birth_year, people.birth_year),
         death_year = COALESCE(EXCLUDED.death_year, people.death_year),
         nationality = COALESCE(EXCLUDED.nationality, people.nationality),
         voice_or_instrument = COALESCE(EXCLUDED.voice_or_instrument, people.voice_or_instrument),
         summary = COALESCE(EXCLUDED.summary, people.summary),
         biography = COALESCE(EXCLUDED.biography, people.biography),
         notes = COALESCE(EXCLUDED.notes, people.notes)
       RETURNING id`,
      [p.slug, p.name, nn(p.full_name), nn(p.sort_name), p.aliases || [], !!p.is_group,
       nn(p.birth_year), nn(p.death_year), nn(p.nationality), nn(p.voice_or_instrument),
       nn(p.summary), nn(p.biography), nn(p.notes)],
    );
    ids.people.set(p.slug, rows[0].id);
    await loadEntityLinks(client, 'person', rows[0].id, p.links);
  }

  for (const r of bundle.records || []) {
    let series = ids.series.get(r.series_slug);
    if (!series) {
      const id = await lookup(client, 'series', r.series_slug);
      const { rows } = await client.query('SELECT maker_id FROM series WHERE id = $1', [id]);
      series = { id, makerId: rows[0].maker_id };
      ids.series.set(r.series_slug, series);
    }

    const { rows } = await client.query(
      `INSERT INTO catalog_records (
         slug, series_id, maker_id, catalog_number, matrix_number, take, title, subtitle,
         work_type, genre, language, credit_line, recorded_on, recorded_precision,
         recorded_place, released_on, released_precision, release_supplement,
         duration_seconds, description, notes, lyrics, trivia, provenance, confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       ON CONFLICT (slug) DO UPDATE SET
         series_id = EXCLUDED.series_id, maker_id = EXCLUDED.maker_id,
         catalog_number = EXCLUDED.catalog_number, matrix_number = EXCLUDED.matrix_number,
         take = EXCLUDED.take, title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
         work_type = EXCLUDED.work_type, genre = EXCLUDED.genre, language = EXCLUDED.language,
         credit_line = EXCLUDED.credit_line, recorded_on = EXCLUDED.recorded_on,
         recorded_precision = EXCLUDED.recorded_precision, recorded_place = EXCLUDED.recorded_place,
         released_on = EXCLUDED.released_on, released_precision = EXCLUDED.released_precision,
         release_supplement = EXCLUDED.release_supplement,
         duration_seconds = EXCLUDED.duration_seconds, description = EXCLUDED.description,
         notes = EXCLUDED.notes, lyrics = EXCLUDED.lyrics, trivia = EXCLUDED.trivia,
         provenance = EXCLUDED.provenance, confidence = EXCLUDED.confidence
       RETURNING id`,
      [r.slug, series.id, series.makerId, String(r.catalog_number), nn(r.matrix_number),
       nn(r.take), r.title, nn(r.subtitle), nn(r.work_type), nn(r.genre), nn(r.language),
       nn(r.credit_line), nn(r.recorded_on), nn(r.recorded_precision), nn(r.recorded_place),
       nn(r.released_on), nn(r.released_precision), nn(r.release_supplement),
       nn(r.duration_seconds), nn(r.description), nn(r.notes), nn(r.lyrics), nn(r.trivia),
       nn(r.provenance), r.confidence || 'verified'],
    );
    const recordId = rows[0].id;

    // Credits and links are replaced wholesale so a re-seed cannot leave
    // stale rows behind from an earlier version of the file.
    await client.query('DELETE FROM record_credits WHERE record_id = $1', [recordId]);
    for (const [i, c] of (r.credits || []).entries()) {
      const personId = ids.people.get(c.person_slug) ?? (await lookup(client, 'people', c.person_slug));
      await client.query(
        `INSERT INTO record_credits (record_id, person_id, role, detail, billing_order)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [recordId, personId, c.role || 'performer', nn(c.detail), c.billing_order ?? i + 1],
      );
    }

    await client.query('DELETE FROM record_links WHERE record_id = $1', [recordId]);
    for (const [i, l] of (r.links || []).entries()) {
      await client.query(
        `INSERT INTO record_links (record_id, kind, label, url, source_name, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [recordId, l.kind || 'other', l.label, l.url, nn(l.source_name), i + 1],
      );
    }
  }
}

async function loadEntityLinks(client, type, id, links) {
  if (!links?.length) return;
  await client.query('DELETE FROM entity_links WHERE entity_type = $1 AND entity_id = $2', [type, id]);
  for (const [i, l] of links.entries()) {
    await client.query(
      `INSERT INTO entity_links (entity_type, entity_id, kind, label, url, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [type, id, l.kind || 'other', l.label, l.url, i + 1],
    );
  }
}

async function lookup(client, table, slug) {
  const { rows } = await client.query(`SELECT id FROM ${table} WHERE slug = $1`, [slug]);
  if (!rows.length) throw new Error(`unknown ${table} slug "${slug}"`);
  return rows[0].id;
}

// ---------------------------------------------------------------------- main

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const named = args.filter((a) => !a.startsWith('--'));

  const files = named.length
    ? named.map((f) => path.resolve(process.cwd(), f))
    : (await readdir(SEED_DIR))
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => path.join(SEED_DIR, f));

  if (!files.length) {
    console.log('[seed] no seed files found');
    return;
  }

  const known = {
    makers: new Set(), series: new Map(), people: new Set(),
    records: new Set(), recordRefs: [],
  };
  const bundles = [];
  const errors = [];

  // When validating a single file, existing database slugs count as known so
  // that a file which references another file's makers still validates.
  if (checkOnly && named.length) {
    try {
      for (const [table, sink] of [['makers', known.makers], ['people', known.people]]) {
        const { rows } = await pool.query(`SELECT slug FROM ${table}`);
        rows.forEach((r) => sink.add(r.slug));
      }
      const { rows } = await pool.query(
        'SELECT s.slug, m.slug AS maker FROM series s JOIN makers m ON m.id = s.maker_id',
      );
      rows.forEach((r) => known.series.set(r.slug, r.maker));
    } catch {
      // No database available; slug resolution is then checked within the files only.
    }
  }

  for (const file of files) {
    const name = path.basename(file);
    let bundle;
    try {
      bundle = JSON.parse(await readFile(file, 'utf8'));
    } catch (err) {
      errors.push(`${name}: not valid JSON — ${err.message}`);
      continue;
    }
    bundles.push({ name, bundle });
    errors.push(...validateBundle(bundle, name, known));
  }

  errors.push(...validateReferences(known));

  if (errors.length) {
    console.error(`[seed] ${errors.length} validation error(s):`);
    errors.slice(0, 60).forEach((e) => console.error('  - ' + e));
    if (errors.length > 60) console.error(`  ... and ${errors.length - 60} more`);
    process.exitCode = 1;
    return;
  }

  const counts = bundles.reduce(
    (acc, { bundle }) => {
      for (const k of ['makers', 'series', 'people', 'records']) {
        acc[k] += (bundle[k] || []).length;
      }
      return acc;
    },
    { makers: 0, series: 0, people: 0, records: 0 },
  );
  console.log(
    `[seed] validated ${bundles.length} file(s): ` +
      `${counts.makers} makers, ${counts.series} series, ` +
      `${counts.people} people, ${counts.records} records`,
  );

  if (checkOnly) {
    console.log('[seed] --check passed, nothing written');
    return;
  }

  await transaction(async (client) => {
    const ids = { makers: new Map(), series: new Map(), people: new Map() };
    for (const { name, bundle } of bundles) {
      await loadBundle(client, bundle, ids);
      console.log(`[seed] loaded  ${name}`);
    }
    const { rows } = await client.query('SELECT rebuild_all_catalog_search() AS n');
    console.log(`[seed] search index rebuilt for ${rows[0].n} records`);
  });
}

main()
  .catch((err) => {
    console.error('[seed] ' + err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());

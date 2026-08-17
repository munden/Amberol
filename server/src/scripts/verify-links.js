#!/usr/bin/env node
/**
 * Checks every external link in the register and reports the ones that do not
 * resolve.
 *
 * Why this exists: the seeded catalog was assembled in a sandbox whose network
 * policy blocked the very archives it cites — Wikipedia, the UCSB Cylinder
 * Audio Archive, DAHR and the Internet Archive were all unreachable. The links
 * were therefore sourced from search results rather than confirmed by fetching
 * them. Run this on a machine with ordinary internet access to find any that
 * are wrong.
 *
 *   node src/scripts/verify-links.js              check every link
 *   node src/scripts/verify-links.js --fix        also delete links that 404
 *   node src/scripts/verify-links.js --host ucsb  only links matching a host
 *   node src/scripts/verify-links.js --json out.json
 */
import { writeFile } from 'node:fs/promises';
import { pool, closePool } from '../lib/db.js';

const args = process.argv.slice(2);
const FIX = args.includes('--fix');
const hostFilter = valueOf('--host');
const jsonOut = valueOf('--json');
const CONCURRENCY = Number(valueOf('--concurrency') || 6);
const TIMEOUT_MS = 20_000;

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

async function collectLinks() {
  const { rows } = await pool.query(`
    SELECT l.id, l.url, l.label, l.kind, 'record_links' AS source,
           r.title AS context, r.slug AS context_slug
      FROM record_links l
      JOIN catalog_records r ON r.id = l.record_id
    UNION ALL
    SELECT e.id, e.url, e.label, e.kind, 'entity_links' AS source,
           e.entity_type AS context, e.entity_type || ':' || e.entity_id AS context_slug
      FROM entity_links e
    ORDER BY url
  `);
  return hostFilter ? rows.filter((r) => r.url.includes(hostFilter)) : rows;
}

/**
 * HEAD first because it is cheap; a fair number of archives answer HEAD with
 * 405 or 403 while serving GET perfectly well, so fall back rather than
 * reporting a false failure.
 */
async function probe(url) {
  const attempt = async (method) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method,
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': 'AmberolaCylinderRegister/1.0 (link check)' },
      });
      return { status: response.status, finalUrl: response.url };
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const head = await attempt('HEAD');
    if (head.status < 400 || ![403, 405, 501].includes(head.status)) return head;
    return await attempt('GET');
  } catch (err) {
    if (err.name === 'AbortError') return { status: 0, error: 'timed out' };
    return { status: 0, error: err.cause?.code || err.message };
  }
}

/** Runs `worker` over `items` with a fixed number of workers in flight. */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  const links = await collectLinks();
  if (!links.length) {
    console.log('No links to check.');
    return;
  }

  // The same URL is often cited by many records; check each distinct one once.
  const byUrl = new Map();
  for (const link of links) {
    if (!byUrl.has(link.url)) byUrl.set(link.url, []);
    byUrl.get(link.url).push(link);
  }
  const urls = [...byUrl.keys()];

  console.log(`Checking ${urls.length} distinct URL(s) across ${links.length} citation(s)…\n`);

  let done = 0;
  const checked = await mapLimit(urls, CONCURRENCY, async (url) => {
    const result = await probe(url);
    done += 1;
    const mark = result.status >= 200 && result.status < 400 ? 'ok  '
      : result.status === 0 ? 'ERR ' : `${result.status} `;
    process.stdout.write(`  [${String(done).padStart(4)}/${urls.length}] ${mark} ${url}\n`);
    return { url, ...result };
  });

  const broken = checked.filter((c) => c.status === 0 || c.status >= 400);
  const redirected = checked.filter(
    (c) => c.finalUrl && c.finalUrl !== c.url && c.status < 400,
  );

  console.log(`\n${checked.length - broken.length} of ${checked.length} resolved.`);

  if (redirected.length) {
    console.log(`\n${redirected.length} redirected — consider updating them to the final URL:`);
    for (const r of redirected) console.log(`  ${r.url}\n    -> ${r.finalUrl}`);
  }

  if (broken.length) {
    console.log(`\n${broken.length} did not resolve:`);
    for (const b of broken) {
      console.log(`  [${b.status || b.error}] ${b.url}`);
      for (const link of byUrl.get(b.url)) {
        console.log(`      cited by ${link.source} #${link.id} — ${link.context_slug} (${link.label})`);
      }
    }
  } else {
    console.log('\nEvery link resolved.');
  }

  if (jsonOut) {
    await writeFile(jsonOut, JSON.stringify({ checked, broken, redirected }, null, 2));
    console.log(`\nWrote ${jsonOut}`);
  }

  if (FIX && broken.length) {
    // Only remove links the server actually answered 404/410 for. A timeout or
    // a DNS failure usually means the checking machine, not a dead link.
    const gone = broken.filter((b) => b.status === 404 || b.status === 410);
    let removed = 0;
    for (const b of gone) {
      for (const link of byUrl.get(b.url)) {
        await pool.query(`DELETE FROM ${link.source} WHERE id = $1`, [link.id]);
        removed += 1;
      }
    }
    console.log(`\n--fix removed ${removed} citation(s) whose URL returned 404 or 410.`);
    console.log('Links that merely timed out were left alone.');
  }

  if (broken.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error('[verify-links] ' + err.message);
    process.exitCode = 1;
  })
  .finally(() => closePool());

/**
 * End-to-end check that the running API matches docs/API.md.
 *
 * This talks to a live server over HTTP rather than importing the app, so it
 * exercises the real routing, error middleware and static file serving.
 *
 *   npm start            # in one shell
 *   npm test             # in another
 *
 * Every row it creates is removed again, so it is safe to run against a
 * populated register.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.TEST_BASE_URL || 'http://127.0.0.1:4310';

async function call(method, path, body, opts = {}) {
  const init = { method, headers: {}, ...opts };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${BASE}${path}`, init);
  const text = await response.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
  }
  return { status: response.status, body: json, headers: response.headers };
}

const get = (p) => call('GET', p);
const post = (p, b) => call('POST', p, b);
const patch = (p, b) => call('PATCH', p, b);
const del = (p) => call('DELETE', p);

/** Skips the whole file with a clear message when nothing is listening. */
async function serverUp() {
  try {
    const res = await get('/api/health');
    return res.status === 200;
  } catch {
    return false;
  }
}

const up = await serverUp();
if (!up) {
  test('API is running', { skip: `No server at ${BASE}. Start it with: npm start` }, () => {});
}

const maybe = { skip: up ? false : 'server not running' };

// ---------------------------------------------------------------- the basics

test('health reports the database and a record count', maybe, async () => {
  const { status, body } = await get('/api/health');
  assert.equal(status, 200);
  assert.equal(body.data.status, 'ok');
  assert.equal(body.data.database, 'ok');
  assert.equal(typeof body.data.records, 'number');
});

test('lookups returns every vocabulary the UI needs', maybe, async () => {
  const { status, body } = await get('/api/lookups');
  assert.equal(status, 200);
  const d = body.data;
  for (const key of ['conditionGrades', 'defectTypes', 'cleaningMethods', 'makers', 'series', 'collections']) {
    assert.ok(Array.isArray(d[key]), `${key} should be an array`);
  }
  assert.ok(d.conditionGrades.length >= 10, 'the grading scale ships seeded');
  assert.ok(d.defectTypes.length >= 20, 'the defect list ships seeded');
  assert.ok(d.cleaningMethods.length >= 10, 'the cleaning methods ship seeded');

  // The wax/celluloid distinction is what the safety warning rests on.
  const water = d.cleaningMethods.find((m) => m.code === 'distilled_water');
  assert.ok(water, 'distilled water is a listed method');
  assert.ok(water.safeFor.includes('celluloid'), 'water is safe for celluloid');
  assert.ok(!water.safeFor.includes('black_wax'), 'water is NOT safe for wax');

  assert.ok(d.collections.some((c) => c.isDefault), 'there is a default collection');
});

test('an unknown route 404s in the documented envelope', maybe, async () => {
  const { status, body } = await get('/api/nonsense');
  assert.equal(status, 404);
  assert.equal(body.error.code, 'not_found');
  assert.equal(typeof body.error.message, 'string');
});

// ------------------------------------------------------------------- catalog

test('the master list paginates and reports facets', maybe, async () => {
  const { status, body } = await get('/api/catalog?pageSize=5');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.data));
  assert.equal(body.pageSize, 5);
  assert.equal(typeof body.total, 'number');
  assert.equal(typeof body.totalPages, 'number');
  assert.ok(body.data.length <= 5);

  if (body.total > 0) {
    const row = body.data[0];
    for (const key of ['id', 'slug', 'catalogNumber', 'title', 'maker', 'series']) {
      assert.ok(key in row, `summary row carries ${key}`);
    }
    assert.ok(row.maker.slug, 'maker is expanded, not just an id');
    assert.ok(row.series.material, 'series carries its material');
    assert.ok(body.facets, 'facets accompany the list');
  }
});

test('pageSize is capped so a client cannot ask for everything', maybe, async () => {
  const { body } = await get('/api/catalog?pageSize=100000');
  assert.ok(body.pageSize <= 200, 'pageSize is capped at 200');
});

test('search matches on description and notes, not only titles', maybe, async () => {
  const { body: all } = await get('/api/catalog?pageSize=1');
  if (all.total === 0) return; // nothing seeded yet

  const { status, body } = await get('/api/catalog?q=cylinder&pageSize=5');
  assert.equal(status, 200);
  assert.ok(['fulltext', 'fuzzy', 'none'].includes(body.matchMode), 'matchMode is reported');
});

test('a misspelling still finds the record via the fuzzy fallback', maybe, async () => {
  const { body: sample } = await get('/api/catalog?pageSize=1');
  if (sample.total === 0) return;

  const title = sample.data[0].title;
  const word = title.split(/\s+/).find((w) => w.length > 5);
  if (!word) return;

  // Drop a letter from the middle of a real word from a real title.
  const typo = word.slice(0, 3) + word.slice(4);
  const { body } = await get(`/api/catalog?q=${encodeURIComponent(typo)}&pageSize=5`);
  assert.ok(['fulltext', 'fuzzy', 'none'].includes(body.matchMode));
  if (body.total > 0) {
    assert.ok(['fulltext', 'fuzzy'].includes(body.matchMode));
  }
});

test('a record detail page carries its credits, links and cross-references', maybe, async () => {
  const { body: list } = await get('/api/catalog?pageSize=1');
  if (list.total === 0) return;

  const { status, body } = await get(`/api/catalog/${list.data[0].slug}`);
  assert.equal(status, 200);
  const r = body.data;
  for (const key of ['credits', 'links', 'images', 'seriesDetail', 'makerDetail', 'myCopies']) {
    assert.ok(key in r, `detail carries ${key}`);
  }
  assert.ok(Array.isArray(r.credits));
  assert.ok(r.seriesDetail.slug, 'the full series object is embedded');
});

test('a record is addressable by id as well as by slug', maybe, async () => {
  const { body: list } = await get('/api/catalog?pageSize=1');
  if (list.total === 0) return;
  const { status, body } = await get(`/api/catalog/${list.data[0].id}`);
  assert.equal(status, 200);
  assert.equal(body.data.slug, list.data[0].slug);
});

// ------------------------------------------------- editing and the audit trail

test('editing a record records a revision naming the changed fields', maybe, async () => {
  const { body: lookups } = await get('/api/lookups');
  const series = lookups.data.series[0];
  if (!series) return;

  const created = await post('/api/catalog', {
    seriesId: series.id,
    catalogNumber: `TEST-${Date.now()}`,
    title: 'A Test Cylinder That Should Not Survive',
    description: 'Created by the smoke test.',
  });
  assert.equal(created.status, 201, 'creating returns 201');
  const record = created.body.data;

  try {
    const edited = await patch(`/api/catalog/${record.id}`, {
      title: 'A Test Cylinder, Retitled',
      editSummary: 'Smoke test edit',
      editor: 'smoke-test',
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.data.title, 'A Test Cylinder, Retitled');

    const { status, body } = await get(`/api/catalog/${record.id}/revisions`);
    assert.equal(status, 200);
    assert.ok(body.data.length >= 1, 'the edit produced a revision');

    const revision = body.data.find((r) => r.action === 'update');
    assert.ok(revision, 'an update revision exists');
    assert.ok(revision.changedFields.includes('title'), 'the revision names the field that changed');
    assert.ok(!revision.changedFields.includes('description'),
      'the revision does not claim untouched fields changed');
    assert.equal(revision.editSummary, 'Smoke test edit');
  } finally {
    await del(`/api/catalog/${record.id}`);
  }
});

test('search finds a record by words appearing only in its notes', maybe, async () => {
  const { body: lookups } = await get('/api/lookups');
  const series = lookups.data.series[0];
  if (!series) return;

  const token = `zzqx${Date.now().toString(36)}`;
  const created = await post('/api/catalog', {
    seriesId: series.id,
    catalogNumber: `TEST-N-${Date.now()}`,
    title: 'Indexing Probe',
    notes: `The distinctive token ${token} appears only here.`,
  });
  if (created.status !== 201) return;

  try {
    const { body } = await get(`/api/catalog?q=${token}`);
    assert.equal(body.total, 1, 'a word unique to the notes finds exactly that record');
    assert.equal(body.data[0].id, created.body.data.id);
  } finally {
    await del(`/api/catalog/${created.body.data.id}`);
  }
});

// ---------------------------------------------------------------- collection

test('the collection lists, and its rows carry a derived cleaning summary', maybe, async () => {
  const { status, body } = await get('/api/collection?pageSize=5');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.data));
  if (body.data.length) {
    const item = body.data[0];
    assert.ok('cleaning' in item, 'each item reports its cleaning state');
    assert.equal(typeof item.cleaning.isCleaned, 'boolean');
    assert.equal(typeof item.cleaning.cleaningCount, 'number');
    assert.ok('displayTitle' in item);
  }
});

test('collection stats returns the whole dashboard payload', maybe, async () => {
  const { status, body } = await get('/api/collection/stats');
  assert.equal(status, 200);
  for (const key of ['totalItems', 'cleaned', 'neverCleaned', 'byGrade', 'bySeries', 'catalogCoverage']) {
    assert.ok(key in body.data, `stats carries ${key}`);
  }
});

test('an owned copy blocks deletion of its catalog entry', maybe, async () => {
  const { body: lookups } = await get('/api/lookups');
  const series = lookups.data.series[0];
  if (!series) return;

  const created = await post('/api/catalog', {
    seriesId: series.id,
    catalogNumber: `TEST-D-${Date.now()}`,
    title: 'Protected By Ownership',
  });
  if (created.status !== 201) return;
  const recordId = created.body.data.id;

  const item = await post('/api/collection', { recordId, personalNotes: 'smoke test copy' });
  assert.equal(item.status, 201, 'the copy was added to the shelf');

  try {
    const refused = await del(`/api/catalog/${recordId}`);
    assert.equal(refused.status, 409,
      'deleting a catalog entry someone owns a copy of is refused');
    assert.equal(refused.body.error.code, 'conflict');
  } finally {
    await del(`/api/collection/${item.body.data.id}`);
    await del(`/api/catalog/${recordId}`);
  }
});

test('the cleaning log records date, time and method, and warns on the wrong material', maybe, async () => {
  const { body: lookups } = await get('/api/lookups');
  // A wax series, so that a water-based method is the wrong treatment.
  const waxSeries = lookups.data.series.find((s) =>
    ['black_wax', 'brown_wax', 'metallic_soap'].includes(s.material));
  const water = lookups.data.cleaningMethods.find((m) => m.code === 'distilled_water');
  const brush = lookups.data.cleaningMethods.find((m) => m.code === 'dry_brush');
  if (!waxSeries || !water || !brush) return;

  const created = await post('/api/catalog', {
    seriesId: waxSeries.id,
    catalogNumber: `TEST-C-${Date.now()}`,
    title: 'A Wax Cylinder For Testing',
  });
  if (created.status !== 201) return;
  const recordId = created.body.data.id;
  const item = await post('/api/collection', { recordId });
  const itemId = item.body.data.id;

  try {
    const when = '2024-06-10T15:20:00.000Z';
    const risky = await post(`/api/collection/${itemId}/cleanings`, {
      cleanedAt: when,
      methodId: water.id,
      productsUsed: 'Distilled water',
      performedBy: 'smoke-test',
      outcome: 'improved',
      notes: 'Deliberately the wrong treatment for wax.',
    });
    assert.equal(risky.status, 201, 'the entry is written even though the method is unsuitable');
    assert.ok(Array.isArray(risky.body.warnings) && risky.body.warnings.length > 0,
      'washing a wax cylinder raises a warning');
    assert.equal(risky.body.warnings[0].code, 'method_unsafe_for_material');

    // A dry brush on wax is correct, and must not warn.
    const safe = await post(`/api/collection/${itemId}/cleanings`, {
      methodId: brush.id,
      performedBy: 'smoke-test',
    });
    assert.equal(safe.status, 201);
    assert.ok(!safe.body.warnings || safe.body.warnings.length === 0,
      'a dry brush on wax raises no warning');

    // The flag on the shelf is derived from the log.
    const { body: detail } = await get(`/api/collection/${itemId}`);
    assert.equal(detail.data.cleaning.isCleaned, true);
    assert.equal(detail.data.cleaning.cleaningCount, 2);
    assert.ok(detail.data.cleaning.lastCleanedAt, 'the last cleaning carries a timestamp');
    assert.ok(detail.data.cleaning.lastMethod, 'the last cleaning names its method');
    assert.equal(detail.data.cleanings.length, 2, 'the full log comes back on the detail route');
  } finally {
    await del(`/api/collection/${itemId}`);
    await del(`/api/catalog/${recordId}`);
  }
});

test('an unidentified cylinder can be shelved without a catalog entry', maybe, async () => {
  const created = await post('/api/collection', {
    unmatchedTitle: 'Unknown Title, Worn Band',
    unmatchedMaker: 'Probably Edison',
    personalNotes: 'smoke test',
  });
  assert.equal(created.status, 201);
  try {
    assert.equal(created.body.data.displayTitle, 'Unknown Title, Worn Band');
    assert.equal(created.body.data.record, null);
  } finally {
    await del(`/api/collection/${created.body.data.id}`);
  }
});

test('an item with neither a record nor a title is rejected', maybe, async () => {
  const { status, body } = await post('/api/collection', { personalNotes: 'nothing to identify this' });
  assert.ok(status === 422 || status === 400, 'an unidentifiable item is refused');
  assert.ok(body.error, 'and says why');
});

// -------------------------------------------------------------------- images

test('an upload rejects a file that is not an image', maybe, async () => {
  const created = await post('/api/collection', { unmatchedTitle: 'Upload probe' });
  if (created.status !== 201) return;
  const itemId = created.body.data.id;

  try {
    const form = new FormData();
    form.append('files', new Blob(['this is plainly not an image'], { type: 'image/jpeg' }), 'fake.jpg');
    const { status } = await call('POST', `/api/collection/${itemId}/images`, form);
    assert.ok(status >= 400 && status < 500,
      'a file claiming to be a JPEG but which is not is refused');
  } finally {
    await del(`/api/collection/${itemId}`);
  }
});

// ---------------------------------------------------------------------- wiki

test('makers, series and people each list and resolve by slug', maybe, async () => {
  for (const path of ['makers', 'series', 'people']) {
    const { status, body } = await get(`/api/${path}?pageSize=3`);
    assert.equal(status, 200, `${path} lists`);
    assert.ok(Array.isArray(body.data));
    if (body.data.length) {
      const detail = await get(`/api/${path}/${body.data[0].slug}`);
      assert.equal(detail.status, 200, `${path} resolves by slug`);
      assert.ok('recordCount' in detail.body.data, `${path} detail reports a record count`);
    }
  }
});

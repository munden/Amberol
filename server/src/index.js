import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import express from 'express';
import cors from 'cors';
import 'dotenv/config';

import { pool, describeDatabaseFault } from './lib/db.js';
import { ApiError } from './lib/http.js';
import catalogRouter from './routes/catalog.js';
import wikiRouter from './routes/wiki.js';
import lookupsRouter from './routes/lookups.js';
import collectionRouter from './routes/collection.js';
import imagesRouter from './routes/images.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = path.resolve(here, '..', process.env.UPLOAD_DIR || './uploads');

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Uploaded images. Cached hard because filenames are content-hashed.
app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    maxAge: '365d',
    immutable: true,
    fallthrough: true,
    index: false,
    dotfiles: 'deny',
  }),
);

app.get('/api/health', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM catalog_records');
    res.json({
      data: {
        status: 'ok',
        database: 'ok',
        records: rows[0].n,
        // An empty catalog is a working install that has not been seeded, not
        // a fault; the front end says so rather than showing an error.
        seeded: rows[0].n > 0,
      },
    });
  } catch (err) {
    const fault = describeDatabaseFault(err);
    res.status(503).json({
      error: {
        code: 'database_unavailable',
        message: fault ? fault.message : 'Database unavailable: ' + err.message,
        details: { state: fault?.state ?? 'error' },
      },
    });
  }
});

app.post('/api/admin/reindex', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT rebuild_all_catalog_search() AS n');
    res.json({ data: { reindexed: rows[0].n } });
  } catch (err) {
    next(err);
  }
});

app.use('/api', lookupsRouter);
app.use('/api', catalogRouter);
app.use('/api', wikiRouter);
app.use('/api', collectionRouter);
app.use('/api', imagesRouter);

// In production the built front end is served from the same origin, and any
// unmatched non-API path falls through to the SPA shell so deep links work.
const WEB_DIST = path.resolve(here, '../../web/dist');
app.use(express.static(WEB_DIST, { index: false }));
app.get(/^(?!\/api\/|\/uploads\/).*/, (req, res, next) => {
  res.sendFile(path.join(WEB_DIST, 'index.html'), (err) => {
    if (err) next(ApiError.notFound('No such page.'));
  });
});

app.use((req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}.` } });
});

// eslint-disable-next-line no-unused-vars -- Express identifies the error
// middleware by its arity, so `next` must stay in the signature.
app.use((err, req, res, next) => {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }
  if (err?.type === 'entity.too.large' || err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: { code: 'payload_too_large', message: 'That file is larger than the upload limit.' },
    });
  }
  // Postgres constraint violations map onto meaningful client errors rather
  // than a bare 500, which would tell the collector nothing useful.
  if (err?.code === '23505') {
    return res.status(409).json({
      error: { code: 'conflict', message: 'That already exists.', details: { constraint: err.constraint } },
    });
  }
  if (err?.code === '23503') {
    return res.status(409).json({
      error: { code: 'conflict', message: 'Something still refers to that record.', details: { constraint: err.constraint } },
    });
  }
  if (err?.code === '22P02' || err?.code === '22007') {
    return res.status(400).json({
      error: { code: 'bad_request', message: 'A value was not in the expected format.' },
    });
  }

  // A database that is missing, unreachable or unmigrated is a setup problem,
  // not a bug. Say which one it is and what fixes it, rather than letting the
  // generic 500 below send someone hunting through the application.
  const fault = describeDatabaseFault(err);
  if (fault) {
    console.error(`[database] ${fault.state}: ${err.message}`);
    return res.status(503).json({
      error: {
        code: 'database_unavailable',
        message: fault.message,
        details: { state: fault.state },
      },
    });
  }

  console.error('[error]', err);
  res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong.' } });
});

const PORT = Number(process.env.PORT || 4310);

await mkdir(UPLOAD_DIR, { recursive: true });

const server = app.listen(PORT, () => {
  console.log(`[amberola] listening on http://localhost:${PORT}`);
  console.log(`[amberola] uploads at ${UPLOAD_DIR}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => pool.end().then(() => process.exit(0)));
  });
}

export default app;

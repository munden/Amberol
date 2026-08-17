// Shared HTTP helpers. Every route module builds its responses through these
// so the envelopes in docs/API.md stay uniform.

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
  static badRequest(msg, details) { return new ApiError(400, 'bad_request', msg, details); }
  static notFound(msg = 'Not found.') { return new ApiError(404, 'not_found', msg); }
  static conflict(msg, details) { return new ApiError(409, 'conflict', msg, details); }
  static unprocessable(msg, details) { return new ApiError(422, 'unprocessable', msg, details); }
  static tooLarge(msg) { return new ApiError(413, 'payload_too_large', msg); }
}

/** Wraps an async route handler so a rejected promise reaches the error middleware. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function sendOne(res, data, status = 200, extra = {}) {
  return res.status(status).json({ data, ...extra });
}

export function sendList(res, data, { page, pageSize, total }, extra = {}) {
  return res.json({
    data,
    page,
    pageSize,
    total,
    totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 1,
    ...extra,
  });
}

const MAX_PAGE_SIZE = 200;

export function parsePaging(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const requested = Number.parseInt(query.pageSize, 10);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.isFinite(requested) ? requested : 50),
  );
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** Query params that may repeat (`?maker=a&maker=b`) always come back as an array. */
export function asArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value.filter((v) => v !== '') : [value];
}

/** Tri-state: true / false / undefined, so an absent filter differs from `false`. */
export function asBool(value) {
  if (value === undefined || value === '') return undefined;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return undefined;
}

export function asInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Splits `-year` into a column key and a direction. */
export function parseSort(value, allowed, fallback) {
  const raw = typeof value === 'string' && value ? value : fallback;
  const desc = raw.startsWith('-');
  const key = desc ? raw.slice(1) : raw;
  if (!allowed.includes(key)) return { key: fallback.replace(/^-/, ''), desc: fallback.startsWith('-') };
  return { key, desc };
}

/** True when the path segment is a numeric id rather than a slug. */
export const isNumericId = (v) => /^\d+$/.test(String(v));

// ---------------------------------------------------------------- case mapping
// The database speaks snake_case and the API speaks camelCase. These convert
// between the two rather than every query aliasing every column by hand.

export const toCamel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
export const toSnake = (s) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

export function camelKeys(row) {
  if (row === null || row === undefined) return row;
  if (Array.isArray(row)) return row.map(camelKeys);
  if (row instanceof Date || typeof row !== 'object') return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[toCamel(k)] = v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)
      ? camelKeys(v)
      : Array.isArray(v)
        ? v.map((item) => (item && typeof item === 'object' ? camelKeys(item) : item))
        : v;
  }
  return out;
}

/**
 * Turns a camelCase request body into snake_case columns, keeping only keys in
 * `allowed`. An explicit `null` is preserved so a field can be cleared, while
 * an absent key is left out so PATCH leaves it unchanged.
 */
export function pickColumns(body, allowed) {
  const out = {};
  for (const key of allowed) {
    const camel = toCamel(key);
    if (Object.hasOwn(body, camel)) out[key] = body[camel] === '' ? null : body[camel];
    else if (Object.hasOwn(body, key)) out[key] = body[key] === '' ? null : body[key];
  }
  return out;
}

/** Builds `SET a = $1, b = $2` plus the value list for an UPDATE. */
export function buildUpdate(columns, startIndex = 1) {
  const keys = Object.keys(columns);
  const clause = keys.map((k, i) => `${k} = $${i + startIndex}`).join(', ');
  return { clause, values: keys.map((k) => columns[k]), keys };
}

export function slugify(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

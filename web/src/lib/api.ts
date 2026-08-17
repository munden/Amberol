/**
 * The typed client for the API described in docs/API.md.
 *
 * Every screen goes through this module rather than calling fetch directly,
 * so error handling, query-string building and the response envelopes are
 * handled in exactly one place.
 */

// ---------------------------------------------------------------- envelopes

export interface ListResponse<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  matchMode?: 'fulltext' | 'fuzzy' | 'none';
  facets?: Facets;
}

export interface Facets {
  makers: { slug: string; name: string; count: number }[];
  series: { slug: string; name: string; count: number }[];
  genres: { value: string; count: number }[];
  decades: { value: number; count: number }[];
}

export class ApiError extends Error {
  status: number;
  code: string;
  details?: Record<string, string>;
  constructor(status: number, code: string, message: string, details?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ------------------------------------------------------------------- models

export type CylinderMaterial =
  | 'brown_wax' | 'black_wax' | 'metallic_soap' | 'celluloid' | 'condensite' | 'unknown';

export type DatePrecision = 'day' | 'month' | 'year' | 'decade';
export type Confidence = 'verified' | 'probable' | 'uncertain';
export type LinkKind =
  | 'audio' | 'discography' | 'encyclopedia' | 'catalog_scan'
  | 'sheet_music' | 'image' | 'article' | 'video' | 'other';
export type CreditRole =
  | 'performer' | 'vocalist' | 'instrumentalist' | 'ensemble' | 'orchestra' | 'band'
  | 'conductor' | 'composer' | 'lyricist' | 'arranger' | 'speaker' | 'comedian'
  | 'whistler' | 'accompanist' | 'announcer' | 'other';
export type ImageView = 'label' | 'surface' | 'box' | 'lid' | 'end' | 'damage' | 'other';
export type SurfaceNoise = 'none' | 'light' | 'moderate' | 'heavy' | 'severe';
export type CleaningOutcome = 'improved' | 'no_change' | 'worsened' | 'unknown';

export interface MakerRef { id: number; slug: string; name: string }

export interface SeriesRef {
  id: number;
  slug: string;
  name: string;
  material: CylinderMaterial;
  playMinutes: number | null;
  colour: string | null;
}

export interface RecordLink {
  id: number;
  kind: LinkKind;
  label: string;
  url: string;
  sourceName: string | null;
}

export interface Image {
  id: number;
  url: string;
  thumbUrl: string | null;
  view: ImageView | null;
  caption: string | null;
  altText: string | null;
  width: number | null;
  height: number | null;
  byteSize: number;
  mimeType: string;
  sortOrder: number;
  isPrimary: boolean;
  createdAt: string;
  duplicate?: boolean;
}

export interface PersonRef {
  id: number;
  slug: string;
  name: string;
  fullName: string | null;
  isGroup: boolean;
  voiceOrInstrument: string | null;
  summary: string | null;
}

export interface Credit {
  id: number;
  role: CreditRole;
  detail: string | null;
  billingOrder: number;
  person: PersonRef;
}

export interface CatalogSummary {
  id: number;
  slug: string;
  catalogNumber: string;
  title: string;
  subtitle: string | null;
  genre: string | null;
  workType: string | null;
  creditLine: string | null;
  performers: string | null;
  authors: string | null;
  releasedOn: string | null;
  releasedPrecision: DatePrecision | null;
  releaseSupplement: string | null;
  recordedOn: string | null;
  recordedPrecision: DatePrecision | null;
  description: string | null;
  confidence: Confidence;
  isStub: boolean;
  maker: MakerRef;
  series: SeriesRef;
  primaryImageUrl: string | null;
  linkCount: number;
  ownedCount: number;
  rank?: number;
}

export interface Maker {
  id: number; slug: string; name: string; shortName: string | null;
  country: string | null; city: string | null;
  foundedYear: number | null; dissolvedYear: number | null;
  summary: string | null; history: string | null; notes: string | null;
  links: RecordLink[]; recordCount: number; series?: Series[]; records?: CatalogSummary[];
}

export interface Series {
  id: number; slug: string; name: string; maker: MakerRef;
  playMinutes: number | null; material: CylinderMaterial;
  threadsPerInch: number | null; colour: string | null;
  introducedYear: number | null; discontinuedYear: number | null;
  summary: string | null; description: string | null; notes: string | null;
  links: RecordLink[]; recordCount: number; records?: CatalogSummary[];
}

export interface Person {
  id: number; slug: string; name: string; fullName: string | null;
  sortName: string | null; aliases: string[]; isGroup: boolean;
  birthYear: number | null; deathYear: number | null;
  nationality: string | null; voiceOrInstrument: string | null;
  summary: string | null; biography: string | null; notes: string | null;
  links: RecordLink[]; recordCount: number;
  roles?: { role: CreditRole; count: number }[];
  records?: CatalogSummary[];
}

export interface CatalogRecord extends CatalogSummary {
  matrixNumber: string | null;
  take: string | null;
  language: string | null;
  recordedPlace: string | null;
  durationSeconds: number | null;
  notes: string | null;
  lyrics: string | null;
  trivia: string | null;
  provenance: string | null;
  withdrawnOn: string | null;
  credits: Credit[];
  links: RecordLink[];
  images: Image[];
  seriesDetail: Series;
  makerDetail: Maker;
  originalIssue: CatalogSummary | null;
  reissues: CatalogSummary[];
  alsoOnOtherSeries: CatalogSummary[];
  otherByPerformers: CatalogSummary[];
  myCopies: CollectionItem[];
  revisionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Revision {
  id: number;
  action: 'create' | 'update' | 'delete' | 'restore';
  editor: string;
  editSummary: string | null;
  changedFields: string[];
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  createdAt: string;
}

export interface ConditionGrade {
  id: number; code: string; label: string; score: number;
  description: string | null; sortOrder: number;
}

export interface DefectType {
  id: number; code: string; label: string;
  category: 'structural' | 'surface' | 'audio' | 'core' | 'packaging' | 'contamination';
  description: string | null; careAdvice: string | null;
  isTerminal: boolean; sortOrder: number;
}

export interface CleaningMethod {
  id: number; code: string; label: string; description: string | null;
  safeFor: CylinderMaterial[]; isRisky: boolean; sortOrder: number;
}

export interface ItemDefect {
  id: number; severity: number; location: string | null; notes: string | null;
  isResolved: boolean; notedOn: string; defectType: DefectType;
}

export interface CleaningEvent {
  id: number; cleanedAt: string; method: CleaningMethod | null;
  methodOther: string | null; productsUsed: string | null;
  performedBy: string | null; durationMinutes: number | null;
  outcome: CleaningOutcome | null; notes: string | null;
  beforeImage: Image | null; afterImage: Image | null; createdAt: string;
}

export interface CleaningSummary {
  isCleaned: boolean;
  cleaningCount: number;
  lastCleanedAt: string | null;
  lastMethod: string | null;
  lastNotes: string | null;
}

export interface CollectionItem {
  id: number;
  collectionId: number;
  copyLabel: string | null;
  record: CatalogSummary | null;
  unmatchedTitle: string | null;
  unmatchedMaker: string | null;
  unmatchedNumber: string | null;
  displayTitle: string;
  acquiredOn: string | null;
  acquiredFrom: string | null;
  acquiredPrice: number | null;
  acquiredCurrency: string;
  estimatedValue: number | null;
  conditionGrade: ConditionGrade | null;
  boxGrade: ConditionGrade | null;
  hasOriginalBox: boolean | null;
  hasOriginalLid: boolean | null;
  playbackRating: number | null;
  surfaceNoise: SurfaceNoise | null;
  isPlayable: boolean;
  storageLocation: string | null;
  personalNotes: string | null;
  conditionNotes: string | null;
  isFavourite: boolean;
  isForTrade: boolean;
  defects: ItemDefect[];
  cleaning: CleaningSummary;
  primaryImageUrl: string | null;
  imageCount: number;
  images?: Image[];
  cleanings?: CleaningEvent[];
  playEvents?: PlayEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface PlayEvent {
  id: number; playedAt: string; machine: string | null;
  stylus: string | null; notes: string | null;
}

export interface Lookups {
  conditionGrades: ConditionGrade[];
  defectTypes: DefectType[];
  cleaningMethods: CleaningMethod[];
  makers: (MakerRef & { recordCount: number })[];
  series: (SeriesRef & { makerSlug: string; recordCount: number })[];
  genres: string[];
  collections: { id: number; slug: string; name: string; isDefault: boolean }[];
}

export interface CollectionStats {
  totalItems: number; matchedItems: number; unmatchedItems: number;
  distinctTitles: number; duplicates: number;
  totalSpend: number; estimatedValue: number;
  cleaned: number; neverCleaned: number; cleanedThisYear: number;
  needsAttention: number; playableCount: number; averageGradeScore: number;
  byGrade: { code: string; label: string; count: number }[];
  bySeries: { slug: string; name: string; count: number }[];
  byMaker: { slug: string; name: string; count: number }[];
  byDecade: { decade: number; count: number }[];
  topDefects: { code: string; label: string; count: number }[];
  recentlyAcquired: CollectionItem[];
  recentlyCleaned: CollectionItem[];
  catalogCoverage: { catalogTotal: number; owned: number; percent: number };
}

export interface Warning { code: string; message: string }

// ------------------------------------------------------------------ plumbing

export type QueryValue = string | number | boolean | undefined | null | (string | number)[];

/** Drops empty values and expands arrays into repeated keys. */
export function buildQuery(params: Record<string, QueryValue> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const v of value) if (v !== undefined && v !== null && v !== '') search.append(key, String(v));
    } else {
      search.append(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the register. Is the server running?');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: any = null;
  if (text) {
    try { payload = JSON.parse(text); } catch {
      throw new ApiError(response.status, 'bad_response', 'The server sent something unreadable.');
    }
  }

  if (!response.ok) {
    const err = payload?.error ?? {};
    throw new ApiError(
      response.status,
      err.code ?? 'server_error',
      err.message ?? `Request failed (${response.status}).`,
      err.details,
    );
  }
  return payload as T;
}

const unwrap = <T>(p: Promise<{ data: T }>): Promise<T> => p.then((r) => r.data);

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const put = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

// --------------------------------------------------------------------- calls

export interface CatalogQuery {
  q?: string;
  maker?: string[]; series?: string[]; person?: string[]; genre?: string[];
  material?: string; playMinutes?: number;
  yearFrom?: number; yearTo?: number;
  confidence?: string[]; owned?: boolean; hasAudio?: boolean;
  sort?: string; page?: number; pageSize?: number;
}

export interface CollectionQuery {
  q?: string; collection?: string;
  grade?: string[]; defect?: string[];
  cleaned?: boolean; needsCleaning?: boolean; playable?: boolean;
  favourite?: boolean; forTrade?: boolean;
  series?: string[]; maker?: string[]; material?: string;
  sort?: string; page?: number; pageSize?: number;
}

export const api = {
  health: () => unwrap(get<{ data: { status: string; database: string; records: number } }>('/health')),
  lookups: () => unwrap(get<{ data: Lookups }>('/lookups')),
  reindex: () => unwrap(post<{ data: { reindexed: number } }>('/admin/reindex')),

  catalog: {
    list: (q: CatalogQuery = {}) =>
      get<ListResponse<CatalogSummary>>(`/catalog${buildQuery(q as Record<string, QueryValue>)}`),
    get: (idOrSlug: string | number) => unwrap(get<{ data: CatalogRecord }>(`/catalog/${idOrSlug}`)),
    create: (body: Partial<CatalogRecord> & Record<string, unknown>) =>
      unwrap(post<{ data: CatalogRecord }>('/catalog', body)),
    update: (idOrSlug: string | number, body: Record<string, unknown>) =>
      unwrap(patch<{ data: CatalogRecord }>(`/catalog/${idOrSlug}`, body)),
    remove: (idOrSlug: string | number) => del<void>(`/catalog/${idOrSlug}`),
    revisions: (idOrSlug: string | number) =>
      unwrap(get<{ data: Revision[] }>(`/catalog/${idOrSlug}/revisions`)),
    restore: (idOrSlug: string | number, revisionId: number) =>
      unwrap(post<{ data: CatalogRecord }>(`/catalog/${idOrSlug}/revisions/${revisionId}/restore`)),
    uploadImages: (idOrSlug: string | number, form: FormData) =>
      unwrap(request<{ data: Image[] }>(`/catalog/${idOrSlug}/images`, { method: 'POST', body: form })),
  },

  makers: {
    list: (q: Record<string, QueryValue> = {}) => get<ListResponse<Maker>>(`/makers${buildQuery(q)}`),
    get: (idOrSlug: string | number) => unwrap(get<{ data: Maker }>(`/makers/${idOrSlug}`)),
    update: (idOrSlug: string | number, body: Record<string, unknown>) =>
      unwrap(patch<{ data: Maker }>(`/makers/${idOrSlug}`, body)),
    create: (body: Record<string, unknown>) => unwrap(post<{ data: Maker }>('/makers', body)),
  },

  series: {
    list: (q: Record<string, QueryValue> = {}) => get<ListResponse<Series>>(`/series${buildQuery(q)}`),
    get: (idOrSlug: string | number) => unwrap(get<{ data: Series }>(`/series/${idOrSlug}`)),
    update: (idOrSlug: string | number, body: Record<string, unknown>) =>
      unwrap(patch<{ data: Series }>(`/series/${idOrSlug}`, body)),
    create: (body: Record<string, unknown>) => unwrap(post<{ data: Series }>('/series', body)),
  },

  people: {
    list: (q: Record<string, QueryValue> = {}) => get<ListResponse<Person>>(`/people${buildQuery(q)}`),
    get: (idOrSlug: string | number) => unwrap(get<{ data: Person }>(`/people/${idOrSlug}`)),
    update: (idOrSlug: string | number, body: Record<string, unknown>) =>
      unwrap(patch<{ data: Person }>(`/people/${idOrSlug}`, body)),
    create: (body: Record<string, unknown>) => unwrap(post<{ data: Person }>('/people', body)),
  },

  collection: {
    list: (q: CollectionQuery = {}) =>
      get<ListResponse<CollectionItem>>(`/collection${buildQuery(q as Record<string, QueryValue>)}`),
    get: (id: number) => unwrap(get<{ data: CollectionItem }>(`/collection/${id}`)),
    create: (body: Record<string, unknown>) => unwrap(post<{ data: CollectionItem }>('/collection', body)),
    update: (id: number, body: Record<string, unknown>) =>
      unwrap(patch<{ data: CollectionItem }>(`/collection/${id}`, body)),
    remove: (id: number) => del<void>(`/collection/${id}`),
    stats: () => unwrap(get<{ data: CollectionStats }>('/collection/stats')),

    setDefects: (id: number, defects: Record<string, unknown>[]) =>
      unwrap(put<{ data: ItemDefect[] }>(`/collection/${id}/defects`, { defects })),
    addDefect: (id: number, defect: Record<string, unknown>) =>
      unwrap(post<{ data: ItemDefect }>(`/collection/${id}/defects`, defect)),
    updateDefect: (defectId: number, body: Record<string, unknown>) =>
      unwrap(patch<{ data: ItemDefect }>(`/defects/${defectId}`, body)),
    removeDefect: (defectId: number) => del<void>(`/defects/${defectId}`),

    cleanings: (id: number) => unwrap(get<{ data: CleaningEvent[] }>(`/collection/${id}/cleanings`)),
    /** Resolves to the created event plus any material-safety warnings. */
    addCleaning: (id: number, body: Record<string, unknown>) =>
      post<{ data: CleaningEvent; warnings?: Warning[] }>(`/collection/${id}/cleanings`, body),
    updateCleaning: (cleaningId: number, body: Record<string, unknown>) =>
      patch<{ data: CleaningEvent; warnings?: Warning[] }>(`/cleanings/${cleaningId}`, body),
    removeCleaning: (cleaningId: number) => del<void>(`/cleanings/${cleaningId}`),

    uploadImages: (id: number, form: FormData) =>
      unwrap(request<{ data: Image[] }>(`/collection/${id}/images`, { method: 'POST', body: form })),

    plays: (id: number) => unwrap(get<{ data: PlayEvent[] }>(`/collection/${id}/plays`)),
    addPlay: (id: number, body: Record<string, unknown>) =>
      unwrap(post<{ data: PlayEvent }>(`/collection/${id}/plays`, body)),
    removePlay: (playId: number) => del<void>(`/plays/${playId}`),
  },

  images: {
    update: (imageId: number, body: Record<string, unknown>) =>
      unwrap(patch<{ data: Image }>(`/images/${imageId}`, body)),
    remove: (imageId: number) => del<void>(`/images/${imageId}`),
  },

  wishlist: {
    list: () => get<ListResponse<Record<string, unknown>>>('/wishlist'),
    create: (body: Record<string, unknown>) => unwrap(post<{ data: unknown }>('/wishlist', body)),
    update: (id: number, body: Record<string, unknown>) => unwrap(patch<{ data: unknown }>(`/wishlist/${id}`, body)),
    remove: (id: number) => del<void>(`/wishlist/${id}`),
  },
};

// ------------------------------------------------------------ presentation

/**
 * Renders a date at the precision actually known, so a record dated only to
 * the year reads "1916" rather than a spuriously exact "1 January 1916".
 */
export function formatDate(
  value: string | null | undefined,
  precision: DatePrecision | null | undefined = 'day',
): string {
  if (!value) return '—';
  const date = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return '—';
  switch (precision) {
    case 'decade': return `${Math.floor(date.getFullYear() / 10) * 10}s`;
    case 'year': return String(date.getFullYear());
    case 'month': return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    default: return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  }
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export function formatMoney(value: number | null | undefined, currency = 'USD'): string {
  if (value === null || value === undefined) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export const MATERIAL_LABELS: Record<CylinderMaterial, string> = {
  brown_wax: 'Brown wax',
  black_wax: 'Black wax',
  metallic_soap: 'Metallic soap',
  celluloid: 'Celluloid',
  condensite: 'Condensite',
  unknown: 'Unknown',
};

/** Maps a cylinder's material and series colour onto the .cylinder-* motif class. */
export function cylinderClass(material?: CylinderMaterial | null, colour?: string | null): string {
  const c = (colour ?? '').toLowerCase();
  if (c.includes('purple')) return 'cylinder-purple';
  if (c.includes('blue')) return 'cylinder-blue';
  if (material === 'celluloid') return c.includes('gold') ? 'cylinder-gold' : 'cylinder-blue';
  if (material === 'brown_wax') return 'cylinder-brown';
  if (material === 'black_wax' || material === 'metallic_soap') return 'cylinder-wax';
  return 'cylinder-gold';
}

/** True when a cleaning method is not listed as safe for that material. */
export function isMethodUnsafe(method: CleaningMethod, material?: CylinderMaterial | null): boolean {
  if (!material || !method.safeFor) return false;
  return !method.safeFor.includes(material);
}

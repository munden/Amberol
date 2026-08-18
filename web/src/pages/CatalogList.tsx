/**
 * CatalogList — the master list of every known four-minute cylinder.
 *
 * This is the screen the collector lives in, so three things matter most:
 *   1. One search box that reaches every indexed field, searching as you type.
 *   2. Every filter, the query, the sort and the page held in the URL, so a
 *      view can be bookmarked, shared, and walked back to.
 *   3. An honest report of how the results were found — when the exact search
 *      finds nothing and the server falls back to spelling-tolerant matching,
 *      the page says so rather than pretending.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Button, ButtonLink, EmptyState, ErrorState, Notice, Pagination, Spinner,
  useDebounced, useTitle,
} from '../components/ui';
import { CatalogFilters, type CatalogFilterValues } from '../components/catalog/CatalogFilters';
import { RecordCard, RecordLedger, useMediaQuery } from '../components/catalog/parts';
import {
  api,
  type CatalogQuery, type CatalogSummary, type Facets, type ListResponse, type Lookups,
} from '../lib/api';

const PAGE_SIZE = 50;

const SORTS: { value: string; label: string; needsQuery?: boolean }[] = [
  { value: 'relevance', label: 'Best match', needsQuery: true },
  { value: 'catalog', label: 'Catalog number' },
  { value: '-catalog', label: 'Catalog number, descending' },
  { value: 'title', label: 'Title, A–Z' },
  { value: '-title', label: 'Title, Z–A' },
  { value: 'year', label: 'Year, earliest first' },
  { value: '-year', label: 'Year, latest first' },
  { value: 'maker', label: 'Maker' },
  { value: 'newest', label: 'Recently added' },
];

const ARRAY_KEYS = ['maker', 'series', 'person', 'genre', 'confidence'] as const;

export default function CatalogList() {
  useTitle('The master list');

  const [searchParams, setSearchParams] = useSearchParams();
  const isDesktop = useMediaQuery('(min-width: 64em)');

  // ------------------------------------------------------------- URL state
  const values: CatalogFilterValues = useMemo(() => ({
    maker: searchParams.getAll('maker'),
    series: searchParams.getAll('series'),
    person: searchParams.getAll('person'),
    genre: searchParams.getAll('genre'),
    confidence: searchParams.getAll('confidence'),
    material: searchParams.get('material') ?? '',
    playMinutes: searchParams.get('playMinutes') ?? '',
    yearFrom: searchParams.get('yearFrom') ?? '',
    yearTo: searchParams.get('yearTo') ?? '',
    owned: searchParams.get('owned') ?? '',
    hasAudio: searchParams.get('hasAudio') === 'true',
  }), [searchParams]);

  const urlQuery = searchParams.get('q') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const sort = searchParams.get('sort') ?? (urlQuery ? 'relevance' : 'catalog');
  const viewParam = searchParams.get('view');
  const view = viewParam === 'cards' || viewParam === 'table'
    ? viewParam
    : (isDesktop ? 'table' : 'cards');

  const activeCount =
    values.maker.length + values.series.length + values.person.length +
    values.genre.length + values.confidence.length +
    (values.material ? 1 : 0) + (values.playMinutes ? 1 : 0) +
    (values.yearFrom ? 1 : 0) + (values.yearTo ? 1 : 0) +
    (values.owned ? 1 : 0) + (values.hasAudio ? 1 : 0);

  const update = useCallback(
    (mutate: (next: URLSearchParams) => void,
     options: { keepPage?: boolean; replace?: boolean } = {}) => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        mutate(next);
        if (!options.keepPage) next.delete('page');
        return next;
      }, { replace: options.replace ?? false });
    },
    [setSearchParams],
  );

  const setValue = useCallback((key: string, value: string | boolean) => {
    update((next) => {
      const raw = typeof value === 'boolean' ? (value ? 'true' : '') : value;
      if (!raw) next.delete(key); else next.set(key, raw);
    });
  }, [update]);

  const setMany = useCallback((patch: Record<string, string | boolean | undefined>) => {
    update((next) => {
      for (const [key, value] of Object.entries(patch)) {
        const raw = typeof value === 'boolean' ? (value ? 'true' : '') : (value ?? '');
        if (!raw) next.delete(key); else next.set(key, raw);
      }
    });
  }, [update]);

  const toggleValue = useCallback((key: string, value: string) => {
    update((next) => {
      const existing = next.getAll(key);
      next.delete(key);
      const wanted = existing.includes(value)
        ? existing.filter((v) => v !== value)
        : [...existing, value];
      for (const v of wanted) next.append(key, v);
    });
  }, [update]);

  const clearFilters = useCallback(() => {
    update((next) => {
      for (const key of [...ARRAY_KEYS, 'material', 'playMinutes', 'yearFrom', 'yearTo',
                         'owned', 'hasAudio']) next.delete(key);
    });
  }, [update]);

  // ------------------------------------------------- search as you type
  const [queryInput, setQueryInput] = useState(urlQuery);
  const debouncedQuery = useDebounced(queryInput, 280);
  const syncedQuery = useRef(urlQuery);

  useEffect(() => {
    if (debouncedQuery === syncedQuery.current) return;
    syncedQuery.current = debouncedQuery;
    update((next) => {
      if (debouncedQuery) next.set('q', debouncedQuery); else next.delete('q');
      // A relevance sort is meaningless without a query, and vice versa.
      if (!debouncedQuery && next.get('sort') === 'relevance') next.delete('sort');
    }, { replace: true });
  }, [debouncedQuery, update]);

  // Keeps the box in step when the URL changes underneath it — the back button,
  // or a link from somewhere else in the register.
  useEffect(() => {
    if (urlQuery !== syncedQuery.current) {
      syncedQuery.current = urlQuery;
      setQueryInput(urlQuery);
    }
  }, [urlQuery]);

  // ---------------------------------------------------------------- data
  const query: CatalogQuery = useMemo(() => ({
    q: urlQuery || undefined,
    maker: values.maker.length ? values.maker : undefined,
    series: values.series.length ? values.series : undefined,
    person: values.person.length ? values.person : undefined,
    genre: values.genre.length ? values.genre : undefined,
    confidence: values.confidence.length ? values.confidence : undefined,
    material: values.material || undefined,
    playMinutes: values.playMinutes ? Number(values.playMinutes) : undefined,
    yearFrom: values.yearFrom ? Number(values.yearFrom) : undefined,
    yearTo: values.yearTo ? Number(values.yearTo) : undefined,
    owned: values.owned ? values.owned === 'true' : undefined,
    hasAudio: values.hasAudio ? true : undefined,
    sort,
    page,
    pageSize: PAGE_SIZE,
  }), [urlQuery, values, sort, page]);

  const [response, setResponse] = useState<ListResponse<CatalogSummary> | null>(null);
  const [facets, setFacets] = useState<Facets | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.catalog.list(query)
      .then((result) => {
        if (cancelled) return;
        setResponse(result);
        // Facets are kept from the last successful answer so the filter panel
        // does not collapse while a new search is in flight.
        if (result.facets) setFacets(result.facets);
      })
      .catch((err) => { if (!cancelled) { setError(err); setResponse(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, reloadToken]);

  // Lookups give the material and playing-time options; failure is survivable.
  const [lookups, setLookups] = useState<Lookups | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.lookups().then((data) => { if (!cancelled) setLookups(data); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Names for any person filtered on, so the chip reads "W. Van Brunt", not a slug.
  const [personLabels, setPersonLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    for (const slug of values.person) {
      if (personLabels[slug]) continue;
      api.people.get(slug)
        .then((person) => {
          if (!cancelled) setPersonLabels((prev) => ({ ...prev, [slug]: person.name }));
        })
        .catch(() => {});
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.person.join('|')]);

  const records = response?.data ?? [];
  const total = response?.total ?? 0;
  const totalPages = response?.totalPages ?? 0;
  const matchMode = response?.matchMode;
  const firstRow = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(page * PAGE_SIZE, total);

  const countLine = loading
    ? 'Searching the register…'
    : total === 0
      ? 'No records found.'
      : total <= PAGE_SIZE
        ? `${total} record${total === 1 ? '' : 's'}.`
        : `Showing ${firstRow}–${lastRow} of ${total} records.`;

  const [filtersOpen, setFiltersOpen] = useState(false);
  const showFilterPanel = isDesktop || filtersOpen;

  const filterPanel = (
    <CatalogFilters
      values={values}
      facets={facets}
      lookups={lookups}
      personLabels={personLabels}
      activeCount={activeCount}
      onToggle={(key, value) => toggleValue(key, value)}
      onSet={(key, value) => setValue(key, value)}
      onSetMany={(patch) => setMany(patch as Record<string, string | boolean | undefined>)}
      onClear={clearFilters}
    />
  );

  return (
    <div className="page">
      <header style={{ marginBottom: 'var(--space-5)' }}>
        <div className="eyebrow">The register</div>
        <div className="spread" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '0.06em' }}>
            Master list
          </h1>
          <div className="row no-print">
            <ButtonLink to="/browse" variant="ghost" size="sm">Browse by maker</ButtonLink>
            <ButtonLink to="/catalog/new" variant="brass" size="sm">Add a record</ButtonLink>
          </div>
        </div>
        {/* On a phone the search box must be within thumb's reach at the shelf,
            so the long preamble is kept for the desk. */}
        <p
          className="hide-mobile"
          style={{ color: 'var(--fg-soft)', maxWidth: 'var(--measure)', marginTop: 'var(--space-2)' }}
        >
          Every known four-minute cylinder in the register. Search reaches titles,
          catalog and matrix numbers, performers and their pseudonyms, series, places,
          descriptions, notes, lyrics and provenance.
        </p>
      </header>

      {/* ------------------------------------------------------- search bar */}
      <form
        role="search"
        className="plate no-print"
        onSubmit={(e) => e.preventDefault()}
        style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-5)' }}
      >
        <label className="field-label" htmlFor="catalog-search">
          Search the whole register
        </label>
        <div className="row" style={{ flexWrap: 'nowrap', gap: 'var(--space-2)' }}>
          <input
            id="catalog-search"
            className="field"
            type="search"
            autoComplete="off"
            enterKeyHint="search"
            placeholder="Title, number, performer, a phrase from the notes…"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
          />
          {queryInput && (
            <Button type="button" variant="ghost" onClick={() => setQueryInput('')}>
              Clear<span className="visually-hidden"> the search</span>
            </Button>
          )}
        </div>
        <div className="field-hint">
          Every field is searched, descriptions, notes, lyrics and provenance included.
        </div>

        <div
          className="row"
          style={{ marginTop: 'var(--space-3)', justifyContent: 'space-between' }}
        >
          <div className="row" style={{ gap: 'var(--space-2)' }}>
            <label className="label-type" htmlFor="catalog-sort">Order</label>
            <select
              id="catalog-sort"
              className="field"
              style={{ width: 'auto', minWidth: '12rem' }}
              value={sort}
              onChange={(e) => setValue('sort', e.target.value)}
            >
              {SORTS.filter((s) => !s.needsQuery || urlQuery).map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          <div className="row" style={{ gap: 'var(--space-2)' }}>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="hide-desktop"
              aria-expanded={filtersOpen}
              aria-controls="catalog-filters"
              onClick={() => setFiltersOpen((v) => !v)}
            >
              Filters{activeCount ? ` (${activeCount})` : ''}
            </Button>
            <div className="row" role="group" aria-label="View" style={{ gap: 'var(--space-1)' }}>
              <Button
                type="button" size="sm" variant={view === 'table' ? 'brass' : 'ghost'}
                aria-pressed={view === 'table'}
                onClick={() => setValue('view', 'table')}
              >
                Ledger
              </Button>
              <Button
                type="button" size="sm" variant={view === 'cards' ? 'brass' : 'ghost'}
                aria-pressed={view === 'cards'}
                onClick={() => setValue('view', 'cards')}
              >
                Cards
              </Button>
            </div>
          </div>
        </div>
      </form>

      <div
        style={{
          display: 'grid',
          gap: 'var(--space-6)',
          gridTemplateColumns: isDesktop ? 'minmax(0, 1fr) 17rem' : 'minmax(0, 1fr)',
          alignItems: 'start',
        }}
      >
        {/* ------------------------------------------------------- results */}
        <div style={{ minWidth: 0 }}>
          <div
            aria-live="polite"
            className="label-type"
            style={{ marginBottom: 'var(--space-3)' }}
          >
            {countLine}
          </div>

          {matchMode === 'fuzzy' && !loading && total > 0 && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <Notice tone="warn" title="Nothing matched exactly">
                Showing near matches for <strong>{urlQuery}</strong> — the register looked
                for close spellings instead. Try a shorter word, or part of a name.
              </Notice>
            </div>
          )}

          {error ? (
            <ErrorState error={error} onRetry={() => setReloadToken((n) => n + 1)} />
          ) : loading && !records.length ? (
            <Spinner label="Reading the register" />
          ) : !records.length ? (
            <EmptyState
              title={urlQuery ? 'Nothing under that heading' : 'The register is empty'}
              action={
                activeCount > 0
                  ? <Button onClick={clearFilters}>Clear the filters</Button>
                  : <ButtonLink to="/catalog/new" variant="brass">Add the first record</ButtonLink>
              }
            >
              {urlQuery ? (
                <>
                  No record matched <strong>{urlQuery}</strong>
                  {activeCount > 0 && ', with the filters you have set'}. Try a catalog
                  number on its own (<span className="stamp-type">2848</span>), a
                  performer’s surname, or a few words from a description — the search
                  reaches notes, lyrics and provenance too.
                </>
              ) : activeCount > 0 ? (
                <>No record matches these filters. Loosen one and try again.</>
              ) : (
                <>
                  Nothing has been catalogued yet. Add a cylinder, or start from{' '}
                  <Link to="/browse">the browse index</Link>.
                </>
              )}
            </EmptyState>
          ) : (
            <div style={{ opacity: loading ? 0.55 : 1, transition: 'opacity var(--dur) var(--ease)' }}>
              {view === 'table' ? (
                <RecordLedger records={records} />
              ) : (
                <div style={{
                  display: 'grid',
                  // minmax(0, 1fr) rather than a bare auto track: an auto track
                  // takes its minimum from its content, so one long unbroken
                  // title pushes every card wider than the phone.
                  gridTemplateColumns: 'minmax(0, 1fr)',
                  gap: 'var(--space-4)',
                }}>
                  {records.map((record) => <RecordCard key={record.id} record={record} />)}
                </div>
              )}
              <Pagination
                page={page}
                totalPages={totalPages}
                onPage={(p) => {
                  update((next) => next.set('page', String(p)), { keepPage: true });
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            </div>
          )}
        </div>

        {/* ------------------------------------------------------- filters */}
        {showFilterPanel && (
          <aside
            id="catalog-filters"
            className="plate no-print"
            aria-label="Filters"
            style={{ padding: 'var(--space-4)', order: isDesktop ? 0 : -1 }}
          >
            <h2
              className="label-type"
              style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--text-sm)' }}
            >
              Narrow the list
            </h2>
            {filterPanel}
            {!isDesktop && (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <Button variant="ghost" onClick={() => setFiltersOpen(false)}>
                  Done
                </Button>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

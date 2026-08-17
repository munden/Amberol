/**
 * The shelf — every cylinder the collector owns.
 *
 * Everything that narrows the list lives in the URL, so a view such as
 * "wax cylinders never cleaned, worst grade first" can be bookmarked, sent to
 * somebody, or reached again with the back button.
 *
 * On a phone the rows become cards, because this is the screen used standing
 * at the shelf with a cylinder in one hand.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Badge, Button, ButtonLink, EmptyState, ErrorState, Pagination, Spinner,
  StarRating, TextField, useDebounced, useTitle,
} from '../components/ui';
import {
  MATERIAL_LABELS, api, formatDate, formatMoney,
} from '../lib/api';
import type { CollectionItem, CollectionQuery, CylinderMaterial, ListResponse } from '../lib/api';
import { CleanedStamp, DefectBadges, Flags, Thumb } from '../components/collection/bits';
import { useAsync, useLookups, useMediaQuery } from '../components/collection/hooks';
import '../components/collection/collection.css';

const PAGE_SIZE = 24;

const SORTS: { value: string; label: string }[] = [
  { value: 'acquired', label: 'Date acquired' },
  { value: 'title', label: 'Title' },
  { value: 'catalog', label: 'Catalog number' },
  { value: 'grade', label: 'Condition grade' },
  { value: 'cleaned', label: 'Last cleaned' },
  { value: 'rating', label: 'Playback rating' },
  { value: 'value', label: 'Estimated value' },
];

const MATERIALS = Object.keys(MATERIAL_LABELS) as CylinderMaterial[];

/** The filter keys that count as "narrowed", for the empty-state wording. */
const FILTER_KEYS = [
  'q', 'grade', 'defect', 'cleaned', 'needsCleaning', 'playable',
  'favourite', 'forTrade', 'series', 'maker', 'material',
];

export default function CollectionList() {
  useTitle('The shelf');
  const [searchParams, setSearchParams] = useSearchParams();
  const wide = useMediaQuery('(min-width: 60em)');
  const lookups = useLookups();

  // ---------------------------------------------------------------- the URL
  const urlQ = searchParams.get('q') ?? '';
  const grades = searchParams.getAll('grade');
  const defects = searchParams.getAll('defect');
  const series = searchParams.getAll('series');
  const makers = searchParams.getAll('maker');
  const material = searchParams.get('material') ?? '';
  const cleaned = searchParams.get('cleaned') ?? '';
  const playable = searchParams.get('playable') ?? '';
  const needsCleaning = searchParams.get('needsCleaning') === 'true';
  const favourite = searchParams.get('favourite') === 'true';
  const forTrade = searchParams.get('forTrade') === 'true';
  const sortParam = searchParams.get('sort') ?? 'acquired';
  const descending = sortParam.startsWith('-');
  const sortKey = descending ? sortParam.slice(1) : sortParam;
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const activeFilters = FILTER_KEYS.filter((k) => searchParams.getAll(k).length > 0).length;

  function update(
    patch: Record<string, string | string[] | null>,
    options: { keepPage?: boolean; replace?: boolean } = {},
  ) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      next.delete(key);
      if (Array.isArray(value)) value.forEach((v) => next.append(key, v));
      else if (value !== null && value !== '') next.set(key, value);
    }
    if (!options.keepPage) next.delete('page');
    setSearchParams(next, { replace: options.replace ?? false });
  }

  function toggleInList(key: string, value: string) {
    const current = searchParams.getAll(key);
    update({ [key]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value] });
  }

  // ------------------------------------------------------- search box wiring
  const [qInput, setQInput] = useState(urlQ);
  const debouncedQ = useDebounced(qInput, 320);
  const lastWritten = useRef(urlQ);

  useEffect(() => {
    if (debouncedQ === lastWritten.current) return;
    lastWritten.current = debouncedQ;
    update({ q: debouncedQ || null }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  useEffect(() => {
    // The back button, or a link that carries its own q, wins over the box.
    if (urlQ === lastWritten.current) return;
    lastWritten.current = urlQ;
    setQInput(urlQ);
  }, [urlQ]);

  // ----------------------------------------------------------------- fetch
  const key = searchParams.toString();
  const query: CollectionQuery = {
    q: urlQ || undefined,
    grade: grades.length ? grades : undefined,
    defect: defects.length ? defects : undefined,
    series: series.length ? series : undefined,
    maker: makers.length ? makers : undefined,
    material: material || undefined,
    cleaned: cleaned === 'true' ? true : cleaned === 'false' ? false : undefined,
    playable: playable === 'true' ? true : playable === 'false' ? false : undefined,
    needsCleaning: needsCleaning || undefined,
    favourite: favourite || undefined,
    forTrade: forTrade || undefined,
    sort: sortParam,
    page,
    pageSize: PAGE_SIZE,
  };

  const state = useAsync<ListResponse<CollectionItem>>(() => api.collection.list(query), [key]);
  const { data, error, loading, reload } = state;

  const [showFilters, setShowFilters] = useState(false);
  useEffect(() => { if (wide) setShowFilters(true); }, [wide]);

  const items = data?.data ?? [];
  const conditionGrades = lookups.data?.conditionGrades ?? [];
  const defectTypes = lookups.data?.defectTypes ?? [];
  const seriesList = lookups.data?.series ?? [];
  const makerList = lookups.data?.makers ?? [];

  const labelFor = (list: { slug: string; name: string }[], slug: string) =>
    list.find((entry) => entry.slug === slug)?.name ?? slug;

  function setSort(nextKey: string) {
    if (nextKey === sortKey) update({ sort: descending ? nextKey : `-${nextKey}` });
    else update({ sort: nextKey === 'title' || nextKey === 'catalog' ? nextKey : `-${nextKey}` });
  }

  const sortHeader = (nextKey: string, label: string) => (
    <th scope="col" aria-sort={sortKey === nextKey ? (descending ? 'descending' : 'ascending') : undefined}>
      <button type="button" className="cx-sortlink" onClick={() => setSort(nextKey)}>
        {label}{sortKey === nextKey ? (descending ? ' ▾' : ' ▴') : ''}
      </button>
    </th>
  );

  return (
    <div className="page">
      <header className="cx-head">
        <div>
          <p className="eyebrow">My Amberola</p>
          <h1>The shelf</h1>
        </div>
        <div className="row no-print">
          <ButtonLink to="/dashboard" variant="ghost">Summary</ButtonLink>
          <ButtonLink to="/collection/new" variant="primary">Add a cylinder</ButtonLink>
        </div>
      </header>

      {/* ------------------------------------------------------ search & filters */}
      <section className="plate no-print" aria-label="Search and filter the shelf">
        <div className="cx-search">
          <TextField
            label="Search the shelf"
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Title, performer, number — or your own notes"
            hint="Searches the catalog entry and everything you have written yourself."
          />
        </div>

        <div className="row" style={{ marginTop: 'var(--space-3)' }}>
          <Button
            variant="ghost"
            aria-expanded={showFilters}
            onClick={() => setShowFilters((v) => !v)}
          >
            {showFilters ? 'Hide filters' : 'Filters'}
            {activeFilters > 0 ? ` · ${activeFilters}` : ''}
          </Button>

          <label className="row" style={{ gap: 'var(--space-2)' }}>
            <span className="label-type">Order by</span>
            <select
              className="field"
              style={{ width: 'auto' }}
              value={sortKey}
              onChange={(e) => setSort(e.target.value)}
              aria-label="Order the shelf by"
            >
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <Button
            variant="ghost"
            onClick={() => update({ sort: descending ? sortKey : `-${sortKey}` })}
            aria-label={descending ? 'Sort ascending' : 'Sort descending'}
          >
            {descending ? '▾ Descending' : '▴ Ascending'}
          </Button>

          {activeFilters > 0 && (
            <Button
              variant="ghost"
              onClick={() => {
                setQInput('');
                lastWritten.current = '';
                setSearchParams(new URLSearchParams(sortParam === 'acquired' ? '' : `sort=${sortParam}`));
              }}
            >
              Clear all
            </Button>
          )}
        </div>

        {showFilters && (
          <div className="cx-filter-grid">
            {/* Condition grade */}
            <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
              <legend className="label-type">Condition grade</legend>
              <div className="cx-chiprow">
                {conditionGrades.map((grade) => (
                  <button
                    key={grade.code}
                    type="button"
                    className="cx-chip"
                    aria-pressed={grades.includes(grade.code)}
                    title={grade.description ?? grade.label}
                    onClick={() => toggleInList('grade', grade.code)}
                  >
                    {grade.code}
                  </button>
                ))}
              </div>
            </fieldset>

            {/* Cleaning */}
            <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
              <legend className="label-type">Cleaning</legend>
              <div className="cx-chiprow">
                <button
                  type="button"
                  className="cx-chip"
                  aria-pressed={cleaned === 'true'}
                  onClick={() => update({ cleaned: cleaned === 'true' ? null : 'true' })}
                >
                  Cleaned
                </button>
                <button
                  type="button"
                  className="cx-chip"
                  aria-pressed={cleaned === 'false'}
                  onClick={() => update({ cleaned: cleaned === 'false' ? null : 'false' })}
                >
                  Never cleaned
                </button>
                <button
                  type="button"
                  className="cx-chip"
                  aria-pressed={needsCleaning}
                  title="Never cleaned, or last cleaned over a year ago"
                  onClick={() => update({ needsCleaning: needsCleaning ? null : 'true' })}
                >
                  Needs cleaning
                </button>
              </div>
            </fieldset>

            {/* State */}
            <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
              <legend className="label-type">State</legend>
              <div className="cx-chiprow">
                <button
                  type="button"
                  className="cx-chip"
                  aria-pressed={playable === 'true'}
                  onClick={() => update({ playable: playable === 'true' ? null : 'true' })}
                >
                  Playable
                </button>
                <button
                  type="button"
                  className="cx-chip"
                  aria-pressed={playable === 'false'}
                  onClick={() => update({ playable: playable === 'false' ? null : 'false' })}
                >
                  Not playable
                </button>
                <button
                  type="button"
                  className="cx-chip"
                  aria-pressed={favourite}
                  onClick={() => update({ favourite: favourite ? null : 'true' })}
                >
                  ★ Favourite
                </button>
                <button
                  type="button"
                  className="cx-chip"
                  aria-pressed={forTrade}
                  onClick={() => update({ forTrade: forTrade ? null : 'true' })}
                >
                  For trade
                </button>
              </div>
            </fieldset>

            {/* Defect */}
            <div>
              <label className="field-label" htmlFor="filter-defect">Fault</label>
              <select
                id="filter-defect"
                className="field"
                value=""
                onChange={(e) => { if (e.target.value) toggleInList('defect', e.target.value); }}
              >
                <option value="">Add a fault…</option>
                {defectTypes.map((t) => (
                  <option key={t.code} value={t.code} disabled={defects.includes(t.code)}>
                    {t.label}{t.isTerminal ? ' (terminal)' : ''}
                  </option>
                ))}
              </select>
              {defects.length > 0 && (
                <div className="cx-chiprow">
                  {defects.map((code) => (
                    <button
                      key={code}
                      type="button"
                      className="cx-chip is-on cx-chip-remove"
                      onClick={() => toggleInList('defect', code)}
                    >
                      {defectTypes.find((t) => t.code === code)?.label ?? code} ✕
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Series */}
            <div>
              <label className="field-label" htmlFor="filter-series">Series</label>
              <select
                id="filter-series"
                className="field"
                value=""
                onChange={(e) => { if (e.target.value) toggleInList('series', e.target.value); }}
              >
                <option value="">Add a series…</option>
                {seriesList.map((s) => (
                  <option key={s.slug} value={s.slug} disabled={series.includes(s.slug)}>
                    {s.name}
                  </option>
                ))}
              </select>
              {series.length > 0 && (
                <div className="cx-chiprow">
                  {series.map((slug) => (
                    <button
                      key={slug}
                      type="button"
                      className="cx-chip is-on cx-chip-remove"
                      onClick={() => toggleInList('series', slug)}
                    >
                      {labelFor(seriesList, slug)} ✕
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Maker */}
            <div>
              <label className="field-label" htmlFor="filter-maker">Maker</label>
              <select
                id="filter-maker"
                className="field"
                value=""
                onChange={(e) => { if (e.target.value) toggleInList('maker', e.target.value); }}
              >
                <option value="">Add a maker…</option>
                {makerList.map((m) => (
                  <option key={m.slug} value={m.slug} disabled={makers.includes(m.slug)}>
                    {m.name}
                  </option>
                ))}
              </select>
              {makers.length > 0 && (
                <div className="cx-chiprow">
                  {makers.map((slug) => (
                    <button
                      key={slug}
                      type="button"
                      className="cx-chip is-on cx-chip-remove"
                      onClick={() => toggleInList('maker', slug)}
                    >
                      {labelFor(makerList, slug)} ✕
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Material */}
            <div>
              <label className="field-label" htmlFor="filter-material">Material</label>
              <select
                id="filter-material"
                className="field"
                value={material}
                onChange={(e) => update({ material: e.target.value || null })}
              >
                <option value="">Any material</option>
                {MATERIALS.map((m) => (
                  <option key={m} value={m}>{MATERIAL_LABELS[m]}</option>
                ))}
              </select>
            </div>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------- results */}
      <div className="spread" style={{ margin: 'var(--space-5) 0 var(--space-3)' }}>
        <p className="label-type" style={{ margin: 0 }} aria-live="polite">
          {loading && !data ? 'Counting the shelf…' : data
            ? `${data.total} ${data.total === 1 ? 'cylinder' : 'cylinders'}` +
              (data.total > 0
                ? ` · showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, data.total)}`
                : '')
            : ''}
        </p>
        {needsCleaning && <Badge tone="warn">Needing cleaning</Badge>}
      </div>

      {error != null && <ErrorState error={error} onRetry={reload} />}

      {loading && !data && <Spinner label="Fetching the shelf" />}

      {!loading && !error && items.length === 0 && (
        activeFilters === 0 ? (
          <EmptyState
            title="Your shelf is empty"
            action={<ButtonLink to="/collection/new" variant="primary">Add your first cylinder</ButtonLink>}
          >
            <p>
              This is where your own cylinders live — what you paid, how each one plays, the
              faults you have found, and when you last cleaned it and how.
            </p>
            <p style={{ marginBottom: 0 }}>
              Start with whatever is nearest to hand. Search the master catalog for the title, or
              enter it yourself if it is not listed; everything else can be filled in later.
            </p>
          </EmptyState>
        ) : (
          <EmptyState
            title="Nothing on the shelf matches"
            action={
              <Button
                variant="primary"
                onClick={() => {
                  setQInput('');
                  lastWritten.current = '';
                  setSearchParams(new URLSearchParams());
                }}
              >
                Clear the filters
              </Button>
            }
          >
            <p style={{ marginBottom: 0 }}>
              No cylinder you own answers to that description. Widen the search, or clear the
              filters and start again.
            </p>
          </EmptyState>
        )
      )}

      {items.length > 0 && (wide ? (
        <div className="table-scroll">
          <table className="ledger cx-ledger">
            <thead>
              <tr>
                <th scope="col"><span className="visually-hidden">Photograph</span></th>
                {sortHeader('title', 'Title')}
                {sortHeader('catalog', 'Number')}
                {sortHeader('grade', 'Grade')}
                {sortHeader('rating', 'Play')}
                <th scope="col">Faults</th>
                {sortHeader('cleaned', 'Cleaned')}
                {sortHeader('acquired', 'Acquired')}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link to={`/collection/${item.id}`} aria-label={`Open ${item.displayTitle}`}>
                      <Thumb item={item} showCount />
                    </Link>
                  </td>
                  <td>
                    <Link to={`/collection/${item.id}`} className="cx-ledger-title">
                      {item.displayTitle}
                    </Link>
                    <div className="cx-meta">
                      {item.record ? (
                        <span>{item.record.series.name}</span>
                      ) : (
                        <span>{item.unmatchedMaker ?? 'Unidentified copy'}</span>
                      )}
                      {item.record && <span>{MATERIAL_LABELS[item.record.series.material]}</span>}
                      {item.copyLabel && <span>{item.copyLabel}</span>}
                    </div>
                    <Flags item={item} />
                  </td>
                  <td className="stamp-type">
                    {item.record?.catalogNumber ?? item.unmatchedNumber ?? '—'}
                  </td>
                  <td>
                    {item.conditionGrade ? (
                      <span title={item.conditionGrade.description ?? undefined}>
                        <strong className="stamp-type">{item.conditionGrade.code}</strong>{' '}
                        <span style={{ color: 'var(--fg-soft)', fontSize: 'var(--text-sm)' }}>
                          {item.conditionGrade.label}
                        </span>
                      </span>
                    ) : <span style={{ color: 'var(--fg-faint)' }}>Ungraded</span>}
                  </td>
                  <td><StarRating value={item.playbackRating} readOnly /></td>
                  <td><DefectBadges defects={item.defects} max={3} /></td>
                  <td><CleanedStamp cleaning={item.cleaning} /></td>
                  <td className="stamp-type">
                    {item.acquiredOn ? formatDate(item.acquiredOn, 'day') : '—'}
                    {item.acquiredPrice !== null && (
                      <div style={{ color: 'var(--fg-soft)' }}>
                        {formatMoney(item.acquiredPrice, item.acquiredCurrency)}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="cx-cards">
          {items.map((item) => (
            <Link key={item.id} to={`/collection/${item.id}`} className="cx-card">
              <Thumb item={item} width={92} height={62} showCount />
              <div className="cx-card-body">
                <p className="cx-card-title">{item.displayTitle}</p>
                <div className="cx-meta">
                  <span className="stamp-type">
                    {item.record?.catalogNumber ?? item.unmatchedNumber ?? 'No number'}
                  </span>
                  <span>{item.record?.series.name ?? item.unmatchedMaker ?? 'Unidentified'}</span>
                </div>
                <div className="cx-meta" style={{ marginTop: 'var(--space-1)' }}>
                  <span>
                    <span className="label-type">Grade</span>{' '}
                    <strong className="stamp-type">{item.conditionGrade?.code ?? '—'}</strong>
                  </span>
                  <StarRating value={item.playbackRating} readOnly />
                </div>
                <div style={{ marginTop: 'var(--space-2)' }}>
                  <CleanedStamp cleaning={item.cleaning} />
                </div>
                <div style={{ marginTop: 'var(--space-2)' }}>
                  <DefectBadges defects={item.defects} max={3} />
                </div>
                <div style={{ marginTop: 'var(--space-2)' }}>
                  <Flags item={item} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      ))}

      {data && data.totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={data.totalPages}
          onPage={(p) => {
            update({ page: String(p) }, { keepPage: true });
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        />
      )}
    </div>
  );
}

/**
 * BrowseIndex — the way in for someone who does not yet know what to search
 * for. Set as the index pages at the back of a printed catalog: the makers
 * and their series, the series with their material and dates, and the artist
 * index with the pseudonyms spelled out.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Badge, Button, ButtonLink, EmptyState, ErrorState, Fleuron, Spinner, useDebounced, useTitle,
} from '../components/ui';
import { MATERIAL_LABELS, api, type Maker, type Person, type Series } from '../lib/api';
import { materialTone, seriesLine } from '../components/catalog/parts';

type Tab = 'makers' | 'series' | 'people';

const TABS: { value: Tab; label: string }[] = [
  { value: 'makers', label: 'Makers' },
  { value: 'series', label: 'Series' },
  { value: 'people', label: 'Artists' },
];

/** The letter a name files under, for the printed-index rules at the top. */
function initial(person: Person): string {
  const source = person.sortName || person.fullName || person.name || '';
  const letter = source.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(letter) ? letter : '#';
}

export default function BrowseIndex() {
  useTitle('Browse the register');

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('index');
  const tab: Tab = tabParam === 'series' || tabParam === 'people' ? tabParam : 'makers';

  const [makers, setMakers] = useState<Maker[] | null>(null);
  const [series, setSeries] = useState<Series[] | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [peopleTotal, setPeopleTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [personQuery, setPersonQuery] = useState(searchParams.get('who') ?? '');
  const debouncedPersonQuery = useDebounced(personQuery, 280);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.makers.list({ pageSize: 200, sort: 'records' }),
      api.series.list({ pageSize: 200, sort: 'records' }),
    ])
      .then(([makerResult, seriesResult]) => {
        if (cancelled) return;
        setMakers(makerResult.data ?? []);
        setSeries(seriesResult.data ?? []);
      })
      .catch((err) => { if (!cancelled) setError(err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadToken]);

  useEffect(() => {
    let cancelled = false;
    api.people.list({
      pageSize: 200,
      sort: debouncedPersonQuery ? 'records' : 'name',
      q: debouncedPersonQuery || undefined,
    })
      .then((result) => {
        if (cancelled) return;
        setPeople(result.data ?? []);
        setPeopleTotal(result.total ?? 0);
      })
      .catch(() => { if (!cancelled) setPeople([]); });
    return () => { cancelled = true; };
  }, [debouncedPersonQuery, reloadToken]);

  const seriesByMaker = useMemo(() => {
    const map = new Map<string, Series[]>();
    for (const item of series ?? []) {
      const key = item.maker?.slug ?? '';
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return map;
  }, [series]);

  const letters = useMemo(() => {
    const set = new Set<string>();
    for (const person of people ?? []) set.add(initial(person));
    return [...set].sort();
  }, [people]);

  const peopleByLetter = useMemo(() => {
    const map = new Map<string, Person[]>();
    for (const person of people ?? []) {
      const letter = initial(person);
      const list = map.get(letter) ?? [];
      list.push(person);
      map.set(letter, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.sortName || a.name).localeCompare(b.sortName || b.name));
    }
    return map;
  }, [people]);

  const setTab = (next: Tab) => {
    const params = new URLSearchParams(searchParams);
    params.set('index', next);
    setSearchParams(params, { replace: true });
  };

  if (loading) return <div className="page"><Spinner label="Setting the index" /></div>;
  if (error) {
    return (
      <div className="page">
        <ErrorState error={error} onRetry={() => setReloadToken((n) => n + 1)} />
      </div>
    );
  }

  const nothingAtAll = !makers?.length && !series?.length && !people?.length;

  return (
    <div className="page">
      <header style={{ marginBottom: 'var(--space-5)' }}>
        <div className="eyebrow">The register</div>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '0.06em' }}>
          Index
        </h1>
        <p style={{ color: 'var(--fg-soft)', maxWidth: 'var(--measure)' }}>
          The makers and their product lines, and every artist credited on a cylinder
          in the register. If you know a name but not a title, start here.
        </p>
      </header>

      {nothingAtAll ? (
        <EmptyState
          title="Nothing indexed yet"
          action={<ButtonLink to="/catalog/new" variant="brass">Add the first record</ButtonLink>}
        >
          No makers, series or artists have been recorded. The index fills itself as
          the master list grows.
        </EmptyState>
      ) : (
        <>
          <nav
            className="row no-print"
            aria-label="Index sections"
            style={{ marginBottom: 'var(--space-5)' }}
          >
            {TABS.map((item) => (
              <Button
                key={item.value}
                variant={tab === item.value ? 'brass' : 'ghost'}
                aria-current={tab === item.value ? 'page' : undefined}
                onClick={() => setTab(item.value)}
              >
                {item.label}
              </Button>
            ))}
          </nav>

          {/* ------------------------------------------------------ makers */}
          {tab === 'makers' && (
            <section aria-label="Makers" style={{ display: 'grid', gap: 'var(--space-5)' }}>
              {!makers?.length && (
                <p style={{ color: 'var(--fg-faint)' }}>No makers recorded yet.</p>
              )}
              {makers?.map((maker) => (
                <article key={maker.id} className="plate" style={{ padding: 'var(--space-4)' }}>
                  <div className="spread" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>
                        <Link to={`/makers/${maker.slug}`}>{maker.name}</Link>
                      </h2>
                      <div className="label-type">
                        {[maker.city, maker.country].filter(Boolean).join(', ')}
                        {(maker.foundedYear || maker.dissolvedYear)
                          ? ` · ${maker.foundedYear ?? '?'}–${maker.dissolvedYear ?? 'present'}`
                          : ''}
                      </div>
                    </div>
                    <Link to={`/catalog?maker=${maker.slug}`} className="label-type">
                      {maker.recordCount} record{maker.recordCount === 1 ? '' : 's'} →
                    </Link>
                  </div>

                  {maker.summary && (
                    <p style={{ margin: 'var(--space-2) 0 0', color: 'var(--fg-soft)' }}>
                      {maker.summary}
                    </p>
                  )}

                  {(seriesByMaker.get(maker.slug)?.length ?? 0) > 0 && (
                    <ul
                      style={{ listStyle: 'none', margin: 'var(--space-3) 0 0', padding: 0,
                               display: 'grid', gap: 'var(--space-2)' }}
                    >
                      {seriesByMaker.get(maker.slug)?.map((item) => (
                        <li key={item.id} className="spread"
                            style={{ borderTop: '1px solid var(--rule)',
                                     paddingTop: 'var(--space-2)', flexWrap: 'wrap' }}>
                          <span>
                            <Link to={`/series/${item.slug}`}>{item.name}</Link>
                            <span className="label-type"> · {seriesLine(item)}</span>
                          </span>
                          <Badge tone={materialTone(item.material, item.colour)}>
                            {item.recordCount}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
            </section>
          )}

          {/* ------------------------------------------------------ series */}
          {tab === 'series' && (
            <section aria-label="Series">
              {!series?.length ? (
                <p style={{ color: 'var(--fg-faint)' }}>No series recorded yet.</p>
              ) : (
                <div className="table-scroll">
                  <table className="ledger">
                    <thead>
                      <tr>
                        <th scope="col">Series</th>
                        <th scope="col">Maker</th>
                        <th scope="col">Material</th>
                        <th scope="col">Plays</th>
                        <th scope="col">Years</th>
                        <th scope="col">Records</th>
                      </tr>
                    </thead>
                    <tbody>
                      {series.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <Link to={`/series/${item.slug}`} style={{ fontWeight: 600 }}>
                              {item.name}
                            </Link>
                            {item.colour && (
                              <div className="label-type">{item.colour}</div>
                            )}
                          </td>
                          <td>
                            {item.maker
                              ? <Link to={`/makers/${item.maker.slug}`}>{item.maker.name}</Link>
                              : '—'}
                          </td>
                          <td>{MATERIAL_LABELS[item.material] ?? 'Unknown'}</td>
                          <td className="stamp-type">
                            {item.playMinutes ? `${item.playMinutes} min` : '—'}
                          </td>
                          <td className="stamp-type" style={{ whiteSpace: 'nowrap' }}>
                            {item.introducedYear || item.discontinuedYear
                              ? `${item.introducedYear ?? '?'}–${item.discontinuedYear ?? ''}`
                              : '—'}
                          </td>
                          <td>
                            <Link to={`/catalog?series=${item.slug}`} className="stamp-type">
                              {item.recordCount}
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* ------------------------------------------------------ people */}
          {tab === 'people' && (
            <section aria-label="Artists">
              <div className="plate no-print"
                   style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
                <label className="field-label" htmlFor="artist-search">
                  Find an artist, or a name they recorded under
                </label>
                <input
                  id="artist-search"
                  className="field"
                  type="search"
                  autoComplete="off"
                  placeholder="Van Brunt, Collins, Peerless Quartet…"
                  value={personQuery}
                  onChange={(e) => setPersonQuery(e.target.value)}
                />
                {letters.length > 1 && (
                  <div className="row" style={{ gap: 'var(--space-1)', marginTop: 'var(--space-3)' }}>
                    {letters.map((letter) => (
                      <a key={letter} href={`#letter-${letter}`} className="btn btn-sm btn-ghost">
                        {letter}
                      </a>
                    ))}
                  </div>
                )}
              </div>

              {!people?.length ? (
                <p style={{ color: 'var(--fg-faint)' }}>
                  {personQuery
                    ? `No artist matches “${personQuery}”. Pseudonyms are searched too.`
                    : 'No artists recorded yet.'}
                </p>
              ) : (
                <>
                  <div className="label-type" aria-live="polite">
                    {peopleTotal} artist{peopleTotal === 1 ? '' : 's'}
                    {people.length < peopleTotal ? `, showing the first ${people.length}` : ''}
                  </div>
                  {letters.map((letter) => (
                    <div key={letter} id={`letter-${letter}`}>
                      <Fleuron mark={letter} />
                      <ul
                        style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid',
                                 gap: 'var(--space-3)',
                                 gridTemplateColumns: 'repeat(auto-fill, minmax(17rem, 1fr))' }}
                      >
                        {peopleByLetter.get(letter)?.map((person) => (
                          <li key={person.id}>
                            <Link to={`/people/${person.slug}`} style={{ fontWeight: 600 }}>
                              {person.name}
                            </Link>
                            <span className="stamp-type" style={{ color: 'var(--fg-faint)' }}>
                              {' '}({person.recordCount})
                            </span>
                            {person.fullName && person.fullName !== person.name && (
                              <div style={{ color: 'var(--fg-soft)', fontSize: 'var(--text-sm)' }}>
                                {person.fullName}
                              </div>
                            )}
                            {person.aliases?.length > 0 && (
                              <div className="label-type" style={{ textTransform: 'none' }}>
                                also: {person.aliases.join(' · ')}
                              </div>
                            )}
                            {person.voiceOrInstrument && (
                              <div style={{ color: 'var(--fg-faint)', fontSize: 'var(--text-sm)' }}>
                                {person.voiceOrInstrument}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

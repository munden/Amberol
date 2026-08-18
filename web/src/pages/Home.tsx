/**
 * The cover of the supplement.
 *
 * Composed the way a 1912 monthly record supplement actually was: an
 * imprint line, an Oxford rule, the masthead in engraved caps, a standfirst,
 * then the order coupon — here the search field, because searching is what
 * this page is really for. The illustration below the coupon is a labelled
 * specimen figure, drawn in CSS by the .cylinder motif.
 *
 * The cover prints immediately whether or not the press answers; only the
 * table of figures waits on the API, and it carries its own three states.
 */
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Button, ButtonLink, Fleuron, Plate, Spinner, ErrorState, Notice, useTitle,
} from '../components/ui';
import { api } from '../lib/api';
import type { CollectionStats } from '../lib/api';

interface Figures {
  /** Titles in the master list. Null when the health call itself failed. */
  records: number | null;
  stats: CollectionStats | null;
}

type Load =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | { status: 'ready'; figures: Figures };

const DEPARTMENTS = [
  {
    to: '/catalog',
    name: 'The Register',
    cylinder: 'cylinder-blue',
    blurb:
      'Every four-minute cylinder entered so far — titles, catalogue numbers, '
      + 'matrices, issue dates and the people who made them.',
    go: 'Open the master list',
  },
  {
    to: '/browse',
    name: 'Makers & Series',
    cylinder: 'cylinder-gold',
    blurb:
      'Edison, Columbia, Lambert, Indestructible and the rest, each with the '
      + 'series they issued and what those cylinders were made of.',
    go: 'Browse the index',
  },
  {
    to: '/collection',
    name: 'My Collection',
    cylinder: 'cylinder-purple',
    blurb:
      'The cylinders actually on your shelf: grades, defects, cleanings, '
      + 'playings and what each one cost.',
    go: 'Go to the shelf',
  },
  {
    to: '/dashboard',
    name: 'The Figures',
    cylinder: 'cylinder-brown',
    blurb:
      'How the collection stands — coverage of the master list, condition by '
      + 'grade, and which cylinders want attention.',
    go: 'Read the figures',
  },
];

export default function Home() {
  useTitle('The Cover');
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  const fetchFigures = useCallback(() => {
    setLoad({ status: 'loading' });
    let live = true;
    Promise.allSettled([api.health(), api.collection.stats()]).then(([health, stats]) => {
      if (!live) return;
      /* Only a total failure is an error worth showing. If the shelf's own
         figures are missing but the register answered, the register's count
         is still worth printing. */
      if (health.status === 'rejected' && stats.status === 'rejected') {
        setLoad({ status: 'error', error: health.reason });
        return;
      }
      setLoad({
        status: 'ready',
        figures: {
          records: health.status === 'fulfilled' ? health.value.records : null,
          stats: stats.status === 'fulfilled' ? stats.value : null,
        },
      });
    });
    return () => { live = false; };
  }, []);

  useEffect(() => fetchFigures(), [fetchFigures]);

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    const term = query.trim();
    navigate(term ? `/catalog?q=${encodeURIComponent(term)}` : '/catalog');
  };

  return (
    <div className="page">
      {/* ------------------------------------------------------- the cover */}
      <Plate className="cover">
        <div className="cover__keyline">
          <div className="cover__page">
            <p className="cover__imprint">Supplement of four-minute records</p>

            <div className="oxford-rule" aria-hidden="true" />

            <h1 className="cover__title">
              <span>The</span>
              Amberola Cylinder Register
            </h1>

            <div className="oxford-rule oxford-rule--under" aria-hidden="true" />

            <p className="cover__byline">Compiled, corrected and kept by hand</p>

            <p className="cover__standfirst dropcap">
              A working catalogue of the four-minute cylinder — what was issued, by whom,
              on which series and in what material — and, kept alongside it, a record of
              the copies standing on your own shelf: how they are graded, what ails them,
              when they were last cleaned and when they were last played.
            </p>

            {/* The order coupon. The one control this page exists for. */}
            <form className="coupon" role="search" onSubmit={onSearch}>
              <label className="coupon__label" htmlFor="cover-search">
                Search the register
              </label>
              <div className="coupon__row">
                <input
                  id="cover-search"
                  className="field coupon__input"
                  type="search"
                  name="q"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Casey Jones, 28123, Ada Jones…"
                  autoComplete="off"
                  aria-describedby="cover-search-hint"
                />
                <Button type="submit" variant="primary" className="coupon__submit">
                  Search
                </Button>
              </div>
              <p className="coupon__hint" id="cover-search-hint">
                Titles, catalogue numbers, performers, composers and first lines.
              </p>
            </form>

            {/* A catalogue plate, drawn entirely by the .cylinder motif. */}
            <figure className="specimen">
              <div className="specimen__rack">
                <div
                  className="cylinder cylinder-blue specimen__cyl"
                  role="img"
                  aria-label="A Blue Amberol celluloid cylinder, side on, bore at the left"
                />
                <div
                  className="cylinder cylinder-purple specimen__cyl"
                  role="img"
                  aria-label="A Royal Purple celluloid cylinder, side on"
                />
                <div
                  className="cylinder cylinder-gold specimen__cyl"
                  role="img"
                  aria-label="A Gold Moulded wax cylinder, side on"
                />
              </div>
              <div className="specimen__shelf" aria-hidden="true" />
              <figcaption>
                Fig. 1 — Blue Amberol, Royal Purple and Gold Moulded, as they stand in
                the drawer. Four minutes at 160 r.p.m., 200 threads to the inch.
              </figcaption>
            </figure>
          </div>
        </div>
      </Plate>

      {/* ------------------------------------------------- the figures */}
      <section aria-labelledby="figures-head">
        <div className="section-head">
          <h2 id="figures-head">The Register at a Glance</h2>
        </div>
        <Fleuron />

        {load.status === 'loading' && <Spinner label="Counting the register" />}

        {load.status === 'error' && (
          <ErrorState error={load.error} onRetry={fetchFigures} />
        )}

        {load.status === 'ready' && <FigureBlock figures={load.figures} />}
      </section>

      {/* ---------------------------------------------------- departments */}
      <section aria-labelledby="departments-head">
        <div className="section-head">
          <h2 id="departments-head">Departments</h2>
          <p>Four ways in. The register is the published record; the collection is yours.</p>
        </div>

        <div className="departments">
          {DEPARTMENTS.map((d) => (
            <Link key={d.to} to={d.to} className="department">
              <div className={`cylinder ${d.cylinder} department__cylinder`} aria-hidden="true" />
              <div className="department__body">
                <h3 className="department__name">{d.name}</h3>
                <p className="department__blurb">{d.blurb}</p>
                <p className="department__go">{d.go} →</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

// --------------------------------------------------------------- figures

/** The table of totals, set with dotted leaders as a supplement set its own. */
function FigureBlock({ figures }: { figures: Figures }) {
  const { records, stats } = figures;
  const held = stats?.totalItems ?? 0;

  /* A database nobody has written to yet is not an error — it is a first
     morning, and it deserves an invitation rather than a row of zeros. */
  if ((records ?? 0) === 0 && held === 0) {
    return (
      <Plate style={{ textAlign: 'center' }}>
        <Fleuron mark="✦" />
        <h3 style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.08em' }}>
          Nothing set in type yet
        </h3>
        <p style={{ maxWidth: '48ch', margin: '0 auto var(--space-5)', color: 'var(--fg-soft)' }}>
          The register is empty — no cylinder has been entered and no copy recorded.
          That is exactly how every catalogue starts. Enter the first title from a
          box lid or a label, or put the first cylinder on the shelf and describe it
          later.
        </p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <ButtonLink to="/catalog/new" variant="primary">Enter the first title</ButtonLink>
          <ButtonLink to="/collection/new">Add a cylinder you own</ButtonLink>
        </div>
        <Fleuron mark="✦" />
      </Plate>
    );
  }

  const coverage = stats?.catalogCoverage;

  return (
    <Plate>
      {records === null && (
        <Notice tone="warn" title="The master list did not answer">
          The figures below are from the collection only.
        </Notice>
      )}
      {stats === null && (
        <Notice tone="warn" title="The shelf did not answer">
          Only the master list could be counted.
        </Notice>
      )}

      <dl className="figures">
        <Figure name="Titles in the master list" value={records} />
        <Figure name="Cylinders on the shelf" value={stats ? stats.totalItems : null} />
        <Figure name="Distinct titles held" value={stats ? stats.distinctTitles : null} />
        <Figure
          name="Of the list, held"
          value={coverage ? coverage.percent : null}
          unit="per cent"
        />
        <Figure name="Cleaned at least once" value={stats ? stats.cleaned : null} />
        <Figure name="Wanting attention" value={stats ? stats.needsAttention : null} />
      </dl>
    </Plate>
  );
}

function Figure({ name, value, unit }:
  { name: string; value: number | null; unit?: string }) {
  return (
    <div className="figure">
      <dt className="figure__name">{name}</dt>
      <span className="figure__leader" aria-hidden="true" />
      <dd className="figure__value" style={{ margin: 0 }}>
        {value === null ? '—' : value.toLocaleString()}
        {value !== null && unit && <small> {unit}</small>}
      </dd>
    </div>
  );
}

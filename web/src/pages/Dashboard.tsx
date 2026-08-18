/**
 * A printed summary of the shelf, in the manner of the monthly statement a
 * dealer might have sent: what is held, what it cost, what it is worth, how
 * it grades — and, before any of that, what needs attention.
 *
 * The attention panel comes first deliberately. Counting cylinders is
 * pleasant; acting on the ones that are cracked, splitting or filthy is the
 * reason for keeping the data at all.
 */
import { Link } from 'react-router-dom';
import {
  Badge, ButtonLink, EmptyState, ErrorState, Fleuron, Notice, Spinner, useTitle,
} from '../components/ui';
import { api, formatDate, formatMoney } from '../lib/api';
import type { CollectionItem, CollectionStats, ListResponse } from '../lib/api';
import { CleanedStamp, DefectBadges, Thumb } from '../components/collection/bits';
import { loadLookups, useAsync } from '../components/collection/hooks';
import '../components/collection/collection.css';

interface Attention {
  needsCleaning: ListResponse<CollectionItem> | null;
  terminal: ListResponse<CollectionItem> | null;
}

/** A tally line with leader dots and a bar, as in a printed index. */
function Tally({
  label, count, max, to,
}: { label: string; count: number; max: number; to?: string }) {
  const percent = max > 0 ? Math.max(3, Math.round((count / max) * 100)) : 0;
  return (
    <li>
      <div className="cx-tally-row">
        <span>{to ? <Link to={to}>{label}</Link> : label}</span>
        <span className="cx-leader" aria-hidden="true" />
        <span className="cx-tally-count">{count}</span>
      </div>
      <div className="cx-tally-bar" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>
    </li>
  );
}

function Figure({
  value, label, alarm = false, to,
}: { value: string | number; label: string; alarm?: boolean; to?: string }) {
  const inner = (
    <>
      <span className={`cx-stat-figure${alarm ? ' is-alarm' : ''}`}>{value}</span>
      <span className="label-type">{label}</span>
    </>
  );
  return (
    <div className="cx-stat">
      {to ? <Link to={to} style={{ textDecoration: 'none' }}>{inner}</Link> : inner}
    </div>
  );
}

function MiniRow({ item, show }: { item: CollectionItem; show: 'cleaned' | 'acquired' | 'faults' }) {
  return (
    <li style={{ padding: 'var(--space-2) 0', borderTop: '1px solid var(--rule)' }}>
      <Link
        to={`/collection/${item.id}`}
        className="row"
        style={{ textDecoration: 'none', alignItems: 'center', gap: 'var(--space-3)' }}
      >
        <Thumb item={item} width={56} height={34} />
        <span style={{ flex: '1 1 8rem', minWidth: 0 }}>
          <span style={{ display: 'block', fontFamily: 'var(--font-title)', fontWeight: 600, color: 'var(--fg)' }}>
            {item.displayTitle}
          </span>
          <span style={{ display: 'block', fontSize: 'var(--text-sm)', color: 'var(--fg-soft)' }}>
            {show === 'acquired' && (
              <>
                {item.acquiredOn ? formatDate(item.acquiredOn, 'day') : 'Date unknown'}
                {item.acquiredPrice !== null ? ` · ${formatMoney(item.acquiredPrice, item.acquiredCurrency)}` : ''}
                {item.acquiredFrom ? ` · ${item.acquiredFrom}` : ''}
              </>
            )}
            {show === 'cleaned' && <CleanedStamp cleaning={item.cleaning} />}
            {show === 'faults' && <DefectBadges defects={item.defects} max={3} />}
          </span>
        </span>
      </Link>
    </li>
  );
}

export default function Dashboard() {
  useTitle('Summary of holdings');

  const statsState = useAsync<CollectionStats>(() => api.collection.stats(), []);

  // The attention lists are a convenience: if either query fails the page
  // still stands on the figures from the summary itself.
  const attentionState = useAsync<Attention>(async () => {
    const lookups = await loadLookups().catch(() => null);
    const terminalCodes = (lookups?.defectTypes ?? []).filter((t) => t.isTerminal).map((t) => t.code);
    const [needsCleaning, terminal] = await Promise.all([
      api.collection.list({ needsCleaning: true, pageSize: 5 }).catch(() => null),
      terminalCodes.length > 0
        ? api.collection.list({ defect: terminalCodes, pageSize: 5 }).catch(() => null)
        : Promise.resolve(null),
    ]);
    return { needsCleaning, terminal };
  }, []);

  const stats = statsState.data;

  if (statsState.loading && !stats) {
    return <div className="page"><Spinner label="Adding up the shelf" /></div>;
  }
  if (statsState.error != null) {
    return (
      <div className="page">
        <ErrorState error={statsState.error} onRetry={statsState.reload} />
      </div>
    );
  }
  if (!stats) return null;

  if (stats.totalItems === 0) {
    return (
      <div className="page">
        <p className="eyebrow">My Amberola</p>
        <h1>Summary of holdings</h1>
        <EmptyState
          title="Nothing to summarise yet"
          action={<ButtonLink to="/collection/new" variant="primary">Add your first cylinder</ButtonLink>}
        >
          <p style={{ marginBottom: 0 }}>
            Once there are cylinders on the shelf, this page keeps the account of them: what they
            cost, how they grade, which series you are deepest in — and which ones want attention.
          </p>
        </EmptyState>
      </div>
    );
  }

  const gradeMax = Math.max(1, ...stats.byGrade.map((g) => g.count));
  const seriesMax = Math.max(1, ...stats.bySeries.map((s) => s.count));
  const makerMax = Math.max(1, ...stats.byMaker.map((m) => m.count));
  const decadeMax = Math.max(1, ...stats.byDecade.map((d) => d.count));
  const defectMax = Math.max(1, ...stats.topDefects.map((d) => d.count));
  const attention = attentionState.data;
  const surplus = stats.estimatedValue - stats.totalSpend;

  return (
    <div className="page">
      <header style={{ textAlign: 'center' }}>
        <p className="eyebrow">My Amberola · the collector's own shelf</p>
        <h1 style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.06em' }}>
          Summary of holdings
        </h1>
        <p className="stamp-type" style={{ color: 'var(--fg-soft)' }}>
          {stats.totalItems} cylinders · drawn up {formatDate(new Date().toISOString().slice(0, 10), 'day')}
        </p>
        <Fleuron />
      </header>

      {/* ------------------------------------------------------ needs attention */}
      <section className="plate" aria-labelledby="h-attention" style={{ borderLeft: '4px solid var(--danger)' }}>
        <h2 id="h-attention" style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.06em' }}>
          Wanting attention
        </h2>

        {stats.needsAttention === 0 && stats.neverCleaned === 0 ? (
          <Notice tone="ok" title="Nothing pressing">
            No unresolved terminal or severe faults, and every cylinder has been cleaned at least
            once. Keep them cool, dry and upright and this page stays dull.
          </Notice>
        ) : (
          <>
            <div className="cx-stats" style={{ marginBottom: 'var(--space-4)' }}>
              <Figure
                value={stats.needsAttention}
                label="Terminal or severe faults"
                alarm={stats.needsAttention > 0}
              />
              <Figure
                value={stats.neverCleaned}
                label="Never cleaned"
                alarm={stats.neverCleaned > 0}
                to="/collection?cleaned=false"
              />
              <Figure
                value={stats.totalItems - stats.playableCount}
                label="Will not play"
                alarm={stats.totalItems - stats.playableCount > 0}
                to="/collection?playable=false"
              />
              <Figure value={stats.unmatchedItems} label="Unidentified" />
            </div>

            <div className="cx-columns cx-columns-2">
              <div>
                <h3 className="label-type">Faults that cannot be undone</h3>
                {attentionState.loading && <Spinner label="Looking" />}
                {attention?.terminal && attention.terminal.data.length > 0 ? (
                  <>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                      {attention.terminal.data.map((item) => (
                        <MiniRow key={item.id} item={item} show="faults" />
                      ))}
                    </ul>
                    {attention.terminal.total > attention.terminal.data.length && (
                      <p style={{ marginTop: 'var(--space-2)' }}>
                        <Link to="/collection?sort=grade">
                          and {attention.terminal.total - attention.terminal.data.length} more on the shelf ›
                        </Link>
                      </p>
                    )}
                  </>
                ) : (
                  !attentionState.loading && (
                    <p style={{ color: 'var(--fg-soft)' }}>
                      No breaks, splits or separated cores recorded. That is the good news on this page.
                    </p>
                  )
                )}
              </div>

              <div>
                <h3 className="label-type">Due for cleaning</h3>
                {attention?.needsCleaning && attention.needsCleaning.data.length > 0 ? (
                  <>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                      {attention.needsCleaning.data.map((item) => (
                        <MiniRow key={item.id} item={item} show="cleaned" />
                      ))}
                    </ul>
                    <p style={{ marginTop: 'var(--space-2)' }}>
                      <Link to="/collection?needsCleaning=true">
                        See every cylinder wanting a clean ›
                      </Link>
                    </p>
                  </>
                ) : (
                  !attentionState.loading && (
                    <p style={{ color: 'var(--fg-soft)' }}>
                      Nothing has gone a year without a clean.
                    </p>
                  )
                )}
              </div>
            </div>
          </>
        )}
      </section>

      {/* -------------------------------------------------------------- totals */}
      <section className="cx-section" aria-labelledby="h-totals">
        <h2 id="h-totals">The shelf in figures</h2>
        <div className="cx-stats">
          <Figure value={stats.totalItems} label="Cylinders held" to="/collection" />
          <Figure value={stats.distinctTitles} label="Distinct titles" />
          <Figure value={stats.duplicates} label="Duplicate copies" />
          <Figure value={stats.matchedItems} label="Matched to the catalog" />
          <Figure value={stats.playableCount} label="Playable" to="/collection?playable=true" />
          <Figure value={stats.averageGradeScore.toFixed(1)} label="Average grade score" />
          <Figure value={stats.cleaned} label="Cleaned at least once" to="/collection?cleaned=true" />
          <Figure value={stats.cleanedThisYear} label="Cleaned this year" />
        </div>
      </section>

      {/* --------------------------------------------------------------- money */}
      <section className="cx-section" aria-labelledby="h-money">
        <h2 id="h-money">Outlay and worth</h2>
        <div className="cx-stats">
          <Figure value={formatMoney(stats.totalSpend)} label="Spent in all" />
          <Figure value={formatMoney(stats.estimatedValue)} label="Estimated value" />
          <Figure
            value={`${surplus >= 0 ? '+' : ''}${formatMoney(surplus)}`}
            label={surplus >= 0 ? 'Ahead of what was paid' : 'Behind what was paid'}
          />
          <Figure
            value={formatMoney(stats.totalItems > 0 ? stats.totalSpend / stats.totalItems : 0)}
            label="Average paid per cylinder"
          />
        </div>
        <p className="field-hint">
          Estimated values are your own; nothing here is an appraisal.
        </p>
      </section>

      {/* ------------------------------------------------------------- grading */}
      <section className="cx-section" aria-labelledby="h-grades">
        <h2 id="h-grades">How they grade</h2>
        {stats.byGrade.length === 0 ? (
          <p style={{ color: 'var(--fg-soft)' }}>Nothing graded yet.</p>
        ) : (
          <ul className="cx-tally">
            {stats.byGrade.map((grade) => (
              <Tally
                key={grade.code}
                label={`${grade.code} — ${grade.label}`}
                count={grade.count}
                max={gradeMax}
                to={`/collection?grade=${encodeURIComponent(grade.code)}`}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ----------------------------------------------------------- breakdown */}
      <section className="cx-section" aria-labelledby="h-holdings">
        <h2 id="h-holdings">Where the collection sits</h2>
        <div className="cx-columns cx-columns-3">
          <div>
            <h3 className="label-type">By series</h3>
            <ul className="cx-tally">
              {stats.bySeries.slice(0, 8).map((s) => (
                <Tally
                  key={s.slug}
                  label={s.name}
                  count={s.count}
                  max={seriesMax}
                  to={`/collection?series=${encodeURIComponent(s.slug)}`}
                />
              ))}
            </ul>
          </div>
          <div>
            <h3 className="label-type">By maker</h3>
            <ul className="cx-tally">
              {stats.byMaker.slice(0, 8).map((m) => (
                <Tally
                  key={m.slug}
                  label={m.name}
                  count={m.count}
                  max={makerMax}
                  to={`/collection?maker=${encodeURIComponent(m.slug)}`}
                />
              ))}
            </ul>
          </div>
          <div>
            <h3 className="label-type">By decade</h3>
            <ul className="cx-tally">
              {stats.byDecade.map((d) => (
                <Tally key={d.decade} label={`${d.decade}s`} count={d.count} max={decadeMax} />
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- faults */}
      <section className="cx-section" aria-labelledby="h-faults">
        <h2 id="h-faults">Commonest faults</h2>
        {stats.topDefects.length === 0 ? (
          <p style={{ color: 'var(--fg-soft)' }}>No faults recorded against anything on the shelf.</p>
        ) : (
          <ul className="cx-tally">
            {stats.topDefects.map((defect) => (
              <Tally
                key={defect.code}
                label={defect.label}
                count={defect.count}
                max={defectMax}
                to={`/collection?defect=${encodeURIComponent(defect.code)}`}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------------ coverage */}
      <section className="cx-section" aria-labelledby="h-coverage">
        <h2 id="h-coverage">Against the master catalog</h2>
        <p>
          You hold <strong>{stats.catalogCoverage.owned}</strong> of the{' '}
          <strong>{stats.catalogCoverage.catalogTotal}</strong> titles catalogued —{' '}
          <strong>{stats.catalogCoverage.percent.toFixed(1)}%</strong>.
          {' '}
          <Link to="/catalog?owned=false">See what is not yet on the shelf ›</Link>
        </p>
        <div className="cx-tally-bar" style={{ height: 12 }} aria-hidden="true">
          <span style={{ width: `${Math.min(100, Math.max(1, stats.catalogCoverage.percent))}%` }} />
        </div>
        {stats.unmatchedItems > 0 && (
          <p style={{ marginTop: 'var(--space-3)' }}>
            <Badge tone="warn">{stats.unmatchedItems} unidentified</Badge>{' '}
            copies are not matched to a catalog entry, so they count towards neither figure.
          </p>
        )}
      </section>

      {/* -------------------------------------------------------------- recent */}
      <section className="cx-section" aria-labelledby="h-recent">
        <h2 id="h-recent">Lately</h2>
        <div className="cx-columns cx-columns-2">
          <div>
            <h3 className="label-type">Recently acquired</h3>
            {stats.recentlyAcquired.length === 0 ? (
              <p style={{ color: 'var(--fg-soft)' }}>Nothing new.</p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {stats.recentlyAcquired.map((item) => (
                  <MiniRow key={item.id} item={item} show="acquired" />
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="label-type">Recently cleaned</h3>
            {stats.recentlyCleaned.length === 0 ? (
              <p style={{ color: 'var(--fg-soft)' }}>Nothing cleaned yet.</p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {stats.recentlyCleaned.map((item) => (
                  <MiniRow key={item.id} item={item} show="cleaned" />
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <Fleuron />
      <p className="row no-print" style={{ justifyContent: 'center' }}>
        <ButtonLink to="/collection" variant="ghost">Back to the shelf</ButtonLink>
        <ButtonLink to="/collection/new" variant="primary">Add a cylinder</ButtonLink>
      </p>
    </div>
  );
}

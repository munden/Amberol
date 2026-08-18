/**
 * MakerDetail — the article for one manufacturer: who they were, the series
 * they issued, and everything of theirs in the register.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Badge, Button, ButtonLink, DataList, DataPair, EmptyState, ErrorState, Spinner, useTitle,
} from '../components/ui';
import { Markdown } from '../components/Markdown';
import { ArticleHeader, EntityEditor, type EntityValues } from '../components/catalog/EntityPage';
import {
  LinkGroups, RecordLedger, SectionHeading, materialTone, seriesLine, useMediaQuery,
} from '../components/catalog/parts';
import { ApiError, MATERIAL_LABELS, api, type Maker } from '../lib/api';

const FIELDS = [
  { name: 'name', label: 'Name', type: 'text' as const, full: true },
  { name: 'shortName', label: 'Short name', type: 'text' as const },
  { name: 'country', label: 'Country', type: 'text' as const },
  { name: 'city', label: 'City', type: 'text' as const },
  { name: 'foundedYear', label: 'Founded', type: 'number' as const },
  { name: 'dissolvedYear', label: 'Dissolved', type: 'number' as const },
  { name: 'summary', label: 'Summary', type: 'textarea' as const, rows: 3,
    hint: 'One or two sentences; shown under the name.' },
  { name: 'history', label: 'History', type: 'textarea' as const, rows: 12,
    hint: 'The article body. Markdown.' },
  { name: 'notes', label: 'Notes', type: 'textarea' as const, rows: 4 },
];

export default function MakerDetail() {
  const { slug = '' } = useParams();
  const isWide = useMediaQuery('(min-width: 64em)');
  const [maker, setMaker] = useState<Maker | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useTitle(maker?.name ?? 'Maker');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.makers.get(slug)
      .then((data) => { if (!cancelled) setMaker(data); })
      .catch((err) => { if (!cancelled) { setError(err); setMaker(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug, reloadToken]);

  const save = useCallback(async (body: Record<string, unknown>) => {
    const updated = await api.makers.update(slug, body);
    setMaker(updated);
  }, [slug]);

  if (loading) return <div className="page"><Spinner label="Fetching the maker" /></div>;

  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="page">
        {notFound ? (
          <EmptyState
            title="No such maker"
            action={<ButtonLink to="/browse" variant="brass">Browse the makers</ButtonLink>}
          >
            Nothing in the register answers to <span className="stamp-type">{slug}</span>.
          </EmptyState>
        ) : (
          <ErrorState error={error} onRetry={() => setReloadToken((n) => n + 1)} />
        )}
      </div>
    );
  }

  if (!maker) return null;

  const initial: EntityValues = {
    name: maker.name ?? '',
    shortName: maker.shortName ?? '',
    country: maker.country ?? '',
    city: maker.city ?? '',
    foundedYear: maker.foundedYear != null ? String(maker.foundedYear) : '',
    dissolvedYear: maker.dissolvedYear != null ? String(maker.dissolvedYear) : '',
    summary: maker.summary ?? '',
    history: maker.history ?? '',
    notes: maker.notes ?? '',
  };

  const years = [maker.foundedYear, maker.dissolvedYear].some((y) => y != null)
    ? `${maker.foundedYear ?? '?'}–${maker.dissolvedYear ?? 'present'}`
    : null;

  return (
    <article className="page">
      <nav aria-label="Breadcrumb" className="no-print" style={{ marginBottom: 'var(--space-4)' }}>
        <Link to="/browse" className="label-type">← The index</Link>
      </nav>

      <ArticleHeader
        eyebrow="Maker"
        title={maker.name}
        subtitle={maker.summary}
        badges={
          <>
            <Badge tone="brass">
              {maker.recordCount} record{maker.recordCount === 1 ? '' : 's'}
            </Badge>
            {years && <Badge tone="blue">{years}</Badge>}
            {[maker.city, maker.country].filter(Boolean).length > 0 && (
              <span className="label-type">
                {[maker.city, maker.country].filter(Boolean).join(', ')}
              </span>
            )}
          </>
        }
        actions={
          <>
            <Button size="sm" variant="brass" onClick={() => setEditing(true)}>Edit</Button>
            <ButtonLink size="sm" variant="ghost" to={`/catalog?maker=${maker.slug}`}>
              All their records
            </ButtonLink>
          </>
        }
      />

      <div
        style={{
          display: 'grid', gap: 'var(--space-6)',
          gridTemplateColumns: isWide ? 'minmax(0, 1fr) 20rem' : 'minmax(0, 1fr)',
          alignItems: 'start',
        }}
      >
        <div style={{ minWidth: 0 }}>
          {maker.history ? (
            <Markdown text={maker.history} dropcap />
          ) : (
            <p className="prose" style={{ color: 'var(--fg-faint)' }}>
              No history has been written for this maker yet.{' '}
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Write it
              </Button>
            </p>
          )}

          {maker.notes && (
            <section aria-labelledby="maker-notes">
              <SectionHeading id="maker-notes">Notes</SectionHeading>
              <Markdown text={maker.notes} />
            </section>
          )}

          {maker.series && maker.series.length > 0 && (
            <section aria-labelledby="maker-series">
              <SectionHeading id="maker-series">Series</SectionHeading>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid',
                           gap: 'var(--space-3)' }}>
                {maker.series.map((series) => (
                  <li key={series.id} style={{ borderTop: '1px solid var(--rule)',
                                               paddingTop: 'var(--space-2)' }}>
                    <div className="spread" style={{ flexWrap: 'wrap' }}>
                      <div>
                        <Link to={`/series/${series.slug}`} style={{ fontWeight: 600 }}>
                          {series.name}
                        </Link>
                        <div className="label-type">
                          {seriesLine(series)}
                          {series.introducedYear
                            ? ` · ${series.introducedYear}–${series.discontinuedYear ?? ''}`
                            : ''}
                        </div>
                      </div>
                      <Badge tone={materialTone(series.material, series.colour)}>
                        {series.recordCount} record{series.recordCount === 1 ? '' : 's'}
                      </Badge>
                    </div>
                    {series.summary && (
                      <p style={{ margin: 'var(--space-1) 0 0', color: 'var(--fg-soft)',
                                  fontSize: 'var(--text-sm)' }}>
                        {series.summary}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="maker-records">
            <SectionHeading id="maker-records">Records</SectionHeading>
            {maker.records?.length ? (
              <>
                <RecordLedger records={maker.records} />
                {maker.recordCount > maker.records.length && (
                  <p style={{ marginTop: 'var(--space-4)' }}>
                    <Link to={`/catalog?maker=${maker.slug}`}>
                      All {maker.recordCount} records by this maker →
                    </Link>
                  </p>
                )}
              </>
            ) : (
              <p style={{ color: 'var(--fg-faint)' }}>
                Nothing by this maker has been catalogued yet.{' '}
                <Link to="/catalog/new">Add the first record.</Link>
              </p>
            )}
          </section>
        </div>

        <aside style={{ display: 'grid', gap: 'var(--space-5)', minWidth: 0 }}>
          <div className="plate" style={{ padding: 'var(--space-4)' }}>
            <h2 className="label-type" style={{ margin: '0 0 var(--space-3)',
                                                fontSize: 'var(--text-sm)' }}>
              The firm
            </h2>
            <DataList columns={1}>
              <DataPair label="Name">{maker.name}</DataPair>
              <DataPair label="Also known as">{maker.shortName ?? '—'}</DataPair>
              <DataPair label="City">{maker.city ?? '—'}</DataPair>
              <DataPair label="Country">{maker.country ?? '—'}</DataPair>
              <DataPair label="Founded" stamp>{maker.foundedYear ?? '—'}</DataPair>
              <DataPair label="Dissolved" stamp>{maker.dissolvedYear ?? '—'}</DataPair>
              <DataPair label="Series" stamp>{maker.series?.length ?? '—'}</DataPair>
              <DataPair label="Records here" stamp>{maker.recordCount}</DataPair>
              <DataPair label="Materials">
                {maker.series?.length
                  ? Array.from(new Set(maker.series.map(
                      (s) => MATERIAL_LABELS[s.material] ?? 'Unknown'))).join(', ')
                  : '—'}
              </DataPair>
            </DataList>
          </div>

          {maker.links?.length > 0 && (
            <section className="plate" style={{ padding: 'var(--space-4)' }}
                     aria-labelledby="maker-links">
              <h2 id="maker-links" className="label-type"
                  style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-sm)' }}>
                Elsewhere
              </h2>
              <LinkGroups links={maker.links} dense />
            </section>
          )}
        </aside>
      </div>

      <EntityEditor
        open={editing}
        title={`Edit ${maker.name}`}
        fields={FIELDS}
        initial={initial}
        links={maker.links ?? []}
        onClose={() => setEditing(false)}
        onSave={save}
      />
    </article>
  );
}

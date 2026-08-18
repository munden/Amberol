/**
 * SeriesDetail — the article for one product line: what it was made of, how
 * long it played, when it ran, and every title in the register issued in it.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Badge, Button, ButtonLink, DataList, DataPair, EmptyState, ErrorState, Spinner, useTitle,
} from '../components/ui';
import { Markdown } from '../components/Markdown';
import { ArticleHeader, EntityEditor, type EntityValues } from '../components/catalog/EntityPage';
import {
  CylinderMotif, LinkGroups, RecordLedger, SectionHeading, materialTone, useMediaQuery,
} from '../components/catalog/parts';
import { ApiError, MATERIAL_LABELS, api, type CylinderMaterial, type Series } from '../lib/api';

const MATERIAL_OPTIONS = (Object.keys(MATERIAL_LABELS) as CylinderMaterial[])
  .map((value) => ({ value, label: MATERIAL_LABELS[value] }));

const FIELDS = [
  { name: 'name', label: 'Name', type: 'text' as const, full: true },
  { name: 'material', label: 'Material', type: 'select' as const, options: MATERIAL_OPTIONS },
  { name: 'colour', label: 'Colour', type: 'text' as const },
  { name: 'playMinutes', label: 'Playing time (minutes)', type: 'number' as const },
  { name: 'threadsPerInch', label: 'Threads per inch', type: 'number' as const,
    hint: '100 for two-minute, 200 for the four-minute Amberol cut.' },
  { name: 'introducedYear', label: 'Introduced', type: 'number' as const },
  { name: 'discontinuedYear', label: 'Discontinued', type: 'number' as const },
  { name: 'summary', label: 'Summary', type: 'textarea' as const, rows: 3 },
  { name: 'description', label: 'Description', type: 'textarea' as const, rows: 12,
    hint: 'The article body. Markdown.' },
  { name: 'notes', label: 'Notes', type: 'textarea' as const, rows: 4 },
];

export default function SeriesDetail() {
  const { slug = '' } = useParams();
  const isWide = useMediaQuery('(min-width: 64em)');
  const [series, setSeries] = useState<Series | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useTitle(series?.name ?? 'Series');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.series.get(slug)
      .then((data) => { if (!cancelled) setSeries(data); })
      .catch((err) => { if (!cancelled) { setError(err); setSeries(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug, reloadToken]);

  const save = useCallback(async (body: Record<string, unknown>) => {
    const updated = await api.series.update(slug, body);
    setSeries(updated);
  }, [slug]);

  if (loading) return <div className="page"><Spinner label="Fetching the series" /></div>;

  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="page">
        {notFound ? (
          <EmptyState
            title="No such series"
            action={<ButtonLink to="/browse" variant="brass">Browse the series</ButtonLink>}
          >
            Nothing in the register answers to <span className="stamp-type">{slug}</span>.
          </EmptyState>
        ) : (
          <ErrorState error={error} onRetry={() => setReloadToken((n) => n + 1)} />
        )}
      </div>
    );
  }

  if (!series) return null;

  const initial: EntityValues = {
    name: series.name ?? '',
    material: series.material ?? 'unknown',
    colour: series.colour ?? '',
    playMinutes: series.playMinutes != null ? String(series.playMinutes) : '',
    threadsPerInch: series.threadsPerInch != null ? String(series.threadsPerInch) : '',
    introducedYear: series.introducedYear != null ? String(series.introducedYear) : '',
    discontinuedYear: series.discontinuedYear != null ? String(series.discontinuedYear) : '',
    summary: series.summary ?? '',
    description: series.description ?? '',
    notes: series.notes ?? '',
  };

  const run = series.introducedYear || series.discontinuedYear
    ? `${series.introducedYear ?? '?'}–${series.discontinuedYear ?? 'present'}`
    : null;

  return (
    <article className="page">
      <nav aria-label="Breadcrumb" className="no-print" style={{ marginBottom: 'var(--space-4)' }}>
        <Link to="/browse" className="label-type">← The index</Link>
        {series.maker && (
          <>
            {' · '}
            <Link to={`/makers/${series.maker.slug}`} className="label-type">
              {series.maker.name}
            </Link>
          </>
        )}
      </nav>

      <ArticleHeader
        eyebrow={series.maker ? series.maker.name : 'Series'}
        title={series.name}
        subtitle={series.summary}
        badges={
          <>
            <Badge tone={materialTone(series.material, series.colour)}>
              {MATERIAL_LABELS[series.material] ?? 'Unknown material'}
            </Badge>
            {series.playMinutes && <Badge tone="brass">{series.playMinutes}-minute</Badge>}
            {run && <Badge tone="blue">{run}</Badge>}
            <span className="label-type">
              {series.recordCount} record{series.recordCount === 1 ? '' : 's'}
            </span>
          </>
        }
        actions={
          <>
            <Button size="sm" variant="brass" onClick={() => setEditing(true)}>Edit</Button>
            <ButtonLink size="sm" variant="ghost" to={`/catalog?series=${series.slug}`}>
              All its records
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
          {series.description ? (
            <Markdown text={series.description} dropcap />
          ) : (
            <p className="prose" style={{ color: 'var(--fg-faint)' }}>
              Nothing has been written about this series yet.{' '}
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Write it</Button>
            </p>
          )}

          {series.notes && (
            <section aria-labelledby="series-notes">
              <SectionHeading id="series-notes">Notes</SectionHeading>
              <Markdown text={series.notes} />
            </section>
          )}

          <section aria-labelledby="series-records">
            <SectionHeading id="series-records">Records in this series</SectionHeading>
            {series.records?.length ? (
              <>
                <RecordLedger records={series.records} />
                {series.recordCount > series.records.length && (
                  <p style={{ marginTop: 'var(--space-4)' }}>
                    <Link to={`/catalog?series=${series.slug}`}>
                      All {series.recordCount} records in this series →
                    </Link>
                  </p>
                )}
              </>
            ) : (
              <p style={{ color: 'var(--fg-faint)' }}>
                No records in this series have been catalogued yet.{' '}
                <Link to={`/catalog/new?seriesId=${series.id}`}>Add the first one.</Link>
              </p>
            )}
          </section>
        </div>

        <aside style={{ display: 'grid', gap: 'var(--space-5)', minWidth: 0 }}>
          <div className="plate" style={{ padding: 'var(--space-4)' }}>
            <h2 className="label-type" style={{ margin: '0 0 var(--space-3)',
                                                fontSize: 'var(--text-sm)' }}>
              Specification
            </h2>
            <CylinderMotif series={series} style={{ marginBottom: 'var(--space-4)' }} />
            <DataList columns={1}>
              <DataPair label="Maker">
                {series.maker
                  ? <Link to={`/makers/${series.maker.slug}`}>{series.maker.name}</Link>
                  : '—'}
              </DataPair>
              <DataPair label="Material">
                {MATERIAL_LABELS[series.material] ?? 'Unknown'}
              </DataPair>
              <DataPair label="Colour">{series.colour ?? '—'}</DataPair>
              <DataPair label="Playing time" stamp>
                {series.playMinutes ? `${series.playMinutes} min` : '—'}
              </DataPair>
              <DataPair label="Threads per inch" stamp>{series.threadsPerInch ?? '—'}</DataPair>
              <DataPair label="Introduced" stamp>{series.introducedYear ?? '—'}</DataPair>
              <DataPair label="Discontinued" stamp>{series.discontinuedYear ?? '—'}</DataPair>
              <DataPair label="Records here" stamp>{series.recordCount}</DataPair>
            </DataList>
          </div>

          {series.links?.length > 0 && (
            <section className="plate" style={{ padding: 'var(--space-4)' }}
                     aria-labelledby="series-links">
              <h2 id="series-links" className="label-type"
                  style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-sm)' }}>
                Elsewhere
              </h2>
              <LinkGroups links={series.links} dense />
            </section>
          )}
        </aside>
      </div>

      <EntityEditor
        open={editing}
        title={`Edit ${series.name}`}
        fields={FIELDS}
        initial={initial}
        links={series.links ?? []}
        onClose={() => setEditing(false)}
        onSave={save}
      />
    </article>
  );
}

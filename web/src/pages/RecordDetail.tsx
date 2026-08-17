/**
 * RecordDetail — the fullest page of information for one cylinder.
 *
 * Set as an encyclopedia article: a masthead, the prose article, a printed
 * specification plate in place of a Wikipedia infobox, the credits, the
 * outbound links (audio first), every cross-reference a collector wants, the
 * copies they own, and the page's own edit history.
 *
 * Dates are always rendered at the precision they are actually known to.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Badge, Button, ButtonLink, DataList, DataPair, EmptyState, ErrorState, Fleuron,
  Notice, Spinner, useTitle,
} from '../components/ui';
import { Markdown } from '../components/Markdown';
import {
  CONFIDENCE_TEXT, ConfidenceBadge, CylinderMotif, ExternalLink, LinkGroups,
  OwnedMark, ROLE_LABELS, ROLE_ORDER, RecordRefList, SectionHeading,
  materialTone, seriesLine, useMediaQuery,
} from '../components/catalog/parts';
import {
  ApiError, MATERIAL_LABELS, api, formatDate, formatDateTime,
  type CatalogRecord, type Credit, type CreditRole, type Revision,
} from '../lib/api';

function duration(seconds: number | null): string {
  if (!seconds) return '—';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes} min ${String(rest).padStart(2, '0')} s` : `${rest} s`;
}

/** Groups the credits by role, in the order a label would have printed them. */
function groupCredits(credits: Credit[]): { role: CreditRole; credits: Credit[] }[] {
  const byRole = new Map<CreditRole, Credit[]>();
  for (const credit of credits) {
    const list = byRole.get(credit.role) ?? [];
    list.push(credit);
    byRole.set(credit.role, list);
  }
  return ROLE_ORDER
    .filter((role) => byRole.has(role))
    .map((role) => ({
      role,
      credits: (byRole.get(role) ?? []).slice()
        .sort((a, b) => a.billingOrder - b.billingOrder),
    }));
}

export default function RecordDetail() {
  const { slug = '' } = useParams();
  const isWide = useMediaQuery('(min-width: 64em)');

  const [record, setRecord] = useState<CatalogRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useTitle(record ? `${record.title} (${record.catalogNumber})` : 'Record');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.catalog.get(slug)
      .then((data) => { if (!cancelled) setRecord(data); })
      .catch((err) => { if (!cancelled) { setError(err); setRecord(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug, reloadToken]);

  // ------------------------------------------------------------- revisions
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [revisionError, setRevisionError] = useState<unknown>(null);
  const [restoring, setRestoring] = useState<number | null>(null);

  const loadRevisions = useCallback(() => {
    setRevisionError(null);
    api.catalog.revisions(slug)
      .then(setRevisions)
      .catch(setRevisionError);
  }, [slug]);

  useEffect(() => {
    if (revisionsOpen && revisions === null) loadRevisions();
  }, [revisionsOpen, revisions, loadRevisions]);

  const restore = useCallback(async (revision: Revision) => {
    const stamp = formatDateTime(revision.createdAt);
    if (!window.confirm(
      `Restore this record to how it stood before the edit of ${stamp}? ` +
      'The current text is kept in the history and can be restored in turn.',
    )) return;
    setRestoring(revision.id);
    try {
      const restored = await api.catalog.restore(slug, revision.id);
      setRecord(restored);
      loadRevisions();
    } catch (err) {
      setRevisionError(err);
    } finally {
      setRestoring(null);
    }
  }, [slug, loadRevisions]);

  const creditGroups = useMemo(() => groupCredits(record?.credits ?? []), [record]);

  if (loading && !record) return <div className="page"><Spinner label="Fetching the entry" /></div>;

  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="page">
        {notFound ? (
          <EmptyState
            title="No such record"
            action={<ButtonLink to="/catalog" variant="brass">Back to the master list</ButtonLink>}
          >
            Nothing in the register answers to <span className="stamp-type">{slug}</span>.
            It may have been renamed, or never catalogued.
          </EmptyState>
        ) : (
          <ErrorState error={error} onRetry={() => setReloadToken((n) => n + 1)} />
        )}
      </div>
    );
  }

  if (!record) return null;

  const { series, maker } = record;
  const audioLinks = record.links?.filter((l) => l.kind === 'audio') ?? [];
  const heroImage = record.images?.find((i) => i.isPrimary) ?? record.images?.[0] ?? null;

  const specPlate = (
    <div className="plate" style={{ padding: 'var(--space-4)' }}>
      <h2 className="label-type" style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-sm)' }}>
        Specification
      </h2>
      <CylinderMotif
        series={series}
        imageUrl={heroImage?.url ?? null}
        alt={heroImage?.altText ?? ''}
        style={{ marginBottom: 'var(--space-4)' }}
      />
      <DataList columns={1}>
        <DataPair label="Maker">
          {maker ? <Link to={`/makers/${maker.slug}`}>{maker.name}</Link> : '—'}
        </DataPair>
        <DataPair label="Series">
          {series ? <Link to={`/series/${series.slug}`}>{series.name}</Link> : '—'}
        </DataPair>
        <DataPair label="Material">
          {series ? MATERIAL_LABELS[series.material] ?? 'Unknown' : '—'}
          {series?.colour ? ` · ${series.colour}` : ''}
        </DataPair>
        <DataPair label="Playing time">
          {series?.playMinutes ? `${series.playMinutes} minutes (nominal)` : '—'}
        </DataPair>
        <DataPair label="Catalog number" stamp>{record.catalogNumber}</DataPair>
        <DataPair label="Matrix number" stamp>{record.matrixNumber ?? '—'}</DataPair>
        <DataPair label="Take" stamp>{record.take ?? '—'}</DataPair>
        <DataPair label="Recorded">
          {record.recordedOn ? formatDate(record.recordedOn, record.recordedPrecision) : '—'}
        </DataPair>
        <DataPair label="Recorded at">{record.recordedPlace ?? '—'}</DataPair>
        <DataPair label="Released">
          {record.releasedOn ? formatDate(record.releasedOn, record.releasedPrecision) : '—'}
        </DataPair>
        <DataPair label="Supplement">{record.releaseSupplement ?? '—'}</DataPair>
        {record.withdrawnOn && (
          <DataPair label="Withdrawn">{formatDate(record.withdrawnOn, 'month')}</DataPair>
        )}
        <DataPair label="Genre">
          {record.genre
            ? <Link to={`/catalog?genre=${encodeURIComponent(record.genre)}`}>{record.genre}</Link>
            : '—'}
        </DataPair>
        <DataPair label="Type of work">{record.workType ?? '—'}</DataPair>
        <DataPair label="Language">{record.language ?? '—'}</DataPair>
        <DataPair label="Duration" stamp>{duration(record.durationSeconds)}</DataPair>
        <DataPair label="Credit line">{record.creditLine ?? '—'}</DataPair>
        <DataPair label="Authors">{record.authors ?? '—'}</DataPair>
        <DataPair label="Provenance">{record.provenance ?? '—'}</DataPair>
        <DataPair label="Certainty">
          {record.confidence[0].toUpperCase() + record.confidence.slice(1)}
        </DataPair>
        <DataPair label="Last edited">{formatDateTime(record.updatedAt)}</DataPair>
      </DataList>
    </div>
  );

  const linksPanel = record.links?.length ? (
    <section className="plate" style={{ padding: 'var(--space-4)' }} aria-labelledby="links-heading">
      <h2 id="links-heading" className="label-type"
          style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-sm)' }}>
        Elsewhere
      </h2>
      <LinkGroups links={record.links} />
    </section>
  ) : null;

  const copiesPanel = record.myCopies?.length ? (
    <section className="plate" style={{ padding: 'var(--space-4)' }} aria-labelledby="copies-heading">
      <h2 id="copies-heading" className="label-type"
          style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-sm)' }}>
        On my shelf
      </h2>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-3)' }}>
        {record.myCopies.map((copy) => (
          <li key={copy.id} style={{ borderTop: '1px solid var(--rule)', paddingTop: 'var(--space-2)' }}>
            <Link to={`/collection/${copy.id}`}>
              {copy.copyLabel || `Copy #${copy.id}`}
            </Link>
            <div className="row" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
              {copy.conditionGrade && <Badge tone="brass">{copy.conditionGrade.label}</Badge>}
              {copy.cleaning?.isCleaned
                ? <Badge tone="green">Cleaned</Badge>
                : <Badge tone="warn">Never cleaned</Badge>}
              {copy.isPlayable === false && <Badge tone="danger">Not playable</Badge>}
            </div>
            {copy.storageLocation && (
              <div className="stamp-type" style={{ color: 'var(--fg-faint)',
                                                   fontSize: 'var(--text-sm)' }}>
                {copy.storageLocation}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  ) : null;

  return (
    <article className="page">
      <nav aria-label="Breadcrumb" className="no-print" style={{ marginBottom: 'var(--space-4)' }}>
        <Link to="/catalog" className="label-type">← The master list</Link>
      </nav>

      {/* ------------------------------------------------------- masthead */}
      <header className="plate" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
        <div
          style={{
            display: 'grid', gap: 'var(--space-5)',
            gridTemplateColumns: isWide ? 'minmax(0, 1fr) 14rem' : 'minmax(0, 1fr)',
            alignItems: 'start',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow">
              {series ? (
                <Link to={`/series/${series.slug}`} style={{ color: 'inherit' }}>{series.name}</Link>
              ) : 'Cylinder record'}
            </div>
            <h1 style={{ margin: '0 0 var(--space-2)' }}>{record.title}</h1>
            {record.subtitle && (
              <p style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-xl)',
                          fontStyle: 'italic', color: 'var(--fg-soft)' }}>
                {record.subtitle}
              </p>
            )}
            <div
              className="stamp-type"
              style={{ fontSize: 'var(--text-2xl)', color: 'var(--oxblood)',
                       letterSpacing: '0.08em' }}
            >
              No. {record.catalogNumber}
            </div>
            {record.creditLine && (
              <p style={{ margin: 'var(--space-3) 0 0', color: 'var(--fg-soft)' }}>
                {record.creditLine}
              </p>
            )}
            <div className="row" style={{ marginTop: 'var(--space-3)', gap: 'var(--space-2)' }}>
              <OwnedMark count={record.ownedCount} />
              <ConfidenceBadge confidence={record.confidence} />
              {record.isStub && <Badge tone="warn">Stub entry</Badge>}
              {series && (
                <Badge tone={materialTone(series.material, series.colour)}>
                  {seriesLine(series)}
                </Badge>
              )}
              {maker && <Link to={`/makers/${maker.slug}`} className="label-type">{maker.name}</Link>}
            </div>

            <div className="row no-print" style={{ marginTop: 'var(--space-4)' }}>
              <ButtonLink to={`/catalog/${record.slug}/edit`} size="sm" variant="brass">
                Edit this entry
              </ButtonLink>
              {audioLinks[0] && (
                <a
                  className="btn btn-sm btn-primary"
                  href={audioLinks[0].url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ▶ Listen{audioLinks[0].sourceName ? ` at ${audioLinks[0].sourceName}` : ''}
                </a>
              )}
              <Button size="sm" variant="ghost" onClick={() => setRevisionsOpen((v) => !v)}
                      aria-expanded={revisionsOpen} aria-controls="revision-history">
                History{record.revisionCount ? ` (${record.revisionCount})` : ''}
              </Button>
            </div>
          </div>

          <CylinderMotif
            series={series}
            imageUrl={heroImage?.url ?? null}
            alt={heroImage?.altText ?? ''}
            style={isWide ? undefined : { maxWidth: '14rem' }}
          />
        </div>
      </header>

      {record.confidence !== 'verified' && (
        <div style={{ marginBottom: 'var(--space-5)' }}>
          <Notice tone={record.confidence === 'uncertain' ? 'danger' : 'warn'}
                  title={record.confidence === 'uncertain'
                    ? 'Some of this is unconfirmed'
                    : 'Probable, not confirmed'}>
            {CONFIDENCE_TEXT[record.confidence]} If you can check it against a
            supplement or a scan, <Link to={`/catalog/${record.slug}/edit`}>correct the entry</Link>.
          </Notice>
        </div>
      )}

      {/* ---------------------------------------------------------- body */}
      <div
        style={{
          display: 'grid', gap: 'var(--space-6)',
          gridTemplateColumns: isWide ? 'minmax(0, 1fr) 22rem' : 'minmax(0, 1fr)',
          alignItems: 'start',
        }}
      >
        <main style={{ minWidth: 0 }}>
          {record.description ? (
            <Markdown text={record.description} dropcap />
          ) : (
            <p className="prose" style={{ color: 'var(--fg-faint)' }}>
              No description has been written for this cylinder yet.{' '}
              <Link to={`/catalog/${record.slug}/edit`}>Write the first one.</Link>
            </p>
          )}

          {/* ------------------------------------------------- credits */}
          {creditGroups.length > 0 && (
            <section aria-labelledby="credits-heading">
              <SectionHeading id="credits-heading">Credits</SectionHeading>
              <div style={{ display: 'grid', gap: 'var(--space-4)',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))' }}>
                {creditGroups.map(({ role, credits }) => (
                  <div key={role}>
                    <div className="label-type">{ROLE_LABELS[role]}</div>
                    <ul style={{ listStyle: 'none', margin: 'var(--space-2) 0 0', padding: 0 }}>
                      {credits.map((credit) => (
                        <li key={credit.id} style={{ marginBottom: 'var(--space-2)' }}>
                          <Link to={`/people/${credit.person.slug}`}>{credit.person.name}</Link>
                          {credit.detail && (
                            <span style={{ color: 'var(--fg-soft)' }}> — {credit.detail}</span>
                          )}
                          {credit.person.fullName
                            && credit.person.fullName !== credit.person.name && (
                            <div style={{ color: 'var(--fg-faint)', fontSize: 'var(--text-sm)' }}>
                              {credit.person.fullName}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* --------------------------------------------------- lyrics */}
          {record.lyrics && (
            <section aria-labelledby="lyrics-heading">
              <SectionHeading id="lyrics-heading">Lyrics</SectionHeading>
              <div className="prose" style={{ whiteSpace: 'pre-wrap' }}>{record.lyrics}</div>
            </section>
          )}

          {record.notes && (
            <section aria-labelledby="notes-heading">
              <SectionHeading id="notes-heading">Notes</SectionHeading>
              <Markdown text={record.notes} />
            </section>
          )}

          {record.trivia && (
            <section aria-labelledby="trivia-heading">
              <SectionHeading id="trivia-heading">Curiosities</SectionHeading>
              <Markdown text={record.trivia} />
            </section>
          )}

          {record.provenance && (
            <section aria-labelledby="provenance-heading">
              <SectionHeading id="provenance-heading">Provenance</SectionHeading>
              <Markdown text={record.provenance} />
            </section>
          )}

          {/* ---------------------------------------------- images */}
          {record.images?.length > 1 && (
            <section aria-labelledby="images-heading">
              <SectionHeading id="images-heading">Pictures</SectionHeading>
              <div style={{ display: 'grid', gap: 'var(--space-4)',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))' }}>
                {record.images.map((image) => (
                  <figure key={image.id} style={{ margin: 0 }}>
                    <img
                      src={image.thumbUrl ?? image.url}
                      alt={image.altText ?? image.caption ?? ''}
                      loading="lazy"
                      style={{ borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-sm)' }}
                    />
                    {image.caption && (
                      <figcaption className="label-type" style={{ marginTop: 'var(--space-1)' }}>
                        {image.caption}
                      </figcaption>
                    )}
                  </figure>
                ))}
              </div>
            </section>
          )}

          {/* ------------------------------------------ cross-references */}
          {(record.alsoOnOtherSeries?.length || record.originalIssue
            || record.reissues?.length) ? (
            <section aria-labelledby="issues-heading">
              <SectionHeading id="issues-heading">The same title elsewhere</SectionHeading>
              {record.originalIssue && (
                <p>
                  Derived from the earlier issue{' '}
                  <Link to={`/catalog/${record.originalIssue.slug}`}>
                    {record.originalIssue.title}
                  </Link>{' '}
                  <span className="stamp-type">({record.originalIssue.catalogNumber})</span>.
                </p>
              )}
              {record.alsoOnOtherSeries?.length > 0 && (
                <>
                  <div className="label-type" style={{ marginTop: 'var(--space-3)' }}>
                    Issued on other series
                  </div>
                  <div style={{ marginTop: 'var(--space-2)' }}>
                    <RecordRefList records={record.alsoOnOtherSeries} />
                  </div>
                </>
              )}
              {record.reissues?.length > 0 && (
                <>
                  <div className="label-type" style={{ marginTop: 'var(--space-4)' }}>
                    Later issues taken from this one
                  </div>
                  <div style={{ marginTop: 'var(--space-2)' }}>
                    <RecordRefList records={record.reissues} />
                  </div>
                </>
              )}
            </section>
          ) : null}

          {record.otherByPerformers?.length > 0 && (
            <section aria-labelledby="others-heading">
              <SectionHeading id="others-heading">More by these performers</SectionHeading>
              <RecordRefList records={record.otherByPerformers} />
            </section>
          )}

          {/* -------------------------------------------------- history */}
          {revisionsOpen && (
            <section id="revision-history" aria-labelledby="history-heading" className="no-print">
              <SectionHeading id="history-heading">Edit history</SectionHeading>
              {revisionError ? (
                <ErrorState error={revisionError} onRetry={loadRevisions} />
              ) : revisions === null ? (
                <Spinner label="Turning back the pages" />
              ) : revisions.length === 0 ? (
                <p style={{ color: 'var(--fg-faint)' }}>
                  No edits recorded since this entry was created.
                </p>
              ) : (
                <div className="table-scroll">
                  <table className="ledger">
                    <thead>
                      <tr>
                        <th scope="col">When</th>
                        <th scope="col">Editor</th>
                        <th scope="col">Summary</th>
                        <th scope="col">Fields</th>
                        <th scope="col"><span className="visually-hidden">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {revisions.map((revision) => (
                        <tr key={revision.id}>
                          <td className="stamp-type" style={{ whiteSpace: 'nowrap' }}>
                            {formatDateTime(revision.createdAt)}
                            <div><Badge tone="brass">{revision.action}</Badge></div>
                          </td>
                          <td>{revision.editor}</td>
                          <td style={{ minWidth: '12rem' }}>
                            {revision.editSummary || (
                              <span style={{ color: 'var(--fg-faint)' }}>No summary given</span>
                            )}
                          </td>
                          <td style={{ color: 'var(--fg-soft)', fontSize: 'var(--text-sm)' }}>
                            {revision.changedFields?.length
                              ? revision.changedFields.join(', ')
                              : '—'}
                          </td>
                          <td>
                            {revision.beforeData && (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={restoring === revision.id}
                                onClick={() => restore(revision)}
                              >
                                {restoring === revision.id ? 'Restoring…' : 'Restore'}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          <Fleuron />
          <p className="label-type">
            Entry created {formatDateTime(record.createdAt)} ·
            {' '}{record.revisionCount} recorded edit{record.revisionCount === 1 ? '' : 's'}
          </p>
        </main>

        {/* ------------------------------------------------------- aside */}
        <aside style={{ display: 'grid', gap: 'var(--space-5)', minWidth: 0 }}>
          {specPlate}
          {linksPanel}
          {copiesPanel}
          {!record.links?.length && (
            <Notice title="No outside references yet">
              Nothing here links out to a recording, a scan or a discography.{' '}
              <Link to={`/catalog/${record.slug}/edit`}>Add one</Link> — the archives at
              UCSB and DAHR are the usual places to look.
            </Notice>
          )}
          {record.ownedCount === 0 && (
            <p className="label-type">Not on the shelf.{' '}
              <Link to={`/collection/new?recordSlug=${record.slug}`}>Record a copy</Link>
            </p>
          )}
        </aside>
      </div>
    </article>
  );
}

/**
 * The edit history of a maker, series or person page.
 *
 * The record page carries its own history panel with a restore control,
 * because the API can roll a catalog record back. Entity revisions are
 * readable but not restorable, so this is a plain record of what changed and
 * who changed it — the wiki convention of showing the page's own past.
 */
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, ErrorState, Spinner } from '../ui';
import { SectionHeading } from './parts';
import { api, formatDateTime, type Revision } from '../../lib/api';

type EntityKind = 'maker' | 'series' | 'person';

const LOADERS: Record<EntityKind, (idOrSlug: string) => Promise<Revision[]>> = {
  maker: (slug) => api.makers.revisions(slug),
  series: (slug) => api.series.revisions(slug),
  person: (slug) => api.people.revisions(slug),
};

export function RevisionHistory({ kind, slug }: { kind: EntityKind; slug: string }) {
  const [open, setOpen] = useState(false);
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => {
    setError(null);
    LOADERS[kind](slug).then(setRevisions).catch(setError);
  }, [kind, slug]);

  // Fetched only when the reader asks for it — most visits never open it.
  useEffect(() => {
    if (open && revisions === null) load();
  }, [open, revisions, load]);

  // A different page means a different history.
  useEffect(() => {
    setRevisions(null);
    setOpen(false);
  }, [kind, slug]);

  return (
    <section className="no-print" aria-labelledby={`history-${kind}`}>
      <SectionHeading id={`history-${kind}`}>Edit history</SectionHeading>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`history-panel-${kind}`}
      >
        {open ? 'Hide the history' : 'Show what has been changed'}
      </Button>

      {open && (
        <div id={`history-panel-${kind}`} style={{ marginTop: 'var(--space-4)' }}>
          {error ? (
            <ErrorState error={error} onRetry={load} />
          ) : revisions === null ? (
            <Spinner label="Turning back the pages" />
          ) : revisions.length === 0 ? (
            <p style={{ color: 'var(--fg-soft)' }}>
              No edits recorded since this page was created.
            </p>
          ) : (
            <div className="table-scroll">
              <table className="ledger">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Editor</th>
                    <th scope="col">Summary</th>
                    <th scope="col">Fields changed</th>
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
                          <span style={{ color: 'var(--fg-soft)' }}>No summary given</span>
                        )}
                      </td>
                      <td style={{ color: 'var(--fg-soft)', fontSize: 'var(--text-sm)' }}>
                        {revision.changedFields?.length ? revision.changedFields.join(', ') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

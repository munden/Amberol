/**
 * PersonDetail — the article for a performer, author or ensemble.
 *
 * The pseudonyms matter more here than anywhere else in the register: the
 * acoustic labels issued the same singer under a dozen names, and `aliases` is
 * how a collector identifies a cylinder credited to a name they do not know.
 * They are given their own line, and they are searchable.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Badge, Button, ButtonLink, DataList, DataPair, EmptyState, ErrorState, Spinner, useTitle,
} from '../components/ui';
import { Markdown } from '../components/Markdown';
import { ArticleHeader, EntityEditor, type EntityValues } from '../components/catalog/EntityPage';
import {
  LinkGroups, ROLE_LABELS, RecordLedger, SectionHeading, useMediaQuery,
} from '../components/catalog/parts';
import { ApiError, api, type CatalogSummary, type Person } from '../lib/api';

const FIELDS = [
  { name: 'name', label: 'Name as printed', type: 'text' as const },
  { name: 'fullName', label: 'Full name', type: 'text' as const },
  { name: 'sortName', label: 'Sorts as', type: 'text' as const,
    hint: 'Van Brunt, Walter' },
  { name: 'aliases', label: 'Pseudonyms', type: 'list' as const, full: true,
    hint: 'Every name this person was credited under, separated by commas.' },
  { name: 'voiceOrInstrument', label: 'Voice or instrument', type: 'text' as const },
  { name: 'nationality', label: 'Nationality', type: 'text' as const },
  { name: 'birthYear', label: 'Born', type: 'number' as const },
  { name: 'deathYear', label: 'Died', type: 'number' as const },
  { name: 'isGroup', label: 'This is a group or ensemble', type: 'checkbox' as const },
  { name: 'summary', label: 'Summary', type: 'textarea' as const, rows: 3 },
  { name: 'biography', label: 'Biography', type: 'textarea' as const, rows: 12,
    hint: 'The article body. Markdown.' },
  { name: 'notes', label: 'Notes', type: 'textarea' as const, rows: 4 },
];

/**
 * The list route gives titles but not which role this person held on each, so
 * the grouping is drawn from the printed performer and author lines — the same
 * evidence a collector reads off the cylinder itself.
 */
function groupByBilling(person: Person, records: CatalogSummary[]) {
  const names = [person.name, person.fullName, ...(person.aliases ?? [])]
    .filter((n): n is string => !!n)
    .map((n) => n.toLowerCase());
  const matches = (haystack: string | null) =>
    !!haystack && names.some((name) => haystack.toLowerCase().includes(name));

  const performing: CatalogSummary[] = [];
  const authoring: CatalogSummary[] = [];
  const other: CatalogSummary[] = [];
  for (const record of records) {
    if (matches(record.performers)) performing.push(record);
    else if (matches(record.authors)) authoring.push(record);
    else other.push(record);
  }
  return [
    { key: 'performing', heading: 'Recorded as a performer', records: performing },
    { key: 'authoring', heading: 'As composer, lyricist or arranger', records: authoring },
    { key: 'other', heading: 'Other credits', records: other },
  ].filter((group) => group.records.length > 0);
}

export default function PersonDetail() {
  const { slug = '' } = useParams();
  const isWide = useMediaQuery('(min-width: 64em)');
  const [person, setPerson] = useState<Person | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useTitle(person?.name ?? 'Person');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.people.get(slug)
      .then((data) => { if (!cancelled) setPerson(data); })
      .catch((err) => { if (!cancelled) { setError(err); setPerson(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug, reloadToken]);

  const save = useCallback(async (body: Record<string, unknown>) => {
    const updated = await api.people.update(slug, body);
    setPerson(updated);
  }, [slug]);

  const groups = useMemo(
    () => (person ? groupByBilling(person, person.records ?? []) : []),
    [person],
  );

  if (loading) return <div className="page"><Spinner label="Fetching the artist" /></div>;

  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="page">
        {notFound ? (
          <EmptyState
            title="No such person"
            action={<ButtonLink to="/browse" variant="brass">The artist index</ButtonLink>}
          >
            Nothing in the register answers to <span className="stamp-type">{slug}</span>.
            If you know them under another name, try the index — pseudonyms are listed there.
          </EmptyState>
        ) : (
          <ErrorState error={error} onRetry={() => setReloadToken((n) => n + 1)} />
        )}
      </div>
    );
  }

  if (!person) return null;

  const initial: EntityValues = {
    name: person.name ?? '',
    fullName: person.fullName ?? '',
    sortName: person.sortName ?? '',
    aliases: person.aliases ?? [],
    voiceOrInstrument: person.voiceOrInstrument ?? '',
    nationality: person.nationality ?? '',
    birthYear: person.birthYear != null ? String(person.birthYear) : '',
    deathYear: person.deathYear != null ? String(person.deathYear) : '',
    isGroup: !!person.isGroup,
    summary: person.summary ?? '',
    biography: person.biography ?? '',
    notes: person.notes ?? '',
  };

  const lifespan = person.birthYear || person.deathYear
    ? `${person.birthYear ?? '?'}–${person.deathYear ?? '?'}`
    : null;

  return (
    <article className="page">
      <nav aria-label="Breadcrumb" className="no-print" style={{ marginBottom: 'var(--space-4)' }}>
        <Link to="/browse" className="label-type">← The artist index</Link>
      </nav>

      <ArticleHeader
        eyebrow={person.isGroup ? 'Ensemble' : 'Artist'}
        title={person.name}
        subtitle={person.summary}
        badges={
          <>
            <Badge tone="brass">
              {person.recordCount} record{person.recordCount === 1 ? '' : 's'}
            </Badge>
            {person.voiceOrInstrument && <Badge tone="blue">{person.voiceOrInstrument}</Badge>}
            {lifespan && <span className="label-type stamp-type">{lifespan}</span>}
            {person.nationality && <span className="label-type">{person.nationality}</span>}
          </>
        }
        actions={
          <>
            <Button size="sm" variant="brass" onClick={() => setEditing(true)}>Edit</Button>
            <ButtonLink size="sm" variant="ghost" to={`/catalog?person=${person.slug}`}>
              All their records
            </ButtonLink>
          </>
        }
      />

      {person.aliases?.length > 0 && (
        <div className="plate" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
          <div className="label-type">Also credited as</div>
          <p style={{ margin: 'var(--space-2) 0 0' }}>
            {person.aliases.map((alias, index) => (
              <span key={alias}>
                {index > 0 && ' · '}
                <Link to={`/catalog?q=${encodeURIComponent(alias)}`}>{alias}</Link>
              </span>
            ))}
          </p>
          <p style={{ margin: 'var(--space-2) 0 0', color: 'var(--fg-soft)',
                      fontSize: 'var(--text-sm)' }}>
            A cylinder credited to any of these names is this artist.
          </p>
        </div>
      )}

      <div
        style={{
          display: 'grid', gap: 'var(--space-6)',
          gridTemplateColumns: isWide ? 'minmax(0, 1fr) 20rem' : 'minmax(0, 1fr)',
          alignItems: 'start',
        }}
      >
        <div style={{ minWidth: 0 }}>
          {person.biography ? (
            <Markdown text={person.biography} dropcap />
          ) : (
            <p className="prose" style={{ color: 'var(--fg-faint)' }}>
              No biography has been written yet.{' '}
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Write it</Button>
            </p>
          )}

          {person.notes && (
            <section aria-labelledby="person-notes">
              <SectionHeading id="person-notes">Notes</SectionHeading>
              <Markdown text={person.notes} />
            </section>
          )}

          <section aria-labelledby="person-records">
            <SectionHeading id="person-records">Records</SectionHeading>
            {groups.length === 0 ? (
              <p style={{ color: 'var(--fg-faint)' }}>
                Nothing credited to this artist has been catalogued yet.
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.key} style={{ marginBottom: 'var(--space-5)' }}>
                  <h3 className="label-type" style={{ marginBottom: 'var(--space-2)' }}>
                    {group.heading} ({group.records.length})
                  </h3>
                  <RecordLedger records={group.records} />
                </div>
              ))
            )}
            {person.recordCount > (person.records?.length ?? 0) && (
              <p>
                <Link to={`/catalog?person=${person.slug}`}>
                  All {person.recordCount} records crediting this artist →
                </Link>
              </p>
            )}
          </section>
        </div>

        <aside style={{ display: 'grid', gap: 'var(--space-5)', minWidth: 0 }}>
          <div className="plate" style={{ padding: 'var(--space-4)' }}>
            <h2 className="label-type" style={{ margin: '0 0 var(--space-3)',
                                                fontSize: 'var(--text-sm)' }}>
              The artist
            </h2>
            <DataList columns={1}>
              <DataPair label="Name as printed">{person.name}</DataPair>
              <DataPair label="Full name">{person.fullName ?? '—'}</DataPair>
              <DataPair label="Sorts as">{person.sortName ?? '—'}</DataPair>
              <DataPair label="Pseudonyms">
                {person.aliases?.length ? person.aliases.join(' · ') : '—'}
              </DataPair>
              <DataPair label="Voice or instrument">{person.voiceOrInstrument ?? '—'}</DataPair>
              <DataPair label="Nationality">{person.nationality ?? '—'}</DataPair>
              <DataPair label="Born" stamp>{person.birthYear ?? '—'}</DataPair>
              <DataPair label="Died" stamp>{person.deathYear ?? '—'}</DataPair>
              <DataPair label="Kind">{person.isGroup ? 'Group or ensemble' : 'Individual'}</DataPair>
              <DataPair label="Records here" stamp>{person.recordCount}</DataPair>
            </DataList>
          </div>

          {person.roles?.length ? (
            <div className="plate" style={{ padding: 'var(--space-4)' }}>
              <h2 className="label-type" style={{ margin: '0 0 var(--space-3)',
                                                  fontSize: 'var(--text-sm)' }}>
                Credited as
              </h2>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {person.roles.map((role) => (
                  <li key={role.role} className="spread" style={{ padding: 'var(--space-1) 0' }}>
                    <span>{ROLE_LABELS[role.role] ?? role.role}</span>
                    <span className="stamp-type">{role.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {person.links?.length > 0 && (
            <section className="plate" style={{ padding: 'var(--space-4)' }}
                     aria-labelledby="person-links">
              <h2 id="person-links" className="label-type"
                  style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--text-sm)' }}>
                Elsewhere
              </h2>
              <LinkGroups links={person.links} dense />
            </section>
          )}
        </aside>
      </div>

      <EntityEditor
        open={editing}
        title={`Edit ${person.name}`}
        fields={FIELDS}
        initial={initial}
        links={person.links ?? []}
        onClose={() => setEditing(false)}
        onSave={save}
      />
    </article>
  );
}

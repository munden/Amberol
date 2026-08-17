/**
 * Finding the title in the master catalog — the main way a cylinder joins the
 * shelf. Type a few letters of the title, the performer or the catalog
 * number; the register's search tolerates a misspelling, so "feding" still
 * finds "Feeding".
 */
import { useEffect, useState } from 'react';
import { Notice, Spinner, TextField, useDebounced } from '../ui';
import { MATERIAL_LABELS, api, cylinderClass, formatDate } from '../../lib/api';
import type { CatalogSummary } from '../../lib/api';

export default function CatalogPicker({
  onPick, autoFocus = false,
}: { onPick: (record: CatalogSummary) => void; autoFocus?: boolean }) {
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 300);
  const [results, setResults] = useState<CatalogSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [mode, setMode] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const term = debounced.trim();
    if (term.length < 2) {
      setResults([]);
      setTotal(0);
      setError(null);
      setLoading(false);
      return undefined;
    }
    let live = true;
    setLoading(true);
    setError(null);
    api.catalog.list({ q: term, pageSize: 12 }).then(
      (response) => {
        if (!live) return;
        setResults(response.data);
        setTotal(response.total);
        setMode(response.matchMode);
        setLoading(false);
      },
      (err) => {
        if (!live) return;
        setError(err);
        setLoading(false);
      },
    );
    return () => { live = false; };
  }, [debounced]);

  return (
    <div className="stack">
      <TextField
        label="Search the master catalog"
        type="search"
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Title, performer, or catalog number"
        hint="Two letters is enough to start. Spelling need not be exact."
      />

      {loading && <Spinner label="Searching the catalog" />}

      {error != null && (
        <Notice tone="danger" title="The catalog could not be searched">
          {error instanceof Error ? error.message : 'Something went wrong.'} You can still add this
          cylinder as an unidentified copy below.
        </Notice>
      )}

      {!loading && debounced.trim().length >= 2 && results.length === 0 && !error && (
        <Notice title="Nothing in the master list matches">
          Nothing found for “{debounced.trim()}”. Either the title is not catalogued yet, or it is
          spelled differently — add it as an unidentified copy and match it later.
        </Notice>
      )}

      {results.length > 0 && (
        <>
          <p className="label-type" style={{ margin: 0 }}>
            {total} {total === 1 ? 'title' : 'titles'}
            {mode === 'fuzzy' && ' · matched by approximate spelling'}
          </p>
          <ul className="cx-result-list plate" style={{ padding: 'var(--space-2)' }}>
            {results.map((record) => (
              <li key={record.id}>
                <button type="button" className="cx-result" onClick={() => onPick(record)}>
                  <span className="cx-thumb" style={{ width: 56, height: 32, flex: '0 0 auto' }}>
                    {record.primaryImageUrl ? (
                      <img src={record.primaryImageUrl} alt="" />
                    ) : (
                      <span
                        className={`cylinder ${cylinderClass(record.series.material, record.series.colour)}`}
                        style={{ display: 'block', width: '100%', height: '100%' }}
                      />
                    )}
                  </span>
                  <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <span style={{
                      display: 'block', fontFamily: 'var(--font-title)', fontWeight: 600,
                    }}>
                      {record.title}
                      {record.subtitle ? <span style={{ color: 'var(--fg-soft)' }}> — {record.subtitle}</span> : null}
                    </span>
                    <span style={{ display: 'block', fontSize: 'var(--text-sm)', color: 'var(--fg-soft)' }}>
                      <span className="stamp-type">{record.catalogNumber}</span>
                      {' · '}{record.series.name}
                      {' · '}{MATERIAL_LABELS[record.series.material]}
                      {record.performers ? ` · ${record.performers}` : ''}
                      {record.releasedOn ? ` · ${formatDate(record.releasedOn, record.releasedPrecision)}` : ''}
                      {record.ownedCount > 0 ? ` · you own ${record.ownedCount}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

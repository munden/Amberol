/**
 * Shared furniture for the encyclopedia half of the register: the pieces the
 * master list, the record page and the maker / series / person articles all
 * set from the same type case.
 *
 * Nothing here invents styling — every rule comes from styles/tokens.css.
 */
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Fleuron } from '../ui';
import { excerpt } from '../Markdown';
import {
  MATERIAL_LABELS,
  cylinderClass,
  formatDate,
  type CatalogSummary,
  type Confidence,
  type CreditRole,
  type CylinderMaterial,
  type LinkKind,
  type RecordLink,
  type SeriesRef,
} from '../../lib/api';

// ------------------------------------------------------------------ vocabulary

export const LINK_KIND_LABELS: Record<LinkKind, string> = {
  audio: 'Hear it',
  discography: 'Discographies',
  encyclopedia: 'Encyclopedia',
  catalog_scan: 'Catalog scans',
  sheet_music: 'Sheet music',
  image: 'Pictures',
  article: 'Articles',
  video: 'Film',
  other: 'Other references',
};

/** Audio first: a link that lets the collector hear the cylinder is the prize. */
export const LINK_KIND_ORDER: LinkKind[] = [
  'audio', 'catalog_scan', 'discography', 'encyclopedia',
  'sheet_music', 'image', 'video', 'article', 'other',
];

export const ROLE_LABELS: Record<CreditRole, string> = {
  performer: 'Performers',
  vocalist: 'Vocalists',
  instrumentalist: 'Instrumentalists',
  ensemble: 'Ensembles',
  orchestra: 'Orchestra',
  band: 'Band',
  conductor: 'Conductor',
  composer: 'Composers',
  lyricist: 'Lyricists',
  arranger: 'Arrangers',
  speaker: 'Speakers',
  comedian: 'Comedians',
  whistler: 'Whistlers',
  accompanist: 'Accompanists',
  announcer: 'Announcers',
  other: 'Other credits',
};

export const ROLE_ORDER: CreditRole[] = [
  'performer', 'vocalist', 'instrumentalist', 'whistler', 'speaker', 'comedian',
  'ensemble', 'orchestra', 'band', 'conductor', 'accompanist', 'announcer',
  'composer', 'lyricist', 'arranger', 'other',
];

export const ROLE_SINGULAR: Record<CreditRole, string> = {
  performer: 'Performer', vocalist: 'Vocalist', instrumentalist: 'Instrumentalist',
  ensemble: 'Ensemble', orchestra: 'Orchestra', band: 'Band', conductor: 'Conductor',
  composer: 'Composer', lyricist: 'Lyricist', arranger: 'Arranger', speaker: 'Speaker',
  comedian: 'Comedian', whistler: 'Whistler', accompanist: 'Accompanist',
  announcer: 'Announcer', other: 'Other',
};

export const CONFIDENCE_TEXT: Record<Confidence, string> = {
  verified: 'Checked against a printed source.',
  probable: 'Probable — assembled from indirect evidence and not yet confirmed against a printed source.',
  uncertain: 'Uncertain — some details here are unconfirmed and may be wrong.',
};

// ------------------------------------------------------------------- utilities

/** Matches a media query, and keeps matching as the window is resized. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** The year a record belongs to: release where known, else recording. */
export function recordYear(record: {
  releasedOn?: string | null;
  recordedOn?: string | null;
}): number | null {
  const raw = record.releasedOn ?? record.recordedOn;
  if (!raw) return null;
  const year = Number(raw.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

/** The date a list row shows, respecting the precision it was recorded at. */
export function recordDateLabel(record: CatalogSummary): string {
  if (record.releasedOn) return formatDate(record.releasedOn, record.releasedPrecision);
  if (record.recordedOn) return `rec. ${formatDate(record.recordedOn, record.recordedPrecision)}`;
  return '—';
}

export function seriesLine(series: SeriesRef | null | undefined): string {
  if (!series) return '';
  const bits = [MATERIAL_LABELS[series.material] ?? 'Unknown'];
  if (series.playMinutes) bits.push(`${series.playMinutes}-minute`);
  return bits.join(' · ');
}

export function materialTone(material: CylinderMaterial | null | undefined,
                             colour: string | null | undefined) {
  const cls = cylinderClass(material, colour);
  if (cls === 'cylinder-purple') return 'purple' as const;
  if (cls === 'cylinder-blue') return 'blue' as const;
  if (cls === 'cylinder-brown' || cls === 'cylinder-wax') return 'oxblood' as const;
  return 'brass' as const;
}

// ------------------------------------------------------------------ ornaments

/** The cylinder motif, tinted by the material and colour of its series. */
export function CylinderMotif({
  series, style, className = '', imageUrl, alt,
}: {
  series?: SeriesRef | null;
  style?: CSSProperties;
  className?: string;
  imageUrl?: string | null;
  alt?: string;
}) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={alt ?? ''}
        loading="lazy"
        className={className}
        style={{
          width: '100%', aspectRatio: '16 / 9', objectFit: 'cover',
          borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', ...style,
        }}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className={`cylinder ${cylinderClass(series?.material, series?.colour)} ${className}`.trim()}
      style={style}
    />
  );
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  if (confidence === 'verified') return null;
  return (
    <Badge tone={confidence === 'uncertain' ? 'danger' : 'warn'}>
      {confidence === 'uncertain' ? 'Uncertain' : 'Probable'}
    </Badge>
  );
}

/** The mark that says "you have this one" — the thing a collector scans for. */
export function OwnedMark({ count }: { count: number }) {
  if (!count) return null;
  return (
    <Badge tone="green">
      <span aria-hidden="true">✓</span>
      {count > 1 ? `${count} copies` : 'In collection'}
    </Badge>
  );
}

export function SectionHeading({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2
      id={id}
      className="rule-double"
      style={{
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--text-xl)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        paddingTop: 'var(--space-3)',
        marginTop: 'var(--space-6)',
      }}
    >
      {children}
    </h2>
  );
}

/** An outbound reference, always marked as leaving the register. */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span aria-hidden="true" style={{ color: 'var(--brass)' }}> ↗</span>
      <span className="visually-hidden"> (opens in a new tab)</span>
    </a>
  );
}

/**
 * External links grouped by kind, audio given the most weight — the collector
 * asked for links, and a recording they can play is the best of them.
 */
export function LinkGroups({ links, dense = false }: { links: RecordLink[]; dense?: boolean }) {
  if (!links?.length) return null;
  const groups = LINK_KIND_ORDER
    .map((kind) => ({ kind, items: links.filter((l) => l.kind === kind) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="stack">
      {groups.map(({ kind, items }) => (
        <div key={kind}>
          <div className="label-type" style={{ marginBottom: 'var(--space-2)' }}>
            {LINK_KIND_LABELS[kind]}
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {items.map((link) => (
              <li
                key={link.id ?? link.url}
                style={{
                  padding: kind === 'audio' && !dense ? 'var(--space-3)' : 'var(--space-1) 0',
                  marginBottom: 'var(--space-2)',
                  border: kind === 'audio' && !dense ? '1px solid var(--brass)' : undefined,
                  borderRadius: kind === 'audio' && !dense ? 'var(--radius-sm)' : undefined,
                  background: kind === 'audio' && !dense ? 'var(--bg-sunken)' : undefined,
                  display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline',
                }}
              >
                {kind === 'audio' && (
                  <span aria-hidden="true" style={{ color: 'var(--brass)' }}>▶</span>
                )}
                <span>
                  <ExternalLink href={link.url}>{link.label}</ExternalLink>
                  {link.sourceName && (
                    <span style={{ color: 'var(--fg-faint)', fontSize: 'var(--text-sm)' }}>
                      {' '}— {link.sourceName}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- record rows

/** One catalog row as a card — the shape the list takes on a phone. */
export function RecordCard({ record }: { record: CatalogSummary }) {
  const blurb = excerpt(record.description, 150);
  return (
    <article
      className="plate"
      style={{ padding: 'var(--space-4)', display: 'grid', gap: 'var(--space-3)' }}
    >
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
        <CylinderMotif
          series={record.series}
          imageUrl={record.primaryImageUrl}
          alt=""
          style={{ width: '5.5rem', flexShrink: 0 }}
        />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="stamp-type" style={{ color: 'var(--fg-faint)' }}>
            {record.catalogNumber}
          </div>
          <h3 style={{ margin: '0 0 var(--space-1)', fontSize: 'var(--text-lg)' }}>
            <Link to={`/catalog/${record.slug}`}>{record.title}</Link>
          </h3>
          {record.subtitle && (
            <div style={{ color: 'var(--fg-soft)', fontStyle: 'italic', fontSize: 'var(--text-sm)' }}>
              {record.subtitle}
            </div>
          )}
          {record.performers && (
            <div style={{ color: 'var(--fg-soft)', fontSize: 'var(--text-sm)' }}>
              {record.performers}
            </div>
          )}
        </div>
      </div>

      <div className="row" style={{ gap: 'var(--space-2)' }}>
        <OwnedMark count={record.ownedCount} />
        <ConfidenceBadge confidence={record.confidence} />
        {record.series && (
          <Badge tone={materialTone(record.series.material, record.series.colour)}>
            {record.series.name}
          </Badge>
        )}
        <span className="stamp-type" style={{ color: 'var(--fg-faint)' }}>
          {recordDateLabel(record)}
        </span>
      </div>

      {blurb && (
        <p style={{ margin: 0, color: 'var(--fg-soft)', fontSize: 'var(--text-sm)' }}>{blurb}</p>
      )}

      <div className="row" style={{ gap: 'var(--space-2)', fontSize: 'var(--text-sm)' }}>
        {record.series && (
          <span className="label-type">{seriesLine(record.series)}</span>
        )}
        {record.genre && <span className="label-type">{record.genre}</span>}
        {record.linkCount > 0 && (
          <span className="label-type">
            {record.linkCount} link{record.linkCount === 1 ? '' : 's'}
          </span>
        )}
      </div>
    </article>
  );
}

/** The dense ledger the collector reads at a desk. */
export function RecordLedger({ records }: { records: CatalogSummary[] }) {
  return (
    <div className="table-scroll">
      <table className="ledger">
        <thead>
          <tr>
            <th scope="col">No.</th>
            <th scope="col">Title</th>
            <th scope="col" className="hide-mobile">Performers</th>
            <th scope="col" className="hide-mobile">Series</th>
            <th scope="col">Date</th>
            <th scope="col"><span className="visually-hidden">Held</span>Shelf</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const blurb = excerpt(record.description, 130);
            return (
              <tr key={record.id}>
                <td className="stamp-type" style={{ whiteSpace: 'nowrap' }}>
                  {record.catalogNumber}
                </td>
                <td style={{ minWidth: '16rem' }}>
                  <Link to={`/catalog/${record.slug}`} style={{ fontWeight: 600 }}>
                    {record.title}
                  </Link>
                  {record.subtitle && (
                    <span style={{ color: 'var(--fg-soft)', fontStyle: 'italic' }}>
                      {' '}({record.subtitle})
                    </span>
                  )}
                  {record.confidence !== 'verified' && (
                    <>
                      {' '}
                      <ConfidenceBadge confidence={record.confidence} />
                    </>
                  )}
                  {blurb && (
                    <div
                      className="hide-mobile"
                      style={{ color: 'var(--fg-soft)', fontSize: 'var(--text-sm)',
                               lineHeight: 'var(--leading-snug)', marginTop: 'var(--space-1)',
                               maxWidth: '46ch' }}
                    >
                      {blurb}
                    </div>
                  )}
                </td>
                <td className="hide-mobile" style={{ color: 'var(--fg-soft)', maxWidth: '16rem' }}>
                  {record.performers || '—'}
                  {record.genre && (
                    <div className="label-type" style={{ marginTop: 'var(--space-1)' }}>
                      {record.genre}
                    </div>
                  )}
                </td>
                <td className="hide-mobile" style={{ maxWidth: '14rem' }}>
                  {record.series ? (
                    <>
                      <Link to={`/series/${record.series.slug}`}>{record.series.name}</Link>
                      <div className="label-type" style={{ marginTop: 'var(--space-1)' }}>
                        {seriesLine(record.series)}
                      </div>
                    </>
                  ) : '—'}
                </td>
                <td className="stamp-type" style={{ whiteSpace: 'nowrap' }}>
                  {recordDateLabel(record)}
                </td>
                <td>
                  <OwnedMark count={record.ownedCount} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A compact cross-reference list, used all over the record page. */
export function RecordRefList({ records, emptyText }:
  { records: CatalogSummary[]; emptyText?: string }) {
  if (!records?.length) {
    return emptyText ? <p style={{ color: 'var(--fg-faint)' }}>{emptyText}</p> : null;
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid',
                 gap: 'var(--space-2)' }}>
      {records.map((r) => (
        <li key={r.id} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'baseline',
                                flexWrap: 'wrap' }}>
          <span className="stamp-type" style={{ color: 'var(--fg-faint)', minWidth: '4.5rem' }}>
            {r.catalogNumber}
          </span>
          <span style={{ flex: 1, minWidth: '10rem' }}>
            <Link to={`/catalog/${r.slug}`}>{r.title}</Link>
            {r.series && (
              <span style={{ color: 'var(--fg-soft)', fontSize: 'var(--text-sm)' }}>
                {' '}· {r.series.name}
              </span>
            )}
          </span>
          <OwnedMark count={r.ownedCount} />
        </li>
      ))}
    </ul>
  );
}

/** Rule, ornament, rule — re-exported so pages need one import for furniture. */
export { Fleuron };

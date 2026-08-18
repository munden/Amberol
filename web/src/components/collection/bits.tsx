/**
 * The small repeated marks of the shelf: the thumbnail well, the cleaned
 * stamp, defect badges and severity pips. Every one of them is used both in
 * the list and on the detail page, so they live here.
 */
import type { ReactNode } from 'react';
import { Badge, Button, Modal } from '../ui';
import { MATERIAL_LABELS, cylinderClass, formatDate, formatDateTime } from '../../lib/api';
import type { CleaningSummary, CollectionItem, CylinderMaterial, ItemDefect } from '../../lib/api';
import { daysSince } from './hooks';

// ------------------------------------------------------------------- thumbs

/**
 * The collector's own photograph when they have taken one, otherwise the
 * cylinder motif tinted by the material of the series.
 */
export function Thumb({
  item, width = 74, height = 42, showCount = false,
}: { item: CollectionItem; width?: number | string; height?: number | string; showCount?: boolean }) {
  const series = item.record?.series;
  const material = series?.material;
  const label = item.primaryImageUrl
    ? `Photograph of ${item.displayTitle}`
    : `${MATERIAL_LABELS[material ?? 'unknown']} cylinder`;

  return (
    <div className="cx-thumb" style={{ width, height }}>
      {item.primaryImageUrl ? (
        <img src={item.primaryImageUrl} alt={label} loading="lazy" />
      ) : (
        <div
          className={`cylinder ${cylinderClass(material, series?.colour)}`}
          role="img"
          aria-label={label}
        />
      )}
      {showCount && item.imageCount > 1 && (
        <span className="cx-thumb-count">{item.imageCount}</span>
      )}
    </div>
  );
}

// ------------------------------------------------------------ cleaned stamp

export type CleanedTone = 'clean' | 'due' | 'never';

export function cleanedTone(cleaning: CleaningSummary | null | undefined): CleanedTone {
  if (!cleaning?.isCleaned || !cleaning.lastCleanedAt) return 'never';
  const days = daysSince(cleaning.lastCleanedAt);
  return days !== null && days > 365 ? 'due' : 'clean';
}

/**
 * The cleaned state with the date it was last done and by what method — the
 * fact the collector asked to see without opening anything.
 */
export function CleanedStamp({
  cleaning, withTime = false,
}: { cleaning: CleaningSummary | null | undefined; withTime?: boolean }) {
  const tone = cleanedTone(cleaning);

  if (tone === 'never') {
    return (
      <span className="cx-stamp cx-stamp-never">
        <span className="cx-stamp-mark">Never cleaned</span>
      </span>
    );
  }

  const when = withTime
    ? formatDateTime(cleaning?.lastCleanedAt)
    : formatDate(cleaning?.lastCleanedAt ?? null, 'day');

  return (
    <span className={`cx-stamp ${tone === 'due' ? 'cx-stamp-due' : 'cx-stamp-clean'}`}>
      <span className="cx-stamp-mark">{tone === 'due' ? 'Due again' : 'Cleaned'}</span>
      <span title={formatDateTime(cleaning?.lastCleanedAt)}>{when}</span>
      {cleaning?.lastMethod && (
        <span className="cx-stamp-detail">· {cleaning.lastMethod}</span>
      )}
      {cleaning && cleaning.cleaningCount > 1 && (
        <span className="cx-stamp-detail">· {cleaning.cleaningCount} entries</span>
      )}
    </span>
  );
}

// ------------------------------------------------------------------ defects

export function SeverityPips({ severity }: { severity: number }) {
  return (
    <span className="cx-pips" role="img" aria-label={`Severity ${severity} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={`cx-pip${n <= severity ? ' is-on' : ''}`} />
      ))}
    </span>
  );
}

/**
 * Terminal faults read as danger, marked ones as a warning, the rest in the
 * Amberol blue — brass on cream is too faint to carry small type at the
 * contrast the register holds itself to.
 */
export function defectTone(defect: ItemDefect): 'danger' | 'warn' | 'blue' {
  if (defect.defectType.isTerminal) return 'danger';
  return defect.severity >= 3 ? 'warn' : 'blue';
}

/** Unresolved defects as badges; terminal faults are marked apart. */
export function DefectBadges({ defects, max = 4 }: { defects: ItemDefect[]; max?: number }) {
  const open = defects.filter((d) => !d.isResolved);
  if (open.length === 0) {
    return <span style={{ color: 'var(--fg-faint)' }}>No faults noted</span>;
  }
  const shown = open.slice(0, max);
  return (
    <span className="cx-badges">
      {shown.map((d) => (
        <Badge key={d.id} tone={defectTone(d)}>
          {d.defectType.isTerminal && <span aria-hidden="true">✜</span>}
          {d.defectType.label}
          {d.severity >= 3 ? ` ${d.severity}` : ''}
        </Badge>
      ))}
      {open.length > shown.length && (
        <Badge tone="blue">+{open.length - shown.length}</Badge>
      )}
    </span>
  );
}

// -------------------------------------------------------------- misc marks

export function MaterialLine({ material }: { material: CylinderMaterial | null | undefined }) {
  return <span>{MATERIAL_LABELS[material ?? 'unknown']}</span>;
}

export function Flags({ item }: { item: CollectionItem }) {
  return (
    <span className="cx-badges">
      {item.isFavourite && <Badge tone="oxblood">★ Favourite</Badge>}
      {item.isForTrade && <Badge tone="purple">For trade</Badge>}
      {!item.isPlayable && <Badge tone="danger">Not playable</Badge>}
      {!item.record && <Badge tone="warn">Unidentified</Badge>}
    </span>
  );
}

// -------------------------------------------------------------- confirming

/** Nothing is destroyed without an explicit second answer. */
export function ConfirmDialog({
  open, title, children, confirmLabel = 'Delete', onConfirm, onCancel, busy = false,
}: {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <div className="stack">
        <div>{children}</div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onCancel}>Keep it</Button>
          <Button variant="primary" onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

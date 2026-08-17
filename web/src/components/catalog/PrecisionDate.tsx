/**
 * A date and the precision it is actually known to, edited together.
 *
 * Cylinder dating is uneven: a supplement gives a month, a ledger gives a day,
 * a reference book gives only "1916". The control changes shape with the
 * precision chosen, so the collector is never asked to invent a day they do
 * not have, and the stored value always matches its precision flag.
 */
import { useId } from 'react';
import type { DatePrecision } from '../../lib/api';

const PRECISIONS: { value: DatePrecision; label: string }[] = [
  { value: 'day', label: 'Exact day' },
  { value: 'month', label: 'Month only' },
  { value: 'year', label: 'Year only' },
  { value: 'decade', label: 'Decade only' },
];

export interface PrecisionDateProps {
  label: string;
  /** ISO YYYY-MM-DD, or '' when unknown. */
  value: string;
  precision: DatePrecision;
  onChange: (value: string, precision: DatePrecision) => void;
  hint?: string;
  error?: string;
}

/** Pads a partial date out to the first day of its period. */
function normalise(raw: string, precision: DatePrecision): string {
  if (!raw) return '';
  switch (precision) {
    case 'day': return raw.slice(0, 10);
    case 'month': return `${raw.slice(0, 7)}-01`;
    case 'year':
    case 'decade': return `${raw.slice(0, 4)}-01-01`;
    default: return raw;
  }
}

export function PrecisionDate({
  label, value, precision, onChange, hint, error,
}: PrecisionDateProps) {
  const base = useId();
  const valueId = `${base}-value`;
  const precisionId = `${base}-precision`;

  const year = value ? value.slice(0, 4) : '';
  const month = value ? value.slice(0, 7) : '';

  const changePrecision = (next: DatePrecision) => {
    onChange(normalise(value, next), next);
  };

  return (
    <div>
      <label className="field-label" htmlFor={valueId}>{label}</label>
      <div className="row" style={{ gap: 'var(--space-2)', flexWrap: 'nowrap',
                                    alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 10rem' }}>
          {precision === 'day' && (
            <input
              id={valueId} className="field" type="date" value={value}
              aria-describedby={error ? `${base}-error` : hint ? `${base}-hint` : undefined}
              aria-invalid={error ? true : undefined}
              onChange={(e) => onChange(e.target.value, precision)}
            />
          )}
          {precision === 'month' && (
            <input
              id={valueId} className="field" type="month" value={month}
              aria-invalid={error ? true : undefined}
              onChange={(e) => onChange(
                e.target.value ? `${e.target.value}-01` : '', precision,
              )}
            />
          )}
          {(precision === 'year' || precision === 'decade') && (
            <input
              id={valueId} className="field" type="number" inputMode="numeric"
              min={1877} max={2100} step={precision === 'decade' ? 10 : 1}
              placeholder={precision === 'decade' ? '1910' : '1916'}
              value={year}
              aria-invalid={error ? true : undefined}
              onChange={(e) => onChange(
                e.target.value ? `${e.target.value.padStart(4, '0').slice(0, 4)}-01-01` : '',
                precision,
              )}
            />
          )}
        </div>
        <div style={{ flex: '0 1 10rem' }}>
          <label className="visually-hidden" htmlFor={precisionId}>
            How precisely {label.toLowerCase()} is known
          </label>
          <select
            id={precisionId}
            className="field"
            value={precision}
            onChange={(e) => changePrecision(e.target.value as DatePrecision)}
          >
            {PRECISIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      </div>
      {hint && !error && <div className="field-hint" id={`${base}-hint`}>{hint}</div>}
      {error && <div className="field-error" id={`${base}-error`} role="alert">{error}</div>}
    </div>
  );
}

export default PrecisionDate;

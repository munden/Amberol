/**
 * The shared scaffolding for the three wiki-style article pages — maker,
 * series and person. Each is the same printed object: a masthead, long-form
 * prose, a specification plate of the structured facts, the citations, and the
 * list of records it accounts for. Each is editable in place.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Checkbox, Modal, Notice, Select, TextArea, TextField } from '../ui';
import { ApiError } from '../../lib/api';

// -------------------------------------------------------------- article shell

export function ArticleHeader({
  eyebrow, title, subtitle, badges, actions,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="plate" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
      <div className="eyebrow">{eyebrow}</div>
      <div className="spread" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0 }}>{title}</h1>
          {subtitle && (
            <p style={{ margin: 'var(--space-2) 0 0', color: 'var(--fg-soft)',
                        fontSize: 'var(--text-lg)' }}>
              {subtitle}
            </p>
          )}
          {badges && (
            <div className="row" style={{ marginTop: 'var(--space-3)', gap: 'var(--space-2)' }}>
              {badges}
            </div>
          )}
        </div>
        {actions && <div className="row no-print">{actions}</div>}
      </div>
    </header>
  );
}

// ------------------------------------------------------------------- editing

export type EntityFieldType = 'text' | 'number' | 'textarea' | 'checkbox' | 'select' | 'list';

export interface EntityFieldDef {
  name: string;
  label: string;
  type: EntityFieldType;
  hint?: string;
  rows?: number;
  options?: { value: string; label: string }[];
  /** Widths only matter on the wide layout; a full-width field takes the row. */
  full?: boolean;
}

export type EntityValues = Record<string, string | boolean | string[]>;

/**
 * The edit form for a maker, series or person. Rendered in a modal so the
 * article stays where it was, and carrying the same edit-summary field the
 * catalog uses — every entity edit is written into the same history.
 */
export function EntityEditor({
  open, title, fields, initial, onClose, onSave,
}: {
  open: boolean;
  title: string;
  fields: EntityFieldDef[];
  initial: EntityValues;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  const initialKey = useMemo(() => JSON.stringify(initial), [initial]);
  const [values, setValues] = useState<EntityValues>(initial);
  const [summary, setSummary] = useState('');
  const [editor, setEditor] = useState('collector');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [details, setDetails] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setValues(initial);
      setSummary('');
      setError(null);
      setDetails({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialKey]);

  const set = (name: string, value: string | boolean | string[]) =>
    setValues((prev) => ({ ...prev, [name]: value }));

  const submit = async () => {
    setSaving(true);
    setError(null);
    setDetails({});
    const body: Record<string, unknown> = {
      editSummary: summary.trim() || null,
      editor: editor.trim() || 'collector',
    };
    for (const field of fields) {
      const value = values[field.name];
      if (field.type === 'checkbox') body[field.name] = !!value;
      else if (field.type === 'list') {
        body[field.name] = Array.isArray(value)
          ? value
          : String(value ?? '').split(',').map((v) => v.trim()).filter(Boolean);
      } else if (field.type === 'number') {
        const raw = String(value ?? '').trim();
        body[field.name] = raw === '' ? null : Number(raw);
      } else {
        const raw = String(value ?? '').trim();
        body[field.name] = raw === '' ? null : raw;
      }
    }
    try {
      await onSave(body);
      onClose();
    } catch (err) {
      setError(err);
      if (err instanceof ApiError && err.status === 422 && err.details) setDetails(err.details);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      {error ? (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <Notice tone="danger" title="Not saved">
            {error instanceof Error ? error.message : 'Something went wrong.'}
          </Notice>
        </div>
      ) : null}
      <div style={{ display: 'grid', gap: 'var(--space-4)',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))' }}>
        {fields.map((field) => {
          const value = values[field.name];
          const error1 = details[field.name];
          const style = field.full || field.type === 'textarea'
            ? { gridColumn: '1 / -1' } : undefined;
          return (
            <div key={field.name} style={style}>
              {field.type === 'textarea' && (
                <TextArea
                  label={field.label} hint={field.hint} error={error1}
                  rows={field.rows ?? 6}
                  value={String(value ?? '')}
                  onChange={(e) => set(field.name, e.target.value)}
                />
              )}
              {field.type === 'checkbox' && (
                <Checkbox
                  label={field.label}
                  checked={!!value}
                  onChange={(v) => set(field.name, v)}
                />
              )}
              {field.type === 'select' && (
                <Select
                  label={field.label} hint={field.hint} error={error1}
                  value={String(value ?? '')}
                  onChange={(e) => set(field.name, e.target.value)}
                >
                  {(field.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
              )}
              {(field.type === 'text' || field.type === 'number' || field.type === 'list') && (
                <TextField
                  label={field.label}
                  hint={field.type === 'list' ? (field.hint ?? 'Separated by commas.') : field.hint}
                  error={error1}
                  inputMode={field.type === 'number' ? 'numeric' : undefined}
                  value={Array.isArray(value) ? value.join(', ') : String(value ?? '')}
                  onChange={(e) => set(
                    field.name,
                    field.type === 'list'
                      ? e.target.value.split(',').map((v) => v.trimStart())
                      : e.target.value,
                  )}
                />
              )}
            </div>
          );
        })}

        <div style={{ gridColumn: '1 / -1' }}>
          <TextField
            label="Edit summary"
            hint="Kept in this page's history, as on a wiki."
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </div>
        <div>
          <TextField label="Editor" value={editor} onChange={(e) => setEditor(e.target.value)} />
        </div>
      </div>

      <div className="row" style={{ marginTop: 'var(--space-5)' }}>
        <Button variant="primary" onClick={submit} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
      </div>
    </Modal>
  );
}

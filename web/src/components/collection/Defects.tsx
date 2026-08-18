/**
 * Faults, and what to do about them.
 *
 * A defect is only worth recording because of the advice it carries, so the
 * `careAdvice` of the defect type is shown with every fault rather than
 * hidden behind a tooltip. Terminal faults — a break, a celluloid split — are
 * marked apart, since nothing will bring those back.
 *
 * Two exports: a draft editor for the add/edit form, and a server-backed
 * panel for the detail page.
 */
import { useMemo, useState } from 'react';
import { Badge, Button, Checkbox, Modal, Notice, Select, TextArea, TextField } from '../ui';
import { api, formatDate } from '../../lib/api';
import type { DefectType, ItemDefect } from '../../lib/api';
import { ConfirmDialog, SeverityPips } from './bits';

export interface DraftDefect {
  key: string;
  id?: number;
  defectTypeId: number;
  severity: number;
  location: string;
  notes: string;
  isResolved: boolean;
}

export const SEVERITY_LABELS: Record<number, string> = {
  1: 'Barely worth noting',
  2: 'Slight',
  3: 'Marked',
  4: 'Serious',
  5: 'Ruinous',
};

let draftSeq = 0;
export function newDraftDefect(defectTypeId: number): DraftDefect {
  draftSeq += 1;
  return {
    key: `draft-${draftSeq}`,
    defectTypeId,
    severity: 2,
    location: '',
    notes: '',
    isResolved: false,
  };
}

export function draftsFrom(defects: ItemDefect[]): DraftDefect[] {
  return defects.map((d) => {
    draftSeq += 1;
    return {
      key: `saved-${d.id}`,
      id: d.id,
      defectTypeId: d.defectType.id,
      severity: d.severity,
      location: d.location ?? '',
      notes: d.notes ?? '',
      isResolved: d.isResolved,
    };
  });
}

/** Groups the vocabulary so a 26-item list is choosable on a phone. */
function useGroupedTypes(types: DefectType[]) {
  return useMemo(() => {
    const order: DefectType['category'][] =
      ['structural', 'core', 'surface', 'audio', 'contamination', 'packaging'];
    const labels: Record<DefectType['category'], string> = {
      structural: 'Structural',
      core: 'Core',
      surface: 'Surface',
      audio: 'Heard on playback',
      contamination: 'Contamination',
      packaging: 'Box and label',
    };
    return order
      .map((c) => ({ category: c, label: labels[c], types: types.filter((t) => t.category === c) }))
      .filter((g) => g.types.length > 0);
  }, [types]);
}

export function DefectTypeSelect({
  types, value, onChange, label = 'Fault', error, required,
}: {
  types: DefectType[];
  value: string;
  onChange: (v: string) => void;
  label?: string;
  error?: string;
  required?: boolean;
}) {
  const groups = useGroupedTypes(types);
  return (
    <Select
      label={label}
      value={value}
      error={error}
      required={required}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Choose a fault…</option>
      {groups.map((group) => (
        <optgroup key={group.category} label={group.label}>
          {group.types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}{t.isTerminal ? ' (terminal)' : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

/** The advice that makes recording the fault worth the trouble. */
export function CareAdvice({ type }: { type: DefectType }) {
  if (!type.careAdvice) return null;
  return (
    <p className="cx-advice">
      <span className="label-type">What to do</span><br />
      {type.careAdvice}
    </p>
  );
}

// ------------------------------------------------------- draft editor (form)

export function DefectDraftEditor({
  types, value, onChange, errors = {},
}: {
  types: DefectType[];
  value: DraftDefect[];
  onChange: (next: DraftDefect[]) => void;
  errors?: Record<string, string>;
}) {
  const [adding, setAdding] = useState('');
  const byId = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  const update = (key: string, change: Partial<DraftDefect>) =>
    onChange(value.map((d) => (d.key === key ? { ...d, ...change } : d)));

  return (
    <div className="stack">
      {value.length === 0 && (
        <p style={{ color: 'var(--fg-soft)', margin: 0 }}>
          No faults recorded. A clean cylinder needs no entry here.
        </p>
      )}

      {value.map((draft, index) => {
        const type = byId.get(draft.defectTypeId);
        return (
          <div
            key={draft.key}
            className={`cx-defect${type?.isTerminal ? ' cx-defect-terminal' : ''}${draft.isResolved ? ' cx-defect-resolved' : ''}`}
          >
            <div className="spread" style={{ alignItems: 'flex-start' }}>
              <strong style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--text-lg)' }}>
                {type?.label ?? 'Fault'}
                {type?.isTerminal && <> <Badge tone="danger">Terminal</Badge></>}
              </strong>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onChange(value.filter((d) => d.key !== draft.key))}
                aria-label={`Remove ${type?.label ?? 'this fault'}`}
              >
                Remove
              </Button>
            </div>

            <div className="cx-form-grid cx-form-grid-3" style={{ marginTop: 'var(--space-3)' }}>
              <Select
                label="Severity"
                value={String(draft.severity)}
                error={errors[`defects.${index}.severity`]}
                onChange={(e) => update(draft.key, { severity: Number(e.target.value) })}
              >
                {[1, 2, 3, 4, 5].map((s) => (
                  <option key={s} value={s}>{s} — {SEVERITY_LABELS[s]}</option>
                ))}
              </Select>
              <TextField
                label="Where"
                value={draft.location}
                placeholder="Rim, first third, near the end"
                error={errors[`defects.${index}.location`]}
                onChange={(e) => update(draft.key, { location: e.target.value })}
              />
              <div style={{ alignSelf: 'end' }}>
                <Checkbox
                  label="Resolved"
                  checked={draft.isResolved}
                  onChange={(v) => update(draft.key, { isResolved: v })}
                />
              </div>
            </div>

            <TextArea
              label="Notes"
              value={draft.notes}
              style={{ minHeight: '4.5rem' }}
              onChange={(e) => update(draft.key, { notes: e.target.value })}
            />

            {type && <CareAdvice type={type} />}
          </div>
        );
      })}

      <div style={{ maxWidth: '28rem' }}>
        <DefectTypeSelect
          label="Add a fault"
          types={types}
          value={adding}
          onChange={(v) => {
            if (!v) return;
            onChange([...value, newDraftDefect(Number(v))]);
            setAdding('');
          }}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------ server-backed panel (detail)

export function DefectPanel({
  itemId, defects, types, onChange,
}: {
  itemId: number;
  defects: ItemDefect[];
  types: DefectType[];
  onChange: () => void;
}) {
  const [editing, setEditing] = useState<ItemDefect | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ItemDefect | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [typeId, setTypeId] = useState('');
  const [severity, setSeverity] = useState('2');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [resolved, setResolved] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const byId = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const open = defects.filter((d) => !d.isResolved);
  const closed = defects.filter((d) => d.isResolved);

  function startCreate() {
    setCreating(true);
    setEditing(null);
    setTypeId('');
    setSeverity('2');
    setLocation('');
    setNotes('');
    setResolved(false);
    setFieldErrors({});
    setError(null);
  }

  function startEdit(defect: ItemDefect) {
    setEditing(defect);
    setCreating(false);
    setTypeId(String(defect.defectType.id));
    setSeverity(String(defect.severity));
    setLocation(defect.location ?? '');
    setNotes(defect.notes ?? '');
    setResolved(defect.isResolved);
    setFieldErrors({});
    setError(null);
  }

  async function save() {
    if (!typeId) {
      setFieldErrors({ defectTypeId: 'Choose which fault this is.' });
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      defectTypeId: Number(typeId),
      severity: Number(severity),
      location: location.trim() || null,
      notes: notes.trim() || null,
      isResolved: resolved,
    };
    try {
      if (editing) await api.collection.updateDefect(editing.id, body);
      else await api.collection.addDefect(itemId, body);
      setEditing(null);
      setCreating(false);
      onChange();
    } catch (err) {
      const details = (err as { details?: Record<string, string> }).details;
      if (details) setFieldErrors(details);
      setError(err instanceof Error ? err.message : 'That fault did not save.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleResolved(defect: ItemDefect) {
    setBusy(true);
    setError(null);
    try {
      await api.collection.updateDefect(defect.id, { isResolved: !defect.isResolved });
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  async function reallyDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.collection.removeDefect(deleting.id);
      setDeleting(null);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That fault could not be removed.');
    } finally {
      setBusy(false);
    }
  }

  const renderOne = (defect: ItemDefect) => {
    const type = byId.get(defect.defectType.id) ?? defect.defectType;
    return (
      <div
        key={defect.id}
        className={`cx-defect${type.isTerminal ? ' cx-defect-terminal' : ''}${defect.isResolved ? ' cx-defect-resolved' : ''}`}
      >
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div>
            <strong style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--text-lg)' }}>
              {type.label}
            </strong>{' '}
            {type.isTerminal && <Badge tone="danger">Terminal</Badge>}{' '}
            {defect.isResolved && <Badge tone="green">Resolved</Badge>}
            <div className="cx-meta" style={{ marginTop: 'var(--space-1)' }}>
              <span><SeverityPips severity={defect.severity} /> {SEVERITY_LABELS[defect.severity]}</span>
              {defect.location && <span>Where: {defect.location}</span>}
              <span className="stamp-type">Noted {formatDate(defect.notedOn, 'day')}</span>
            </div>
          </div>
          <div className="row no-print" style={{ gap: 'var(--space-1)' }}>
            <Button size="sm" variant="ghost" onClick={() => startEdit(defect)}>Edit</Button>
            <Button size="sm" variant="ghost" onClick={() => toggleResolved(defect)} disabled={busy}>
              {defect.isResolved ? 'Reopen' : 'Resolve'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDeleting(defect)}>Delete</Button>
          </div>
        </div>

        {defect.notes && <p style={{ margin: 'var(--space-2) 0 0' }}>{defect.notes}</p>}
        <CareAdvice type={type} />
      </div>
    );
  };

  return (
    <div className="stack">
      {error && <Notice tone="danger" title="That did not work">{error}</Notice>}

      {defects.some((d) => !d.isResolved && d.defectType.isTerminal) && (
        <Notice tone="danger" title="A fault that cannot be undone">
          This copy carries a terminal fault. Nothing will restore playback; handle it as a
          documentary object and keep it stable and cool.
        </Notice>
      )}

      {open.length === 0 && closed.length === 0 && (
        <p style={{ color: 'var(--fg-soft)', margin: 0 }}>
          No faults recorded against this copy.
        </p>
      )}

      {open.map(renderOne)}

      {closed.length > 0 && (
        <details>
          <summary className="label-type" style={{ cursor: 'pointer', minHeight: 'var(--touch)' }}>
            {closed.length} resolved {closed.length === 1 ? 'fault' : 'faults'}
          </summary>
          <div className="stack" style={{ marginTop: 'var(--space-3)' }}>{closed.map(renderOne)}</div>
        </details>
      )}

      <div className="row no-print">
        <Button onClick={startCreate}>Note a fault</Button>
      </div>

      <Modal
        open={creating || !!editing}
        onClose={() => { setCreating(false); setEditing(null); }}
        title={editing ? 'Edit this fault' : 'Note a fault'}
      >
        <div className="stack">
          <DefectTypeSelect
            types={types}
            value={typeId}
            required
            error={fieldErrors.defectTypeId}
            onChange={setTypeId}
          />
          {byId.get(Number(typeId)) && (
            <div className="cx-defect">
              {byId.get(Number(typeId))!.description}
              <CareAdvice type={byId.get(Number(typeId))!} />
            </div>
          )}
          <Select label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {[1, 2, 3, 4, 5].map((s) => (
              <option key={s} value={s}>{s} — {SEVERITY_LABELS[s]}</option>
            ))}
          </Select>
          <TextField
            label="Where"
            value={location}
            placeholder="Rim, first third, near the end"
            onChange={(e) => setLocation(e.target.value)}
          />
          <TextArea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Checkbox label="Already resolved" checked={resolved} onChange={setResolved} />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => { setCreating(false); setEditing(null); }}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save the fault'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Delete this fault?"
        confirmLabel="Delete the fault"
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={reallyDelete}
      >
        <p style={{ margin: 0 }}>
          {deleting?.defectType.label} will be removed from this copy's condition record. If the
          fault was repaired, mark it resolved instead — that keeps the history.
        </p>
      </ConfirmDialog>
    </div>
  );
}

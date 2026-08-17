/**
 * The cleaning log.
 *
 * Reverse-chronological, one entry per treatment, each carrying the date and
 * time, the method, the products, who did it, how long it took, the outcome
 * and the notes. A new entry defaults to now but the date and time are freely
 * editable, because most entries are written up days after the work.
 *
 * The material-safety counsel is the point of the whole screen: wax is ruined
 * by water and alcohol, celluloid will take a careful wash. The warning is
 * shown in the form before submitting and again from the server's own
 * `warnings` afterwards — and it never blocks the save. A collector recording
 * something already done needs an accurate history, not a tidy one.
 */
import { useMemo, useState } from 'react';
import {
  Badge, Button, Notice, Select, TextArea, TextField,
} from '../ui';
import {
  MATERIAL_LABELS, api, formatDateTime, isMethodUnsafe,
} from '../../lib/api';
import type {
  CleaningEvent, CleaningMethod, CleaningOutcome, CylinderMaterial, Warning,
} from '../../lib/api';
import { ConfirmDialog } from './bits';
import { fromLocalInput, toLocalInput } from './hooks';

const OUTCOME_LABELS: Record<CleaningOutcome, string> = {
  improved: 'Improved',
  no_change: 'No change',
  worsened: 'Worsened',
  unknown: 'Not yet judged',
};

const OUTCOME_TONE: Record<CleaningOutcome, 'green' | 'brass' | 'danger'> = {
  improved: 'green',
  no_change: 'brass',
  worsened: 'danger',
  unknown: 'brass',
};

interface FormState {
  cleanedAt: string;
  methodId: string;
  methodOther: string;
  productsUsed: string;
  performedBy: string;
  durationMinutes: string;
  outcome: CleaningOutcome | '';
  notes: string;
}

const OTHER = '__other__';

function blankForm(): FormState {
  return {
    cleanedAt: toLocalInput(null),
    methodId: '',
    methodOther: '',
    productsUsed: '',
    performedBy: '',
    durationMinutes: '',
    outcome: '',
    notes: '',
  };
}

function formFrom(event: CleaningEvent): FormState {
  return {
    cleanedAt: toLocalInput(event.cleanedAt),
    methodId: event.method ? String(event.method.id) : OTHER,
    methodOther: event.methodOther ?? '',
    productsUsed: event.productsUsed ?? '',
    performedBy: event.performedBy ?? '',
    durationMinutes: event.durationMinutes === null ? '' : String(event.durationMinutes),
    outcome: event.outcome ?? '',
    notes: event.notes ?? '',
  };
}

export default function CleaningLog({
  itemId, material, cleanings, methods, onChange,
}: {
  itemId: number;
  material: CylinderMaterial | null | undefined;
  cleanings: CleaningEvent[];
  methods: CleaningMethod[];
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<CleaningEvent | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const chosen = useMemo(
    () => methods.find((m) => String(m.id) === form.methodId) ?? null,
    [methods, form.methodId],
  );

  // The counsel shown before the entry is even submitted.
  const unsafe = chosen ? isMethodUnsafe(chosen, material) : false;
  const materialName = MATERIAL_LABELS[material ?? 'unknown'];

  function startNew() {
    setForm(blankForm());
    setEditingId(null);
    setErrors({});
    setSaveError(null);
    setWarnings([]);
    setOpen(true);
  }

  function startEdit(event: CleaningEvent) {
    setForm(formFrom(event));
    setEditingId(event.id);
    setErrors({});
    setSaveError(null);
    setWarnings([]);
    setOpen(true);
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!form.cleanedAt) next.cleanedAt = 'Say when this was done.';
    else if (!fromLocalInput(form.cleanedAt)) next.cleanedAt = 'That is not a date and time.';
    else if (new Date(form.cleanedAt).getTime() > Date.now() + 60_000) {
      next.cleanedAt = 'That is in the future. Log work once it has been done.';
    }
    if (!form.methodId) next.methodId = 'Choose the method used.';
    if (form.methodId === OTHER && !form.methodOther.trim()) {
      next.methodOther = 'Describe the method in a few words.';
    }
    if (form.durationMinutes && Number.isNaN(Number(form.durationMinutes))) {
      next.durationMinutes = 'Minutes, as a number.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit() {
    if (!validate()) return;
    setBusy(true);
    setSaveError(null);
    const body: Record<string, unknown> = {
      cleanedAt: fromLocalInput(form.cleanedAt),
      productsUsed: form.productsUsed.trim() || null,
      performedBy: form.performedBy.trim() || null,
      durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null,
      outcome: form.outcome || null,
      notes: form.notes.trim() || null,
    };
    if (form.methodId === OTHER) {
      body.methodOther = form.methodOther.trim();
      body.methodId = null;
    } else {
      body.methodId = Number(form.methodId);
      body.methodOther = form.methodOther.trim() || null;
    }

    try {
      const response = editingId
        ? await api.collection.updateCleaning(editingId, body)
        : await api.collection.addCleaning(itemId, body);
      setWarnings(response.warnings ?? []);
      setOpen(false);
      setEditingId(null);
      setForm(blankForm());
      onChange();
    } catch (error) {
      const details = (error as { details?: Record<string, string> }).details;
      if (details) setErrors(details);
      setSaveError(error instanceof Error ? error.message : 'That entry did not save.');
    } finally {
      setBusy(false);
    }
  }

  async function reallyDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.collection.removeCleaning(deleting.id);
      setDeleting(null);
      onChange();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'That entry could not be removed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {warnings.length > 0 && (
        <Notice tone="warn" title="Recorded, with a word of caution">
          <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
            {warnings.map((w) => <li key={w.code + w.message}>{w.message}</li>)}
          </ul>
        </Notice>
      )}

      {!open && (
        <div className="row">
          <Button variant="primary" onClick={startNew}>Log a cleaning</Button>
          {cleanings.length > 0 && (
            <span className="label-type">
              {cleanings.length} {cleanings.length === 1 ? 'entry' : 'entries'}
            </span>
          )}
        </div>
      )}

      {open && (
        <form
          className="plate stack"
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
        >
          <h3 style={{ marginTop: 0 }}>{editingId ? 'Edit this entry' : 'New cleaning entry'}</h3>

          <div className="cx-form-grid cx-form-grid-2">
            <TextField
              label="Date and time"
              type="datetime-local"
              required
              value={form.cleanedAt}
              error={errors.cleanedAt}
              hint="Defaults to now. Set it back for work done earlier."
              onChange={(e) => set('cleanedAt', e.target.value)}
            />
            <Select
              label="Method"
              required
              value={form.methodId}
              error={errors.methodId}
              onChange={(e) => set('methodId', e.target.value)}
            >
              <option value="">Choose a method…</option>
              {methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}{m.isRisky ? ' — risky' : ''}
                </option>
              ))}
              <option value={OTHER}>Something else — describe it</option>
            </Select>
          </div>

          {chosen?.description && (
            <p className="field-hint" style={{ marginTop: 0 }}>{chosen.description}</p>
          )}

          {(form.methodId === OTHER || chosen?.code === 'other') && (
            <TextField
              label="Method used"
              required={form.methodId === OTHER}
              value={form.methodOther}
              error={errors.methodOther}
              placeholder="Warm distilled water and a sable brush"
              onChange={(e) => set('methodOther', e.target.value)}
            />
          )}

          {/* Counsel, not a refusal: this warns and still lets the entry stand. */}
          {unsafe && chosen && (
            <Notice tone="warn" title={`Not considered safe for ${materialName.toLowerCase()}`}>
              <p style={{ margin: '0 0 var(--space-2)' }}>
                <strong>{chosen.label}</strong> is not listed among the treatments considered safe
                for a {materialName.toLowerCase()} cylinder.
                {material === 'brown_wax' || material === 'black_wax' || material === 'metallic_soap'
                  ? ' Wax is soluble and porous: water raises the surface, alcohol and solvents take it away, and damp invites mould. Dry brushing is normally the whole of what wax should receive.'
                  : ' Check the method against the material before going further.'}
              </p>
              <p style={{ margin: 0 }}>
                If this is already done, record it anyway — an accurate history is worth more than
                a tidy one, and the note will explain the record's condition later.
              </p>
            </Notice>
          )}

          {!unsafe && chosen?.isRisky && (
            <Notice tone="warn" title="A method to take slowly">
              {chosen.label} is regarded as risky even where it is permitted. Keep the plaster core
              dry and stop at the first sign of change to the surface.
            </Notice>
          )}

          {!material || material === 'unknown' ? (
            <Notice title="Material unknown">
              This copy is not matched to a series, so the register cannot check the method against
              the material. Match it to a catalog entry and the safety check works from then on.
            </Notice>
          ) : null}

          <div className="cx-form-grid cx-form-grid-2">
            <TextField
              label="Products used"
              value={form.productsUsed}
              placeholder="Distilled water, sable brush"
              onChange={(e) => set('productsUsed', e.target.value)}
            />
            <TextField
              label="Done by"
              value={form.performedBy}
              placeholder="Yourself, or the conservator"
              onChange={(e) => set('performedBy', e.target.value)}
            />
            <TextField
              label="Minutes taken"
              type="number"
              inputMode="numeric"
              min={0}
              value={form.durationMinutes}
              error={errors.durationMinutes}
              onChange={(e) => set('durationMinutes', e.target.value)}
            />
            <Select
              label="Outcome"
              value={form.outcome}
              onChange={(e) => set('outcome', e.target.value as CleaningOutcome | '')}
            >
              <option value="">Not stated</option>
              {(Object.keys(OUTCOME_LABELS) as CleaningOutcome[]).map((o) => (
                <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>
              ))}
            </Select>
          </div>

          <TextArea
            label="Notes"
            value={form.notes}
            placeholder="Two passes along the grooves; the hiss in the second verse is much reduced."
            onChange={(e) => set('notes', e.target.value)}
          />

          {saveError && <Notice tone="danger" title="That did not save">{saveError}</Notice>}

          <div className="row">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Saving…' : editingId ? 'Save the entry' : 'Add to the log'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => { setOpen(false); setEditingId(null); }}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {cleanings.length === 0 ? (
        <p style={{ color: 'var(--fg-soft)' }}>
          Nothing logged yet. Even “brushed dry, as found” is worth an entry: it is the baseline
          every later treatment is judged against.
        </p>
      ) : (
        <ul className="cx-log">
          {cleanings.map((event) => (
            <li key={event.id}>
              <div className="spread" style={{ alignItems: 'flex-start' }}>
                <div>
                  <div className="cx-log-when">{formatDateTime(event.cleanedAt)}</div>
                  <div className="cx-log-method">
                    {event.method?.label ?? event.methodOther ?? 'Method not stated'}
                    {event.method?.isRisky && <> <Badge tone="warn">Risky</Badge></>}
                    {event.method && isMethodUnsafe(event.method, material) && (
                      <> <Badge tone="danger">Not safe for {materialName.toLowerCase()}</Badge></>
                    )}
                  </div>
                </div>
                <div className="row no-print" style={{ gap: 'var(--space-1)' }}>
                  <Button size="sm" variant="ghost" onClick={() => startEdit(event)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(event)}>Delete</Button>
                </div>
              </div>

              <div className="cx-log-facts">
                <div><span className="label-type">Products</span><br />{event.productsUsed ?? '—'}</div>
                <div><span className="label-type">By</span><br />{event.performedBy ?? '—'}</div>
                <div>
                  <span className="label-type">Took</span><br />
                  {event.durationMinutes === null ? '—' : `${event.durationMinutes} min`}
                </div>
                <div>
                  <span className="label-type">Outcome</span><br />
                  {event.outcome
                    ? <Badge tone={OUTCOME_TONE[event.outcome]}>{OUTCOME_LABELS[event.outcome]}</Badge>
                    : '—'}
                </div>
              </div>

              {event.methodOther && event.method && (
                <p style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-sm)' }}>
                  <span className="label-type">As described</span> {event.methodOther}
                </p>
              )}
              {event.notes && <p style={{ margin: 'var(--space-2) 0 0' }}>{event.notes}</p>}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete this cleaning entry?"
        confirmLabel="Delete the entry"
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={reallyDelete}
      >
        <p style={{ margin: 0 }}>
          {deleting && formatDateTime(deleting.cleanedAt)} ·{' '}
          {deleting?.method?.label ?? deleting?.methodOther ?? 'method not stated'}. Removing it
          leaves the record's history incomplete; this cannot be undone.
        </p>
      </ConfirmDialog>
    </div>
  );
}

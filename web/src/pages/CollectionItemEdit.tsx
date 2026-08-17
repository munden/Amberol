/**
 * Adding a cylinder to the shelf, and editing one already there.
 *
 * The main path is to find the title in the master catalog and let everything
 * — maker, series, material, catalog number — come with it. A cylinder that
 * is not in the master list is still perfectly addable: title, maker and
 * number as written on the record itself, matched up later.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Badge, Button, Checkbox, ErrorState, Notice, Select, Spinner, StarRating,
  TextArea, TextField, useTitle,
} from '../components/ui';
import { ApiError, MATERIAL_LABELS, api, cylinderClass } from '../lib/api';
import type { CatalogSummary, CollectionItem, SurfaceNoise } from '../lib/api';
import { useAsync, useLookups, useUnsavedChanges, confirmDiscard } from '../components/collection/hooks';
import CatalogPicker from '../components/collection/CatalogPicker';
import { DefectDraftEditor, draftsFrom } from '../components/collection/Defects';
import type { DraftDefect } from '../components/collection/Defects';
import '../components/collection/collection.css';

const NOISE_OPTIONS: { value: SurfaceNoise; label: string }[] = [
  { value: 'none', label: 'None to speak of' },
  { value: 'light', label: 'Light' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'heavy', label: 'Heavy' },
  { value: 'severe', label: 'Severe' },
];

interface FormState {
  recordId: number | null;
  record: CatalogSummary | null;
  unmatchedTitle: string;
  unmatchedMaker: string;
  unmatchedNumber: string;
  copyLabel: string;
  conditionGradeId: string;
  boxGradeId: string;
  hasOriginalBox: boolean;
  hasOriginalLid: boolean;
  playbackRating: number | null;
  surfaceNoise: string;
  isPlayable: boolean;
  acquiredOn: string;
  acquiredFrom: string;
  acquiredPrice: string;
  acquiredCurrency: string;
  estimatedValue: string;
  storageLocation: string;
  personalNotes: string;
  conditionNotes: string;
  isFavourite: boolean;
  isForTrade: boolean;
  defects: DraftDefect[];
}

function blank(): FormState {
  return {
    recordId: null,
    record: null,
    unmatchedTitle: '',
    unmatchedMaker: '',
    unmatchedNumber: '',
    copyLabel: '',
    conditionGradeId: '',
    boxGradeId: '',
    hasOriginalBox: false,
    hasOriginalLid: false,
    playbackRating: null,
    surfaceNoise: '',
    isPlayable: true,
    acquiredOn: '',
    acquiredFrom: '',
    acquiredPrice: '',
    acquiredCurrency: 'USD',
    estimatedValue: '',
    storageLocation: '',
    personalNotes: '',
    conditionNotes: '',
    isFavourite: false,
    isForTrade: false,
    defects: [],
  };
}

function formFrom(item: CollectionItem): FormState {
  return {
    recordId: item.record?.id ?? null,
    record: item.record,
    unmatchedTitle: item.unmatchedTitle ?? '',
    unmatchedMaker: item.unmatchedMaker ?? '',
    unmatchedNumber: item.unmatchedNumber ?? '',
    copyLabel: item.copyLabel ?? '',
    conditionGradeId: item.conditionGrade ? String(item.conditionGrade.id) : '',
    boxGradeId: item.boxGrade ? String(item.boxGrade.id) : '',
    hasOriginalBox: item.hasOriginalBox ?? false,
    hasOriginalLid: item.hasOriginalLid ?? false,
    playbackRating: item.playbackRating,
    surfaceNoise: item.surfaceNoise ?? '',
    isPlayable: item.isPlayable,
    acquiredOn: item.acquiredOn ?? '',
    acquiredFrom: item.acquiredFrom ?? '',
    acquiredPrice: item.acquiredPrice === null ? '' : String(item.acquiredPrice),
    acquiredCurrency: item.acquiredCurrency || 'USD',
    estimatedValue: item.estimatedValue === null ? '' : String(item.estimatedValue),
    storageLocation: item.storageLocation ?? '',
    personalNotes: item.personalNotes ?? '',
    conditionNotes: item.conditionNotes ?? '',
    isFavourite: item.isFavourite,
    isForTrade: item.isForTrade,
    defects: draftsFrom(item.defects),
  };
}

export default function CollectionItemEdit() {
  const { id } = useParams();
  const editing = id !== undefined;
  const itemId = Number(id);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const lookups = useLookups();

  useTitle(editing ? 'Edit a copy' : 'Add a cylinder');

  const itemState = useAsync<CollectionItem | null>(
    () => (editing ? api.collection.get(itemId) : Promise.resolve(null)),
    [editing ? itemId : 'new'],
  );

  const [form, setForm] = useState<FormState>(blank);
  const [baseline, setBaseline] = useState<string>('');
  const [picking, setPicking] = useState(!editing || searchParams.get('match') === '1');
  const [manual, setManual] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savedRef = useRef(false);

  // Fill the form once the copy arrives.
  useEffect(() => {
    if (!editing) {
      const fresh = blank();
      setForm(fresh);
      setBaseline(JSON.stringify(fresh));
      return;
    }
    if (itemState.data) {
      const next = formFrom(itemState.data);
      setForm(next);
      setBaseline(JSON.stringify(next));
      setManual(!itemState.data.record);
    }
  }, [editing, itemState.data]);

  const dirty = !savedRef.current && baseline !== '' && JSON.stringify(form) !== baseline;
  useUnsavedChanges(dirty);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const grades = lookups.data?.conditionGrades ?? [];
  const defectTypes = lookups.data?.defectTypes ?? [];

  const identified = form.record !== null || form.recordId !== null;

  const unknownDetails = useMemo(
    () => Object.entries(errors).filter(([key]) => !KNOWN_FIELDS.has(key) && !key.startsWith('defects.')),
    [errors],
  );

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!identified && !form.unmatchedTitle.trim()) {
      next.unmatchedTitle = 'Either pick a catalog title or write the title as it appears on the record.';
    }
    if (form.acquiredPrice && Number.isNaN(Number(form.acquiredPrice))) {
      next.acquiredPrice = 'A number, without a currency sign.';
    }
    if (form.acquiredPrice && Number(form.acquiredPrice) < 0) {
      next.acquiredPrice = 'A price cannot be negative.';
    }
    if (form.estimatedValue && Number.isNaN(Number(form.estimatedValue))) {
      next.estimatedValue = 'A number, without a currency sign.';
    }
    if (form.acquiredOn && Number.isNaN(new Date(form.acquiredOn).getTime())) {
      next.acquiredOn = 'That is not a date.';
    }
    if (form.acquiredOn && new Date(form.acquiredOn).getTime() > Date.now() + 86_400_000) {
      next.acquiredOn = 'That is in the future.';
    }
    form.defects.forEach((defect, index) => {
      if (defect.severity < 1 || defect.severity > 5) {
        next[`defects.${index}.severity`] = 'Severity runs from 1 to 5.';
      }
    });
    setErrors(next);
    if (Object.keys(next).length > 0) {
      // Put the first complaint where it can be seen.
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return false;
    }
    return true;
  }

  function body(): Record<string, unknown> {
    const numeric = (value: string) => (value.trim() === '' ? null : Number(value));
    return {
      recordId: identified ? form.recordId ?? form.record?.id ?? null : null,
      unmatchedTitle: identified ? null : form.unmatchedTitle.trim() || null,
      unmatchedMaker: identified ? null : form.unmatchedMaker.trim() || null,
      unmatchedNumber: identified ? null : form.unmatchedNumber.trim() || null,
      copyLabel: form.copyLabel.trim() || null,
      conditionGradeId: form.conditionGradeId ? Number(form.conditionGradeId) : null,
      boxGradeId: form.boxGradeId ? Number(form.boxGradeId) : null,
      hasOriginalBox: form.hasOriginalBox,
      hasOriginalLid: form.hasOriginalLid,
      playbackRating: form.playbackRating,
      surfaceNoise: form.surfaceNoise || null,
      isPlayable: form.isPlayable,
      acquiredOn: form.acquiredOn || null,
      acquiredFrom: form.acquiredFrom.trim() || null,
      acquiredPrice: numeric(form.acquiredPrice),
      acquiredCurrency: form.acquiredCurrency.trim() || 'USD',
      estimatedValue: numeric(form.estimatedValue),
      storageLocation: form.storageLocation.trim() || null,
      personalNotes: form.personalNotes.trim() || null,
      conditionNotes: form.conditionNotes.trim() || null,
      isFavourite: form.isFavourite,
      isForTrade: form.isForTrade,
    };
  }

  function defectPayload() {
    return form.defects.map((d) => ({
      defectTypeId: d.defectTypeId,
      severity: d.severity,
      location: d.location.trim() || null,
      notes: d.notes.trim() || null,
      isResolved: d.isResolved,
    }));
  }

  async function submit() {
    if (!validate()) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (editing) {
        await api.collection.update(itemId, body());
        await api.collection.setDefects(itemId, defectPayload());
        savedRef.current = true;
        navigate(`/collection/${itemId}`);
      } else {
        const created = await api.collection.create({ ...body(), defects: defectPayload() });
        savedRef.current = true;
        navigate(`/collection/${created.id}`);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && error.details) {
        setErrors(error.details);
        setSaveError(error.message);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        setSaveError(error instanceof Error ? error.message : 'That did not save.');
      }
    } finally {
      setSaving(false);
    }
  }

  function leave() {
    if (dirty && !confirmDiscard()) return;
    savedRef.current = true;
    navigate(editing ? `/collection/${itemId}` : '/collection');
  }

  if (editing && itemState.loading && !itemState.data) {
    return <div className="page"><Spinner label="Fetching the copy" /></div>;
  }
  if (editing && itemState.error != null) {
    return (
      <div className="page">
        <ErrorState error={itemState.error} onRetry={itemState.reload} />
        <p style={{ marginTop: 'var(--space-4)' }}><Link to="/collection">Back to the shelf</Link></p>
      </div>
    );
  }

  return (
    <div className="page">
      <p className="no-print">
        <Link to={editing ? `/collection/${itemId}` : '/collection'}>‹ Back</Link>
      </p>

      <header className="cx-head">
        <div>
          <p className="eyebrow">My Amberola</p>
          <h1>{editing ? 'Edit this copy' : 'Add a cylinder'}</h1>
        </div>
      </header>

      {saveError && (
        <Notice tone="danger" title="That did not save">
          <p style={{ margin: unknownDetails.length ? '0 0 var(--space-2)' : 0 }}>{saveError}</p>
          {unknownDetails.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
              {unknownDetails.map(([key, message]) => <li key={key}><strong>{key}</strong>: {message}</li>)}
            </ul>
          )}
        </Notice>
      )}

      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="stack">
        {/* ---------------------------------------------------------- identity */}
        <section className="plate stack">
          <h2 style={{ marginTop: 0 }}>Which cylinder is this?</h2>

          {form.record ? (
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <span className="cx-thumb" style={{ width: 92, height: 56 }}>
                {form.record.primaryImageUrl
                  ? <img src={form.record.primaryImageUrl} alt="" />
                  : (
                    <span
                      className={`cylinder ${cylinderClass(form.record.series.material, form.record.series.colour)}`}
                      style={{ display: 'block', width: '100%', height: '100%' }}
                    />
                  )}
              </span>
              <div style={{ flex: '1 1 14rem' }}>
                <strong style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--text-xl)' }}>
                  {form.record.title}
                </strong>
                <div className="cx-meta">
                  <span className="stamp-type">{form.record.catalogNumber}</span>
                  <span>{form.record.series.name}</span>
                  <span>{MATERIAL_LABELS[form.record.series.material]}</span>
                  {form.record.performers && <span>{form.record.performers}</span>}
                </div>
                <p className="field-hint" style={{ marginTop: 'var(--space-1)' }}>
                  Material comes from the series, and with it the cleaning-safety check.
                </p>
              </div>
              <Button
                variant="ghost"
                onClick={() => {
                  setForm((f) => ({ ...f, record: null, recordId: null }));
                  setPicking(true);
                }}
              >
                Choose a different title
              </Button>
            </div>
          ) : (
            <>
              {picking && !manual && (
                <CatalogPicker
                  autoFocus={!editing}
                  onPick={(record) => {
                    setForm((f) => ({
                      ...f,
                      record,
                      recordId: record.id,
                      unmatchedTitle: '',
                      unmatchedMaker: '',
                      unmatchedNumber: '',
                    }));
                    setPicking(false);
                    setErrors((e) => ({ ...e, unmatchedTitle: '' }));
                  }}
                />
              )}

              <div className="row">
                <Button
                  variant={manual ? 'ghost' : 'primary'}
                  onClick={() => { setManual(false); setPicking(true); }}
                >
                  Search the catalog
                </Button>
                <Button
                  variant={manual ? 'primary' : 'ghost'}
                  onClick={() => { setManual(true); setPicking(false); }}
                >
                  It is not in the master list
                </Button>
              </div>

              {manual && (
                <div className="stack">
                  <Notice title="An unidentified copy">
                    Record what is printed on the cylinder and its box. It can be matched to a
                    catalog entry at any time, and the shelf will show it as unidentified until
                    then.
                  </Notice>
                  <div className="cx-form-grid cx-form-grid-3">
                    <TextField
                      label="Title as written"
                      required
                      value={form.unmatchedTitle}
                      error={errors.unmatchedTitle}
                      onChange={(e) => set('unmatchedTitle', e.target.value)}
                    />
                    <TextField
                      label="Maker as written"
                      value={form.unmatchedMaker}
                      error={errors.unmatchedMaker}
                      placeholder="Edison, Columbia…"
                      onChange={(e) => set('unmatchedMaker', e.target.value)}
                    />
                    <TextField
                      label="Number as written"
                      value={form.unmatchedNumber}
                      error={errors.unmatchedNumber}
                      className="stamp-type"
                      onChange={(e) => set('unmatchedNumber', e.target.value)}
                    />
                  </div>
                </div>
              )}
            </>
          )}

          <TextField
            label="Copy label"
            value={form.copyLabel}
            hint="Only needed when you hold more than one copy of the same title — “box 2, better surface”."
            onChange={(e) => set('copyLabel', e.target.value)}
          />
        </section>

        {/* --------------------------------------------------------- condition */}
        <section className="plate stack">
          <h2 style={{ marginTop: 0 }}>Condition</h2>

          <div className="cx-form-grid cx-form-grid-2">
            <Select
              label="Condition grade"
              value={form.conditionGradeId}
              error={errors.conditionGradeId}
              onChange={(e) => set('conditionGradeId', e.target.value)}
              hint={grades.find((g) => String(g.id) === form.conditionGradeId)?.description ?? 'How the cylinder itself grades.'}
            >
              <option value="">Not yet graded</option>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>{g.code} — {g.label}</option>
              ))}
            </Select>
            <Select
              label="Box grade"
              value={form.boxGradeId}
              error={errors.boxGradeId}
              onChange={(e) => set('boxGradeId', e.target.value)}
              hint="The carton, graded separately."
            >
              <option value="">Not graded</option>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>{g.code} — {g.label}</option>
              ))}
            </Select>
          </div>

          <div className="cx-form-grid cx-form-grid-2">
            <div>
              <span className="field-label" id="rating-label">Playback rating</span>
              <div className="row" aria-labelledby="rating-label">
                <StarRating value={form.playbackRating} onChange={(v) => set('playbackRating', v)} />
                {form.playbackRating !== null && (
                  <Button size="sm" variant="ghost" onClick={() => set('playbackRating', null)}>
                    Clear
                  </Button>
                )}
              </div>
            </div>
            <Select
              label="Surface noise"
              value={form.surfaceNoise}
              error={errors.surfaceNoise}
              onChange={(e) => set('surfaceNoise', e.target.value)}
            >
              <option value="">Not stated</option>
              {NOISE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </div>

          <div className="cx-form-grid cx-form-grid-3">
            <Checkbox label="Plays" checked={form.isPlayable} onChange={(v) => set('isPlayable', v)} />
            <Checkbox label="Has its original box" checked={form.hasOriginalBox} onChange={(v) => set('hasOriginalBox', v)} />
            <Checkbox label="Has its original lid" checked={form.hasOriginalLid} onChange={(v) => set('hasOriginalLid', v)} />
          </div>

          <TextArea
            label="Condition notes"
            value={form.conditionNotes}
            error={errors.conditionNotes}
            placeholder="Bright surface throughout; a shallow scuff across the first quarter that is not heard."
            onChange={(e) => set('conditionNotes', e.target.value)}
          />
        </section>

        {/* ----------------------------------------------------------- defects */}
        <section className="plate stack">
          <h2 style={{ marginTop: 0 }}>
            Faults{' '}
            {form.defects.some((d) => defectTypes.find((t) => t.id === d.defectTypeId)?.isTerminal) && (
              <Badge tone="danger">Terminal fault recorded</Badge>
            )}
          </h2>
          {lookups.loading && <Spinner label="Fetching the fault list" />}
          <DefectDraftEditor
            types={defectTypes}
            value={form.defects}
            errors={errors}
            onChange={(next) => set('defects', next)}
          />
        </section>

        {/* ------------------------------------------------------- acquisition */}
        <section className="plate stack">
          <h2 style={{ marginTop: 0 }}>Acquisition and storage</h2>

          <div className="cx-form-grid cx-form-grid-2">
            <TextField
              label="Acquired on"
              type="date"
              value={form.acquiredOn}
              error={errors.acquiredOn}
              onChange={(e) => set('acquiredOn', e.target.value)}
            />
            <TextField
              label="Acquired from"
              value={form.acquiredFrom}
              error={errors.acquiredFrom}
              placeholder="Estate sale, Lancaster PA"
              onChange={(e) => set('acquiredFrom', e.target.value)}
            />
            <TextField
              label="Price paid"
              inputMode="decimal"
              value={form.acquiredPrice}
              error={errors.acquiredPrice}
              onChange={(e) => set('acquiredPrice', e.target.value)}
            />
            <TextField
              label="Currency"
              value={form.acquiredCurrency}
              error={errors.acquiredCurrency}
              maxLength={3}
              onChange={(e) => set('acquiredCurrency', e.target.value.toUpperCase())}
            />
            <TextField
              label="Estimated value"
              inputMode="decimal"
              value={form.estimatedValue}
              error={errors.estimatedValue}
              hint="What you would expect it to fetch today."
              onChange={(e) => set('estimatedValue', e.target.value)}
            />
            <TextField
              label="Storage location"
              value={form.storageLocation}
              error={errors.storageLocation}
              placeholder="Cabinet 2, drawer B"
              onChange={(e) => set('storageLocation', e.target.value)}
            />
          </div>

          <TextArea
            label="My notes"
            value={form.personalNotes}
            error={errors.personalNotes}
            placeholder="Bought with four others from the same house; the box has a Wanamaker's price in pencil."
            onChange={(e) => set('personalNotes', e.target.value)}
          />

          <div className="row">
            <Checkbox label="★ Favourite" checked={form.isFavourite} onChange={(v) => set('isFavourite', v)} />
            <Checkbox label="Offered for trade" checked={form.isForTrade} onChange={(v) => set('isForTrade', v)} />
          </div>
        </section>

        <div className="cx-sticky-actions no-print">
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save this copy' : 'Add to the shelf'}
          </Button>
          <Button type="button" variant="ghost" onClick={leave}>Cancel</Button>
          {dirty && <span className="label-type" style={{ alignSelf: 'center' }}>Unsaved changes</span>}
        </div>
      </form>

      {!editing && (
        <p style={{ marginTop: 'var(--space-5)', color: 'var(--fg-soft)' }}>
          Photographs are added once the copy exists — the next screen has the camera on it.
        </p>
      )}
    </div>
  );
}

const KNOWN_FIELDS = new Set([
  'recordId', 'unmatchedTitle', 'unmatchedMaker', 'unmatchedNumber', 'copyLabel',
  'conditionGradeId', 'boxGradeId', 'playbackRating', 'surfaceNoise', 'isPlayable',
  'acquiredOn', 'acquiredFrom', 'acquiredPrice', 'acquiredCurrency', 'estimatedValue',
  'storageLocation', 'personalNotes', 'conditionNotes', 'isFavourite', 'isForTrade',
  'hasOriginalBox', 'hasOriginalLid',
]);

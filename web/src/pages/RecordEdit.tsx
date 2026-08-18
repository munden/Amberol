/**
 * RecordEdit — create or correct an entry in the master list.
 *
 * One component serves /catalog/new and /catalog/:slug/edit. It is written as
 * a wiki edit form: every field of the contract, grouped the way a cataloguer
 * thinks about them, credits and links edited in place, and an edit summary
 * that goes into the record's history.
 *
 * Leaving with unsaved work is guarded, validation runs before the request,
 * and the server's per-field 422 details are shown against the fields they
 * belong to rather than as a wall of raw error.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Button, ButtonLink, Checkbox, ErrorState, Notice, Select, Spinner, TextArea, TextField,
  useTitle,
} from '../components/ui';
import { PrecisionDate } from '../components/catalog/PrecisionDate';
import { LINK_KIND_LABELS, LINK_KIND_ORDER, ROLE_ORDER, ROLE_SINGULAR } from '../components/catalog/parts';
import {
  ApiError, api,
  type CatalogRecord, type Confidence, type CreditRole, type DatePrecision,
  type Image, type LinkKind, type Lookups, type Person,
} from '../lib/api';

// ------------------------------------------------------------------- drafts

interface CreditDraft {
  key: string;
  personId: number | null;
  personName: string;
  role: CreditRole;
  detail: string;
}

interface LinkDraft {
  key: string;
  kind: LinkKind;
  label: string;
  url: string;
  sourceName: string;
}

interface FormState {
  seriesId: string;
  catalogNumber: string;
  matrixNumber: string;
  take: string;
  title: string;
  subtitle: string;
  workType: string;
  genre: string;
  language: string;
  creditLine: string;
  recordedOn: string;
  recordedPrecision: DatePrecision;
  recordedPlace: string;
  releasedOn: string;
  releasedPrecision: DatePrecision;
  releaseSupplement: string;
  withdrawnOn: string;
  durationSeconds: string;
  description: string;
  notes: string;
  lyrics: string;
  trivia: string;
  provenance: string;
  confidence: Confidence;
  isStub: boolean;
  originalIssueId: string;
  credits: CreditDraft[];
  links: LinkDraft[];
}

const newKey = () => Math.random().toString(36).slice(2, 10);

const EMPTY: FormState = {
  seriesId: '', catalogNumber: '', matrixNumber: '', take: '',
  title: '', subtitle: '', workType: '', genre: '', language: '',
  creditLine: '',
  recordedOn: '', recordedPrecision: 'day', recordedPlace: '',
  releasedOn: '', releasedPrecision: 'month', releaseSupplement: '',
  withdrawnOn: '', durationSeconds: '',
  description: '', notes: '', lyrics: '', trivia: '', provenance: '',
  confidence: 'verified', isStub: false, originalIssueId: '',
  credits: [], links: [],
};

function fromRecord(record: CatalogRecord): FormState {
  return {
    seriesId: String(record.series?.id ?? ''),
    catalogNumber: record.catalogNumber ?? '',
    matrixNumber: record.matrixNumber ?? '',
    take: record.take ?? '',
    title: record.title ?? '',
    subtitle: record.subtitle ?? '',
    workType: record.workType ?? '',
    genre: record.genre ?? '',
    language: record.language ?? '',
    creditLine: record.creditLine ?? '',
    recordedOn: record.recordedOn ?? '',
    recordedPrecision: record.recordedPrecision ?? 'day',
    recordedPlace: record.recordedPlace ?? '',
    releasedOn: record.releasedOn ?? '',
    releasedPrecision: record.releasedPrecision ?? 'month',
    releaseSupplement: record.releaseSupplement ?? '',
    withdrawnOn: record.withdrawnOn ?? '',
    durationSeconds: record.durationSeconds != null ? String(record.durationSeconds) : '',
    description: record.description ?? '',
    notes: record.notes ?? '',
    lyrics: record.lyrics ?? '',
    trivia: record.trivia ?? '',
    provenance: record.provenance ?? '',
    confidence: record.confidence ?? 'verified',
    isStub: !!record.isStub,
    originalIssueId: record.originalIssue ? String(record.originalIssue.id) : '',
    credits: (record.credits ?? []).map((credit) => ({
      key: newKey(),
      personId: credit.person?.id ?? null,
      personName: credit.person?.name ?? '',
      role: credit.role,
      detail: credit.detail ?? '',
    })),
    links: (record.links ?? []).map((link) => ({
      key: newKey(),
      kind: link.kind,
      label: link.label ?? '',
      url: link.url ?? '',
      sourceName: link.sourceName ?? '',
    })),
  };
}

const blank = (value: string) => (value.trim() === '' ? null : value.trim());

// --------------------------------------------------------------- the screen

export default function RecordEdit() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isNew = !slug;

  useTitle(isNew ? 'New catalog entry' : `Editing ${slug}`);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [baseline, setBaseline] = useState<string>(JSON.stringify(EMPTY));
  const [record, setRecord] = useState<CatalogRecord | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [editSummary, setEditSummary] = useState('');
  const [editor, setEditor] = useState('collector');
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const savedRef = useRef(false);

  // ------------------------------------------------------------- loading
  useEffect(() => {
    let cancelled = false;
    api.lookups().then((data) => { if (!cancelled) setLookups(data); }).catch(() => {});
    api.people.list({ pageSize: 200, sort: 'records' })
      .then((result) => { if (!cancelled) setPeople(result.data ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (isNew) {
      // A new entry can be pre-seeded from the URL, e.g. from a series page.
      const seeded: FormState = {
        ...EMPTY,
        seriesId: searchParams.get('seriesId') ?? '',
        title: searchParams.get('title') ?? '',
        catalogNumber: searchParams.get('catalogNumber') ?? '',
      };
      setForm(seeded);
      setBaseline(JSON.stringify(seeded));
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.catalog.get(slug)
      .then((data) => {
        if (cancelled) return;
        setRecord(data);
        const next = fromRecord(data);
        setForm(next);
        setBaseline(JSON.stringify(next));
      })
      .catch((err) => { if (!cancelled) setLoadError(err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, isNew]);

  const dirty = JSON.stringify(form) !== baseline || editSummary.trim() !== '';

  // ------------------------------------------------- unsaved-work guard
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    // React Router's BrowserRouter cannot block a transition, so in-app links
    // are intercepted before they navigate.
    const onClick = (event: MouseEvent) => {
      if (savedRef.current || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== '_self') return;
      const href = anchor.getAttribute('href') ?? '';
      if (!href.startsWith('/')) return;
      if (!window.confirm('This entry has unsaved changes. Leave without saving?')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  /** The API keys its 422 details as `links[0].url`; accept the dotted form too. */
  const rowError = (collection: 'credits' | 'links', index: number, field: string) =>
    fieldErrors[`${collection}[${index}].${field}`] ?? fieldErrors[`${collection}.${index}.${field}`];

  // ------------------------------------------------------------- credits
  const addCredit = () => setForm((prev) => ({
    ...prev,
    credits: [...prev.credits,
      { key: newKey(), personId: null, personName: '', role: 'performer', detail: '' }],
  }));

  const updateCredit = (key: string, patch: Partial<CreditDraft>) => setForm((prev) => ({
    ...prev,
    credits: prev.credits.map((c) => (c.key === key ? { ...c, ...patch } : c)),
  }));

  const removeCredit = (key: string) => setForm((prev) => ({
    ...prev, credits: prev.credits.filter((c) => c.key !== key),
  }));

  const moveCredit = (key: string, delta: number) => setForm((prev) => {
    const index = prev.credits.findIndex((c) => c.key === key);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= prev.credits.length) return prev;
    const credits = prev.credits.slice();
    const [moved] = credits.splice(index, 1);
    credits.splice(target, 0, moved);
    return { ...prev, credits };
  });

  /**
   * The API credits people by id, so a name it has never seen has to become a
   * person page first. This does that in one click and links the credit to it.
   */
  const [creatingPerson, setCreatingPerson] = useState<string | null>(null);
  const createPerson = async (key: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreatingPerson(key);
    try {
      const person = await api.people.create({ name: trimmed });
      setPeople((prev) => [...prev, person]);
      updateCredit(key, { personId: person.id, personName: person.name });
      setFieldErrors((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) if (k.startsWith('credits')) delete next[k];
        return next;
      });
    } catch (err) {
      setSaveError(err);
    } finally {
      setCreatingPerson(null);
    }
  };

  // --------------------------------------------------------------- links
  const addLink = () => setForm((prev) => ({
    ...prev,
    links: [...prev.links,
      { key: newKey(), kind: 'audio', label: '', url: '', sourceName: '' }],
  }));

  const updateLink = (key: string, patch: Partial<LinkDraft>) => setForm((prev) => ({
    ...prev,
    links: prev.links.map((l) => (l.key === key ? { ...l, ...patch } : l)),
  }));

  const removeLink = (key: string) => setForm((prev) => ({
    ...prev, links: prev.links.filter((l) => l.key !== key),
  }));

  const moveLink = (key: string, delta: number) => setForm((prev) => {
    const index = prev.links.findIndex((l) => l.key === key);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= prev.links.length) return prev;
    const links = prev.links.slice();
    const [moved] = links.splice(index, 1);
    links.splice(target, 0, moved);
    return { ...prev, links };
  });

  // -------------------------------------------------------------- pictures
  // Catalog imagery belongs to the shared record, not to anyone's copy, so it
  // is uploaded here. Only an existing record can carry images; a new entry
  // gets the panel once it has been created.
  const [images, setImages] = useState<Image[]>([]);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState<unknown>(null);

  useEffect(() => { setImages(record?.images ?? []); }, [record]);

  const uploadImages = async (files: FileList | null) => {
    if (!files?.length || !slug) return;
    setImageBusy(true);
    setImageError(null);
    try {
      const form = new FormData();
      for (const file of Array.from(files)) form.append('files', file);
      const created = await api.catalog.uploadImages(slug, form);
      setImages((prev) => {
        const known = new Set(prev.map((image) => image.id));
        return [...prev, ...created.filter((image) => !known.has(image.id))];
      });
    } catch (err) {
      setImageError(err);
    } finally {
      setImageBusy(false);
    }
  };

  const removeImage = async (id: number) => {
    if (!window.confirm('Remove this picture from the record?')) return;
    setImageError(null);
    try {
      await api.images.remove(id);
      setImages((prev) => prev.filter((image) => image.id !== id));
    } catch (err) {
      setImageError(err);
    }
  };

  const makePrimary = async (id: number) => {
    setImageError(null);
    try {
      await api.images.update(id, { isPrimary: true });
      setImages((prev) => prev.map((image) => ({ ...image, isPrimary: image.id === id })));
    } catch (err) {
      setImageError(err);
    }
  };

  // ------------------------------------------------------------ validate
  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (!form.title.trim()) errors.title = 'A title is required.';
    if (!form.catalogNumber.trim()) errors.catalogNumber = 'A catalog number is required.';
    if (!form.seriesId) errors.seriesId = 'Choose the series this cylinder was issued in.';
    if (form.durationSeconds && !/^\d{1,5}$/.test(form.durationSeconds.trim())) {
      errors.durationSeconds = 'Give the playing time as a whole number of seconds.';
    }
    form.credits.forEach((credit, index) => {
      // The register credits people, not loose names: a credit has to point at
      // a person page, so an unmatched name must be created first.
      if (credit.personId === null) {
        errors[`credits[${index}].person`] = credit.personName.trim()
          ? 'No one of that name is in the register yet — add them first, or remove this credit.'
          : 'Choose the person credited, or remove this credit.';
      }
    });
    form.links.forEach((link, index) => {
      if (!link.url.trim() && !link.label.trim()) return;
      if (!/^https?:\/\/\S+$/i.test(link.url.trim())) {
        errors[`links[${index}].url`] = 'A link needs a full http:// or https:// address.';
      }
      if (!link.label.trim()) {
        errors[`links[${index}].label`] = 'Give the link a label, so the page can name it.';
      }
    });
    return errors;
  };

  // -------------------------------------------------------------- submit
  const payload = useMemo(() => {
    const body: Record<string, unknown> = {
      seriesId: form.seriesId ? Number(form.seriesId) : undefined,
      catalogNumber: form.catalogNumber.trim(),
      matrixNumber: blank(form.matrixNumber),
      take: blank(form.take),
      title: form.title.trim(),
      subtitle: blank(form.subtitle),
      workType: blank(form.workType),
      genre: blank(form.genre),
      language: blank(form.language),
      creditLine: blank(form.creditLine),
      recordedOn: blank(form.recordedOn),
      recordedPrecision: form.recordedOn ? form.recordedPrecision : null,
      recordedPlace: blank(form.recordedPlace),
      releasedOn: blank(form.releasedOn),
      releasedPrecision: form.releasedOn ? form.releasedPrecision : null,
      releaseSupplement: blank(form.releaseSupplement),
      withdrawnOn: blank(form.withdrawnOn),
      durationSeconds: form.durationSeconds ? Number(form.durationSeconds) : null,
      description: blank(form.description),
      notes: blank(form.notes),
      lyrics: blank(form.lyrics),
      trivia: blank(form.trivia),
      provenance: blank(form.provenance),
      confidence: form.confidence,
      isStub: form.isStub,
      originalIssueId: form.originalIssueId ? Number(form.originalIssueId) : null,
      credits: form.credits
        .filter((credit) => credit.personId !== null)
        .map((credit, index) => ({
          personId: credit.personId,
          role: credit.role,
          detail: blank(credit.detail),
          billingOrder: index + 1,
        })),
      links: form.links
        .filter((link) => link.url.trim())
        .map((link, index) => ({
          kind: link.kind,
          label: link.label.trim(),
          url: link.url.trim(),
          sourceName: blank(link.sourceName),
          sortOrder: index + 1,
        })),
    };
    return body;
  }, [form]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const errors = validate();
    setFieldErrors(errors);
    setSaveError(null);
    if (Object.keys(errors).length > 0) {
      const first = document.querySelector('[aria-invalid="true"]');
      if (first instanceof HTMLElement) first.focus();
      return;
    }
    setSaving(true);
    try {
      const body = {
        ...payload,
        editSummary: blank(editSummary),
        editor: blank(editor) ?? 'collector',
      };
      const saved = isNew
        ? await api.catalog.create(body as Record<string, unknown>)
        : await api.catalog.update(slug as string, body);
      savedRef.current = true;
      setBaseline(JSON.stringify(form));
      navigate(`/catalog/${saved.slug}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && err.details) {
        setFieldErrors(err.details);
      }
      setSaveError(err);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  };

  // -------------------------------------------------------------- delete
  const [deleteError, setDeleteError] = useState<ApiError | null>(null);
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    if (!slug) return;
    if (!window.confirm(
      `Delete “${form.title}” from the master list? The history of the entry is kept.`,
    )) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.catalog.remove(slug);
      savedRef.current = true;
      navigate('/catalog', { replace: true });
    } catch (err) {
      setDeleteError(err instanceof ApiError
        ? err
        : new ApiError(0, 'unknown', 'The record could not be deleted.'));
    } finally {
      setDeleting(false);
    }
  };

  // ------------------------------------------------------------- render
  if (loading) return <div className="page"><Spinner label="Fetching the entry" /></div>;

  if (loadError) {
    return (
      <div className="page">
        <ErrorState error={loadError} onRetry={() => navigate(0)} />
        <p style={{ marginTop: 'var(--space-4)' }}>
          <Link to="/catalog">Back to the master list</Link>
        </p>
      </div>
    );
  }

  const seriesOptions = lookups?.series ?? [];
  const makerNames = new Map((lookups?.makers ?? []).map((m) => [m.slug, m.name]));
  const grouped = new Map<string, typeof seriesOptions>();
  for (const item of seriesOptions) {
    const list = grouped.get(item.makerSlug) ?? [];
    list.push(item);
    grouped.set(item.makerSlug, list);
  }

  const unmappedErrors = Object.entries(fieldErrors).filter(([key]) => (
    !['title', 'catalogNumber', 'seriesId', 'durationSeconds', 'matrixNumber', 'take',
      'subtitle', 'workType', 'genre', 'language', 'creditLine', 'recordedOn', 'recordedPlace',
      'releasedOn', 'releaseSupplement', 'withdrawnOn', 'description', 'notes', 'lyrics',
      'trivia', 'provenance', 'confidence', 'originalIssueId'].includes(key)
    && !key.startsWith('credits') && !key.startsWith('links')
  ));

  return (
    <form className="page" onSubmit={submit} noValidate>
      <header style={{ marginBottom: 'var(--space-5)' }}>
        <div className="eyebrow">{isNew ? 'New entry' : 'Correcting an entry'}</div>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', letterSpacing: '0.05em' }}>
          {isNew ? 'Catalogue a cylinder' : form.title || 'Untitled record'}
        </h1>
        {!isNew && record && (
          <p style={{ color: 'var(--fg-soft)' }}>
            <Link to={`/catalog/${record.slug}`}>View the page</Link>
            {' · '}
            <span className="stamp-type">{record.catalogNumber}</span>
            {' · '}
            {record.revisionCount} recorded edit{record.revisionCount === 1 ? '' : 's'}
          </p>
        )}
      </header>

      {saveError ? (
        <div style={{ marginBottom: 'var(--space-5)' }}>
          <Notice tone="danger" title="The entry was not saved">
            {saveError instanceof Error ? saveError.message : 'Something went wrong.'}
            {unmappedErrors.length > 0 && (
              <ul style={{ margin: 'var(--space-2) 0 0', paddingLeft: '1.2em' }}>
                {unmappedErrors.map(([key, message]) => (
                  <li key={key}><strong>{key}</strong>: {message}</li>
                ))}
              </ul>
            )}
          </Notice>
        </div>
      ) : null}

      {deleteError && (
        <div style={{ marginBottom: 'var(--space-5)' }}>
          <Notice
            tone={deleteError.status === 409 ? 'warn' : 'danger'}
            title={deleteError.status === 409
              ? 'Kept, because you own a copy'
              : 'The entry could not be deleted'}
          >
            {deleteError.message}
            {deleteError.details && (
              <ul style={{ margin: 'var(--space-2) 0 0', paddingLeft: '1.2em' }}>
                {Object.entries(deleteError.details).map(([key, value]) => (
                  <li key={key}>
                    {Array.isArray(value) ? value.join(', ') : String(value)}
                  </li>
                ))}
              </ul>
            )}
            {deleteError.status === 409 && (
              <p style={{ margin: 'var(--space-2) 0 0' }}>
                Collection data is never destroyed by a catalog edit. Remove or
                re-point the copies on <Link to="/collection">your shelf</Link> first.
              </p>
            )}
          </Notice>
        </div>
      )}

      <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
        {/* ------------------------------------------------- identification */}
        <fieldset className="plate" style={{ border: '1px solid var(--rule)' }}>
          <legend className="label-type" style={{ padding: '0 var(--space-2)' }}>
            Identification
          </legend>
          <div style={{ display: 'grid', gap: 'var(--space-4)',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' }}>
            <Select
              label="Series" required value={form.seriesId}
              error={fieldErrors.seriesId}
              onChange={(e) => set('seriesId', e.target.value)}
              hint={seriesOptions.length ? undefined : 'No series are loaded — is the API running?'}
            >
              <option value="">Choose a series…</option>
              {[...grouped.entries()].map(([makerSlug, items]) => (
                <optgroup key={makerSlug} label={makerNames.get(makerSlug) ?? makerSlug}>
                  {items.map((item) => (
                    <option key={item.id} value={String(item.id)}>{item.name}</option>
                  ))}
                </optgroup>
              ))}
            </Select>
            <TextField
              label="Catalog number" required value={form.catalogNumber}
              error={fieldErrors.catalogNumber}
              hint="As printed, e.g. 2848 or B-1234."
              onChange={(e) => set('catalogNumber', e.target.value)}
            />
            <TextField
              label="Matrix number" value={form.matrixNumber}
              error={fieldErrors.matrixNumber}
              onChange={(e) => set('matrixNumber', e.target.value)}
            />
            <TextField
              label="Take" value={form.take} error={fieldErrors.take}
              onChange={(e) => set('take', e.target.value)}
            />
          </div>
        </fieldset>

        {/* --------------------------------------------------------- titles */}
        <fieldset className="plate" style={{ border: '1px solid var(--rule)' }}>
          <legend className="label-type" style={{ padding: '0 var(--space-2)' }}>
            The title as printed
          </legend>
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <TextField
              label="Title" required value={form.title} error={fieldErrors.title}
              onChange={(e) => set('title', e.target.value)}
            />
            <TextField
              label="Subtitle" value={form.subtitle} error={fieldErrors.subtitle}
              hint="A parenthetical second title, where the label carries one."
              onChange={(e) => set('subtitle', e.target.value)}
            />
            <TextField
              label="Credit line" value={form.creditLine} error={fieldErrors.creditLine}
              hint="The wording on the cylinder itself, e.g. “Tenor solo with orchestra”."
              onChange={(e) => set('creditLine', e.target.value)}
            />
            <div style={{ display: 'grid', gap: 'var(--space-4)',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))' }}>
              <TextField
                label="Genre" value={form.genre} error={fieldErrors.genre}
                list="genre-options"
                onChange={(e) => set('genre', e.target.value)}
              />
              <datalist id="genre-options">
                {(lookups?.genres ?? []).map((g) => <option key={g} value={g} />)}
              </datalist>
              <TextField
                label="Type of work" value={form.workType} error={fieldErrors.workType}
                hint="Fox trot, march, descriptive specialty…"
                onChange={(e) => set('workType', e.target.value)}
              />
              <TextField
                label="Language" value={form.language} error={fieldErrors.language}
                onChange={(e) => set('language', e.target.value)}
              />
              <TextField
                label="Playing time (seconds)" value={form.durationSeconds}
                inputMode="numeric" error={fieldErrors.durationSeconds}
                onChange={(e) => set('durationSeconds', e.target.value)}
              />
            </div>
          </div>
        </fieldset>

        {/* ---------------------------------------------------------- dates */}
        <fieldset className="plate" style={{ border: '1px solid var(--rule)' }}>
          <legend className="label-type" style={{ padding: '0 var(--space-2)' }}>
            Dates
          </legend>
          <p style={{ color: 'var(--fg-soft)', marginTop: 0 }}>
            Record only what is actually known. A date marked “year only” is shown
            as <span className="stamp-type">1916</span>, never as a day that was
            never printed anywhere.
          </p>
          <div style={{ display: 'grid', gap: 'var(--space-4)',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))' }}>
            <PrecisionDate
              label="Recorded"
              value={form.recordedOn}
              precision={form.recordedPrecision}
              error={fieldErrors.recordedOn}
              onChange={(value, precision) => setForm((prev) => ({
                ...prev, recordedOn: value, recordedPrecision: precision,
              }))}
            />
            <TextField
              label="Recording place" value={form.recordedPlace}
              error={fieldErrors.recordedPlace}
              onChange={(e) => set('recordedPlace', e.target.value)}
            />
            <PrecisionDate
              label="Released"
              value={form.releasedOn}
              precision={form.releasedPrecision}
              error={fieldErrors.releasedOn}
              onChange={(value, precision) => setForm((prev) => ({
                ...prev, releasedOn: value, releasedPrecision: precision,
              }))}
            />
            <TextField
              label="Supplement" value={form.releaseSupplement}
              error={fieldErrors.releaseSupplement}
              hint="The monthly supplement it was announced in, e.g. “March 1916”."
              onChange={(e) => set('releaseSupplement', e.target.value)}
            />
            <TextField
              label="Withdrawn" type="date" value={form.withdrawnOn}
              error={fieldErrors.withdrawnOn}
              onChange={(e) => set('withdrawnOn', e.target.value)}
            />
          </div>
        </fieldset>

        {/* -------------------------------------------------------- credits */}
        <fieldset className="plate" style={{ border: '1px solid var(--rule)' }}>
          <legend className="label-type" style={{ padding: '0 var(--space-2)' }}>
            Credits
          </legend>
          <p style={{ color: 'var(--fg-soft)', marginTop: 0 }}>
            Who performed, composed and arranged it. Each credit links to that
            person's page; a name the register has never seen can be added from
            here in one click. Order is the billing order shown on the page.
          </p>
          <datalist id="person-options">
            {people.map((person) => <option key={person.id} value={person.name} />)}
          </datalist>

          {form.credits.length === 0 && (
            <p style={{ color: 'var(--fg-faint)' }}>No credits recorded yet.</p>
          )}

          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            {form.credits.map((credit, index) => (
              <div
                key={credit.key}
                style={{
                  display: 'grid', gap: 'var(--space-3)',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))',
                  borderTop: '1px solid var(--rule)', paddingTop: 'var(--space-3)',
                }}
              >
                <div>
                  <TextField
                    label={`Person ${index + 1}`}
                    value={credit.personName}
                    list="person-options"
                    error={rowError('credits', index, 'person')
                      ?? rowError('credits', index, 'personId')}
                    hint={credit.personId !== null
                      ? 'Linked to their page in the register.'
                      : credit.personName.trim()
                        ? 'Not in the register yet.'
                        : 'Start typing; the register suggests names and pseudonyms.'}
                    onChange={(e) => {
                      const name = e.target.value;
                      const match = people.find(
                        (p) => p.name.toLowerCase() === name.trim().toLowerCase(),
                      );
                      updateCredit(credit.key, {
                        personName: name,
                        personId: match ? match.id : null,
                      });
                    }}
                  />
                  {credit.personId === null && credit.personName.trim() && (
                    <Button
                      type="button" size="sm" variant="ghost"
                      disabled={creatingPerson === credit.key}
                      onClick={() => createPerson(credit.key, credit.personName)}
                      style={{ marginTop: 'var(--space-1)' }}
                    >
                      {creatingPerson === credit.key
                        ? 'Adding…'
                        : `Add “${credit.personName.trim()}” to the register`}
                    </Button>
                  )}
                </div>
                <Select
                  label="Role"
                  value={credit.role}
                  onChange={(e) => updateCredit(credit.key,
                    { role: e.target.value as CreditRole })}
                >
                  {ROLE_ORDER.map((role) => (
                    <option key={role} value={role}>{ROLE_SINGULAR[role]}</option>
                  ))}
                </Select>
                <TextField
                  label="Detail"
                  value={credit.detail}
                  hint="tenor, cornet solo, with orchestra…"
                  onChange={(e) => updateCredit(credit.key, { detail: e.target.value })}
                />
                <div className="row" style={{ alignItems: 'flex-end' }}>
                  <Button type="button" size="sm" variant="ghost"
                          disabled={index === 0}
                          onClick={() => moveCredit(credit.key, -1)}>
                    ↑<span className="visually-hidden"> Move up</span>
                  </Button>
                  <Button type="button" size="sm" variant="ghost"
                          disabled={index === form.credits.length - 1}
                          onClick={() => moveCredit(credit.key, 1)}>
                    ↓<span className="visually-hidden"> Move down</span>
                  </Button>
                  <Button type="button" size="sm" variant="ghost"
                          onClick={() => removeCredit(credit.key)}>
                    Remove<span className="visually-hidden"> credit {index + 1}</span>
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 'var(--space-4)' }}>
            <Button type="button" onClick={addCredit}>Add a credit</Button>
          </div>
        </fieldset>

        {/* ---------------------------------------------------------- links */}
        <fieldset className="plate" style={{ border: '1px solid var(--rule)' }}>
          <legend className="label-type" style={{ padding: '0 var(--space-2)' }}>
            Links out
          </legend>
          <p style={{ color: 'var(--fg-soft)', marginTop: 0 }}>
            Recordings, catalog scans, discography entries. A link of kind
            “{LINK_KIND_LABELS.audio}” is given pride of place on the record page.
          </p>

          {form.links.length === 0 && (
            <p style={{ color: 'var(--fg-faint)' }}>No links recorded yet.</p>
          )}

          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            {form.links.map((link, index) => (
              <div
                key={link.key}
                style={{
                  display: 'grid', gap: 'var(--space-3)',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))',
                  borderTop: '1px solid var(--rule)', paddingTop: 'var(--space-3)',
                }}
              >
                <Select
                  label="Kind" value={link.kind}
                  onChange={(e) => updateLink(link.key, { kind: e.target.value as LinkKind })}
                >
                  {LINK_KIND_ORDER.map((kind) => (
                    <option key={kind} value={kind}>{LINK_KIND_LABELS[kind]}</option>
                  ))}
                </Select>
                <TextField
                  label="Label" value={link.label}
                  error={rowError('links', index, 'label')}
                  onChange={(e) => updateLink(link.key, { label: e.target.value })}
                />
                <TextField
                  label="Address" type="url" inputMode="url" value={link.url}
                  placeholder="https://"
                  error={rowError('links', index, 'url')}
                  onChange={(e) => updateLink(link.key, { url: e.target.value })}
                />
                <TextField
                  label="Source" value={link.sourceName}
                  hint="UCSB Cylinder Audio Archive, DAHR…"
                  onChange={(e) => updateLink(link.key, { sourceName: e.target.value })}
                />
                <div className="row" style={{ alignItems: 'flex-end' }}>
                  <Button type="button" size="sm" variant="ghost" disabled={index === 0}
                          onClick={() => moveLink(link.key, -1)}>
                    ↑<span className="visually-hidden"> Move up</span>
                  </Button>
                  <Button type="button" size="sm" variant="ghost"
                          disabled={index === form.links.length - 1}
                          onClick={() => moveLink(link.key, 1)}>
                    ↓<span className="visually-hidden"> Move down</span>
                  </Button>
                  <Button type="button" size="sm" variant="ghost"
                          onClick={() => removeLink(link.key)}>
                    Remove<span className="visually-hidden"> link {index + 1}</span>
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 'var(--space-4)' }}>
            <Button type="button" onClick={addLink}>Add a link</Button>
          </div>
        </fieldset>

        {/* ------------------------------------------------------- pictures */}
        {!isNew && (
          <fieldset className="plate" style={{ border: '1px solid var(--rule)' }}>
            <legend className="label-type" style={{ padding: '0 var(--space-2)' }}>
              Pictures
            </legend>
            <p style={{ color: 'var(--fg-soft)', marginTop: 0 }}>
              Label bands, catalog scans, box lids. These belong to the shared entry —
              photographs of your own copy live with the copy on your shelf.
            </p>
            {imageError ? (
              <div style={{ marginBottom: 'var(--space-3)' }}>
                <Notice tone="danger" title="That picture was not saved">
                  {imageError instanceof Error ? imageError.message : 'Something went wrong.'}
                </Notice>
              </div>
            ) : null}
            {images.length > 0 && (
              <div style={{ display: 'grid', gap: 'var(--space-4)', marginBottom: 'var(--space-4)',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))' }}>
                {images.map((image) => (
                  <figure key={image.id} style={{ margin: 0 }}>
                    <img
                      src={image.thumbUrl ?? image.url}
                      alt={image.altText ?? image.caption ?? ''}
                      style={{ borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-sm)' }}
                    />
                    <figcaption className="label-type" style={{ marginTop: 'var(--space-1)' }}>
                      {image.isPrimary ? 'Leading picture' : image.caption || 'Untitled'}
                    </figcaption>
                    <div className="row" style={{ gap: 'var(--space-1)' }}>
                      {!image.isPrimary && (
                        <Button type="button" size="sm" variant="ghost"
                                onClick={() => makePrimary(image.id)}>
                          Make leading
                        </Button>
                      )}
                      <Button type="button" size="sm" variant="ghost"
                              onClick={() => removeImage(image.id)}>
                        Remove
                      </Button>
                    </div>
                  </figure>
                ))}
              </div>
            )}
            <label className="field-label" htmlFor="record-images">Add pictures</label>
            <input
              id="record-images"
              className="field"
              type="file"
              accept="image/*"
              multiple
              disabled={imageBusy}
              onChange={(e) => { uploadImages(e.target.files); e.target.value = ''; }}
            />
            <div className="field-hint">
              {imageBusy
                ? 'Uploading…'
                : 'JPEG, PNG, WebP, HEIC or GIF. Pictures are saved as soon as they are chosen, not with the rest of the form.'}
            </div>
          </fieldset>
        )}

        {/* ---------------------------------------------------------- prose */}
        <fieldset className="plate" style={{ border: '1px solid var(--rule)' }}>
          <legend className="label-type" style={{ padding: '0 var(--space-2)' }}>
            The article
          </legend>
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <TextArea
              label="Description" value={form.description} rows={10}
              error={fieldErrors.description}
              hint="Markdown: headings, lists, emphasis and links all work."
              onChange={(e) => set('description', e.target.value)}
            />
            <TextArea
              label="Notes" value={form.notes} rows={5} error={fieldErrors.notes}
              onChange={(e) => set('notes', e.target.value)}
            />
            <TextArea
              label="Lyrics" value={form.lyrics} rows={8} error={fieldErrors.lyrics}
              hint="Kept as typed; line breaks are preserved on the page."
              onChange={(e) => set('lyrics', e.target.value)}
            />
            <TextArea
              label="Curiosities" value={form.trivia} rows={4} error={fieldErrors.trivia}
              onChange={(e) => set('trivia', e.target.value)}
            />
            <TextArea
              label="Provenance" value={form.provenance} rows={4}
              error={fieldErrors.provenance}
              hint="Where this cylinder came from: an original recording, a dubbing of an earlier wax Amberol, a re-recording of a disc."
              onChange={(e) => set('provenance', e.target.value)}
            />
          </div>
        </fieldset>

        {/* --------------------------------------------------------- status */}
        <fieldset className="plate" style={{ border: '1px solid var(--rule)' }}>
          <legend className="label-type" style={{ padding: '0 var(--space-2)' }}>
            Standing of the entry
          </legend>
          <div style={{ display: 'grid', gap: 'var(--space-4)',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' }}>
            <Select
              label="Certainty" value={form.confidence}
              error={fieldErrors.confidence}
              hint="Say plainly when a detail is unconfirmed; the page will show it."
              onChange={(e) => set('confidence', e.target.value as Confidence)}
            >
              <option value="verified">Verified against a source</option>
              <option value="probable">Probable</option>
              <option value="uncertain">Uncertain</option>
            </Select>
            <TextField
              label="Original issue (record id)" value={form.originalIssueId}
              inputMode="numeric" error={fieldErrors.originalIssueId}
              hint="If this is a dubbing or reissue, the id of the earlier record."
              onChange={(e) => set('originalIssueId', e.target.value)}
            />
            <div style={{ alignSelf: 'end' }}>
              <Checkbox
                label="This is a stub — much is still missing"
                checked={form.isStub}
                onChange={(v) => set('isStub', v)}
              />
            </div>
          </div>
        </fieldset>

        {/* --------------------------------------------------- edit summary */}
        <fieldset className="plate" style={{ border: '1px solid var(--rule)' }}>
          <legend className="label-type" style={{ padding: '0 var(--space-2)' }}>
            Edit summary
          </legend>
          <div style={{ display: 'grid', gap: 'var(--space-4)',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' }}>
            <TextField
              label="What changed, and why"
              value={editSummary}
              placeholder="Corrected the release month from the March 1916 supplement"
              hint="Kept in the entry's history, as on a wiki."
              onChange={(e) => setEditSummary(e.target.value)}
            />
            <TextField
              label="Editor" value={editor}
              onChange={(e) => setEditor(e.target.value)}
            />
          </div>
        </fieldset>
      </div>

      {/* --------------------------------------------------------- actions */}
      <div
        className="row no-print"
        style={{ marginTop: 'var(--space-6)', justifyContent: 'space-between' }}
      >
        <div className="row">
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Saving…' : isNew ? 'Create the entry' : 'Save the correction'}
          </Button>
          <ButtonLink to={isNew ? '/catalog' : `/catalog/${slug}`} variant="ghost">
            Cancel
          </ButtonLink>
          {dirty && <span className="label-type">Unsaved changes</span>}
        </div>
        {!isNew && (
          <Button type="button" variant="ghost" disabled={deleting} onClick={remove}>
            {deleting ? 'Deleting…' : 'Delete this entry'}
          </Button>
        )}
      </div>
    </form>
  );
}

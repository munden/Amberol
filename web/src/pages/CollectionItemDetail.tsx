/**
 * One owned copy.
 *
 * The order of the page follows the order a collector actually looks at a
 * cylinder: what it is, what it looks like, what is wrong with it and what
 * that means, when it was last cleaned and how, and finally where it came
 * from and where it lives.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Badge, Button, ButtonLink, DataList, DataPair, ErrorState, Fleuron, Notice,
  Spinner, StarRating, TextArea, TextField, useTitle,
} from '../components/ui';
import {
  MATERIAL_LABELS, api, formatDate, formatDateTime, formatMoney,
} from '../lib/api';
import type { CollectionItem, SurfaceNoise } from '../lib/api';
import { CleanedStamp, ConfirmDialog, Thumb } from '../components/collection/bits';
import { useAsync, useLookups, fromLocalInput, toLocalInput } from '../components/collection/hooks';
import ImageGallery from '../components/collection/ImageGallery';
import ImageUploader from '../components/collection/ImageUploader';
import CleaningLog from '../components/collection/CleaningLog';
import { DefectPanel } from '../components/collection/Defects';
import '../components/collection/collection.css';

const NOISE_LABELS: Record<SurfaceNoise, string> = {
  none: 'None to speak of',
  light: 'Light',
  moderate: 'Moderate',
  heavy: 'Heavy',
  severe: 'Severe',
};

export default function CollectionItemDetail() {
  const { id } = useParams();
  const itemId = Number(id);
  const navigate = useNavigate();
  const lookups = useLookups();

  const state = useAsync<CollectionItem>(() => api.collection.get(itemId), [itemId]);
  const { data: item, error, loading, reload } = state;

  useTitle(item ? item.displayTitle : 'A cylinder');

  const [flagError, setFlagError] = useState<string | null>(null);
  const [flagBusy, setFlagBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [showUploader, setShowUploader] = useState(false);

  // Play log form
  const [playOpen, setPlayOpen] = useState(false);
  const [playedAt, setPlayedAt] = useState(() => toLocalInput(null));
  const [machine, setMachine] = useState('');
  const [stylus, setStylus] = useState('');
  const [playNotes, setPlayNotes] = useState('');
  const [playBusy, setPlayBusy] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);

  if (Number.isNaN(itemId)) {
    return (
      <div className="page">
        <Notice tone="danger" title="No such copy">
          That is not a cylinder in your collection. <Link to="/collection">Back to the shelf</Link>.
        </Notice>
      </div>
    );
  }

  if (loading && !item) return <div className="page"><Spinner label="Fetching the copy" /></div>;
  if (error != null) {
    return (
      <div className="page">
        <ErrorState error={error} onRetry={reload} />
        <p style={{ marginTop: 'var(--space-4)' }}><Link to="/collection">Back to the shelf</Link></p>
      </div>
    );
  }
  if (!item) return null;

  const record = item.record;
  const material = record?.series.material ?? null;
  const images = item.images ?? [];
  const cleanings = item.cleanings ?? [];
  const plays = item.playEvents ?? [];

  async function setFlag(patch: Record<string, unknown>) {
    setFlagBusy(true);
    setFlagError(null);
    try {
      await api.collection.update(itemId, patch);
      reload();
    } catch (err) {
      setFlagError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setFlagBusy(false);
    }
  }

  async function reallyDelete() {
    setDeleteBusy(true);
    try {
      await api.collection.remove(itemId);
      navigate('/collection', { replace: true });
    } catch (err) {
      setFlagError(err instanceof Error ? err.message : 'That copy could not be removed.');
      setDeleteBusy(false);
      setConfirmDelete(false);
    }
  }

  async function addPlay() {
    setPlayBusy(true);
    setPlayError(null);
    try {
      await api.collection.addPlay(itemId, {
        playedAt: fromLocalInput(playedAt),
        machine: machine.trim() || null,
        stylus: stylus.trim() || null,
        notes: playNotes.trim() || null,
      });
      setPlayOpen(false);
      setMachine('');
      setStylus('');
      setPlayNotes('');
      setPlayedAt(toLocalInput(null));
      reload();
    } catch (err) {
      setPlayError(err instanceof Error ? err.message : 'That play did not save.');
    } finally {
      setPlayBusy(false);
    }
  }

  return (
    <div className="page">
      <p className="no-print"><Link to="/collection">‹ The shelf</Link></p>

      {/* ------------------------------------------------------------ identity */}
      <header className="plate">
        <div className="spread" style={{ alignItems: 'flex-start', gap: 'var(--space-4)' }}>
          <div style={{ flex: '1 1 20rem', minWidth: 0 }}>
            <p className="eyebrow">
              {record ? record.series.name : 'Unidentified copy'}
              {item.copyLabel ? ` · ${item.copyLabel}` : ''}
            </p>
            <h1 style={{ marginBottom: 'var(--space-2)' }}>{item.displayTitle}</h1>
            <p className="cx-meta" style={{ margin: 0 }}>
              <span className="stamp-type">
                {record?.catalogNumber ?? item.unmatchedNumber ?? 'No number'}
              </span>
              {record && (
                <>
                  <Link to={`/makers/${record.maker.slug}`}>{record.maker.name}</Link>
                  <Link to={`/series/${record.series.slug}`}>{record.series.name}</Link>
                  <span>{MATERIAL_LABELS[record.series.material]}</span>
                  {record.series.playMinutes && <span>{record.series.playMinutes}-minute</span>}
                </>
              )}
              {!record && item.unmatchedMaker && <span>{item.unmatchedMaker}</span>}
            </p>
            {record?.performers && (
              <p style={{ margin: 'var(--space-2) 0 0', color: 'var(--fg-soft)' }}>
                {record.creditLine ?? 'Performed by'} — {record.performers}
              </p>
            )}
            {record && (
              <p style={{ margin: 'var(--space-3) 0 0' }} className="no-print">
                <Link to={`/catalog/${record.slug}`}>Open the master catalog entry ›</Link>
              </p>
            )}
          </div>
          <Thumb item={item} width={140} height={90} showCount />
        </div>

        {!record && (
          <Notice tone="warn" title="Not yet matched to the catalog">
            <p style={{ margin: '0 0 var(--space-3)' }}>
              This copy is recorded from what is written on it:{' '}
              <strong>{item.unmatchedTitle ?? 'title unknown'}</strong>
              {item.unmatchedMaker ? `, ${item.unmatchedMaker}` : ''}
              {item.unmatchedNumber ? `, number ${item.unmatchedNumber}` : ''}. Until it is matched,
              the register cannot tell you its material — so the cleaning-safety check cannot run.
            </p>
            <ButtonLink to={`/collection/${item.id}/edit?match=1`} size="sm" variant="brass">
              Match it to a catalog entry
            </ButtonLink>
          </Notice>
        )}

        {flagError && <Notice tone="danger" title="That did not save">{flagError}</Notice>}

        <div className="row no-print" style={{ marginTop: 'var(--space-4)' }}>
          <Button
            variant={item.isFavourite ? 'brass' : 'ghost'}
            disabled={flagBusy}
            aria-pressed={item.isFavourite}
            onClick={() => setFlag({ isFavourite: !item.isFavourite })}
          >
            {item.isFavourite ? '★ Favourite' : '☆ Mark favourite'}
          </Button>
          <Button
            variant={item.isForTrade ? 'brass' : 'ghost'}
            disabled={flagBusy}
            aria-pressed={item.isForTrade}
            onClick={() => setFlag({ isForTrade: !item.isForTrade })}
          >
            {item.isForTrade ? 'For trade' : 'Offer for trade'}
          </Button>
          <ButtonLink to={`/collection/${item.id}/edit`} variant="primary">Edit this copy</ButtonLink>
          <Button variant="ghost" onClick={() => setConfirmDelete(true)}>Remove from the shelf</Button>
        </div>
      </header>

      <div className="cx-detail-grid" style={{ marginTop: 'var(--space-5)' }}>
        <main>
          {/* -------------------------------------------------------- photographs */}
          <section className="cx-section" aria-labelledby="h-photos">
            <div className="cx-sectionhead">
              <h2 id="h-photos">Photographs</h2>
              <Button
                className="no-print"
                variant={showUploader ? 'ghost' : 'brass'}
                onClick={() => setShowUploader((v) => !v)}
              >
                {showUploader ? 'Done adding' : 'Add photographs'}
              </Button>
            </div>

            {showUploader && (
              <div className="no-print" style={{ marginBottom: 'var(--space-5)' }}>
                <ImageUploader
                  itemId={item.id}
                  onUploaded={() => reload()}
                  defaultView={images.length === 0 ? 'label' : 'surface'}
                />
              </div>
            )}

            <ImageGallery images={images} onChange={reload} />
          </section>

          {/* ------------------------------------------------- condition & issues */}
          <section className="cx-section" aria-labelledby="h-condition">
            <h2 id="h-condition">Condition and faults</h2>

            <DataList>
              <DataPair label="Condition grade">
                {item.conditionGrade ? (
                  <>
                    <strong className="stamp-type">{item.conditionGrade.code}</strong>{' '}
                    {item.conditionGrade.label}
                    {item.conditionGrade.description && (
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-soft)' }}>
                        {item.conditionGrade.description}
                      </div>
                    )}
                  </>
                ) : 'Ungraded'}
              </DataPair>
              <DataPair label="Box grade">
                {item.boxGrade ? `${item.boxGrade.code} — ${item.boxGrade.label}` : '—'}
              </DataPair>
              <DataPair label="Playback rating">
                <StarRating value={item.playbackRating} readOnly />
              </DataPair>
              <DataPair label="Surface noise">
                {item.surfaceNoise ? NOISE_LABELS[item.surfaceNoise] : '—'}
              </DataPair>
              <DataPair label="Playable">
                {item.isPlayable
                  ? <Badge tone="green">Plays</Badge>
                  : <Badge tone="danger">Not playable</Badge>}
              </DataPair>
              <DataPair label="Original box and lid">
                {item.hasOriginalBox ? 'Box' : 'No box'}
                {item.hasOriginalLid ? ', lid' : ', no lid'}
              </DataPair>
            </DataList>

            {item.conditionNotes && (
              <p style={{ marginTop: 'var(--space-3)' }}>{item.conditionNotes}</p>
            )}

            <Fleuron mark="✦" />

            <DefectPanel
              itemId={item.id}
              defects={item.defects}
              types={lookups.data?.defectTypes ?? []}
              onChange={reload}
            />
          </section>

          {/* -------------------------------------------------------- cleaning log */}
          <section className="cx-section" aria-labelledby="h-cleaning">
            <div className="cx-sectionhead">
              <h2 id="h-cleaning">Cleaning log</h2>
              <CleanedStamp cleaning={item.cleaning} withTime />
            </div>

            {lookups.error != null && (
              <Notice tone="danger" title="The cleaning methods could not be loaded">
                Without them the safety check against the material cannot run. Reload the page to
                try again.
              </Notice>
            )}

            <CleaningLog
              itemId={item.id}
              material={material}
              cleanings={cleanings}
              methods={lookups.data?.cleaningMethods ?? []}
              onChange={reload}
            />
          </section>

          {/* ------------------------------------------------------------ play log */}
          <section className="cx-section" aria-labelledby="h-plays">
            <div className="cx-sectionhead">
              <h2 id="h-plays">Play log</h2>
              <Button className="no-print" variant="ghost" onClick={() => setPlayOpen((v) => !v)}>
                {playOpen ? 'Cancel' : 'Log a play'}
              </Button>
            </div>

            {playOpen && (
              <div className="plate stack no-print" style={{ marginBottom: 'var(--space-4)' }}>
                <div className="cx-form-grid cx-form-grid-3">
                  <TextField
                    label="Played at"
                    type="datetime-local"
                    value={playedAt}
                    onChange={(e) => setPlayedAt(e.target.value)}
                  />
                  <TextField
                    label="Machine"
                    value={machine}
                    placeholder="Amberola 30"
                    onChange={(e) => setMachine(e.target.value)}
                  />
                  <TextField
                    label="Stylus"
                    value={stylus}
                    placeholder="Diamond, 4-minute"
                    onChange={(e) => setStylus(e.target.value)}
                  />
                </div>
                <TextArea
                  label="Notes"
                  value={playNotes}
                  onChange={(e) => setPlayNotes(e.target.value)}
                />
                {playError && <Notice tone="danger" title="That did not save">{playError}</Notice>}
                <div className="row">
                  <Button variant="primary" onClick={addPlay} disabled={playBusy}>
                    {playBusy ? 'Saving…' : 'Add to the play log'}
                  </Button>
                </div>
              </div>
            )}

            {plays.length === 0 ? (
              <p style={{ color: 'var(--fg-soft)' }}>
                Not played since it was catalogued. Logging a play is how the wear on a cylinder
                stops being a guess.
              </p>
            ) : (
              <ul className="cx-log">
                {plays.map((play) => (
                  <li key={play.id}>
                    <div className="spread">
                      <span className="cx-log-when">{formatDateTime(play.playedAt)}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="no-print"
                        onClick={async () => {
                          await api.collection.removePlay(play.id);
                          reload();
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                    <div className="cx-meta">
                      {play.machine && <span>{play.machine}</span>}
                      {play.stylus && <span>{play.stylus}</span>}
                    </div>
                    {play.notes && <p style={{ margin: 'var(--space-1) 0 0' }}>{play.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>

        {/* ------------------------------------------------------------- the aside */}
        <aside className="stack">
          <div className="plate">
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', letterSpacing: '0.08em' }}>
              Acquisition
            </h2>
            <DataList columns={1}>
              <DataPair label="Acquired" stamp>
                {item.acquiredOn ? formatDate(item.acquiredOn, 'day') : '—'}
              </DataPair>
              <DataPair label="From">{item.acquiredFrom ?? '—'}</DataPair>
              <DataPair label="Paid" stamp>
                {formatMoney(item.acquiredPrice, item.acquiredCurrency)}
              </DataPair>
              <DataPair label="Estimated value" stamp>
                {formatMoney(item.estimatedValue, item.acquiredCurrency)}
              </DataPair>
            </DataList>
          </div>

          <div className="plate">
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', letterSpacing: '0.08em' }}>
              Where it lives
            </h2>
            <DataList columns={1}>
              <DataPair label="Storage location">{item.storageLocation ?? '—'}</DataPair>
              <DataPair label="Material">{MATERIAL_LABELS[material ?? 'unknown']}</DataPair>
              <DataPair label="Added to the shelf" stamp>{formatDate(item.createdAt, 'day')}</DataPair>
              <DataPair label="Last touched" stamp>{formatDateTime(item.updatedAt)}</DataPair>
            </DataList>
          </div>

          <div className="plate">
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', letterSpacing: '0.08em' }}>
              My notes
            </h2>
            {item.personalNotes
              ? <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{item.personalNotes}</p>
              : (
                <p style={{ margin: 0, color: 'var(--fg-soft)' }}>
                  Nothing written yet. Where it came from, who sang it, what it sounded like the
                  first time — none of that is in the catalog.
                </p>
              )}
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Remove this copy from the shelf?"
        confirmLabel="Remove the copy"
        busy={deleteBusy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={reallyDelete}
      >
        <p style={{ margin: '0 0 var(--space-3)' }}>
          <strong>{item.displayTitle}</strong> and everything recorded against it — {images.length}{' '}
          {images.length === 1 ? 'photograph' : 'photographs'}, {item.defects.length}{' '}
          {item.defects.length === 1 ? 'fault' : 'faults'} and {cleanings.length}{' '}
          {cleanings.length === 1 ? 'cleaning entry' : 'cleaning entries'} — will be deleted.
        </p>
        <p style={{ margin: 0 }}>
          The master catalog entry is untouched. This cannot be undone.
        </p>
      </ConfirmDialog>
    </div>
  );
}

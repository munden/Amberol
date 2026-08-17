/**
 * Photographing an owned copy.
 *
 * The collector is usually standing at the shelf with the cylinder in one
 * hand, so the camera button comes first and everything else is optional.
 * Files are previewed before they go, sent one request each so each has its
 * own state, and the three answers that are not plain success — a duplicate,
 * a file over the limit, and a file that is not an image — are each said in
 * words rather than left to look like silence.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Notice, Select, TextField } from '../ui';
import { ApiError, api } from '../../lib/api';
import type { Image, ImageView } from '../../lib/api';

const MAX_BYTES = 25 * 1024 * 1024;

export const VIEW_LABELS: Record<ImageView, string> = {
  label: 'Title band / label',
  surface: 'Playing surface',
  box: 'Carton',
  lid: 'Lid',
  end: 'Moulded end',
  damage: 'Damage',
  other: 'Other view',
};

export const VIEW_ORDER: ImageView[] = ['label', 'surface', 'end', 'box', 'lid', 'damage', 'other'];

type Status = 'ready' | 'uploading' | 'done' | 'duplicate' | 'error';

interface Queued {
  key: string;
  file: File;
  preview: string;
  status: Status;
  message?: string;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Turns an upload failure into something the collector can act on. */
function explain(error: unknown, file: File): string {
  if (error instanceof ApiError) {
    if (error.status === 413) {
      return `Too large at ${humanSize(file.size)}. The register accepts images up to 25 MB — ` +
        'photograph again at a smaller size, or reduce it before uploading.';
    }
    if (error.status === 422) {
      return error.message ||
        'That file is not an image the register can read. JPEG, PNG, WebP, HEIC and GIF are accepted.';
    }
    if (error.status === 0) return 'Could not reach the register. Check the connection and try again.';
    return error.message;
  }
  return 'That upload did not finish.';
}

export default function ImageUploader({
  itemId, onUploaded, defaultView = 'label',
}: {
  itemId: number;
  onUploaded: (images: Image[]) => void;
  defaultView?: ImageView;
}) {
  const [queue, setQueue] = useState<Queued[]>([]);
  const [view, setView] = useState<ImageView>(defaultView);
  const [caption, setCaption] = useState('');
  const [altText, setAltText] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const previews = useRef<string[]>([]);

  useEffect(() => () => { previews.current.forEach((url) => URL.revokeObjectURL(url)); }, []);

  const addFiles = useCallback((files: FileList | File[] | null) => {
    if (!files) return;
    const next: Queued[] = [];
    for (const file of Array.from(files)) {
      const preview = URL.createObjectURL(file);
      previews.current.push(preview);
      const tooBig = file.size > MAX_BYTES;
      const notImage = !!file.type && !file.type.startsWith('image/');
      next.push({
        key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        preview,
        status: tooBig || notImage ? 'error' : 'ready',
        message: tooBig
          ? `Too large at ${humanSize(file.size)} — the limit is 25 MB.`
          : notImage
            ? 'Not an image. JPEG, PNG, WebP, HEIC and GIF are accepted.'
            : undefined,
      });
    }
    setQueue((current) => [...current, ...next]);
  }, []);

  const patch = (key: string, change: Partial<Queued>) =>
    setQueue((current) => current.map((q) => (q.key === key ? { ...q, ...change } : q)));

  const remove = (key: string) =>
    setQueue((current) => current.filter((q) => q.key !== key));

  async function upload() {
    const pending = queue.filter((q) => q.status === 'ready');
    if (pending.length === 0) return;
    setBusy(true);
    const uploaded: Image[] = [];

    // One request per file, so a failure names the photograph it belongs to
    // and the rest of the batch still goes up.
    for (const entry of pending) {
      patch(entry.key, { status: 'uploading', message: undefined });
      const form = new FormData();
      form.append('files', entry.file, entry.file.name);
      form.append('view', view);
      if (caption.trim()) form.append('caption', caption.trim());
      if (altText.trim()) form.append('altText', altText.trim());
      try {
        const images = await api.collection.uploadImages(itemId, form);
        const created = images?.[0];
        uploaded.push(...(images ?? []));
        if (created?.duplicate) {
          patch(entry.key, {
            status: 'duplicate',
            message: 'Already on file — the register recognised this exact photograph and kept the one it had.',
          });
        } else {
          patch(entry.key, { status: 'done', message: 'Added.' });
        }
      } catch (error) {
        patch(entry.key, { status: 'error', message: explain(error, entry.file) });
      }
    }

    setBusy(false);
    if (uploaded.length > 0) {
      setCaption('');
      setAltText('');
      onUploaded(uploaded);
    }
  }

  const readyCount = queue.filter((q) => q.status === 'ready').length;
  const doneCount = queue.filter((q) => q.status === 'done' || q.status === 'duplicate').length;

  return (
    <div className="stack">
      <div
        className={`cx-drop${dragOver ? ' is-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <p className="label-type" style={{ margin: 0 }}>Photographs of this copy</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Button variant="brass" onClick={() => cameraRef.current?.click()}>
            Take a photograph
          </Button>
          <Button variant="ghost" onClick={() => pickRef.current?.click()}>
            Choose files
          </Button>
        </div>
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--fg-soft)' }}>
          <span className="hide-mobile">Drag photographs here, or </span>
          JPEG, PNG, WebP, HEIC or GIF, up to 25&nbsp;MB each.
        </p>

        {/* The camera input opens the rear camera directly on a phone. */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="visually-hidden"
          aria-label="Take a photograph of this cylinder"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
        <input
          ref={pickRef}
          type="file"
          accept="image/*"
          multiple
          className="visually-hidden"
          aria-label="Choose image files"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {queue.length > 0 && (
        <>
          <div className="cx-form-grid cx-form-grid-3">
            <Select
              label="View"
              value={view}
              onChange={(e) => setView(e.target.value as ImageView)}
              hint="Applied to everything in this batch."
            >
              {VIEW_ORDER.map((v) => (
                <option key={v} value={v}>{VIEW_LABELS[v]}</option>
              ))}
            </Select>
            <TextField
              label="Caption"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Title band, raking light"
            />
            <TextField
              label="Alt text"
              value={altText}
              onChange={(e) => setAltText(e.target.value)}
              placeholder="Described for a reader who cannot see it"
            />
          </div>

          <ul className="cx-queue">
            {queue.map((q) => (
              <li key={q.key}>
                <img src={q.preview} alt="" />
                <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                  <div className="stamp-type" style={{
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {q.file.name}
                  </div>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-soft)' }}>
                    {humanSize(q.file.size)}
                    {q.status === 'uploading' && ' · sending…'}
                    {q.status === 'done' && ' · added'}
                    {q.status === 'duplicate' && ' · already held'}
                  </div>
                  <div className="cx-bar" aria-hidden="true">
                    <span
                      className={
                        'cx-bar-fill' +
                        (q.status === 'uploading' ? ' is-working' : '') +
                        (q.status === 'error' ? ' is-error' : '') +
                        (q.status === 'duplicate' ? ' is-dupe' : '')
                      }
                      style={{
                        width: q.status === 'done' || q.status === 'duplicate' || q.status === 'error'
                          ? '100%'
                          : q.status === 'uploading' ? undefined : '0%',
                      }}
                    />
                  </div>
                  {q.message && (
                    <p
                      role={q.status === 'error' ? 'alert' : undefined}
                      style={{
                        margin: 'var(--space-1) 0 0',
                        fontSize: 'var(--text-sm)',
                        color: q.status === 'error'
                          ? 'var(--danger)'
                          : q.status === 'duplicate' ? 'var(--warn)' : 'var(--ok)',
                      }}
                    >
                      {q.message}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => remove(q.key)}
                  disabled={q.status === 'uploading'}
                  aria-label={`Remove ${q.file.name} from the queue`}
                >
                  ✕
                </Button>
              </li>
            ))}
          </ul>

          <div className="row">
            <Button variant="primary" onClick={upload} disabled={busy || readyCount === 0}>
              {busy ? 'Uploading…' : `Upload ${readyCount || ''} ${readyCount === 1 ? 'photograph' : 'photographs'}`.trim()}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setQueue([])}
              disabled={busy}
            >
              Clear the queue
            </Button>
            {doneCount > 0 && (
              <span className="label-type">{doneCount} of {queue.length} handled</span>
            )}
          </div>

          {queue.some((q) => q.status === 'duplicate') && (
            <Notice tone="warn" title="One or more were already held">
              The register recognises a photograph it already has by its contents, so nothing was
              added twice. The copy it kept is in the gallery above.
            </Notice>
          )}
        </>
      )}
    </div>
  );
}

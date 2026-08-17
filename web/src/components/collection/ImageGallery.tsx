/**
 * The photographs of one owned copy, grouped by what they show — the title
 * band, the surface, the carton and so on — because that is how a collector
 * looks for them. Each can be captioned, described, made the primary shot, or
 * deleted after confirming.
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Modal, Notice, Select, TextField } from '../ui';
import { api, formatDateTime } from '../../lib/api';
import type { Image, ImageView } from '../../lib/api';
import { ConfirmDialog } from './bits';
import { VIEW_LABELS, VIEW_ORDER } from './ImageUploader';

// ------------------------------------------------------------------ lightbox

function Lightbox({
  images, index, onClose, onIndex,
}: { images: Image[]; index: number; onClose: () => void; onIndex: (i: number) => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const image = images[index];

  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') onIndex((index + 1) % images.length);
      if (event.key === 'ArrowLeft') onIndex((index - 1 + images.length) % images.length);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, images.length, onClose, onIndex]);

  if (!image) return null;

  return (
    <div className="cx-lightbox" role="dialog" aria-modal="true" aria-label="Photograph, full size">
      <div className="cx-lightbox-bar">
        <span className="label-type" style={{ color: 'var(--brass-pale)' }}>
          {image.view ? VIEW_LABELS[image.view] : 'Photograph'} · {index + 1} of {images.length}
        </span>
        <Button ref={closeRef} size="sm" variant="ghost" onClick={onClose} aria-label="Close the photograph">
          ✕ Close
        </Button>
      </div>
      <img src={image.url} alt={image.altText ?? image.caption ?? 'Photograph of this cylinder'} />
      <div className="cx-lightbox-bar">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onIndex((index - 1 + images.length) % images.length)}
          disabled={images.length < 2}
        >
          ‹ Previous
        </Button>
        <span className="cx-lightbox-cap">
          {image.caption}
          {image.width && image.height ? ` · ${image.width}×${image.height}` : ''}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onIndex((index + 1) % images.length)}
          disabled={images.length < 2}
        >
          Next ›
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- gallery

export default function ImageGallery({
  images, onChange,
}: { images: Image[]; onChange: () => void }) {
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [editing, setEditing] = useState<Image | null>(null);
  const [deleting, setDeleting] = useState<Image | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [caption, setCaption] = useState('');
  const [altText, setAltText] = useState('');
  const [view, setView] = useState<ImageView>('other');

  function openEditor(image: Image) {
    setEditing(image);
    setCaption(image.caption ?? '');
    setAltText(image.altText ?? '');
    setView(image.view ?? 'other');
    setError(null);
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      await api.images.update(editing.id, {
        caption: caption.trim() || null,
        altText: altText.trim() || null,
        view,
      });
      setEditing(null);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  async function makePrimary(image: Image) {
    setBusy(true);
    setError(null);
    try {
      await api.images.update(image.id, { isPrimary: true });
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
    setError(null);
    try {
      await api.images.remove(deleting.id);
      setDeleting(null);
      setLightbox(null);
      onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That photograph could not be removed.');
    } finally {
      setBusy(false);
    }
  }

  if (images.length === 0) {
    return (
      <p style={{ color: 'var(--fg-soft)' }}>
        No photographs of this copy yet. A shot of the title band and one of the surface under
        raking light will tell you more in a year's time than any note.
      </p>
    );
  }

  const groups = VIEW_ORDER
    .map((v) => ({ view: v, items: images.filter((i) => (i.view ?? 'other') === v) }))
    .filter((g) => g.items.length > 0);
  const ordered = groups.flatMap((g) => g.items);

  return (
    <div className="stack">
      {error && <Notice tone="danger" title="That did not work">{error}</Notice>}

      {groups.map((group) => (
        <section key={group.view}>
          <h3 className="label-type" style={{ marginBottom: 'var(--space-2)' }}>
            {VIEW_LABELS[group.view]} · {group.items.length}
          </h3>
          <div className="cx-gallery">
            {group.items.map((image) => (
              <figure key={image.id} className="cx-shot" style={{ margin: 0 }}>
                <button
                  type="button"
                  className="cx-shot-btn"
                  onClick={() => setLightbox(ordered.findIndex((i) => i.id === image.id))}
                  aria-label={`View ${image.caption ?? VIEW_LABELS[image.view ?? 'other']} full size`}
                >
                  <img
                    src={image.thumbUrl ?? image.url}
                    alt={image.altText ?? image.caption ?? 'Photograph of this cylinder'}
                    loading="lazy"
                  />
                </button>
                {image.isPrimary && <span className="cx-shot-primary">Primary</span>}
                <figcaption className="cx-shot-caption">
                  {image.caption ?? <span style={{ color: 'var(--fg-faint)' }}>No caption</span>}
                  {!image.altText && (
                    <span style={{ display: 'block', color: 'var(--warn)' }}>No alt text</span>
                  )}
                  <span style={{ display: 'block', color: 'var(--fg-faint)' }}>
                    {formatDateTime(image.createdAt)}
                  </span>
                </figcaption>
                <div className="cx-shot-tools">
                  <Button size="sm" variant="ghost" onClick={() => openEditor(image)}>Edit</Button>
                  {!image.isPrimary && (
                    <Button size="sm" variant="ghost" onClick={() => makePrimary(image)} disabled={busy}>
                      Make primary
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(image)}>Delete</Button>
                </div>
              </figure>
            ))}
          </div>
        </section>
      ))}

      {lightbox !== null && (
        <Lightbox
          images={ordered}
          index={lightbox}
          onIndex={setLightbox}
          onClose={() => setLightbox(null)}
        />
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Describe this photograph">
        <div className="stack">
          <Select label="View" value={view} onChange={(e) => setView(e.target.value as ImageView)}>
            {VIEW_ORDER.map((v) => <option key={v} value={v}>{VIEW_LABELS[v]}</option>)}
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
            hint="What the photograph shows, for a reader who cannot see it."
          />
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy}>Save</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Delete this photograph?"
        confirmLabel="Delete the photograph"
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={reallyDelete}
      >
        <p style={{ margin: 0 }}>
          The file is removed from the register as well as the entry. This cannot be undone.
        </p>
      </ConfirmDialog>
    </div>
  );
}

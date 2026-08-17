/**
 * Small hooks shared by the collection screens: fetching, the lookup
 * vocabularies, a media query, and the unsaved-changes guard.
 *
 * Nothing here talks to the network except through lib/api.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import type { Lookups } from '../../lib/api';

// ------------------------------------------------------------------ fetching

export interface AsyncState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
  setData: (value: T | null) => void;
}

/**
 * Runs an async function on mount and whenever `deps` change, discarding the
 * result of any request that has been superseded.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const latest = useRef(0);

  // The caller passes a fresh closure each render; deps decide when to re-run.
  const run = useRef(fn);
  run.current = fn;

  useEffect(() => {
    const ticket = ++latest.current;
    setLoading(true);
    setError(null);
    run.current().then(
      (value) => {
        if (ticket !== latest.current) return;
        setData(value);
        setLoading(false);
      },
      (err) => {
        if (ticket !== latest.current) return;
        setError(err);
        setLoading(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload, setData };
}

// ------------------------------------------------------------------- lookups

/**
 * The grading scale, defect vocabulary and cleaning methods. Fetched once per
 * page load and shared by every screen that needs a dropdown.
 */
let lookupCache: Lookups | null = null;
let lookupInFlight: Promise<Lookups> | null = null;

export function loadLookups(): Promise<Lookups> {
  if (lookupCache) return Promise.resolve(lookupCache);
  if (!lookupInFlight) {
    lookupInFlight = api.lookups().then(
      (value) => {
        lookupCache = value;
        lookupInFlight = null;
        return value;
      },
      (err) => {
        lookupInFlight = null;
        throw err;
      },
    );
  }
  return lookupInFlight;
}

export function useLookups(): AsyncState<Lookups> {
  return useAsync(() => loadLookups(), []);
}

// -------------------------------------------------------------------- layout

/** True when the query matches. Used to swap a dense table for cards. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

// --------------------------------------------------------- unsaved changes

const LEAVE_MESSAGE =
  'This copy has changes that have not been saved. Leave the page and lose them?';

/**
 * Warns before the collector loses edits. Covers a reload or a closed tab via
 * `beforeunload`, and in-app navigation by intercepting link clicks — the app
 * mounts a plain BrowserRouter, so react-router's own blocker is unavailable.
 */
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return undefined;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.dataset.allowUnsaved === 'true') return;
      if (anchor.getAttribute('href')?.startsWith('#')) return;
      // eslint-disable-next-line no-alert
      if (!window.confirm(LEAVE_MESSAGE)) {
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
}

/** Asks before an action that cannot be undone. */
export function confirmDiscard(message = LEAVE_MESSAGE): boolean {
  // eslint-disable-next-line no-alert
  return window.confirm(message);
}

// ------------------------------------------------------- date & time helpers

/** ISO timestamp → the `YYYY-MM-DDTHH:mm` a datetime-local input expects. */
export function toLocalInput(iso: string | null | undefined): string {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `YYYY-MM-DDTHH:mm` in the collector's own zone → ISO 8601 with its offset. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Days since a timestamp, or null when there is none. */
export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}

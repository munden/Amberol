/**
 * The shared component kit. Every screen builds from these so the register
 * looks like one printed object rather than three.
 *
 * Presentation lives in styles/tokens.css; these components only apply the
 * classes defined there and add behaviour.
 */
import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes,
  TextareaHTMLAttributes, SelectHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';

// ------------------------------------------------------------------ buttons

type ButtonVariant = 'default' | 'primary' | 'brass' | 'ghost';

const variantClass: Record<ButtonVariant, string> = {
  default: 'btn',
  primary: 'btn btn-primary',
  brass: 'btn btn-brass',
  ghost: 'btn btn-ghost',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'default', size = 'md', className = '', ...rest }, ref) => (
    <button
      ref={ref}
      className={`${variantClass[variant]}${size === 'sm' ? ' btn-sm' : ''} ${className}`.trim()}
      {...rest}
    />
  ),
);
Button.displayName = 'Button';

export function ButtonLink({
  to, variant = 'default', size = 'md', className = '', children, ...rest
}: { to: string; variant?: ButtonVariant; size?: 'sm' | 'md'; className?: string;
     children: ReactNode } & Record<string, unknown>) {
  return (
    <Link
      to={to}
      className={`${variantClass[variant]}${size === 'sm' ? ' btn-sm' : ''} ${className}`.trim()}
      {...rest}
    >
      {children}
    </Link>
  );
}

// ------------------------------------------------------------------- fields

interface FieldShell {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
}

function FieldWrap({
  id, label, hint, error, required, children,
}: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div>
      {label && (
        <label className="field-label" htmlFor={id}>
          {label}
          {required && <span aria-hidden="true" style={{ color: 'var(--accent)' }}> *</span>}
        </label>
      )}
      {children}
      {hint && !error && <div className="field-hint" id={`${id}-hint`}>{hint}</div>}
      {error && <div className="field-error" id={`${id}-error`} role="alert">{error}</div>}
    </div>
  );
}

export const TextField = forwardRef<HTMLInputElement,
  FieldShell & InputHTMLAttributes<HTMLInputElement>>(
  ({ label, hint, error, required, className = '', id, ...rest }, ref) => {
    const auto = useId();
    const fieldId = id ?? auto;
    return (
      <FieldWrap id={fieldId} label={label} hint={hint} error={error} required={required}>
        <input
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          className={`field ${className}`.trim()}
          {...rest}
        />
      </FieldWrap>
    );
  },
);
TextField.displayName = 'TextField';

export const TextArea = forwardRef<HTMLTextAreaElement,
  FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ label, hint, error, required, className = '', id, ...rest }, ref) => {
    const auto = useId();
    const fieldId = id ?? auto;
    return (
      <FieldWrap id={fieldId} label={label} hint={hint} error={error} required={required}>
        <textarea
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={error ? true : undefined}
          className={`field ${className}`.trim()}
          {...rest}
        />
      </FieldWrap>
    );
  },
);
TextArea.displayName = 'TextArea';

export const Select = forwardRef<HTMLSelectElement,
  FieldShell & SelectHTMLAttributes<HTMLSelectElement>>(
  ({ label, hint, error, required, className = '', id, children, ...rest }, ref) => {
    const auto = useId();
    const fieldId = id ?? auto;
    return (
      <FieldWrap id={fieldId} label={label} hint={hint} error={error} required={required}>
        <select ref={ref} id={fieldId} className={`field ${className}`.trim()} {...rest}>
          {children}
        </select>
      </FieldWrap>
    );
  },
);
Select.displayName = 'Select';

export function Checkbox({
  label, checked, onChange, id, disabled,
}: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void;
     id?: string; disabled?: boolean }) {
  const auto = useId();
  const fieldId = id ?? auto;
  return (
    <label
      htmlFor={fieldId}
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        minHeight: 'var(--touch)', cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <input
        id={fieldId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 20, height: 20, accentColor: 'var(--accent)', flexShrink: 0 }}
      />
      <span>{label}</span>
    </label>
  );
}

// ------------------------------------------------------------------ surfaces

export function Plate({ className = '', children, ...rest }:
  { className?: string; children: ReactNode } & Record<string, unknown>) {
  return <div className={`plate ${className}`.trim()} {...rest}>{children}</div>;
}

export function Sheet({ className = '', children, ...rest }:
  { className?: string; children: ReactNode } & Record<string, unknown>) {
  return <div className={`sheet ${className}`.trim()} {...rest}>{children}</div>;
}

export function Badge({ tone = 'brass', children }:
  { tone?: 'blue' | 'purple' | 'oxblood' | 'brass' | 'green' | 'warn' | 'danger';
    children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Notice({ tone = 'default', title, children }:
  { tone?: 'default' | 'ok' | 'warn' | 'danger'; title?: ReactNode; children: ReactNode }) {
  const cls = tone === 'default' ? 'notice' : `notice notice-${tone}`;
  return (
    <div className={cls} role={tone === 'danger' ? 'alert' : undefined}>
      <div>
        {title && <strong style={{ display: 'block', marginBottom: 'var(--space-1)' }}>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

/** Rule · ornament · rule. The period's section divider. */
export function Fleuron({ mark = '❦' }: { mark?: string }) {
  return <div className="fleuron" aria-hidden="true"><span>{mark}</span></div>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}

/** A field name and its value, set as in a printed catalog entry. */
export function DataPair({ label, children, stamp = false }:
  { label: ReactNode; children: ReactNode; stamp?: boolean }) {
  return (
    <div>
      <dt className="label-type">{label}</dt>
      <dd style={{ margin: '0 0 var(--space-3)' }} className={stamp ? 'stamp-type' : undefined}>
        {children ?? '—'}
      </dd>
    </div>
  );
}

export function DataList({ children, columns = 2 }: { children: ReactNode; columns?: number }) {
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(${columns > 1 ? '13rem' : '100%'}, 1fr))`,
        gap: '0 var(--space-5)',
        margin: 0,
      }}
    >
      {children}
    </dl>
  );
}

// -------------------------------------------------------------------- states

/** A spinning cylinder rather than a generic spinner. */
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" style={{ display: 'grid', placeItems: 'center', padding: 'var(--space-7)', gap: 'var(--space-3)' }}>
      <div
        aria-hidden="true"
        className="cylinder cylinder-blue"
        style={{ width: '7rem', animation: 'amberola-turn 1.4s linear infinite' }}
      />
      <span className="label-type">{label}…</span>
      <style>{`@keyframes amberola-turn {
        0% { background-position: 0 0, 0 0; }
        100% { background-position: 24px 0, 0 0; }
      }`}</style>
    </div>
  );
}

export function EmptyState({ title, children, action }:
  { title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="plate" style={{ textAlign: 'center', padding: 'var(--space-7) var(--space-5)' }}>
      <Fleuron />
      <h2 style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.06em' }}>{title}</h2>
      {children && <div style={{ color: 'var(--fg-soft)', maxWidth: '46ch', margin: '0 auto var(--space-4)' }}>{children}</div>}
      {action}
      <Fleuron />
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <Notice tone="danger" title="That did not work">
      <p style={{ margin: '0 0 var(--space-3)' }}>{message}</p>
      {onRetry && <Button size="sm" onClick={onRetry}>Try again</Button>}
    </Notice>
  );
}

// ---------------------------------------------------------------- pagination

export function Pagination({ page, totalPages, onPage }:
  { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  const window = 2;
  const pages: (number | 'gap')[] = [];
  for (let i = 1; i <= totalPages; i += 1) {
    if (i === 1 || i === totalPages || Math.abs(i - page) <= window) pages.push(i);
    else if (pages[pages.length - 1] !== 'gap') pages.push('gap');
  }
  return (
    <nav className="row no-print" aria-label="Pagination" style={{ justifyContent: 'center', marginTop: 'var(--space-6)' }}>
      <Button size="sm" onClick={() => onPage(page - 1)} disabled={page <= 1}>Previous</Button>
      {pages.map((p, i) =>
        p === 'gap' ? (
          <span key={`gap-${i}`} aria-hidden="true" style={{ color: 'var(--fg-faint)' }}>…</span>
        ) : (
          <Button
            key={p}
            size="sm"
            variant={p === page ? 'brass' : 'ghost'}
            aria-current={p === page ? 'page' : undefined}
            onClick={() => onPage(p)}
          >
            {p}
          </Button>
        ),
      )}
      <Button size="sm" onClick={() => onPage(page + 1)} disabled={page >= totalPages}>Next</Button>
    </nav>
  );
}

// -------------------------------------------------------------------- dialog

export function Modal({ open, onClose, title, children, wide = false }:
  { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      style={{
        border: '1px solid var(--rule-strong)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-raised)',
        color: 'var(--fg)',
        boxShadow: 'var(--shadow-lg)',
        padding: 0,
        width: 'min(100%, ' + (wide ? '52rem' : '34rem') + ')',
        maxHeight: '88vh',
      }}
    >
      <div className="spread" style={{ padding: 'var(--space-4)', borderBottom: '3px double var(--rule)' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--text-xl)' }}>{title}</h2>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">✕</Button>
      </div>
      <div style={{ padding: 'var(--space-5)', overflowY: 'auto', maxHeight: '70vh' }}>{children}</div>
    </dialog>
  );
}

// ----------------------------------------------------------------- utilities

/** Debounces a value — used so search-as-you-type does not hit the API per keystroke. */
export function useDebounced<T>(value: T, delay = 280): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Sets document.title, restoring it on unmount. */
export function useTitle(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · The Amberola Cylinder Register`;
    return () => { document.title = previous; };
  }, [title]);
}

export function StarRating({ value, onChange, readOnly = false }:
  { value: number | null; onChange?: (v: number) => void; readOnly?: boolean }) {
  const stars = [1, 2, 3, 4, 5];
  if (readOnly) {
    return (
      <span aria-label={value ? `${value} out of 5` : 'Not rated'} style={{ color: 'var(--brass)', letterSpacing: '0.1em' }}>
        {value ? stars.map((s) => (s <= value ? '★' : '☆')).join('') : '—'}
      </span>
    );
  }
  return (
    <div className="row" role="radiogroup" aria-label="Playback rating" style={{ gap: 'var(--space-1)' }}>
      {stars.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          aria-label={`${s} of 5`}
          onClick={() => onChange?.(s)}
          style={{
            background: 'none', border: 0, cursor: 'pointer', padding: 4,
            fontSize: '1.6rem', lineHeight: 1, minWidth: 'var(--touch)', minHeight: 'var(--touch)',
            color: value && s <= value ? 'var(--brass-bright)' : 'var(--fg-faint)',
          }}
        >
          {value && s <= value ? '★' : '☆'}
        </button>
      ))}
    </div>
  );
}

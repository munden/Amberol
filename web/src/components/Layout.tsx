/**
 * The frame every page sits inside.
 *
 * The header is the lid of the machine: quarter-sawn oak carrying a gold
 * decal nameplate, exactly as an Amberola cabinet does. Gold is only ever
 * used against oak here — on the cream stock below, the ink is black.
 *
 * On a phone the sections move to a fixed bottom tab bar, because the
 * register's real use is one-handed, standing at a shelf.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { api } from '../lib/api';
import '../styles/app.css';

const THEME_KEY = 'amberola-theme';

type Theme = 'light' | 'dark';

/** The lid colour that the browser chrome should match, per theme. */
const CHROME_COLOUR: Record<Theme, string> = { light: '#3c2415', dark: '#1c120d' };

function readTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const applied = document.documentElement.dataset.theme;
  if (applied === 'light' || applied === 'dark') return applied;
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* Private browsing can refuse storage; the system preference still works. */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// ------------------------------------------------------------------- marks

/**
 * Engraved line marks in the manner of a period cut: single weight, no
 * fill, no rounded whimsy. Each is decorative — the tab's own words carry
 * the meaning — so they are hidden from assistive technology.
 */
const markProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** A cylinder seen side on, its bore at the left — the register's own mark. */
function MarkCylinder({ className }: { className?: string }) {
  return (
    <svg {...markProps} className={className}>
      <rect x="2.5" y="7" width="19" height="10" rx="1.5" />
      <ellipse cx="5" cy="12" rx="2.5" ry="5" />
      <path d="M9.5 8.5v7M12.5 8.5v7M15.5 8.5v7M18.5 8.5v7" />
    </svg>
  );
}

/** A ruled ledger page: the master list. */
function MarkLedger({ className }: { className?: string }) {
  return (
    <svg {...markProps} className={className}>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <path d="M8 3v18M11 8h6M11 12h6M11 16h4" />
    </svg>
  );
}

/** Tabbed dividers: browsing by maker and series. */
function MarkTabs({ className }: { className?: string }) {
  return (
    <svg {...markProps} className={className}>
      <path d="M3 7h6l1.6 2H21v11H3z" />
      <path d="M6 12.5h9M6 16h6" />
    </svg>
  );
}

/** A cabinet of drawers: the shelf actually owned. */
function MarkCabinet({ className }: { className?: string }) {
  return (
    <svg {...markProps} className={className}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="1" />
      <path d="M3.5 9h17M3.5 15h17M10.5 6.2h3M10.5 12h3M10.5 17.8h3" />
    </svg>
  );
}

/** A bar of figures: the dashboard. */
function MarkFigures({ className }: { className?: string }) {
  return (
    <svg {...markProps} className={className}>
      <path d="M3.5 20.5h17" />
      <path d="M7 20.5V11M12 20.5V5M17 20.5V14" />
    </svg>
  );
}

interface Section {
  to: string;
  label: string;
  short: string;
  Mark: (props: { className?: string }) => JSX.Element;
}

const SECTIONS: Section[] = [
  { to: '/catalog', label: 'The Register', short: 'Register', Mark: MarkLedger },
  { to: '/browse', label: 'Browse', short: 'Browse', Mark: MarkTabs },
  { to: '/collection', label: 'My Collection', short: 'Collection', Mark: MarkCabinet },
  { to: '/dashboard', label: 'Dashboard', short: 'Figures', Mark: MarkFigures },
];

// ------------------------------------------------------------------ layout

export function Layout({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [records, setRecords] = useState<number | null>(null);
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* Refusing to store is not worth failing the page over. */
    }
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', CHROME_COLOUR[theme]);
  }, [theme]);

  /* The colophon quotes the size of the register. The shell must print
     with or without the press, so a failure only removes the figure. */
  useEffect(() => {
    let live = true;
    api
      .health()
      .then((h) => { if (live) { setRecords(h.records); setReachable(true); } })
      .catch(() => { if (live) { setRecords(null); setReachable(false); } });
    return () => { live = false; };
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  const goingDark = theme === 'light';
  const targetName = goingDark ? 'Lamplight' : 'Daylight';

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to the page</a>

      <header className="site-head oak no-print">
        <div className="site-head__inner">
          <Link className="nameplate" to="/">
            <MarkCylinder className="nameplate__mark" />
            <span className="nameplate__text">
              <span className="nameplate__title masthead-type">Amberola</span>
              <span className="nameplate__sub">Cylinder Register</span>
            </span>
          </Link>

          <nav className="head-nav hide-mobile" aria-label="Sections">
            {SECTIONS.map(({ to, label }) => (
              <NavLink key={to} to={to} className="head-nav__link">
                {label}
              </NavLink>
            ))}
          </nav>

          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${targetName.toLowerCase()}`}
            title={`Switch to ${targetName.toLowerCase()}`}
          >
            <span className="theme-toggle__glyph" aria-hidden="true">{goingDark ? '☾' : '☀'}</span>
            <span className="theme-toggle__word">{targetName}</span>
          </button>
        </div>
      </header>

      <main id="main" className="shell__main">{children}</main>

      <footer className="colophon">
        <div className="colophon__inner">
          <div className="fleuron" aria-hidden="true"><span>❦</span></div>

          <p className="colophon__line">
            The Amberola Cylinder Register · A catalogue of four-minute records
          </p>

          <p className="colophon__count">
            {reachable
              ? records === null
                ? 'Counting the register…'
                : `${records.toLocaleString()} ${records === 1 ? 'title' : 'titles'} standing in the master list`
              : 'The press could not be reached — no count today'}
          </p>

          <ul className="colophon__links no-print">
            {SECTIONS.map(({ to, label }) => (
              <li key={to}><Link to={to}>{label}</Link></li>
            ))}
          </ul>

          <p className="colophon__note">
            Set in Cinzel, Playfair Display, Crimson Pro, Alegreya Sans and Special Elite,
            after the monthly supplements of 1912.
          </p>
        </div>
      </footer>

      <nav className="tabbar oak hide-desktop no-print" aria-label="Primary">
        {SECTIONS.map(({ to, short, Mark }) => (
          <NavLink key={to} to={to} className="tabbar__link">
            <Mark className="tabbar__glyph" />
            <span>{short}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export default Layout;

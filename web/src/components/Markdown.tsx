/**
 * A small Markdown renderer for the encyclopedia prose held in the database.
 *
 * It builds React elements directly and never uses dangerouslySetInnerHTML, so
 * catalog text — which is editable from the browser — cannot inject markup.
 *
 * Supported: headings, paragraphs, unordered and ordered lists, blockquotes,
 * horizontal rules, and inline emphasis, strong, code and links.
 */
import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;

/** Only http(s) and in-app paths become links; anything else renders as text. */
function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) return trimmed;
  return null;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let index = 0;

  for (const part of text.split(INLINE)) {
    if (!part) continue;
    const key = `${keyPrefix}-${index}`;
    index += 1;

    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) {
      out.push(<strong key={key}>{part.slice(2, -2)}</strong>);
    } else if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
      out.push(<em key={key}>{part.slice(1, -1)}</em>);
    } else if (part.startsWith('`') && part.endsWith('`')) {
      out.push(<code key={key}>{part.slice(1, -1)}</code>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
      if (link) {
        const href = safeHref(link[2]);
        if (!href) out.push(<Fragment key={key}>{link[1]}</Fragment>);
        else if (href.startsWith('/')) out.push(<Link key={key} to={href}>{link[1]}</Link>);
        else out.push(
          <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow">{link[1]}</a>,
        );
      } else {
        out.push(<Fragment key={key}>{part}</Fragment>);
      }
    }
  }
  return out;
}

export function Markdown({ text, className = 'prose', dropcap = false }:
  { text?: string | null; className?: string; dropcap?: boolean }) {
  if (!text || !text.trim()) return null;

  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  let paragraphCount = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i += 1; continue; }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(6, heading[1].length + 1); // article body starts at h2
      const Tag = `h${level}` as 'h2';
      blocks.push(<Tag key={i}>{renderInline(heading[2], `h${i}`)}</Tag>);
      i += 1;
      continue;
    }

    if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(line.trim())) {
      blocks.push(<hr key={i} />);
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(<blockquote key={`q${i}`}>{renderInline(quote.join(' '), `q${i}`)}</blockquote>);
      continue;
    }

    const bullet = /^\s*[-*+]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const pattern = ordered ? numbered : bullet;
      const items: string[] = [];
      while (i < lines.length && pattern.test(lines[i])) {
        items.push(lines[i].replace(pattern, ''));
        i += 1;
      }
      const ListTag = ordered ? 'ol' : 'ul';
      blocks.push(
        <ListTag key={`l${i}`}>
          {items.map((item, n) => <li key={n}>{renderInline(item, `l${i}-${n}`)}</li>)}
        </ListTag>,
      );
      continue;
    }

    // Anything else is a paragraph, running until a blank line.
    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>\s?)/.test(lines[i])
           && !bullet.test(lines[i]) && !numbered.test(lines[i])) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    paragraphCount += 1;
    blocks.push(
      <p key={`p${i}`} className={dropcap && paragraphCount === 1 ? 'dropcap' : undefined}>
        {renderInline(paragraph.join(' '), `p${i}`)}
      </p>,
    );
  }

  return <div className={className}>{blocks}</div>;
}

/** First paragraph, trimmed to `limit` characters — for list rows and cards. */
export function excerpt(text?: string | null, limit = 220): string {
  if (!text) return '';
  const first = text
    .replace(/\r\n/g, '\n')
    .split('\n\n')[0]
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`>]/g, '')
    .trim();
  if (first.length <= limit) return first;
  const cut = first.slice(0, limit);
  return cut.slice(0, cut.lastIndexOf(' ')) + '…';
}

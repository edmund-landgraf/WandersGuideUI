import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { gmNotesText, insertGmNoteStamp, notePageToMarkdown, sourceImportPages } from '@pages/character_sheet/panels/gm-notes';
import { useEffect, useRef, useState } from 'react';
import { getContentDataFromHref } from '@common/rich_text_input/ContentLinkExtension';
import { autoLinkConditions, isAonConditionHref, normalizeMarkdownTables, resolveAonHref, toStandard2eProse, toWgMarkdownLinks } from '@utils/foundry-text';
import { useContentLinks } from './phase1-content-links';

export function noteContentsToMarkdown(contents: unknown) {
  if (contents == null) return '';
  if (typeof contents === 'string') return contents.trim();
  return tiptapToMarkdown(contents).trim();
}

export function ProseMarkdown({ children, className = '' }: { children: string; className?: string }) {
  const { open } = useContentLinks();
  if (!children.trim()) return null;
  const prose = normalizeMarkdownTables(toWgMarkdownLinks(autoLinkConditions(toStandard2eProse(children))));
  return (
    <div className={`ability-prose text-sm leading-7 text-p1-text ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className='table-wrap'>
              <table>{children}</table>
            </div>
          ),
          a: ({ href, children }) => {
            const resolved = resolveAonHref(href);
            const content = getContentDataFromHref(resolved ?? href ?? '');
            const wgHref = content ? `link_${content.type}_${String(content.id).replace(/ /g, '~')}` : null;
            const isCondition = content?.type === 'condition' || isAonConditionHref(resolved) || !!wgHref?.startsWith('link_condition_');
            if (wgHref) {
              return (
                <button type='button' className={isCondition ? 'pf2e-condition' : 'pf2e-content-link'} onClick={() => open(wgHref)}>
                  {children}
                </button>
              );
            }
            if (resolved && /^https?:\/\//i.test(resolved)) {
              return (
                <a href={resolved} target='_blank' rel='noreferrer' className={isCondition ? 'pf2e-condition' : undefined}>
                  {children}
                </a>
              );
            }
            return (
              <a href={href} target='_blank' rel='noreferrer' className='text-p1-accent hover:underline'>
                {children}
              </a>
            );
          },
        }}
      >
        {prose}
      </ReactMarkdown>
    </div>
  );
}

export function NoteContentPanel({ title, contents }: { title?: string; contents: unknown }) {
  const markdown = noteContentsToMarkdown(contents);
  if (!markdown) return <p className='border border-p1-border bg-p1-surface p-4 text-xs text-p1-muted'>This note is empty.</p>;
  return (
    <section>
      {title && <h3 className='mb-3 text-xs font-semibold uppercase text-p1-muted'>{title}</h3>}
      <ProseMarkdown>{markdown}</ProseMarkdown>
    </section>
  );
}

export function EntityNotesPanel({
  notes,
  onSave,
}: {
  notes: { pages: Array<{ name: string; contents: unknown }> } | null | undefined;
  onSave?: (text: string) => void;
}) {
  const saved = gmNotesText(notes);
  const [draft, setDraft] = useState(saved);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(draft);
  const savedRef = useRef(saved);
  const onSaveRef = useRef(onSave);
  draftRef.current = draft;
  savedRef.current = saved;
  onSaveRef.current = onSave;
  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  useEffect(() => {
    if (!onSaveRef.current || draft === saved) return;
    const text = draft;
    const timer = window.setTimeout(() => onSaveRef.current?.(text), 1000);
    return () => window.clearTimeout(timer);
  }, [draft, saved]);

  useEffect(() => {
    return () => {
      const text = draftRef.current;
      const save = onSaveRef.current;
      if (save && text !== savedRef.current) save(text);
    };
  }, []);

  const insertStamp = () => {
    const cursor = textareaRef.current?.selectionStart ?? draft.length;
    const next = insertGmNoteStamp(draft, cursor);
    setDraft(next.text);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  if (!onSave) {
    if (!saved) return <p className='border border-p1-border bg-p1-surface p-4 text-xs text-p1-muted'>No GM notes yet.</p>;
    return <pre className='whitespace-pre-wrap border border-p1-border bg-p1-surface p-4 text-sm leading-6 text-p1-text'>{saved}</pre>;
  }

  return (
    <div className='flex min-h-[280px] flex-col gap-3'>
      <textarea
        ref={textareaRef}
        className='min-h-[220px] flex-1 resize-y border border-p1-border bg-p1-surface p-3 text-sm leading-6 text-p1-text outline-none placeholder:text-p1-faint focus:border-p1-accent/60'
        placeholder='Creature is burning for 3 rounds...'
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className='flex items-center justify-between gap-2'>
        <button
          type='button'
          className='h-8 border border-p1-border px-3 text-xs text-p1-muted hover:text-p1-text'
          onClick={insertStamp}
        >
          Date/Time
        </button>
        <div className='flex gap-2'>
          <button
            type='button'
            className='h-8 border border-p1-border px-3 text-xs text-p1-muted hover:text-p1-text disabled:opacity-40'
            onClick={() => setDraft('')}
            disabled={!draft}
          >
            Clear
          </button>
          <button
            type='button'
            className='h-8 bg-p1-accent px-3 text-xs font-semibold text-p1-accent-ink hover:bg-p1-accent-soft disabled:opacity-40'
            onClick={() => onSave(draft)}
            disabled={draft === saved}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export function SourceImportNotesPanel({ notes }: { notes: { pages: Array<{ name: string; contents: unknown }> } | null | undefined }) {
  const pages = sourceImportPages(notes).filter((page) => notePageToMarkdown(page.contents));
  if (!pages.length) return <p className='border border-p1-border bg-p1-surface p-4 text-xs text-p1-muted'>No source import info.</p>;
  return (
    <div className='space-y-3'>
      {pages.map((page, index) => (
        <section key={`${page.name ?? 'source'}-${index}`} className='border border-p1-border bg-p1-surface p-4'>
          {pages.length > 1 && page.name && <h3 className='mb-3 text-xs font-semibold uppercase text-p1-muted'>{page.name}</h3>}
          <ProseMarkdown>{notePageToMarkdown(page.contents)}</ProseMarkdown>
        </section>
      ))}
    </div>
  );
}

function tiptapToMarkdown(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node !== 'object') return '';
  const item = node as {
    type?: string;
    text?: string;
    marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
    content?: unknown[];
    attrs?: Record<string, unknown>;
  };
  const inner = (item.content ?? []).map(tiptapToMarkdown).join('');
  let text = item.text ?? '';
  for (const mark of item.marks ?? []) {
    if (mark.type === 'bold' || mark.type === 'strong') text = `**${text}**`;
    else if (mark.type === 'italic' || mark.type === 'em') text = `*${text}*`;
    else if (mark.type === 'code') text = `\`${text}\``;
    else if (mark.type === 'strike' || mark.type === 'strikeThrough') text = `~~${text}~~`;
    else if (mark.type === 'link') text = `[${text}](${String(mark.attrs?.href ?? '')})`;
  }
  switch (item.type) {
    case 'doc':
      return inner;
    case 'text':
      return text;
    case 'paragraph':
      return `${inner}\n\n`;
    case 'heading':
      return `${'#'.repeat(clamp(Number(item.attrs?.level) || 1, 1, 6))} ${inner.trim()}\n\n`;
    case 'bulletList':
      return `${inner}\n`;
    case 'orderedList':
      return `${inner}\n`;
    case 'listItem':
      return `- ${inner.replace(/\n+/g, ' ').trim()}\n`;
    case 'blockquote':
      return `${inner.split('\n').filter(Boolean).map((line) => `> ${line}`).join('\n')}\n\n`;
    case 'codeBlock':
      return `\`\`\`\n${inner}\n\`\`\`\n\n`;
    case 'hardBreak':
      return '  \n';
    case 'horizontalRule':
      return '\n---\n\n';
    case 'table':
      return tableToMarkdown(item.content ?? []);
    default:
      return inner || text;
  }
}

function tableToMarkdown(rows: unknown[]) {
  const parsed = rows
    .map((row) => {
      if (!row || typeof row !== 'object') return [];
      const cells = ((row as { content?: unknown[] }).content ?? [])
        .map((cell) => tiptapToMarkdown(cell).replace(/\n+/g, ' ').trim());
      return cells;
    })
    .filter((row) => row.length > 0);
  if (!parsed.length) return '';
  const header = parsed[0];
  const divider = header.map(() => '---');
  const body = parsed.slice(1);
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${divider.join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ];
  return `${lines.join('\n')}\n\n`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

import { GUIDE_BLUE } from '@constants/data';
import { LivingEntity } from '@schemas/content';
import { JSONContent } from '@tiptap/react';

type NotePage = {
  name?: string;
  icon?: string;
  color?: string;
  shared?: boolean;
  contents?: unknown;
};

function isGmNotesPage(name?: string) {
  return (name ?? '').trim().toLowerCase() === 'gm notes';
}

export function sourceImportPages(notes: { pages?: NotePage[] } | null | undefined): NotePage[] {
  return (notes?.pages ?? []).filter((page) => !isGmNotesPage(page.name));
}

export function gmNotesText(notes: { pages?: NotePage[] } | null | undefined): string {
  const pages = (notes?.pages ?? []).filter((page) => isGmNotesPage(page.name));
  if (pages.length === 0) return '';
  return pages
    .map((page) => notePageToMarkdown(page.contents).trim())
    .filter(Boolean)
    .join('\n\n');
}

export function toGmNotes(text: string, existing?: LivingEntity['notes'] | null): NonNullable<LivingEntity['notes']> {
  const sourcePages = sourceImportPages(existing).map((page) => ({
    name: page.name || 'Notes',
    icon: page.icon || 'notebook',
    color: page.color || GUIDE_BLUE,
    shared: page.shared,
    contents: page.contents,
  }));
  const trimmed = text.trim();
  return {
    pages: [
      ...(trimmed
        ? [
            {
              name: 'GM Notes',
              icon: 'notebook',
              color: GUIDE_BLUE,
              contents: text,
            },
          ]
        : []),
      ...sourcePages,
    ],
  };
}

export function notePageToMarkdown(contents: unknown): string {
  if (contents == null) return '';
  const raw = typeof contents === 'string' ? contents.trim() : tiptapPlainMarkdown(contents);
  return autolinkUrls(raw);
}

function autolinkUrls(text: string) {
  return text.replace(/(^|\s)(https?:\/\/[^\s)]+)/g, '$1[$2]($2)');
}

function tiptapPlainMarkdown(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node !== 'object') return '';
  const item = node as JSONContent & { marks?: Array<{ type: string; attrs?: Record<string, unknown> }> };
  const inner = (item.content ?? []).map(tiptapPlainMarkdown).join('');
  let text = item.text ?? '';
  for (const mark of item.marks ?? []) {
    if (mark.type === 'bold' || mark.type === 'strong') text = `**${text}**`;
    else if (mark.type === 'italic' || mark.type === 'em') text = `*${text}*`;
    else if (mark.type === 'link') text = `[${text}](${String(mark.attrs?.href ?? '')})`;
  }
  if (item.type === 'paragraph') return `${inner}\n\n`;
  if (item.type === 'heading') return `### ${inner.trim()}\n\n`;
  if (item.type === 'hardBreak') return '\n';
  return inner || text;
}

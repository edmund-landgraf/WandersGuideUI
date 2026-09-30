import { fetchContentAll, fetchContentSources } from '@content/content-store';
import { buildHrefFromContentData } from '@content/hardcoded-links';
import { getAllConditions } from '@conditions/condition-handler';
import { COMMON_CORE_ID } from '@constants/data';
import type { AbilityBlockType, ContentType } from '@schemas/content';
import { upsertLink } from '@platejs/link';
import { useQuery } from '@tanstack/react-query';
import { uniq } from 'lodash-es';
import { Link2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PlateEditor } from 'platejs/react';
import { isContentStackOpen } from './phase1-content-links';
import { BooksPanel } from './phase1-builder-settings';
import { Phase1PickerModal } from './phase1-picker-modal';

type NoteLinkMode = 'href' | 'wg';

type LinkTab = {
  id: string;
  label: string;
  contentType?: ContentType;
  abilityBlockType?: AbilityBlockType;
};

const LINK_TAB_GROUPS: { id: string; label: string; tabs: LinkTab[] }[] = [
  { id: 'books', label: 'Books', tabs: [{ id: 'books', label: 'Books' }] },
  {
    id: 'class',
    label: 'Class',
    tabs: [
      { id: 'class', label: 'Class', contentType: 'class' },
      { id: 'class-feature', label: 'Class Feature', contentType: 'ability-block', abilityBlockType: 'class-feature' },
    ],
  },
  {
    id: 'ancestry',
    label: 'Ancestry',
    tabs: [
      { id: 'ancestry', label: 'Ancestry', contentType: 'ancestry' },
      { id: 'heritage', label: 'Heritage', contentType: 'ability-block', abilityBlockType: 'heritage' },
    ],
  },
  {
    id: 'character',
    label: 'Character',
    tabs: [
      { id: 'action', label: 'Action', contentType: 'ability-block', abilityBlockType: 'action' },
      { id: 'background', label: 'Background', contentType: 'background' },
      { id: 'feat', label: 'Feat', contentType: 'ability-block', abilityBlockType: 'feat' },
      { id: 'language', label: 'Language', contentType: 'language' },
      { id: 'physical-feature', label: 'Physical Feature', contentType: 'ability-block', abilityBlockType: 'physical-feature' },
      { id: 'sense', label: 'Sense', contentType: 'ability-block', abilityBlockType: 'sense' },
      { id: 'spell', label: 'Spell', contentType: 'spell' },
    ],
  },
  {
    id: 'rules',
    label: 'Rules',
    tabs: [
      { id: 'condition', label: 'Condition' },
      { id: 'creature', label: 'Creatures', contentType: 'creature' },
      { id: 'item', label: 'Item', contentType: 'item' },
      { id: 'trait', label: 'Trait', contentType: 'trait' },
    ],
  },
];

const LINK_TABS = LINK_TAB_GROUPS.flatMap((group) => group.tabs);

type PickedLink = { key: string; name: string; href: string; summary: string; meta: string };

export function insertNoteLink(editor: PlateEditor, url: string, label: string) {
  const text = label.trim();
  if (!text || !editor.selection) return;
  editor.tf.collapse({ edge: 'end' });
  editor.tf.insertText(text);
  const point = editor.selection?.anchor;
  if (point) {
    editor.tf.select({
      anchor: { path: point.path, offset: Math.max(0, point.offset - text.length) },
      focus: point,
    });
  }
  upsertLink(editor, { url, skipValidation: true });
  editor.tf.collapse({ edge: 'end' });
  const link = editor.api.above({
    match: (node) => {
      const type = (node as { type?: string }).type;
      return type === 'a' || type === 'link';
    },
  });
  if (!link) return;
  const [, path] = link;
  const after = editor.api.after(path);
  if (after) editor.tf.select(after);
  else editor.tf.insertNodes({ text: '' }, { at: [...path.slice(0, -1), path[path.length - 1] + 1], select: true });
}

const WG_BOOKS_KEY = 'phase1-wg-link-books';

function readStoredBooks(): number[] | null {
  try {
    const raw = window.localStorage.getItem(WG_BOOKS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'number')) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function NoteLinkButton({ editor }: { editor: PlateEditor }) {
  const [mode, setMode] = useState<NoteLinkMode | null>(null);
  const [selection, setSelection] = useState<PlateEditor['selection']>(null);

  function rememberSelection() {
    if (!editor.selection) {
      const end = editor.api.end([]);
      if (end) editor.tf.select(end);
    }
    setSelection(editor.selection ? structuredClone(editor.selection) : null);
  }

  function openHref() {
    rememberSelection();
    setMode('href');
  }

  function insert(url: string, label: string, stayOpen = false) {
    const text = label.trim();
    if (!text) return;
    if (selection) editor.tf.select(selection);
    else if (!editor.selection) {
      const end = editor.api.end([]);
      if (end) editor.tf.select(end);
    }
    if (!editor.selection) return;
    insertNoteLink(editor, url, text);
    if (stayOpen) editor.tf.insertText('  ');
    const caret = editor.selection ? structuredClone(editor.selection) : null;
    setSelection(caret);
    if (!stayOpen) setMode(null);
    requestAnimationFrame(() => {
      if (caret) editor.tf.select(caret);
      editor.tf.focus();
    });
  }

  return (
    <>
      <button
        type='button'
        aria-label='Link'
        title='Link'
        aria-pressed={mode !== null}
        className={`grid h-8 w-8 place-items-center text-p1-muted hover:bg-p1-hover hover:text-p1-text ${mode ? 'bg-p1-hover text-p1-accent-soft' : ''}`}
        onMouseDown={(event) => {
          event.preventDefault();
          openHref();
        }}
      >
        <Link2 size={14} />
      </button>
      {mode === 'href' && (
        <HrefLinkModal
          onClose={() => setMode(null)}
          onSwitch={() => setMode('wg')}
          onApply={(url, label) => insert(url, label)}
        />
      )}
      {mode === 'wg' && (
        <WgLinkModal
          onClose={() => setMode(null)}
          onSwitch={() => setMode('href')}
          onPick={(item) => insert(item.href, item.name, true)}
        />
      )}
    </>
  );
}

function HrefLinkModal({
  onClose,
  onSwitch,
  onApply,
}: {
  onClose: () => void;
  onSwitch: () => void;
  onApply: (url: string, label: string) => void;
}) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');

  return createPortal(
    <div
      className='fixed inset-0 z-[100] grid place-items-center bg-black/75 p-5'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isContentStackOpen()) onClose();
      }}
    >
      <form
        role='dialog'
        aria-modal='true'
        aria-labelledby='note-href-title'
        className='w-full max-w-sm border border-p1-border bg-p1-surface shadow-2xl'
        onSubmit={(event) => {
          event.preventDefault();
          if (!url.trim() || !label.trim()) return;
          onApply(url.trim(), label.trim());
        }}
      >
        <header className='flex items-center gap-3 border-b border-p1-border px-4 py-3'>
          <h2 id='note-href-title' className='min-w-0 flex-1 text-lg font-semibold'>
            Link
          </h2>
          <button type='button' className='toolbar-button shrink-0' onClick={onSwitch}>
            Wanderer&apos;s Guide
          </button>
          <button type='button' className='icon-button shrink-0' onClick={onClose} title='Close'>
            <X size={18} />
          </button>
        </header>
        <div className='space-y-3 p-4'>
          <label className='block text-xs text-p1-muted'>
            Text
            <input
              className='mt-1 h-9 w-full border border-p1-border bg-p1-inset px-2 text-sm text-p1-text outline-none focus:border-p1-accent/60'
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <label className='block text-xs text-p1-muted'>
            URL
            <input
              autoFocus
              className='mt-1 h-9 w-full border border-p1-border bg-p1-inset px-2 text-sm text-p1-text outline-none focus:border-p1-accent/60'
              placeholder='https://…'
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <button type='submit' className='h-9 w-full bg-p1-accent text-xs font-semibold text-p1-accent-ink'>
            Apply
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

function WgLinkModal({
  onClose,
  onSwitch,
  onPick,
}: {
  onClose: () => void;
  onSwitch: () => void;
  onPick: (item: PickedLink) => void;
}) {
  const [tabId, setTabId] = useState('action');
  const [picked, setPicked] = useState<PickedLink | null>(null);
  const [enabledBooks, setEnabledBooks] = useState<number[] | null>(readStoredBooks);
  const tab = LINK_TABS.find((item) => item.id === tabId) ?? LINK_TABS.find((item) => item.id === 'action') ?? LINK_TABS[0];
  const books = useQuery({
    queryKey: ['phase1-note-link-books'],
    queryFn: async () => (await fetchContentSources('ALL-OFFICIAL-PUBLIC')).filter((book) => book.deprecated !== true),
  });
  useEffect(() => {
    if (enabledBooks || !books.data) return;
    setEnabledBooks(books.data.filter((book) => book.group === 'pathfinder-core').map((book) => book.id));
  }, [books.data, enabledBooks]);
  useEffect(() => {
    if (!enabledBooks) return;
    window.localStorage.setItem(WG_BOOKS_KEY, JSON.stringify(enabledBooks));
  }, [enabledBooks]);
  const sourceIds = useMemo(
    () => uniq([COMMON_CORE_ID, ...(enabledBooks ?? [])]).sort((a, b) => a - b),
    [enabledBooks]
  );
  const catalog = useQuery({
    queryKey: ['phase1-note-link', tab.id, sourceIds.join(',')],
    queryFn: async () => {
      if (!tab.contentType) return [];
      const all = await fetchContentAll<{ id: number; name: string; type?: AbilityBlockType }>(tab.contentType, sourceIds);
      return all.filter((item) => !tab.abilityBlockType || item.type === tab.abilityBlockType);
    },
    enabled: Boolean(tab.contentType) && enabledBooks !== null,
  });

  const items = useMemo(() => {
    if (tab.id === 'condition') {
      return getAllConditions()
        .map((condition) => ({
          key: condition.name,
          name: condition.name,
          href: `link_condition_${condition.name.toLowerCase().replace(/ /g, '~')}`,
          summary: previewText(condition.description),
          meta: 'Condition',
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return [...(catalog.data ?? [])]
      .map((item) => ({
        key: String(item.id),
        name: item.name,
        href: buildHrefFromContentData(tab.abilityBlockType ?? tab.contentType ?? 'trait', item.id),
        summary: previewText(itemDescription(item)),
        meta: previewMeta(item, tab.label),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [catalog.data, tab]);

  return (
    <Phase1PickerModal
      title="Wanderer's Guide"
      titleId='note-wg-link-title'
      searchPlaceholder='Search'
      maxWidthClass='max-w-3xl'
      overlayClass='z-[100]'
      items={items}
      getName={(item) => item.name}
      getKey={(item) => item.key}
      loading={Boolean(tab.contentType) && (enabledBooks === null || catalog.isLoading)}
      error={catalog.isError ? 'Could not load content.' : null}
      empty='No matching content.'
      onClose={onClose}
      panel={
        tab.id === 'books' ? (
          <div className='min-h-0 flex-1 overflow-y-auto'>
            <BooksPanel
              books={books.data ?? []}
              loading={books.isLoading}
              enabled={enabledBooks ?? []}
              onToggle={(id, next) =>
                setEnabledBooks((current) => {
                  const ids = current ?? [];
                  return next ? uniq([...ids, id]) : ids.filter((bookId) => bookId !== id);
                })
              }
              onEnableAll={(ids) => setEnabledBooks((current) => uniq([...(current ?? []), ...ids]))}
              onUncheckAll={(ids) => setEnabledBooks((current) => (current ?? []).filter((id) => !ids.includes(id)))}
            />
          </div>
        ) : undefined
      }
      headerAction={
        <button type='button' className='toolbar-button shrink-0' onClick={onSwitch}>
          Web link
        </button>
      }
      footer={
        tab.id === 'books' ? undefined : (
          <div className='flex items-center justify-end gap-2 border-t border-p1-border px-3 py-2'>
            <span className='mr-auto min-w-0 truncate text-xs text-p1-muted'>{picked ? picked.name : 'Select content'}</span>
            <button
              type='button'
              className='h-8 bg-p1-accent px-3 text-xs font-semibold text-p1-accent-ink disabled:opacity-40'
              disabled={!picked}
              onClick={() => {
                if (!picked) return;
                onPick(picked);
                setPicked(null);
              }}
            >
              Add
            </button>
            <button type='button' className='toolbar-button h-8 shrink-0' onClick={onClose}>
              Close
            </button>
          </div>
        )
      }
      tabs={
        <div className='flex flex-wrap items-stretch gap-x-2 gap-y-1 border-b border-p1-border px-3 py-2' role='tablist' aria-label='Content category'>
          {LINK_TAB_GROUPS.map((group, index) => (
            <div key={group.id} className='flex items-stretch gap-2'>
              {index > 0 && <span className='w-px self-stretch bg-p1-border' aria-hidden='true' />}
              <div className='flex flex-wrap gap-1' role='group' aria-label={group.label}>
                {group.tabs.map((item) => (
                  <button
                    key={item.id}
                    type='button'
                    role='tab'
                    aria-selected={item.id === tab.id}
                    className={`px-2 py-1 text-[11px] font-semibold ${item.id === tab.id ? 'bg-p1-accent text-p1-accent-ink' : 'text-p1-muted hover:bg-p1-hover hover:text-p1-text'}`}
                    onClick={() => {
                      setTabId(item.id);
                      setPicked(null);
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      }
      renderItem={(item) => (
        <PickerChoice item={item} selected={picked?.key === item.key} onSelect={() => setPicked(item)} />
      )}
    />
  );
}

function PickerChoice({ item, selected, onSelect }: { item: PickedLink; selected: boolean; onSelect: () => void }) {
  const rowRef = useRef<HTMLButtonElement>(null);
  const showTimer = useRef(0);
  const hideTimer = useRef(0);
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null);

  const clearTimers = () => {
    window.clearTimeout(showTimer.current);
    window.clearTimeout(hideTimer.current);
  };
  const place = () => {
    const row = rowRef.current;
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const width = 280;
    const gap = 8;
    const fitsRight = window.innerWidth - rect.right > width + gap;
    const left = fitsRight ? rect.right + gap : Math.max(8, rect.left - width - gap);
    const top = Math.min(Math.max(8, rect.top), window.innerHeight - 168);
    setBox({ left, top, width });
  };
  useEffect(() => () => clearTimers(), []);

  return (
    <>
      <button
        ref={rowRef}
        type='button'
        aria-pressed={selected}
        className={`block w-full border-b border-p1-border px-3 py-2 text-left text-sm hover:bg-p1-hover ${selected ? 'bg-p1-hover text-p1-accent-soft' : ''}`}
        onClick={onSelect}
        onMouseEnter={() => {
          clearTimers();
          showTimer.current = window.setTimeout(place, 280);
        }}
        onMouseLeave={() => {
          clearTimers();
          hideTimer.current = window.setTimeout(() => setBox(null), 80);
        }}
        onFocus={() => {
          clearTimers();
          place();
        }}
        onBlur={() => setBox(null)}
      >
        {item.name}
      </button>
      {box &&
        createPortal(
          <span
            className='pointer-events-none hidden max-h-40 overflow-hidden border border-p1-border bg-p1-surface p-3 shadow-xl md:block'
            style={{ position: 'fixed', zIndex: 120, left: box.left, top: box.top, width: box.width }}
          >
            <span className='block truncate text-xs font-semibold text-p1-text'>{item.name}</span>
            {item.meta && <span className='mt-1 block truncate text-[10px] uppercase tracking-wide text-p1-muted'>{item.meta}</span>}
            <span className='mt-2 block text-[11px] leading-4 text-p1-muted'>
              {item.summary || 'No description given.'}
            </span>
          </span>,
          document.body
        )}
    </>
  );
}

function previewText(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const text = value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 220 ? `${text.slice(0, 220)}...` : text;
}

function recordText(record: object, key: string) {
  const value = (record as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

function itemDescription(record: object) {
  const direct = recordText(record, 'description');
  if (direct) return direct;
  const details = (record as Record<string, unknown>).details;
  if (details && typeof details === 'object') return recordText(details, 'description');
  return '';
}

function previewMeta(record: object, fallback: string) {
  const data = record as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof data.rank === 'number') parts.push(data.rank === 0 ? 'Cantrip' : `Rank ${data.rank}`);
  if (typeof data.level === 'number') parts.push(`Level ${data.level}`);
  if (typeof data.rarity === 'string' && data.rarity && data.rarity !== 'COMMON') parts.push(data.rarity.replaceAll('_', ' '));
  if (Array.isArray(data.traditions) && data.traditions.every((entry) => typeof entry === 'string')) {
    parts.push(data.traditions.join(', '));
  }
  if (parts.length === 0) parts.push(fallback);
  return parts.join(' · ');
}

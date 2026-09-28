import { fetchContentAll, getDefaultSources, getDefaultSourcesKey } from '@content/content-store';
import { buildHrefFromContentData } from '@content/hardcoded-links';
import { getAllConditions } from '@conditions/condition-handler';
import type { AbilityBlockType, ContentType } from '@schemas/content';
import { upsertLink } from '@platejs/link';
import { useQuery } from '@tanstack/react-query';
import { Link2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PlateEditor } from 'platejs/react';
import { isContentStackOpen } from './phase1-content-links';
import { Phase1PickerModal } from './phase1-picker-modal';

type NoteLinkMode = 'href' | 'wg';

type LinkTab = {
  id: string;
  label: string;
  contentType?: ContentType;
  abilityBlockType?: AbilityBlockType;
};

const LINK_TABS: LinkTab[] = [
  { id: 'action', label: 'Action', contentType: 'ability-block', abilityBlockType: 'action' },
  { id: 'feat', label: 'Feat', contentType: 'ability-block', abilityBlockType: 'feat' },
  { id: 'trait', label: 'Trait', contentType: 'trait' },
  { id: 'item', label: 'Item', contentType: 'item' },
  { id: 'spell', label: 'Spell', contentType: 'spell' },
  { id: 'language', label: 'Language', contentType: 'language' },
  { id: 'sense', label: 'Sense', contentType: 'ability-block', abilityBlockType: 'sense' },
  { id: 'physical-feature', label: 'Physical Feature', contentType: 'ability-block', abilityBlockType: 'physical-feature' },
  { id: 'class', label: 'Class', contentType: 'class' },
  { id: 'class-feature', label: 'Class Feature', contentType: 'ability-block', abilityBlockType: 'class-feature' },
  { id: 'ancestry', label: 'Ancestry', contentType: 'ancestry' },
  { id: 'heritage', label: 'Heritage', contentType: 'ability-block', abilityBlockType: 'heritage' },
  { id: 'background', label: 'Background', contentType: 'background' },
  { id: 'condition', label: 'Condition' },
];

type PickedLink = { key: string; name: string; href: string };

export function NoteLinkButton({ editor }: { editor: PlateEditor }) {
  const [mode, setMode] = useState<NoteLinkMode | null>(null);
  const [selection, setSelection] = useState<PlateEditor['selection']>(null);

  function openHref() {
    setSelection(editor.selection ? structuredClone(editor.selection) : null);
    setMode('href');
  }

  function insert(url: string, label: string) {
    const text = label.trim();
    if (!text) return;
    if (selection) editor.tf.select(selection);
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
    setMode(null);
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
          onPick={(item) => insert(item.href, item.name)}
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
  const [tabId, setTabId] = useState(LINK_TABS[0].id);
  const tab = LINK_TABS.find((item) => item.id === tabId) ?? LINK_TABS[0];
  const catalog = useQuery({
    queryKey: ['phase1-note-link', tab.id, getDefaultSourcesKey('PAGE')],
    queryFn: async () => {
      if (!tab.contentType) return [];
      const all = await fetchContentAll<{ id: number; name: string; type?: AbilityBlockType }>(tab.contentType, getDefaultSources('PAGE'));
      return all.filter((item) => !tab.abilityBlockType || item.type === tab.abilityBlockType);
    },
    enabled: Boolean(tab.contentType),
  });

  const items = useMemo(() => {
    if (tab.id === 'condition') {
      return getAllConditions()
        .map((condition) => ({
          key: condition.name,
          name: condition.name,
          href: `link_condition_${condition.name.toLowerCase().replace(/ /g, '~')}`,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return [...(catalog.data ?? [])]
      .map((item) => ({
        key: String(item.id),
        name: item.name,
        href: buildHrefFromContentData(tab.abilityBlockType ?? tab.contentType ?? 'trait', item.id),
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
      loading={Boolean(tab.contentType) && catalog.isLoading}
      error={catalog.isError ? 'Could not load content.' : null}
      empty='No matching content.'
      onClose={onClose}
      headerAction={
        <button type='button' className='toolbar-button shrink-0' onClick={onSwitch}>
          Web link
        </button>
      }
      tabs={
        <div className='flex flex-wrap gap-1 border-b border-p1-border px-3 py-2' role='tablist' aria-label='Content category'>
          {LINK_TABS.map((item) => (
            <button
              key={item.id}
              type='button'
              role='tab'
              aria-selected={item.id === tab.id}
              className={`px-2 py-1 text-[11px] font-semibold ${item.id === tab.id ? 'bg-p1-accent text-p1-accent-ink' : 'text-p1-muted hover:bg-p1-hover hover:text-p1-text'}`}
              onClick={() => setTabId(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      }
      renderItem={(item) => (
        <button
          type='button'
          className='block w-full border-b border-p1-border px-3 py-2 text-left text-sm hover:bg-p1-hover'
          onClick={() => onPick(item)}
        >
          {item.name}
        </button>
      )}
    />
  );
}

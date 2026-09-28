import { ActionSymbol } from '@common/Actions';
import { FontBackgroundColorPlugin, FontColorPlugin } from '@platejs/basic-styles/react';
import {
  BlockquotePlugin,
  BoldPlugin,
  H2Plugin,
  H3Plugin,
  H4Plugin,
  HighlightPlugin,
  HorizontalRulePlugin,
  ItalicPlugin,
  UnderlinePlugin,
} from '@platejs/basic-nodes/react';
import { CommentPlugin } from '@platejs/comment/react';
import { DndPlugin, useDraggable } from '@platejs/dnd';
import { EmojiPlugin } from '@platejs/emoji/react';
import { unwrapLink } from '@platejs/link';
import { LinkPlugin, useLink } from '@platejs/link/react';
import {
  BulletedListPlugin,
  ListItemPlugin,
  ListPlugin,
  NumberedListPlugin,
} from '@platejs/list-classic/react';
import { MarkdownPlugin } from '@platejs/markdown';
import { TocPlugin, useTocElement, useTocElementState } from '@platejs/toc/react';
import type { ActionCost } from '@schemas/content';
import { getContentDataFromHref } from '@common/rich_text_input/ContentLinkExtension';
import { toWgMarkdownLinks } from '@utils/foundry-text';
import type { TElement, TLinkElement } from 'platejs';
import { createSlatePlugin } from 'platejs';
import {
  Plate,
  PlateContent,
  PlateElement,
  PlateLeaf,
  createPlateEditor,
  useEditorRef,
  useEditorSelector,
  usePlateEditor,
  type PlateElementProps,
  type PlateEditor,
  type PlateLeafProps,
} from 'platejs/react';
import {
  Bold,
  GripVertical,
  Heading2,
  Heading3,
  Heading4,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  ListTree,
  MessageSquare,
  Minus,
  Palette,
  Quote,
  Smile,
  Underline,
  Unlink,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NoteLinkButton } from './phase1-note-links';
import { useContentLinks } from './phase1-content-links';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';

const TOC_MARK = '[[toc]]';
const tocNode = { type: 'toc', children: [{ text: '' }] };
const emptyDoc = [{ type: 'p', children: [{ text: '' }] }];

const NOTE_COLORS = [
  '#868e96',
  '#fa5252',
  '#e64980',
  '#be4bdb',
  '#7950f2',
  '#4c6ef5',
  '#228be6',
  '#15aabf',
  '#12b886',
  '#40c057',
  '#82c91e',
  '#fab005',
  '#fd7e14',
];

const ACTION_BY_SYMBOL: Record<string, ActionCost> = {
  '1': 'ONE-ACTION',
  '2': 'TWO-ACTIONS',
  '3': 'THREE-ACTIONS',
  '4': 'FREE-ACTION',
  '5': 'REACTION',
};

function actionSymbolNode(cost: ActionCost, symbol: string) {
  return { type: 'actionSymbol', cost, symbol, children: [{ text: '' }] };
}

function liftActionSymbols(nodes: Array<TElement | { text?: string; code?: boolean; children?: unknown[] }>): typeof emptyDoc {
  return nodes.map((node) => {
    if ('text' in node && node.code && typeof node.text === 'string') {
      const match = /^action_symbol_([1-5])$/.exec(node.text);
      if (match) return actionSymbolNode(ACTION_BY_SYMBOL[match[1]], match[1]);
    }
    if ('children' in node && Array.isArray(node.children)) {
      return { ...node, children: liftActionSymbols(node.children as typeof nodes) };
    }
    return node;
  }) as typeof emptyDoc;
}

function ActionSymbolElement(props: PlateElementProps) {
  const element = props.element as { cost?: ActionCost; symbol?: string };
  const cost = element.cost ?? ACTION_BY_SYMBOL[element.symbol ?? ''] ?? 'ONE-ACTION';
  return (
    <PlateElement {...props} as='span' className='relative mx-0.5 inline-flex align-text-bottom text-p1-text'>
      <span contentEditable={false}>
        <ActionSymbol cost={cost} size='14px' />
      </span>
      <span className='pointer-events-none absolute h-px w-px overflow-hidden'>{props.children}</span>
    </PlateElement>
  );
}

const ActionSymbolPlugin = createSlatePlugin({
  key: 'actionSymbol',
  node: { isElement: true, isInline: true, isVoid: true, component: ActionSymbolElement },
});

const ACTION_COSTS: Array<{ cost: ActionCost; symbol: '1' | '2' | '3' | '4' | '5' }> = [
  { cost: 'ONE-ACTION', symbol: '1' },
  { cost: 'TWO-ACTIONS', symbol: '2' },
  { cost: 'THREE-ACTIONS', symbol: '3' },
  { cost: 'FREE-ACTION', symbol: '4' },
  { cost: 'REACTION', symbol: '5' },
];

const EMOJIS = ['😀', '😁', '😂', '😊', '😍', '😎', '🤔', '😴', '😭', '😡', '👍', '👎', '👏', '🙏', '🔥', '✨', '⭐', '❤️', '💀', '🎲', '⚔️', '🛡️', '🪄', '📜', '🗺️', '🐺', '🐉', '🧙', '🧝', '💀'];

type EditorTf = PlateEditor & { getTransforms: (plugin: unknown) => Record<string, { toggle?: () => void; addMark?: (value: string) => void; setDraft?: () => void }> };

function ensureSelection(editor: PlateEditor) {
  if (editor.selection) return;
  const end = editor.api.end([]);
  if (end) editor.tf.select(end);
}

function keepCaret(editor: PlateEditor, edit?: () => void) {
  ensureSelection(editor);
  edit?.();
  const caret = editor.selection ? structuredClone(editor.selection) : null;
  requestAnimationFrame(() => {
    if (caret) {
      try {
        editor.tf.select(caret);
      } catch {
        const end = editor.api.end([]);
        if (end) editor.tf.select(end);
      }
    }
    editor.tf.focus();
  });
}

function toggle(editor: PlateEditor, plugin: unknown, key: string) {
  keepCaret(editor, () => {
    (editor as EditorTf).getTransforms(plugin)[key]?.toggle?.();
  });
}

function addMark(editor: PlateEditor, key: 'backgroundColor' | 'color', value: string) {
  keepCaret(editor, () => {
    editor.tf.addMarks({ [key]: value });
  });
}

function ColorLeaf(props: PlateLeafProps) {
  const leaf = props.leaf as { color?: string };
  return <PlateLeaf {...props} style={{ color: leaf.color }} />;
}

function BackgroundLeaf(props: PlateLeafProps) {
  const leaf = props.leaf as { backgroundColor?: string };
  return <PlateLeaf {...props} style={{ backgroundColor: leaf.backgroundColor }} />;
}

function DraggableElement({
  as,
  className,
  ...props
}: PlateElementProps & { as: 'blockquote' | 'h2' | 'h3' | 'h4' | 'hr' | 'li' | 'ol' | 'p' | 'ul'; className?: string }) {
  const { handleRef, isDragging } = useDraggable({ element: props.element });
  return (
    <PlateElement as={as} className={`group relative ${className ?? ''} ${isDragging ? 'opacity-40' : ''}`} {...props}>
      <button
        type='button'
        ref={handleRef}
        contentEditable={false}
        aria-label='Drag block'
        className='absolute -left-5 top-1 hidden text-p1-faint hover:text-p1-text group-hover:block'
      >
        <GripVertical size={14} />
      </button>
      {props.children}
    </PlateElement>
  );
}

function TocElement(props: PlateElementProps) {
  const editor = useEditorRef();
  const headings = useEditorSelector((current) => {
    return current.children.flatMap((node, index) => {
      const type = (node as { type?: string }).type;
      if (type !== 'h2' && type !== 'h3' && type !== 'h4') return [];
      const title = current.api.string(node).trim();
      return [{ index, type, title: title || 'Heading' }];
    });
  }, []);

  return (
    <PlateElement {...props} className='my-2 border border-p1-border bg-p1-inset px-3 py-2'>
      <div contentEditable={false}>
        <p className='mb-1 text-[10px] font-semibold uppercase text-p1-muted'>Contents</p>
        {!headings.length && <p className='text-xs text-p1-faint'>Headings you add will show up here.</p>}
        {headings.map((item) => (
          <button
            key={item.index}
            type='button'
            className={`block w-full truncate py-0.5 text-left text-xs text-p1-muted hover:text-p1-text ${item.type === 'h3' ? 'pl-3' : ''} ${item.type === 'h4' ? 'pl-6' : ''}`}
            onClick={() => {
              const dom = editor.api.toDOMNode(editor.children[item.index]);
              dom?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          >
            {item.title}
          </button>
        ))}
      </div>
      <div className='hidden'>{props.children}</div>
    </PlateElement>
  );
}

function PElement(props: PlateElementProps) {
  return <DraggableElement as='p' className='my-1 min-h-[1.5em]' {...props} />;
}
function H2Element(props: PlateElementProps) {
  return <DraggableElement as='h2' className='mb-2 text-base font-semibold text-p1-text' {...props} />;
}
function H3Element(props: PlateElementProps) {
  return <DraggableElement as='h3' className='mb-2 text-sm font-semibold text-p1-text' {...props} />;
}
function H4Element(props: PlateElementProps) {
  return <DraggableElement as='h4' className='mb-2 text-sm font-medium text-p1-text' {...props} />;
}
function BlockquoteElement(props: PlateElementProps) {
  return <DraggableElement as='blockquote' className='my-2 border-l-2 border-p1-border pl-3 text-p1-muted italic' {...props} />;
}
function HrElement(props: PlateElementProps) {
  return <DraggableElement as='hr' className='my-3 border-p1-border' {...props} />;
}
function UlElement(props: PlateElementProps) {
  return <PlateElement as='ul' className='my-2 list-disc pl-5' {...props} />;
}
function OlElement(props: PlateElementProps) {
  return <PlateElement as='ol' className='my-2 list-decimal pl-5' {...props} />;
}
function LiElement(props: PlateElementProps) {
  return <PlateElement as='li' className='my-0.5' {...props} />;
}
function LinkElement(props: PlateElementProps) {
  const { open } = useContentLinks();
  const element = props.element as TLinkElement;
  const { props: linkProps } = useLink({ element });
  const href = String(element.url ?? '');
  const content = getContentDataFromHref(href);
  return (
    <PlateElement
      as='a'
      className='text-p1-accent underline underline-offset-2'
      {...props}
      attributes={{
        ...props.attributes,
        ...linkProps,
        href: content ? undefined : linkProps.href,
        onClick: (event) => {
          if (!content) return;
          event.preventDefault();
          event.stopPropagation();
          open(href);
        },
      }}
    />
  );
}

const notePlugins = [
  BoldPlugin,
  ItalicPlugin,
  UnderlinePlugin,
  HighlightPlugin,
  FontColorPlugin.configure({ render: { leaf: ColorLeaf } }),
  FontBackgroundColorPlugin.configure({ render: { leaf: BackgroundLeaf } }),
  H2Plugin.withComponent(H2Element),
  H3Plugin.withComponent(H3Element),
  H4Plugin.withComponent(H4Element),
  BlockquotePlugin.withComponent(BlockquoteElement),
  HorizontalRulePlugin.withComponent(HrElement),
  ListPlugin,
  BulletedListPlugin.withComponent(UlElement),
  NumberedListPlugin.withComponent(OlElement),
  ListItemPlugin.withComponent(LiElement),
  LinkPlugin.configure({
    node: { component: LinkElement },
    options: { allowedSchemes: ['http', 'https', 'mailto', 'tel', 'wg'] },
  }),
  ActionSymbolPlugin,
  EmojiPlugin,
  CommentPlugin,
  TocPlugin,
  DndPlugin,
  MarkdownPlugin,
];

function replaceActionNodes(nodes: unknown[]): unknown[] {
  return nodes.map((node) => {
    const item = node as { type?: string; children?: unknown[]; text?: string };
    if (item.type === 'actionSymbol') {
      const stored = (item as { symbol?: string }).symbol;
      const fromText = /^action_symbol_([1-5])$/.exec((item.children?.[0] as { text?: string } | undefined)?.text ?? '')?.[1];
      return { text: `action_symbol_${stored || fromText || '1'}`, code: true };
    }
    if (Array.isArray(item.children)) return { ...item, children: replaceActionNodes(item.children) };
    return node;
  });
}

function serializeMarkdown(editor: { children: { type?: string }[] }) {
  const helper = createPlateEditor({
    plugins: notePlugins,
    value: replaceActionNodes(editor.children as unknown as unknown[]) as never,
  });
  const body = (helper.api.markdown?.serialize() ?? '').replace(new RegExp(`^${TOC_MARK}\\n?`), '');
  const trimmed = toWgMarkdownLinks(body.replace(/^\s+/, '').replace(/[ \t]+$/gm, ''));
  const hasToc = editor.children.some((node) => node.type === 'toc');
  return hasToc ? `${TOC_MARK}\n${trimmed}` : trimmed;
}

function nodesFromMarkdown(editor: { getApi: (plugin: typeof MarkdownPlugin) => { markdown: { deserialize: (text: string) => Array<{ type?: string; children?: unknown[] }> } } }, markdown: string) {
  const hasToc = markdown.startsWith(TOC_MARK);
  const body = markdown.replace(new RegExp(`^${TOC_MARK}\\n?`), '').trim();
  const nodes = body ? editor.getApi(MarkdownPlugin).markdown.deserialize(body) : [{ type: 'p', children: [{ text: '' }] }];
  const rest = liftActionSymbols(nodes.filter((node) => node.type !== 'toc'));
  if (!hasToc) return rest.length ? rest : emptyDoc;
  return [tocNode, ...rest];
}

export function createNotesEditor(markdown: string) {
  return createPlateEditor({
    plugins: notePlugins,
    value: (instance) => nodesFromMarkdown(instance, markdown),
  });
}

export function roundTripNotesMarkdown(markdown: string) {
  return serializeMarkdown(createNotesEditor(markdown));
}

function focusNotesEditor(editor: { tf: { focus: () => void } }) {
  try {
    editor.tf.focus();
  } catch {
    // The contenteditable is not mounted in tests.
  }
}

/** Apply markdown saved by the parent without dropping the caret. */
export function applySavedNotes(editor: ReturnType<typeof createNotesEditor>, incoming: string, lastEmitted: string) {
  const nextSaved = incoming.trim();
  const selection = editor.selection;
  const active = typeof document === 'undefined' ? null : document.activeElement;
  const inOtherField =
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLElement && active.isContentEditable && !active.closest('.p1-plate-editor'));
  if (nextSaved === lastEmitted || serializeMarkdown(editor) === nextSaved) {
    if (selection && !inOtherField) focusNotesEditor(editor);
    return nextSaved;
  }
  editor.tf.setValue(nodesFromMarkdown(editor, nextSaved));
  if (selection) {
    try {
      editor.tf.select(selection);
    } catch {
      const end = editor.api.end([]);
      if (end) editor.tf.select(end);
    }
    focusNotesEditor(editor);
  }
  return nextSaved;
}

export function PlateNotesEditor({
  markdown,
  onMarkdownChange,
  placeholder = 'Your notes...',
}: {
  markdown: string;
  onMarkdownChange: (markdown: string) => void;
  placeholder?: string;
}) {
  const lastEmitted = useRef(markdown.trim());
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onMarkdownChange);
  onChangeRef.current = onMarkdownChange;
  const editor = usePlateEditor({
    plugins: notePlugins,
    value: (instance) => nodesFromMarkdown(instance, markdown.trim()),
    override: {
      components: {
        p: PElement,
        toc: TocElement,
      },
    },
  });

  useEffect(() => {
    lastEmitted.current = applySavedNotes(editor, markdown, lastEmitted.current);
  }, [editor, markdown]);

  useEffect(() => {
    return () => {
      if (!pending.current) return;
      clearTimeout(pending.current);
      const text = serializeMarkdown(editor);
      if (text !== lastEmitted.current) onChangeRef.current(text);
    };
  }, [editor]);

  return (
    <DndProvider backend={HTML5Backend}>
      <div className='flex min-h-0 flex-1 flex-col'>
        <Plate
          editor={editor}
          onChange={({ editor: next }) => {
            if (pending.current) clearTimeout(pending.current);
            pending.current = setTimeout(() => {
              const text = serializeMarkdown(next);
              if (text === lastEmitted.current) return;
              lastEmitted.current = text;
              onChangeRef.current(text);
            }, 600);
          }}
        >
          <NotesShell placeholder={placeholder} />
        </Plate>
      </div>
    </DndProvider>
  );
}

function NotesShell({ placeholder }: { placeholder: string }) {
  const [commentsOpen, setCommentsOpen] = useState(false);

  return (
    <div className='flex min-h-0 flex-1 border border-p1-border bg-p1-surface'>
      <div className='flex min-h-0 min-w-0 flex-1 flex-col'>
        <NotesToolbar commentsOpen={commentsOpen} onComments={() => setCommentsOpen((open) => !open)} />
        <PlateContent
          className='p1-plate-editor min-h-0 flex-1 overflow-y-auto p-3 pl-8 text-sm leading-6 text-p1-text outline-none'
          placeholder={placeholder}
        />
      </div>
      {commentsOpen && <NotesComments onClose={() => setCommentsOpen(false)} />}
    </div>
  );
}

function NotesToolbar({
  commentsOpen,
  onComments,
}: {
  commentsOpen: boolean;
  onComments: () => void;
}) {
  const editor = useEditorRef();
  const hasToc = useEditorSelector((current) => current.children.some((node) => (node as { type?: string }).type === 'toc'), []);
  const marks = useEditorSelector(
    (current) => ({
      bold: Boolean(current.api.hasMark?.('bold')),
      italic: Boolean(current.api.hasMark?.('italic')),
      underline: Boolean(current.api.hasMark?.('underline')),
    }),
    []
  );

  return (
    <div className='flex flex-wrap items-center gap-0.5 border-b border-p1-border p-1'>
      <ActionGlyphMenu />
      <NoteLinkButton editor={editor} />
      <ToolButton label='Remove link' onClick={() => keepCaret(editor, () => unwrapLink(editor))}>
        <Unlink size={14} />
      </ToolButton>
      <Sep />
      <ToolButton label='Bold' active={marks.bold} onClick={() => toggle(editor, BoldPlugin, 'bold')}>
        <Bold size={14} />
      </ToolButton>
      <ToolButton label='Italic' active={marks.italic} onClick={() => toggle(editor, ItalicPlugin, 'italic')}>
        <Italic size={14} />
      </ToolButton>
      <ToolButton label='Underline' active={marks.underline} onClick={() => toggle(editor, UnderlinePlugin, 'underline')}>
        <Underline size={14} />
      </ToolButton>
      <Sep />
      <ToolButton label='Quote' onClick={() => toggle(editor, BlockquotePlugin, 'blockquote')}>
        <Quote size={14} />
      </ToolButton>
      <ToolButton
        label='Horizontal rule'
        onClick={() => keepCaret(editor, () => editor.tf.insertNodes({ type: 'hr', children: [{ text: '' }] }))}
      >
        <Minus size={14} />
      </ToolButton>
      <ToolButton label='Bulleted list' onClick={() => toggle(editor, BulletedListPlugin, 'ul')}>
        <List size={14} />
      </ToolButton>
      <ToolButton label='Numbered list' onClick={() => toggle(editor, NumberedListPlugin, 'ol')}>
        <ListOrdered size={14} />
      </ToolButton>
      <Sep />
      <ToolButton label='Heading 2' onClick={() => toggle(editor, H2Plugin, 'h2')}>
        <Heading2 size={14} />
      </ToolButton>
      <ToolButton label='Heading 3' onClick={() => toggle(editor, H3Plugin, 'h3')}>
        <Heading3 size={14} />
      </ToolButton>
      <ToolButton label='Heading 4' onClick={() => toggle(editor, H4Plugin, 'h4')}>
        <Heading4 size={14} />
      </ToolButton>
      <Sep />
      <ColorMenu
        label='Highlight'
        icon={<Highlighter size={14} />}
        onPick={(color) => addMark(editor, 'backgroundColor', color)}
      />
      <ColorMenu
        label='Text color'
        icon={<Palette size={14} />}
        onPick={(color) => addMark(editor, 'color', color)}
      />
      <Sep />
      <EmojiMenu />
      <ToolButton label='Comments' active={commentsOpen} onClick={onComments}>
        <MessageSquare size={14} />
      </ToolButton>
      <ToolButton
        label='Table of contents'
        active={hasToc}
        onClick={() => {
          keepCaret(editor, () => {
            if (hasToc) {
              const index = editor.children.findIndex((node) => (node as { type?: string }).type === 'toc');
              if (index >= 0) editor.tf.removeNodes({ at: [index] });
              return;
            }
            editor.tf.insertNodes(tocNode, { at: [0] });
          });
        }}
      >
        <ListTree size={14} />
      </ToolButton>
    </div>
  );
}

function ActionGlyphMenu() {
  const editor = useEditorRef();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} label='Action symbol' icon={<ActionSymbol cost='ONE-ACTION' size='14px' />}>
      {ACTION_COSTS.map((item) => (
        <button
          key={item.cost}
          type='button'
          className='grid h-9 w-9 place-items-center text-p1-text hover:bg-p1-hover'
          onMouseDown={(event) => {
            event.preventDefault();
            keepCaret(editor, () => {
              editor.tf.insertNodes(actionSymbolNode(item.cost, item.symbol));
              editor.tf.move({ unit: 'offset' });
            });
            setOpen(false);
          }}
        >
          <ActionSymbol cost={item.cost} size='16px' />
        </button>
      ))}
    </Popover>
  );
}

function EmojiMenu() {
  const editor = useEditorRef();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} label='Emoji' icon={<Smile size={14} />}>
      <div className='grid max-h-48 w-52 grid-cols-8 gap-0.5 p-1'>
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type='button'
            className='grid h-7 w-7 place-items-center text-sm hover:bg-p1-hover'
            onMouseDown={(event) => {
              event.preventDefault();
              keepCaret(editor, () => editor.tf.insertText(emoji));
              setOpen(false);
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
    </Popover>
  );
}

function ColorMenu({ label, icon, onPick }: { label: string; icon: ReactNode; onPick: (color: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} label={label} icon={icon}>
      <div className='grid w-40 grid-cols-7 gap-1 p-2'>
        {NOTE_COLORS.map((color) => (
          <button
            key={color}
            type='button'
            aria-label={color}
            className='h-5 w-5 border border-p1-border'
            style={{ background: color }}
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(color);
              setOpen(false);
            }}
          />
        ))}
      </div>
    </Popover>
  );
}

function NotesToc({ onClose }: { onClose: () => void }) {
  const state = useTocElementState();
  const { props } = useTocElement(state);
  return (
    <aside className='w-44 shrink-0 overflow-y-auto border-r border-p1-border p-2'>
      <div className='mb-2 flex items-center justify-between'>
        <p className='text-[10px] font-semibold uppercase text-p1-muted'>Contents</p>
        <button type='button' className='text-[10px] text-p1-faint hover:text-p1-text' onClick={onClose}>
          Close
        </button>
      </div>
      {!state.headingList.length && <p className='text-[11px] text-p1-faint'>Add headings to build a table of contents.</p>}
      {state.headingList.map((item) => (
        <button
          key={item.id ?? item.title}
          type='button'
          className={`block w-full truncate px-1 py-1 text-left text-[11px] ${state.activeContentId === item.id ? 'text-p1-accent-soft' : 'text-p1-muted hover:text-p1-text'}`}
          onClick={(event) => props.onClick(event, item, 'smooth')}
        >
          {item.title || 'Heading'}
        </button>
      ))}
    </aside>
  );
}

function NotesComments({ onClose }: { onClose: () => void }) {
  const editor = useEditorRef();
  const [draft, setDraft] = useState('');
  const comments = useEditorSelector((current) => current.getApi(CommentPlugin).comment.nodes({}), []);

  return (
    <aside className='w-52 shrink-0 overflow-y-auto border-l border-p1-border p-2'>
      <div className='mb-2 flex items-center justify-between'>
        <p className='text-[10px] font-semibold uppercase text-p1-muted'>Comments</p>
        <button type='button' className='text-[10px] text-p1-faint hover:text-p1-text' onClick={onClose}>
          Close
        </button>
      </div>
      <textarea
        className='mb-2 h-16 w-full border border-p1-border bg-p1-inset p-2 text-xs text-p1-text outline-none'
        placeholder='Comment on the selection…'
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button
        type='button'
        className='mb-3 h-8 w-full border border-p1-border text-xs text-p1-muted hover:text-p1-text'
        onClick={() => {
          const text = draft.trim();
          if (!text) return;
          keepCaret(editor, () => {
            (editor as EditorTf).getTransforms(CommentPlugin).comment?.setDraft?.();
            editor.tf.insertText(` «${text}»`);
          });
          setDraft('');
        }}
      >
        Add comment
      </button>
      {!comments.length && <p className='text-[11px] text-p1-faint'>No comment marks yet. Select text, then add a comment.</p>}
      {comments.map(([node], index) => (
        <p key={index} className='mb-2 border border-p1-border bg-p1-inset p-2 text-[11px] text-p1-text'>
          {typeof node.text === 'string' ? node.text : 'Comment'}
        </p>
      ))}
    </aside>
  );
}

function Popover({
  open,
  onOpenChange,
  label,
  icon,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className='relative'>
      <ToolButton label={label} active={open} onClick={() => onOpenChange(!open)}>
        {icon}
      </ToolButton>
      {open && (
        <>
          <button type='button' className='fixed inset-0 z-[90]' aria-label='Close' onClick={() => onOpenChange(false)} />
          <div className='absolute left-0 top-9 z-[91] border border-p1-border bg-p1-surface shadow-xl'>{children}</div>
        </>
      )}
    </div>
  );
}

function ToolButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type='button'
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`grid h-8 w-8 place-items-center text-p1-muted hover:bg-p1-hover hover:text-p1-text ${active ? 'bg-p1-hover text-p1-accent-soft' : ''}`}
      onMouseDown={(event) => {
        event.preventDefault();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className='mx-1 h-5 w-px bg-p1-border' />;
}

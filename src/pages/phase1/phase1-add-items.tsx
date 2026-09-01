import { isItemVisible } from '@content/content-hidden';
import { fetchContentAll, getDefaultSources, getDefaultSourcesKey } from '@content/content-store';
import { convertToCp, priceToString, purchase } from '@items/currency-handler';
import type { Inventory, Item } from '@schemas/content';
import { labelToVariable } from '@variables/variable-utils';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ConfirmDialog } from './phase1-campaign-settings';
import { useContentLinks } from './phase1-content-links';
import { createBlankPhase1Item, Phase1EditItemModal } from './phase1-edit-item-modal';
import { Phase1PickerModal } from './phase1-picker-modal';

export type AddItemKind = 'GIVE' | 'BUY' | 'FORMULA';

export function SelectAddItemsModal({
  inventory,
  onAdd,
  onClose,
}: {
  inventory: Inventory | null | undefined;
  onAdd: (item: Item, type: AddItemKind, coins?: Inventory['coins']) => void | Promise<void>;
  onClose: () => void;
}) {
  const { open } = useContentLinks();
  const catalog = useQuery({
    queryKey: ['phase1-add-items', { sources: getDefaultSourcesKey('PAGE') }],
    queryFn: async () =>
      (await fetchContentAll<Item>('item', getDefaultSources('PAGE'))).filter(
        (item) => isItemVisible('CHARACTER', item) && !item.meta_data?.deprecated
      ),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const items = useMemo(
    () => [...(catalog.data ?? [])].sort((a, b) => (a.level === b.level ? a.name.localeCompare(b.name) : a.level - b.level)),
    [catalog.data]
  );
  const [pendingBuy, setPendingBuy] = useState<Item | null>(null);
  const [menuId, setMenuId] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ title: string; message: string; at: number } | null>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const [customDraft, setCustomDraft] = useState<Item | null>(null);
  const coins = inventory?.coins ?? { cp: 0, sp: 0, gp: 0, pp: 0 };

  function injectBaseItem(item: Item): Item {
    const baseName = item.meta_data?.base_item;
    const baseItem = baseName
      ? catalog.data?.find((candidate) => labelToVariable(candidate.name) === labelToVariable(baseName))
      : undefined;
    if (!baseItem || !item.meta_data) return item;
    return { ...item, meta_data: { ...item.meta_data, base_item_content: baseItem } };
  }

  async function add(item: Item, type: AddItemKind, nextCoins?: Inventory['coins']) {
    await onAdd(injectBaseItem(item), type, nextCoins);
    setPendingBuy(null);
    setNotice({
      title: type === 'BUY' ? 'Item bought' : type === 'FORMULA' ? 'Formula added' : 'Item given',
      message: addNoticeMessage(item, type),
      at: Date.now(),
    });
  }

  const buyPrice = pendingBuy?.price
    ? {
        cp: Number(pendingBuy.price.cp) || undefined,
        sp: Number(pendingBuy.price.sp) || undefined,
        gp: Number(pendingBuy.price.gp) || undefined,
        pp: Number(pendingBuy.price.pp) || undefined,
      }
    : {};
  const resultingCoins = pendingBuy ? purchase(buyPrice, coins) : null;

  return (
    <>
      <Phase1PickerModal
        title='Add items'
        titleId='add-items-title'
        searchPlaceholder='Search all items'
        items={items}
        getName={(item) => item.name}
        getKey={(item) => String(item.id)}
        matchesSearch={(item, needle) =>
          item.name.toLowerCase().includes(needle) ||
          item.group.toLowerCase().includes(needle) ||
          item.description.toLowerCase().includes(needle)
        }
        loading={catalog.isLoading}
        error={catalog.isError ? (catalog.error instanceof Error ? catalog.error.message : 'Could not load items.') : null}
        empty='No matching items.'
        onClose={onClose}
        headerAction={
          <button type='button' className='toolbar-button shrink-0' onClick={() => setCustomDraft(createBlankPhase1Item())}>
            Custom Item
          </button>
        }
        maxWidthClass='max-w-2xl'
        maxHeightClass='max-h-[min(82vh,720px)]'
        batchSize={24}
        renderItem={(item) => (
          <div className='flex items-center gap-2 border-b border-p1-border px-3 py-2'>
            <button
              type='button'
              className='min-w-0 flex-1 rounded-none bg-transparent py-0.5 text-left hover:bg-p1-hover'
              onClick={() => open(`link_item_${item.id}`)}
            >
              <div className='truncate text-sm text-p1-text'>{item.name}</div>
              <div className='text-[10px] uppercase text-p1-faint'>Lvl {item.level}</div>
            </button>
            <GiveSplitButton
              open={menuId === item.id}
              onToggle={() => setMenuId((current) => (current === item.id ? null : item.id))}
              onGive={() => void add(item, 'GIVE')}
              onBuy={() => {
                setMenuId(null);
                setPendingBuy(item);
              }}
              onFormula={() => void add(item, 'FORMULA')}
            />
          </div>
        )}
      />
      {pendingBuy && (
        <ConfirmDialog
          title={`Buy ${pendingBuy.name}`}
          confirmDanger={false}
          confirmLabel={resultingCoins ? 'Buy' : 'OK'}
          cancelLabel={resultingCoins ? 'Cancel' : 'Close'}
          message={
            resultingCoins ? (
              <p>
                This item costs {convertToCp(buyPrice) > 0 ? priceToString(buyPrice) : 'nothing'}. Your remaining coins will be{' '}
                {priceToString(resultingCoins)}.
              </p>
            ) : (
              <p>You do not have the funds to purchase this item.</p>
            )
          }
          onCancel={() => setPendingBuy(null)}
          onConfirm={async () => {
            if (!resultingCoins) {
              setPendingBuy(null);
              return;
            }
            const item = pendingBuy;
            setPendingBuy(null);
            await add(item, 'BUY', resultingCoins);
          }}
        />
      )}
      {notice && (
        <AddItemNotice key={notice.at} title={notice.title} message={notice.message} onClose={dismissNotice} />
      )}
      {customDraft && (
        <Phase1EditItemModal
          item={customDraft}
          title='Custom item'
          onSave={(item) => {
            void add(item, 'GIVE');
            setCustomDraft(null);
          }}
          onClose={() => setCustomDraft(null)}
        />
      )}
    </>
  );
}

function addNoticeMessage(item: Item, type: AddItemKind) {
  const name = item.name;
  if (type === 'GIVE') return `${name} given (free) to inventory.`;
  if (type === 'FORMULA') return `${name} formula given (free) to inventory.`;
  const cost = formatItemPrice(item);
  return `${name} bought for ${cost} and added to inventory.`;
}

function formatItemPrice(item: Item) {
  if (!item.price) return 'nothing';
  const label = priceToString({
    cp: Number(item.price.cp) || undefined,
    sp: Number(item.price.sp) || undefined,
    gp: Number(item.price.gp) || undefined,
    pp: Number(item.price.pp) || undefined,
  });
  return label === '—' ? 'nothing' : label;
}

function AddItemNotice({ title, message, onClose }: { title: string; message: string; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 1000);
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      onClose();
    }
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [onClose]);
  return createPortal(
    <div
      className='fixed inset-0 z-[120] grid place-items-center bg-black/50 p-5'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section role='status' aria-live='polite' aria-labelledby='add-item-notice-title' className='w-full max-w-sm border border-p1-border bg-p1-surface p-5 shadow-2xl'>
        <h2 id='add-item-notice-title' className='text-lg font-semibold'>
          {title}
        </h2>
        <p className='mt-2 text-sm leading-6 text-p1-muted'>{message}</p>
      </section>
    </div>,
    document.body
  );
}

function GiveSplitButton({
  open,
  onToggle,
  onGive,
  onBuy,
  onFormula,
}: {
  open: boolean;
  onToggle: () => void;
  onGive: () => void;
  onBuy: () => void;
  onFormula: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function close(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) onToggle();
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open, onToggle]);

  return (
    <div ref={rootRef} className='relative flex shrink-0' onMouseDown={(event) => event.stopPropagation()}>
      <button
        type='button'
        className='h-7 border border-p1-border border-r-0 bg-p1-accent px-2.5 text-[11px] font-semibold text-p1-accent-ink hover:opacity-90'
        onClick={onGive}
      >
        Give
      </button>
      <button
        type='button'
        className='grid h-7 w-7 place-items-center border border-p1-border bg-p1-accent text-p1-accent-ink hover:opacity-90'
        aria-label='Buy or add formula'
        aria-expanded={open}
        onClick={onToggle}
      >
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className='absolute right-0 top-full z-20 mt-0.5 min-w-[7.5rem] border border-p1-border bg-p1-surface py-1 shadow-xl'>
          <button type='button' className='block w-full px-3 py-1.5 text-left text-xs hover:bg-p1-hover' onClick={onBuy}>
            Buy
          </button>
          <button type='button' className='block w-full px-3 py-1.5 text-left text-xs hover:bg-p1-hover' onClick={onFormula}>
            Formula
          </button>
        </div>
      )}
    </div>
  );
}

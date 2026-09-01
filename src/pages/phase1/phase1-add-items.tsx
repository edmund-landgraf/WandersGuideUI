import { isItemVisible } from '@content/content-hidden';
import { fetchContentAll, getDefaultSources, getDefaultSourcesKey } from '@content/content-store';
import { convertToCp, priceToString, purchase } from '@items/currency-handler';
import type { Inventory, Item } from '@schemas/content';
import { labelToVariable } from '@variables/variable-utils';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ConfirmDialog } from './phase1-campaign-settings';
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
  const catalog = useQuery({
    queryKey: ['phase1-add-items', { sources: getDefaultSourcesKey('PAGE') }],
    queryFn: async () => (await fetchContentAll<Item>('item', getDefaultSources('PAGE'))).filter((item) => isItemVisible('CHARACTER', item)),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const items = useMemo(
    () => [...(catalog.data ?? [])].sort((a, b) => (a.level === b.level ? a.name.localeCompare(b.name) : a.level - b.level)),
    [catalog.data]
  );
  const [pendingBuy, setPendingBuy] = useState<Item | null>(null);
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
        maxWidthClass='max-w-2xl'
        maxHeightClass='max-h-[min(82vh,720px)]'
        batchSize={24}
        renderItem={(item) => (
          <div className='flex items-center gap-2 border-b border-p1-border px-3 py-2'>
            <div className='min-w-0 flex-1'>
              <div className='truncate text-sm text-p1-text'>{item.name}</div>
              <div className='text-[10px] uppercase text-p1-faint'>
                Lvl {item.level}
                {item.price ? ` · ${priceToString({
                  cp: Number(item.price.cp) || undefined,
                  sp: Number(item.price.sp) || undefined,
                  gp: Number(item.price.gp) || undefined,
                  pp: Number(item.price.pp) || undefined,
                })}` : ''}
              </div>
            </div>
            <div className='flex shrink-0 items-center gap-1' onClick={(event) => event.stopPropagation()}>
              <button type='button' className='h-7 border border-p1-border px-2 text-[11px] font-semibold hover:bg-p1-hover' onClick={() => void add(item, 'GIVE')}>
                Give
              </button>
              <button type='button' className='h-7 border border-p1-border px-2 text-[11px] font-semibold hover:bg-p1-hover' onClick={() => setPendingBuy(item)}>
                Buy
              </button>
              <button type='button' className='h-7 border border-p1-border px-2 text-[11px] font-semibold hover:bg-p1-hover' onClick={() => void add(item, 'FORMULA')}>
                Formula
              </button>
            </div>
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
                This item costs {convertToCp(buyPrice) > 0 ? priceToString(buyPrice) : 'nothing'}. Your remaining coins will be {priceToString(resultingCoins)}.
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
            await add(pendingBuy, 'BUY', resultingCoins);
            setPendingBuy(null);
          }}
        />
      )}
    </>
  );
}

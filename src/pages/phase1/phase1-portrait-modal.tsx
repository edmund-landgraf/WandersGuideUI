import type { ImageOption } from '@schemas/index';
import { getAllPortraitImages } from '@utils/portrait-images';
import { useMemo, useState } from 'react';
import { Phase1PickerModal } from './phase1-picker-modal';

export function Phase1PortraitModal({
  currentUrl,
  onSelect,
  onClose,
}: {
  currentUrl?: string;
  onSelect: (url: string | undefined) => void;
  onClose: () => void;
}) {
  const portraits = useMemo(() => getAllPortraitImages(), []);
  const [customUrl, setCustomUrl] = useState(currentUrl && !portraits.some((item) => item.url === currentUrl) ? currentUrl : '');

  return (
    <Phase1PickerModal
      title='Select Portrait'
      titleId='select-portrait-title'
      searchPlaceholder='Search portraits'
      items={portraits}
      getName={(item) => item.name ?? 'Portrait'}
      getKey={(item) => item.url}
      matchesSearch={(item, needle) =>
        item.name?.toLowerCase().includes(needle) || (item.source ?? '').toLowerCase().includes(needle)
      }
      empty='No matching portraits.'
      onClose={onClose}
      maxWidthClass='max-w-3xl'
      batchSize={24}
      listClassName='grid grid-cols-3 gap-2 p-3 sm:grid-cols-4 md:grid-cols-5'
      footer={
        <form
          className='flex gap-2 border-t border-p1-border p-3'
          onSubmit={(event) => {
            event.preventDefault();
            const url = customUrl.trim();
            onSelect(url || undefined);
            onClose();
          }}
        >
          <input
            value={customUrl}
            onChange={(event) => setCustomUrl(event.target.value)}
            placeholder='Or paste a portrait image URL'
            className='h-9 min-w-0 flex-1 border border-p1-border bg-p1-inset px-3 text-sm outline-none placeholder:text-p1-faint focus:border-p1-accent/60'
          />
          <button type='submit' className='toolbar-button shrink-0'>
            Use URL
          </button>
        </form>
      }
      renderItem={(option) => {
        const selected = option.url === currentUrl;
        return (
          <button
            type='button'
            title={option.source ? `${option.name} · ${option.source}` : option.name}
            className={`flex w-full flex-col overflow-hidden border text-left hover:border-p1-accent/60 ${
              selected ? 'border-p1-accent bg-p1-hover' : 'border-p1-border bg-p1-inset'
            }`}
            onClick={() => {
              onSelect(selected ? undefined : option.url);
              onClose();
            }}
          >
            <img src={option.url} alt='' loading='lazy' decoding='async' className='aspect-square w-full object-cover' />
            <span className='truncate px-1.5 py-1 text-[11px] text-p1-muted'>{option.name}</span>
          </button>
        );
      }}
    />
  );
}

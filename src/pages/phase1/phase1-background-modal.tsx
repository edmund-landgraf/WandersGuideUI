import type { ImageOption } from '@schemas/index';
import { getAllBackgroundImages } from '@utils/background-images';
import { Brush } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Phase1PickerModal } from './phase1-picker-modal';

export function Phase1BackgroundModal({
  currentUrl,
  onSelect,
  onClose,
}: {
  currentUrl?: string;
  onSelect: (url: string | undefined) => void;
  onClose: () => void;
}) {
  const images = useMemo(() => getAllBackgroundImages(), []);
  const [preview, setPreview] = useState<ImageOption | null>(null);

  return (
    <>
      <Phase1PickerModal
        title='Select Background'
        titleId='select-background-title'
        searchPlaceholder='Search artwork'
        items={images}
        getName={(item) => item.name ?? 'Artwork'}
        getKey={(item) => item.url}
        matchesSearch={(item, needle) =>
          item.name?.toLowerCase().includes(needle) || (item.source ?? '').toLowerCase().includes(needle)
        }
        empty='No matching artwork.'
        onClose={onClose}
        maxWidthClass='max-w-5xl'
        maxHeightClass='max-h-[min(90vh,820px)]'
        batchSize={20}
        listClassName='grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 md:grid-cols-4'
        renderItem={(option) => {
          const selected = option.url === currentUrl;
          return (
            <button
              type='button'
              title={option.source ? `${option.name} · ${option.source}` : option.name}
              className={`flex w-full flex-col overflow-hidden border text-left hover:border-p1-accent/60 ${
                selected ? 'border-p1-accent bg-p1-hover' : 'border-p1-border bg-p1-inset'
              }`}
              onClick={() => setPreview(option)}
            >
              <img src={option.url} alt='' loading='lazy' decoding='async' className='h-32 w-full object-cover' />
              <span className='truncate px-1.5 pt-1.5 text-[12px] text-p1-text'>{option.name}</span>
              {option.source?.trim() && (
                <span className='truncate px-1.5 pb-1.5 text-[10px] text-p1-muted'>
                  <Brush className='mr-1 inline' size={10} />
                  {option.source}
                </span>
              )}
            </button>
          );
        }}
      />
      {preview && (
        <Phase1ArtworkPreview
          option={preview}
          onBack={() => setPreview(null)}
          onUse={() => {
            onSelect(preview.url);
            onClose();
          }}
        />
      )}
    </>
  );
}

export function Phase1ArtworkPreview({
  option,
  onBack,
  onUse,
}: {
  option: ImageOption;
  onBack: () => void;
  onUse?: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      onBack();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onBack]);

  return createPortal(
    <div
      className='fixed inset-0 z-[110] bg-black'
      role='presentation'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onBack();
      }}
    >
      <div
        className='absolute inset-3 bg-cover bg-top'
        style={{ backgroundImage: `url(${option.url})` }}
        role='dialog'
        aria-modal='true'
        aria-label={option.name ?? 'Artwork preview'}
      >
        <div className='flex h-full flex-col justify-between p-5'>
          <div className='max-w-lg rounded bg-black/55 px-3 py-2 text-white'>
            {option.name && <p className='text-lg font-semibold'>{option.name}</p>}
            {option.source?.trim() && (
              <a
                href={option.source_url}
                target='_blank'
                rel='noreferrer'
                className='mt-1 inline-flex items-center gap-1 text-sm text-white/80 underline-offset-2 hover:underline'
              >
                <Brush size={12} />
                {option.source}
              </a>
            )}
          </div>
          <div className='flex justify-end gap-2'>
            <button type='button' className='toolbar-button' onClick={onBack}>
              {onUse ? 'Back' : 'Close'}
            </button>
            {onUse && (
              <button type='button' className='toolbar-button' onClick={onUse}>
                Use this artwork
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

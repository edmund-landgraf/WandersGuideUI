import type { ImageOption } from '@schemas/index';
import { uploadImage } from '@upload/image-upload';
import { getAllPortraitImages } from '@utils/portrait-images';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Phase1PickerModal } from './phase1-picker-modal';

const PASTE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function portraitFile(blob: Blob, type: string): File | null {
  if (!PASTE_TYPES.includes(type)) return null;
  const extension = type === 'image/jpeg' ? 'jpg' : type.split('/')[1];
  return new File([blob], `portrait.${extension}`, { type });
}

function fileFromPaste(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const entry of data.items) {
    if (!entry.type.startsWith('image/')) continue;
    const file = entry.getAsFile();
    const accepted = file ? portraitFile(file, file.type || entry.type) : null;
    if (accepted) return accepted;
  }
  const named = Array.from(data.files).find((entry) => PASTE_TYPES.includes(entry.type));
  return named ? portraitFile(named, named.type) : null;
}

async function fileFromClipboard(): Promise<File | null> {
  if (!navigator.clipboard?.read) return null;
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const type = PASTE_TYPES.find((candidate) => item.types.includes(candidate));
    if (!type) continue;
    return portraitFile(await item.getType(type), type);
  }
  return null;
}

export function Phase1PortraitModal({
  currentUrl,
  onSelect,
  onClose,
  overlayClass,
}: {
  currentUrl?: string;
  onSelect: (url: string | undefined) => void;
  onClose: () => void;
  overlayClass?: string;
}) {
  const portraits = useMemo(() => getAllPortraitImages(), []);
  const [customUrl, setCustomUrl] = useState(currentUrl && !portraits.some((item) => item.url === currentUrl) ? currentUrl : '');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pastePreview, setPastePreview] = useState<string | null>(null);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pasteBusy, setPasteBusy] = useState(false);
  const pasteBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pasteOpen) return;
    pasteBox.current?.focus();
  }, [pasteOpen]);

  useEffect(() => {
    return () => {
      if (pastePreview) URL.revokeObjectURL(pastePreview);
    };
  }, [pastePreview]);

  async function storePastedPortrait(file: File) {
    if (file.size > 2_000_000) {
      setPasteError('Image must be about 2 MB or smaller.');
      return;
    }
    setPasteError(null);
    setPasteBusy(true);
    setPastePreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
    try {
      const url = await uploadImage(file, 'portraits');
      if (!url) throw new Error('Could not store that image.');
      onSelect(url);
      onClose();
    } catch (cause) {
      setPasteError(cause instanceof Error ? cause.message : 'Could not store that image.');
    } finally {
      setPasteBusy(false);
    }
  }

  async function openPasteBox() {
    setPasteOpen(true);
    setPasteError(null);
    try {
      const file = await fileFromClipboard();
      if (file) {
        await storePastedPortrait(file);
        return;
      }
    } catch {
      // The browser withheld clipboard images. The square box still accepts a paste.
    }
    pasteBox.current?.focus();
  }

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
      {...(overlayClass ? { overlayClass } : {})}
      batchSize={24}
      listClassName='grid grid-cols-3 gap-2 p-3 sm:grid-cols-4 md:grid-cols-5'
      footer={
        <div className='border-t border-p1-border'>
          {pasteOpen && (
            <div className='flex flex-col items-center gap-2 px-3 pt-3'>
              <div
                ref={pasteBox}
                tabIndex={0}
                role='textbox'
                aria-label='Paste portrait'
                className='flex aspect-square w-40 items-center justify-center overflow-hidden border border-dashed border-p1-border bg-p1-inset text-center text-[11px] text-p1-faint outline-none focus:border-p1-accent/60'
                onPaste={(event) => {
                  const file = fileFromPaste(event.clipboardData);
                  if (!file) {
                    setPasteError('Paste a PNG, JPEG, or WebP image.');
                    return;
                  }
                  event.preventDefault();
                  void storePastedPortrait(file);
                }}
              >
                {pastePreview ? (
                  <img src={pastePreview} alt='' className='h-full w-full object-cover' />
                ) : pasteBusy ? (
                  'Saving…'
                ) : (
                  'Paste an image here'
                )}
              </div>
              {pasteError && <p className='text-xs text-red-400'>{pasteError}</p>}
            </div>
          )}
          <form
            className='flex flex-wrap gap-2 p-3'
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
            <button
              type='button'
              className='toolbar-button shrink-0'
              disabled={pasteBusy}
              onClick={() => void openPasteBox()}
            >
              Paste from clipboard
            </button>
            <button type='submit' className='toolbar-button shrink-0' disabled={pasteBusy}>
              Use URL
            </button>
          </form>
        </div>
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

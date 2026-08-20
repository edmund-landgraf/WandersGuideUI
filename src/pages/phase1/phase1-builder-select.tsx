import { useState } from 'react';
import type { ObjectWithUUID } from '@operations/operation-utils';
import { hasOperationSelection } from '@operations/operation-utils';
import type { OperationResult } from '@schemas/operations';
import { Phase1PickerModal } from './phase1-picker-modal';
import { useContentLinks } from './phase1-content-links';

export function Phase1OperationResults({
  sourceName,
  results,
  onChange,
}: {
  sourceName?: string;
  results: OperationResult[];
  onChange: (path: string, value: string) => void;
}) {
  const selections = results.filter((result) => hasOperationSelection(result));
  if (selections.length === 0) return null;

  return (
    <div className='space-y-3'>
      {sourceName && <div className='text-[11px] font-semibold uppercase tracking-wide text-p1-faint'>From {sourceName}</div>}
      {selections.map((result, index) => (
        <div key={result?.selection?.id ?? index} className='space-y-3'>
          {result?.selection && <OperationSelectControl result={result} onChange={onChange} />}
          {result?.result?.results && result.result.results.length > 0 && (
            <div className='border-l border-p1-border pl-3'>
              <Phase1OperationResults
                sourceName={result.result.source?.name}
                results={result.result.results}
                onChange={(path, value) => {
                  const selectionUUID = result.selection?.id ?? '';
                  const resultUUID = result.result?.source?._select_uuid ?? '';
                  let next = path;
                  if (resultUUID) next = `${resultUUID}_${next}`;
                  if (selectionUUID) next = `${selectionUUID}_${next}`;
                  onChange(next, value);
                }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function OperationSelectControl({ result, onChange }: { result: OperationResult; onChange: (path: string, value: string) => void }) {
  const { open } = useContentLinks();
  const [openPicker, setOpenPicker] = useState(false);
  const selection = result!.selection!;
  const selected = result!.result?.source;
  const options = selection.options ?? [];
  const incomplete = !selected;

  return (
    <div className={`border px-3 py-2 ${incomplete ? 'border-p1-accent/50 bg-p1-accent/5' : 'border-p1-border bg-p1-inset'}`}>
      <div className='flex items-start justify-between gap-2'>
        <div className='min-w-0'>
          <div className='text-xs font-semibold text-p1-muted'>{selection.title || 'Select an option'}</div>
          <div className='mt-0.5 truncate text-sm'>
            {selected ? (
              <button
                type='button'
                className='text-left text-p1-accent hover:underline'
                onClick={() => {
                  const type = selected._content_type || options[0]?._content_type;
                  if (type && selected.id != null) open(`link_${type}_${selected.id}`);
                }}
              >
                {selected.name ?? 'Selected'}
              </button>
            ) : (
              <span className='text-p1-faint'>Not selected</span>
            )}
          </div>
        </div>
        <div className='flex shrink-0 gap-1'>
          <button type='button' className='toolbar-button' onClick={() => setOpenPicker(true)}>
            {selected ? 'Change' : 'Choose'}
          </button>
          {selected && (
            <button type='button' className='toolbar-button' onClick={() => onChange(selection.id, '')}>
              Clear
            </button>
          )}
        </div>
      </div>
      {openPicker && (
        <Phase1PickerModal
          title={selection.title || 'Select an option'}
          titleId='phase1-builder-select'
          items={options}
          getName={(option) => option.name ?? option._select_uuid}
          getKey={(option) => option._select_uuid || String(option.id)}
          empty='No options are available.'
          onClose={() => setOpenPicker(false)}
          renderItem={(option) => (
            <SelectOptionRow
              option={option}
              selected={selected?._select_uuid === option._select_uuid || selected?.id === option.id}
              onPick={() => {
                onChange(selection.id, option._select_uuid);
                setOpenPicker(false);
              }}
              onPreview={() => {
                const type = option._content_type;
                if (type && option.id != null) open(`link_${type}_${option.id}`);
              }}
            />
          )}
        />
      )}
    </div>
  );
}

function SelectOptionRow({
  option,
  selected,
  onPick,
  onPreview,
}: {
  option: ObjectWithUUID;
  selected: boolean;
  onPick: () => void;
  onPreview: () => void;
}) {
  return (
    <div className={`flex items-center justify-between gap-2 border-b border-p1-border px-3 py-2 ${selected ? 'bg-p1-accent/10' : 'hover:bg-p1-hover'}`}>
      <button type='button' className='min-w-0 flex-1 text-left text-sm' onClick={onPick}>
        <div className='font-medium'>{option.name ?? 'Option'}</div>
        {option.level != null && option.level > 0 && <div className='text-[11px] text-p1-faint'>Level {option.level}</div>}
      </button>
      {option._content_type && option.id != null && (
        <button type='button' className='text-xs text-p1-muted hover:text-p1-accent' onClick={onPreview}>
          Info
        </button>
      )}
    </div>
  );
}

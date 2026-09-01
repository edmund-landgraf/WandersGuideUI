import { Input } from '@components/ui/input';
import { GiveSpellData } from '@schemas/operations';
import type { Spell } from '@schemas/content';
import { getAllAttributeVariables } from '@variables/variable-manager';
import { labelToVariable } from '@variables/variable-utils';
import { toLabel } from '@utils/strings';
import { rankNumber } from '@utils/numbers';
import { useEffect, useState } from 'react';
import { Phase1ContentPickButton } from './content-picker';
import { OperationWrapper } from './operation-section';
import { OpsField, OpsSegmented } from './ops-ui';

export function GiveSpellOp(props: {
  data: GiveSpellData;
  onSelect: (data: GiveSpellData) => void;
  onRemove: () => void;
}) {
  const [spellId, setSpellId] = useState(props.data.spellId);
  const [type, setType] = useState(props.data.type);
  const [castingSource, setCastingSource] = useState(props.data.castingSource);
  const [rank, setRank] = useState(props.data.rank);
  const [defaultRank, setDefaultRank] = useState(props.data.rank);
  const [tradition, setTradition] = useState(props.data.tradition);
  const [casts, setCasts] = useState(props.data.casts);

  useEffect(() => {
    props.onSelect({ spellId, type, castingSource, rank: rank ?? defaultRank, tradition, casts });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spellId, type, castingSource, rank, tradition, casts]);

  return (
    <OperationWrapper onRemove={props.onRemove} title='Give Spell'>
      <div className='w-full space-y-2'>
        <div className='flex flex-wrap gap-2'>
          <Phase1ContentPickButton<Spell>
            type='spell'
            selectedId={props.data.spellId}
            onSelect={(option) => {
              setSpellId(option.id);
              setDefaultRank(option.rank);
            }}
          />
          <OpsSegmented
            value={type}
            onChange={(v) => setType(v as 'NORMAL' | 'FOCUS' | 'INNATE')}
            options={[
              { label: 'Normal', value: 'NORMAL' },
              { label: 'Focus', value: 'FOCUS' },
              { label: 'Innate', value: 'INNATE' },
            ]}
          />
        </div>
        {type === 'NORMAL' && (
          <div className='flex gap-2'>
            <Input
              className='w-[190px] font-mono'
              placeholder='Casting Source'
              value={castingSource ?? ''}
              onChange={(e) => setCastingSource(labelToVariable(e.target.value, false))}
            />
            <Input
              className='w-[70px]'
              type='number'
              min={0}
              max={10}
              placeholder='Rank'
              value={rank ?? ''}
              onChange={(e) => setRank(parseInt(e.target.value || '0', 10))}
            />
          </div>
        )}
        {type === 'FOCUS' && (
          <Input
            className='w-[190px] font-mono'
            placeholder='Casting Source'
            value={castingSource ?? ''}
            onChange={(e) => setCastingSource(labelToVariable(e.target.value, false))}
          />
        )}
        {type === 'INNATE' && (
          <div className='flex flex-wrap gap-2'>
            <OpsSegmented
              value={tradition}
              onChange={(v) => setTradition(v as 'ARCANE' | 'OCCULT' | 'PRIMAL' | 'DIVINE')}
              options={[
                { label: 'Arcane', value: 'ARCANE' },
                { label: 'Divine', value: 'DIVINE' },
                { label: 'Occult', value: 'OCCULT' },
                { label: 'Primal', value: 'PRIMAL' },
              ]}
            />
            <Input
              className='w-[70px]'
              type='number'
              min={0}
              max={10}
              placeholder='Rank'
              value={rank ?? ''}
              onChange={(e) => setRank(parseInt(e.target.value || '0', 10))}
            />
            <label className='flex items-center gap-1'>
              <Input
                className='w-[70px]'
                type='number'
                min={0}
                max={10}
                placeholder='Casts'
                value={casts ?? ''}
                onChange={(e) => setCasts(parseInt(e.target.value || '0', 10))}
              />
              <span className='text-xs text-p1-muted'>/day</span>
            </label>
          </div>
        )}
      </div>
    </OperationWrapper>
  );
}

export function GiveSpellSlotOp(props: {
  castingSource: string;
  slots: { lvl: number; rank: number; amt: number }[];
  onSelect: (castingSource: string, slots: { lvl: number; rank: number; amt: number }[]) => void;
  onRemove: () => void;
}) {
  const [castingSource, setCastingSource] = useState(props.castingSource);
  const [slots, setSlots] = useState(props.slots);

  useEffect(() => {
    props.onSelect(castingSource, slots);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [castingSource, slots]);

  return (
    <OperationWrapper onRemove={props.onRemove} title='Give Spell Slots'>
      <div className='w-full space-y-2'>
        <Input
          className='w-[190px] font-mono'
          placeholder='Casting Source'
          value={castingSource}
          onChange={(e) => setCastingSource(labelToVariable(e.target.value, false))}
        />
        <SlotGrid
          value={slots}
          onChange={(next) => {
            setSlots(next);
          }}
        />
      </div>
    </OperationWrapper>
  );
}

function SlotGrid(props: {
  value: { lvl: number; rank: number; amt: number }[];
  onChange: (value: { lvl: number; rank: number; amt: number }[]) => void;
}) {
  const LEVELS = 21;
  const RANKS = 11;
  const slots = props.value ?? [];

  function setAmt(lvl: number, rank: number, amt: number) {
    const next = [...slots];
    const index = next.findIndex((s) => s.lvl === lvl && s.rank === rank);
    if (index !== -1) next[index] = { lvl, rank, amt };
    else next.push({ lvl, rank, amt });
    props.onChange(JSON.parse(JSON.stringify(next)));
  }

  return (
    <div className='max-h-[28rem] overflow-auto'>
      <table className='border-collapse text-[10px]'>
        <thead>
          <tr>
            <th className='p-0.5' />
            {Array.from({ length: RANKS }, (_, i) => (
              <th key={i} className='p-0.5 text-center text-p1-muted'>
                {i === 0 ? 'Can.' : rankNumber(i)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: LEVELS - 1 }, (_, row) => {
            const lvl = row + 1;
            return (
              <tr key={lvl}>
                <td className='whitespace-nowrap pr-1 text-p1-muted'>Lvl. {lvl}</td>
                {Array.from({ length: RANKS }, (_, rank) => (
                  <td key={rank} className='p-0.5'>
                    <input
                      className='h-6 w-7 border border-p1-border bg-p1-inset text-center text-xs'
                      type='number'
                      min={0}
                      max={9}
                      value={slots.find((s) => s.lvl === lvl && s.rank === rank)?.amt ?? ''}
                      onChange={(e) => setAmt(lvl, rank, parseInt(e.target.value || '0', 10))}
                    />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function DefineCastingSourceOp(props: { value: string; onSelect: (value: string) => void; onRemove: () => void }) {
  const parts = props.value.split(':::') || ['', '', '', ''];
  const [name, setName] = useState(parts[0]);
  const [type, setType] = useState(parts[1]);
  const [tradition, setTradition] = useState(parts[2]);
  const [attribute, setAttribute] = useState(parts[3]);

  useEffect(() => {
    props.onSelect(`${name}:::${type}:::${tradition}:::${attribute}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, type, tradition, attribute]);

  return (
    <OperationWrapper onRemove={props.onRemove} title='Define Casting Source'>
      <div className='w-full space-y-2'>
        <Input
          className='w-[190px] font-mono'
          placeholder='Source Name'
          value={name}
          onChange={(e) => setName(labelToVariable(e.target.value, false))}
        />
        <div className='flex flex-wrap gap-4'>
          <OpsField label='Casting Type:'>
            <OpsSegmented
              vertical
              value={type}
              onChange={setType}
              options={[
                { label: 'None', value: '-' },
                { label: 'Spontaneous from Repertoire', value: 'SPONTANEOUS-REPERTOIRE' },
                { label: 'Prepared from Sublist', value: 'PREPARED-LIST' },
                { label: 'Prepared from Tradition', value: 'PREPARED-TRADITION' },
              ]}
            />
          </OpsField>
          <OpsField label='Tradition:'>
            <OpsSegmented
              vertical
              value={tradition}
              onChange={(v) => setTradition(v)}
              options={[
                { label: 'Arcane', value: 'ARCANE' },
                { label: 'Divine', value: 'DIVINE' },
                { label: 'Occult', value: 'OCCULT' },
                { label: 'Primal', value: 'PRIMAL' },
              ]}
            />
          </OpsField>
          <OpsField label='Key Attribute:'>
            <OpsSegmented
              vertical
              value={attribute}
              onChange={setAttribute}
              options={getAllAttributeVariables('CHARACTER').map((v) => ({ label: toLabel(v.name), value: v.name }))}
            />
          </OpsField>
        </div>
      </div>
    </OperationWrapper>
  );
}

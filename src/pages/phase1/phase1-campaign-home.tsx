import { useAuthSession } from '@auth/useAuthSession';
import { parseIconValue } from '@common/IconDisplay';
import { Icon } from '@common/Icon';
import { compiledConditions } from '@conditions/condition-handler';
import { getJsonV4Content } from '@export/json/json-v4';
import { isItemWeapon } from '@items/inv-utils';
import { parseOtherDamage } from '@items/weapon-handler';
import type { AbilityBlock, Character, Combatant, Encounter, EncounterFolder, LivingEntity } from '@schemas/content';
import { sign } from '@utils/numbers';
import { toLabel } from '@utils/strings';
import { useQueries, useQuery } from '@tanstack/react-query';
import { flatten } from 'lodash-es';
import { ChevronDown, ChevronRight, UserRound, X } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { ConfirmDialog } from './phase1-campaign-settings';
import { gmEncounterShownToPlayers, loadPhase1SheetCharacter } from './phase1-api';
import { combatantDisplayName } from './phase1-initiative';
import { creatureStatBlockText } from './phase1-creature-defenses';
import { isContentStackOpen, useContentLinks } from './phase1-content-links';
import { encounterDisplayName, encounterNamesMatch } from './phase1-encounter-title';
import { ProseMarkdown } from './phase1-markdown';
import { ContentLinkHoverCard } from './phase1-content-stack';
import { characterSheetMaxHp, withPhase1Store } from './phase1-entity';
import { Phase1StatBlockCardsPacked } from './phase1-stat-block-cards-packed';

export type CampaignHomeNote = {
  index: number;
  name: string;
  shared?: boolean;
  markdown: string;
};

type StatBlockContent = Awaited<ReturnType<typeof getJsonV4Content>>;

type PcWindow = {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
};

const ABILITY_KEYS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const;

type NoteWindow = CampaignHomeNote & {
  encounterId: number;
  encounterName: string;
  x: number;
  y: number;
  z: number;
};

type NoteHover = {
  note: CampaignHomeNote;
  encounterId: number;
  encounterName: string;
  x: number;
  y: number;
};

type RosterHover = {
  kind: 'allies' | 'enemies';
  encounterId: number;
  x: number;
  y: number;
};

type RosterWindow = RosterHover & { z: number };

function speedText(data: StatBlockContent | undefined) {
  if (!data) return '—';
  const speeds = data.speeds.filter((item) => item.value.total !== 0 && item.value.value !== 0);
  if (speeds.length === 0) return '—';
  return speeds
    .map((item) => (item.name === 'SPEED' ? `${item.value.total}` : `${item.name.replace('SPEED_', '').slice(0, 3).toLowerCase()} ${item.value.total}`))
    .join(', ');
}

function prof(data: StatBlockContent | undefined, name: string) {
  const total = data?.proficiencies[name]?.total;
  return total == null || total === '' ? '—' : String(total);
}

function abilityMod(data: StatBlockContent | undefined, key: string) {
  const match = data ? Object.entries(data.attributes).find(([name]) => name.includes(key)) : undefined;
  if (!match) return '—';
  return sign(match[1].value);
}

function abilityValue(data: StatBlockContent | undefined, key: string) {
  const match = data ? Object.entries(data.attributes).find(([name]) => name.includes(key)) : undefined;
  return match ? Number(match[1].value) : null;
}

type PartySort = { key: string; dir: 'asc' | 'desc' } | null;

function cyclePartySort(current: PartySort, key: string): PartySort {
  if (!current || current.key !== key) return { key, dir: 'asc' };
  if (current.dir === 'asc') return { key, dir: 'desc' };
  return null;
}

function partyStatNumber(value: string | number | null | undefined) {
  if (value == null || value === '' || value === '—' || value === '…') return null;
  const parsed = Number(String(value).replace(/[^\d.+-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function hpBarColor(ratio: number) {
  const tint = (color: string, amount: string) => `color-mix(in srgb, ${color} ${amount}, var(--p1-bg-raised))`;
  if (ratio >= 1) return tint('#6d8a64', '46%');
  if (ratio >= 0.8) return tint('#8aa382', '34%');
  if (ratio >= 0.6) return tint('#b6a15a', '36%');
  if (ratio >= 0.4) return tint('#b07848', '34%');
  if (ratio >= 0.2) return tint('#a86a62', '34%');
  return tint('#8f4540', '42%');
}

type DetailPart = { text: string; href?: string };

function contentHref(type: string, id?: number) {
  if (!id || `${id}`.length >= 10) return undefined;
  return `link_${type}_${id}`;
}

function uniqueParts(parts: DetailPart[]) {
  const seen = new Set<string>();
  return parts.filter((part) => {
    const text = part.text.trim();
    const key = `${part.href ?? ''}|${text}`;
    if (!text || seen.has(key)) return false;
    seen.add(key);
    part.text = text;
    return true;
  });
}

function blockPart(block: AbilityBlock): DetailPart {
  return { text: block.name, href: contentHref(block.type, block.id) };
}

function partyDetailRows(data: StatBlockContent) {
  const blocks = flatten(Object.values(data.feats_features)) as AbilityBlock[];
  const feats = blocks.filter((block) => block.type === 'feat').map(blockPart);
  const features = blocks
    .filter((block) => (block.type === 'class-feature' || block.type === 'heritage' || block.type === 'physical-feature' || block.type === 'mode') && !block.actions)
    .map(blockPart);
  const abilities = blocks.filter((block) => block.type === 'action' || (Boolean(block.actions) && block.type !== 'feat')).map(blockPart);

  const attacks = (data.weapons ?? [])
    .filter((weapon) => isItemWeapon(weapon.item))
    .map((weapon) => {
      const bonus = weapon.stats.damage.bonus.total > 0 ? `+${weapon.stats.damage.bonus.total}` : '';
      const extra = weapon.stats.damage.extra ? ` +${weapon.stats.damage.extra}` : '';
      const other = parseOtherDamage(weapon.stats.damage.other).join('');
      return {
        text: `${weapon.item.name} ${sign(weapon.stats.attack_bonus.total[0])} (${weapon.stats.damage.dice}${weapon.stats.damage.die}${bonus} ${weapon.stats.damage.damageType}${other}${extra})`,
        href: contentHref('item', weapon.item.id),
      };
    });

  const skills = Object.keys(data.proficiencies)
    .filter((name) => name.startsWith('SKILL_') && name !== 'SKILL_LORE____' && Number(data.proficiencies[name].parts?.profValue ?? 0) > 0)
    .map((name) => ({ text: `${toLabel(name).replace(/^Skill /, '')} ${data.proficiencies[name].total}` }))
    .sort((a, b) => a.text.localeCompare(b.text));

  const spells = [
    ...data.spells.cantrips,
    ...data.focus_spells,
    ...data.spells.normal,
    ...data.spells.rituals,
  ].map((spell) => ({ text: spell.name, href: contentHref('spell', spell.id) }));
  const innate = data.innate_spells.map((entry) => ({ text: entry.spell.name, href: contentHref('spell', entry.spell.id) }));

  const gear = data.inventory_flat
    .filter((entry) => entry.is_equipped && entry.item.meta_data?.unselectable !== true && !isItemWeapon(entry.item))
    .map((entry) => ({ text: entry.item.name, href: contentHref('item', entry.item.id) }))
    .sort((a, b) => a.text.localeCompare(b.text));

  const senses = [
    ...data.senses.precise.map((sense) => ({
      text: `${sense.senseName}${sense.range.trim() ? ` ${sense.range}` : ''}`,
      href: contentHref('sense', sense.sense?.id),
    })),
    ...data.senses.imprecise.map((sense) => ({
      text: `${sense.senseName}${sense.range.trim() ? ` ${sense.range}` : ''} (imprecise)`,
      href: contentHref('sense', sense.sense?.id),
    })),
    ...data.languages.map((lang) => ({ text: toLabel(lang) })),
  ];

  const defenses = [
    ...data.resist_weaks.immunes.map((item) => ({ text: `immune ${item}` })),
    ...data.resist_weaks.resists.map((item) => ({ text: `resist ${item}` })),
    ...data.resist_weaks.weaks.map((item) => ({ text: `weak ${item}` })),
  ];

  return [
    { label: 'Attacks', parts: uniqueParts(attacks) },
    { label: 'Skills', parts: uniqueParts(skills) },
    { label: 'Feats', parts: uniqueParts(feats) },
    { label: 'Abilities', parts: uniqueParts(abilities) },
    { label: 'Features', parts: uniqueParts(features) },
    { label: 'Spells', parts: uniqueParts([...spells, ...innate]) },
    { label: 'Gear', parts: uniqueParts(gear) },
    { label: 'Senses', parts: uniqueParts(senses) },
    { label: 'Defenses', parts: uniqueParts(defenses) },
  ].filter((row) => row.parts.length > 0);
}

function ContentHover({ href, children }: { href?: string; children: string }) {
  const { open } = useContentLinks();
  const timer = useRef<number | null>(null);
  const [card, setCard] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => () => {
    if (timer.current != null) window.clearTimeout(timer.current);
  }, []);
  function clearTimer() {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  }
  function hideSoon() {
    clearTimer();
    timer.current = window.setTimeout(() => setCard(null), 160);
  }
  if (!href) return <span>{children}</span>;
  return (
    <>
      <button
        type='button'
        className='pf2e-content-link'
        onMouseEnter={(event) => {
          clearTimer();
          const rect = event.currentTarget.getBoundingClientRect();
          timer.current = window.setTimeout(() => setCard({ left: rect.left, top: rect.bottom + 6 }), 2000);
        }}
        onMouseLeave={hideSoon}
        onClick={() => {
          clearTimer();
          setCard(null);
          open(href);
        }}
      >
        {children}
      </button>
      {card ? (
        <ContentLinkHoverCard
          href={href}
          left={card.left}
          top={card.top}
          onEnter={clearTimer}
          onLeave={hideSoon}
        />
      ) : null}
    </>
  );
}

function Portrait({ character }: { character: Character }) {
  const stored = parseIconValue(character.details?.image_url?.trim() ?? '');
  const src = stored.type === 'image' ? stored.value.trim() : '';
  if (src) {
    return <img src={src} alt='' className='h-6 w-6 shrink-0 border border-p1-border bg-p1-inset object-cover' />;
  }
  return (
    <span className='grid h-6 w-6 shrink-0 place-items-center border border-p1-pc/50 text-p1-pc'>
      <UserRound size={12} />
    </span>
  );
}

function PlayerVisibleToggle({ shown, mixed = false, disabled = false, name, onChange }: { shown: boolean; mixed?: boolean; disabled?: boolean; name: string; onChange: (shown: boolean) => void }) {
  const on = shown && !mixed;
  return (
    <button
      type='button'
      role='switch'
      aria-checked={mixed ? 'mixed' : shown}
      aria-label={mixed ? `Show or hide ${name}` : on ? `Hide ${name} from players` : `Show ${name} to players`}
      title={mixed ? 'Some shown to players' : on ? 'Shown to players' : 'Hidden from players'}
      disabled={disabled}
      className={`relative h-4 w-8 shrink-0 rounded-full border disabled:opacity-40 ${on ? 'border-p1-accent bg-p1-accent/80' : 'border-p1-border bg-p1-inset'}`}
      onClick={() => onChange(!on)}
    >
      <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-p1-text transition-all ${mixed ? 'left-2' : on ? 'left-4' : 'left-0.5'}`} />
    </button>
  );
}

function encounterCounts(encounter: Encounter) {
  const list = encounter.combatants?.list ?? [];
  const allies = list.filter((combatant) => combatant.ally).length;
  return { total: list.length, allies, enemies: list.length - allies };
}

function FolderMoveMenu({ x, y, folders, ids, note, onClose, onMove, onAddNote, onEditNote, onDeleteNote }: { x: number; y: number; folders: EncounterFolder[]; ids: number[]; note: CampaignHomeNote | null; onClose: () => void; onMove: (folderId: string | null) => void; onAddNote?: () => void; onEditNote?: () => void; onDeleteNote?: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 200);
  const top = Math.min(y, window.innerHeight - 160);
  const single = ids.length === 1;
  return createPortal(
    <>
      <div className='fixed inset-0 z-[109]' onMouseDown={onClose} onContextMenu={(event) => { event.preventDefault(); onClose(); }} />
      <div role='menu' aria-label={`Move ${ids.length} encounter${ids.length === 1 ? '' : 's'}`} className='fixed z-[110] min-w-44 border border-p1-border bg-p1-surface py-1 text-xs text-p1-text shadow-2xl' style={{ left, top }}>
        {single && !note && onAddNote ? <button type='button' role='menuitem' className='block w-full px-3 py-1.5 text-left hover:bg-p1-hover' onClick={onAddNote}>Add note</button> : null}
        {single && note && onEditNote ? <button type='button' role='menuitem' className='block w-full px-3 py-1.5 text-left hover:bg-p1-hover' onClick={onEditNote}>Edit note</button> : null}
        {single && note && onDeleteNote ? <button type='button' role='menuitem' className='block w-full px-3 py-1.5 text-left text-p1-danger-soft hover:bg-p1-hover' onClick={onDeleteNote}>Delete note</button> : null}
        {single && (onAddNote || onEditNote) ? <div className='my-1 h-px bg-p1-border' /> : null}
        <button type='button' role='menuitem' className='block w-full px-3 py-1.5 text-left hover:bg-p1-hover' onClick={() => onMove(null)}>Ungrouped</button>
        <FolderMoveItems folders={folders} parentId={null} onMove={onMove} />
      </div>
    </>,
    document.body,
  );
}

function FolderMoveItems({ folders, parentId, onMove }: { folders: EncounterFolder[]; parentId: string | null; onMove: (folderId: string | null) => void }) {
  const items = folderChildren(folders, parentId);
  if (items.length === 0) return null;
  return (
    <>
      {items.map((folder) => {
        const children = folderChildren(folders, folder.id);
        return (
          <div key={folder.id} className='group relative'>
            <button type='button' role='menuitem' className='flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left hover:bg-p1-hover' onClick={() => onMove(folder.id)}>
              <span className='truncate'>{folder.name}</span>
              {children.length > 0 ? <ChevronRight size={12} className='shrink-0 text-p1-faint' /> : null}
            </button>
            {children.length > 0 ? (
              <div role='menu' className='absolute left-full top-0 z-[1] hidden min-w-44 border border-p1-border bg-p1-surface py-1 shadow-2xl group-hover:block'>
                <FolderMoveItems folders={folders} parentId={folder.id} onMove={onMove} />
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function FolderContextMenu({ x, y, name, onClose, onNew, onRename, onUngroupAll, onDelete }: { x: number; y: number; name: string; onClose: () => void; onNew: () => void; onRename: () => void; onUngroupAll: () => void; onDelete: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 180);
  const top = Math.min(y, window.innerHeight - 120);
  return createPortal(
    <>
      <div className='fixed inset-0 z-[109]' onMouseDown={onClose} onContextMenu={(event) => { event.preventDefault(); onClose(); }} />
      <div role='menu' aria-label={name} className='fixed z-[110] min-w-40 border border-p1-border bg-p1-surface py-1 text-xs text-p1-text shadow-2xl' style={{ left, top }}>
        <button type='button' role='menuitem' className='block w-full px-3 py-1.5 text-left hover:bg-p1-hover' onClick={onNew}>New folder</button>
        <button type='button' role='menuitem' className='block w-full px-3 py-1.5 text-left hover:bg-p1-hover' onClick={onRename}>Rename</button>
        <button type='button' role='menuitem' className='block w-full px-3 py-1.5 text-left hover:bg-p1-hover' onClick={onUngroupAll}>Ungroup all</button>
        <button type='button' role='menuitem' className='block w-full px-3 py-1.5 text-left text-p1-danger-soft hover:bg-p1-hover' onClick={onDelete}>Delete</button>
      </div>
    </>,
    document.body,
  );
}

function folderChildren(folders: EncounterFolder[], parentId: string | null) {
  return folders.filter((folder) => (folder.parent_id ?? null) === parentId).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

function folderDescendantIds(folders: EncounterFolder[], id: string) {
  const doomed = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parent_id && doomed.has(folder.parent_id) && !doomed.has(folder.id)) {
        doomed.add(folder.id);
        grew = true;
      }
    }
  }
  return doomed;
}

export function Phase1CampaignHome({ campaignId, players, encounters, notes = [], wide = false, isGm = false, folders = [], onFoldersChange, onMoveEncounter, onTogglePlayerVisible, onAddEncounterNote, onDeleteNote }: { campaignId: number; players: Character[]; encounters: Encounter[]; notes?: CampaignHomeNote[]; wide?: boolean; isGm?: boolean; folders?: EncounterFolder[]; onFoldersChange?: (folders: EncounterFolder[]) => void; onMoveEncounter?: (encounter: Encounter, folderId: string | null) => void; onTogglePlayerVisible?: (encounter: Encounter, shown: boolean) => void; onAddEncounterNote?: (encounter: Encounter) => void; onDeleteNote?: (index: number) => void }) {
  const navigate = useNavigate();
  const [windows, setWindows] = useState<PcWindow[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [dropFolderId, setDropFolderId] = useState<string | null>(null);
  const [moveMenu, setMoveMenu] = useState<{ x: number; y: number; ids: number[] } | null>(null);
  const [pendingNoteDelete, setPendingNoteDelete] = useState<CampaignHomeNote | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const selectionAnchor = useRef<number | null>(null);
  const [openPartyIds, setOpenPartyIds] = useState<number[]>([]);
  const [partyMenu, setPartyMenu] = useState<{ x: number; y: number; id: number } | null>(null);
  const [partySort, setPartySort] = useState<PartySort>(null);
  const [noteWindows, setNoteWindows] = useState<NoteWindow[]>([]);
  const [noteHover, setNoteHover] = useState<NoteHover | null>(null);
  const [rosterHover, setRosterHover] = useState<RosterHover | null>(null);
  const [rosterWindows, setRosterWindows] = useState<RosterWindow[]>([]);
  const hoverTimer = useRef<number | null>(null);
  const rosterTimer = useRef<number | null>(null);
  const openKey = `p1-encounter-folder-open:${campaignId}`;
  const [openFolderId, setOpenFolderId] = useState<string | null>(() => localStorage.getItem(openKey));
  const [folderDraft, setFolderDraft] = useState<{ name: string; parentId: string } | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const knownFolderIds = new Set(folders.map((folder) => folder.id));
  const rootFolders = folderChildren(folders, null);
  const ungrouped = encounters.filter((encounter) => {
    const folderId = encounter.meta_data?.folder_id;
    return !folderId || !knownFolderIds.has(folderId);
  });

  useEffect(() => {
    setOpenFolderId(localStorage.getItem(openKey));
  }, [openKey]);

  function selectFolder(id: string) {
    setOpenFolderId((current) => {
      const next = current === id ? null : id;
      if (next) localStorage.setItem(openKey, next);
      else localStorage.removeItem(openKey);
      return next;
    });
  }

  function ancestorIds(id: string | null) {
    const ids = new Set<string>();
    let cursor = id ? folders.find((folder) => folder.id === id) : undefined;
    const guard = new Set<string>();
    while (cursor?.parent_id && !guard.has(cursor.parent_id)) {
      guard.add(cursor.parent_id);
      ids.add(cursor.parent_id);
      cursor = folders.find((folder) => folder.id === cursor?.parent_id);
    }
    return ids;
  }

  function encountersIn(folderId: string) {
    return encounters.filter((encounter) => encounter.meta_data?.folder_id === folderId);
  }

  function folderCount(folderId: string): number {
    return encountersIn(folderId).length + folderChildren(folders, folderId).reduce((sum, child) => sum + folderCount(child.id), 0);
  }

  function folderOptions(parentId: string | null, depth: number): { id: string; label: string }[] {
    return folderChildren(folders, parentId).flatMap((folder) => [
      { id: folder.id, label: `${'· '.repeat(depth)}${folder.name}` },
      ...folderOptions(folder.id, depth + 1),
    ]);
  }

  function addFolder() {
    const draft = folderDraft;
    const name = draft?.name.trim();
    if (!draft || !name || !onFoldersChange) return;
    const parentId = draft.parentId || null;
    const sort = folders.reduce((max, folder) => Math.max(max, folder.sort), 0) + 1;
    onFoldersChange([...folders, { id: crypto.randomUUID(), name, parent_id: parentId, sort }]);
    setFolderDraft(null);
  }

  function renameFolder(id: string) {
    const name = renameDraft.trim();
    if (!name || !onFoldersChange) return;
    onFoldersChange(folders.map((folder) => (folder.id === id ? { ...folder, name } : folder)));
    setRenamingFolderId(null);
  }

  function ungroupAll(id: string) {
    const doomed = folderDescendantIds(folders, id);
    for (const encounter of encounters) {
      const folderId = encounter.meta_data?.folder_id;
      if (folderId && doomed.has(folderId)) onMoveEncounter?.(encounter, null);
    }
  }

  function deleteFolder(id: string) {
    if (!onFoldersChange) return;
    const doomed = folderDescendantIds(folders, id);
    onFoldersChange(folders.filter((folder) => !doomed.has(folder.id)));
    if (openFolderId && doomed.has(openFolderId)) selectFolder(openFolderId);
    for (const encounter of encounters) {
      const folderId = encounter.meta_data?.folder_id;
      if (folderId && doomed.has(folderId)) onMoveEncounter?.(encounter, null);
    }
  }

  function showNoteHover(next: NoteHover) {
    if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
    setNoteHover(next);
  }

  function hideNoteHover() {
    if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setNoteHover(null), 160);
  }

  function showRosterHover(next: RosterHover) {
    if (rosterTimer.current != null) window.clearTimeout(rosterTimer.current);
    setRosterHover(next);
  }

  function hideRosterHover() {
    if (rosterTimer.current != null) window.clearTimeout(rosterTimer.current);
    rosterTimer.current = window.setTimeout(() => setRosterHover(null), 160);
  }
  const statQueries = useQueries({
    queries: players.map((player) => ({
      queryKey: ['phase1-party-row', player.id],
      queryFn: () => withPhase1Store(async () => {
        const content = await getJsonV4Content(player);
        try {
          const maxHp = await characterSheetMaxHp(player);
          if (maxHp > 0) return { ...content, max_hp: maxHp };
        } catch {
          // The sheet prepare needs the full character row. Keep the export figure if it is missing.
        }
        return content;
      }),
      staleTime: 30_000,
    })),
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isContentStackOpen() || partyMenu) return;
      const topNote = noteWindows.reduce<NoteWindow | null>((best, item) => (!best || item.z > best.z ? item : best), null);
      const topRoster = rosterWindows.reduce<RosterWindow | null>((best, item) => (!best || item.z > best.z ? item : best), null);
      const topPc = windows.reduce<PcWindow | null>((best, item) => (!best || item.z > best.z ? item : best), null);
      const top = [topNote, topRoster, topPc].reduce<(NoteWindow | RosterWindow | PcWindow) | null>((best, item) => (!item ? best : !best || item.z >= best.z ? item : best), null);
      if (top && 'kind' in top) {
        setRosterWindows((current) => current.filter((item) => !(item.encounterId === top.encounterId && item.kind === top.kind)));
        return;
      }
      if (topNote && (!topPc || topNote.z >= topPc.z)) {
        setNoteWindows((current) => current.filter((item) => !(item.encounterId === topNote.encounterId && item.index === topNote.index)));
        return;
      }
      if (!topPc) return;
      setWindows((current) => current.filter((item) => item.id !== topPc.id));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [windows, noteWindows, rosterWindows, partyMenu]);

  function notesFor(encounter: Encounter) {
    return notes.filter((note) => encounterNamesMatch(note.name, encounter.name));
  }

  function lockNote(note: CampaignHomeNote, encounter: Encounter, x: number, y: number) {
    setNoteHover(null);
    setNoteWindows((current) => {
      const key = `${encounter.id}:${note.index}`;
      const z = current.reduce((max, item) => Math.max(max, item.z), 40) + 1;
      const existing = current.find((item) => `${item.encounterId}:${item.index}` === key);
      if (existing) return current.map((item) => (`${item.encounterId}:${item.index}` === key ? { ...item, z } : item));
      return [...current, { ...note, encounterId: encounter.id, encounterName: encounter.name, x, y, z }];
    });
  }

  function lockRoster(kind: RosterHover['kind'], encounter: Encounter, x: number, y: number) {
    setRosterHover(null);
    setRosterWindows((current) => {
      const z = current.reduce((max, item) => Math.max(max, item.z), 50) + 1;
      const existing = current.find((item) => item.encounterId === encounter.id && item.kind === kind);
      if (existing) return current.map((item) => (item.encounterId === encounter.id && item.kind === kind ? { ...item, z } : item));
      return [...current, { kind, encounterId: encounter.id, x, y, z }];
    });
  }

  function movingIds(encounterId: number) {
    return selectedIds.includes(encounterId) && selectedIds.length > 0 ? selectedIds : [encounterId];
  }

  function dropEncounters(folderId: string | null, raw: string) {
    let ids: number[] = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) ids = parsed.filter((id) => typeof id === 'number');
    } catch {
      ids = [];
    }
    for (const id of ids) {
      const encounter = encounters.find((item) => item.id === id);
      if (encounter) onMoveEncounter?.(encounter, folderId);
    }
    setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
    setDropFolderId(null);
  }

  function renderEncounterRow(encounter: Encounter, depth: number) {
    const counts = encounterCounts(encounter);
    const matched = notesFor(encounter);
    const selected = selectedIds.includes(encounter.id);
    return (
      <tr
        key={encounter.id}
        draggable={isGm}
        aria-selected={selected}
        className={`cursor-pointer border-b border-p1-border select-none ${selected ? 'bg-p1-accent/25 hover:bg-p1-accent/25' : 'bg-p1-page/88 hover:bg-p1-page/94'}`}
        onMouseDown={(event) => {
          if (event.shiftKey) event.preventDefault();
        }}
        onClick={(event) => {
          const ids = listedEncounters.map((item) => item.id);
          const index = ids.indexOf(encounter.id);
          if (event.shiftKey && selectionAnchor.current != null) {
            const anchor = ids.indexOf(selectionAnchor.current);
            if (anchor >= 0 && index >= 0) {
              const [start, end] = anchor < index ? [anchor, index] : [index, anchor];
              const range = ids.slice(start, end + 1);
              setSelectedIds(event.ctrlKey || event.metaKey ? [...new Set([...selectedIds, ...range])] : range);
              return;
            }
          }
          if (event.ctrlKey || event.metaKey) {
            setSelectedIds((current) => (current.includes(encounter.id) ? current.filter((id) => id !== encounter.id) : [...current, encounter.id]));
          } else {
            setSelectedIds([encounter.id]);
          }
          selectionAnchor.current = encounter.id;
        }}
        onDoubleClick={() => {
          window.open(`/phase1/campaign/${campaignId}/encounters/${encounter.id}`, '_blank', 'noopener,noreferrer');
        }}
        onDragStart={(event) => {
          const ids = movingIds(encounter.id);
          const payload = JSON.stringify(ids);
          event.dataTransfer.setData('application/x-encounter-ids', payload);
          event.dataTransfer.setData('text/plain', payload);
          event.dataTransfer.effectAllowed = 'move';
        }}
        onContextMenu={(event) => {
          if (!isGm) return;
          event.preventDefault();
          const ids = selectedIds.includes(encounter.id) ? selectedIds : [encounter.id];
          if (!selectedIds.includes(encounter.id)) {
            setSelectedIds(ids);
            selectionAnchor.current = encounter.id;
          }
          setMoveMenu({ x: event.clientX, y: event.clientY, ids });
        }}
      >
        <td className={`py-1 pr-2 font-semibold ${depth === 0 ? 'pl-2' : depth === 1 ? 'pl-8' : 'pl-14'}`}>
          <span className='block truncate'>{encounter.name}</span>
        </td>
        {isGm ? (
          <td className='px-2 py-1' onClick={(event) => event.stopPropagation()}>
            <PlayerVisibleToggle
              shown={gmEncounterShownToPlayers(encounter)}
              name={encounter.name}
              onChange={(shown) => onTogglePlayerVisible?.(encounter, shown)}
            />
          </td>
        ) : null}
        <td className='px-2 py-1'>
          {matched.length === 0 ? <span className='text-p1-faint'>—</span> : (
            <span className='flex flex-wrap gap-1'>
              {matched.map((note) => (
                <button
                  key={note.index}
                  type='button'
                  className='max-w-56 truncate border border-p1-border bg-p1-raised px-1.5 py-0.5 text-left text-p1-text hover:border-p1-accent'
                  onMouseEnter={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    showNoteHover({ note, encounterId: encounter.id, encounterName: encounter.name, x: rect.left, y: rect.bottom + 6 });
                  }}
                  onMouseLeave={hideNoteHover}
                  onClick={(event) => {
                    event.stopPropagation();
                    const rect = event.currentTarget.getBoundingClientRect();
                    lockNote(note, encounter, Math.min(rect.left, window.innerWidth - 560), rect.bottom + 8);
                  }}
                >
                  {encounterDisplayName(note.name)}
                </button>
              ))}
            </span>
          )}
        </td>
        <td className='px-2 py-1'>{counts.total}</td>
        <td
          className='px-2 py-1'
          onMouseEnter={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            showRosterHover({ kind: 'allies', encounterId: encounter.id, x: rect.left, y: rect.bottom + 6 });
          }}
          onMouseLeave={hideRosterHover}
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            lockRoster('allies', encounter, Math.min(rect.left, window.innerWidth - 420), rect.bottom + 8);
          }}
        >
          {counts.allies}
        </td>
        <td
          className='px-2 py-1'
          onMouseEnter={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            showRosterHover({ kind: 'enemies', encounterId: encounter.id, x: rect.left, y: rect.bottom + 6 });
          }}
          onMouseLeave={hideRosterHover}
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            lockRoster('enemies', encounter, Math.min(rect.left, window.innerWidth - 420), rect.bottom + 8);
          }}
        >
          {counts.enemies}
        </td>
      </tr>
    );
  }

  const openAncestors = ancestorIds(openFolderId);

  function renderTreeFolder(folder: EncounterFolder, depth: number) {
    if (!isGm && folderCount(folder.id) === 0) return null;
    const open = openFolderId === folder.id;
    const showChildren = open || openAncestors.has(folder.id);
    const children = folderChildren(folders, folder.id);
    const renaming = renamingFolderId === folder.id;
    const nested = children.length > 0;
    return (
      <li key={folder.id}>
        <div
          className={`flex items-center gap-1 py-0.5 pr-1 ${dropFolderId === folder.id ? 'bg-p1-accent/30 hover:bg-p1-accent/30' : open ? 'bg-p1-raised hover:bg-p1-raised' : 'hover:bg-p1-page/94'}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onDragOver={(event) => {
            if (!isGm) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            if (dropFolderId !== folder.id) setDropFolderId(folder.id);
          }}
          onDragLeave={() => {
            if (dropFolderId === folder.id) setDropFolderId(null);
          }}
          onDrop={(event) => {
            event.preventDefault();
            dropEncounters(folder.id, event.dataTransfer.getData('application/x-encounter-ids'));
          }}
          onContextMenu={(event) => {
            if (!isGm) return;
            event.preventDefault();
            setFolderMenu({ x: event.clientX, y: event.clientY, id: folder.id });
          }}
        >
          {nested ? (
            <button type='button' className='grid h-5 w-5 shrink-0 place-items-center font-mono text-sm leading-none text-p1-muted hover:text-p1-text' aria-expanded={showChildren} aria-label={`${showChildren ? 'Collapse' : 'Expand'} ${folder.name}`} onClick={() => selectFolder(folder.id)}>
              {showChildren ? '−' : '+'}
            </button>
          ) : (
            <span className='h-5 w-5 shrink-0' />
          )}
          {renaming ? (
            <input
              autoFocus
              aria-label={`Rename ${folder.name}`}
              className='min-w-0 flex-1 border-0 border-b border-p1-border bg-transparent px-0 py-0.5 text-xs font-semibold text-p1-text outline-none focus:border-p1-accent'
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') renameFolder(folder.id);
                if (event.key === 'Escape') setRenamingFolderId(null);
              }}
            />
          ) : (
            <button type='button' className='min-w-0 flex-1 truncate text-left text-xs font-semibold' aria-current={open ? 'true' : undefined} onClick={() => selectFolder(folder.id)}>
              {folder.name} <span className='font-normal text-p1-faint'>({folderCount(folder.id)})</span>
            </button>
          )}
        </div>
        {showChildren && children.length > 0 ? (
          <ul>{children.map((child) => renderTreeFolder(child, depth + 1))}</ul>
        ) : null}
      </li>
    );
  }

  const openFolder = openFolderId ? folders.find((folder) => folder.id === openFolderId) : undefined;
  const listedEncounters = openFolder ? encountersIn(openFolder.id) : ungrouped;
  const allListedShown = listedEncounters.length > 0 && listedEncounters.every((encounter) => gmEncounterShownToPlayers(encounter));
  const someListedShown = listedEncounters.some((encounter) => gmEncounterShownToPlayers(encounter));

  useEffect(() => {
    setSelectedIds([]);
    selectionAnchor.current = null;
  }, [openFolderId]);

  function toggleParty(id: number) {
    setOpenPartyIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function openStatCard(player: Character) {
    setPartyMenu(null);
    setWindows((current) => {
      const existing = current.find((item) => item.id === player.id);
      const z = current.reduce((max, item) => Math.max(max, item.z), 30) + 1;
      if (existing) return current.map((item) => (item.id === player.id ? { ...item, name: player.name, z } : item));
      const offset = current.length * 28;
      return [...current, { id: player.id, name: player.name, x: 72 + offset, y: 64 + offset, z }];
    });
  }

  return (
    <div className={wide ? 'flex h-full min-h-0 w-full flex-col' : 'mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-6'}>
      <section className={wide ? 'min-h-0 w-full flex-1 overflow-auto py-2 pl-3 pr-10' : 'min-h-0 flex-1 overflow-auto py-2'}>
        <table className='w-full border-collapse text-[13px]'>
          <thead className='sticky top-0 z-[1] border-b border-p1-border bg-p1-header/92 text-[11px] uppercase text-p1-faint'>
            <tr>
              {(['Name', 'Ancestry', 'Class', 'Lvl', 'HP', 'AC', 'Fort', 'Ref', 'Will', 'Per', 'Spd', ...(wide ? ['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha', 'Conditions'] : [])] as const).map((label) => {
                const active = partySort?.key === label;
                const mark = !active ? '' : partySort.dir === 'asc' ? ' ↑' : ' ↓';
                return (
                  <th key={label} className='whitespace-nowrap px-2 py-1.5 text-left font-medium' aria-sort={active ? (partySort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button
                      type='button'
                      className='uppercase hover:text-p1-text'
                      title={active && partySort.dir === 'desc' ? 'Original order' : active ? 'Sort descending' : 'Sort ascending'}
                      onClick={() => setPartySort((current) => cyclePartySort(current, label))}
                    >
                      {label}{mark}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {players.map((player, index) => ({ player, index, data: statQueries[index]?.data, loading: statQueries[index]?.isLoading })).sort((a, b) => {
              if (!partySort) return a.index - b.index;
              const dir = partySort.dir === 'asc' ? 1 : -1;
              const valueOf = (row: typeof a) => {
                const data = row.data;
                const conditions = compiledConditions(row.player.details?.conditions ?? []);
                const conditionText = conditions.map((item) => (item.value ? `${item.name} ${item.value}` : item.name)).join(', ');
                if (partySort.key === 'Name') return row.player.name;
                if (partySort.key === 'Ancestry') return row.player.details?.ancestry?.name ?? '';
                if (partySort.key === 'Class') return row.player.details?.class?.name ?? '';
                if (partySort.key === 'Lvl') return partyStatNumber(row.player.level);
                if (partySort.key === 'HP') return partyStatNumber(row.player.hp_current ?? data?.max_hp);
                if (partySort.key === 'AC') return partyStatNumber(data?.ac);
                if (partySort.key === 'Fort') return partyStatNumber(data?.proficiencies.SAVE_FORT?.total);
                if (partySort.key === 'Ref') return partyStatNumber(data?.proficiencies.SAVE_REFLEX?.total);
                if (partySort.key === 'Will') return partyStatNumber(data?.proficiencies.SAVE_WILL?.total);
                if (partySort.key === 'Per') return partyStatNumber(data?.proficiencies.PERCEPTION?.total);
                if (partySort.key === 'Spd') return partyStatNumber(speedText(data).split(',')[0]);
                if (partySort.key === 'Conditions') return conditionText;
                const ability = ABILITY_KEYS.find((key) => key === partySort.key.toUpperCase());
                if (ability) return abilityValue(data, ability);
                return '';
              };
              const av = valueOf(a);
              const bv = valueOf(b);
              if (typeof av === 'number' || typeof bv === 'number' || av == null || bv == null) {
                const an = typeof av === 'number' ? av : null;
                const bn = typeof bv === 'number' ? bv : null;
                if (an == null && bn == null) return a.index - b.index;
                if (an == null) return 1;
                if (bn == null) return -1;
                const delta = (an - bn) * dir;
                return delta === 0 ? a.index - b.index : delta;
              }
              const delta = String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' }) * dir;
              return delta === 0 ? a.index - b.index : delta;
            }).map(({ player, data, loading }) => {
              const conditions = compiledConditions(player.details?.conditions ?? []);
              const currentHp = player.hp_current ?? data?.max_hp;
              const maxHp = partyStatNumber(data?.max_hp);
              const hpValue = partyStatNumber(currentHp);
              const hpRatio = maxHp != null && maxHp > 0 && hpValue != null ? Math.min(1, Math.max(0, hpValue / maxHp)) : null;
              const open = openPartyIds.includes(player.id);
              const details = data ? partyDetailRows(data) : [];
              const colSpan = wide ? 18 : 11;
              return (
                <Fragment key={player.id}>
                <tr
                  className='cursor-pointer border-b border-p1-border bg-p1-page/88 hover:bg-p1-page/94'
                  onClick={() => toggleParty(player.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setPartyMenu({ x: event.clientX, y: event.clientY, id: player.id });
                  }}
                >
                  <td className='px-2 py-1'>
                    <span className='flex items-center gap-2'>
                      <button
                        type='button'
                        aria-expanded={open}
                        aria-label={open ? `Hide ${player.name} details` : `Show ${player.name} details`}
                        className='grid h-4 w-4 shrink-0 place-items-center border border-p1-border text-[13px] leading-none text-p1-muted hover:border-p1-accent hover:text-p1-text'
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleParty(player.id);
                        }}
                      >
                        {open ? '−' : '+'}
                      </button>
                      <button
                        type='button'
                        aria-label={open ? `Hide ${player.name} details` : `Show ${player.name} details`}
                        className='shrink-0'
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleParty(player.id);
                        }}
                      >
                        <Portrait character={player} />
                      </button>
                      <span className='truncate font-semibold'>{player.name}</span>
                    </span>
                  </td>
                  <td className='whitespace-nowrap px-2 py-1 text-p1-muted'>{player.details?.ancestry?.name ?? '—'}</td>
                  <td className='whitespace-nowrap px-2 py-1 text-p1-muted'>{player.details?.class?.name ?? '—'}</td>
                  <td className='px-2 py-1'>{player.level ?? '—'}</td>
                  <td className='px-2 py-1'>
                    <span className='relative inline-flex min-w-14 items-center justify-center overflow-hidden border border-p1-border bg-p1-raised px-1.5 py-0.5'>
                      {hpRatio != null ? (
                        <span aria-hidden className='absolute inset-y-0 left-0' style={{ width: `${hpRatio * 100}%`, backgroundColor: hpBarColor(hpRatio) }} />
                      ) : null}
                      <span className='relative'>{currentHp == null && !data ? '—' : `${currentHp ?? '—'}/${data?.max_hp ?? '—'}`}</span>
                    </span>
                  </td>
                  <td className='px-2 py-1'>{loading && data == null ? '…' : data?.ac ?? '—'}</td>
                  <td className='px-2 py-1'>{prof(data, 'SAVE_FORT')}</td>
                  <td className='px-2 py-1'>{prof(data, 'SAVE_REFLEX')}</td>
                  <td className='px-2 py-1'>{prof(data, 'SAVE_WILL')}</td>
                  <td className='px-2 py-1'>{prof(data, 'PERCEPTION')}</td>
                  <td className='whitespace-nowrap px-2 py-1'>{loading && data == null ? '…' : speedText(data)}</td>
                  {wide && ABILITY_KEYS.map((key) => (
                    <td key={key} className='px-2 py-1 font-mono'>{abilityMod(data, key)}</td>
                  ))}
                  {wide && (
                    <td className='max-w-48 truncate px-2 py-1 text-p1-muted'>
                      {conditions.length === 0 ? '—' : conditions.map((item) => (item.value ? `${item.name} ${item.value}` : item.name)).join(', ')}
                    </td>
                  )}
                </tr>
                {open
                  ? details.length > 0
                    ? details.map((row) => (
                        <tr key={`${player.id}-${row.label}`} className='border-b border-p1-border/70 bg-p1-inset/40'>
                          <td colSpan={colSpan} className='py-0.5 pl-10 pr-3 text-xs leading-5 text-p1-muted'>
                            <div className='flex items-start gap-2'>
                              <span className='w-[4.5rem] shrink-0 text-[11px] uppercase tracking-wide text-p1-faint'>{row.label}</span>
                              <span className='min-w-0'>
                                {row.parts.map((part, partIndex) => (
                                  <Fragment key={`${part.href ?? part.text}-${partIndex}`}>
                                    {partIndex > 0 ? ', ' : null}
                                    <ContentHover href={part.href}>{part.text}</ContentHover>
                                  </Fragment>
                                ))}
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))
                    : (
                        <tr className='border-b border-p1-border/70 bg-p1-inset/40'>
                          <td colSpan={colSpan} className='py-0.5 pl-10 pr-3 text-xs text-p1-faint'>
                            {loading ? 'Loading…' : 'Nothing listed.'}
                          </td>
                        </tr>
                      )
                  : null}
                </Fragment>
              );
            })}
            {players.length === 0 ? (
              <tr>
                <td colSpan={wide ? 18 : 11} className='px-3 py-8 text-center text-sm text-p1-faint'>No one is in the party.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
      <div className='h-px shrink-0 bg-p1-border' />
      <section className={wide ? 'flex min-h-0 flex-1 py-2 pl-3 pr-10' : 'flex min-h-0 flex-1 py-2'}>
        <aside className='flex w-1/3 min-w-0 shrink-0 flex-col overflow-auto border-r border-p1-border pr-2'>
          <button
            type='button'
            aria-current={openFolder ? undefined : 'true'}
            className={`mb-2 flex items-center gap-2 px-2 py-0.5 text-left text-xs font-semibold ${dropFolderId === '' ? 'bg-p1-accent/30 hover:bg-p1-accent/30' : openFolder ? 'hover:bg-p1-page/94' : 'bg-p1-raised hover:bg-p1-raised'}`}
            onClick={() => {
              if (openFolderId) selectFolder(openFolderId);
            }}
            onDragOver={(event) => {
              if (!isGm) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              if (dropFolderId !== '') setDropFolderId('');
            }}
            onDragLeave={() => {
              if (dropFolderId === '') setDropFolderId(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              dropEncounters(null, event.dataTransfer.getData('application/x-encounter-ids') || event.dataTransfer.getData('text/plain'));
            }}
          >
            <span className='min-w-0 flex-1 truncate'>Ungrouped <span className='font-normal text-p1-faint'>({ungrouped.length})</span></span>
          </button>
          {isGm ? (
            <div className='mb-2 flex flex-col gap-1.5 px-2'>
              {folderDraft ? (
                <>
                  <input
                    autoFocus
                    aria-label='Folder name'
                    placeholder='Folder name'
                    className='w-full border-0 border-b border-p1-border bg-transparent px-0 py-1 text-xs text-p1-text outline-none placeholder:text-p1-faint focus:border-p1-accent'
                    value={folderDraft.name}
                    onChange={(event) => setFolderDraft({ ...folderDraft, name: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') addFolder();
                      if (event.key === 'Escape') setFolderDraft(null);
                    }}
                  />
                  <select
                    aria-label='Parent folder'
                    className='w-full appearance-none border-0 border-b border-p1-border bg-transparent px-0 py-1 text-xs text-p1-muted outline-none focus:border-p1-accent'
                    value={folderDraft.parentId}
                    onChange={(event) => setFolderDraft({ ...folderDraft, parentId: event.target.value })}
                  >
                    <option value=''>Top level</option>
                    {folderOptions(null, 0).map((folder) => (
                      <option key={folder.id} value={folder.id}>{folder.label}</option>
                    ))}
                  </select>
                  <span className='flex items-center gap-3'>
                    <button type='button' className='text-[10px] uppercase tracking-wide text-p1-accent hover:text-p1-text' onClick={addFolder}>
                      Save
                    </button>
                    <button type='button' className='text-[10px] uppercase tracking-wide text-p1-muted hover:text-p1-text' onClick={() => setFolderDraft(null)}>
                      Cancel
                    </button>
                  </span>
                </>
              ) : (
                <button type='button' className='self-start text-[10px] uppercase tracking-wide text-p1-muted hover:text-p1-accent' onClick={() => setFolderDraft({ name: '', parentId: openFolder?.id ?? '' })}>
                  New folder
                </button>
              )}
            </div>
          ) : null}
          <ul aria-label='Encounter folders'>
            {rootFolders.map((folder) => renderTreeFolder(folder, 0))}
          </ul>
          {folders.length === 0 ? <p className='px-2 py-4 text-xs text-p1-faint'>No folders.</p> : null}
        </aside>
        <div className='min-w-0 flex-1 overflow-auto pl-2'>
          <table className='w-full border-collapse text-xs'>
            <thead className='sticky top-0 border-b border-p1-border bg-p1-header/92 text-[10px] uppercase text-p1-faint'>
              <tr>
                <th className='px-2 py-1.5 text-left font-medium'>Encounter</th>
                {isGm ? (
                  <th className='w-28 px-2 py-1.5 text-left font-medium'>
                    <span className='inline-flex items-center gap-1.5'>
                      Players
                      <PlayerVisibleToggle
                        shown={allListedShown}
                        mixed={someListedShown && !allListedShown}
                        disabled={listedEncounters.length === 0}
                        name='all listed encounters'
                        onChange={(shown) => {
                          for (const encounter of listedEncounters) {
                            if (gmEncounterShownToPlayers(encounter) !== shown) onTogglePlayerVisible?.(encounter, shown);
                          }
                        }}
                      />
                    </span>
                  </th>
                ) : null}
                <th className='px-2 py-1.5 text-left font-medium'>Notes</th>
                <th className='w-24 px-2 py-1.5 text-left font-medium'>Combatants</th>
                <th className='w-24 px-2 py-1.5 text-left font-medium'>Allies</th>
                <th className='w-24 px-2 py-1.5 text-left font-medium'>Enemies</th>
              </tr>
            </thead>
            <tbody>
              {listedEncounters.map((encounter) => renderEncounterRow(encounter, 0))}
              {listedEncounters.length === 0 ? (
                <tr>
                  <td colSpan={isGm ? 6 : 5} className='px-3 py-8 text-center text-sm text-p1-faint'>
                    {openFolder ? 'This folder is empty.' : 'No encounters.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      {folderMenu ? (
        <FolderContextMenu
          x={folderMenu.x}
          y={folderMenu.y}
          name={folders.find((folder) => folder.id === folderMenu.id)?.name ?? 'Folder'}
          onClose={() => setFolderMenu(null)}
          onNew={() => {
            const parentId = folderMenu.id;
            const visible = openFolderId === parentId || ancestorIds(openFolderId).has(parentId);
            if (!visible) selectFolder(parentId);
            setFolderDraft({ name: '', parentId });
            setFolderMenu(null);
          }}
          onRename={() => {
            const folder = folders.find((item) => item.id === folderMenu.id);
            if (!folder) return;
            setRenamingFolderId(folder.id);
            setRenameDraft(folder.name);
            setFolderMenu(null);
          }}
          onUngroupAll={() => {
            ungroupAll(folderMenu.id);
            setFolderMenu(null);
          }}
          onDelete={() => {
            deleteFolder(folderMenu.id);
            setFolderMenu(null);
          }}
        />
      ) : null}
      {moveMenu ? (
        <FolderMoveMenu
          x={moveMenu.x}
          y={moveMenu.y}
          folders={folders}
          ids={moveMenu.ids}
          note={moveMenu.ids.length === 1 ? notes.find((note) => encounterNamesMatch(note.name, encounters.find((item) => item.id === moveMenu.ids[0])?.name)) ?? null : null}
          onClose={() => setMoveMenu(null)}
          onMove={(folderId) => {
            for (const id of moveMenu.ids) {
              const encounter = encounters.find((item) => item.id === id);
              if (encounter) onMoveEncounter?.(encounter, folderId);
            }
            setMoveMenu(null);
          }}
          onAddNote={isGm && onAddEncounterNote ? () => {
            const encounter = encounters.find((item) => item.id === moveMenu.ids[0]);
            setMoveMenu(null);
            if (encounter) onAddEncounterNote(encounter);
          } : undefined}
          onEditNote={isGm ? () => {
            const encounter = encounters.find((item) => item.id === moveMenu.ids[0]);
            const note = notes.find((item) => encounterNamesMatch(item.name, encounter?.name));
            setMoveMenu(null);
            if (note) navigate(`/phase1/campaign/${campaignId}/notes/${note.index}`);
          } : undefined}
          onDeleteNote={isGm && onDeleteNote ? () => {
            const encounter = encounters.find((item) => item.id === moveMenu.ids[0]);
            const note = notes.find((item) => encounterNamesMatch(item.name, encounter?.name));
            setMoveMenu(null);
            if (note) setPendingNoteDelete(note);
          } : undefined}
        />
      ) : null}
      {pendingNoteDelete ? (
        <ConfirmDialog
          title='Delete note'
          message={`Delete the note linked to "${encounterDisplayName(pendingNoteDelete.name)}"?`}
          confirmLabel='Delete'
          onCancel={() => setPendingNoteDelete(null)}
          onConfirm={() => {
            onDeleteNote?.(pendingNoteDelete.index);
            setPendingNoteDelete(null);
          }}
        />
      ) : null}
      {rosterHover && !rosterWindows.some((item) => item.encounterId === rosterHover.encounterId && item.kind === rosterHover.kind) && (
        <RosterPreview
          hover={rosterHover}
          encounter={encounters.find((item) => item.id === rosterHover.encounterId)}
          players={players}
          onEnter={() => { if (rosterTimer.current != null) window.clearTimeout(rosterTimer.current); }}
          onLeave={hideRosterHover}
          onLock={() => lockRoster(rosterHover.kind, encounters.find((item) => item.id === rosterHover.encounterId)!, rosterHover.x, rosterHover.y)}
        />
      )}
      {rosterWindows.map((item) => (
        <RosterLockWindow
          key={`${item.encounterId}-${item.kind}`}
          frame={item}
          encounter={encounters.find((entry) => entry.id === item.encounterId)}
          players={players}
          onFocus={() => setRosterWindows((current) => {
            const z = current.reduce((max, entry) => Math.max(max, entry.z), 50) + 1;
            return current.map((entry) => (entry.encounterId === item.encounterId && entry.kind === item.kind ? { ...entry, z } : entry));
          })}
          onClose={() => setRosterWindows((current) => current.filter((entry) => !(entry.encounterId === item.encounterId && entry.kind === item.kind)))}
          onMove={(x, y) => setRosterWindows((current) => current.map((entry) => (entry.encounterId === item.encounterId && entry.kind === item.kind ? { ...entry, x, y } : entry)))}
        />
      ))}
      {noteHover && !noteWindows.some((item) => item.index === noteHover.note.index && item.encounterId === noteHover.encounterId) && (
        <NotePreview hover={noteHover} campaignId={campaignId} onLock={() => lockNote(noteHover.note, encounters.find((item) => item.id === noteHover.encounterId)!, noteHover.x, noteHover.y)} onEnter={() => { if (hoverTimer.current != null) window.clearTimeout(hoverTimer.current); }} onLeave={hideNoteHover} />
      )}
      {noteWindows.map((item) => (
        <NoteLockWindow
          key={`${item.encounterId}-${item.index}`}
          campaignId={campaignId}
          frame={item}
          onFocus={() => setNoteWindows((current) => {
            const z = current.reduce((max, entry) => Math.max(max, entry.z), 40) + 1;
            return current.map((entry) => (entry.encounterId === item.encounterId && entry.index === item.index ? { ...entry, z } : entry));
          })}
          onClose={() => setNoteWindows((current) => current.filter((entry) => !(entry.encounterId === item.encounterId && entry.index === item.index)))}
          onMove={(x, y) => setNoteWindows((current) => current.map((entry) => (entry.encounterId === item.encounterId && entry.index === item.index ? { ...entry, x, y } : entry)))}
        />
      ))}
      {partyMenu ? (
        <PartyStatMenu
          x={partyMenu.x}
          y={partyMenu.y}
          name={players.find((player) => player.id === partyMenu.id)?.name ?? 'Character'}
          onClose={() => setPartyMenu(null)}
          onOpen={() => {
            const player = players.find((item) => item.id === partyMenu.id);
            if (player) openStatCard(player);
          }}
          onOpenSheet={() => {
            setPartyMenu(null);
            window.open(`/sheet/${partyMenu.id}`, '_blank', 'noopener,noreferrer');
          }}
        />
      ) : null}
      {windows.map((item) => (
        <PcStatWindow
          key={item.id}
          window={item}
          onFocus={() => setWindows((current) => {
            const z = current.reduce((max, entry) => Math.max(max, entry.z), 30) + 1;
            return current.map((entry) => (entry.id === item.id ? { ...entry, z } : entry));
          })}
          onClose={() => setWindows((current) => current.filter((entry) => entry.id !== item.id))}
          onMove={(x, y) => setWindows((current) => current.map((entry) => (entry.id === item.id ? { ...entry, x, y } : entry)))}
        />
      ))}
    </div>
  );
}

function PartyStatMenu({ x, y, name, onClose, onOpen, onOpenSheet }: { x: number; y: number; name: string; onClose: () => void; onOpen: () => void; onOpenSheet: () => void }) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - 180);
  const top = Math.min(y, window.innerHeight - 72);
  return createPortal(
    <>
      <div className='fixed inset-0 z-[109]' onMouseDown={onClose} onContextMenu={(event) => { event.preventDefault(); onClose(); }} />
      <div role='menu' aria-label={name} className='fixed z-[110] min-w-40 border border-p1-border bg-p1-surface py-1 text-xs text-p1-text shadow-2xl' style={{ left, top }}>
        <button type='button' role='menuitem' className='block w-full px-3 py-1.5 text-left hover:bg-p1-hover' onClick={onOpen}>Open stat card</button>
        <button type='button' role='menuitem' className='block w-full px-3 py-1.5 text-left hover:bg-p1-hover' onClick={onOpenSheet}>Open sheet</button>
      </div>
    </>,
    document.body,
  );
}

function PcStatWindow({ window: frame, onFocus, onClose, onMove }: { window: PcWindow; onFocus: () => void; onClose: () => void; onMove: (x: number, y: number) => void }) {
  const session = useAuthSession();
  const query = useQuery({
    queryKey: ['phase1-stat-block', 'character', String(frame.id), session?.user.id ?? null],
    enabled: session !== undefined,
    retry: false,
    queryFn: (): Promise<LivingEntity | null> => loadPhase1SheetCharacter(frame.id, session?.user.id, session?.access_token),
  });
  const entity = query.data ?? null;
  const contentQuery = useQuery({
    queryKey: ['phase1-stat-block-content', entity?.id, 'character'],
    enabled: Boolean(entity),
    queryFn: () => getJsonV4Content(entity!),
  });

  function startDrag(event: React.PointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    onFocus();
    const originX = frame.x;
    const originY = frame.y;
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (ev: PointerEvent) => onMove(originX + ev.clientX - startX, originY + ev.clientY - startY);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return createPortal(
    <div
      className='fixed flex max-h-[70vh] w-[min(920px,92vw)] flex-col border border-p1-border bg-p1-page text-p1-text shadow-2xl'
      style={{ left: frame.x, top: frame.y, zIndex: frame.z }}
      onPointerDown={onFocus}
    >
      <header className='flex cursor-grab items-center justify-between gap-2 border-b border-p1-border bg-p1-header px-2 py-1' onPointerDown={startDrag}>
        <h2 className='truncate text-sm font-semibold'>{frame.name}</h2>
        <button type='button' className='icon-button' title={`Close ${frame.name}`} onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className='min-h-0 flex-1 overflow-auto p-2'>
        {query.isLoading || (entity && contentQuery.isLoading) ? <p className='text-xs italic text-p1-muted'>Loading…</p> : null}
        {!query.isLoading && !entity ? <p className='text-xs italic text-p1-muted'>Failed to find character #{frame.id}</p> : null}
        {entity && contentQuery.data ? <Phase1StatBlockCardsPacked entity={entity} data={contentQuery.data} /> : null}
      </div>
    </div>,
    document.body,
  );
}

function numericId(value: number | { id?: number } | null | undefined) {
  if (typeof value === 'number') return value;
  return value?.id;
}

function characterFor(combatant: Combatant, players: Character[]) {
  const id = numericId(combatant.character);
  return players.find((player) => player.id === id) ?? (combatant.data as Character | undefined);
}

function allyRows(encounter: Encounter | undefined, players: Character[]) {
  return (encounter?.combatants?.list ?? []).filter((combatant) => combatant.ally).map((combatant) => {
    const character = combatant.type === 'CHARACTER' ? characterFor(combatant, players) : undefined;
    return {
      id: combatant._id,
      name: character?.name ?? combatantDisplayName(combatant),
      ancestry: character?.details?.ancestry?.name ?? '—',
      background: character?.details?.background?.name ?? '—',
      className: character?.details?.class?.name ?? '—',
    };
  });
}

function referenceUrl(text: string | undefined) {
  if (!text) return undefined;
  const urls = [...text.matchAll(/https?:\/\/[^\s)\]>'"]+/gi)].map((match) => match[0].replace(/[.,;]+$/, ''));
  return urls.find((url) => /demiplane\.com|aonprd\.com/i.test(url));
}

function storedImageUrl(text: string | undefined) {
  if (!text) return undefined;
  const markdown = text.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/i)?.[1];
  if (markdown) return markdown;
  return text.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i)?.[1];
}

function enemySource(combatant: Combatant) {
  const creature = combatant.creature;
  const text = creature ? creatureStatBlockText(creature) : '';
  const hazardUrl = combatant.hazard?.meta_data && typeof combatant.hazard.meta_data === 'object'
    ? (combatant.hazard.meta_data as { source?: { url?: string } }).source?.url
    : undefined;
  const href = referenceUrl(text) ?? referenceUrl(hazardUrl);
  const imageUrl = creature?.details?.image_url
    ?? creature?.details?.background_image_url
    ?? combatant.data?.details?.image_url
    ?? combatant.data?.details?.background_image_url
    ?? storedImageUrl(text);
  return { href, imageUrl };
}

function enemyRows(encounter: Encounter | undefined) {
  return (encounter?.combatants?.list ?? []).filter((combatant) => !combatant.ally).map((combatant) => {
    const name = combatantDisplayName(combatant);
    const source = enemySource(combatant);
    return {
      id: combatant._id,
      name,
      level: combatant.hazard?.level ?? combatant.creature?.level ?? combatant.data?.level,
      imageUrl: source.imageUrl,
      href: source.href,
    };
  });
}

function RosterArt({ imageUrl }: { imageUrl?: string }) {
  const [failed, setFailed] = useState(false);
  const stored = parseIconValue(imageUrl?.trim() ?? '');
  const portrait = stored.type === 'image' ? stored.value.trim() : '';
  if (stored.type === 'icon' && stored.value && !portrait) {
    return (
      <span className='grid h-8 w-8 place-items-center border border-p1-border bg-p1-inset' style={{ color: stored.color || undefined }}>
        <Icon name={stored.value} size={16} />
      </span>
    );
  }
  if (portrait && !failed) {
    return <img src={portrait} alt='' className='h-8 w-8 border border-p1-border bg-p1-inset object-cover' onError={() => setFailed(true)} />;
  }
  return <span className='grid h-8 w-8 place-items-center border border-p1-border bg-p1-inset text-p1-faint'>—</span>;
}

function RosterTable({ kind, encounter, players }: { kind: RosterHover['kind']; encounter: Encounter | undefined; players: Character[] }) {
  const allies = kind === 'allies' ? allyRows(encounter, players) : [];
  const enemies = kind === 'enemies' ? enemyRows(encounter) : [];
  return (
    <table className='w-full border-collapse text-xs'>
      <thead className='text-[10px] uppercase text-p1-faint'>
        <tr>
          {kind === 'allies' ? (
            <>
              <th className='px-2 py-1 text-left font-medium'>Name</th>
              <th className='px-2 py-1 text-left font-medium'>Ancestry</th>
              <th className='px-2 py-1 text-left font-medium'>Background</th>
              <th className='px-2 py-1 text-left font-medium'>Class</th>
            </>
          ) : (
            <>
              <th className='px-2 py-1 text-left font-medium'>Art</th>
              <th className='px-2 py-1 text-left font-medium'>Name</th>
              <th className='px-2 py-1 text-left font-medium'>Level</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {kind === 'allies' && allies.map((row) => (
          <tr key={row.id} className='border-t border-p1-border'>
            <td className='px-2 py-1 font-semibold'>{row.name}</td>
            <td className='px-2 py-1 text-p1-muted'>{row.ancestry}</td>
            <td className='px-2 py-1 text-p1-muted'>{row.background}</td>
            <td className='px-2 py-1 text-p1-muted'>{row.className}</td>
          </tr>
        ))}
        {kind === 'enemies' && enemies.map((row) => (
          <tr key={row.id} className='border-t border-p1-border'>
            <td className='px-2 py-1'><RosterArt imageUrl={row.imageUrl} /></td>
            <td className='px-2 py-1 font-semibold'>
              {row.href ? (
                <a href={row.href} target='_blank' rel='noreferrer' className='hover:text-p1-accent hover:underline' onClick={(event) => event.stopPropagation()}>
                  {row.name}
                </a>
              ) : row.name}
            </td>
            <td className='px-2 py-1'>{row.level ?? '—'}</td>
          </tr>
        ))}
        {(kind === 'allies' ? allies : enemies).length === 0 ? (
          <tr>
            <td colSpan={kind === 'allies' ? 4 : 3} className='px-2 py-3 text-p1-faint'>None.</td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

function RosterPreview({ hover, encounter, players, onEnter, onLeave, onLock }: { hover: RosterHover; encounter: Encounter | undefined; players: Character[]; onEnter: () => void; onLeave: () => void; onLock: () => void }) {
  const left = Math.min(Math.max(8, hover.x), window.innerWidth - 420);
  const top = Math.min(hover.y, window.innerHeight - 240);
  return createPortal(
    <div
      className='fixed z-[80] max-h-72 w-[min(400px,92vw)] overflow-auto border border-p1-border bg-p1-page p-2 text-p1-text shadow-2xl'
      style={{ left, top }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={(event) => { event.stopPropagation(); onLock(); }}
    >
      <RosterTable kind={hover.kind} encounter={encounter} players={players} />
    </div>,
    document.body,
  );
}

function RosterLockWindow({ frame, encounter, players, onFocus, onClose, onMove }: { frame: RosterWindow; encounter: Encounter | undefined; players: Character[]; onFocus: () => void; onClose: () => void; onMove: (x: number, y: number) => void }) {
  function startDrag(event: React.PointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('button, a')) return;
    event.preventDefault();
    onFocus();
    const originX = frame.x;
    const originY = frame.y;
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (ev: PointerEvent) => onMove(originX + ev.clientX - startX, originY + ev.clientY - startY);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return createPortal(
    <div
      className='fixed flex max-h-80 w-[min(400px,92vw)] flex-col border border-p1-border bg-p1-page text-p1-text shadow-2xl'
      style={{ left: frame.x, top: frame.y, zIndex: frame.z }}
      onPointerDown={onFocus}
    >
      <header className='flex cursor-grab items-center justify-between gap-2 border-b border-p1-border bg-p1-header px-2 py-1' onPointerDown={startDrag}>
        <h2 className='truncate text-xs font-semibold uppercase tracking-wide text-p1-faint'>{frame.kind}</h2>
        <button type='button' className='icon-button' title='Close' onClick={onClose}><X size={14} /></button>
      </header>
      <div className='min-h-0 flex-1 overflow-auto p-2'>
        <RosterTable kind={frame.kind} encounter={encounter} players={players} />
      </div>
    </div>,
    document.body,
  );
}

function NoteChrome({ campaignId, name, shared, markdown, encounterId, encounterName }: { campaignId: number; name: string; shared?: boolean; markdown: string; encounterId: number; encounterName: string }) {
  return (
    <>
      <p className='text-[10px] font-semibold uppercase tracking-[0.14em] text-p1-faint'>Campaign notes</p>
      <h2 className='mt-1 truncate text-lg font-semibold'>{encounterDisplayName(name)}</h2>
      <p className='mt-1 text-xs text-p1-faint'>{shared ? 'Shared with party' : 'Visible to the GM only'}</p>
      <Link to={`/phase1/campaign/${campaignId}/encounters/${encounterId}`} className='mt-1 block truncate text-xs text-p1-accent hover:underline' onClick={(event) => event.stopPropagation()}>
        See encounter: {encounterDisplayName(encounterName)}
      </Link>
      <div className='mt-3 border-t border-p1-border pt-3'>
        {markdown ? <ProseMarkdown className='max-w-none'>{markdown}</ProseMarkdown> : <p className='text-sm italic text-p1-faint'>This note is empty.</p>}
      </div>
    </>
  );
}

function NotePreview({ hover, campaignId, onLock, onEnter, onLeave }: { hover: NoteHover; campaignId: number; onLock: () => void; onEnter: () => void; onLeave: () => void }) {
  const left = Math.min(hover.x, window.innerWidth - 440);
  const top = Math.min(hover.y, window.innerHeight - 280);
  return createPortal(
    <div
      className='fixed z-[80] max-h-80 w-[min(420px,92vw)] overflow-auto border border-p1-border bg-p1-page p-4 text-p1-text shadow-2xl'
      style={{ left, top }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={(event) => { event.stopPropagation(); onLock(); }}
    >
      <NoteChrome campaignId={campaignId} name={hover.note.name} shared={hover.note.shared} markdown={hover.note.markdown} encounterId={hover.encounterId} encounterName={hover.encounterName} />
    </div>,
    document.body,
  );
}

function NoteLockWindow({ campaignId, frame, onFocus, onClose, onMove }: { campaignId: number; frame: NoteWindow; onFocus: () => void; onClose: () => void; onMove: (x: number, y: number) => void }) {
  function startDrag(event: React.PointerEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('button, a')) return;
    event.preventDefault();
    onFocus();
    const originX = frame.x;
    const originY = frame.y;
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (ev: PointerEvent) => onMove(originX + ev.clientX - startX, originY + ev.clientY - startY);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return createPortal(
    <div
      className='fixed flex max-h-[70vh] w-[min(720px,92vw)] flex-col border border-p1-border bg-p1-page text-p1-text shadow-2xl'
      style={{ left: frame.x, top: frame.y, zIndex: frame.z }}
      onPointerDown={onFocus}
    >
      <header className='flex cursor-grab items-center justify-end border-b border-p1-border bg-p1-header px-2 py-1' onPointerDown={startDrag}>
        <button type='button' className='icon-button' title='Close note' onClick={onClose}><X size={14} /></button>
      </header>
      <div className='min-h-0 flex-1 overflow-auto px-5 py-4'>
        <NoteChrome campaignId={campaignId} name={frame.name} shared={frame.shared} markdown={frame.markdown} encounterId={frame.encounterId} encounterName={frame.encounterName} />
      </div>
    </div>,
    document.body,
  );
}

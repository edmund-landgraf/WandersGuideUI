import { User } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AdminCharacterSummary } from './admin-api';

/** Visual copy of the Phase 1 character roster row (compact), linking to the admin read-only view. */
export function AdminCharacterRow({ character }: { character: AdminCharacterSummary }) {
  const identity = [character.ancestry, character.background, [character.class, character.class_2].filter(Boolean).join(' / ')]
    .filter(Boolean)
    .join(' · ');
  return (
    <Link
      to={`/phase1/admin/view/${character.id}`}
      data-testid='admin-character-card'
      className='p1-char-row grid w-full grid-cols-[auto_1fr_auto] items-center gap-4 px-2 py-1 pl-8 text-left hover:bg-p1-hover'
    >
      {character.image_url ? (
        <span className='h-14 w-14 shrink-0 overflow-hidden border border-p1-border bg-p1-inset'>
          <img src={character.image_url} alt='' className='h-full w-full object-cover' />
        </span>
      ) : (
        <span className='grid h-14 w-14 shrink-0 place-items-center border border-p1-border bg-p1-inset text-p1-faint'>
          <User size={22} />
        </span>
      )}
      <span className='min-w-0'>
        <span className='block truncate text-base font-semibold'>{character.name}</span>
        <span className='block truncate text-sm text-p1-muted'>
          Level {character.level}
          {identity ? ` · ${identity}` : ''}
        </span>
      </span>
      <span className='text-xs text-p1-faint'>#{character.id}</span>
    </Link>
  );
}
import { getJsonV4Content } from '@export/json/json-v4';
import type { Character } from '@schemas/content';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  characterToStatBlockCard,
  PC_STAT_BLOCKS_PER_PAGE,
  type PcStatBlockCardModel,
} from './phase1-pc-stat-block-card';

function StatLine({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <p className='pc-stat-card-line'>
      <strong>{label}</strong> {value}
    </p>
  );
}

function MetaBits({
  items,
  className = 'pc-stat-card-identity',
}: {
  items: { label: string; value?: string | number | null }[];
  className?: string;
}) {
  const present = items.filter((item) => item.value != null && item.value !== '');
  if (present.length === 0) return null;
  return (
    <p className={className}>
      {present.map((item, index) => (
        <span key={item.label}>
          {index > 0 ? ' · ' : null}
          <strong>{item.label}</strong> {item.value}
        </span>
      ))}
    </p>
  );
}

function PcIdentityRow({
  ancestry,
  background,
  className,
}: {
  ancestry?: string;
  background?: string;
  className?: string;
}) {
  const values = [ancestry, background, className].map((part) => part?.trim() || '—').join(', ');
  return <p className='pc-stat-card-line pc-stat-card-abc'>{values}</p>;
}

function PcStatCard({ card }: { card: PcStatBlockCardModel }) {
  return (
    <article className='pc-stat-card'>
      <header className='pc-stat-card-header'>
        {card.portraitUrl ? <img className='pc-stat-card-portrait' src={card.portraitUrl} alt='' /> : null}
        <div className='pc-stat-card-headtext'>
          <div className='pc-stat-card-title-row'>
            <h4 className='pc-stat-card-name'>{card.name}</h4>
            {card.hasSheet && card.level != null ? <p className='pc-stat-card-level'>Level {card.level}</p> : null}
          </div>
          {card.playerName ? <p className='pc-stat-card-player'>Player {card.playerName}</p> : null}
        </div>
      </header>
      {!card.hasSheet ? (
        <p className='pc-stat-card-empty'>No character sheet</p>
      ) : (
        <>
          <PcIdentityRow ancestry={card.ancestry} background={card.background} className={card.className} />
          <MetaBits
            items={[
              { label: 'Class DC', value: card.classDc },
              { label: 'Hero Points', value: card.heroPoints },
              { label: 'Size', value: card.size },
            ]}
          />
          {card.traits.length > 0 ? (
            <div className='pc-stat-card-traits'>
              {card.traits.map((trait) => (
                <span key={trait} className='pc-stat-card-trait'>
                  {trait}
                </span>
              ))}
            </div>
          ) : null}
          <StatLine
            label='Perception'
            value={
              card.perception
                ? card.languages
                  ? `${card.perception}; Languages ${card.languages}`
                  : card.perception
                : card.languages
                  ? `Languages ${card.languages}`
                  : undefined
            }
          />
          <StatLine label='Skills' value={card.skills} />
          {card.abilities ? <p className='pc-stat-card-line'>{card.abilities}</p> : null}
          <StatLine label='AC' value={card.ac} />
          <MetaBits
            className='pc-stat-card-line'
            items={[
              { label: 'Fortitude', value: card.fortitude },
              { label: 'Reflex', value: card.reflex },
              { label: 'Will', value: card.will },
            ]}
          />
          {card.hp && card.speed ? (
            <StatLine label='HP' value={`${card.hp}; Speed ${card.speed}`} />
          ) : (
            <>
              <StatLine label='HP' value={card.hp} />
              <StatLine label='Speed' value={card.speed} />
            </>
          )}
          {card.melee.map((line) => (
            <StatLine key={`melee-${line}`} label='Melee' value={line} />
          ))}
          {card.ranged.map((line) => (
            <StatLine key={`ranged-${line}`} label='Ranged' value={line} />
          ))}
          <StatLine label='Spells' value={card.spells} />
        </>
      )}
    </article>
  );
}

async function loadPcStatBlockCards(characters: Character[]): Promise<PcStatBlockCardModel[]> {
  const cards: PcStatBlockCardModel[] = [];
  for (const character of characters) {
    try {
      const data = await getJsonV4Content(character);
      cards.push(characterToStatBlockCard(character, data));
    } catch {
      cards.push(characterToStatBlockCard(character, null));
    }
  }
  return cards;
}

export function Phase1PcStatBlocksModal({
  characters,
  onClose,
}: {
  characters: Character[];
  onClose: () => void;
}) {
  const ids = useMemo(() => characters.map((character) => character.id).join(','), [characters]);
  const query = useQuery({
    queryKey: ['phase1-pc-stat-blocks', ids],
    queryFn: () => loadPcStatBlockCards(characters),
  });
  const cards = query.data ?? [];
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(cards.length / PC_STAT_BLOCKS_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const pageCards = cards.slice(safePage * PC_STAT_BLOCKS_PER_PAGE, safePage * PC_STAT_BLOCKS_PER_PAGE + PC_STAT_BLOCKS_PER_PAGE);
  const showPager = cards.length > PC_STAT_BLOCKS_PER_PAGE;

  useEffect(() => {
    setPage(0);
  }, [ids]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (!showPager) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        setPage((current) => Math.min(current + 1, pageCount - 1));
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        setPage((current) => Math.max(current - 1, 0));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, showPager, pageCount]);

  return (
    <div className='pc-stat-blocks-overlay' role='presentation' onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className='pc-stat-blocks-modal' role='dialog' aria-modal='true' aria-labelledby='pc-stat-blocks-title' onMouseDown={(event) => event.stopPropagation()}>
        <div className='pc-stat-blocks-modal-header'>
          <h3 id='pc-stat-blocks-title' className='pc-stat-blocks-modal-title'>
            PC Stat Blocks
          </h3>
          <button type='button' className='icon-button pc-stat-blocks-modal-close' title='Close' aria-label='Close' onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className='pc-stat-blocks-modal-body'>
          {query.isLoading ? <p className='pc-stat-card-empty'>Loading…</p> : null}
          {!query.isLoading && cards.length === 0 ? <p className='pc-stat-card-empty'>No player characters in this encounter.</p> : null}
          {cards.length > 0 ? (
            <div className='pc-stat-blocks-grid'>
              {pageCards.map((card) => (
                <PcStatCard key={card.id} card={card} />
              ))}
            </div>
          ) : null}
        </div>
        <div className='pc-stat-blocks-modal-actions'>
          {showPager ? (
            <div className='pc-stat-blocks-pager'>
              <button type='button' className='toolbar-button' disabled={safePage <= 0} onClick={() => setPage((current) => Math.max(current - 1, 0))}>
                Previous
              </button>
              <span className='pc-stat-blocks-page-label'>
                Page {safePage + 1} of {pageCount}
              </span>
              <button type='button' className='toolbar-button' disabled={safePage >= pageCount - 1} onClick={() => setPage((current) => Math.min(current + 1, pageCount - 1))}>
                Next
              </button>
            </div>
          ) : (
            <span />
          )}
          <button type='button' className='toolbar-button' onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

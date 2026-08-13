import './phase0.css';
import { sessionState } from '@atoms/supabaseAtoms';
import { CampaignSignIn } from '@auth/CampaignSignIn';
import { Badge } from '@components/ui/badge';
import { Button } from '@components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@components/ui/tabs';
import { fetchContentById } from '@content/content-store';
import { makeRequest } from '@requests/request-manager';
import { Campaign, Character, Combatant, Creature, Encounter, LivingEntity } from '@schemas/content';
import { sign } from '@utils/numbers';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, PanelRightOpen, Shield, Swords, UserRound } from 'lucide-react';
import { uniqBy } from 'lodash-es';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLoaderData, useNavigate } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { supabase } from '../../supabase-client';
import { OLD_UI_ORIGIN, PhaseViewSwitch } from '../phase-switch/PhaseViewSwitch';

const PANE_STORAGE_KEY = 'phase0-encounter-detail-width';

type CampaignLoaderData = { campaignId: string; encounterId?: string };
type PopulatedCombatant = Combatant & { data: LivingEntity; access?: { can_edit: boolean; details_revealed: boolean } };
type SelectedDetail = { type: 'CREATURE'; combatant: PopulatedCombatant } | { type: 'CHARACTER'; combatant: PopulatedCombatant };

type ComputedStats = {
  ac: number;
  fort: number;
  reflex: number;
  will: number;
  maxHp: number;
};

export function CampaignComponent() {
  const { campaignId, encounterId } = useLoaderData() as CampaignLoaderData;
  return (
    <Phase0CampaignPage
      campaignId={parseInt(campaignId)}
      encounterId={encounterId ? parseInt(encounterId) : null}
    />
  );
}

export function Component() {
  const session = useAtomValue(sessionState);
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['phase0-campaign-index', session?.user.id],
    enabled: !!session,
    queryFn: async () => {
      const owned =
        (await makeRequest<Campaign[]>('find-campaign', {
          user_id: session?.user.id,
        })) ?? [];
      const ownCharacters =
        (await makeRequest<Character[]>('find-character', {
          user_id: session?.user.id,
        })) ?? [];
      const joinedIds = Array.from(
        new Set(ownCharacters.map((character) => character.campaign_id).filter((id): id is number => typeof id === 'number'))
      );
      const joined = (
        await Promise.all(
          joinedIds.map(async (id) => (await makeRequest<Campaign[]>('find-campaign', { id }, false)) ?? [])
        )
      ).flat();
      return uniqBy([...owned, ...joined], 'id');
    },
  });

  if (!session) return <CampaignSignIn variant='phase0' />;
  return (
    <div className='min-h-[calc(100dvh-72px)] bg-slate-950 px-6 py-6 text-slate-100'>
      <div className='mx-auto flex max-w-6xl flex-col gap-4'>
        <div className='flex items-start justify-between gap-4'>
          <div>
            <Badge variant='outline'>Phase 0 read-only</Badge>
            <h1 className='mt-3 text-3xl font-semibold tracking-normal'>Parallel Campaign UI</h1>
            <p className='mt-2 max-w-2xl text-sm text-slate-400'>
              Select a campaign to inspect existing campaign, player, and encounter data without mutating it.
            </p>
          </div>
          <PhaseViewSwitch current='phase0' />
        </div>
        {isLoading && <Card className='p-6 text-slate-400'>Loading campaigns...</Card>}
        {!isLoading && data?.length === 0 && <Card className='p-6 text-slate-400'>No owned or joined campaigns found.</Card>}
        <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
          {data?.map((campaign) => (
            <button
              key={campaign.id}
              className='rounded-lg border border-slate-800 bg-slate-900/70 p-4 text-left transition hover:border-sky-500/70 hover:bg-slate-900'
              onClick={() => navigate(`/phase0/campaign/${campaign.id}`)}
            >
              <div className='flex items-start justify-between gap-3'>
                <div>
                  <div className='text-lg font-semibold text-slate-100'>{campaign.name}</div>
                  <div className='mt-1 line-clamp-3 text-sm text-slate-400'>{campaign.description || 'No description.'}</div>
                </div>
                <ExternalLink className='mt-1 h-4 w-4 text-slate-500' />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Phase0CampaignPage({ campaignId, encounterId }: { campaignId: number; encounterId: number | null }) {
  const session = useAtomValue(sessionState);
  const navigate = useNavigate();
  const [selectedEncounterId, setSelectedEncounterId] = useState<number | null>(encounterId);
  const [selectedDetail, setSelectedDetail] = useState<SelectedDetail | null>(null);
  const [detailWidth, setDetailWidth] = useState(() => readStoredPaneWidth());
  const [activeDetailTab, setActiveDetailTab] = useState('summary');

  const campaignQuery = useQuery({
    queryKey: ['phase0-campaign', campaignId, session?.user.id],
    enabled: !!session,
    queryFn: async () => {
      const campaigns = await makeRequest<Campaign[]>('find-campaign', { id: campaignId });
      return campaigns?.[0] ?? null;
    },
  });

  const playersQuery = useQuery({
    queryKey: ['phase0-campaign-players', campaignId, session?.user.id],
    enabled: !!session,
    queryFn: async () => {
      return (await makeRequest<Character[]>('find-character', { campaign_id: campaignId })) ?? [];
    },
  });

  const encountersQuery = useQuery({
    queryKey: ['phase0-campaign-encounters', campaignId, session?.user.id],
    enabled: !!session,
    queryFn: async () => {
      return (await makeRequest<Encounter[]>('find-encounter', { campaign_id: campaignId })) ?? [];
    },
  });

  const campaign = campaignQuery.data;
  const players = playersQuery.data ?? [];
  const encounters = encountersQuery.data ?? [];
  const isGm = !!campaign && campaign.user_id === session?.user.id;
  const selectedEncounter = encounters.find((encounter) => encounter.id === selectedEncounterId) ?? encounters[0] ?? null;

  useEffect(() => {
    if (encounterId) setSelectedEncounterId(encounterId);
  }, [encounterId]);

  useEffect(() => {
    if (selectedEncounterId || !encounters[0]) return;
    setSelectedEncounterId(encounters[0].id);
    navigate(`/phase0/campaign/${campaignId}/encounters/${encounters[0].id}`, { replace: true });
  }, [campaignId, encounters, navigate, selectedEncounterId]);

  useEffect(() => {
    window.localStorage.setItem(PANE_STORAGE_KEY, `${detailWidth}`);
  }, [detailWidth]);

  const combatants = useMemo(() => populateCombatants(selectedEncounter?.combatants.list ?? [], players), [selectedEncounter, players]);

  useEffect(() => {
    if (!selectedDetail) return;
    const refreshed = combatants.find((combatant) => combatant._id === selectedDetail.combatant._id);
    if (!refreshed) setSelectedDetail(null);
  }, [combatants, selectedDetail]);

  const loading = campaignQuery.isLoading || playersQuery.isLoading || encountersQuery.isLoading;

  return (
    <div className='min-h-[calc(100dvh-72px)] overflow-hidden bg-slate-950 text-slate-100'>
      <div className='flex h-[calc(100dvh-72px)] min-h-[680px]'>
        <main className='min-w-[560px] flex-1 overflow-auto p-5'>
          <div className='mb-4 flex items-center justify-between gap-3'>
            <div>
              <div className='mb-2 flex flex-wrap items-center gap-2'>
                <Badge variant='outline'>Phase 0 read-only</Badge>
                <Badge variant={isGm ? 'success' : 'muted'}>{isGm ? 'GM view' : 'Player view'}</Badge>
                <PhaseViewSwitch current='phase0' campaignId={campaignId} encounterId={selectedEncounter?.id ?? null} />
              </div>
              <h1 className='text-2xl font-semibold tracking-normal'>{campaign?.name ?? 'Campaign'}</h1>
              <p className='mt-1 max-w-3xl text-sm text-slate-400'>{campaign?.description || 'No campaign description.'}</p>
            </div>
            <div className='flex items-center gap-2'>
              <span className='max-w-48 truncate text-xs text-slate-500' title={session?.user.email}>{session?.user.email}</span>
              <Button variant='outline' onClick={() => supabase.auth.signOut()}>Switch account</Button>
              <Button asChild variant='outline'><Link to='/phase0'>All campaigns</Link></Button>
            </div>
          </div>

          {loading && <Card className='p-6 text-slate-400'>Loading read-only campaign data...</Card>}
          {!loading && !campaign && <Card className='border-amber-700/50 p-6 text-amber-200'>Campaign {campaignId} is unavailable to the account shown above.</Card>}

          {!loading && campaign && (
            <div className='grid gap-4'>
              <Card>
                <CardHeader className='flex flex-row items-center justify-between gap-3'>
                  <CardTitle>Joined Players</CardTitle>
                  <Badge variant='muted'>{players.length} players</Badge>
                </CardHeader>
                <CardContent>
                  <div className='flex gap-2 overflow-x-auto pb-1'>
                    {players.length === 0 && <div className='text-sm text-slate-500'>No joined players visible to this user.</div>}
                    {players.map((player) => (
                      <a
                        key={player.id}
                        className='flex min-w-56 items-center gap-3 rounded-md border border-slate-800 bg-slate-900/70 px-3 py-2 hover:border-sky-500/60'
                        href={`${OLD_UI_ORIGIN}/sheet/${player.id}`}
                        target='_blank'
                        rel='noreferrer'
                      >
                        <div className='flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-950'>
                          <UserRound className='h-5 w-5 text-slate-400' />
                        </div>
                        <div className='min-w-0'>
                          <div className='truncate text-sm font-semibold'>{player.name}</div>
                          <div className='text-xs text-slate-500'>Lvl. {player.level}</div>
                        </div>
                        <ExternalLink className='ml-auto h-4 w-4 text-slate-500' />
                      </a>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <div className='grid grid-cols-[260px_minmax(0,1fr)] gap-4'>
                <Card className='overflow-hidden'>
                  <CardHeader>
                    <CardTitle>Encounters</CardTitle>
                  </CardHeader>
                  <CardContent className='px-2'>
                    <div className='grid gap-1'>
                      {encounters.length === 0 && <div className='px-2 pb-4 text-sm text-slate-500'>No visible encounters.</div>}
                      {encounters.map((encounter) => (
                        <button
                          key={encounter.id}
                          className={`rounded-md px-3 py-2 text-left text-sm transition ${
                            selectedEncounter?.id === encounter.id
                              ? 'bg-sky-500/15 text-sky-100 ring-1 ring-sky-500/40'
                              : 'text-slate-300 hover:bg-slate-900'
                          }`}
                          onClick={() => {
                            setSelectedEncounterId(encounter.id);
                            setSelectedDetail(null);
                            navigate(`/phase0/campaign/${campaignId}/encounters/${encounter.id}`, { replace: true });
                          }}
                        >
                          <div className='truncate font-medium'>{encounter.name}</div>
                          <div className='text-xs text-slate-500'>{encounter.combatants.list.length} combatants</div>
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card className='min-w-0 overflow-hidden'>
                  <CardHeader className='flex flex-row items-center justify-between gap-3'>
                    <div>
                      <CardTitle>{selectedEncounter?.name ?? 'Encounter'}</CardTitle>
                      <div className='mt-1 text-sm text-slate-500'>{selectedEncounter?.meta_data.description || 'No description.'}</div>
                    </div>
                    <Badge variant='outline'>{combatants.length} combatants</Badge>
                  </CardHeader>
                  <CardContent>
                    <CombatantGrid combatants={combatants} onSelect={setSelectedDetail} selectedId={selectedDetail?.combatant._id} />
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </main>

        <ResizeHandle onResize={(delta) => setDetailWidth((width) => clamp(width - delta, 320, 720))} />

        <aside className='shrink-0 border-l border-slate-800 bg-slate-950/95' style={{ width: detailWidth }}>
          <DetailPane detail={selectedDetail} activeTab={activeDetailTab} setActiveTab={setActiveDetailTab} />
        </aside>
      </div>
    </div>
  );
}

function CombatantGrid({
  combatants,
  selectedId,
  onSelect,
}: {
  combatants: PopulatedCombatant[];
  selectedId?: string;
  onSelect: (detail: SelectedDetail) => void;
}) {
  return (
    <div className='overflow-x-auto rounded-md border border-slate-800'>
      <table className='w-full min-w-[760px] border-collapse text-sm'>
        <thead className='bg-slate-900/90 text-xs uppercase tracking-normal text-slate-500'>
          <tr>
            <th className='w-24 px-3 py-2 text-left'>Init</th>
            <th className='px-3 py-2 text-left'>Combatant</th>
            <th className='w-56 px-3 py-2 text-left'>Defenses</th>
            <th className='w-36 px-3 py-2 text-left'>HP</th>
            <th className='w-16 px-3 py-2 text-left'>Actions</th>
          </tr>
        </thead>
        <tbody>
          {combatants.length === 0 && (
            <tr>
              <td colSpan={5} className='px-3 py-8 text-center text-slate-500'>
                No combatants in this encounter.
              </td>
            </tr>
          )}
          {combatants.map((combatant) => {
            const stats = getComputedStats(combatant.data);
            const hp = combatant.data.hp_current ?? stats.maxHp;
            const detailsVisible = combatant.access?.details_revealed !== false;
            return (
              <tr
                key={combatant._id}
                className={`border-t border-slate-800 transition hover:bg-slate-900/70 ${
                  selectedId === combatant._id ? 'bg-sky-500/10' : ''
                }`}
              >
                <td className='px-3 py-2 align-middle'>
                  <input
                    aria-label={`${combatant.data.name} initiative`}
                    className='h-9 w-16 rounded-md border border-slate-700 bg-slate-950 px-2 text-center text-slate-300 disabled:opacity-100'
                    type='number'
                    value={combatant.initiative ?? ''}
                    disabled
                    readOnly
                    placeholder='Init.'
                  />
                </td>
                <td className='px-3 py-2 align-middle'>
                  <button
                    className='flex w-full items-center gap-3 rounded-md p-1 text-left hover:bg-slate-800/80'
                    onClick={() => detailsVisible && onSelect({ type: combatant.type, combatant } as SelectedDetail)}
                  >
                    <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-950'>
                      {combatant.type === 'CREATURE' ? <Swords className='h-5 w-5 text-rose-300' /> : <UserRound className='h-5 w-5 text-sky-300' />}
                    </div>
                    <div className='min-w-0'>
                      <div className='flex items-center gap-2'>
                        <span className='truncate font-semibold text-slate-100'>{combatant.data.name}</span>
                        {combatant.type === 'CHARACTER' && <ExternalLink className='h-3.5 w-3.5 text-slate-500' />}
                      </div>
                      <div className='text-xs text-slate-500'>Lvl. {combatant.data.level}</div>
                    </div>
                  </button>
                </td>
                <td className='px-3 py-2 align-middle text-slate-400'>
                  {detailsVisible ? (
                    <><span>{stats.ac} AC</span><span className='px-1 text-slate-700'>|</span><span>Fort. {sign(stats.fort)}, </span><span>Ref. {sign(stats.reflex)}, </span><span>Will {sign(stats.will)}</span></>
                  ) : <span className='text-slate-600'>Hidden</span>}
                </td>
                <td className='px-3 py-2 align-middle'>
                  <div className='inline-flex h-9 min-w-24 items-center justify-center rounded-md border border-slate-700 bg-slate-950 px-3 text-slate-300'>
                    {detailsVisible ? <><span>{hp}</span><span className='px-3 text-slate-600'>/</span><span>{stats.maxHp}</span></> : <span className='text-slate-600'>Hidden</span>}
                  </div>
                </td>
                <td className='px-3 py-2 align-middle'>
                  <Button variant='ghost' size='icon' disabled title='Read-only in Phase 0'>
                    <PanelRightOpen className='h-4 w-4' />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DetailPane({
  detail,
  activeTab,
  setActiveTab,
}: {
  detail: SelectedDetail | null;
  activeTab: string;
  setActiveTab: (value: string) => void;
}) {
  const creatureId = detail?.type === 'CREATURE' ? detail.combatant.creature?.id : undefined;
  const creatureQuery = useQuery({
    queryKey: ['phase0-creature-detail', creatureId],
    enabled: !!creatureId,
    queryFn: async () => fetchContentById<Creature>('creature', creatureId!),
  });

  if (!detail) {
    return (
      <div className='flex h-full flex-col items-center justify-center p-8 text-center text-slate-500'>
        <Shield className='mb-3 h-10 w-10' />
        <div className='text-sm'>Select a combatant to inspect read-only details.</div>
      </div>
    );
  }

  if (detail.type === 'CHARACTER') {
    return (
      <div className='p-5'>
        <Badge variant='outline'>PC</Badge>
        <h2 className='mt-3 text-2xl font-semibold tracking-normal'>{detail.combatant.data.name}</h2>
        <p className='mt-2 text-sm text-slate-400'>PC sheets stay in the current UI during Phase 0.</p>
        <Button className='mt-4' asChild>
          <a href={`${OLD_UI_ORIGIN}/sheet/${detail.combatant.character}`} target='_blank' rel='noreferrer'>
            Open sheet on 5193
            <ExternalLink className='h-4 w-4' />
          </a>
        </Button>
      </div>
    );
  }

  const creature = creatureQuery.data ?? detail.combatant.creature;
  const stats = getComputedStats(detail.combatant.data);

  return (
    <div className='flex h-full flex-col'>
      <div className='border-b border-slate-800 p-5'>
        <div className='flex items-start justify-between gap-3'>
          <div>
            <Badge variant='outline'>Creature</Badge>
            <h2 className='mt-3 text-2xl font-semibold tracking-normal'>{detail.combatant.data.name}</h2>
          </div>
          <div className='text-right text-sm text-slate-400'>Creature {detail.combatant.data.level}</div>
        </div>
      </div>
      <div className='flex-1 overflow-auto p-5'>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className='grid w-full grid-cols-3'>
            <TabsTrigger value='summary'>Summary</TabsTrigger>
            <TabsTrigger value='notes'>Notes</TabsTrigger>
            <TabsTrigger value='details'>Details</TabsTrigger>
          </TabsList>
          <TabsContent value='summary'>
            <div className='grid gap-3'>
              <Stat label='Hit Points' value={`${detail.combatant.data.hp_current} / ${stats.maxHp}`} />
              <Stat label='Armor Class' value={`${stats.ac}`} />
              <Stat label='Fortitude' value={sign(stats.fort)} />
              <Stat label='Reflex' value={sign(stats.reflex)} />
              <Stat label='Will' value={sign(stats.will)} />
            </div>
          </TabsContent>
          <TabsContent value='notes'>
            <ReadOnlyText title='Creature Notes' value={notesSummary(detail.combatant.data.notes)} />
          </TabsContent>
          <TabsContent value='details'>
            <ReadOnlyText
              title='Description'
              value={creatureQuery.isLoading ? 'Loading creature details...' : creature?.details?.description || 'No description available.'}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-center justify-between rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2'>
      <span className='text-sm text-slate-400'>{label}</span>
      <span className='font-semibold text-slate-100'>{value}</span>
    </div>
  );
}

function ReadOnlyText({ title, value }: { title: string; value: string }) {
  return (
    <div className='rounded-md border border-slate-800 bg-slate-900/60 p-3'>
      <div className='mb-2 text-sm font-semibold text-slate-200'>{title}</div>
      <div className='whitespace-pre-wrap text-sm leading-6 text-slate-400'>{value}</div>
    </div>
  );
}

function ResizeHandle({ onResize }: { onResize: (delta: number) => void }) {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    let lastX = 0;
    const onMove = (event: MouseEvent) => {
      if (lastX === 0) {
        lastX = event.clientX;
        return;
      }
      const delta = event.clientX - lastX;
      lastX = event.clientX;
      onResize(delta);
    };
    const onUp = () => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, onResize]);

  return (
    <button
      className='w-1.5 cursor-col-resize bg-slate-900 transition hover:bg-sky-500 focus:bg-sky-500 focus:outline-none'
      aria-label='Resize detail pane'
      onMouseDown={() => setDragging(true)}
      type='button'
    />
  );
}

function populateCombatants(combatants: Combatant[], players: Character[]): PopulatedCombatant[] {
  return combatants
    .map((combatant) => {
      if (combatant.type === 'CHARACTER') {
        const character = players.find((player) => player.id === combatant.character) ?? combatant.data;
        return character ? { ...combatant, data: character } : null;
      }
      const creature = combatant.creature ?? combatant.data;
      return creature ? { ...combatant, data: creature } : null;
    })
    .filter((combatant): combatant is PopulatedCombatant => Boolean(combatant));
}

function getComputedStats(entity: LivingEntity): ComputedStats {
  const profs = entity.meta_data?.calculated_stats?.profs;
  return {
    ac: entity.meta_data?.calculated_stats?.ac ?? 10,
    fort: profs?.SAVE_FORT?.total ?? 0,
    reflex: profs?.SAVE_REFLEX?.total ?? 0,
    will: profs?.SAVE_WILL?.total ?? 0,
    maxHp: entity.meta_data?.calculated_stats?.hp_max ?? entity.hp_current ?? 0,
  };
}

function notesSummary(notes: LivingEntity['notes']) {
  if (!notes?.pages?.length) return 'No notes available.';
  return notes.pages.map((page) => page.name).join('\n');
}

function readStoredPaneWidth() {
  const stored = parseInt(window.localStorage.getItem(PANE_STORAGE_KEY) ?? '420');
  return clamp(Number.isFinite(stored) ? stored : 420, 320, 720);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}








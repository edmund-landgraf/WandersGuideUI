import './phase-view-switch.css';

export const OLD_UI_ORIGIN = import.meta.env.VITE_OLD_UI_ORIGIN || 'http://localhost:5193';

export type PhaseView = 'phase0' | 'phase1';

export type PhaseLocation = {
  campaignId?: number | null;
  encounterId?: number | null;
  noteIndex?: number | null;
  viewingSettings?: boolean;
};

export function phaseWorkspacePath(phase: PhaseView, location: PhaseLocation = {}): string {
  if (!location.campaignId) return `/${phase}`;
  if (phase === 'phase1') {
    if (location.viewingSettings) return `/phase1/campaign/${location.campaignId}/settings`;
    if (location.noteIndex != null) return `/phase1/campaign/${location.campaignId}/notes/${location.noteIndex}`;
    if (location.encounterId != null) return `/phase1/campaign/${location.campaignId}/encounters/${location.encounterId}`;
    return `/phase1/campaign/${location.campaignId}`;
  }
  if (location.encounterId != null) return `/phase0/campaign/${location.campaignId}/encounters/${location.encounterId}`;
  return `/phase0/campaign/${location.campaignId}`;
}

export function originalCampaignUrl(location: PhaseLocation = {}): string {
  if (!location.campaignId) return `${OLD_UI_ORIGIN}/campaigns`;
  const params = new URLSearchParams();
  if (location.viewingSettings) {
    params.set('tab', 'settings');
  } else if (location.noteIndex != null) {
    params.set('tab', 'notes');
  } else {
    params.set('tab', 'encounters');
    if (location.encounterId != null) params.set('encounter', String(location.encounterId));
  }
  return `${OLD_UI_ORIGIN}/campaign/${location.campaignId}?${params.toString()}`;
}

export function PhaseViewSwitch({ current, campaignId, encounterId, noteIndex, viewingSettings }: PhaseLocation & { current: PhaseView }) {
  const location = { campaignId, encounterId, noteIndex, viewingSettings };
  const phase0Href = phaseWorkspacePath('phase0', location);
  const phase1Href = phaseWorkspacePath('phase1', location);
  const originalHref = originalCampaignUrl(location);

  return (
    <nav className='phase-view-switch' data-current={current} aria-label='Interface version'>
      <a href={phase0Href} aria-current={current === 'phase0' ? 'page' : undefined} title='Switch to Phase 0 in this window'>
        Phase 0
      </a>
      <a href={phase1Href} aria-current={current === 'phase1' ? 'page' : undefined} title='Switch to Phase 1 in this window'>
        Phase 1
      </a>
      <a className='phase-view-switch-original' href={originalHref} target='_blank' rel='noreferrer' title='Open the original campaign tab for this encounter'>
        Original
      </a>
    </nav>
  );
}

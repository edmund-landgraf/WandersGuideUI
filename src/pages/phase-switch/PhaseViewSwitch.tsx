import { persistPreferredPhase, PHASE1_PREFERRED_PHASE_KEY } from '../phase1/display-prefs';
import { useEffect } from 'react';
import './phase-view-switch.css';

export const OLD_UI_ORIGIN = import.meta.env.VITE_OLD_UI_ORIGIN || 'http://localhost:5193';

export type PhaseView = 'phase0' | 'phase1';

export type PhaseLocation = {
  section?: 'campaigns' | 'characters';
  campaignId?: number | null;
  encounterId?: number | null;
  noteIndex?: number | null;
  viewingSettings?: boolean;
};

export function phaseWorkspacePath(phase: PhaseView, location: PhaseLocation = {}): string {
  if (!location.campaignId) {
    if (phase === 'phase1' && location.section === 'characters') return '/phase1/characters';
    return `/${phase}`;
  }
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
  if (location.section === 'characters') return `${OLD_UI_ORIGIN}/characters`;
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

export function PhaseViewSwitch({ current, section, campaignId, encounterId, noteIndex, viewingSettings }: PhaseLocation & { current: PhaseView }) {
  useEffect(() => {
    try {
      localStorage.setItem(PHASE1_PREFERRED_PHASE_KEY, current);
    } catch {
      /* ignore */
    }
  }, [current]);
  const location = { section, campaignId, encounterId, noteIndex, viewingSettings };
  const phase0Href = phaseWorkspacePath('phase0', location);
  const phase1Href = phaseWorkspacePath('phase1', location);
  const originalHref = originalCampaignUrl(location);
  const originalTitle = section === 'characters'
    ? 'Open the original characters page'
    : campaignId
      ? 'Open the original campaign tab for this encounter'
      : 'Open the original campaigns page';

  return (
    <nav className='phase-view-switch' data-current={current} aria-label='Interface version'>
      <a
        href={phase0Href}
        aria-current={current === 'phase0' ? 'page' : undefined}
        title='Switch to Phase 0 in this window'
        onClick={() => persistPreferredPhase('phase0')}
      >
        Phase 0
      </a>
      <a
        href={phase1Href}
        aria-current={current === 'phase1' ? 'page' : undefined}
        title='Switch to Phase 1 in this window'
        onClick={() => persistPreferredPhase('phase1')}
      >
        Phase 1
      </a>
      <a className='phase-view-switch-original' href={originalHref} target='_blank' rel='noreferrer' title={originalTitle}>
        Original
      </a>
    </nav>
  );
}

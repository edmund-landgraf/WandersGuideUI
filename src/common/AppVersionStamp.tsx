import generatedStamp from '../generated/appVersion.json';
import {
  FALLBACK_APP_VERSION_STAMP,
  formatAppVersionLabel,
  formatAppVersionTitle,
  type AppVersionStamp,
} from '@utils/appVersion';

function clientStamp(): AppVersionStamp {
  if (!generatedStamp?.version) return FALLBACK_APP_VERSION_STAMP;
  return generatedStamp;
}

const REPO_URL = 'https://github.com/edmund-landgraf/WandersGuideUI';

export function AppVersionStamp() {
  const stamp = clientStamp();
  const href = stamp.shortSha === 'unknown' ? REPO_URL : `${REPO_URL}/commit/${stamp.shortSha}`;
  return (
    <a
      className='app-version-stamp'
      href={href}
      target='_blank'
      rel='noreferrer'
      title={formatAppVersionTitle(stamp)}
      style={{
        margin: 0,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: '0.8rem',
        lineHeight: 1.4,
        letterSpacing: '0.02em',
        color: '#d1d5db',
        whiteSpace: 'nowrap',
        textDecoration: 'none',
      }}
    >
      {formatAppVersionLabel(stamp)}
    </a>
  );
}

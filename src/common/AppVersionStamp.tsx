import {
  FALLBACK_APP_VERSION_STAMP,
  formatAppVersionLabel,
  formatAppVersionTitle,
} from '@utils/appVersion';

const REPO_URL = 'https://github.com/edmund-landgraf/WandersGuideUI';

export function AppVersionStamp() {
  const stamp = FALLBACK_APP_VERSION_STAMP;
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

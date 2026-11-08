// After `vite build`, campaign videos live in the repo `videos/` directory, which
// is gitignored. `serve -s` only serves `dist/`. Point dist/videos at that directory.
import fs from 'node:fs';
import path from 'node:path';

export function linkDistVideos(repoRoot) {
  const videosDir = path.resolve(repoRoot, 'videos');
  const link = path.resolve(repoRoot, 'dist/videos');
  if (!fs.existsSync(videosDir)) return false;
  fs.mkdirSync(path.resolve(repoRoot, 'dist'), { recursive: true });
  fs.rmSync(link, { recursive: true, force: true });
  fs.symlinkSync(videosDir, link, 'dir');
  return true;
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { linkDistVideos } from './link-dist-videos.mjs';

describe('linkDistVideos', () => {
  it('replaces dist/videos with a symlink to the repo videos directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wgui-videos-'));
    const videos = path.join(root, 'videos');
    fs.mkdirSync(videos);
    fs.writeFileSync(path.join(videos, 'clip.mp4'), 'clip');
    fs.mkdirSync(path.join(root, 'dist/videos'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dist/videos/stale.txt'), 'stale');
    assert.equal(linkDistVideos(root), true);
    const link = path.join(root, 'dist/videos');
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(path.join(link, 'clip.mp4'), 'utf8'), 'clip');
    assert.equal(fs.existsSync(path.join(link, 'stale.txt')), false);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('leaves dist alone when the repo has no videos directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wgui-novid-'));
    fs.mkdirSync(path.join(root, 'dist'));
    assert.equal(linkDistVideos(root), false);
    assert.equal(fs.existsSync(path.join(root, 'dist/videos')), false);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

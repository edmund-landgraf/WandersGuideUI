import { describe, expect, it } from 'vitest';
import { sourceHasHomebreweryTable, toHomebreweryV3 } from './homebrewery-v3';

describe('toHomebreweryV3', () => {
  it('converts a standard 3-column class grid without {{wide}}', () => {
    const html = `
      <h2>Class Features</h2>
      <table>
        <tr><th>Level</th><th>Proficiency</th><th>Features</th></tr>
        <tr><td>1</td><td>+2</td><td>Rage</td></tr>
        <tr><td>2</td><td>+2</td><td>Reckless Attack</td></tr>
      </table>
    `;
    const out = toHomebreweryV3(html);
    expect(out).toContain('## Class Features');
    expect(out).toContain('| Level | Proficiency | Features |');
    expect(out).toContain('| --- | --- | --- |');
    expect(out).toContain('| 1 | +2 | Rage |');
    expect(out).not.toContain('{{wide');
  });

  it('wraps a 4-column table in {{wide}} and keeps the heading inside the band', () => {
    const html = `
      <h2>Skill Checks</h2>
      <p>Short intro.</p>
      <table>
        <tr><th>Obstacle</th><th>DC</th><th>Skill</th><th>Notes</th></tr>
        <tr><td>Rope</td><td>15</td><td>Athletics</td><td>Climb</td></tr>
      </table>
    `;
    const out = toHomebreweryV3(html);
    expect(out).toMatch(/\{\{wide\n## Skill Checks\n\nShort intro\.\n\n\| Obstacle \| DC \| Skill \| Notes \|/);
    expect(out).toContain('| Rope | 15 | Athletics | Climb |');
    expect(out).toContain('}}');
  });

  it('emits alignment, colspan, and rowspan for reliable HTML', () => {
    const html = `<table>
      <tr>
        <th>Head A</th>
        <th colspan="2" align="center">Spanned Header</th>
      </tr>
      <tr>
        <td rowspan="2">2A</td>
        <td>2B</td>
        <td>2C</td>
      </tr>
      <tr>
        <td>3B</td>
        <td>3C</td>
      </tr>
    </table>`;
    const out = toHomebreweryV3(html);
    expect(out).toContain('| Head A | Spanned Header ||');
    expect(out).toMatch(/\| --- \| :---: \| :---: \|/);
    expect(out).toContain('| 2A | 2B | 2C |');
    expect(out).toContain('|  ^| 3B | 3C |');
  });

  it('wraps existing 4-column pipe tables', () => {
    const md = '| A | B | C | D |\n| --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 |';
    const out = toHomebreweryV3(md);
    expect(out).toContain('{{wide');
    expect(out).toContain('| A | B | C | D |');
  });
});

describe('sourceHasHomebreweryTable', () => {
  it('detects HTML and pipe tables', () => {
    expect(sourceHasHomebreweryTable('<p>no table</p>')).toBe(false);
    expect(sourceHasHomebreweryTable('<table><tr><th>A</th></tr></table>')).toBe(true);
    expect(sourceHasHomebreweryTable('| A | B |\n| --- | --- |\n| 1 | 2 |')).toBe(true);
  });
});

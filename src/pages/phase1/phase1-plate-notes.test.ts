import { upsertLink } from '@platejs/link';
import { describe, expect, it } from 'vitest';
import { insertNoteLink } from './phase1-note-links';
import { applySavedNotes, createNotesEditor, roundTripNotesMarkdown } from './phase1-plate-notes';

const formatted = ['# Notes', '', '**Joerg** is a *dedicated* warrior.', '', '## Gear', '', '- longsword', '- shield', '', '`action_symbol_1` Strike', '', '[Archives](https://2e.aonprd.com)'].join('\n');

describe('sheet notes markdown round trip', () => {
  it('keeps formatting after save and reload', () => {
    const saved = roundTripNotesMarkdown(formatted);
    const reloaded = roundTripNotesMarkdown(saved);

    expect(saved).toContain('**Joerg**');
    expect(saved).toMatch(/\*dedicated\*|_dedicated_/);
    expect(saved).toMatch(/gear/i);
    expect(saved).toContain('longsword');
    expect(saved).toContain('action_symbol_1');
    expect(saved).toContain('https://2e.aonprd.com');
    expect(reloaded).toBe(saved);
  });

  it('keeps a Wanderer\'s Guide condition link', () => {
    const saved = roundTripNotesMarkdown('See [Hidden](<link_condition_hidden>) nearby.');
    expect(saved).toContain('[Hidden](<link_condition_hidden>)');
    expect(roundTripNotesMarkdown(saved)).toBe(saved);
  });

  it('keeps the cursor after a delayed save of an action symbol and a guide link', () => {
    const editor = createNotesEditor('Strike');
    const end = editor.api.end([]);
    expect(end).toBeTruthy();
    editor.tf.select(end!);
    editor.tf.insertNodes({ type: 'actionSymbol', cost: 'ONE-ACTION', symbol: '1', children: [{ text: '' }] });
    editor.tf.move({ unit: 'offset' });
    editor.tf.insertText('Hidden');
    const point = editor.selection?.anchor;
    expect(point).toBeTruthy();
    editor.tf.select({
      anchor: { path: point!.path, offset: Math.max(0, point!.offset - 'Hidden'.length) },
      focus: point!,
    });
    upsertLink(editor, { url: 'link_condition_hidden', skipValidation: true });
    editor.tf.collapse({ edge: 'end' });
    const caret = structuredClone(editor.selection);
    expect(caret).toBeTruthy();

    const saved = roundTripNotesMarkdown('`action_symbol_1` StrikeHidden');
    applySavedNotes(editor, saved, 'Strike');

    expect(editor.selection).toBeTruthy();
    expect(editor.api.string(editor)).toContain('Strike');
    expect(roundTripNotesMarkdown(saved)).toContain('action_symbol_1');
    expect(roundTripNotesMarkdown(saved)).toContain('Hidden');
  });

  it('ends a Wanderer\'s Guide link so the next text is not linked', () => {
    const editor = createNotesEditor('');
    const end = editor.api.end([]);
    expect(end).toBeTruthy();
    editor.tf.select(end!);
    insertNoteLink(editor, 'link_condition_hidden', 'Coerce');
    editor.tf.insertText(' went');

    const stillInLink = editor.api.above({
      match: (node) => {
        const type = (node as { type?: string }).type;
        return type === 'a' || type === 'link';
      },
    });
    expect(stillInLink).toBeUndefined();
    const saved = roundTripNotesMarkdown(editor.api.markdown.serialize());
    expect(saved).toContain('[Coerce](<link_condition_hidden>)');
    expect(saved).toContain('went');
    expect(saved).not.toContain('[Coerce went]');
  });

  it('keeps a blank line created with enter', () => {
    const saved = roundTripNotesMarkdown('First line\n\nSecond line');
    expect(saved).toContain('First line');
    expect(saved).toContain('Second line');
    expect(saved).toMatch(/First line\n\nSecond line/);
  });
});

import { Button, Group, Stack, Textarea } from '@mantine/core';
import { LivingEntity } from '@schemas/content';
import { SetterOrUpdater } from '@utils/type-fixing';
import { useEffect, useRef, useState } from 'react';
import { gmNotesText, insertGmNoteStamp, toGmNotes } from './gm-notes';

export default function GmNotesPanel(props: {
  panelHeight: number;
  panelWidth: number;
  entity: LivingEntity | null;
  setEntity: SetterOrUpdater<LivingEntity | null>;
}) {
  const saved = gmNotesText(props.entity?.notes);
  const entityKey = `${props.entity?.id ?? ''}:${props.entity?.name ?? ''}`;
  const [draft, setDraft] = useState(saved);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(draft);
  const entityRef = useRef(props.entity);
  const setEntityRef = useRef(props.setEntity);
  draftRef.current = draft;
  entityRef.current = props.entity;
  setEntityRef.current = props.setEntity;

  useEffect(() => {
    setDraft(saved);
  }, [entityKey, saved]);

  const persist = (entity: LivingEntity | null, text: string) => {
    if (!entity || text === gmNotesText(entity.notes)) return;
    setEntityRef.current({
      ...entity,
      notes: toGmNotes(text, entity.notes),
    });
  };

  useEffect(() => {
    if (!props.entity || draft === saved) return;
    const entity = props.entity;
    const text = draft;
    const timer = window.setTimeout(() => persist(entity, text), 1000);
    return () => window.clearTimeout(timer);
  }, [draft, saved, entityKey]);

  useEffect(() => {
    return () => persist(entityRef.current, draftRef.current);
  }, []);

  const save = () => persist(props.entity, draft);

  const insertStamp = () => {
    const cursor = textareaRef.current?.selectionStart ?? draft.length;
    const next = insertGmNoteStamp(draft, cursor);
    setDraft(next.text);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  return (
    <Stack gap={8} h={props.panelHeight}>
      <Textarea
        ref={textareaRef}
        placeholder='Creature is burning for 3 rounds...'
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        autosize={false}
        styles={{
          root: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 },
          wrapper: { flex: 1, display: 'flex' },
          input: { flex: 1, height: '100%', minHeight: 0 },
        }}
      />
      <Group justify='space-between' gap={8}>
        <Button variant='light' color='gray' onClick={insertStamp}>
          Date/Time
        </Button>
        <Group gap={8}>
          <Button variant='light' color='gray' onClick={() => setDraft('')} disabled={!draft}>
            Clear
          </Button>
          <Button onClick={save} disabled={!props.entity || draft === saved}>
            Save
          </Button>
        </Group>
      </Group>
    </Stack>
  );
}

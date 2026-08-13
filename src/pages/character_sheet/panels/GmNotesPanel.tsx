import { Button, Group, Stack, Textarea } from '@mantine/core';
import { LivingEntity } from '@schemas/content';
import { SetterOrUpdater } from '@utils/type-fixing';
import { useEffect, useState } from 'react';
import { gmNotesText, toGmNotes } from './gm-notes';

export default function GmNotesPanel(props: {
  panelHeight: number;
  panelWidth: number;
  entity: LivingEntity | null;
  setEntity: SetterOrUpdater<LivingEntity | null>;
}) {
  const saved = gmNotesText(props.entity?.notes);
  const entityKey = `${props.entity?.id ?? ''}:${props.entity?.name ?? ''}`;
  const [draft, setDraft] = useState(saved);

  useEffect(() => {
    setDraft(saved);
  }, [entityKey, saved]);

  const save = () => {
    if (!props.entity) return;
    props.setEntity({
      ...props.entity,
      notes: toGmNotes(draft, props.entity.notes),
    });
  };

  return (
    <Stack gap={8} h={props.panelHeight}>
      <Textarea
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
      <Group justify='flex-end' gap={8}>
        <Button variant='light' color='gray' onClick={() => setDraft('')} disabled={!draft}>
          Clear
        </Button>
        <Button onClick={save} disabled={!props.entity || draft === saved}>
          Save
        </Button>
      </Group>
    </Stack>
  );
}

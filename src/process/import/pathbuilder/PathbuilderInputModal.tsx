import { PathbuilderImportSource } from '@import/pathbuilder/import-from-pathbuilder';
import { Button, FileButton, Group, Modal, NumberInput, Stack, Text, Title } from '@mantine/core';
import { useState } from 'react';

export default function PathbuilderInputModal(props: {
  open: boolean;
  onConfirm: (source: PathbuilderImportSource) => void;
  onClose: () => void;
}) {
  const [pathbuilderId, setPathbuilderId] = useState<number>();
  const [file, setFile] = useState<File | null>(null);

  const canImport = Boolean(file) || Boolean(pathbuilderId);

  return (
    <Modal
      opened={props.open}
      onClose={() => props.onClose()}
      title={<Title order={3}>Import from Pathbuilder 2e</Title>}
      zIndex={1000}
    >
      <Stack style={{ position: 'relative' }} gap={20}>
        <NumberInput
          label='Pathbuilder 2e JSON ID'
          placeholder='123456'
          value={pathbuilderId}
          onChange={(val) => setPathbuilderId(parseInt(`${val}`))}
        />

        <FileButton onChange={setFile} accept='application/json,.json'>
          {(buttonProps) => (
            <Button variant='default' {...buttonProps}>
              {file ? file.name : 'Or upload Export JSON'}
            </Button>
          )}
        </FileButton>

        <Text fs='italic' fz='sm'>
          Some feats, items, and spells may be missing after import. Pathbuilder names often differ from Paizo’s
          Community Use Policy names, and the public JSON omits some builder choices. If the JSON ID fetch is blocked
          by the browser, use Pathbuilder’s Export JSON file instead. Runes, containers, formulas, and companions are
          not imported.
        </Text>

        <Group justify='flex-end'>
          <Button variant='default' onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            disabled={!canImport}
            onClick={() => {
              if (file) {
                props.onConfirm({ file });
                return;
              }
              if (!pathbuilderId) return;
              props.onConfirm(pathbuilderId);
            }}
          >
            Import
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

import RichText from '@common/RichText';
import { Box, ScrollArea, Stack, Text } from '@mantine/core';
import { LivingEntity } from '@schemas/content';
import { notePageToMarkdown, sourceImportPages } from './gm-notes';

export default function SourceImportPanel(props: {
  panelHeight: number;
  panelWidth: number;
  entity: LivingEntity | null;
}) {
  const pages = sourceImportPages(props.entity?.notes).filter((page) => notePageToMarkdown(page.contents));

  if (pages.length === 0) {
    return (
      <Text c='dimmed' p='md' size='sm'>
        No source import info.
      </Text>
    );
  }

  return (
    <ScrollArea h={props.panelHeight} scrollbars='y'>
      <Stack gap='md' p={4}>
        {pages.map((page, index) => (
          <Box key={`${page.name ?? 'source'}-${index}`}>
            {pages.length > 1 && page.name && (
              <Text fw={600} size='sm' mb={6}>
                {page.name}
              </Text>
            )}
            <RichText fz='sm'>{notePageToMarkdown(page.contents)}</RichText>
          </Box>
        ))}
      </Stack>
    </ScrollArea>
  );
}

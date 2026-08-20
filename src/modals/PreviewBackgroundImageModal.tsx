import { Anchor, BackgroundImage, Box, Button, Group, Stack, Text } from '@mantine/core';
import { ContextModalProps } from '@mantine/modals';
import { IconBrush } from '@tabler/icons-react';
import { ImageOption } from '@schemas/index';

export default function PreviewBackgroundImageModal({
  context,
  id,
  innerProps,
}: ContextModalProps<{
  option: ImageOption;
  onSelect?: (option: ImageOption) => void;
  galleryModalId?: string;
  viewOnly?: boolean;
}>) {
  const { option, onSelect, galleryModalId, viewOnly } = innerProps;

  return (
    <Box pos='relative' h='80dvh' mx={-16} mb={-16} mt={-8} style={{ overflow: 'hidden', borderRadius: 8 }}>
      <BackgroundImage src={option.url} radius={0} w='100%' h='100%' style={{ backgroundPosition: 'top' }}>
        <Stack justify='space-between' h='100%' p='md'>
          <Box>
            {option.name && (
              <Text size='lg' fw={600} c='gray.0' style={{ textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
                {option.name}
              </Text>
            )}
            {option.source?.trim() && (
              <Anchor href={option.source_url} target='_blank' underline='hover'>
                <Text size='sm' c='gray.2' style={{ textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
                  <IconBrush size='0.7rem' /> {option.source}
                </Text>
              </Anchor>
            )}
          </Box>
          <Group justify='flex-end'>
            <Button variant='default' onClick={() => context.closeModal(id)}>
              {viewOnly || !onSelect ? 'Close' : 'Back'}
            </Button>
            {!viewOnly && onSelect && (
              <Button
                onClick={() => {
                  onSelect(option);
                  context.closeModal(id);
                  if (galleryModalId) context.closeModal(galleryModalId);
                }}
              >
                Use this artwork
              </Button>
            )}
          </Group>
        </Stack>
      </BackgroundImage>
    </Box>
  );
}

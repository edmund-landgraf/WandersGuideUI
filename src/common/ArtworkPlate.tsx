import { characterState } from '@atoms/characterAtoms';
import { Anchor, Box, Image, Stack, Text } from '@mantine/core';
import { IconBrush } from '@tabler/icons-react';
import { getAnchorStyles } from '@utils/anchor';
import { getAllBackgroundImages } from '@utils/background-images';
import { phoneQuery } from '@utils/mobile-responsive';
import { useMediaQuery } from '@mantine/hooks';
import { useAtomValue } from 'jotai';

export default function ArtworkPlate() {
  const isPhone = useMediaQuery(phoneQuery());
  const character = useAtomValue(characterState);
  const url = character?.details?.background_image_url;

  if (isPhone || !url) return null;

  const option = getAllBackgroundImages().find((image) => image.url === url) ?? {
    name: 'Custom',
    url,
  };

  return (
    <Box
      w={180}
      style={[
        getAnchorStyles({ r: 10, b: 8 }),
        {
          zIndex: 1,
          pointerEvents: 'auto',
        },
      ]}
    >
      <Image src={option.url} radius='md' h={110} fit='cover' alt={option.name ?? 'Background artwork'} />
      <Stack gap={0} mt={4}>
        {option.name && (
          <Text size='xs' lineClamp={1}>
            {option.name}
          </Text>
        )}
        {option.source?.trim() && (
          <Anchor href={option.source_url} target='_blank' underline='hover'>
            <Text size='xs' c='dimmed' lineClamp={1}>
              <IconBrush size='0.55rem' /> {option.source}
            </Text>
          </Anchor>
        )}
      </Stack>
    </Box>
  );
}

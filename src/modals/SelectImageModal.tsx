import { getCachedPublicUser } from '@auth/user-manager';
import classes from '@css/ActionsGrid.module.css';
import {
  Avatar,
  Box,
  Card,
  FileButton,
  HoverCard,
  Image,
  LoadingOverlay,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { ContextModalProps, openContextModal } from '@mantine/modals';
import { showNotification } from '@mantine/notifications';
import { IconBrush, IconUpload } from '@tabler/icons-react';
import { ImageOption } from '@schemas/index';
import { uploadImage } from '@upload/image-upload';
import { isValidImage } from '@utils/images';
import { displayPatronOnly } from '@utils/notifications';
import { hasPatreonAccess } from '@utils/patreon';
import { useState } from 'react';

export default function SelectImageModal({
  context,
  id,
  innerProps,
}: ContextModalProps<{
  options: ImageOption[];
  onSelect: (option: ImageOption) => void;
  category: string;
  variant?: 'compact' | 'gallery';
}>) {
  const [loading, setLoading] = useState(false);
  const isGallery = innerProps.variant === 'gallery';

  const commitUpload = async (file: File | null) => {
    if (!hasPatreonAccess(getCachedPublicUser(), 1)) {
      displayPatronOnly();
      return;
    }

    let path = '';
    if (file) {
      setLoading(true);
      path = await uploadImage(file, innerProps.category);
    }

    const valid = await isValidImage(path);
    if (!valid) {
      showNotification({
        title: 'Invalid Image',
        message: 'Your image failed to upload. It may be too large or not an image file.',
        color: 'red',
      });
    }

    const option: ImageOption = {
      name: 'Uploaded Image',
      url: path,
      source: 'upload',
    };

    innerProps.onSelect(option);
    context.closeModal(id);
    setLoading(false);
  };

  const uploadTile = (
    <FileButton onChange={commitUpload} accept='image/png,image/jpeg,image/jpg,image/webp'>
      {(subProps) => (
        <HoverCard shadow='md' openDelay={500} position='bottom' withinPortal>
          <HoverCard.Target>
            <UnstyledButton {...subProps} className={classes.item} style={isGallery ? { height: 160 } : undefined}>
              <Avatar size={50} radius={'xl'}>
                <IconUpload size='1.5rem' />
              </Avatar>
            </UnstyledButton>
          </HoverCard.Target>
          <HoverCard.Dropdown py={5} px={10}>
            <Text size='sm'>Upload Image</Text>
            <Text size='xs' c='dimmed'>
              Max file size: 1MB
            </Text>
          </HoverCard.Dropdown>
        </HoverCard>
      )}
    </FileButton>
  );

  if (isGallery) {
    const items = innerProps.options.map((option, index) => (
      <UnstyledButton
        key={index}
        onClick={() => {
          openContextModal({
            modal: 'previewBackgroundImage',
            title: option.name ?? 'Preview artwork',
            size: '100%',
            innerProps: {
              option,
              onSelect: innerProps.onSelect,
              galleryModalId: id,
            },
          });
        }}
      >
        <Stack gap={6}>
          <Box h={140} style={{ overflow: 'hidden', borderRadius: 8 }}>
            <Image
              src={option.url}
              h={140}
              fit='cover'
              radius='md'
              loading='lazy'
              decoding='async'
            />
          </Box>
          {option.name && (
            <Text size='sm' lineClamp={1}>
              {option.name}
            </Text>
          )}
          {option.source?.trim() && (
            <Text size='xs' c='dimmed' lineClamp={1}>
              <IconBrush size='0.55rem' /> {option.source}
            </Text>
          )}
        </Stack>
      </UnstyledButton>
    ));

    return (
      <Card withBorder radius='md' className={classes.card} p='sm'>
        <LoadingOverlay visible={loading} />
        <ScrollArea h='70dvh' scrollbars='y'>
          <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing='md'>
            {uploadTile}
            {items}
          </SimpleGrid>
        </ScrollArea>
      </Card>
    );
  }

  const items = innerProps.options.map((option, index) => (
    <HoverCard key={index} shadow='md' openDelay={1000} position='bottom' disabled={!option.name} withinPortal>
      <HoverCard.Target>
        <UnstyledButton
          className={classes.item}
          onClick={() => {
            innerProps.onSelect(option);
            context.closeModal(id);
          }}
        >
          <Avatar
            src={option.url}
            size={115}
            radius={'md'}
            imageProps={{ loading: 'lazy', decoding: 'async' }}
          />
        </UnstyledButton>
      </HoverCard.Target>
      <HoverCard.Dropdown py={5} px={10}>
        <Text size='sm'>{option.name}</Text>
        {option.source?.trim() && (
          <Text size='xs' c='dimmed'>
            <IconBrush size='0.55rem' /> {option.source}
          </Text>
        )}
      </HoverCard.Dropdown>
    </HoverCard>
  ));

  return (
    <Card withBorder radius='md' className={classes.card} pl={15} py={15} pr={5}>
      <LoadingOverlay visible={loading} />
      <ScrollArea h={315} scrollbars='y'>
        <SimpleGrid cols={3} pl={5} py={5} pr={15}>
          {uploadTile}
          {items}
        </SimpleGrid>
      </ScrollArea>
    </Card>
  );
}

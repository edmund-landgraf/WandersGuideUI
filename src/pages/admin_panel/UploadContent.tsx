import { Button, Center, Group, Progress, Select, Text, Title, rem } from '@mantine/core';
import { IconUpload, IconPhoto, IconX } from '@tabler/icons-react';
import { Dropzone, FileWithPath } from '@mantine/dropzone';
import BlurBox from '@common/BlurBox';
import { getUploadStats, resetUploadStats, uploadContentList } from '@upload/content-upload';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { showNotification } from '@mantine/notifications';
import { AbilityBlockType, ContentType } from '@schemas/content';
import { fetchContentSources, defineDefaultSources } from '@content/content-store';
import { getSpellByName } from '@upload/foundry-utils';
import { downloadMonsterCore2Files } from '@upload/monster-core-2-pack';

export default function UploadContent() {
  const [contentType, setContentType] = useState<ContentType | AbilityBlockType | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [showUploadStats, setShowUploadStats] = useState(false);

  const [sourceId, setSourceId] = useState<number | undefined>(undefined);

  const { data, isFetching } = useQuery({
    queryKey: [`get-content-sources-admin`],
    queryFn: async () => {
      return await fetchContentSources(defineDefaultSources('PAGE', 'ALL-OFFICIAL-PUBLIC'));
    },
    refetchInterval: 1000,
  });

  const startUpload = async (files: FileWithPath[]) => {
    if (!sourceId) return;
    if (!contentType) return;
    if (uploading) return;
    resetUploadStats();
    setUploading(true);
    setShowUploadStats(true);
    try {
      await uploadContentList(sourceId, contentType, files);
      showNotification({ title: 'Upload finished', message: 'Review the counts for imported, existing, and failed files.', autoClose: 6000 });
    } catch (error) {
      showNotification({ title: 'Upload interrupted', message: String(error), color: 'red', autoClose: false });
    } finally {
      setUploading(false);
    }
  };

  const selectedSource = data?.find(source => source.id === sourceId);
  const canImportMonsterCore2 = contentType === 'creature' && selectedSource?.name === 'Monster Core 2' && selectedSource.user_id === null;

  async function importMonsterCore2() {
    if (!canImportMonsterCore2 || uploading || downloading) return;
    setDownloading(true);
    try {
      const files = await downloadMonsterCore2Files();
      await startUpload(files);
    } catch (error) {
      showNotification({ title: 'Monster Core 2 download failed', message: String(error), color: 'red', autoClose: false });
    } finally {
      setDownloading(false);
    }
  }

  // Passively poll upload stats
  const { data: uploadStats } = useQuery({
    queryKey: [`upload-stats`, {}],
    queryFn: async ({ queryKey }) => {
      // @ts-ignore
       
      const [_key, {}] = queryKey;
      return getUploadStats();
    },
    refetchInterval: 1000,
  });

  // Calc upload stats for progress bar
  let total = 0;
  let totalFound = 0;
  let totalUploaded = 0;
  let totalErrors = 0;
  let totalMissing = 0;
  let totalSkipped = 0;
  if (uploadStats) {
    for (const sourceMap of uploadStats.uploads.values()) {
      totalUploaded = [...sourceMap.values()].reduce((acc, cur) => acc + cur, totalUploaded);
    }
    for (const sourceMap of uploadStats.failedUploads.values()) {
      totalErrors = [...sourceMap.values()].reduce((acc, cur) => acc + cur, totalErrors);
    }
    totalMissing = [...uploadStats.missingSources.values()].reduce((acc, cur) => acc + cur, totalMissing);
    total = uploadStats.total;
    totalSkipped = uploadStats.skipped;
    totalFound = totalUploaded + totalErrors + totalMissing + totalSkipped;
  }

  return (
    <BlurBox p='sm'>
      <Center p='sm'>
        <Group>
          <Title order={3}>Upload Content</Title>
          <Select
            placeholder='Select content source'
            data={(data ?? []).map((source) => ({
              value: source.id + '',
              label: source.name,
            }))}
            searchable
            disabled={uploading || downloading}
            onChange={async (value) => {
              if (!value) return;
              setSourceId(parseInt(value));
            }}
          />
          <Select
            placeholder='Select content type'
            data={
              [
                { value: 'action', label: 'Action' },
                { value: 'feat', label: 'Feat' },
                { value: 'class-feature', label: 'Class Feature' },
                { value: 'spell', label: 'Spell' },
                { value: 'item', label: 'Item' },
                { value: 'creature', label: 'Creature' },
                { value: 'heritage', label: 'Heritage' },
                { value: 'background', label: 'Background' },
              ] satisfies { value: ContentType | AbilityBlockType; label: string }[]
            }
            value={contentType}
            disabled={uploading || downloading}
            onChange={(value) => {
              setContentType(value as ContentType | AbilityBlockType);
              setShowUploadStats(false);
            }}
          />
        </Group>
      </Center>

      {canImportMonsterCore2 && (
        <Center p='sm'>
          <Button onClick={importMonsterCore2} loading={downloading || uploading}>Import missing Monster Core 2 creatures (PF2e 8.7.1)</Button>
        </Center>
      )}

      {showUploadStats && totalFound > 0 && (
        <Progress.Root size='xl'>
          <Progress.Section animated={totalFound !== total} value={Math.ceil((totalErrors / total) * 100)} color='red'>
            <Progress.Label>Errors - {totalErrors}</Progress.Label>
          </Progress.Section>
          <Progress.Section
            animated={totalFound !== total}
            value={Math.ceil((totalMissing / total) * 100)}
            color='yellow'
          >
            <Progress.Label>Missing Source - {totalMissing}</Progress.Label>
          </Progress.Section>
          <Progress.Section animated={totalFound !== total} value={Math.ceil((totalSkipped / total) * 100)} color='gray'>
            <Progress.Label>Existing - {totalSkipped}</Progress.Label>
          </Progress.Section>
          <Progress.Section animated={totalFound !== total} value={Math.ceil((totalUploaded / total) * 100)}>
            <Progress.Label>Uploaded - {totalUploaded}</Progress.Label>
          </Progress.Section>
        </Progress.Root>
      )}

      {showUploadStats && (uploadStats?.failedFiles?.length ?? 0) > 0 && (
        <div style={{ maxHeight: 260, overflowY: 'auto', padding: 12 }}>
          <Text fw={600} size='sm'>Files requiring review ({uploadStats!.failedFiles.length})</Text>
          {uploadStats!.failedFiles.map((failure, index) => (
            <Text size='xs' key={index}>{failure.file}: {failure.reason}</Text>
          ))}
          <Button size='xs' variant='light' onClick={() => {
            const blob = new Blob([JSON.stringify(uploadStats!.failedFiles, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url; anchor.download = 'creature-import-failures.json'; anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}>Export failure report</Button>
        </div>
      )}

      {contentType ? (
        <Dropzone
          disabled={uploading || downloading}
          onDrop={(files) => startUpload(files)}
          onReject={(files) => console.log('rejected files', files)}
          maxSize={3 * 1024 ** 2}
          accept={['application/json']}
        >
          <Group justify='center' gap='xl' mih={220} style={{ pointerEvents: 'none' }}>
            <Dropzone.Accept>
              <IconUpload
                style={{
                  width: rem(52),
                  height: rem(52),
                  color: 'var(--mantine-color-blue-6)',
                }}
                stroke={1.5}
              />
            </Dropzone.Accept>
            <Dropzone.Reject>
              <IconX
                style={{
                  width: rem(52),
                  height: rem(52),
                  color: 'var(--mantine-color-red-6)',
                }}
                stroke={1.5}
              />
            </Dropzone.Reject>
            <Dropzone.Idle>
              <IconPhoto
                style={{
                  width: rem(52),
                  height: rem(52),
                  color: 'var(--mantine-color-dimmed)',
                }}
                stroke={1.5}
              />
            </Dropzone.Idle>

            <div>
              <Text size='xl' inline>
                Drag JSON files here or click to select files
              </Text>
              <Text size='sm' c='dimmed' inline mt={7}>
                Attach as many files as you like, each file should not exceed 5mb
              </Text>
            </div>
          </Group>
        </Dropzone>
      ) : (
        <></>
      )}
    </BlurBox>
  );
}

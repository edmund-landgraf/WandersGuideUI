import { Center, Stack, Title, Text, Box, Anchor } from '@mantine/core';
import { useEffect, useState } from 'react';
import { Campaign } from '@schemas/content';
import { listOwned } from '../../../syndication/store';
import { SHOP_CONTENT_KIND, shopPublicUrl, type ShopDraft } from '../../launcher/shops-syndicate';
import type { SyndicatedNode } from '../../../syndication/nodes';

export default function ShopsPanel(props: {
  panelHeight: number;
  panelWidth: number;
  campaign: Campaign;
  setCampaign: (campaign: Campaign) => void;
}) {
  const [rows, setRows] = useState<SyndicatedNode<ShopDraft>[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void listOwned(SHOP_CONTENT_KIND)
      .then((nodes) => {
        if (cancelled) return;
        setRows(nodes.filter((row): row is SyndicatedNode<ShopDraft> => (
          row.kind === 'entry' && (row.draft as ShopDraft | undefined)?.campaignId === props.campaign.id
        )));
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load shops.');
      });
    return () => {
      cancelled = true;
    };
  }, [props.campaign.id]);

  return (
    <Box h={props.panelHeight} p='md'>
      {error && (
        <Text c='red' fz='sm'>
          {error}
        </Text>
      )}
      {!error && rows.length === 0 && (
        <Center pt={50}>
          <Stack>
            <Title ta='center' order={3}>
              No shops on this campaign
            </Title>
            <Text c='dimmed' ta='center' fz='sm' maw={500}>
              Save a shop from the shops page and set its campaign, or assign it with update_shop.
            </Text>
            <Anchor ta='center' href='/shops' target='_blank'>
              Open shops
            </Anchor>
          </Stack>
        </Center>
      )}
      {rows.length > 0 && (
        <Stack gap='sm'>
          {rows.map((shop) => (
            <Box key={shop.id} p='sm' style={{ borderRadius: 8, border: '1px solid var(--mantine-color-dark-4)' }}>
              <Anchor href={`/shops?id=${shop.id}`} target='_blank' fw={600}>
                {shop.name}
              </Anchor>
              <Text fz='sm' c='dimmed'>
                {shop.draft?.settlement ?? 'village'} · {shop.draft?.size ?? shop.draft?.stock?.length ?? 0} items
              </Text>
              {shop.published && shop.public_token && (
                <Anchor href={shopPublicUrl(shop.public_token)} target='_blank' fz='sm'>
                  Public link
                </Anchor>
              )}
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  );
}

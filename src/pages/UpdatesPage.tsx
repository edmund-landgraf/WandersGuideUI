import { List, Stack, Text, Title } from '@mantine/core';
import BlurBox from '@common/BlurBox';
import { setPageTitle } from '@utils/document-change';
import { groupUpdateLines, type WeeklyUpdate } from '@utils/weeklyUpdates';

const weeksSource: WeeklyUpdate[] = [];

export function Component() {
  setPageTitle('Updates');
  const weeks = [...weeksSource].reverse();
  const first = weeksSource[0];
  const last = weeksSource[weeksSource.length - 1];

  return (
    <Stack maw={760} mx='auto' gap='md' pb={40}>
      <div>
        <Title order={2} c='gray.0'>
          Updates
        </Title>
        <Text c='gray.3' size='sm' mt={4}>
          {weeksSource.length === 0
            ? 'No updates yet.'
            : `${weeksSource.reduce((total, week) => total + week.count, 0)} updates from ${first?.label ?? ''} through ${last?.label ?? ''}, one summary per week.`}
        </Text>
      </div>
      {weeks.map((week) => (
        <BlurBox key={week.weekStart} p='md'>
          <Title order={4} c='gray.0'>
            {week.label}
          </Title>
          <Text c='gray.2' size='sm' mt={6}>
            {week.summary}
          </Text>
          <Stack gap='sm' mt='sm'>
            {groupUpdateLines(week.subjects).map((group) => (
              <div key={group.title}>
                <Text size='sm' fw={600} c='gray.0'>
                  {group.title}
                </Text>
                <List size='sm' c='gray.2' mt={4} spacing={4} withPadding>
                  {group.items.map((subject, index) => (
                    <List.Item key={`${week.weekStart}-${group.title}-${index}`}>{subject}</List.Item>
                  ))}
                </List>
              </div>
            ))}
          </Stack>
          <Text c='dimmed' size='xs' mt={8}>
            {week.count} {week.count === 1 ? 'update' : 'updates'}
          </Text>
        </BlurBox>
      ))}
    </Stack>
  );
}

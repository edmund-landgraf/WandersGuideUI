import { Badge, Button, Group, Stack, Text, Title } from '@mantine/core';
import { useMemo, useState } from 'react';
import BlurBox from '@common/BlurBox';
import { setPageTitle } from '@utils/document-change';
import { groupUpdateLines, UPDATE_TOPICS, type WeeklyUpdate } from '@utils/weeklyUpdates';
import generated from '../generated/weeklyUpdates.json';

const weeksSource = generated.weeks as WeeklyUpdate[];

function weekGroups(week: WeeklyUpdate, topic: string) {
  const groups = groupUpdateLines(week.subjects);
  if (topic === 'All') return groups;
  return groups.filter((group) => group.title === topic);
}

export function Component() {
  setPageTitle('Updates');
  const weeks = useMemo(() => [...weeksSource].reverse(), []);
  const [topic, setTopic] = useState('All');
  const latest = weeks[0];
  const older = weeks.slice(1);
  const visibleOlder = older.filter((week) => weekGroups(week, topic).length > 0);
  const latestGroups = latest ? weekGroups(latest, topic) : [];

  return (
    <Stack maw={760} mx='auto' gap='lg' pb={40}>
      <div>
        <Text size='xs' c='gray.4' tt='uppercase' style={{ letterSpacing: '0.16em' }}>
          Changelog
        </Text>
        <Title order={2} c='gray.0' mt={4}>
          What changed
        </Title>
        <Text c='gray.3' size='sm' mt={6}>
          {weeks.length === 0 ? 'No updates yet.' : `${weeks.length} weeks of notes, newest first.`}
        </Text>
      </div>

      <Group gap={6}>
        {['All', ...UPDATE_TOPICS].map((name) => (
          <Button
            key={name}
            size='compact-xs'
            radius='xl'
            variant={topic === name ? 'filled' : 'light'}
            color='gray'
            onClick={() => setTopic(name)}
          >
            {name}
          </Button>
        ))}
      </Group>

      {latest && latestGroups.length > 0 && (
        <BlurBox p='lg'>
          <Text size='xs' c='gray.4' tt='uppercase' style={{ letterSpacing: '0.14em' }}>
            This week
          </Text>
          <Title order={3} c='gray.0' mt={6}>
            {latest.label}
          </Title>
          <WeekBody week={latest} groups={latestGroups} />
        </BlurBox>
      )}

      {visibleOlder.length > 0 && (
        <Stack gap='sm'>
          <Title order={4} c='gray.1'>
            Earlier
          </Title>
          {visibleOlder.map((week) => {
            const groups = weekGroups(week, topic);
            const count = groups.reduce((sum, group) => sum + group.items.length, 0);
            return (
              <BlurBox key={week.weekStart} p='md'>
                <details>
                  <summary style={{ cursor: 'pointer' }}>
                    <Group justify='space-between' wrap='nowrap' component='span'>
                      <Text fw={600} c='gray.0' component='span'>
                        {week.label}
                      </Text>
                      <Badge variant='light' color='gray' component='span'>
                        {count}
                      </Badge>
                    </Group>
                  </summary>
                  <WeekBody week={week} groups={groups} />
                </details>
              </BlurBox>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}

function WeekBody({
  week,
  groups,
}: {
  week: WeeklyUpdate;
  groups: { title: string; items: string[] }[];
}) {
  return (
    <Stack gap='sm' mt='sm'>
      {groups.map((group) => (
        <div key={group.title}>
          <Text size='xs' c='gray.4' tt='uppercase'>
            {group.title}
          </Text>
          <Stack gap={4} mt={4}>
            {group.items.map((subject, index) => (
              <Text key={`${week.weekStart}-${group.title}-${index}`} size='sm' c='gray.1'>
                {subject}
              </Text>
            ))}
          </Stack>
        </div>
      ))}
    </Stack>
  );
}

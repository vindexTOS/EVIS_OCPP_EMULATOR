import { Badge, Group, ScrollArea, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getChargePointLogs } from '../lib/api';
import { ENGINE_EVENTS, socket } from '../lib/socket';
import type { OcppLogEntry } from '../lib/types';

const MAX_ROWS = 200;

const TYPE_LABEL: Record<number, string> = {
  2: 'CALL',
  3: 'RESULT',
  4: 'ERROR',
};

function typeColor(messageType: number) {
  if (messageType === 4) return 'red';
  if (messageType === 3) return 'teal';
  return 'blue';
}

function LogRow({ entry }: { entry: OcppLogEntry }) {
  const out = entry.direction === 'out';
  const time = new Date(entry.ts).toLocaleTimeString();
  return (
    <Group gap="xs" wrap="nowrap" align="flex-start" style={{ fontSize: 12 }}>
      <Text size="xs" c="dimmed" ff="monospace" style={{ width: 90, flexShrink: 0 }}>
        {time}
      </Text>
      <Badge
        size="xs"
        variant="light"
        color={out ? 'grape' : 'gray'}
        style={{ width: 42, flexShrink: 0 }}
      >
        {out ? 'CP→' : '→CP'}
      </Badge>
      <Badge size="xs" color={typeColor(entry.messageType)} style={{ width: 58, flexShrink: 0 }}>
        {TYPE_LABEL[entry.messageType] ?? entry.messageType}
      </Badge>
      <Text size="xs" fw={600} style={{ width: 150, flexShrink: 0 }}>
        {entry.action || '—'}
      </Text>
      <Text
        size="xs"
        ff="monospace"
        c={entry.messageType === 4 ? 'red' : undefined}
        style={{ wordBreak: 'break-all' }}
      >
        {JSON.stringify(entry.payload)}
      </Text>
    </Group>
  );
}

export function OcppLogPanel({ chargePointId }: { chargePointId: string }) {
  const seed = useQuery({
    queryKey: ['logs', chargePointId],
    queryFn: () => getChargePointLogs(chargePointId),
    refetchOnWindowFocus: false,
  });
  const [live, setLive] = useState<OcppLogEntry[]>([]);
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onLog = (entry: OcppLogEntry) => {
      if (entry.chargePointId !== chargePointId) return;
      setLive((prev) => [...prev, entry].slice(-MAX_ROWS));
    };
    socket.on(ENGINE_EVENTS.ocppLog, onLog);
    return () => {
      socket.off(ENGINE_EVENTS.ocppLog, onLog);
    };
  }, [chargePointId]);

  const rows = useMemo(() => {
    const seenIds = new Set(live.map((l) => l.id));
    const seeded = (seed.data ?? []).filter((l) => !seenIds.has(l.id));
    return [...seeded, ...live].slice(-MAX_ROWS);
  }, [seed.data, live]);

  useEffect(() => {
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight });
  }, [rows.length]);

  return (
    <ScrollArea h={220} viewportRef={viewport} type="auto">
      <Stack gap={2} p="xs">
        {rows.length === 0 ? (
          <Text size="xs" c="dimmed">
            No OCPP messages yet. Connect the charge point to a CSMS to see traffic.
          </Text>
        ) : (
          rows.map((entry) => <LogRow key={entry.id} entry={entry} />)
        )}
      </Stack>
    </ScrollArea>
  );
}

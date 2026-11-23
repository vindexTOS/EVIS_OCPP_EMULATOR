import { Button, SegmentedControl, Switch, TextInput } from '@mantine/core';
import { IconSearch, IconTerminal2, IconTrash } from '@tabler/icons-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { clearLogs, getLogs } from '../../lib/api';
import { cls } from '../../lib/hooks';
import { logStore } from '../../lib/liveStores';
import { toastError } from '../../lib/queries';
import { useKeyedLog } from '../../lib/stores';
import type { Charger, OcppLogEntry } from '../../lib/types';

const KIND: Record<number, string> = { 2: 'CALL', 3: 'RESULT', 4: 'ERROR' };
/** The background chatter that hides what a tester is looking for. */
const ROUTINE = new Set(['Heartbeat', 'MeterValues']);

const clock = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
};

/** Every OCPP frame between this charger and its CSMS, as it happens. */
export function LogTab({ charger }: { charger: Charger }) {
  const rows = useKeyedLog(logStore, charger.id);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [routine, setRoutine] = useState(true);
  const [open, setOpen] = useState<number | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    getLogs(charger.id, 500)
      .then((entries) => logStore.seed(charger.id, entries))
      .catch(() => undefined);
  }, [charger.id]);

  // A CALL and its answer share a message id: that pairs them and gives the response time.
  const byMessage = useMemo(() => {
    const map = new Map<string, OcppLogEntry[]>();
    for (const row of rows) {
      const list = map.get(row.messageId);
      if (list) list.push(row);
      else map.set(row.messageId, [row]);
    }
    return map;
  }, [rows]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (!routine && ROUTINE.has(row.action)) return false;
      if (filter === 'out' && row.direction !== 'out') return false;
      if (filter === 'in' && row.direction !== 'in') return false;
      if (filter === 'error' && row.messageType !== 4) return false;
      if (!needle) return true;
      return (
        row.action.toLowerCase().includes(needle) ||
        JSON.stringify(row.payload ?? '').toLowerCase().includes(needle)
      );
    });
  }, [rows, filter, search, routine]);

  // Follow the newest frame, unless the reader scrolled up to look at something.
  useLayoutEffect(() => {
    const el = body.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [visible.length]);

  return (
    <div className="card log">
      <div className="log-toolbar" style={{ fontFamily: 'var(--font-sans)' }}>
        <SegmentedControl
          size="xs"
          value={filter}
          onChange={setFilter}
          data={[
            { value: 'all', label: 'All' },
            { value: 'out', label: 'Sent' },
            { value: 'in', label: 'Received' },
            { value: 'error', label: 'Errors' },
          ]}
        />
        <TextInput
          size="xs"
          placeholder="Search action or payload"
          leftSection={<IconSearch size={14} />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          style={{ flex: 1, minWidth: 180, maxWidth: 320 }}
        />
        <Switch
          size="sm"
          checked={routine}
          onChange={(e) => setRoutine(e.currentTarget.checked)}
          label="Heartbeat and MeterValues"
        />
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 12.5 }}>
          {visible.length} of {rows.length} frames
        </span>
        <Button
          size="compact-xs"
          variant="subtle"
          color="gray"
          leftSection={<IconTrash size={13} />}
          onClick={() => {
            clearLogs(charger.id)
              .then(() => logStore.clear(charger.id))
              .catch(toastError);
          }}
        >
          Clear
        </Button>
      </div>
      <div
        className="log-body"
        ref={body}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {visible.length === 0 ? (
          <div className="empty" style={{ fontFamily: 'var(--font-sans)' }}>
            <span className="empty-icon">
              <IconTerminal2 size={24} />
            </span>
            <strong>{rows.length === 0 ? 'No OCPP traffic yet' : 'Nothing matches'}</strong>
            <span>
              {rows.length === 0
                ? 'Power the charger on. Every frame it exchanges with the CSMS appears here.'
                : 'Change the filter or the search.'}
            </span>
          </div>
        ) : (
          visible.map((row) => {
            const out = row.direction === 'out';
            const pair = byMessage.get(row.messageId) ?? [];
            const call = pair.find((p) => p.messageType === 2);
            const answer = pair.find((p) => p.messageType !== 2);
            const action = row.action || call?.action || '';
            const isOpen = open === row.id;
            return (
              <div key={row.id}>
                <div
                  className={cls('log-row', isOpen && 'open')}
                  onClick={() => setOpen(isOpen ? null : row.id)}
                >
                  <span className="log-time">{clock(row.ts)}</span>
                  <span className={cls('log-dir', !out && 'in')} title={out ? 'Charger → CSMS' : 'CSMS → charger'}>
                    {out ? '→' : '←'}
                  </span>
                  <span className={cls('log-kind', row.messageType === 4 && 'error')}>
                    {KIND[row.messageType] ?? row.messageType}
                  </span>
                  <span className="log-action">{action || '(unknown)'}</span>
                  <span className="log-payload">{JSON.stringify(row.payload)}</span>
                </div>
                {isOpen && (
                  <div className="log-detail">
                    <div className="muted" style={{ margin: '6px 0', fontFamily: 'var(--font-sans)', fontSize: 12 }}>
                      {out ? 'Charger → CSMS' : 'CSMS → charger'} · message id {row.messageId}
                      {call && answer
                        ? ` · answered in ${Math.max(0, new Date(answer.ts).getTime() - new Date(call.ts).getTime())} ms`
                        : row.messageType === 2
                          ? ' · no answer yet'
                          : ''}
                    </div>
                    <pre className="json">{JSON.stringify(row.payload, null, 2)}</pre>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

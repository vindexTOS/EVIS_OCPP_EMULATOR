import { Button, Loader, SegmentedControl, Select } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { IconHistory } from '@tabler/icons-react';
import { useState } from 'react';
import { SessionDrawer } from '../components/SessionDrawer';
import { SessionsTable } from '../components/SessionsTable';
import { getOverview, listSessions } from '../lib/api';
import { fmtDuration, fmtKwh } from '../lib/format';
import { useChargers } from '../lib/queries';

const PAGE = 50;

/** Every transaction of every charger, newest first. */
export function HistoryPage() {
  const chargers = useChargers();
  const [charger, setCharger] = useState<string | null>(null);
  const [status, setStatus] = useState('all');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<number | null>(null);

  const overview = useQuery({ queryKey: ['overview'], queryFn: getOverview, refetchInterval: 5000 });
  const sessions = useQuery({
    queryKey: ['sessions', 'all', charger, status, limit],
    queryFn: () =>
      listSessions({
        chargePointId: charger ? Number(charger) : undefined,
        status: status === 'all' ? undefined : (status as 'Active' | 'Stopped'),
        limit,
      }),
    placeholderData: (previous) => previous,
    refetchInterval: 5000,
  });

  const o = overview.data;
  const rows = sessions.data?.items ?? [];
  const total = sessions.data?.total ?? 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>History</h1>
          <p>Every transaction the emulator has run. Open a charger for its per-connector totals.</p>
        </div>
      </div>

      <div className="tiles" style={{ marginBottom: 18 }}>
        <div className="tile">
          <div className="tile-label">Energy delivered, all chargers</div>
          <div className="tile-value">
            {fmtKwh(o?.energyWh ?? 0)}
            <small>kWh</small>
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">Sessions</div>
          <div className="tile-value">{(o?.sessions ?? 0).toLocaleString()}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Running now</div>
          <div className="tile-value">{o?.active ?? 0}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Time charging</div>
          <div className="tile-value">{fmtDuration(o?.chargingSec ?? 0)}</div>
        </div>
      </div>

      <div className="row wrap" style={{ marginBottom: 12 }}>
        <Select
          placeholder="All chargers"
          clearable
          data={(chargers.data ?? []).map((c) => ({ value: String(c.id), label: c.name }))}
          value={charger}
          onChange={(v) => {
            setCharger(v);
            setLimit(PAGE);
          }}
          style={{ width: 220 }}
        />
        <SegmentedControl
          value={status}
          onChange={(v) => {
            setStatus(v);
            setLimit(PAGE);
          }}
          data={[
            { value: 'all', label: 'All' },
            { value: 'Active', label: 'Running' },
            { value: 'Stopped', label: 'Finished' },
          ]}
        />
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 12.5 }}>
          {total.toLocaleString()} {total === 1 ? 'session' : 'sessions'}
        </span>
      </div>

      <div className="card card-pad" style={{ opacity: sessions.isPlaceholderData ? 0.6 : 1 }}>
        {sessions.isLoading ? (
          <div className="empty">
            <Loader />
          </div>
        ) : rows.length === 0 ? (
          <div className="empty">
            <span className="empty-icon">
              <IconHistory size={24} />
            </span>
            <strong>No session to show</strong>
            <span>Start a transaction on the Station page and it appears here.</span>
          </div>
        ) : (
          <>
            <SessionsTable sessions={rows} chargers={chargers.data ?? []} showCharger onOpen={setOpen} />
            {rows.length < total && (
              <div style={{ display: 'grid', placeItems: 'center', paddingTop: 14 }}>
                <Button variant="default" onClick={() => setLimit((l) => l + PAGE)}>
                  Show {Math.min(PAGE, total - rows.length)} more
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <SessionDrawer sessionId={open} chargers={chargers.data ?? []} onClose={() => setOpen(null)} />
    </div>
  );
}

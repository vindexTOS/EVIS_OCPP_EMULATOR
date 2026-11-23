import { Button, Loader, SegmentedControl } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IconChartBar, IconHistory, IconTable, IconTrash } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { SessionDrawer } from '../../components/SessionDrawer';
import { SessionsTable } from '../../components/SessionsTable';
import { PlugIcon } from '../../components/PlugIcon';
import { StatusPill } from '../../components/Pills';
import { connectorColor } from '../../components/chartUtils';
import { Legend, RankedBars, StackedColumns, type Series } from '../../components/charts';
import { clearEvents, getEvents, getHistory, listSessions } from '../../lib/api';
import { CONNECTOR_INFO } from '../../lib/connectors';
import { fmtAgo, fmtDay, fmtDuration, fmtEnergy, fmtKwh, fmtLogTime, fmtPower } from '../../lib/format';
import { eventStore } from '../../lib/liveStores';
import { useChargers } from '../../lib/queries';
import { useKeyedLog } from '../../lib/stores';
import type { Charger } from '../../lib/types';

const RANGES = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];

/** What this charger has done: energy per connector, per day, every session, and its logbook. */
export function HistoryTab({ charger }: { charger: Charger }) {
  const qc = useQueryClient();
  const chargers = useChargers();
  const [days, setDays] = useState('30');
  const [table, setTable] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const history = useQuery({
    queryKey: ['history', charger.id, days],
    queryFn: () => getHistory(charger.id, Number(days)),
    placeholderData: (previous) => previous,
  });
  const since = history.data?.since;
  const sessions = useQuery({
    queryKey: ['sessions', 'charger', charger.id, since],
    queryFn: () => listSessions({ chargePointId: charger.id, since, limit: 100 }),
    enabled: !!since,
    placeholderData: (previous) => previous,
  });

  // A session that is running changes the totals as it goes.
  const running = charger.connectors.some((c) => c.session);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void qc.invalidateQueries({ queryKey: ['history', charger.id] });
      void qc.invalidateQueries({ queryKey: ['sessions', 'charger', charger.id] });
    }, 5000);
    return () => clearInterval(timer);
  }, [running, charger.id, qc]);

  const events = useKeyedLog(eventStore, charger.id);
  useEffect(() => {
    getEvents(charger.id, 150)
      .then((rows) => eventStore.seed(charger.id, rows))
      .catch(() => undefined);
  }, [charger.id]);

  const data = history.data;
  if (!data) {
    return (
      <div className="empty">
        <Loader />
      </div>
    );
  }

  const series: Series[] = data.connectors.map((c) => ({
    key: String(c.connectorId),
    label: `Connector ${c.connectorId} · ${CONNECTOR_INFO[c.type].short}`,
    color: connectorColor(c.connectorId),
  }));
  const points = data.daily.map((d) => ({
    label: fmtDay(d.day),
    title: new Date(`${d.day}T12:00:00`).toLocaleDateString([], {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    }),
    values: Object.fromEntries(d.byConnector.map((b) => [String(b.connectorId), b.energyWh / 1000])),
  }));
  const average = data.totals.sessions > 0 ? data.totals.energyWh / data.totals.sessions : 0;
  const nothing = data.totals.sessions === 0;
  const ended = data.stopReasons.filter((r) => r.reason !== 'Running');

  return (
    <div className="stack" style={{ opacity: history.isFetching && history.isPlaceholderData ? 0.6 : 1 }}>
      <div className="row between wrap">
        <SegmentedControl value={days} onChange={setDays} data={RANGES} />
        <span className="muted" style={{ fontSize: 12.5 }}>
          Sessions that started in the last {data.days} days
        </span>
      </div>

      <div className="tiles">
        <div className="tile">
          <div className="tile-label">Energy delivered</div>
          <div className="tile-value">
            {fmtKwh(data.totals.energyWh)}
            <small>kWh</small>
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">Sessions</div>
          <div className="tile-value">{data.totals.sessions.toLocaleString()}</div>
        </div>
        <div className="tile">
          <div className="tile-label">Time charging</div>
          <div className="tile-value">{fmtDuration(data.totals.chargingSec)}</div>
          <div className="tile-note">{fmtDuration(data.totals.durationSec)} plugged in a session</div>
        </div>
        <div className="tile">
          <div className="tile-label">Average per session</div>
          <div className="tile-value">
            {fmtKwh(average)}
            <small>kWh</small>
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">Meter reading now</div>
          <div className="tile-value">
            {fmtKwh(data.totals.meterWh, 1)}
            <small>kWh</small>
          </div>
          <div className="tile-note">All connectors, since the charger was created</div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="card-title">
          <span>
            Energy delivered per day <small>· kWh, by connector</small>
          </span>
          <Button
            size="compact-xs"
            variant="default"
            leftSection={table ? <IconChartBar size={13} /> : <IconTable size={13} />}
            onClick={() => setTable((t) => !t)}
          >
            {table ? 'Chart' : 'Table'}
          </Button>
        </div>
        {nothing ? (
          <div className="empty">
            <span className="empty-icon">
              <IconHistory size={24} />
            </span>
            <strong>No session in this period</strong>
            <span>Plug in a car on the Station tab and start charging. It shows up here.</span>
          </div>
        ) : table ? (
          <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Day</th>
                  {data.connectors.map((c) => (
                    <th key={c.connectorId} className="num">
                      Connector {c.connectorId}
                    </th>
                  ))}
                  <th className="num">Total</th>
                  <th className="num">Sessions</th>
                </tr>
              </thead>
              <tbody>
                {[...data.daily].reverse().map((d) => (
                  <tr key={d.day}>
                    <td>{fmtDay(d.day)}</td>
                    {d.byConnector.map((b) => (
                      <td key={b.connectorId} className="num">
                        {fmtKwh(b.energyWh)}
                      </td>
                    ))}
                    <td className="num">{fmtKwh(d.energyWh)}</td>
                    <td className="num">{d.sessions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            {series.length > 1 && (
              <div style={{ marginBottom: 10 }}>
                <Legend series={series} />
              </div>
            )}
            <StackedColumns points={points} series={series} unit="kWh" format={(v) => `${v.toFixed(2)} kWh`} />
          </>
        )}
      </div>

      <div className="card card-pad">
        <div className="card-title">
          <span>What each connector delivered</span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Connector</th>
                <th>Now</th>
                <th className="num">Energy</th>
                <th className="num">Sessions</th>
                <th className="num">Time charging</th>
                <th className="num">Average</th>
                <th className="num">Peak power</th>
                <th>Last session</th>
                <th className="num">Meter reading</th>
              </tr>
            </thead>
            <tbody>
              {data.connectors.map((c) => (
                <tr key={c.connectorId}>
                  <td>
                    <span className="row" style={{ gap: 8 }}>
                      <i
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 3,
                          background: connectorColor(c.connectorId),
                          flex: 'none',
                        }}
                      />
                      <PlugIcon type={c.type} size={17} />
                      <b>{c.connectorId}</b> · {CONNECTOR_INFO[c.type].short} · {fmtPower(c.maxPowerW)}
                    </span>
                  </td>
                  <td>
                    <StatusPill status={c.status} />
                  </td>
                  <td className="num">{fmtEnergy(c.energyWh)}</td>
                  <td className="num">{c.sessions}</td>
                  <td className="num">{c.sessions ? fmtDuration(c.chargingSec) : '–'}</td>
                  <td className="num">{c.sessions ? fmtEnergy(c.averageEnergyWh) : '–'}</td>
                  <td className="num">{c.sessions ? fmtPower(c.peakPowerW) : '–'}</td>
                  <td className="dim">{fmtAgo(c.lastSessionAt)}</td>
                  <td className="num">{fmtEnergy(c.meterWh)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel-grid">
        <div className="card card-pad">
          <div className="card-title">
            <span>
              Why sessions ended <small>· StopTransaction reason</small>
            </span>
          </div>
          {ended.length === 0 ? (
            <span className="muted" style={{ fontSize: 13 }}>
              No session has ended in this period.
            </span>
          ) : (
            <RankedBars
              rows={ended.map((r) => ({
                label: r.reason,
                value: r.count,
                display: r.count === 1 ? '1 session' : `${r.count} sessions`,
              }))}
            />
          )}
        </div>

        <div className="card card-pad">
          <div className="card-title">
            <span>
              Logbook <small>· latest events, newest first</small>
            </span>
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              leftSection={<IconTrash size={13} />}
              onClick={() => {
                clearEvents(charger.id)
                  .then(() => eventStore.clear(charger.id))
                  .catch(() => undefined);
              }}
            >
              Clear
            </Button>
          </div>
          <div className="events" style={{ maxHeight: 300, overflowY: 'auto' }}>
            {events.length === 0 && (
              <span className="muted" style={{ fontSize: 13 }}>
                Nothing has happened yet.
              </span>
            )}
            {[...events].reverse().map((e) => (
              <div key={e.id} className={`event sev-${e.severity}`}>
                <time title={new Date(e.ts).toLocaleString()}>{fmtLogTime(e.ts)}</time>
                <i />
                <span>
                  {e.message}
                  {e.connectorId != null && <span className="where">connector {e.connectorId}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <div className="card-title">
          <span>
            Sessions <small>· {sessions.data ? sessions.data.total : 0} in this period</small>
          </span>
        </div>
        {sessions.data && sessions.data.items.length > 0 ? (
          <SessionsTable sessions={sessions.data.items} chargers={chargers.data ?? []} onOpen={setOpen} />
        ) : (
          <span className="muted" style={{ fontSize: 13 }}>
            No session in this period.
          </span>
        )}
      </div>

      <SessionDrawer sessionId={open} chargers={chargers.data ?? []} onClose={() => setOpen(null)} />
    </div>
  );
}

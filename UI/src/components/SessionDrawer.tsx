import { Button, Drawer, Loader } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { IconChartLine, IconTable } from '@tabler/icons-react';
import { useState } from 'react';
import { getSession } from '../lib/api';
import { CONNECTOR_INFO } from '../lib/connectors';
import { fmtDateTime, fmtDuration, fmtEnergy, fmtPower, fmtTime } from '../lib/format';
import type { Charger } from '../lib/types';
import { TimeLine } from './charts';

/** Everything about one transaction: the facts, and how power and battery moved. */
export function SessionDrawer({
  sessionId,
  chargers,
  onClose,
}: {
  sessionId: number | null;
  chargers: Charger[];
  onClose: () => void;
}) {
  const [table, setTable] = useState(false);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const query = useQuery({
    queryKey: ['sessions', 'detail', sessionId],
    queryFn: () => getSession(sessionId!),
    enabled: sessionId !== null,
    // A running session keeps growing.
    refetchInterval: (q) => (q.state.data?.session.status === 'Active' ? 5000 : false),
  });
  const session = query.data?.session;
  const samples = query.data?.samples ?? [];
  const charger = chargers.find((c) => c.id === session?.chargePointId);
  const power = samples.map((s) => ({ t: new Date(s.ts).getTime(), value: s.powerW / 1000 }));
  const soc = samples
    .filter((s) => s.soc !== null)
    .map((s) => ({ t: new Date(s.ts).getTime(), value: s.soc as number }));
  const timeLabel = (t: number) => fmtTime(new Date(t).toISOString());

  return (
    <Drawer
      opened={sessionId !== null}
      onClose={onClose}
      position="right"
      size={560}
      title={session ? `Session ${session.id}` : 'Session'}
    >
      {!session ? (
        <div className="empty">
          <Loader />
        </div>
      ) : (
        <div className="stack">
          <div className="tiles">
            <div className="tile">
              <div className="tile-label">Energy delivered</div>
              <div className="tile-value">{fmtEnergy(session.energyWh)}</div>
            </div>
            <div className="tile">
              <div className="tile-label">Duration</div>
              <div className="tile-value">{fmtDuration(session.durationSec)}</div>
              <div className="tile-note">{fmtDuration(session.chargingSec)} with power flowing</div>
            </div>
          </div>

          <dl className="kv">
            <dt>Status</dt>
            <dd>
              <span className={`pill tone-${session.status === 'Active' ? 'energy' : 'off'}`}>
                <i />
                {session.status === 'Active' ? 'Running' : `Stopped · ${session.stopReason ?? 'unknown'}`}
              </span>
            </dd>
            <dt>Charger</dt>
            <dd>
              {charger?.name ?? `#${session.chargePointId}`} · connector {session.connectorId} (
              {CONNECTOR_INFO[session.connectorType]?.short ?? session.connectorType})
            </dd>
            <dt>Car</dt>
            <dd>{session.carName || 'none'}</dd>
            <dt>idTag</dt>
            <dd>
              <span className="mono">{session.idTag}</span>
              {session.idTagStatus ? ` · CSMS answered ${session.idTagStatus}` : ''}
            </dd>
            <dt>Transaction id</dt>
            <dd>
              {session.transactionId ?? 'not assigned'}
              {session.reservationId != null ? ` · reservation ${session.reservationId}` : ''}
            </dd>
            <dt>Started</dt>
            <dd>
              {fmtDateTime(session.startedAt)} · {session.startedBy.toLowerCase()} start
            </dd>
            <dt>Stopped</dt>
            <dd>{session.stoppedAt ? fmtDateTime(session.stoppedAt) : 'still running'}</dd>
            <dt>Meter</dt>
            <dd>
              {session.meterStartWh.toLocaleString()} Wh →{' '}
              {session.meterStopWh != null ? `${session.meterStopWh.toLocaleString()} Wh` : '…'}
            </dd>
            <dt>Battery</dt>
            <dd>
              {session.startSoc != null ? `${Math.round(session.startSoc)}%` : '?'} →{' '}
              {session.stopSoc != null ? `${Math.round(session.stopSoc)}%` : '…'}
            </dd>
            <dt>Peak power</dt>
            <dd>{fmtPower(session.peakPowerW)}</dd>
            <dt>Reported to CSMS</dt>
            <dd>
              StartTransaction {session.startConfirmed ? 'confirmed' : 'not confirmed'}
              {session.status === 'Stopped'
                ? ` · StopTransaction ${session.stopConfirmed ? 'confirmed' : 'not confirmed'}`
                : ''}
            </dd>
          </dl>

          <div className="row between">
            <span className="section-label">Meter readings · {samples.length}</span>
            <Button
              size="compact-xs"
              variant="default"
              leftSection={table ? <IconChartLine size={13} /> : <IconTable size={13} />}
              onClick={() => setTable((t) => !t)}
            >
              {table ? 'Charts' : 'Table'}
            </Button>
          </div>

          {table ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Reading</th>
                    <th className="num">Meter</th>
                    <th className="num">Power</th>
                    <th className="num">Battery</th>
                  </tr>
                </thead>
                <tbody>
                  {samples.map((s, i) => (
                    <tr key={i}>
                      <td>{fmtTime(s.ts)}</td>
                      <td className="dim">{s.context}</td>
                      <td className="num">{Math.round(s.energyWh).toLocaleString()} Wh</td>
                      <td className="num">{fmtPower(s.powerW)}</td>
                      <td className="num">{s.soc != null ? `${Math.round(s.soc)}%` : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : samples.length < 2 ? (
            <div className="empty" style={{ padding: 20 }}>
              Not enough readings yet to draw a curve.
            </div>
          ) : (
            <>
              <div>
                <div className="card-title" style={{ marginBottom: 4 }}>
                  <span>
                    Power <small>kW</small>
                  </span>
                </div>
                <TimeLine
                  points={power}
                  color="var(--series-1)"
                  label="Power"
                  unit="kW"
                  format={(v) => v.toFixed(1)}
                  timeLabel={timeLabel}
                  hoverT={hoverT}
                  onHover={setHoverT}
                />
              </div>
              {soc.length > 1 && (
                <div>
                  <div className="card-title" style={{ marginBottom: 4 }}>
                    <span>
                      Battery <small>%</small>
                    </span>
                  </div>
                  <TimeLine
                    points={soc}
                    color="var(--series-3)"
                    label="Battery"
                    unit="%"
                    format={(v) => v.toFixed(0)}
                    timeLabel={timeLabel}
                    max={100}
                    height={130}
                    hoverT={hoverT}
                    onHover={setHoverT}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}

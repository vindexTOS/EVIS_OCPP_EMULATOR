import { CONNECTOR_INFO } from '../lib/connectors';
import { fmtDateTime, fmtDuration, fmtEnergy } from '../lib/format';
import type { Charger, SessionRow } from '../lib/types';
import { PlugIcon } from './PlugIcon';

/** A list of transactions. Click one to open its details. */
export function SessionsTable({
  sessions,
  chargers,
  showCharger,
  onOpen,
}: {
  sessions: SessionRow[];
  chargers: Charger[];
  showCharger?: boolean;
  onOpen: (id: number) => void;
}) {
  const nameOf = (id: number) => chargers.find((c) => c.id === id)?.name ?? `#${id}`;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Started</th>
            {showCharger && <th>Charger</th>}
            <th>Connector</th>
            <th>Car</th>
            <th>idTag</th>
            <th className="num">Tx id</th>
            <th className="num">Energy</th>
            <th className="num">Duration</th>
            <th>Ended</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id} className="clickable" onClick={() => onOpen(s.id)}>
              <td>{fmtDateTime(s.startedAt)}</td>
              {showCharger && <td>{nameOf(s.chargePointId)}</td>}
              <td>
                <span className="row" style={{ gap: 7 }}>
                  <PlugIcon type={s.connectorType} size={16} />
                  {s.connectorId} · {CONNECTOR_INFO[s.connectorType]?.short ?? s.connectorType}
                </span>
              </td>
              <td>{s.carName || <span className="muted">–</span>}</td>
              <td className="mono">{s.idTag}</td>
              <td className="num">{s.transactionId ?? <span className="muted">–</span>}</td>
              <td className="num">{fmtEnergy(s.energyWh)}</td>
              <td className="num">{fmtDuration(s.durationSec)}</td>
              <td>
                {s.status === 'Active' ? (
                  <span className="pill tone-energy busy">
                    <i />
                    Running
                  </span>
                ) : (
                  <span className="dim">{s.stopReason ?? '–'}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import { STATE_META, STATUS_META } from '../lib/connectors';
import type { ConnectionState, ConnectorStatus } from '../lib/types';

export function StatusPill({ status, large }: { status: ConnectorStatus; large?: boolean }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`pill tone-${meta.tone}${large ? ' lg' : ''}${status === 'Charging' ? ' busy' : ''}`}
      title={meta.hint}
    >
      <i />
      {meta.label}
    </span>
  );
}

export function StatePill({ state, large }: { state: ConnectionState; large?: boolean }) {
  const meta = STATE_META[state];
  return (
    <span className={`pill tone-${meta.tone}${large ? ' lg' : ''}${meta.busy ? ' busy' : ''}`}>
      <i />
      {meta.label}
    </span>
  );
}

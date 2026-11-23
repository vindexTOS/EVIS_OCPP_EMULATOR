import { ActionIcon, Button, Menu, Modal, Stack, Switch, Text, Tooltip } from '@mantine/core';
import {
  IconAdjustments,
  IconAlertTriangle,
  IconChargingPile,
  IconCopy,
  IconDots,
  IconFlask,
  IconHistory,
  IconPower,
  IconRefresh,
  IconSettings,
  IconTerminal2,
  IconTrash,
  IconWifi,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { StatePill } from '../components/Pills';
import { deleteCharger, rebootCharger, setNetwork, setPower } from '../lib/api';
import { fmtAgo, secondsUntil } from '../lib/format';
import { cls, useApplyCharger, useBusy } from '../lib/hooks';
import { useNow } from '../lib/stores';
import type { Car, Charger, IdTag } from '../lib/types';
import { GarageDock } from './GarageDock';
import { Scene } from './Scene';
import { AdvancedTab } from './tabs/AdvancedTab';
import { ConfigTab } from './tabs/ConfigTab';
import { HistoryTab } from './tabs/HistoryTab';
import { LogTab } from './tabs/LogTab';
import { SettingsTab } from './tabs/SettingsTab';

const TABS = [
  { key: 'station', label: 'Station', icon: IconChargingPile },
  { key: 'history', label: 'History', icon: IconHistory },
  { key: 'log', label: 'OCPP log', icon: IconTerminal2 },
  { key: 'config', label: 'Configuration', icon: IconAdjustments },
  { key: 'advanced', label: 'Advanced', icon: IconFlask },
  { key: 'settings', label: 'Settings', icon: IconSettings },
] as const;

/** One sentence about where the charger stands with its CSMS. */
function stateDetail(charger: Charger, now: number): string {
  const c = charger.connection;
  switch (charger.state) {
    case 'Off':
      return 'Power it on to connect.';
    case 'Offline':
      return 'The network link is down. Charging still works; transaction messages are queued.';
    case 'Connecting':
      return c.nextRetryAt
        ? `Next attempt in ${secondsUntil(c.nextRetryAt, now)} s (attempt ${c.attempt + 1}).`
        : 'Dialing the CSMS…';
    case 'Booting':
      return 'Connected. Waiting for the answer to BootNotification.';
    case 'Pending':
    case 'Rejected':
      return `Next BootNotification in ${secondsUntil(c.bootRetryAt, now)} s.`;
    case 'Rebooting':
      return 'Back in a few seconds.';
    default:
      return `Heartbeat every ${c.heartbeatInterval} s · last ${fmtAgo(charger.lastHeartbeatAt ?? charger.lastBootAt, now)}`;
  }
}

/** Everything about one charger: its header, and the tab that is open. */
export function ChargerView({
  charger,
  cars,
  tags,
  tab,
}: {
  charger: Charger;
  cars: Car[];
  tags: IdTag[];
  tab: string;
}) {
  const apply = useApplyCharger();
  const navigate = useNavigate();
  const { busy, run } = useBusy();
  const now = useNow();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const live = charger.poweredOn && charger.state !== 'Rebooting';
  const active = TABS.some((t) => t.key === tab) ? tab : 'station';

  const problem = !charger.csmsUrl.trim()
    ? 'No CSMS link is set. Add one under Settings to connect this charger.'
    : !charger.resolvedUrl
      ? 'The CSMS link is not a valid ws:// or wss:// address. Fix it under Settings.'
      : charger.poweredOn && charger.state === 'Connecting' && charger.connection.lastError
        ? charger.connection.lastError
        : null;

  return (
    <>
      <div className="charger-head">
        <div style={{ minWidth: 0 }}>
          <h1>
            {charger.name}
            <StatePill state={charger.state} large />
            {charger.queueLength > 0 && (
              <Tooltip label="Transaction messages waiting to be delivered to the CSMS">
                <span className="pill tone-info lg">
                  <i />
                  {charger.queueLength} queued
                </span>
              </Tooltip>
            )}
          </h1>
          <div className="charger-sub">
            <span className="mono">{charger.chargePointId}</span>
            <span className="sep">·</span>
            <span>
              {charger.vendor} {charger.model}
            </span>
            <span className="sep">·</span>
            <span>{stateDetail(charger, now)}</span>
          </div>
          {charger.resolvedUrl && (
            <div className="charger-sub">
              <span className="mono url truncate" style={{ maxWidth: 520 }}>
                {charger.resolvedUrl}
              </span>
              <Tooltip label="Copy the link">
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color="gray"
                  aria-label="Copy the link"
                  onClick={() => {
                    void navigator.clipboard.writeText(charger.resolvedUrl);
                    notifications.show({ message: 'Link copied' });
                  }}
                >
                  <IconCopy size={13} />
                </ActionIcon>
              </Tooltip>
              <span className="sep">·</span>
              <span>Security profile {charger.securityProfile}</span>
            </div>
          )}
          {problem && (
            <div className="charger-problem">
              <IconAlertTriangle size={15} />
              <span>{problem}</span>
            </div>
          )}
        </div>

        <div className="head-actions">
          <label className={cls('switch-box', charger.poweredOn && 'on')}>
            <IconPower size={16} />
            Power
            <Switch
              size="sm"
              checked={charger.poweredOn}
              disabled={busy === 'power'}
              aria-label="Power"
              onChange={(e) => {
                const on = e.currentTarget.checked;
                void run('power', async () => apply(await setPower(charger.id, on)));
              }}
            />
          </label>
          <Tooltip label="Pull the network cable: the charger keeps running offline" multiline w={230}>
            <label className={cls('switch-box', charger.networkUp && 'on')}>
              <IconWifi size={16} />
              Network
              <Switch
                size="sm"
                checked={charger.networkUp}
                disabled={busy === 'network'}
                aria-label="Network"
                onChange={(e) => {
                  const up = e.currentTarget.checked;
                  void run('network', async () => apply(await setNetwork(charger.id, up)));
                }}
              />
            </label>
          </Tooltip>
          <Button
            variant="default"
            leftSection={<IconRefresh size={16} />}
            disabled={!live}
            loading={busy === 'reboot'}
            onClick={() => run('reboot', async () => apply(await rebootCharger(charger.id)))}
          >
            Restart
          </Button>
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="default" size={36} aria-label="More actions">
                <IconDots size={17} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconSettings size={15} />}
                onClick={() => navigate(`/chargers/${charger.id}/settings`)}
              >
                Settings
              </Menu.Item>
              <Menu.Item color="red" leftSection={<IconTrash size={15} />} onClick={() => setConfirmDelete(true)}>
                Delete charger
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      </div>

      <nav className="tabs">
        {TABS.map((t) => (
          <NavLink
            key={t.key}
            to={t.key === 'station' ? `/chargers/${charger.id}` : `/chargers/${charger.id}/${t.key}`}
            className={active === t.key ? 'active' : undefined}
            end
          >
            <t.icon size={16} />
            {t.label}
          </NavLink>
        ))}
      </nav>

      {active === 'station' && (
        <>
          <Scene charger={charger} cars={cars} tags={tags} />
          <GarageDock cars={cars} tags={tags} />
        </>
      )}
      {active === 'history' && <HistoryTab charger={charger} />}
      {active === 'log' && <LogTab charger={charger} />}
      {active === 'config' && <ConfigTab charger={charger} />}
      {active === 'advanced' && <AdvancedTab charger={charger} />}
      {active === 'settings' && <SettingsTab charger={charger} />}

      <Modal opened={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete ${charger.name}?`} size="sm">
        <Stack>
          <Text size="sm" c="dimmed">
            The charger, its connectors and its whole history (sessions, meter readings, logs) are
            removed. This cannot be undone.
          </Text>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Button variant="default" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button
              color="red"
              loading={busy === 'delete'}
              onClick={() =>
                run('delete', async () => {
                  await deleteCharger(charger.id);
                  navigate('/', { replace: true });
                })
              }
            >
              Delete charger
            </Button>
          </div>
        </Stack>
      </Modal>
    </>
  );
}

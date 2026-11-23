import {
  ActionIcon,
  Button,
  Modal,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Tooltip,
  useMantineColorScheme,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import {
  IconBolt,
  IconCar,
  IconChargingPile,
  IconHistory,
  IconLock,
  IconLogout,
  IconMoon,
  IconSun,
} from '@tabler/icons-react';
import { useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { errorMessage, getAuthStatus, register, token } from './lib/api';
import { useBackendOnline } from './lib/liveStores';
import { socket } from './lib/socket';
import { GaragePage } from './pages/GaragePage';
import { HistoryPage } from './pages/HistoryPage';
import { StationPage } from './station/StationPage';

/** Lock the instance behind a login, or sign out of a locked one. */
function LockControl() {
  const status = useQuery({ queryKey: ['auth-status'], queryFn: getAuthStatus });
  const [opened, setOpened] = useState(false);
  const [loading, setLoading] = useState(false);
  const form = useForm({
    initialValues: { email: '', password: '' },
    validate: {
      email: (v) => (/^\S+@\S+\.\S+$/.test(v) ? null : 'Enter an email address'),
      password: (v) => (v.length >= 8 ? null : 'At least 8 characters'),
    },
  });

  if (status.data?.locked) {
    return (
      <Tooltip label="Sign out">
        <ActionIcon
          variant="default"
          size="lg"
          aria-label="Sign out"
          onClick={() => {
            token.clear();
            window.location.reload();
          }}
        >
          <IconLogout size={17} />
        </ActionIcon>
      </Tooltip>
    );
  }

  const submit = form.onSubmit(async (values) => {
    setLoading(true);
    try {
      const { accessToken } = await register(values.email, values.password);
      token.set(accessToken);
      socket.disconnect().connect();
      notifications.show({ color: 'evis', message: 'This emulator now needs a sign-in' });
      setOpened(false);
      void status.refetch();
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error, 'Could not lock the emulator') });
    } finally {
      setLoading(false);
    }
  });

  return (
    <>
      <Tooltip label="Protect this emulator with a login">
        <ActionIcon variant="default" size="lg" aria-label="Lock this emulator" onClick={() => setOpened(true)}>
          <IconLock size={17} />
        </ActionIcon>
      </Tooltip>
      <Modal opened={opened} onClose={() => setOpened(false)} title="Lock this emulator" size="sm">
        <form onSubmit={submit}>
          <Stack>
            <Text size="sm" c="dimmed">
              Create the one account that may use this emulator. Useful when it is reachable by
              others. It cannot be undone from the UI.
            </Text>
            <TextInput label="Email" autoComplete="username" {...form.getInputProps('email')} />
            <PasswordInput
              label="Password"
              description="At least 8 characters"
              autoComplete="new-password"
              {...form.getInputProps('password')}
            />
            <Button type="submit" loading={loading} leftSection={<IconLock size={16} />}>
              Create account and lock
            </Button>
          </Stack>
        </form>
      </Modal>
    </>
  );
}

function SchemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const dark = colorScheme !== 'light';
  return (
    <Tooltip label={dark ? 'Light theme' : 'Dark theme'}>
      <ActionIcon
        variant="default"
        size="lg"
        aria-label="Switch colour theme"
        onClick={() => setColorScheme(dark ? 'light' : 'dark')}
      >
        {dark ? <IconSun size={17} /> : <IconMoon size={17} />}
      </ActionIcon>
    </Tooltip>
  );
}

export default function App() {
  const location = useLocation();
  const online = useBackendOnline();
  const onStation = location.pathname === '/' || location.pathname.startsWith('/chargers');

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">
            <IconBolt size={18} stroke={2.4} />
          </span>
          <span>
            EVIS <small>OCPP 1.6 emulator</small>
          </span>
        </Link>
        <nav className="nav">
          <NavLink to="/" className={onStation ? 'active' : undefined} end>
            <IconChargingPile size={16} /> Station
          </NavLink>
          <NavLink to="/garage">
            <IconCar size={16} /> Garage
          </NavLink>
          <NavLink to="/history">
            <IconHistory size={16} /> History
          </NavLink>
        </nav>
        <div className="topbar-right">
          <span
            className={`link-dot${online ? '' : ' down'}`}
            title={online ? 'Live updates from the emulator backend' : 'No live link to the emulator backend'}
          >
            <i />
            {online ? 'Live' : 'Backend offline'}
          </span>
          <SchemeToggle />
          <LockControl />
        </div>
      </header>
      <Routes>
        <Route path="/" element={<StationPage />} />
        <Route path="/chargers/:id" element={<StationPage />} />
        <Route path="/chargers/:id/:tab" element={<StationPage />} />
        <Route path="/garage" element={<GaragePage />} />
        <Route path="/history" element={<HistoryPage />} />
      </Routes>
    </div>
  );
}

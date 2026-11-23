import { Button, Center, Loader, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import { IconBolt, IconPlugConnectedX } from '@tabler/icons-react';
import { type ReactNode, useState } from 'react';
import { errorMessage, getAuthStatus, login, token } from '../lib/api';
import { socket } from '../lib/socket';

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);
  const form = useForm({ initialValues: { email: '', password: '' } });

  const submit = form.onSubmit(async (values) => {
    setLoading(true);
    try {
      const { accessToken } = await login(values.email, values.password);
      token.set(accessToken);
      // The live link was refused without a token: dial again with it.
      socket.disconnect().connect();
      onSuccess();
    } catch (error) {
      notifications.show({ color: 'red', message: errorMessage(error, 'Could not sign in') });
    } finally {
      setLoading(false);
    }
  });

  return (
    <Center h="100vh" p="md">
      <form onSubmit={submit} className="card card-pad" style={{ width: 360 }}>
        <Stack>
          <div className="brand">
            <span className="brand-mark">
              <IconBolt size={18} stroke={2.4} />
            </span>
            EVIS OCPP Emulator
          </div>
          <div>
            <Title order={3}>Sign in</Title>
            <Text size="sm" c="dimmed">
              This emulator is locked. Sign in to use it.
            </Text>
          </div>
          <TextInput label="Email" autoComplete="username" {...form.getInputProps('email')} />
          <PasswordInput
            label="Password"
            autoComplete="current-password"
            {...form.getInputProps('password')}
          />
          <Button type="submit" loading={loading}>
            Sign in
          </Button>
        </Stack>
      </form>
    </Center>
  );
}

/** Shows the app, or the sign-in form when the instance is locked. */
export function AuthGate({ children }: { children: ReactNode }) {
  const status = useQuery({ queryKey: ['auth-status'], queryFn: getAuthStatus, retry: false });

  if (status.isLoading) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }
  if (status.isError) {
    return (
      <Center h="100vh" p="md">
        <div className="empty">
          <span className="empty-icon">
            <IconPlugConnectedX size={26} />
          </span>
          <strong>The emulator backend is not reachable</strong>
          <span>Start it, then try again. It is expected at the address the UI was built for.</span>
          <Button variant="light" onClick={() => void status.refetch()} loading={status.isFetching}>
            Try again
          </Button>
        </div>
      </Center>
    );
  }
  if (status.data?.locked && !token.get()) {
    return <LoginScreen onSuccess={() => void status.refetch()} />;
  }
  return <>{children}</>;
}

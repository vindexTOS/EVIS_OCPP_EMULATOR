import {
  Button,
  Center,
  Loader,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { getAuthStatus, login, token } from '../lib/api';

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [loading, setLoading] = useState(false);
  const form = useForm({ initialValues: { email: '', password: '' } });

  const submit = form.onSubmit(async (values) => {
    setLoading(true);
    try {
      const { accessToken } = await login(values.email, values.password);
      token.set(accessToken);
      onSuccess();
    } catch {
      notifications.show({ color: 'red', message: 'Invalid email or password' });
    } finally {
      setLoading(false);
    }
  });

  return (
    <Center h="100vh">
      <Paper withBorder shadow="md" p="xl" w={360} radius="md">
        <form onSubmit={submit}>
          <Stack>
            <Title order={3}>🔒 Locked instance</Title>
            <Text size="sm" c="dimmed">
              Sign in to manage this emulator.
            </Text>
            <TextInput label="Email" {...form.getInputProps('email')} />
            <PasswordInput label="Password" {...form.getInputProps('password')} />
            <Button type="submit" loading={loading}>
              Sign in
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const status = useQuery({ queryKey: ['auth-status'], queryFn: getAuthStatus });

  if (status.isLoading) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  const locked = status.data?.locked;
  if (locked && !token.get()) {
    return <LoginScreen onSuccess={() => status.refetch()} />;
  }

  return <>{children}</>;
}

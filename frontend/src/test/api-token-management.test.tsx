import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { ThemeProvider } from '@/hooks/useTheme';
import type { AllSetting } from '@/models/setting';
import ApiTokenTab from '@/pages/settings/ApiTokenTab';
import SecurityTab from '@/pages/settings/SecurityTab';
import { chooseSelectOption } from '@/test/test-utils';
import { HttpUtil } from '@/utils';

const currentAdminState = vi.hoisted(() => ({
  value: {
    admin: {
      id: 1,
      role: { slug: 'owner', is_owner: true },
    },
    isLoading: false,
    error: '',
  },
}));

vi.mock('@/pg-ui/hooks/use-admin', () => ({
  useAdmin: () => currentAdminState.value,
}));

function renderWithTheme(ui: ReactNode) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

function tokenListResponse(obj: unknown) {
  return { success: true, msg: '', obj } as never;
}

describe('delegated API token management UI', () => {
  beforeEach(() => {
    vi.mocked(HttpUtil.get).mockReset();
    vi.mocked(HttpUtil.post).mockReset();
    currentAdminState.value = {
      admin: {
        id: 1,
        role: { slug: 'owner', is_owner: true },
      },
      isLoading: false,
      error: '',
    };
  });

  it('only exposes the API-token tab to the current owner', () => {
    currentAdminState.value = {
      admin: {
        id: 2,
        role: { slug: 'operator', is_owner: false },
      },
      isLoading: false,
      error: '',
    };
    const props = {
      allSetting: {} as AllSetting,
      updateSetting: vi.fn(),
      saveSetting: vi.fn(),
    };
    const view = renderWithTheme(<SecurityTab {...props} />);

    expect(screen.queryByRole('tab', { name: /API Token/i })).toBeNull();
    expect(HttpUtil.get).not.toHaveBeenCalled();

    currentAdminState.value = {
      admin: {
        id: 1,
        role: { slug: 'owner', is_owner: true },
      },
      isLoading: false,
      error: '',
    };
    view.rerender(
      <ThemeProvider>
        <SecurityTab {...props} />
      </ThemeProvider>,
    );

    expect(screen.getByRole('tab', { name: /API Token/i })).toBeTruthy();
  });

  it('creates a delegated token with an explicit subject, scopes and expiration', async () => {
    const created = {
      id: 9,
      name: 'telegram-operator-a',
      token: 'hmd_d_one_time_secret',
      kind: 'delegated',
      subjectAdminId: 7,
      subjectUsername: 'operator-a',
      subjectRoleName: 'Operator',
      scopes: ['clients:create', 'clients:read'],
      expiresAt: 1_900_000_000,
      expired: false,
      enabled: true,
      createdAt: 1_800_000_000,
    };

    vi.mocked(HttpUtil.get)
      .mockResolvedValueOnce(tokenListResponse([]))
      .mockResolvedValueOnce(tokenListResponse([{
        id: 7,
        username: 'operator-a',
        roleId: 3,
        roleName: 'Operator',
      }]))
      .mockResolvedValueOnce(tokenListResponse([{ ...created, token: undefined }]));
    vi.mocked(HttpUtil.post).mockResolvedValueOnce(tokenListResponse(created));

    renderWithTheme(<ApiTokenTab />);
    await waitFor(() => expect(HttpUtil.get).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /New token/i }));
    await waitFor(() => expect(HttpUtil.get).toHaveBeenCalledTimes(2));

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: '  telegram-operator-a  ' },
    });
    chooseSelectOption('subjectAdminId', 'operator-a — Operator');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Read clients' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Create clients' }));
    expect(screen.getByRole('checkbox', { name: 'Custom panel bot' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }));

    await waitFor(() => expect(HttpUtil.post).toHaveBeenCalledTimes(1));
    const createCall = vi.mocked(HttpUtil.post).mock.calls[0];
    expect(createCall[0]).toBe('/panel/api/setting/apiTokens/create');
    expect(createCall[1]).toEqual(expect.objectContaining({
      name: 'telegram-operator-a',
      kind: 'delegated',
      subjectAdminId: 7,
      scopes: ['clients:read', 'clients:create'],
      expiresAt: expect.any(Number),
    }));
    expect((createCall[1] as { expiresAt: number }).expiresAt).toBeGreaterThan(
      Math.floor(Date.now() / 1000) + (89 * 24 * 60 * 60),
    );

    expect(await screen.findByText('hmd_d_one_time_secret')).toBeTruthy();
    const done = screen.getByRole('button', { name: 'Done' });
    expect((done as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox', {
      name: 'I have saved this token in a secure location.',
    }));
    await waitFor(() => expect((screen.getByRole('button', {
      name: 'Done',
    }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog', {
      name: 'Token created',
    })).toBeNull());
  });

  it('shows delegated metadata and prevents re-enabling an expired token', async () => {
    vi.mocked(HttpUtil.get).mockResolvedValueOnce(tokenListResponse([{
      id: 4,
      name: 'expired-operator-token',
      kind: 'delegated',
      subjectAdminId: 7,
      subjectUsername: 'operator-a',
      subjectRoleName: 'Operator',
      scopes: ['clients:read'],
      expiresAt: 1,
      expired: true,
      enabled: true,
      createdAt: 1_780_000_000,
    }]));

    renderWithTheme(<ApiTokenTab />);

    expect(await screen.findByText('expired-operator-token')).toBeTruthy();
    expect(screen.getByText('operator-a')).toBeTruthy();
    expect(screen.getByText('Operator')).toBeTruthy();
    expect(screen.getByText('Read clients')).toBeTruthy();
    expect(screen.getByText('Expired')).toBeTruthy();
    expect((screen.getByRole('switch', {
      name: 'Enable token expired-operator-token',
    }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('requires an explicit warning acknowledgement before creating a service token', async () => {
    const created = {
      id: 12,
      name: 'trusted-remote-panel',
      token: 'hmd_s_one_time_secret',
      kind: 'service',
      scopes: ['*'],
      expiresAt: 1_900_000_000,
      expired: false,
      enabled: true,
      createdAt: 1_800_000_000,
    };
    vi.mocked(HttpUtil.get)
      .mockResolvedValueOnce(tokenListResponse([]))
      .mockResolvedValueOnce(tokenListResponse([]))
      .mockResolvedValueOnce(tokenListResponse([{ ...created, token: undefined }]));
    vi.mocked(HttpUtil.post).mockResolvedValueOnce(tokenListResponse(created));

    renderWithTheme(<ApiTokenTab />);
    await waitFor(() => expect(HttpUtil.get).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /New token/i }));
    await waitFor(() => expect(HttpUtil.get).toHaveBeenCalledTimes(2));

    const serviceRadio = screen.getByRole('radio', { name: /Service token/i });
    fireEvent.click(serviceRadio.closest('label') ?? serviceRadio);
    expect(await screen.findByText('Full-trust infrastructure credential')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'trusted-remote-panel' },
    });
    expect(screen.queryByLabelText('Panel administrator')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Create token' }));
    expect(await screen.findByText('Confirm the service-token security warning.')).toBeTruthy();
    expect(HttpUtil.post).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('checkbox', {
      name: /I understand that this credential has service-level access/i,
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }));

    await waitFor(() => expect(HttpUtil.post).toHaveBeenCalledTimes(1));
    expect(vi.mocked(HttpUtil.post).mock.calls[0][1]).toEqual({
      name: 'trusted-remote-panel',
      kind: 'service',
      expiresAt: expect.any(Number),
    });
    expect(await screen.findByText('hmd_s_one_time_secret')).toBeTruthy();
  });
});

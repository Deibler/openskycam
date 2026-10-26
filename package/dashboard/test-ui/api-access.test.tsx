import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiAccess, type ApiKeyInfo } from '../ui/components/api-access';

const key: ApiKeyInfo = {
  id: 'test-id',
  name: 'Colab notebook',
  prefix: 'svk_test…1234',
  scope: 'footage:read',
  cameras: ['sky01'],
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 86400000).toISOString(),
  last_used_at: null,
  rotated_at: null,
  revoked_at: null,
};
const token = 'test-only-secret-not-a-valid-api-key';
let keys: ApiKeyInfo[];
let fetchMock: ReturnType<typeof vi.fn>;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  keys = [];
  history.replaceState(null, '', '/?view=api');
  fetchMock = vi.fn(async (path: string, options?: RequestInit) => {
    if (path === '/api/keys' && options?.method === 'POST') {
      keys = [key];
      return json({ key, token }, 201);
    }
    if (path === '/api/keys/test-id' && options?.method === 'DELETE') {
      keys = [{ ...key, revoked_at: new Date().toISOString() }];
      return json({ key: keys[0] });
    }
    return json({
      keys,
      cameras: ['sky01', 'sky02'],
      max_active_keys: 20,
      api_base_url: location.origin,
      environment: 'development',
    });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'clipboard');
});

async function openCreate() {
  render(<ApiAccess />);
  await screen.findByText('0 active keys');
  fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: key.name } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'sky02' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Expires in' }), { target: { value: '30' } });
}

it('creates a scoped key and forgets its one-time secret when the dialog closes', async () => {
  await openCreate();
  fireEvent.click(screen.getByRole('button', { name: 'Create API key' }));
  expect(((await screen.findByRole('textbox', { name: 'New API key' })) as HTMLTextAreaElement).value).toBe(token);
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/keys',
    expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({ name: key.name, cameras: ['sky01'], expires_in_days: 30 }),
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByText(key.prefix)).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Create key' })));
  expect(document.body.innerHTML).not.toContain(token);
  expect(JSON.stringify(localStorage)).not.toContain(token);
});

it('keeps a failed creation editable without claiming a key was created', async () => {
  await openCreate();
  fetchMock.mockResolvedValueOnce(json({ error: 'Key limit reached.' }, 409));
  fireEvent.click(screen.getByRole('button', { name: 'Create API key' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Key limit reached.');
  expect(screen.queryByRole('textbox', { name: 'New API key' })).toBeNull();
  expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe(key.name);
  expect((screen.getByRole('button', { name: 'Create API key' }) as HTMLButtonElement).disabled).toBe(false);
});

it('requires confirmation before revoking and then shows the revoked state', async () => {
  keys = [key];
  render(<ApiAccess />);
  const manage = await screen.findByRole('button', { name: `Manage ${key.name}` });
  fireEvent.keyDown(manage, { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Revoke key' }));
  const dialog = await screen.findByRole('dialog');
  expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke key' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await screen.findByText('0 active keys')).toBeTruthy();
  expect((screen.getByRole('button', { name: `Manage ${key.name}` }) as HTMLButtonElement).disabled).toBe(true);
});

it('shows copy failure inside the secret dialog so manual copying remains possible', async () => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) },
  });
  await openCreate();
  fireEvent.click(screen.getByRole('button', { name: 'Create API key' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Copy key' }));
  expect((await within(screen.getByRole('dialog')).findByRole('status')).textContent).toContain('copy it manually');
  expect((screen.getByRole('textbox', { name: 'New API key' }) as HTMLTextAreaElement).value).toBe(token);
});

it('offers inference purpose only with a registered pipeline and sends its restricted scope', async () => {
  fetchMock.mockResolvedValueOnce(
    json({
      keys: [],
      cameras: ['sky01', 'sky02'],
      pipelines: ['baseline-test'],
      max_active_keys: 20,
      api_base_url: location.origin,
      environment: 'development',
    }),
  );
  await openCreate();
  fireEvent.change(screen.getByRole('combobox', { name: 'Purpose' }), { target: { value: 'processor:run' } });
  expect((screen.getByRole('combobox', { name: 'Pipeline' }) as HTMLSelectElement).value).toBe('baseline-test');
  fireEvent.click(screen.getByRole('button', { name: 'Create API key' }));
  await screen.findByRole('textbox', { name: 'New API key' });
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/keys',
    expect.objectContaining({
      body: JSON.stringify({
        name: key.name,
        cameras: ['sky01'],
        expires_in_days: 30,
        scope: 'processor:run',
        pipeline_id: 'baseline-test',
      }),
    }),
  );
});

it('creates an Agent key and shows the command that connects Claude Code to the MCP server', async () => {
  await openCreate();
  fetchMock.mockResolvedValueOnce(json({ key: { ...key, scope: 'agent' }, token }, 201));
  fireEvent.change(screen.getByRole('combobox', { name: 'Purpose' }), { target: { value: 'agent' } });
  expect(screen.getByText(/It cannot manage API keys/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Create API key' }));
  const command = (await screen.findByRole('textbox', { name: 'Claude Code command' })) as HTMLTextAreaElement;
  expect(command.value).toBe(
    `claude mcp add --transport http openskycam ${location.origin}/v1/mcp --header "Authorization: Bearer ${token}" --scope user`,
  );
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/keys',
    expect.objectContaining({
      body: JSON.stringify({ name: key.name, cameras: ['sky01'], expires_in_days: 30, scope: 'agent' }),
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.body.innerHTML).not.toContain(token);
});

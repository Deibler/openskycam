import { forwardRef, useImperativeHandle } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const tooltip = document.createElement('div');
  tooltip.id = 'tooltip';
  document.body.append(tooltip);
});
type Shown = { segment: { start: string }; offset: number } | null;
const seen: { selection: Shown; onProgress: (start: string, offset: number) => void }[] = [];
const skip = vi.fn();
vi.mock('../ui/components/viewer', () => ({
  Viewer: forwardRef(function Viewer(props: { selection: Shown; onProgress: never }, ref) {
    useImperativeHandle(ref, () => ({ skip, toggle: vi.fn(), markLoop: vi.fn() }));
    seen.push({ selection: props.selection, onProgress: props.onProgress });
    return <div>viewer</div>;
  }),
}));
import App from '../ui/App';
import { TooltipProvider } from '../ui/components/ui/tooltip';

// Yesterday has a recording every minute from 08:00 to 16:00 UTC.
const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const at = `${day}T10:05:00.000Z`;
const shown = () => seen.at(-1)?.selection;
let failures = 0;
const noFootage = { healthy: false, newest_start: null, newest_uploaded_at: null, age_seconds: null };
let health: object = noFootage;
beforeEach(() => {
  seen.length = 0;
  failures = 0;
  health = noFootage;
  skip.mockClear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (path.startsWith('/api/overview'))
        return json({
          viewer: { email: 'a@b.c' },
          cameras: ['sky01'],
          cam: 'sky01',
          generated_at: new Date().toISOString(),
          health,
          last_24h: { segments: 0, bytes: 0, seconds: 0 },
          retained: { segments: 0, bytes: 0, seconds: 0 },
          days: [],
          projection: { bytes_per_day: null, steady_state_bytes: null },
        });
      if (path.startsWith('/api/segments')) {
        if (failures > 0 && failures--) return json({ error: 'busy' }, 503);
        const q = new URLSearchParams(path.split('?')[1]);
        const from = Date.parse(q.get('from')!),
          to = Date.parse(q.get('to')!);
        const segments = [];
        for (let t = Date.parse(`${day}T08:00:00Z`); t < Date.parse(`${day}T16:00:00Z`); t += 60000)
          if (t >= from && t < to)
            segments.push({
              start: new Date(t).toISOString(),
              size: 1,
              duration_s: 60,
              frames: null,
              width: null,
              height: null,
              bitrate: null,
              codec: null,
            });
        return json({ segments });
      }
      if (path.startsWith('/api/availability')) return json({ days: [] });
      throw new Error(path);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const open = (search: string) => {
  history.replaceState(null, '', `/?${search}`);
  render(
    <TooltipProvider>
      <App />
    </TooltipProvider>,
  );
};

it('opens a linked moment even when the link names a different calendar day', async () => {
  // A link copied in another time zone can name the day before or after the moment's day here.
  const elsewhere = new Date(Date.parse(day) - 3 * 86400000).toISOString().slice(0, 10);
  open(`day=${elsewhere}&tz=local&cam=sky01&at=${encodeURIComponent(at)}&t=12`);
  await waitFor(() => expect(shown()?.segment.start).toBe(at));
  expect(shown()!.offset).toBe(12);
});

it('opens the linked moment when Retry follows a failed first load', async () => {
  failures = 1;
  open(`day=${day}&tz=UTC&cam=sky01&at=${encodeURIComponent(at)}&t=30`);
  const retry = await screen.findByRole('button', { name: 'Retry' });
  await act(async () => {
    fireEvent.click(retry);
  });
  await waitFor(() => expect(shown()?.segment.start).toBe(at));
  expect(shown()!.offset).toBe(30);
});

it('keeps the playback position when the time zone changes', async () => {
  open(`day=${day}&tz=UTC&cam=sky01&at=${encodeURIComponent(at)}&t=30`);
  await waitFor(() => expect(shown()?.segment.start).toBe(at));
  await act(async () => {
    seen.at(-1)!.onProgress(at, 42);
  });
  fireEvent.click(screen.getByRole('button', { name: /Choose recording date/ }));
  const zone = await screen.findByLabelText('Time zone', {}, { timeout: 10000 });
  await act(async () => {
    fireEvent.change(zone, { target: { value: 'local' } });
  });
  await waitFor(() => expect(location.search).toContain('tz=local'));
  await waitFor(() => expect(shown()?.offset).toBe(42));
  expect(shown()!.segment.start).toBe(at);
});

it('moves through the minute picker with the arrow keys without seeking the player', async () => {
  open(`tz=UTC&day=${day}&cam=sky01`);
  // The picker shows the hour of the newest recording, 15:00 to 15:59.
  const minute = await waitFor(() => screen.getByRole('button', { name: /^15:05, 1 recording/ }));
  minute.focus();
  fireEvent.keyDown(minute, { key: 'ArrowRight' });
  expect(document.activeElement?.getAttribute('data-minute')).toBe('6');
  expect(skip).not.toHaveBeenCalled();
});

it("says footage is arriving by the server's measure, whatever this computer's clock says", async () => {
  // The server saw an upload 20 seconds ago; this computer's clock runs an hour ahead of it.
  const uploaded = new Date(Date.now() - 3600_000).toISOString();
  health = { healthy: true, newest_start: uploaded, newest_uploaded_at: uploaded, age_seconds: 20 };
  open(`day=${day}&tz=UTC&cam=sky01`);
  expect(await screen.findByText('Receiving footage')).toBeTruthy();
});

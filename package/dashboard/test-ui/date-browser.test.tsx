import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DateBrowser } from '../ui/components/date-browser';
import type { DayAvailability } from '../ui/hooks/use-available-days';

const layout = vi.hoisted(() => ({ landscape: false }));
vi.mock('../ui/hooks/use-compact-layout', () => ({ useLandscapeLayout: () => layout.landscape }));
beforeEach(() => {
  layout.landscape = false;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-22T20:00:00Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const availability: DayAvailability = {
  days: new Set(['2026-09-20', '2026-09-22']),
  loading: false,
  error: null,
  retry: vi.fn(),
};

it('dims and disables empty calendar days, including keyboard and pointer selection', () => {
  const change = vi.fn();
  render(<DateBrowser value="2026-09-22" zone="UTC" availability={availability} onChange={change} />);
  const empty = screen.getByRole('button', { name: /September 21/ }) as HTMLButtonElement;
  expect(empty.disabled).toBe(true);
  expect(empty.closest('.rdp-disabled')).toBeTruthy();
  fireEvent.click(empty);
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /September 20/ }));
  expect(change).toHaveBeenCalledWith('2026-09-20');
  expect((screen.getByRole('button', { name: 'Today' }) as HTMLButtonElement).disabled).toBe(false);
});

it('disables Today when it has no recordings', () => {
  render(
    <DateBrowser
      value="2026-09-20"
      zone="local"
      availability={{ ...availability, days: new Set(['2026-09-20']) }}
      onChange={vi.fn()}
    />,
  );
  expect((screen.getByRole('button', { name: 'Today' }) as HTMLButtonElement).disabled).toBe(true);
});

it('does not mistake failed or pending availability for an empty archive', () => {
  const retry = vi.fn();
  const props = { value: '2026-09-22', zone: 'UTC' as const, onChange: vi.fn() };
  const view = render(<DateBrowser {...props} availability={{ days: null, loading: true, error: null, retry }} />);
  expect(screen.getByText('Checking recordings…').getAttribute('role')).toBe('status');
  expect((screen.getByRole('button', { name: /September 22/ }) as HTMLButtonElement).disabled).toBe(true);
  view.rerender(
    <DateBrowser
      {...props}
      availability={{ days: null, loading: false, error: 'Could not check recording dates.', retry }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.queryByText('No recordings in the last 40 days.')).toBeNull();
});

it('offers only recorded days in the landscape date panel', () => {
  layout.landscape = true;
  const change = vi.fn();
  const zone = vi.fn();
  render(<DateBrowser value="2026-09-22" zone="UTC" availability={availability} onChange={change} onZone={zone} />);
  expect(screen.queryByRole('grid')).toBeNull();
  expect(screen.queryByRole('button', { name: /Sep 21/ })).toBeNull();
  expect(screen.getByRole('button', { name: /Sep 22/ }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: /Sep 20/ }));
  expect(change).toHaveBeenCalledWith('2026-09-20');
  fireEvent.change(screen.getByRole('combobox', { name: 'Time zone' }), { target: { value: 'local' } });
  expect(zone).toHaveBeenCalledWith('local');
});

it('allows recorded days up to the 40-day retention limit', () => {
  const change = vi.fn();
  render(
    <DateBrowser
      value="2026-08-20"
      zone="UTC"
      availability={{ ...availability, days: new Set(['2026-08-18', '2026-08-20']) }}
      onChange={change}
    />,
  );
  const old = screen.getByRole('button', { name: /August 18/ }) as HTMLButtonElement;
  expect(old.disabled).toBe(false);
  fireEvent.click(old);
  expect(change).toHaveBeenCalledWith('2026-08-18');
});

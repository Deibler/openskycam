import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BucketFeed } from '../ui/features/workshop/components/bucket-feed';
import { useReviewDecisions } from '../ui/features/workshop/hooks/use-review-decisions';
import { useSnapScroll } from '../ui/features/workshop/hooks/use-snap-scroll';
import { focusCamera, screenBox } from '../ui/features/workshop/utils/reviewCameraInferenceUtil';
import { groupSightings } from '../ui/features/workshop/utils/sightingInferenceUtil';
import type { WorkshopRunImage } from '../src/models/workshopInferencemodel';
import { contrastOver, iphone, meets, phoneLayout, standalone } from './phone-layout';

// The reviewer on a phone: the photo is the content, so feedback and controls must never cover it,
// or each other, more than they need to.
const classes = ['Plane', 'WildLife', 'Meteorite', 'Satellite', 'Bird', 'Drone', 'Balloon', 'Insect'].map(
  (name, id) => ({ id, name }),
);
const frame = (id: string, second: number, classId = 0, box = [0.48, 0.03, 0.49, 0.04]): WorkshopRunImage => ({
  id,
  bucket_id: 'planes',
  asset_id: id,
  run_id: 'run',
  job_id: 'job',
  source_sha256: 's',
  cam: 'sky01',
  captured_at: new Date(Date.UTC(2026, 9, 10, 4, 3, second)).toISOString(),
  object_key: 'k',
  sha256: 'h',
  expires_at: '2026-11-19T00:00:00.000Z',
  review: 'pending',
  created_at: '2026-10-10T05:00:00.000Z',
  image_url: `/api/workshop/items/${id}/image`,
  annotation_json: JSON.stringify([{ box, class_id: classId, class_name: classes[classId].name, confidence: 0.39 }]),
  provenance_json: JSON.stringify({
    width: 3840,
    height: 2160,
    annotation_model: { node_id: 'model', task: 'object-detection', classes },
  }),
});
// Two sightings, newest first: a, b (2 photos) at 04:03:40, and c at 03:58:40.
const items = [frame('a', 40), frame('b', 42), frame('c', -260)];

function Feed({ photos = items }: { photos?: WorkshopRunImage[] }) {
  const decisions = useReviewDecisions();
  const sightings = groupSightings(photos.map(decisions.latest)).reverse();
  return (
    <div className="wk-shell">
      <BucketFeed
        title="Planes"
        total={12103}
        sightings={sightings}
        start={0}
        decisions={decisions}
        runName={() => 'Night meteors and planes · New footage'}
        hasMore={false}
        onMore={vi.fn()}
        onRetain={vi.fn()}
        onFocus={vi.fn()}
        onBack={vi.fn()}
      />
    </div>
  );
}
const current = () => document.querySelector<HTMLElement>('.wk-card[data-current]')!;
const confirm = () =>
  act(async () => {
    fireEvent.click(within(current()).getByRole('button', { name: 'Confirm' }));
  });

let puts: { id: string; review: string }[] = [],
  failSave = false;
beforeEach(() => {
  puts = [];
  failSave = false;
  // A phone: the reviewer's phone layout applies.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width: 640px') || query === '(pointer: coarse)',
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    width: 390,
    height: 844,
    top: 0,
    right: 390,
    bottom: 844,
    left: 0,
    toJSON() {},
  });
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (failSave)
        return new Response(JSON.stringify({ error: 'Save interrupted. Check your connection and try again.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      puts.push({ id: decodeURIComponent(path.split('/')[4]), review: body.review });
      return new Response(JSON.stringify({ review: body.review }), { headers: { 'Content-Type': 'application/json' } });
    }),
  );
});
afterEach(async () => {
  await act(async () => cleanup());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// --- Where things sit, read from the stylesheets for a 390 × 844 phone ---
it('keeps Undo after a Confirm clear of the top buttons and the rail, in Safari and from the home screen', async () => {
  render(<Feed />);
  await confirm();
  const surface = screen.getByRole('status');
  for (const phone of [iphone, standalone]) {
    const layout = phoneLayout(phone),
      card = current();
    const top = layout.box(card.querySelector('.wk-card-top')!),
      rail = layout.box(card.querySelector('.wk-actions')!);
    const parts = [surface, ...surface.querySelectorAll('button')].filter(
      el => layout.shown(el) && layout.events(el) !== 'none',
    );
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) {
      const b = layout.hitBox(part);
      expect(
        meets(b, top),
        `${part.className} at ${JSON.stringify(b)} meets the top buttons ${JSON.stringify(top)}`,
      ).toBe(false);
      expect(meets(b, rail), `${part.className} at ${JSON.stringify(b)} meets the rail ${JSON.stringify(rail)}`).toBe(
        false,
      );
      // Nothing new in the top fifth after a decision.
      expect(b.top).toBeGreaterThan(phone.height * 0.2);
    }
  }
});
it('lets the buttons where the toast used to drop in take their taps after a Confirm', async () => {
  render(<Feed />);
  await confirm();
  const layout = phoneLayout(iphone),
    card = current(),
    surface = screen.getByRole('status');
  const candidates = [
    surface,
    ...surface.querySelectorAll('button'),
    ...card.querySelectorAll('.wk-card-top > *'),
    ...document.querySelectorAll('.wk-stamp'),
  ];
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: (x: number, y: number) => layout.hit(x, y, candidates),
  });
  const buttons = [...card.querySelectorAll<HTMLElement>('.wk-card-top > button')];
  expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual([
    'Opens sightings on the video',
    'Show full frame',
    'Show this batch as a grid',
  ]);
  for (const button of buttons) {
    const b = layout.box(button);
    expect(document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2)).toBe(button);
  }
  // The toast's old place: 58px down, across the middle.
  const spot = document.elementFromPoint(iphone.width / 2 + 60, 58 + 20);
  expect(spot && surface.contains(spot)).toBeFalsy();
});
it('moves Undo to the far end of its row when the next object sits in its corner', async () => {
  const layout = phoneLayout(iphone);
  // The top buttons and Undo measure where the stylesheets put them; everything else fills the screen.
  // Mid-swipe: the new card is still on its way up, with all it holds; Undo, over the feed, is not.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const b = this.matches('.wk-card-top, .wk-undo-row, .wk-undo')
        ? layout.box(this)
        : { left: 0, top: 0, right: iphone.width, bottom: iphone.height },
      lag = this.closest('.wk-card[data-current]') ? 300 : 0;
    return {
      left: b.left,
      right: b.right,
      top: b.top + lag,
      bottom: b.bottom + lag,
      x: b.left,
      y: b.top + lag,
      width: b.right - b.left,
      height: b.bottom - b.top,
      toJSON() {},
    };
  });
  // An object in the photo's bottom left corner: the camera can only show it in the screen's.
  const corner = [0, 0.97, 0.03, 1];
  render(<Feed photos={[frame('a', 40), frame('b', 42), frame('c', -260, 0, corner)]} />);
  await confirm();
  const view = { width: iphone.width, height: iphone.height },
    size = { width: 3840, height: 2160 },
    s = screenBox(size, focusCamera(view, size, corner), corner);
  // With its label above it.
  const object = { left: s.left, top: s.top - 24, right: s.left + s.width, bottom: s.top + s.height };
  expect(document.querySelector('.wk-reviewer')!.getAttribute('data-box-undo')).toBe('end');
  // The DOM has changed since the first reading.
  const now = phoneLayout(iphone),
    button = screen.getByRole('button', { name: 'Undo' }),
    undo = now.box(button);
  expect(meets(undo, object), `Undo at ${JSON.stringify(undo)} covers the object at ${JSON.stringify(object)}`).toBe(
    false,
  );
  expect(meets(now.hitBox(button), now.box(current().querySelector('.wk-actions')!))).toBe(false);
});
it('fills the chosen class with its own color under text of 4.5:1 or more, for every class and None', async () => {
  for (const { id, name } of classes) {
    render(<Feed photos={[frame(`p${id}`, 0, id)]} />);
    const card = current(),
      title = card.querySelector<HTMLElement>('.wk-card-title button');
    // On a phone the classes open from the title.
    if (title) fireEvent.click(title);
    const chip = within(card).getByRole('button', { pressed: true, name: new RegExp(`^${name}`) });
    const layout = phoneLayout(iphone),
      text = layout.resolve(chip, layout.get(chip, 'color')!),
      fill = layout.resolve(chip, layout.get(chip, 'background')!);
    // Over a night sky: see-through fills are laid on black.
    expect(contrastOver(text, fill), `${name}: ${text} on ${fill}`).toBeGreaterThanOrEqual(4.5);
    await act(async () => cleanup());
  }
  // None, as the batch grid marks photos.
  document.body.innerHTML = `<div class="wk-shell"><div class="wk-reviewer dark"><div class="wk-batch">
    <div class="wk-class-keys" role="group"><button type="button" data-kind="none" aria-pressed="true">None</button></div>
  </div></div></div>`;
  const none = document.querySelector('[data-kind="none"]')!,
    layout = phoneLayout(iphone),
    text = layout.resolve(none, layout.get(none, 'color')!),
    fill = layout.resolve(none, layout.get(none, 'background')!);
  expect(contrastOver(text, fill), `None: ${text} on ${fill}`).toBeGreaterThanOrEqual(4.5);
  document.body.innerHTML = '';
});
it('puts Confirm lowest on the rail, nearest the thumb, then None, with Get, Save and Edit above', () => {
  render(<Feed />);
  const layout = phoneLayout(iphone),
    rail = current().querySelector('.wk-actions')!;
  const order = [...rail.querySelectorAll('.wk-action, [data-choice]')]
    .map(el => ({
      name:
        el.getAttribute('aria-label') ??
        [...el.childNodes]
          .filter(n => n.nodeType === Node.TEXT_NODE)
          .map(n => n.textContent)
          .join(''),
      top: layout.box(el).top,
    }))
    .sort((a, b) => a.top - b.top)
    .map(x => x.name);
  expect(order).toEqual(['Edit labels', 'Save images beyond expiration', 'Download original image', 'None', 'Confirm']);
  for (const el of rail.querySelectorAll('.wk-action, [data-choice]')) {
    const b = layout.box(el);
    expect(b.bottom - b.top).toBeGreaterThanOrEqual(44);
  }
});

// --- What the reviewer does on a phone ---
it('shows a decision where it was made, with a small Undo that ⌘Z, the next decision, or 5 seconds ends', async () => {
  vi.useFakeTimers();
  render(<Feed />);
  await confirm();
  expect(puts.map(p => p.review)).toEqual(['accepted', 'accepted']);
  expect(document.querySelector('.wk-toast')).toBeNull();
  const status = screen.getByRole('status');
  expect(status.textContent).toContain('Plane · Confirmed');
  expect(within(status).getByRole('button', { name: 'Undo' })).toBeTruthy();
  expect(document.querySelector('.wk-stamp')?.getAttribute('data-choice')).toBe('yes');
  // Gone in 0.6s with no animation ending it, as with Reduce Motion (jsdom runs no animations).
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(document.querySelector('.wk-stamp')).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(document.querySelector('.wk-stamp')).toBeNull();
  // The caption steps up to make room.
  expect(current().hasAttribute('data-lifted')).toBe(true);
  puts = [];
  await act(async () => {
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
  });
  expect(puts.map(p => p.review)).toEqual(['pending', 'pending']);
  expect(screen.queryByRole('status')).toBeNull();
  await act(async () => {
    fireEvent.click(within(current()).getByRole('button', { name: 'None' }));
  });
  expect(document.querySelector('.wk-stamp')?.getAttribute('data-choice')).toBe('no');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4900);
  });
  expect(screen.getByRole('status')).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(screen.queryByRole('status')).toBeNull();
  expect(current().hasAttribute('data-lifted')).toBe(false);
});
it('shows a failed save as one line in the bottom corner that a tap opens, and keeps it while open', async () => {
  vi.useFakeTimers();
  render(<Feed />);
  failSave = true;
  await confirm();
  const error = within(screen.getByRole('status')).getByRole('button', { name: /^Couldn’t save 2 of 2 photos/ });
  expect(error.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(error);
  expect(error.getAttribute('aria-expanded')).toBe('true');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8000);
  });
  expect(screen.getByRole('status')).toBeTruthy();
  fireEvent.click(error);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5100);
  });
  expect(screen.queryByRole('status')).toBeNull();
});
it('says what it is and how sure on one line, the rest on the next, with the classes one tap away', async () => {
  render(<Feed />);
  const card = current(),
    title = within(card).getByRole('button', { name: /^Plane · 39%/ });
  expect(title.getAttribute('aria-expanded')).toBe('false');
  expect(within(card).queryByRole('group', { name: 'What it is' })).toBeNull();
  const more = within(card).getByRole('button', {
    name: /^sky01 · .* · 2 photos · Night meteors and planes · New footage$/,
  });
  fireEvent.click(more);
  expect(more.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(title);
  const group = within(card).getByRole('group', { name: 'What it is' });
  expect(
    within(group)
      .getByRole('button', { name: /^Plane/ })
      .getAttribute('aria-pressed'),
  ).toBe('true');
  fireEvent.click(within(group).getByRole('button', { name: /^Meteorite/ }));
  expect(within(card).queryByRole('group', { name: 'What it is' })).toBeNull();
  expect(within(card).getByRole('button', { name: /^Meteorite$/ })).toBeTruthy();
  expect(within(card).getByText('Changed · tap Confirm to save')).toBeTruthy();
  // The number keys still say what it is with the classes closed.
  await act(async () => {
    fireEvent.keyDown(window, { key: '2' });
  });
  expect(within(card).getByRole('button', { name: /^WildLife$/ })).toBeTruthy();
  await act(async () => {
    fireEvent.keyDown(window, { key: 'Enter' });
  });
  expect(puts.map(p => p.review)).toEqual(['accepted', 'accepted']);
});
it('hides the chrome while a finger rests on the photo, without taking swipes, pinches or double-taps', async () => {
  vi.useFakeTimers();
  render(<Feed />);
  const stage = current().querySelector<HTMLElement>('.wk-card-stage')!,
    reviewer = stage.closest('.wk-reviewer')!;
  const touch = (type: 'pointerDown' | 'pointerMove' | 'pointerUp', id: number, y = 300) =>
    fireEvent[type](stage, { pointerId: id, pointerType: 'touch', clientX: 120, clientY: y });
  touch('pointerDown', 1);
  act(() => vi.advanceTimersByTime(260));
  expect(reviewer.hasAttribute('data-peek')).toBe(true);
  touch('pointerUp', 1);
  expect(reviewer.hasAttribute('data-peek')).toBe(false);
  // Lifting after a peek is no tap: two quick taps then make one, not a double-tap's Confirm.
  await act(async () => {
    fireEvent.click(stage, { timeStamp: 1000 });
    fireEvent.click(stage, { timeStamp: 1100 });
  });
  expect(puts).toEqual([]);
  // A swipe moves first; a second finger is a pinch; a mouse never peeks.
  touch('pointerDown', 2);
  touch('pointerMove', 2, 320);
  act(() => vi.advanceTimersByTime(300));
  touch('pointerUp', 2, 320);
  touch('pointerDown', 3);
  touch('pointerDown', 4);
  act(() => vi.advanceTimersByTime(300));
  fireEvent.pointerDown(stage, { pointerId: 5, pointerType: 'mouse', clientX: 120, clientY: 300 });
  act(() => vi.advanceTimersByTime(300));
  expect(reviewer.hasAttribute('data-peek')).toBe(false);
});
it('shows a whole page again at once after the strip resizes, as when Safari’s toolbar moves', () => {
  let resized = () => {};
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  function Strip() {
    const [ref, onScroll] = useSnapScroll('y', 3, () => {});
    return <div ref={ref} onScroll={onScroll} data-testid="strip" />;
  }
  render(<Strip />);
  const strip = screen.getByTestId('strip'),
    scrollTo = vi.fn();
  strip.scrollTo = scrollTo;
  Object.defineProperty(strip, 'clientHeight', { configurable: true, value: 700 });
  act(() => resized());
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 2100, behavior: 'instant' });
});

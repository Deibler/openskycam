import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DetectionBrowser } from '../ui/features/workshop/components/detection-browser';
import { SightingList } from '../ui/features/workshop/components/sighting-panel';
import { dayFilter, emptyFilters, filterDay, tileFraming } from '../ui/features/workshop/utils/browserInferenceUtil';
import { groupSightings } from '../ui/features/workshop/utils/sightingInferenceUtil';
import type { WorkshopRunImage } from '../src/models/workshopInferencemodel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const photo = (id: string, at: string, confidence = 0.6): WorkshopRunImage =>
  ({
    id,
    captured_at: at,
    object_key: 'k',
    review: 'pending',
    image_url: `/original/${id}`,
    provenance_json: '{}',
    annotation_json: JSON.stringify([{ box: [0.8, 0.4, 0.82, 0.42], class_name: 'Plane', confidence }]),
  }) as WorkshopRunImage;

it('lays sightings out under a heading per day, covers each with its surest photo, and switches to full frames kept on the object', () => {
  const sightings = groupSightings([
    photo('a', '2026-09-26T20:00:00'),
    photo('b', '2026-09-26T20:00:02', 0.9),
    photo('c', '2026-09-25T21:00:00'),
  ]).reverse();
  const onOpen = vi.fn(),
    onCrop = vi.fn();
  const view = (crop: boolean) => (
    <DetectionBrowser
      sightings={sightings}
      total={3}
      filters={emptyFilters}
      onFilters={vi.fn()}
      crop={crop}
      onCrop={onCrop}
      loading={false}
      more={false}
      hasMore={false}
      onMore={vi.fn()}
      onOpen={onOpen}
      selection={null}
      onSelection={vi.fn()}
    />
  );
  const { rerender } = render(view(true));
  const days = screen.getAllByRole('region');
  expect(days.map(day => day.getAttribute('aria-label'))).toEqual([
    new Date('2026-09-26T20:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
    new Date('2026-09-25T21:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
  ]);
  const pair = within(days[0]).getByRole('button', { name: /2 photos$/ });
  expect(pair.querySelector('img')?.getAttribute('src')).toMatch(/items\/b\/thumbnail\?.*mode=object/);
  fireEvent.click(within(days[1]).getByRole('button', { name: /1 photo$/ }));
  expect(onOpen).toHaveBeenCalledWith(1);
  fireEvent.click(screen.getByRole('button', { name: 'Show full frames' }));
  expect(onCrop).toHaveBeenCalledWith(false);
  rerender(view(false));
  const image = screen.getAllByRole('region')[0].querySelector('img')!;
  expect(image.getAttribute('src')).toContain('mode=frame');
  expect(image.style.objectPosition).toBe('81% 50%');
});
it('turns a day into a local midnight-to-midnight range and reads it back, and nothing else', () => {
  expect(dayFilter('2026-12-31')).toEqual({ from: '2026-12-31T00:00', to: '2027-01-01T00:00' });
  expect(dayFilter('')).toEqual({ from: '', to: '' });
  expect(filterDay({ ...emptyFilters, ...dayFilter('2026-03-08') })).toBe('2026-03-08');
  expect(filterDay({ ...emptyFilters, from: '2026-03-08T00:00', to: '2026-03-10T00:00' })).toBe('');
  expect(filterDay({ ...emptyFilters, from: '2026-03-08T06:00', to: '2026-03-09T00:00' })).toBe('');
  expect(filterDay(emptyFilters)).toBe('');
});

/** An IntersectionObserver whose entries the test decides. */
class Viewport {
  static all: Viewport[] = [];
  watched: Element[] = [];
  constructor(private callback: (entries: Partial<IntersectionObserverEntry>[]) => void) {
    Viewport.all.push(this);
  }
  observe(element: Element) {
    this.watched.push(element);
  }
  unobserve() {}
  disconnect() {
    this.watched = [];
  }
  static show(element: Element, visible = true) {
    act(() => {
      for (const observer of Viewport.all.filter(o => o.watched.includes(element)))
        observer.callback([{ isIntersecting: visible, target: element }]);
    });
  }
}
it('stands the full photo in for a failed thumbnail only on screen, three at a time, framed like the thumbnail', () => {
  Viewport.all = [];
  vi.stubGlobal('IntersectionObserver', Viewport);
  const sightings = groupSightings(['a', 'b', 'c', 'd', 'e'].map((id, i) => photo(id, `2026-09-26T1${i}:00:00`)));
  render(
    <DetectionBrowser
      sightings={sightings.reverse()}
      total={5}
      filters={emptyFilters}
      onFilters={vi.fn()}
      crop
      onCrop={vi.fn()}
      loading={false}
      more={false}
      hasMore={false}
      onMore={vi.fn()}
      onOpen={vi.fn()}
      selection={null}
      onSelection={vi.fn()}
    />,
  );
  const tiles = [...document.querySelectorAll<HTMLElement>('.wk-tile-image')];
  const image = (at: number) => tiles[at].querySelector('img');
  const shown = () => tiles.map((_, at) => image(at)?.getAttribute('src') ?? '');
  // Newest first: e, d, c, b, a.
  tiles.forEach((_, at) => fireEvent.error(image(at)!));
  expect(shown()).toEqual(['', '', '', '', '']);
  expect(tiles.every(tile => tile.querySelector('.wk-thumbnail-placeholder'))).toBe(true);
  tiles.forEach(tile => Viewport.show(tile));
  expect(shown()).toEqual(['/original/e', '/original/d', '/original/c', '', '']);
  // The last tile leaves the screen before its turn, so the next free turn goes to the one still there.
  Viewport.show(tiles[4], false);
  fireEvent.load(image(0)!);
  expect(tiles[0].hasAttribute('data-loaded')).toBe(true);
  expect(shown()).toEqual(['/original/e', '/original/d', '/original/c', '/original/b', '']);
  fireEvent.error(image(1)!);
  expect(shown()[4]).toBe('');
  Viewport.show(tiles[4]);
  expect(shown()[4]).toBe('/original/a');
  // The box [.8, .4, .82, .42] in the default 1920 × 1080 frame: a 62 × 35 crop at (1524, 425) fills the
  // tile's height, centered on the tile.
  const style = image(0)!.style;
  expect(parseFloat(style.height)).toBeCloseTo((1080 / 35) * 100, 3);
  expect([style.top, style.left, style.width, style.maxWidth]).toEqual(['50%', '50%', 'auto', 'none']);
  const [x, y] = style.transform.match(/-?[\d.]+/g)!.map(Number);
  expect(x).toBeCloseTo((-(1524 + 31) / 1920) * 100, 3);
  expect(y).toBeCloseTo((-(425 + 17.5) / 1080) * 100, 3);
  // A full frame slides to keep its object in view, thumbnail or photo alike.
  expect(tileFraming(photo('f', '2026-09-26T20:00:00'), false, true)).toEqual({ objectPosition: '81% 50%' });
  expect(tileFraming(photo('f', '2026-09-26T20:00:00'), true, false)).toBeUndefined();
});
it('lists a run’s sightings with object thumbnails, not their full photos', () => {
  const onSelect = vi.fn();
  render(
    <SightingList
      sightings={groupSightings([photo('a', '2026-09-26T20:00:00'), photo('b', '2026-09-26T22:00:00')])}
      current=""
      onSelect={onSelect}
    />,
  );
  const images = [...document.querySelectorAll('.wk-sighting-thumb img')].map(img => img.getAttribute('src'));
  expect(images).toHaveLength(2);
  for (const src of images) expect(src).toMatch(/^\/api\/workshop\/items\/[ab]\/thumbnail\?.*mode=object/);
  fireEvent.click(screen.getAllByRole('button')[1]);
  expect(onSelect).toHaveBeenCalledWith('b');
});

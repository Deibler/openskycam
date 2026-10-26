import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ImageInspector } from '../ui/features/workshop/components/image-inspector';
import { ReviewFrame } from '../ui/features/workshop/components/review-frame';
import { objectView } from '../ui/features/workshop/utils/reviewGeometryInferenceUtil';
import { Outlines, Trajectories } from '../ui/features/workshop/components/review-stage';
import { motionCaption, tracksOf } from '../ui/features/workshop/utils/sightingInferenceUtil';
import type { WorkshopItem, WorkshopTrack } from '../src/models/workshopInferencemodel';

const item: WorkshopItem = {
  id: 'one',
  bucket_id: 'output',
  asset_id: 'a',
  run_id: 'run',
  job_id: 'job',
  source_sha256: 'b',
  cam: 'sky01',
  captured_at: '2026-09-24T14:00:00Z',
  object_key: 'workshop/image',
  sha256: 'c',
  expires_at: '2026-10-24T14:00:00Z',
  review: 'pending',
  created_at: '2026-09-24T14:00:00Z',
  annotation_json: JSON.stringify([
    { class_id: 0, class_name: 'Bird', confidence: 0.35, box: [0.998, 0.001, 0.999, 0.002], model_node: 'model' },
  ]),
  provenance_json: JSON.stringify({ width: 3840, height: 2160 }),
};
afterEach(cleanup);
it('keeps text outside the image, with selection separate from inspection', () => {
  let opened = false,
    selected = false;
  render(
    <ReviewFrame
      item={item}
      selected={false}
      onSelect={v => {
        selected = v;
      }}
      onInspect={() => {
        opened = true;
      }}
    />,
  );
  const preview = screen.getByRole('button', { name: /Inspect frame at/ });
  expect(within(preview).queryByText('Bird')).toBeNull();
  expect(within(preview).queryByText('35%')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox'));
  expect(selected).toBe(true);
  expect(opened).toBe(false);
  fireEvent.click(preview);
  expect(opened).toBe(true);
});
it('focuses a tiny edge object without cropping outside the image or changing its real bounds', () => {
  const box = [0.998, 0.001, 0.999, 0.002],
    view = objectView(3840, 2160, box);
  expect(view.width).toBe(120);
  expect(view.height).toBe(67.5);
  expect(view.x + view.width).toBe(3840);
  expect(view.y).toBe(0);
  render(<ImageInspector item={item} onClose={() => {}} />);
  expect(screen.getByRole('img', { name: 'Magnified Bird prediction' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Full frame' }));
  expect(screen.getByRole('img', { name: 'Full camera frame' }).getAttribute('viewBox')).toBe('0 0 3840 2160');
  fireEvent.click(screen.getByRole('button', { name: 'Hide outlines' }));
  expect(screen.getByRole('img').querySelector('rect')).toBeNull();
});

it('shows where a tracked object went and how it moved, and nothing for photos from before tracking', () => {
  const plane: WorkshopTrack = {
    id: 'job:1',
    motion: 'moving',
    speed: 0.0125,
    start: 3,
    end: 17,
    detections: 3,
    path: [
      [3, 0.2, 0.3, 0.01, 0.02, 0, 0.8],
      [10, 0.25, 0.3, 0.01, 0.02, 0, 0.9],
      [17, 0.3, 0.3, 0.01, 0.02, 0, 0.8],
    ],
  };
  const star: WorkshopTrack = { ...plane, id: 'job:2', motion: 'stationary', speed: 0.0001, start: 0, end: 59, clipped: ['start', 'end'] };
  const meteor: WorkshopTrack = {
    ...plane,
    id: 'job:3',
    motion: 'brief',
    speed: null,
    start: 21,
    end: 21,
    detections: 1,
    path: [[21, 0.6, 0.2, 0.05, 0.01, 2, 0.6]],
    scan: { fps: 8, searched: 6, seen: 3, speed: 0.31, first: 20.875, last: 21.125, samples: [[20.875, 0.58, 0.2, 40], [21, 0.6, 0.2, 55], [21.125, 0.62, 0.2, 30], [21.25, null, null, 0]] },
  };
  expect(motionCaption(plane, 2160)).toBe('Moving · 27 px/s · 14 s');
  expect(motionCaption(star, 2160)).toBe('Still · 59 s+');
  expect(motionCaption(meteor, 2160)).toBe('Brief · 670 px/s · 3 frames');
  const tracked = { ...item, provenance_json: JSON.stringify({ width: 3840, height: 2160, tracks: [plane, star, meteor] }) };
  const tracks = tracksOf(tracked);
  expect([...tracks.keys()]).toEqual(['job:1', 'job:2', 'job:3']);
  expect(tracksOf(item).size).toBe(0);
  const labels = [
    { class_id: 0, class_name: 'Plane', confidence: 0.9, box: [0.24, 0.29, 0.26, 0.31], model_node: 'm', track_id: 'job:1' },
    { class_id: 0, class_name: 'Plane', confidence: 0.5, box: [0.5, 0.5, 0.51, 0.51], model_node: 'm', track_id: 'job:2' },
    { class_id: 2, class_name: 'Meteorite', confidence: 0.6, box: [0.57, 0.19, 0.63, 0.21], model_node: 'm', track_id: 'job:3' },
  ];
  const frame = { width: 3840, height: 2160 },
    camera = { x: 0, y: 0, scale: 0.25 };
  const { container } = render(
    <div>
      <Trajectories labels={labels} tracks={tracks} frame={frame} camera={camera} />
      <Outlines labels={labels} frame={frame} camera={camera} tracks={tracks} />
    </div>,
  );
  expect(screen.getByText('Moving · 27 px/s · 14 s')).toBeTruthy();
  expect(screen.getByText('Still · 59 s+')).toBeTruthy();
  // The plane's path and the meteor's frames are drawn; a fixed light has no path worth drawing.
  expect(container.querySelectorAll('polyline')).toHaveLength(1);
  expect(container.querySelector('polyline')!.getAttribute('points')).toBe('192,162 240,162 288,162');
  expect(container.querySelectorAll('circle')).toHaveLength(3);
  cleanup();
  const { container: before } = render(
    <Trajectories labels={JSON.parse(item.annotation_json)} tracks={tracksOf(item)} frame={frame} camera={camera} />,
  );
  expect(before.querySelector('svg')).toBeNull();
});

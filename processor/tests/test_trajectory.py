"""Tracks across a recording: linking, motion verdicts, routing on motion, and full-rate measurement."""
import sys
import unittest
from fractions import Fraction
from types import SimpleNamespace
from unittest.mock import patch
# Imported before any test swaps sys.modules, so restoring it never unloads them mid-run.
import cv2  # noqa: F401
import numpy as np
from skyvision_processor.service import trajectoryInferenceService as tr
from skyvision_processor.service.workshopConditionInferenceService import match_rule

ASPECT = 16 / 9


def box(x, y, size=0.017, name='Plane', confidence=0.8):
    # x, y: centre in frame fractions; size: side in frame heights
    w = size / ASPECT
    return {'class_id': 0 if name == 'Plane' else 2, 'class_name': name, 'confidence': confidence, 'model_node': 'detect',
            'box': [x - w / 2, y - size / 2, x + w / 2, y + size / 2]}


def star(t):
    # A fixed light with a box centre that scatters by a pixel or two, as detections do.
    return box(0.5 + 0.0004 * ((t * 7) % 3 - 1), 0.4 + 0.0004 * ((t * 5) % 3 - 1))


def plane(t, x0=0.2, y0=0.42, vx=0.012, vy=0.0):
    # vx, vy in frame heights per second
    return box(x0 + vx * t / ASPECT, y0 + vy * t)


class Linking(unittest.TestCase):
    def test_a_plane_passing_a_star_keeps_its_own_track_through_missed_frames(self):
        frames = []
        for t in range(40):
            seen = [star(t)]
            if t not in (17, 18):  # the plane is missed for two samples right beside the star
                seen.append(plane(t))
            frames.append((float(t), seen))
        records = tr.describe(frames, ASPECT, 'job:')
        self.assertEqual(sorted(r['motion'] for r in records.values()), ['moving', 'stationary'])
        moving = next(r for r in records.values() if r['motion'] == 'moving')
        self.assertEqual(moving['detections'], 38)
        self.assertAlmostEqual(moving['speed'], 0.012, delta=0.0005)
        # Every detection names its own track.
        ids = {r['motion']: r['id'] for r in records.values()}
        self.assertTrue(all(a['track_id'] == ids['stationary'] for _, seen in frames for a in seen[:1]))
        self.assertTrue(all(a['track_id'] == ids['moving'] for _, seen in frames for a in seen[1:]))

    def test_crossing_planes_are_not_swapped(self):
        frames = [(float(t), [plane(t, 0.2, 0.30, 0.01, 0.004), plane(t, 0.2, 0.46, 0.01, -0.004)]) for t in range(40)]
        records = tr.describe(frames, ASPECT, 'job:')
        self.assertEqual(len(records), 2)
        for r in records.values():
            ys = [p[2] for p in r['path']]
            # Each track keeps one heading through the crossing at t = 20.
            self.assertTrue(ys == sorted(ys) or ys == sorted(ys, reverse=True), ys)

    def test_uneven_sample_times_still_measure_the_speed(self):
        times = [0.12, 1.9, 2.05, 3.7, 4.4, 5.95, 6.1, 7.8, 8.3, 9.9]
        records = tr.describe([(t, [plane(t)]) for t in times], ASPECT, 'job:')
        (record,) = records.values()
        self.assertEqual((record['motion'], record['detections']), ('moving', 10))
        self.assertAlmostEqual(record['speed'], 0.012, delta=0.0005)

    def test_too_little_evidence_is_brief_not_a_guess(self):
        one = tr.describe([(0.0, [star(0)])], ASPECT, 'a:')
        two_stars = tr.describe([(0.0, [star(0)]), (1.0, [star(1)])], ASPECT, 'b:')
        two_planes = tr.describe([(0.0, [plane(0)]), (1.0, [plane(1)])], ASPECT, 'c:')
        self.assertEqual([r['motion'] for r in one.values()], ['brief'])
        self.assertIsNone(next(iter(one.values()))['speed'])
        # Two detections a second apart cannot rule out a slow plane, but they do show a typical one moving.
        self.assertEqual([r['motion'] for r in two_stars.values()], ['brief'])
        self.assertEqual([r['motion'] for r in two_planes.values()], ['moving'])

    def test_a_long_gap_starts_a_new_track(self):
        frames = [(float(t), [star(t)]) for t in (0, 1, 2, 9, 10, 11)]
        self.assertEqual(len(tr.describe(frames, ASPECT, 'job:')), 2)

    def test_records_mark_tracks_that_may_run_past_the_window(self):
        frames = [(float(t), [star(t)] + ([plane(t)] if 10 <= t <= 20 else [])) for t in range(30)]
        records = {r['motion']: r for r in tr.describe(frames, ASPECT, 'job:').values()}
        self.assertEqual(records['stationary']['clipped'], ['start', 'end'])
        self.assertNotIn('clipped', records['moving'])
        self.assertEqual(records['moving']['path'][0][:3], [10.0, round(0.2 + 0.012 * 10 / ASPECT, 5), 0.42])


class MotionRule(unittest.TestCase):
    tracks = {'j:1': {'motion': 'stationary'}, 'j:2': {'motion': 'moving'}}

    def test_motion_matches_the_selected_class_and_unknown_tracks_are_brief(self):
        labels = [{'class_name': 'Plane', 'confidence': .9, 'track_id': 'j:1'},
                  {'class_name': 'Meteorite', 'confidence': .9, 'track_id': 'j:2'},
                  {'class_name': 'Plane', 'confidence': .9}]
        rule = lambda operator, name='Plane': {'kind': 'motion', 'className': name, 'operator': operator}
        self.assertTrue(match_rule(rule('stationary'), '2026-10-25T05:00:00Z', labels, self.tracks))
        self.assertFalse(match_rule(rule('moving'), '2026-10-25T05:00:00Z', labels, self.tracks))
        self.assertTrue(match_rule(rule('brief'), '2026-10-25T05:00:00Z', labels, self.tracks))
        self.assertTrue(match_rule(rule('moving', ''), '2026-10-25T05:00:00Z', labels, self.tracks))
        self.assertFalse(match_rule(rule('moving'), '2026-10-25T05:00:00Z', labels[:1], None))

    def test_an_unknown_rule_fails_instead_of_counting(self):
        with self.assertRaises(ValueError):
            match_rule({'kind': 'speed', 'className': '', 'operator': 'at-least'}, '2026-10-25T05:00:00Z', [])


class Routing(unittest.TestCase):
    def test_stationary_lights_route_apart_and_saved_frames_carry_their_tracks(self):
        from skyvision_processor.service import workshopInferenceService as w
        cv2 = SimpleNamespace(IMWRITE_JPEG_QUALITY=1, imencode=lambda ext, image, params: (True, SimpleNamespace(tobytes=lambda: b'jpeg')))
        torch = SimpleNamespace(set_num_threads=lambda n: None, cuda=SimpleNamespace(is_available=lambda: False), backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: False)))
        nodes = [{'id': 'input', 'data': {'kind': 'input'}}, {'id': 'frame', 'data': {'kind': 'footage'}},
                 {'id': 'detect', 'data': {'kind': 'model'}},
                 # Keep a frame while any plane in it moves or was seen too briefly to tell; only fixed lights go apart.
                 {'id': 'still', 'data': {'kind': 'condition', 'match': 'any', 'rules': [{'kind': 'motion', 'className': 'Plane', 'operator': 'moving'},
                                                                                     {'kind': 'motion', 'className': 'Plane', 'operator': 'brief'}]}},
                 {'id': 'stars', 'data': {'kind': 'output', 'bucketId': 'stars'}}, {'id': 'planes', 'data': {'kind': 'output', 'bucketId': 'planes'}}]
        edges = [{'source': 'input', 'sourceHandle': 'out', 'target': 'frame'}, {'source': 'frame', 'sourceHandle': 'out', 'target': 'detect'},
                 {'source': 'detect', 'sourceHandle': 'out', 'target': 'still'}, {'source': 'still', 'sourceHandle': 'yes', 'target': 'planes'},
                 {'source': 'still', 'sourceHandle': 'no', 'target': 'stars'}]
        job = {'id': 'run_3', 'input': {'kind': 'video', 'recording': {'sha256': 'a' * 64, 'size': 1, 'start': '2026-10-25T05:00:00Z'}, 'item': None, 'from': 0., 'until': 20.},
               'snapshot': {'runtime': {'code_sha256': 'f'}, 'interval': 1, 'workflow': {'nodes': nodes, 'edges': edges},
                            'models': [{'node_id': 'detect', 'artifact_sha256': 'b' * 64, 'model': {'task': 'object-detection'}}]}}
        # A star all along; a plane for the first ten seconds.
        labels = {float(t): [star(t)] + ([plane(t)] if t < 10 else []) for t in range(20)}
        completed = {}
        with patch.dict(sys.modules, {'cv2': cv2, 'torch': torch}), patch.object(w.ops, 'claim', return_value=job), patch.object(w.ops, 'download'), \
             patch.object(w.ops, 'heartbeat'), patch.object(w.ops, 'progress'), patch.object(w.ops, 'upload', return_value='c' * 64), \
             patch.object(w.ops, 'complete', side_effect=lambda c, j, r: completed.update(r) or {'status': 'completed'}), \
             patch.object(w, 'load_model'), patch.object(w, 'predict_batch', side_effect=lambda model, binding, images, device: [labels[i.t] for i in images]), \
             patch.object(w, 'samples', return_value=iter([(SimpleNamespace(shape=(2160, 3840, 3), t=float(t)), t * 10, [1, 10], float(t)) for t in range(20)])):
            w.run_workshop(None, 'runtime', 'f')
        buckets = [f['bucket_id'] for f in completed['frames']]
        self.assertEqual(buckets, ['planes'] * 10 + ['stars'] * 10)
        first = completed['frames'][0]
        self.assertEqual({a['track_id'] for a in first['annotations']}, {t['id'] for t in first['tracks']})
        self.assertEqual(sorted(t['motion'] for t in first['tracks']), ['moving', 'stationary'])
        self.assertTrue(all(t['id'].startswith('run_3:') for t in first['tracks']))
        # A first-frame run decodes once: no full-rate scan is attached.
        self.assertTrue(all('scan' not in t for f in completed['frames'] for t in f['tracks']))


    def test_two_detection_models_never_share_a_track_id(self):
        from skyvision_processor.service import workshopInferenceService as w
        cv2 = SimpleNamespace(IMWRITE_JPEG_QUALITY=1, imencode=lambda ext, image, params: (True, SimpleNamespace(tobytes=lambda: b'jpeg')))
        torch = SimpleNamespace(set_num_threads=lambda n: None, cuda=SimpleNamespace(is_available=lambda: False), backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: False)))
        # Frames with a moving plane stop after the first model; the rest go on to a second model.
        nodes = [{'id': 'input', 'data': {'kind': 'input'}}, {'id': 'frame', 'data': {'kind': 'footage'}},
                 {'id': 'detect', 'data': {'kind': 'model'}}, {'id': 'birds', 'data': {'kind': 'model'}},
                 {'id': 'moving', 'data': {'kind': 'condition', 'match': 'any', 'rules': [{'kind': 'motion', 'className': 'Plane', 'operator': 'moving'}]}},
                 {'id': 'planes', 'data': {'kind': 'output', 'bucketId': 'planes'}}, {'id': 'rest', 'data': {'kind': 'output', 'bucketId': 'rest'}}]
        edges = [{'source': 'input', 'sourceHandle': 'out', 'target': 'frame'}, {'source': 'frame', 'sourceHandle': 'out', 'target': 'detect'},
                 {'source': 'detect', 'sourceHandle': 'out', 'target': 'moving'}, {'source': 'moving', 'sourceHandle': 'yes', 'target': 'planes'},
                 {'source': 'moving', 'sourceHandle': 'no', 'target': 'birds'}, {'source': 'birds', 'sourceHandle': 'out', 'target': 'rest'}]
        model = lambda node: {'node_id': node, 'artifact_sha256': 'b' * 64, 'model': {'task': 'object-detection'}}
        job = {'id': 'run_4', 'input': {'kind': 'video', 'recording': {'sha256': 'a' * 64, 'size': 1, 'start': '2026-10-25T05:00:00Z'}, 'item': None, 'from': 0., 'until': 20.},
               'snapshot': {'runtime': {'code_sha256': 'f'}, 'interval': 1, 'workflow': {'nodes': nodes, 'edges': edges},
                            'models': [model('detect'), model('birds')]}}
        labels = {'detect': lambda t: [plane(t)] if t < 10 else [], 'birds': lambda t: [box(0.7, 0.3 - 0.01 * t, name='Bird')]}
        completed = {}
        with patch.dict(sys.modules, {'cv2': cv2, 'torch': torch}), patch.object(w.ops, 'claim', return_value=job), patch.object(w.ops, 'download'), \
             patch.object(w.ops, 'heartbeat'), patch.object(w.ops, 'progress'), patch.object(w.ops, 'upload', return_value='c' * 64), \
             patch.object(w.ops, 'complete', side_effect=lambda c, j, r: completed.update(r) or {'status': 'completed'}), \
             patch.object(w, 'load_model'), patch.object(w, 'predict_batch', side_effect=lambda m, binding, images, device: [labels[binding['node_id']](i.t) for i in images]), \
             patch.object(w, 'samples', return_value=iter([(SimpleNamespace(shape=(2160, 3840, 3), t=float(t)), t * 10, [1, 10], float(t)) for t in range(20)])):
            w.run_workshop(None, 'runtime', 'f')
        ids = {bucket: {t['id'] for f in completed['frames'] if f['bucket_id'] == bucket for t in f['tracks']} for bucket in ('planes', 'rest')}
        self.assertTrue(ids['planes'] and ids['rest'])
        self.assertEqual(ids['planes'] & ids['rest'], set())


class ScannedRuns(unittest.TestCase):
    def test_a_scanned_run_follows_saved_tracks_without_the_recurring_light(self):
        from skyvision_processor.service import workshopInferenceService as w
        cv2 = SimpleNamespace(IMWRITE_JPEG_QUALITY=1, imencode=lambda ext, image, params: (True, SimpleNamespace(tobytes=lambda: b'jpeg')))
        torch = SimpleNamespace(set_num_threads=lambda n: None, cuda=SimpleNamespace(is_available=lambda: False), backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: False)))
        nodes = [{'id': 'input', 'data': {'kind': 'input'}}, {'id': 'frame', 'data': {'kind': 'footage'}},
                 {'id': 'detect', 'data': {'kind': 'model'}}, {'id': 'planes', 'data': {'kind': 'output', 'bucketId': 'planes'}}]
        edges = [{'source': 'input', 'sourceHandle': 'out', 'target': 'frame'}, {'source': 'frame', 'sourceHandle': 'out', 'target': 'detect'},
                 {'source': 'detect', 'sourceHandle': 'out', 'target': 'planes'}]
        job = {'id': 'run_4', 'input': {'kind': 'video', 'recording': {'sha256': 'a' * 64, 'size': 1, 'start': '2026-10-25T05:00:00Z'}, 'item': None, 'from': 0., 'until': 10.},
               'snapshot': {'runtime': {'code_sha256': 'f'}, 'interval': 1, 'pick': 'change', 'workflow': {'nodes': nodes, 'edges': edges},
                            'models': [{'node_id': 'detect', 'artifact_sha256': 'b' * 64, 'model': {'task': 'object-detection'}}]}}
        mask = object()

        def scanned(path, source, interval, pick, state):
            self.assertEqual(pick, 'change')
            yield from ((SimpleNamespace(shape=(2160, 3840, 3), t=float(t)), t * 10, [1, 10], float(t)) for t in range(10))
            state['recurring'] = mask  # the scan reports the mask once every slot is out
        followed, completed = [], {}

        def follow(path, plans, start, until, check, recurring):
            followed.append(recurring)
            return 8.0, {i: [(5.0, 0.3, 0.42, 40.0)] for i in plans}
        with patch.dict(sys.modules, {'cv2': cv2, 'torch': torch}), patch.object(w.ops, 'claim', return_value=job), patch.object(w.ops, 'download'), \
             patch.object(w.ops, 'heartbeat'), patch.object(w.ops, 'progress'), patch.object(w.ops, 'upload', return_value='c' * 64), \
             patch.object(w.ops, 'complete', side_effect=lambda c, j, r: completed.update(r) or {'status': 'completed'}), \
             patch.object(w, 'load_model'), patch.object(w, 'predict_batch', side_effect=lambda model, binding, images, device: [[plane(i.t)] for i in images]), \
             patch.object(w, 'samples', side_effect=scanned), patch.object(w.trajectories, 'follow', side_effect=follow):
            w.run_workshop(None, 'runtime', 'f')
        self.assertEqual(followed, [mask])
        scan = completed['frames'][5]['tracks'][0]['scan']
        self.assertEqual((scan['searched'], scan['seen'], scan['samples']), (1, 1, [[5.0, 0.3, 0.42, 40.0]]))


def clip(frames, fps=8):
    """A stand-in PyAV module whose one video yields the given grey frames (numpy arrays) at fps."""
    class Frame:
        def __init__(self, i, grey):
            self.pts, self.time_base, self.grey = i, Fraction(1, fps), grey

        def to_ndarray(self, format):
            return self.grey if format == 'gray' else np.repeat(self.grey[:, :, None], 3, axis=2)

    class Container:
        streams = SimpleNamespace(video=[SimpleNamespace(start_time=0, time_base=Fraction(1, fps), average_rate=Fraction(fps), thread_type=None)])
        def __enter__(self): return self
        def __exit__(self, *_): pass
        def seek(self, *_, **__): pass
        def decode(self, _):
            return (Frame(i, grey) for i, grey in enumerate(frames))
    return SimpleNamespace(open=lambda _: Container())


def sky(n, height=216, width=384, seed=1):
    rng = np.random.default_rng(seed)
    frames = [np.clip(20 + rng.normal(0, 2, (height, width)), 0, 255).astype(np.uint8) for _ in range(n)]
    for f in frames:
        f[50:53, 300:303] = 200  # a star in every frame
    return frames


class Scanning(unittest.TestCase):
    def test_each_slot_keeps_the_frame_with_new_light(self):
        from skyvision_processor.service.workshopInferenceService import samples
        frames = sky(40)
        frames[13][100:102, 40:80] = 160  # a streak in one frame of slot 1 (frames 8-15 at 8 fps)
        with patch.dict(sys.modules, {'av': clip(frames)}):
            chosen = list(samples('unused', {'kind': 'video', 'from': 0., 'until': 5.}, 1, 'change'))
        self.assertEqual(len(chosen), 5)
        self.assertEqual(chosen[1][3], 13 / 8)
        self.assertEqual(chosen[1][1], 13)
        # Each choice stays inside its own slot, so the server's schedule check holds.
        self.assertEqual([int(c[3]) for c in chosen], [0, 1, 2, 3, 4])
        with patch.dict(sys.modules, {'av': clip(frames)}):
            first = list(samples('unused', {'kind': 'video', 'from': 0., 'until': 5.}, 1, 'first'))
        self.assertEqual(first[1][3], 1.0)

    def test_a_burned_in_clock_does_not_outshine_a_fainter_meteor(self):
        from skyvision_processor.service.workshopInferenceService import samples
        frames = sky(10 * 8, height=216, width=384)
        for i, frame in enumerate(frames):
            # Clock digits in the corner: the units digit changes every second (frames 0, 8, 16, ...), and the tens
            # digit beside it only at second 9, too rarely to repeat on its own.
            second = i // 8
            frame[8:16, 360:364] = 230 if second % 2 else 20
            frame[8:16, 366:370] = 20 if second % 2 else 230
            frame[8:16, 350:356] = 230 if second >= 9 else 20
        frames[9 * 8 + 3][150:152, 60:80] = 90  # a fainter meteor in the same second the tens digit changes
        with patch.dict(sys.modules, {'av': clip(frames)}):
            chosen = list(samples('unused', {'kind': 'video', 'from': 0., 'until': 10.}, 1, 'change'))
        self.assertEqual(chosen[9][1], 9 * 8 + 3)

    def test_a_gap_leaves_its_slot_empty_and_a_short_clip_fails(self):
        from skyvision_processor.service.workshopInferenceService import scan
        frames = sky(40)
        gap = clip(frames)
        decode = gap.open(None).decode
        missing = set(range(8, 16))  # the recorder dropped second 1 entirely
        container = SimpleNamespace(**{k: getattr(gap.open(None), k) for k in ('streams', 'seek')},
                                    decode=lambda s: (f for f in decode(s) if f.pts not in missing),
                                    __enter__=None)
        class Wrapped:
            streams, seek = container.streams, container.seek
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def decode(self, s): return container.decode(s)
        with patch.dict(sys.modules, {'av': SimpleNamespace(open=lambda _: Wrapped())}):
            chosen = list(scan('unused', {'kind': 'video', 'from': 0., 'until': 5.}, 1))
        self.assertIsNone(chosen[1])
        self.assertEqual(len(chosen), 5)
        with patch.dict(sys.modules, {'av': clip(frames[:20])}), self.assertRaises(ValueError):
            list(scan('unused', {'kind': 'video', 'from': 0., 'until': 5.}, 1))


class FullRate(unittest.TestCase):
    def test_follow_measures_a_mover_and_a_meteor_but_not_its_background(self):
        frames = sky(48)
        height, width = frames[0].shape
        truth = {}
        for i in range(48):  # a plane light: 3 px, 8 px per frame left to right, steady
            x, y = 30 + 3 * i, 120
            frames[i][y - 1:y + 2, x - 1:x + 2] = 120
            truth[i] = ((x + .5) / width, (y + .5) / height)
        for i, x in ((20, 200), (21, 240), (22, 280)):  # a meteor for three frames
            frames[i][60:62, x - 10:x + 10] = 150
        records = {
            'p': {'motion': 'moving', 'speed': 3 * 8 / height, 'path': [[t / 8, *truth[t], 3 / width, 3 / height, 0, .9] for t in (8, 16, 24, 32, 40)]},
            'm': {'motion': 'brief', 'speed': None, 'path': [[21 / 8, 240.5 / width, 61 / height, 20 / width, 4 / height, 2, .7]]},
            's': {'motion': 'stationary', 'speed': 0.0, 'path': [[t / 8, 301.5 / width, 51.5 / height, 3 / width, 3 / height, 0, .9] for t in (8, 16)]},
        }
        plans = tr.plans_for(records, width / height)
        self.assertEqual(sorted(plans), ['m', 'p'])
        with patch.dict(sys.modules, {'av': clip(frames)}):
            fps, found = tr.follow('unused', plans, 0., 6.)
        self.assertAlmostEqual(fps, 8.0)
        seen = [s for s in found['p'] if s[1] is not None]
        self.assertGreater(len(seen), 0.9 * len(found['p']))
        errors = [abs(s[1] - truth[round(s[0] * 8)][0]) * width for s in seen]
        self.assertLess(max(errors), 1.0)
        meteor = [round(s[0] * 8) for s in found['m'] if s[1] is not None]
        self.assertEqual(meteor, [20, 21, 22])
        summary = tr.summarize(found['m'], fps, width / height)
        self.assertEqual((summary['seen'], summary['first'], summary['last']), (3, 2.5, 2.75))
        # 40 px per frame at 8 fps across a 216 px frame height
        self.assertAlmostEqual(summary['speed'], 40 * 8 / height, delta=0.05)
        near = tr.window(found['p'], 3.0)
        self.assertTrue(all(abs(s[0] - 3.0) <= tr.WINDOW for s in near) and len(near) >= 30)

    def test_follow_ignores_the_light_the_scan_found_recurring(self):
        from skyvision_processor.service.workshopInferenceService import scan
        frames = sky(10 * 8)
        for i, frame in enumerate(frames):  # clock digits flipping every second in the corner
            frame[8:16, 360:364] = 230 if (i // 8) % 2 else 20
            frame[8:16, 366:370] = 20 if (i // 8) % 2 else 230
        state = {}
        with patch.dict(sys.modules, {'av': clip(frames)}):
            list(scan('unused', {'kind': 'video', 'from': 0., 'until': 10.}, 1, state))
        self.assertTrue(state['recurring'][2:4, 90:92].all())  # the clock, at quarter size
        self.assertFalse(state['recurring'][40:, :60].any())   # open sky
        # A box just under the clock with nothing in it, as a trial run found: nothing to follow there.
        record = {'b': {'motion': 'brief', 'speed': None, 'path': [[6.0, 365 / 384, 24 / 216, 6 / 384, 6 / 216, 0, .3]]}}
        plans = tr.plans_for(record, 384 / 216)
        with patch.dict(sys.modules, {'av': clip(frames)}):
            _, found = tr.follow('unused', plans, 3., 9., recurring=state['recurring'])
        self.assertEqual([s for s in found['b'] if s[1] is not None], [])


if __name__ == '__main__':
    unittest.main()

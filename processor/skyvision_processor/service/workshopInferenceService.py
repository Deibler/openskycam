"""Execute one immutable, bounded Workshop job, tracking each model's boxes across the recording."""
import hashlib
import math
import os
import queue
import sys
import threading
import time
from collections import deque
from pathlib import Path
from datetime import datetime, timedelta, timezone
from ..db import WorkshopInferenceOps as ops
from ..utils import deviceInferenceUtil as devices
from ..utils.provenanceInferenceUtil import code_hash
from ..models.workshopInferencemodel import WorkshopFrame, WorkshopJob
from . import trajectoryInferenceService as trajectories
from .workshopConditionInferenceService import match_condition


class WorkshopHeartbeat:
    """Keep a single job lease alive and stop work after cancellation or lease loss."""
    def __init__(self, client, job: WorkshopJob):
        self.client, self.job = client, job
        self.stopped = threading.Event(); self.error = None
        self.thread = threading.Thread(target=self._renew, daemon=True)

    def _renew(self):
        while not self.stopped.wait(45):
            try:
                ops.heartbeat(self.client, self.job)
            except Exception as error:
                self.error = error; return

    def check(self):
        if self.error:
            raise ValueError('Workshop lease lost') from self.error

    def __enter__(self):
        self.thread.start(); return self

    def __exit__(self, *_):
        self.stopped.set(); self.thread.join(timeout=50)


BATCH = 2  # images per model call: the 1920 model ran 55 ms a frame at batches of 2, 4 and 8, and 8 held 1 GB more GPU memory
# ponytail: recordings in flight at once. Decode and server calls overlap; _gpu serializes the model.
# Raise it while the GPU has idle gaps; lower it if the camera recorder starts dropping frames.
WORKERS = 3
# ponytail: seconds a sample may trail its tick to decode one keyframe instead of a GOP. 0 gives exact ticks, slower.
KEYFRAME_SLACK = 1.5
SCAN_HISTORY = 8  # frames, about 1 s at 8 fps, that a scanned frame's new light is measured against
# New light that keeps coming back to the same pixels is the camera's burned-in clock or a fixed blinker, not an
# event. Each frame's hits (over REPEAT_LIGHT grey levels) add to a per-pixel count that halves in about 16 s;
# within REPEAT_REACH quarter-size pixels (80 px at 4K, a few characters of text) of a count at REPEAT_LIMIT, twice
# in a few seconds, nothing scores. On sky01 the clock otherwise won most seconds and hid meteors, and a tens digit
# that changes every 10 s would never repeat often enough on its own.
REPEAT_LIGHT, REPEAT_LIMIT, REPEAT_DECAY, REPEAT_REACH = 10, 1.5, 0.995, 20
_resident = {'sha': None, 'model': None}
_gpu = threading.Lock()  # one resident model, and Ultralytics predictors are not thread-safe
# ponytail: recordings whose decoded frames are in memory at once. A recording's 4K samples take about 1.5 GB, and
# three at once with the 1920 model (2.1 GB on the GPU) swapped a 16 GB Mac mini while other work ran. One keeps
# up with the night (about 15 s a recording); downloads still overlap. Raise it when memory allows.
_frames = threading.Semaphore(1)

def annotations_from(result, binding):
    if binding['model']['task'] == 'image-classification':
        class_id = int(result.probs.top1); score = float(result.probs.top1conf)
        return [{'class_id': class_id, 'class_name': result.names[class_id], 'confidence': score, 'model_node': binding['node_id']}] if score >= binding['confidence'] else []
    values = []
    for box in result.boxes:
        bounds = [max(0., min(1., float(v))) for v in box.xyxyn[0].tolist()]
        if bounds[0] >= bounds[2] or bounds[1] >= bounds[3]:
            continue
        class_id = int(box.cls)
        values.append({'class_id': class_id, 'class_name': result.names[class_id], 'confidence': float(box.conf), 'box': bounds, 'model_node': binding['node_id']})
    return values


def predict_batch(model, binding, images, device):
    # The saved frame stays full size. The detector only needs its own input size, and normalized boxes still match.
    import cv2
    imgsz = int(binding['imgsz'])
    sized = []
    for image in images:
        height, width = image.shape[:2]
        scale = imgsz / max(height, width)
        if scale >= 1:
            sized.append(image)
        else:
            sized.append(cv2.resize(image, (max(1, int(width * scale)), max(1, int(height * scale))), interpolation=cv2.INTER_AREA))
    results = model.predict(sized, imgsz=imgsz, conf=binding['confidence'], iou=0.5, device=device, half=device != 'cpu', verbose=False)
    return [annotations_from(result, binding) for result in results]


def weight_cache():
    caches = Path.home() / 'Library' / 'Caches' if sys.platform == 'darwin' else Path(os.environ.get('XDG_CACHE_HOME') or Path.home() / '.cache')
    path = caches / 'openskycam-workshop'
    path.mkdir(parents=True, exist_ok=True)
    return path


def release_model():
    _resident['sha'] = _resident['model'] = None


def load_model(client, job, binding, device):
    import torch
    from ultralytics import YOLO
    sha = binding['artifact_sha256']
    if _resident['sha'] == sha:
        return _resident['model']
    release_model()
    devices.empty_cache(torch)
    path = weight_cache() / (sha + '.pt')
    artifact = next(a for a in binding['model']['artifacts'] if a['sha256'] == sha)
    if not path.exists():
        partial = path.with_suffix('.partial')
        ops.download(client, job, '/models/' + sha, partial, sha, artifact['bytes'])
        partial.replace(path)
    model = YOLO(str(path))
    try: model.fuse()
    except Exception: pass
    if model.names != {c['id']: c['name'] for c in binding['model']['classes']}: raise ValueError('Checkpoint classes differ from registry')
    if model.task != {'object-detection': 'detect', 'image-classification': 'classify'}[binding['model']['task']]: raise ValueError('Checkpoint task differs from registry')
    _resident['sha'], _resident['model'] = sha, model
    return model


def execute_graph(snapshot, image, captured_at, models, device, initial, on_step=None):
    nodes = {n['id']: n['data'] for n in snapshot['workflow']['nodes']}
    outgoing = {(e['source'], e['sourceHandle']): e['target'] for e in snapshot['workflow']['edges']}
    node_id = next(k for k, v in nodes.items() if v['kind'] == 'input')
    annotations = initial
    final_model = None
    for _ in range(len(nodes) + 1):
        data = nodes[node_id]; kind = data['kind']; port = 'out'
        if on_step: on_step(node_id)
        if kind == 'output':
            return data['bucketId'], annotations, final_model
        if kind == 'nothing':
            return None, annotations, node_id
        if kind == 'model':
            final_model = node_id
            model, binding = models[node_id]
            annotations = predict_batch(model, binding, [image], device)[0]
        if kind == 'condition':
            port = 'yes' if match_condition(data, captured_at, annotations) else 'no'
        node_id = outgoing[(node_id, port)]
    raise ValueError('Invalid graph cycle')


def first_frame(container, stream, origin, target, backward):
    """First frame at or after target, decoding from the keyframe before (backward) or after it."""
    container.seek(int(origin + target / float(stream.time_base)), backward=backward, any_frame=False, stream=stream)
    for frame in container.decode(stream):
        if frame.pts is None: continue
        offset = float((frame.pts - origin) * frame.time_base)
        if offset + 1e-7 >= target: return frame, offset
    return None, None


def recurring_mask(repeats, np, cv2):
    """1 where new light has recurred, and within REPEAT_REACH of it; 0 elsewhere. Quarter size."""
    side = 2 * REPEAT_REACH + 1
    return cv2.dilate((repeats >= REPEAT_LIMIT).astype(np.uint8), np.ones((side, side), np.uint8))


def new_light(small, history, repeats, np, cv2):
    """Grey levels of the brightest light in a frame that none of the recent frames had, away from pixels where
    new light keeps recurring. Stars and slow planes cancel; a meteor or a strobe flash stands out. Frames are
    quarter-size grey; repeats is the per-pixel recurrence count, updated with this frame."""
    if not history:
        return 0.0
    reference = history[0]
    for other in list(history)[1:]:
        reference = np.maximum(reference, other)
    new = cv2.blur(cv2.subtract(small, reference), (3, 3))
    score = float(new[recurring_mask(repeats, np, cv2) == 0].max(initial=0))
    repeats *= REPEAT_DECAY
    repeats += new > REPEAT_LIGHT
    return score


def scan(path, source, interval, state=None):
    """Decode every frame and keep, for each slot, the one with the most new light. A meteor lasts a third of a
    second, so the first frame after each tick misses most of them. Same slots and empty-slot rules as samples().
    Once every slot is yielded, state['recurring'] holds the recording's recurring-light mask (see recurring_mask)."""
    import av
    import cv2
    import numpy as np
    expected = min(source.get('sample_limit', math.inf), math.ceil((source['until'] - source['from']) / interval))
    slot, best, history, repeats = 0, None, deque(maxlen=SCAN_HISTORY), None

    def chosen():
        if best is None: return None
        _, frame, offset = best
        return frame.to_ndarray(format='bgr24'), frame.pts, [frame.time_base.numerator, frame.time_base.denominator], offset
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        # Threaded HEVC decode deadlocks inside PyAV. One thread is slower and finishes.
        try: stream.thread_type = 'NONE'
        except Exception: pass
        origin = stream.start_time if stream.start_time is not None else 0
        # A second before the window gives its first frames something to compare with.
        container.seek(int(origin + max(0., source['from'] - 1) / float(stream.time_base)), backward=True, any_frame=False, stream=stream)
        for frame in container.decode(stream):
            if frame.pts is None: continue
            offset = float((frame.pts - origin) * frame.time_base)
            grey = frame.to_ndarray(format='gray')
            small = cv2.resize(grey, (grey.shape[1] // 4, grey.shape[0] // 4), interpolation=cv2.INTER_AREA)
            if repeats is None: repeats = np.zeros(small.shape, np.float32)
            score = new_light(small, history, repeats, np, cv2)
            history.append(small)
            if offset + 1e-7 < source['from']: continue
            index = math.floor((offset - source['from'] + .001) / interval)
            # A later frame proves the slots before it are finished; one without any frame stays empty (None).
            while slot < min(index, expected):
                yield chosen()
                slot += 1; best = None
            if slot >= expected: break
            if best is None or score > best[0]: best = (score, frame, offset)
        if best is not None and slot < expected:
            yield chosen(); slot += 1
    if state is not None and repeats is not None:
        state['recurring'] = recurring_mask(repeats, np, cv2)
    if slot != expected:
        raise ValueError('Source decode did not cover every scheduled sample')


def samples(path, source, interval, pick='first', state=None):
    import av
    if source['kind'] == 'image':
        import cv2
        image = cv2.imread(str(path))
        if image is None: raise ValueError('Image decode failed')
        import json
        provenance = json.loads(source['item']['provenance_json'])
        yield image, provenance['pts'], provenance['time_base'], 0.
        return
    if pick == 'change':
        yield from scan(path, source, interval, state)
        return
    target = source['from']; count = 0
    expected = min(source.get('sample_limit', math.inf), math.ceil((source['until'] - source['from']) / interval))
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        # Threaded HEVC decode deadlocks inside PyAV. One thread is slower and finishes.
        try: stream.thread_type = 'NONE'
        except Exception: pass
        origin = stream.start_time if stream.start_time is not None else 0
        while count < expected:
            # Decoding the next keyframe is one frame; landing exactly on the tick decodes up to a whole GOP.
            # The keyframe is kept only inside this sample's own slot, so the server's schedule check still holds.
            limit = min(target + min(KEYFRAME_SLACK, interval) - .002, source['until'])
            try: frame, offset = first_frame(container, stream, origin, target, False)
            except av.error.FFmpegError: frame = None  # no keyframe after the tick
            if frame is None or offset >= limit:
                frame, offset = first_frame(container, stream, origin, target, True)
                if frame is None or offset >= source['until'] + .05: break
            # The first frame after the tick lies past this slot only when the recorder skipped the whole slot
            # (the later frame proves it). The slot is then empty (None); reusing that frame would repeat it.
            if math.floor((offset - source['from'] + .001) / interval) != count: yield None
            else: yield frame.to_ndarray(format='bgr24'), frame.pts, [frame.time_base.numerator, frame.time_base.denominator], offset
            count += 1; target = source['from'] + count * interval
    if count != expected:
        raise ValueError('Source decode did not cover every scheduled sample')


def stage_recording(snapshot, sampled, predict_batch, on_labels=None):
    """Run one model at a time. Later models only see frames that reached them. on_labels(items) hears each
    model's labels for every frame that reached it, before any condition reads them."""
    nodes = {n['id']: n['data'] for n in snapshot['workflow']['nodes']}
    outgoing = {(e['source'], e['sourceHandle']): e['target'] for e in snapshot['workflow']['edges']}
    start = next(k for k, v in nodes.items() if v['kind'] == 'input')
    items = [{**sample, 'annotations': list(sample.get('annotations') or []), 'node': outgoing[(start, 'out')], 'index': i} for i, sample in enumerate(sampled)]

    def advance(group):
        waiting, done = [], []
        for item in group:
            for _ in range(len(nodes) + 1):
                data = nodes[item['node']]; kind = data['kind']
                if kind == 'model':
                    waiting.append(item); break
                if kind == 'output':
                    item['bucket'] = data['bucketId']; item['terminal'] = item.get('model_node'); done.append(item); break
                if kind == 'nothing':
                    item['bucket'] = None; item['terminal'] = item['node']; item['image'] = None; done.append(item); break
                port = 'yes' if kind == 'condition' and match_condition(data, item['captured'], item['annotations'], item.get('tracks')) else 'no' if kind == 'condition' else 'out'
                item['node'] = outgoing[(item['node'], port)]
            else:
                raise ValueError('Invalid graph cycle')
        return waiting, done

    waiting, done = advance(items)
    while waiting:
        node_id = waiting[0]['node']
        here = [item for item in waiting if item['node'] == node_id]
        rest = [item for item in waiting if item['node'] != node_id]
        annotations = []
        for offset in range(0, len(here), BATCH):
            annotations.extend(predict_batch(node_id, [item['image'] for item in here[offset:offset + BATCH]]))
        for item, annotation in zip(here, annotations):
            item['annotations'] = annotation
            item['model_node'] = node_id
            item['node'] = outgoing[(node_id, 'out')]
        if on_labels: on_labels(here)
        moved, finished = advance(here)
        done.extend(finished)
        waiting = rest + moved
    done.sort(key=lambda item: item['index'])
    return done


def run_workshop(client, runtime, fingerprint=None):
    fingerprint = fingerprint or code_hash()
    job = ops.claim(client, runtime, fingerprint)
    if job is None: return {'status': 'idle'}
    source = job['input']; snapshot = job['snapshot']
    if snapshot['runtime']['code_sha256'] != fingerprint: raise ValueError('Runtime fingerprint mismatch')
    heartbeat = WorkshopHeartbeat(client, job)
    directory = ops.temporary_attempt()
    heartbeat.__enter__()
    holding = False
    try:
        import cv2
        import json
        import torch
        torch.set_num_threads(4)
        device = devices.pick_device(torch)
        media = Path(directory.name) / ('input.mp4' if source['kind'] == 'video' else 'input.jpg')
        original = source['recording'] if source['kind'] == 'video' else source['item']
        ops.progress(client, job, {'phase': 'downloading', 'node_id': None, 'processed': 0})
        ops.download(client, job, '/input', media, original['sha256'], original.get('size'))
        ops.progress(client, job, {'phase': 'processing', 'node_id': None, 'processed': 0})
        _frames.acquire(); holding = True
        bindings = {binding['node_id']: binding for binding in snapshot['models']}
        initial = json.loads(original['annotation_json']) if source['kind'] == 'image' else []
        sampled_frames, empty = [], []
        scanned = {}
        for slot, sample in enumerate(samples(media, source, snapshot['interval'], snapshot.get('pick', 'first'), scanned)):
            heartbeat.check()
            if sample is None:
                empty.append(slot); continue
            image, pts, time_base, offset = sample
            captured = original.get('captured_at') or (datetime.fromisoformat(original['start'].replace('Z', '+00:00')) + timedelta(seconds=offset)).isoformat()
            sampled_frames.append({'image': image, 'pts': pts, 'time_base': time_base, 'offset': offset, 'captured': captured, 'annotations': initial, 'slot': slot})
        shown = set()
        def run_batch(node_id, images):
            heartbeat.check()
            binding = bindings[node_id]
            step = {'phase': 'processing', 'node_id': node_id, 'processed': 0}
            if node_id not in shown:
                ops.progress(client, job, step); shown.add(node_id)
            # ponytail: one resident model, so workers on different models of one pipeline swap it per batch.
            # Key _resident by artifact if multi-model pipelines show reload time.
            with _gpu:
                loading = _resident['sha'] != binding['artifact_sha256']
                if loading: ops.progress(client, job, {**step, 'phase': 'loading_model'})
                model = load_model(client, job, binding, device)
                if loading: ops.progress(client, job, step)
                return predict_batch(model, binding, images, device)
        pick = snapshot.get('pick', 'first')
        aspect = sampled_frames[0]['image'].shape[1] / sampled_frames[0]['image'].shape[0] if sampled_frames else 16 / 9
        numbered = [0]  # each model's pass continues the job's track numbers, so ids stay unique in the job
        def track(group):
            # One recording's frames; a photo job has a single frame and nothing to follow.
            if source['kind'] != 'video': return
            ordered = sorted(group, key=lambda item: item['offset'])
            records = trajectories.describe([(item['offset'], item['annotations']) for item in ordered], aspect, job['id'] + ':', numbered[0] + 1)
            numbered[0] += len(records)
            for item in group:
                item['tracks'] = {a['track_id']: records[a['track_id']] for a in item['annotations'] if 'track_id' in a}
        staged = stage_recording(snapshot, sampled_frames, run_batch, track)
        sampled_frames = None  # staged items hold the frames still needed; the rest go now
        kept = {i: r for item in staged if item['bucket'] is not None for i, r in item.get('tracks', {}).items()}
        scans = {}
        plans = trajectories.plans_for(kept, aspect) if pick == 'change' else {}
        if plans:
            # Every frame of a scanned recording was decoded once already; follow the saved tracks through them.
            times = [a[0] for plan in plans.values() for a in plan['anchors']]
            fps, measured = trajectories.follow(media, plans, min(times) - 2.5, max(times) + 2.5, heartbeat.check,
                                                scanned.get('recurring'))
            scans = {i: (trajectories.summarize(found, fps, aspect), found) for i, found in measured.items()}
        frames: list[WorkshopFrame] = []
        slots = len(staged) + len(empty)
        discarded, done = None, 0
        def skip_to(slot):
            # Slots since the last saved frame ended at a "nothing" step or held no frame at all.
            if slot > done: ops.progress(client, job, {'phase': 'processing', 'node_id': discarded, 'processed': slot, **({} if discarded else {'empty': True})})
        for item in staged:
            index = item['slot']
            if item['bucket'] is None:
                discarded = item['terminal']
                continue
            skip_to(index)
            discarded = None
            image = item['image']
            # A photo job has no model, so its frame has no labeling step.
            ops.progress(client, job, {'phase': 'uploading', 'node_id': item.get('model_node'), 'processed': index})
            if source['kind'] == 'image': digest = original['sha256']
            else:
                ok, encoded = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 92])
                if not ok: raise ValueError('JPEG encode failed')
                digest = ops.upload(client, job, encoded.tobytes())
            frames.append({'bucket_id': item['bucket'], 'model_node': item.get('model_node'), 'pts': item['pts'], 'time_base': item['time_base'], 'offset': item['offset'], 'width': image.shape[1], 'height': image.shape[0], 'sha256': digest, 'annotations': item['annotations']})
            if item.get('tracks'):
                frames[-1]['tracks'] = [{**record, **({'scan': {**scans[i][0], 'samples': trajectories.window(scans[i][1], item['offset'])}} if i in scans else {})}
                                        for i, record in sorted(item['tracks'].items())]
            ops.progress(client, job, {'phase': 'processing', 'node_id': item.get('model_node'), 'processed': index + 1, 'sequence': index, 'frame': frames[-1]})
            item['image'] = None; done = index + 1
        skip_to(slots)
        heartbeat.check()
        ops.progress(client, job, {'phase': 'finalizing', 'node_id': None, 'processed': slots})
        result = ops.complete(client, job, {'code_sha256': fingerprint, 'sampled_frames': len(staged), 'empty_slots': empty, 'frames': frames})
        return {'job_id': job['id'], **result}
    except Exception:
        try: ops.fail(client, job)
        except Exception: pass
        raise
    finally:
        if holding: _frames.release()
        heartbeat.__exit__(None, None, None)
        directory.cleanup()


def process_workshop(client, runtime, watch=False):
    """Keep WORKERS recordings in flight so one's download, decode and server calls overlap another's model pass."""
    fingerprint = code_hash()
    if not watch:
        yield run_workshop(client, runtime, fingerprint)
        return
    results = queue.Queue()

    def work(index):
        time.sleep(index * 5)  # stagger idle polling
        while True:
            try: result = run_workshop(client, runtime, fingerprint)
            except Exception: result = {'status': 'retrying', 'error': 'workshop_request_failed'}
            results.put(result)
            if result.get('status') == 'idle': time.sleep(5 * WORKERS)  # same claim rate as one runner polling every 5 s
            elif result.get('status') == 'retrying': time.sleep(10)

    for index in range(WORKERS):
        threading.Thread(target=work, args=(index,), daemon=True).start()
    while True:
        yield results.get()

"""Follow each object through one recording: link its detections into a track, tell movers from fixed lights,
and, when every frame was decoded, measure it in every frame. Positions are fractions of the frame (0-1). Distances
and speeds are in frame heights (x scaled by the aspect ratio), so they do not depend on the resolution."""
import bisect
import math
from collections import deque

# Calibrated on reviewed sky01 night data: confirmed planes have a median box of 0.017 frame heights (36 of 2160 px),
# and 3,921 plane steps between frames a median speed of 0.012 and a 99.9th percentile of 0.054 frame heights/s.
MAX_SPEED = 0.06   # how far an object whose speed is not yet known may move per second
MAX_GAP = 5.0      # seconds a track may go unseen: missed detections and blinking strobes
STILL = 0.002      # frame heights/s between a fixed light and a mover; a star drifts about 0.0001
JITTER = 0.05      # scatter of a box centre between frames, as a fraction of the box
WINDOW = 2.0       # full-rate samples kept with each frame: this many seconds either side
REACH = 8          # frames either side kept to see what is new in a frame: about 1 s at 8 fps
MIN_PEAK = 6.0     # grey levels of new light that count as the object being visible


def _median(values):
    ordered = sorted(values)
    middle = len(ordered) // 2
    return ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2


def _fit(points):
    """Mean time and position, least-squares velocity, and time spread of points (t, x, y, ...)."""
    n = len(points)
    tm = sum(p[0] for p in points) / n
    xm = sum(p[1] for p in points) / n
    ym = sum(p[2] for p in points) / n
    spread = sum((p[0] - tm) ** 2 for p in points)
    if spread < 1e-9:
        return tm, xm, ym, 0.0, 0.0, spread
    vx = sum((p[0] - tm) * (p[1] - xm) for p in points) / spread
    vy = sum((p[0] - tm) * (p[2] - ym) for p in points) / spread
    return tm, xm, ym, vx, vy, spread


def _expect(track, t):
    """Where a track should be at time t, and how far from there a detection may be and still be it."""
    recent = track[-6:]
    last, size, dt = recent[-1], _median([p[3] for p in recent]), t - recent[-1][0]
    if len(recent) == 1:
        return last[1], last[2], min(0.1, max(1.5 * size, 0.008) + MAX_SPEED * dt)
    tm, xm, ym, vx, vy, _ = _fit(recent)
    return xm + vx * (t - tm), ym + vy * (t - tm), max(size, 0.006) + (0.25 * math.hypot(vx, vy) + 0.003) * dt


def link(frames, aspect):
    """Tracks from (t, annotations) in time order: lists of (t, x, y, size, annotation), x and y in frame heights.
    Each frame's boxes go to the nearest live track that could have reached them, a same-class track first."""
    tracks = []
    for t, annotations in frames:
        found = []
        for a in annotations:
            if a.get('box'):
                x1, y1, x2, y2 = a['box']
                found.append((a, (x1 + x2) / 2 * aspect, (y1 + y2) / 2, max((x2 - x1) * aspect, y2 - y1)))
        live = [track for track in tracks if t - track[-1][0] <= MAX_GAP]
        pairs = []
        for i, track in enumerate(live):
            x, y, reach = _expect(track, t)
            for j, (a, fx, fy, _) in enumerate(found):
                distance = math.hypot(fx - x, fy - y)
                if distance <= reach:
                    pairs.append((distance / reach + (0.5 if a['class_name'] != track[-1][4]['class_name'] else 0.0), i, j))
        linked, taken = set(), set()
        for _, i, j in sorted(pairs):
            if i not in linked and j not in taken:
                linked.add(i); taken.add(j)
                a, fx, fy, size = found[j]
                live[i].append((t, fx, fy, size, a))
        tracks.extend([(t, fx, fy, size, a)] for j, (a, fx, fy, size) in enumerate(found) if j not in taken)
    return tracks


def motion(track):
    """('moving' | 'stationary' | 'brief', speed). Brief means too few or too close detections to tell, and
    the speed is None for a single detection. The verdict allows for each box centre's own scatter."""
    if len(track) < 2:
        return 'brief', None
    tm, xm, ym, vx, vy, spread = _fit(track)
    speed = math.hypot(vx, vy)
    if spread < 1e-9:
        return 'brief', speed
    residual = math.sqrt(sum((p[1] - xm - vx * (p[0] - tm)) ** 2 + (p[2] - ym - vy * (p[0] - tm)) ** 2
                             for p in track) / (2 * (len(track) - 2))) if len(track) > 2 else 0.0
    error = 2 * max(residual, JITTER * _median([p[3] for p in track]), 0.0003) / math.sqrt(spread)
    return ('stationary' if speed + error < STILL else 'moving' if speed - error > STILL else 'brief'), speed


def _centre(box):
    return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2, box[2] - box[0], box[3] - box[1]]


def describe(frames, aspect, prefix, first=1):
    """Link one model's boxes across a recording. Sets each box's track_id and returns {id: record}.
    frames: (t, annotations) in time order. A record's path lists every detection: t, x, y, width, height
    (fractions of the frame), class_id, confidence. Clipped edges mean the object may extend past the window.
    Track numbers start at `first`, so a job's later models continue its numbering."""
    times = [t for t, _ in frames]
    spacing = _median([b - a for a, b in zip(times, times[1:])]) if len(times) > 1 else 0.0
    records = {}
    for n, track in enumerate(sorted(link(frames, aspect), key=lambda tr: (tr[0][0], tr[0][1], tr[0][2])), first):
        kind, speed = motion(track)
        identifier = f'{prefix}{n}'
        clipped = [edge for edge, gap in (('start', track[0][0] - times[0]), ('end', times[-1] - track[-1][0]))
                   if gap <= 1.5 * spacing]
        records[identifier] = {
            'id': identifier, 'motion': kind, 'speed': None if speed is None else round(speed, 6),
            'start': round(track[0][0], 3), 'end': round(track[-1][0], 3), 'detections': len(track),
            **({'clipped': clipped} if clipped else {}),
            'path': [[round(p[0], 3), *(round(v, 5) for v in _centre(p[4]['box'])), p[4]['class_id'],
                      round(p[4]['confidence'], 4)] for p in track],
        }
        for p in track:
            p[4]['track_id'] = identifier
    return records


def _position(anchors, t):
    """Where a track's detections put it at time t: on the line between the two around t, or past either end at
    the velocity of the nearest few. Also the time to the nearest detection."""
    i = bisect.bisect_left([a[0] for a in anchors], t)
    if 0 < i < len(anchors):
        (ta, xa, ya), (tb, xb, yb) = anchors[i - 1], anchors[i]
        f = (t - ta) / (tb - ta) if tb > ta else 0.0
        return xa + f * (xb - xa), ya + f * (yb - ya), min(t - ta, tb - t)
    near = anchors[:4] if i == 0 else anchors[-4:]
    tm, xm, ym, vx, vy, _ = _fit(near)
    return xm + vx * (t - tm), ym + vy * (t - tm), min(abs(t - a[0]) for a in near)


def measure(image, references, x, y, radius, size, np, cv2):
    """The new light nearest (x, y) within radius (frame heights), as (x, y, peak) in frame fractions and grey
    levels above what the reference frames show there, or None when nothing stands out from the noise."""
    height, width = image.shape
    r = max(4, int(radius * height))
    cx, cy = x * width, y * height
    x0, x1, y0, y1 = max(0, int(cx) - r), min(width, int(cx) + r + 1), max(0, int(cy) - r), min(height, int(cy) + r + 1)
    if x1 - x0 < 3 or y1 - y0 < 3:
        return None

    def difference(left, right, top, bottom):
        background = references[0][top:bottom, left:right]
        for other in references[1:]:
            background = np.maximum(background, other[top:bottom, left:right])
        return cv2.blur((image[top:bottom, left:right].astype(np.int16) - background).astype(np.float32), (3, 3))
    diff = difference(x0, x1, y0, y1)
    level = float(np.median(diff))
    diff -= level
    noise = 1.4826 * float(np.median(np.abs(diff))) + 0.5
    yy, xx = np.ogrid[y0:y1, x0:x1]
    prior = np.exp(-((xx + .5 - cx) ** 2 + (yy + .5 - cy) ** 2) / (2 * (r / 2) ** 2))
    py, px = divmod(int(np.argmax(diff * prior)), x1 - x0)
    peak = float(diff[py, px])
    if peak < max(MIN_PEAK, 5 * noise):
        return None
    # Centre on the light itself, not where the search began: recentring a fresh window settles on a streak's
    # middle even when the search window cut the streak off.
    c = max(2, int(size * height / 2))
    mx, my = float(x0 + px), float(y0 + py)
    for _ in range(4):
        left, top = max(0, int(round(mx)) - c), max(0, int(round(my)) - c)
        patch = np.clip(difference(left, min(width, int(round(mx)) + c + 1), top, min(height, int(round(my)) + c + 1)) - level, 0, None)
        total = float(patch.sum())
        if total <= 0:
            break
        gy, gx = np.indices(patch.shape)
        mx, my = left + float((gx * patch).sum()) / total, top + float((gy * patch).sum()) / total
    return (mx + .5) / width, (my + .5) / height, peak


def _follow_mover(ring, c, plan, fps, np, cv2):
    t, image = ring[c]
    x, y, gap = _position(plan['anchors'], t)
    # References far enough back and ahead that the object has moved off its own pixels.
    step = plan['speed'] / fps
    offset = max(2, min(REACH, math.ceil(2 * plan['size'] / max(step, 1e-6))))
    references = [ring[i][1] for i in (c - offset, c + offset) if 0 <= i < len(ring)]
    if not references:
        return None
    radius = min(0.08, max(2 * plan['size'], 0.01) + 0.3 * plan['speed'] * gap)
    return measure(image, references, x, y, radius, plan['size'], np, cv2)


def _follow_brief(ring, c, plan, np, cv2):
    """Walk out from the detection frame both ways while the object stays visible: a meteor lasts a few frames."""
    others = [ring[i][1] for i in (0, len(ring) - 1) if i != c]
    found = {c: others and measure(ring[c][1], others, *plan['anchors'][0][1:], plan['radius'], plan['size'], np, cv2)}
    for direction in (1, -1):
        seen = [(ring[c][0], plan['anchors'][0][1], plan['anchors'][0][2])]
        if found[c]:
            seen = [(ring[c][0], found[c][0], found[c][1])]
        misses, i = 0, c + direction
        while 0 <= i < len(ring) and misses < 2:
            t = ring[i][0]
            if len(seen) > 1:
                tm, xm, ym, vx, vy, _ = _fit(seen)
                x, y = xm + vx * (t - tm), ym + vy * (t - tm)
            else:
                x, y = seen[-1][1], seen[-1][2]
            references = [ring[k][1] for k in (0, len(ring) - 1) if k != i]
            result = references and measure(ring[i][1], references, x, y, plan['radius'], plan['size'], np, cv2)
            found[i] = result
            if result:
                seen.append((t, result[0], result[1])); misses = 0
            else:
                misses += 1
            i += direction
    return sorted((ring[i][0], *(found[i] or (None, None, 0.0))) for i in found)


def follow(path, plans, start, until, check=lambda: None, recurring=None):
    """Measure planned tracks in every frame from start to until (seconds into the recording).
    plans: {id: {'motion', 'anchors': [(t, x, y)], 'size', 'speed'}}, positions in frame fractions.
    recurring: the scan's mask of light that keeps coming back (a burned-in clock); those pixels are blanked in
    every frame, so they never look new. Returns (fps, {id: [(t, x or None, y or None, peak)]})."""
    import av
    import cv2
    import numpy as np
    samples = {identifier: [] for identifier in plans}
    movers = {i: p for i, p in plans.items() if p['motion'] == 'moving'}
    brief = {i: p for i, p in plans.items() if p['motion'] == 'brief'}
    done = set()
    ring, decoded, first, last, keep = deque(), 0, None, None, None

    def visit(c):
        t = ring[c][0]
        for identifier, plan in movers.items():
            if plan['anchors'][0][0] - 1.0 <= t <= plan['anchors'][-1][0] + 1.0:
                result = _follow_mover(ring, c, plan, fps, np, cv2)
                samples[identifier].append((t, *(result or (None, None, 0.0))))
        for identifier, plan in brief.items():
            if identifier not in done and t >= plan['anchors'][0][0] - 1e-3:
                done.add(identifier)
                samples[identifier] = _follow_brief(ring, c, plan, np, cv2)

    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        # Threaded HEVC decode deadlocks inside PyAV. One thread is slower and finishes.
        try: stream.thread_type = 'NONE'
        except Exception: pass
        origin = stream.start_time if stream.start_time is not None else 0
        fps = float(stream.average_rate) if stream.average_rate else 8.0
        container.seek(int(origin + max(0.0, start - 2) / float(stream.time_base)), backward=True, any_frame=False, stream=stream)
        for frame in container.decode(stream):
            if frame.pts is None:
                continue
            t = float((frame.pts - origin) * frame.time_base)
            if t < start - 1e-6:
                continue
            if t > until + 1e-6:
                break
            decoded += 1
            if decoded % 50 == 0:
                check()
            grey = frame.to_ndarray(format='gray')
            if recurring is not None:
                if keep is None:
                    keep = cv2.resize((recurring == 0).astype(np.uint8) * 255, (grey.shape[1], grey.shape[0]),
                                      interpolation=cv2.INTER_NEAREST)
                grey = cv2.bitwise_and(grey, keep)
            ring.append((t, grey))
            first = t if first is None else first
            last = t
            if len(ring) > 2 * REACH + 1:
                ring.popleft()
            if len(ring) - 1 - REACH >= 0:
                visit(len(ring) - 1 - REACH)
        for c in range(max(0, len(ring) - REACH), len(ring)):
            visit(c)
    if decoded > 1 and last > first:
        fps = (decoded - 1) / (last - first)
    return fps, samples


def plans_for(records, aspect):
    """What to follow at full rate: movers and brief sightings. Fixed lights stay where their detections are."""
    plans = {}
    for identifier, record in records.items():
        path = record['path']
        size = _median([max(p[3] * aspect, p[4]) for p in path])
        anchors = [(p[0], p[1], p[2]) for p in path]
        if record['motion'] == 'moving':
            plans[identifier] = {'motion': 'moving', 'anchors': anchors, 'size': size, 'speed': record['speed']}
        elif record['motion'] == 'brief':
            best = max(path, key=lambda p: p[6])
            plans[identifier] = {'motion': 'brief', 'anchors': [(best[0], best[1], best[2])], 'size': size,
                                 'radius': min(0.15, max(2.5 * size, 0.03))}
    return plans


def summarize(samples, fps, aspect):
    """Whole-track full-rate figures: frames searched and seen, first and last visible time, and the speed
    fitted through the visible positions in frame heights per second (None below two positions)."""
    seen = [s for s in samples if s[1] is not None]
    speed = None
    if len(seen) > 1:
        _, _, _, vx, vy, spread = _fit(seen)
        speed = round(math.hypot(vx * aspect, vy), 6) if spread > 1e-9 else None
    return {'fps': round(fps, 3), 'searched': len(samples), 'seen': len(seen), 'speed': speed,
            'first': round(seen[0][0], 3) if seen else None, 'last': round(seen[-1][0], 3) if seen else None}


def window(samples, t):
    """The full-rate samples within WINDOW seconds of t, rounded for storage."""
    return [[round(s[0], 3), None if s[1] is None else round(s[1], 5), None if s[2] is None else round(s[2], 5),
             round(s[3], 1)] for s in samples if abs(s[0] - t) <= WINDOW]

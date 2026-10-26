"""Kalman-filter tracking with Hungarian assignment for continuous inference."""
from collections import Counter
import numpy as np
from scipy.optimize import linear_sum_assignment

# ---- Kalman-filter centroid tracker -----------------------------------------

# Constant-velocity model in normalized image coordinates (frame is 1x1):
#   state x = [cx, cy, vx, vy]   measurement z = [cx, cy]
_F = np.array([[1, 0, 1, 0], [0, 1, 0, 1], [0, 0, 1, 0], [0, 0, 0, 1]], dtype=float)
_H = np.array([[1, 0, 0, 0], [0, 1, 0, 0]], dtype=float)
# Measurement noise: detector centroid jitter ~0.8% of the frame.
_R = np.diag([0.008 ** 2, 0.008 ** 2])
# Process noise: lets a track accelerate/curve a little each frame.
_Q = np.diag([1e-5, 1e-5, 4e-4, 4e-4])
_I4 = np.eye(4)

# Confirmed-track association gate (normalized prediction-error budget). A confirmed track's
# prediction already steps along its locked velocity, so the correct detection lands within ~noise:
#   jump_cap = _CG_BASE + _CG_UNC_W * min(pos_std, _CG_UNC_CAP) + _CG_SP_W * speed
# Kept tight (and NOT using the wide max_jump base) so a track can't reach a neighbor / a different
# new object and absorb it into a jumpy, mixed-up trajectory; _CG_UNC_CAP bounds coast re-acquisition.
_CG_BASE = 0.035
_CG_UNC_W = 1.5
_CG_UNC_CAP = 0.06
_CG_SP_W = 0.6


class _Track:
    __slots__ = ("id", "x", "P", "cls_votes", "conf", "hits", "hit_streak",
                 "time_since_update", "age", "confirmed", "pending")

    def __init__(self, tid: int, m: dict):
        self.id = tid
        self.x = np.array([m["cx"], m["cy"], 0.0, 0.0], dtype=float)
        # Big initial velocity uncertainty: until a track has a couple of hits the gate
        # is wide (so a fast object's next detection still associates); it tightens as the
        # Kalman locks the velocity, which is what then keeps co-occurring objects apart.
        self.P = np.diag([_R[0, 0], _R[1, 1], 0.3 ** 2, 0.3 ** 2]).astype(float)
        self.cls_votes: Counter = Counter({m["cls"]: 1})
        self.conf = m["conf"]
        self.hits = 1
        self.hit_streak = 1
        self.time_since_update = 0
        self.age = 0
        self.confirmed = False
        # Pre-confirmation measurements, replayed into the sighting once the track confirms so
        # a fast object that crosses in 2–3 frames still gets its full short path, not one point.
        self.pending: list[dict] = [m]

    def speed(self) -> float:
        return float(np.hypot(self.x[2], self.x[3]))

    def pos_std(self) -> float:
        """Predicted-position uncertainty (normalized). Large for a brand-new track (velocity
        unknown), shrinking as the Kalman locks on — lets a fast object's first association
        succeed while keeping confirmed tracks tightly gated."""
        return float(np.sqrt(max(self.P[0, 0], self.P[1, 1])))

    def predict(self):
        self.x = _F @ self.x
        self.P = _F @ self.P @ _F.T + _Q
        self.age += 1
        self.time_since_update += 1

    def gate(self, z: np.ndarray) -> tuple[float, float]:
        """Return (mahalanobis_d2, euclidean_dist) of measurement z to the prediction."""
        innov = z - _H @ self.x
        S = _H @ self.P @ _H.T + _R
        d2 = float(innov.T @ np.linalg.inv(S) @ innov)
        return d2, float(np.hypot(innov[0], innov[1]))

    def correct(self, m: dict):
        z = np.empty(2, dtype=np.float64)  # fill-in-place: no np.array(list) dtype discovery
        z[0] = m["cx"]
        z[1] = m["cy"]
        innov = z - _H @ self.x
        S = _H @ self.P @ _H.T + _R
        K = self.P @ _H.T @ np.linalg.inv(S)
        self.x = self.x + K @ innov
        self.P = (_I4 - K @ _H) @ self.P
        self.cls_votes[m["cls"]] += 1
        self.conf = m["conf"]
        self.hits += 1
        self.hit_streak += 1
        self.time_since_update = 0
        if not self.confirmed:
            self.pending.append(m)

    @property
    def cls(self) -> int:
        return self.cls_votes.most_common(1)[0][0]


class SkyTracker:
    """Distance-gated Kalman multi-object tracker. update() takes this frame's detections
    and returns the list of (track_id, detection_index) pairs for confirmed tracks that were
    matched to a real detection this frame."""

    def __init__(self, confirm_frames: int = 2, lost_buffer: int = 30,
                 gate_chi2: float = 13.8, max_jump: float = 0.18, class_penalty: float = 6.0,
                 dir_penalty: float = 0.0, gate_chi2_tentative: float = None, confirm_hits: int = 3):
        # Confirm fast: a small fast object may only be seen 2–3 times, so requiring 3 hits would
        # drop it entirely. Two hits within the gate is enough to declare a real track.
        self.confirm_frames = max(2, confirm_frames)
        # Blink-tolerant confirmation: a DIM/BLINKING mover (tumbling satellite, faint strobe) is seen
        # intermittently — hit, miss, hit — so it never builds `confirm_frames` CONSECUTIVE hits and
        # used to never confirm. Also confirm on TOTAL hits accumulated on one track (gaps allowed):
        # the Kalman coasts through the off-frames and re-associates each blink, so a coherent blinking
        # trajectory reaches confirm_hits while random noise (which won't keep associating) does not.
        self.confirm_hits = max(2, confirm_hits)
        self.lost_buffer = max(1, lost_buffer)
        self.gate_chi2 = gate_chi2        # Mahalanobis gate for CONFIRMED tracks (2 dof; 13.8 ≈ 99.9%)
        # Separate gate for tentative/new tracks' first association. Two competing goals shared one
        # knob before: a TIGHT confirmed gate prevents id-swaps, but a LOOSE tentative gate lets a
        # fast object's 2nd detection associate before the Kalman locks its speed. Defaults equal so
        # behavior is unchanged; widen the tentative gate to catch faster objects without loosening
        # the confirmed gate (which would re-introduce swaps).
        self.gate_chi2_tentative = gate_chi2 if gate_chi2_tentative is None else gate_chi2_tentative
        self.max_jump = max_jump          # base hard cap on per-frame jump (scaled up by velocity)
        self.class_penalty = class_penalty  # cost added for associating across object classes
        # Velocity-direction tie-breaker: when several tracks contend for one detection (a crossing),
        # prefer the track whose locked-in heading points AT the detection. 0 when perfectly aligned,
        # up to dir_penalty when the object would have to reverse. Only affects ranking among gated
        # candidates — never widens/narrows the gate — so it can't change an uncontested match.
        self.dir_penalty = dir_penalty
        self.tracks: list[_Track] = []
        self._next_id = 1

    def _solve(self, track_idxs: list[int], det_idxs: list[int],
               meas: list[dict], zs: list) -> list[tuple[int, int]]:
        """Optimal gated assignment of a SUBSET of tracks to a SUBSET of detections. Returns
        (track_index, det_index) pairs that passed the gate. Cost = Mahalanobis d² + class penalty
        + velocity-direction penalty; pairs outside the chi²/jump gate are rejected after solving."""
        if not track_idxs or not det_idxs:
            return []
        BIG = 1e6
        cost = np.full((len(track_idxs), len(det_idxs)), BIG, dtype=float)
        for a, ti in enumerate(track_idxs):
            t = self.tracks[ti]
            sp = t.speed()
            if t.confirmed:
                # A confirmed track's prediction ALREADY steps along its locked velocity, so the
                # correct detection lands within ~noise of the prediction. Bound the allowed
                # prediction error to (noise floor + bounded coast uncertainty + a little
                # acceleration slack). A detection farther than that — e.g. a different object that
                # appears nearby while this one dimmed/occluded — fails the gate and spawns its own
                # id, instead of being absorbed into a jumpy, mixed-up trajectory. (The base
                # max_jump=0.18 is deliberately NOT used here: it's wide enough for a slow track to
                # swallow a far new object, which is the dominant id-mixup source.)
                jump_cap = _CG_BASE + _CG_UNC_W * min(t.pos_std(), _CG_UNC_CAP) + _CG_SP_W * sp
            else:
                # Tentative/new track: velocity isn't locked yet, so keep the wide first-association
                # gate (lets a fast object's 2nd detection associate before the Kalman has its speed).
                jump_cap = self.max_jump + 2.5 * sp + 1.5 * t.pos_std()
            chi2_gate = self.gate_chi2 if t.confirmed else self.gate_chi2_tentative
            for b, di in enumerate(det_idxs):
                z = zs[di]
                d2, eu = t.gate(z)
                if d2 <= chi2_gate and eu <= jump_cap:
                    c = d2
                    if meas[di]["cls"] != t.cls:
                        c += self.class_penalty
                    # Direction tie-breaker (confirmed movers only): penalize a detection whose
                    # OFFSET from the prediction points against the track's heading — i.e. the object
                    # would have to be behind where it's going, the signature of a different object
                    # (decisive for opposite-heading crossings). Scaled by the offset magnitude so a
                    # small noise residual (well-tracked object) contributes ~nothing and a large
                    # wrong-side residual contributes a lot; this is why it helps head-on crossings
                    # without adding noise to a dense same-heading flock.
                    if self.dir_penalty and sp > 1e-3:
                        disp = z - t.x[:2]
                        dn = float(np.hypot(disp[0], disp[1]))
                        if dn > 1e-6:
                            cosang = float((disp[0] * t.x[2] + disp[1] * t.x[3]) / (dn * sp))
                            c += self.dir_penalty * dn * (1.0 - cosang)  # ∝ offset · misalignment
                    cost[a, b] = c
        rows, cols = linear_sum_assignment(cost)
        out = []
        for r, cc in zip(rows, cols):
            if cost[r, cc] >= BIG:
                continue  # gated-out pair the solver was forced to pick — reject
            out.append((track_idxs[r], det_idxs[cc]))
        return out

    def update(self, meas: list[dict]) -> list[dict]:
        """Returns one emission per confirmed track matched this frame:
        {track_id, di, backfill: [pre-confirmation measurements to prepend]}."""
        for t in self.tracks:
            t.predict()

        matches: list[tuple[int, int]] = []  # (track_index, det_index)
        unmatched_dets = list(range(len(meas)))

        if self.tracks and meas:
            # One preallocated (N,2) buffer filled in place, instead of N separate np.array([cx,cy])
            # calls. Each np.array(python_list) does a recursive dtype/shape discovery pass that holds
            # the GIL; doing it per detection per frame was a top CPU offender (and stalled the API
            # event loop). zs[di] still returns a (2,) row view, so _solve is unchanged.
            zs = np.empty((len(meas), 2), dtype=np.float64)
            for _i, _m in enumerate(meas):
                zs[_i, 0] = _m["cx"]
                zs[_i, 1] = _m["cy"]
            # Matching cascade: CONFIRMED tracks pick their detections FIRST, then leftover detections
            # may match tentative (unconfirmed) tracks. A freshly spawned track's gate balloons wide
            # after one predict, so in a single global solve it can produce a low Mahalanobis cost and
            # steal a detection from the established track it belongs to — the dominant id-switch path.
            # Giving confirmed tracks first pick removes that contention entirely.
            confirmed_idx = [i for i, t in enumerate(self.tracks) if t.confirmed]
            tentative_idx = [i for i, t in enumerate(self.tracks) if not t.confirmed]
            m1 = self._solve(confirmed_idx, unmatched_dets, meas, zs)
            used = {di for _, di in m1}
            remaining = [d for d in unmatched_dets if d not in used]
            m2 = self._solve(tentative_idx, remaining, meas, zs)
            matches = m1 + m2
            matched_dets = {di for _, di in matches}
            unmatched_dets = [d for d in range(len(meas)) if d not in matched_dets]

        # Apply corrections to matched tracks.
        for ti, di in matches:
            self.tracks[ti].correct(meas[di])

        # Tracks not matched this frame lose their consecutive-hit streak.
        matched_tracks = {ti for ti, _ in matches}
        for ti, t in enumerate(self.tracks):
            if ti not in matched_tracks:
                t.hit_streak = 0

        # Spawn new tentative tracks for unmatched detections.
        for di in unmatched_dets:
            self.tracks.append(_Track(self._next_id, meas[di]))
            matches.append((len(self.tracks) - 1, di))
            self._next_id += 1

        # Confirm and collect output, with backfill on the confirmation frame.
        out: list[dict] = []
        for ti, di in matches:
            t = self.tracks[ti]
            backfill: list[dict] = []
            if not t.confirmed and (t.hit_streak >= self.confirm_frames or t.hits >= self.confirm_hits):
                t.confirmed = True
                backfill = t.pending[:-1]  # the current det is emitted as the main point
                t.pending = []
            if t.confirmed and t.time_since_update == 0:
                out.append({"track_id": t.id, "di": di, "backfill": backfill})

        # Drop tracks lost beyond the buffer.
        self.tracks = [t for t in self.tracks if t.time_since_update <= self.lost_buffer]
        return out

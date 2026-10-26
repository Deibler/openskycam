"""YOLO detection for continuous inference: tiled or whole-frame prediction with strict class validation."""
import logging
import numpy as np
from ..utils import configInferenceUtil as config, deviceInferenceUtil as devices, geometryInferenceUtil as geometry

log = logging.getLogger(__name__)

def _round32(n: int) -> int:
    """Round up to a multiple of 32 (YOLO stride requirement)."""
    return ((int(n) + 31) // 32) * 32


def _compute_slices(w: int, h: int, slice_px: int, overlap: float) -> list[tuple[int, int, int, int]]:
    """SAHI-style slice rectangles (x0, y0, sw, sh) tiling a w×h frame with native-pixel
    slices of side `slice_px` and fractional `overlap`. The last row/column is shifted
    inward so the whole frame is covered without running off the edge."""
    sw = min(int(slice_px), w)
    sh = min(int(slice_px), h)
    step_x = max(1, int(sw * (1 - overlap)))
    step_y = max(1, int(sh * (1 - overlap)))
    xs = list(range(0, max(1, w - sw + 1), step_x))
    ys = list(range(0, max(1, h - sh + 1), step_y))
    if xs[-1] != w - sw:
        xs.append(max(0, w - sw))
    if ys[-1] != h - sh:
        ys.append(max(0, h - sh))
    xs = sorted(set(xs))
    ys = sorted(set(ys))
    return [(x, y, sw, sh) for y in ys for x in xs]


class YoloDetector:
    """Ultralytics YOLO backend. Maps native class names onto config.CLASS_NAMES and reuses
    the shared geometry filter so output matches the ONNX detector's dict format exactly."""

    def __init__(self, spec: dict, settings: dict):
        from ultralytics import YOLO
        import torch

        # Cap torch's CPU intra-op pool (NMS / postprocess / any CPU-fallback op) so inference
        # yields cores to other work on the machine. The forward pass runs on the GPU when there is one.
        if config.BLAS_THREADS:
            torch.set_num_threads(config.BLAS_THREADS)

        self.model = YOLO(spec["path"])
        requested_device = settings.get('device', 'auto')
        self.device = devices.pick_device(torch, requested_device)
        if self.device not in ('cpu', 'mps', 'cuda'):
            raise ValueError('Unsupported inference device')
        # Whole-frame inference size: the user's explicit override (yolo_imgsz > 0) wins,
        # else the model's native training resolution. Tiling uses tile_imgsz (the size the
        # slice-trained variant was trained at) so slices match its learned scale.
        override = int(settings.get("yolo_imgsz") or 0)
        self.imgsz = override or int(spec.get("imgsz") or 736)
        self.tile_imgsz = override or int(spec.get("tile_imgsz") or spec.get("imgsz") or self.imgsz)
        self.tile_fullframe = bool(spec.get("tile_fullframe", True))
        # native model index -> config class id, matched by name (case-insensitive).
        self._map: dict[int, int] = {}
        cfg_by_name = {v.lower(): k for k, v in config.CLASS_NAMES.items()}
        for idx, name in self.model.names.items():
            cid = cfg_by_name.get(str(name).strip().lower())
            if cid is not None:
                self._map[int(idx)] = cid

        if set(self._map.values()) != set(settings["enabled_classes"]):
            raise ValueError("Model classes do not match the pipeline configuration")

    def close(self):
        """Release the model + its MPS/GPU memory. Called when the worker swaps detectors
        (auto-routing) so each switch doesn't leak a model into unified memory."""
        try:
            self.model = None
            import torch
            if self.device != "cpu":
                devices.empty_cache(torch)
        except Exception:
            pass

    def _predict(self, imgs, imgsz: int, settings: dict):
        """One ultralytics predict call. FP16 on the GPU ~halves latency; if a kernel rejects
        half it retries fp32 so inference never just dies. TTA (augment) is optional."""
        half = bool(settings.get("half", True)) and self.device != "cpu"
        augment = bool(settings.get("tta", False))
        kw = dict(imgsz=imgsz, conf=settings["confidence"], iou=settings["nms_iou"],
                  device=self.device, augment=augment, verbose=False)
        try:
            return self.model.predict(imgs, half=half, **kw)
        except Exception as e:
            # Only retry in fp32 for the specific half-precision/dtype rejection — re-raise OOM,
            # device faults, or other errors so they surface instead of being silently masked.
            msg = str(e).lower()
            is_dtype = any(t in msg for t in ("half", "float16", "dtype", "type", "precision"))
            if half and is_dtype:
                log.warning("half-precision predict failed (%s); retrying in fp32", e)
                return self.model.predict(imgs, half=False, **kw)
            raise

    def infer(self, frame: np.ndarray, settings: dict) -> list[dict]:
        h, w = frame.shape[:2]
        if settings.get("deep_scan"):
            return self._infer_tiled(frame, settings)
        res = self._predict(frame, self.imgsz, settings)
        dets = self._collect(res, [(0, 0)], settings, w, h)
        return geometry.geom_filter(dets, h, w, settings)  # YOLO already did NMS; just geometry

    def _infer_tiled(self, frame: np.ndarray, settings: dict) -> list[dict]:
        """SAHI-style: slice into native-pixel patches (+ optional full-frame pass for large
        objects), run each at tile_imgsz so small objects keep their pixels, then merge.
        Slices are sized in real pixels (not a grid fraction) so the object scale the model
        sees stays close to its training scale regardless of frame resolution."""
        h, w = frame.shape[:2]
        slice_px = int(settings.get("slice_px") or 768)
        overlap = float(settings.get("deep_scan_overlap", 0.2))
        # CRITICAL for tiny (1-2px) objects: never downscale a slice — that's what wipes them
        # out. Run every slice at >= its own pixel size. When tile_imgsz > slice_px the slice is
        # UPSCALED, so a 2px object grows above the model's stride-8 detection floor instead of
        # vanishing. eff is the actual inference resolution.
        eff = _round32(max(self.tile_imgsz, slice_px))
        imgs: list[np.ndarray] = []
        offsets: list[tuple[int, int]] = []
        # Full-frame pass catches large objects the slices would split — but it's pointless
        # for a slice-trained model (the whole 4K frame downscaled to tile_imgsz is mush),
        # so spec.tile_fullframe disables it for that model.
        if self.tile_fullframe:
            imgs.append(frame); offsets.append((0, 0))
        for (x0, y0, sw, sh) in _compute_slices(w, h, slice_px, overlap):
            tile = frame[y0:y0 + sh, x0:x0 + sw]
            if tile.size:
                imgs.append(tile); offsets.append((x0, y0))
        res = self._predict(imgs, eff, settings)
        dets = self._collect(res, offsets, settings, w, h)
        dets = geometry.geom_filter(dets, h, w, settings)
        return _merge(dets, settings["nms_iou"])  # collapse cross-tile / full-frame duplicates

    def _collect(self, results, offsets, settings: dict, w: int, h: int) -> list[dict]:
        enabled = set(settings["enabled_classes"])
        dets: list[dict] = []
        for res, (ox, oy) in zip(results, offsets):
            for b in res.boxes:
                cid = self._map.get(int(b.cls))
                if cid is None or cid not in enabled:
                    continue
                x1, y1, x2, y2 = b.xyxy[0].tolist()
                dets.append({
                    "class_id": cid, "class": config.CLASS_NAMES[cid], "confidence": float(b.conf),
                    "box": [max(0, int(x1 + ox)), max(0, int(y1 + oy)),
                            min(w, int(x2 + ox)), min(h, int(y2 + oy))],
                })
        return dets


def _merge(dets, iou_thr) -> list[dict]:
    """Merge detections from overlapping slices / the full-frame pass. Unlike plain NMS this
    also collapses by intersection-over-smaller, so a tiny object found at slightly different
    coordinates in two overlapping tiles (low IoU, but one box mostly inside the other) is
    deduplicated instead of double-counted. Class-aware; keeps the highest-confidence box."""
    if not dets:
        return []
    merge_iou = min(float(iou_thr), 0.45)  # lower than detection NMS: tiles produce offset dups
    dets = sorted(dets, key=lambda d: d["confidence"], reverse=True)
    keep: list[dict] = []
    for d in dets:
        if any(
            k["class_id"] == d["class_id"]
            and (_iou(k["box"], d["box"]) >= merge_iou or _ios(k["box"], d["box"]) >= 0.6)
            for k in keep
        ):
            continue
        keep.append(d)
    return keep


def _iou(a, b) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _ios(a, b) -> float:
    """Intersection over the smaller box's area — catches one box nested inside another."""
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    smaller = min(area_a, area_b)
    return inter / smaller if smaller > 0 else 0.0

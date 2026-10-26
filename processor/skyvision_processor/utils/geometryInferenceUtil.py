"""Shared detection geometry gate.

A single implementation of the min-box / aspect / edge-margin filter that the ONNX detector,
the motion detector, and the diff-imaging detector all need. Kept dependency-free (no cv2/torch/
config imports) so any of them can use it without an import cycle.
"""
from __future__ import annotations


def geom_filter(dets: list[dict], h: int, w: int, settings: dict,
                max_aspect: float | None = None) -> list[dict]:
    """Reject boxes that are too small, too elongated, or hugging the frame edge (the lens rim).

    `max_aspect` overrides settings["max_aspect"] — diff-imaging passes a larger cap because a fast
    mover is a long thin streak that the default would reject. Operates on the dict format every
    detector emits: {"box": (x1, y1, x2, y2), ...} in pixel coords.
    """
    margin = settings["edge_margin"]
    min_px = settings["min_box_px"]
    if max_aspect is None:
        max_aspect = settings["max_aspect"]
    ex, ey = margin * w, margin * h
    out = []
    for d in dets:
        x1, y1, x2, y2 = d["box"]
        bw, bh = x2 - x1, y2 - y1
        if bw < min_px or bh < min_px:
            continue
        if max(bw, bh) / max(min(bw, bh), 1) > max_aspect:
            continue
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        if cx < ex or cx > w - ex or cy < ey or cy > h - ey:
            continue
        out.append(d)
    return out

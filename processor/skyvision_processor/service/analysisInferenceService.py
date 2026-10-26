"""Decode and analyze in presentation time, preserving the archived baseline algorithm."""
from collections import Counter
import importlib.metadata
import platform
from pathlib import Path
from ..models.processorInferencemodel import ProcessingError, Settings, Progress, Analysis

def analyze(path: Path, weights: Path, settings: Settings, progress: Progress) -> Analysis:
    import av
    import cv2
    from .detectorInferenceService import YoloDetector
    from .trackerInferenceService import SkyTracker

    # Sampling is in presentation time, never wall time. Baseline uses no motion/edge/aspect gate.
    fps = float(settings["process_fps"])
    if not 1 <= fps <= 30:
        raise ProcessingError("model_failed")
    cv2.setNumThreads(2)
    detector = None
    try:
        detector = YoloDetector({"path": str(weights), "imgsz": settings["yolo_imgsz"]}, settings)
    except Exception:
        raise ProcessingError("model_failed") from None
    tracker = SkyTracker(confirm_frames=2, confirm_hits=3, lost_buffer=settings["track_lost_buffer"], dir_penalty=3)
    tracks = {}; images = {}; votes = {}; decoded = 0; sampled = 0; raw_detections = 0
    first_pts = None; last_t = -1.; next_sample = 0.; sample_times = []
    try:
        with av.open(str(path)) as container:
            stream = container.streams.video[0]
            stream.codec_context.thread_count = 2
            frame_duration = float(1 / stream.average_rate) if stream.average_rate else 0.
            for frame in container.decode(stream):
                progress.check()
                if frame.pts is None or frame.time_base is None:
                    raise ProcessingError("decode_failed")
                pts = float(frame.pts * frame.time_base)
                if first_pts is None:
                    first_pts = pts
                t = pts - first_pts
                if t <= last_t:
                    raise ProcessingError("decode_failed")
                decoded += 1; last_t = t
                if t + 1e-6 < next_sample:
                    continue
                # No inference frame drops to catch up with wall time.
                next_sample = (int((t + 1e-6) * fps) + 1) / fps
                sampled += 1; sample_times.append(t)
                image = frame.to_ndarray(format="bgr24")
                try:
                    detections = detector.infer(image, settings)
                except Exception:
                    raise ProcessingError("model_failed") from None
                h, w = image.shape[:2]; measurements = []
                for d in detections:
                    x1, y1, x2, y2 = d["box"]
                    if x2 <= x1 or y2 <= y1:
                        continue
                    measurements.append({"cx": (x1+x2)/2/w, "cy": (y1+y2)/2/h, "cls": d["class_id"],
                                         "conf": d["confidence"], "box": [x1/w, y1/h, x2/w, y2/h], "t": t})
                raw_detections += len(measurements)
                for emission in tracker.update(measurements):
                    tid = emission["track_id"]; current = measurements[emission["di"]]
                    if tid not in tracks:
                        if len(tracks) >= 256:
                            raise ProcessingError("processor_failed")
                        tracks[tid] = {"track_id": tid, "points": [], "score": 0.0}
                        votes[tid] = Counter()
                    track = tracks[tid]
                    for m in [*emission["backfill"], current]:
                        track["points"].append({"t": m["t"], "box": m["box"], "score": m["conf"]})
                        votes[tid][m["cls"]] += 1
                    if len(track["points"]) > 4000:
                        raise ProcessingError("processor_failed")
                    if current["conf"] >= track["score"]:
                        track["score"] = current["conf"]
                        ok, jpeg = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 80])
                        if not ok or len(jpeg) > 4 * 1024 * 1024:
                            raise ProcessingError("processor_failed")
                        images[tid] = jpeg.tobytes()
                        track["evidence_time"] = t
                        track["evidence_box"] = current["box"]
                if sampled % 80 == 0:
                    print(f"Analyzed {t:.1f}s; {sampled} sampled frames; {len(tracks)} tracks", flush=True)
            if not decoded or not sampled:
                raise ProcessingError("decode_failed")
        labels = {1: "plane", 2: "wildlife", 3: "meteor"}
        for tid, track in tracks.items():
            track["label"] = labels.get(votes[tid].most_common(1)[0][0], "unresolved")
            track["classification_basis"] = "uncalibrated_model_prediction"
        return list(tracks.values()), images, {
            "decoded_frames": decoded, "sampled_frames": sampled, "processed_seconds": last_t + frame_duration,
            "raw_detections": raw_detections, "first_pts": first_pts, "sample_times": sample_times,
        }, {"device": detector.device, "python": platform.python_version(), "machine": platform.machine(),
            "packages": {name: importlib.metadata.version(name) for name in ("av", "torch", "ultralytics", "numpy", "scipy", "opencv-python")}}
    except ProcessingError:
        raise
    except Exception:
        raise ProcessingError("decode_failed") from None
    finally:
        detector.close()

# Night detector

Finds **Plane** and **Meteorite** in night frames from a fixed sky camera. It is a YOLO26s detector run on the whole frame at 1920 px. Try it on your own footage first, then fine-tune it on frames you have reviewed ([training notebook](../../processor/examples/train_detector.ipynb)).

| File | What it is |
|---|---|
| `night-yolo26s-1920.pt` | The Ultralytics checkpoint, 20.6 MB, SHA-256 `c756ed0b828a3069db037ece461a4d9a15239b27049540be245bc40e2328ad26` |
| `model.json` | Its model card, ready to publish |
| `LICENSE` | AGPL-3.0, which covers these weights (see [License](#license)) |

## Use it in openskycam

Publish it to your model registry with a **Publish trained models** key, from the repository root:

```sh
pip install ./processor
skyvision-processor publish-model --base-url https://<api-host> --key-file publish.key \
  --metadata models/night-detector/model.json --artifact models/night-detector/night-yolo26s-1920.pt
```

Then choose `openskycam-night/yolo26s-1920-2026-10-25` in a workflow's model step. The numbers below are at a minimum score of 0.3. To keep moving planes and set stars and fixed lights aside, route on motion as in the [night workflow example](../../docs/workshop/workflows.md#example-a-night-workflow-that-sets-fixed-lights-aside).

## Use it on its own

```python
import cv2
from ultralytics import YOLO

model = YOLO("night-yolo26s-1920.pt")
frame = cv2.imread("frame.jpg")
scale = 1920 / max(frame.shape[:2])
if scale < 1:  # shrink as the processor does, so results match a Workshop run
    frame = cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
for box in model.predict(frame, imgsz=1920, conf=0.3)[0].boxes:
    print(model.names[int(box.cls)], float(box.conf), box.xyxyn.tolist())
```

## Training

The checkpoint descends from Ultralytics YOLO26s through an earlier openskycam detector, fine-tuned on reviewed frames from one 4K camera:

| Split | Images | Planes | Meteors | Nights |
|---|---|---|---|---|
| Train | 4,036 | 3,322 | 301 | the rest |
| Validation | 792 | 686 | 69 | 2 |
| Test | 1,245 | 891 | 157 | 7 |

- Frames a reviewer accepted keep their boxes.
- Rejected frames whose box stayed in one place (stars, glare, building and tower lights) train as empty sky, at most 8 per night and spot in the sky.
- Rejected frames of moving objects, satellites among them, are left out, so the model is not taught to ignore movement.
- Meteor frames are repeated 3 times in training.
- Splits are whole nights, so near-identical frames of one night never land on both sides.

Ultralytics 8.4.165, `imgsz=1920`, up to 40 epochs with `patience=15`, `scale=0.3`, `fliplr=0.5`, `flipud=0`, `seed=0`. The best epoch was 23.

## Evaluation

Validation during training: mAP50 0.947, mAP50-95 0.653, precision 0.924, recall 0.926.

On the 7 test nights, at a minimum score of 0.3:

| | This model | Previous model |
|---|---|---|
| Plane recall | 0.955 | 0.925 |
| Meteorite recall | 0.904 | 0.866 |
| Stationary lights flagged | 0.074 | 0.485 |
| Extra detections per labelled image | 0.049 | 0.031 |

A detection counts as a match when it overlaps a label (IoU 0.1) or its centre is within one box length of the label's. The test labels are frames a person reviewed among the previous model's detections, so recall here measures keeping what that model found, not finding objects both models miss. These numbers come from the training notebook, not from a Workshop run.

## Limits

- **One camera, one site.** Other cameras, lenses, exposure settings and skies will see lower recall and more false alarms. Review its detections on your own footage before relying on it.
- **Night only.** Every training, validation and test frame was taken between 22:00 and 05:00 local time. It has not seen daylight or twilight.
- **Satellites.** It can label a satellite as a Plane. Both move across the sky, and it has no satellite class, so check before counting planes.
- **Ultralytics versions.** It loads and gives the same detections with Ultralytics 8.4.58, the version the processor installs.

## License

These weights are licensed under the [GNU Affero General Public License v3.0](LICENSE), not the repository's MIT license, because they derive from Ultralytics YOLO26s, which Ultralytics publishes under AGPL-3.0. Using them in a service you offer to others carries AGPL-3.0's obligations, or needs an [Ultralytics Enterprise License](https://www.ultralytics.com/license).

import argparse
import json
from pathlib import Path
from ..service.registrationInferenceService import register

def main() -> None:
    parser = argparse.ArgumentParser(description='Generate SQL for explicit LOCAL pipeline registration; never connects to a database.')
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--camera', required=True)
    parser.add_argument('--enable', action='store_true')
    parser.add_argument('--recording-json', type=Path)
    args = parser.parse_args()
    pipeline = json.loads(args.manifest.read_text())
    rows = json.loads(args.recording_json.read_text())[0]['results'] if args.recording_json else None
    try:
        print(register(pipeline, args.camera, args.enable, rows))
    except ValueError as error:
        parser.error(str(error))

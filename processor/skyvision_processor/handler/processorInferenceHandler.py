"""Translate CLI input to service calls and print bounded results."""
import json
import os
from argparse import Namespace
from ..utils.httpSharedUtil import Client
from ..utils.provenanceInferenceUtil import manifest
from ..service.jobInferenceService import run_one

def manifest_handler(args: Namespace) -> None:
    print(json.dumps(manifest(args.weights, json.loads(args.config.read_text())), indent=2))

def run_handler(args: Namespace) -> None:
    if args.key_file:
        if args.key_file.stat().st_mode & 0o077:
            raise ValueError('Credential file must be readable only by its owner (chmod 600)')
        token = args.key_file.read_text().strip()
    else:
        token = os.environ.get('SKYVISION_PROCESSOR_KEY', '')
    if not token:
        raise ValueError('Supply SKYVISION_PROCESSOR_KEY or --key-file')
    print(json.dumps(run_one(Client(args.base_url, token), args.camera, args.weights), indent=2))

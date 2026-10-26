"""CLI input/output for publication and deployment synchronization."""
import json
from argparse import Namespace
from ..service.modelInferenceService import publish, train_and_publish
from ..service.deploymentInferenceService import sync_models, run_deployed
from ..utils.credentialSharedUtil import read_token
from ..utils.httpSharedUtil import Client

def publish_handler(args: Namespace):
    result = publish(Client(args.base_url, read_token(args.key_file)), json.loads(args.metadata.read_text()), args.artifact)
    print(json.dumps({'published': result['family'] + '/' + result['version'], 'artifacts': result['artifacts']}, indent=2))

def train_handler(args: Namespace):
    train_and_publish(Client(args.base_url, read_token(args.key_file)), json.loads(args.metadata.read_text()), json.loads(args.train_config.read_text()))

def sync_handler(args: Namespace):
    result = sync_models(Client(args.base_url, read_token(args.key_file)), args.device, args.runtime_dir)
    print(json.dumps(result, indent=2))

def deployed_handler(args: Namespace):
    result = run_deployed(Client(args.base_url, read_token(args.key_file, 'SKYVISION_PROCESSOR_KEY')), args.camera, args.runtime_dir, args.slot)
    print(json.dumps(result, indent=2))

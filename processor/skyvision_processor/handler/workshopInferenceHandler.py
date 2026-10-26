"""Workshop CLI input/output. Runtime registration is an authenticated website operation."""
import json
from ..service.workshopInferenceService import process_workshop
from ..utils.provenanceInferenceUtil import code_hash
from ..utils.credentialSharedUtil import read_token
from ..utils.httpSharedUtil import Client


def workshop_manifest_handler(args):
    print(json.dumps({'device_id': args.device, 'code_sha256': code_hash()}, indent=2))


def workshop_handler(args):
    client = Client(args.base_url, read_token(args.key_file, 'SKYVISION_WORKSHOP_KEY'))
    for result in process_workshop(client, args.runtime, args.watch):
        print(json.dumps(result), flush=True)

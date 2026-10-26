import argparse
from pathlib import Path

def parse_args():
    parser = argparse.ArgumentParser(description='Process one archived recording through a scoped SkyVision API')
    sub = parser.add_subparsers(dest='command', required=True)
    register = sub.add_parser('manifest')
    register.add_argument('--weights', required=True, type=Path)
    register.add_argument('--config', required=True, type=Path)
    run = sub.add_parser('run')
    run.add_argument('--weights', required=True, type=Path)
    run.add_argument('--base-url', required=True)
    run.add_argument('--camera', default='sky01')
    run.add_argument('--key-file', type=Path, help='A mode-600 file; otherwise read SKYVISION_PROCESSOR_KEY')
    for name in ('publish-model', 'train', 'sync-models', 'run-deployed'):
        command = sub.add_parser(name)
        command.add_argument('--base-url', required=True)
        command.add_argument('--key-file', type=Path)
        if name in ('publish-model', 'train'):
            command.add_argument('--metadata', type=Path, required=True)
            if name == 'publish-model':
                command.add_argument('--artifact', action='append', type=Path, required=True)
            else:
                command.add_argument('--train-config', type=Path, required=True)
        else:
            command.add_argument('--runtime-dir', type=Path, default=Path.home() / '.local/share/skyvision/models')
            if name == 'sync-models':
                command.add_argument('--device', required=True)
            else:
                command.add_argument('--slot', default='detector')
                command.add_argument('--camera', default='sky01')
    manifest_cmd = sub.add_parser('workshop-manifest')
    manifest_cmd.add_argument('--device', required=True)
    workshop = sub.add_parser('workshop-run')
    workshop.add_argument('--base-url', required=True)
    workshop.add_argument('--key-file', type=Path)
    workshop.add_argument('--runtime', required=True)
    workshop.add_argument('--watch', action='store_true', help='Poll only manually submitted Workshop jobs')
    args = parser.parse_args()
    return parser, args

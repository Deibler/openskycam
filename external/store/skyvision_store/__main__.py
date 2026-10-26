"""python -m skyvision_store --root /path/to/footage --token-file ~/.config/skyvision-store/store.token"""
import argparse
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from .janitor import prune
from .server import StoreServer

GB = 1_000_000_000
# A day past the Workers' RETENTION_DAYS, so the catalog forgets a recording before its file goes
# (tests/test_store.py checks this).
RETENTION_DAYS = 41


def main() -> None:
    parser = argparse.ArgumentParser(prog='skyvision_store')
    parser.add_argument('--root', type=Path, required=True, help='footage folder: a mounted volume, unless --system-disk')
    parser.add_argument('--system-disk', action='store_true',
                        help='the root is a folder on the system disk: skip the mount check (--min-free-gb still applies)')
    parser.add_argument('--token-file', type=Path, required=True)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8096)
    parser.add_argument('--retention-days', type=int, default=RETENTION_DAYS)
    parser.add_argument('--min-free-gb', type=int, default=100)
    parser.add_argument('--prune-every-s', type=int, default=600)
    args = parser.parse_args()

    token = args.token_file.read_text().strip()
    if len(token) < 32:
        sys.exit('token file must hold at least 32 characters')
    server = StoreServer((args.host, args.port), args.root, token, args.min_free_gb * GB,
                         mounted=(lambda: True) if args.system_disk else None)
    threading.Thread(target=_janitor, args=(server, args), daemon=True).start()
    print(f'serving {args.root} on {args.host}:{args.port}', file=sys.stderr, flush=True)
    server.serve_forever()


def _janitor(server: StoreServer, args) -> None:
    while True:
        try:
            if server.mounted():
                today = datetime.now(timezone.utc).date()
                for folder in prune(args.root, today, args.retention_days, server.min_free):
                    print(f'pruned {folder.relative_to(args.root)}', file=sys.stderr, flush=True)
        except OSError as error:
            print(f'prune failed: {error}', file=sys.stderr, flush=True)
        time.sleep(args.prune_every_s)


if __name__ == '__main__':
    main()

"""Read a client secret without putting it in command arguments or logs."""
import os
from pathlib import Path

def read_token(path: Path | None, variable='SKYVISION_API_KEY') -> str:
    if path:
        if path.stat().st_mode & 0o077:
            raise ValueError('Credential file must be readable only by its owner (chmod 600)')
        token = path.read_text().strip()
    else:
        token = os.environ.get(variable, '')
    if not token:
        raise ValueError(f'Supply --key-file or {variable}')
    return token

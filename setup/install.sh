#!/usr/bin/env bash
# Installs openskycam and starts the guided setup:
#   curl -fsSL https://raw.githubusercontent.com/Deibler/openskycam/main/setup/install.sh | bash
# OPENSKYCAM_DIR (default ~/openskycam) is where the repository goes; an existing clone is updated.
set -euo pipefail
REPO=${OPENSKYCAM_REPO:-https://github.com/Deibler/openskycam.git}
DIR=${OPENSKYCAM_DIR:-$HOME/openskycam}

missing=()
need() { command -v "$1" >/dev/null 2>&1 || missing+=("$1: $2"); }
need git "https://git-scm.com/downloads"
need node "Node.js 24 or later, https://nodejs.org"
need npm "comes with Node.js"
need ssh "an OpenSSH client"
need python3 "https://www.python.org/downloads/"
if [ ${#missing[@]} -gt 0 ]; then
  echo "openskycam needs:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  exit 1
fi
if ! node -e 'process.exit(+process.versions.node.split(".")[0] >= 24 ? 0 : 1)'; then
  echo "openskycam needs Node.js 24 or later; this is $(node -v). See https://nodejs.org" >&2
  exit 1
fi

if [ -d "$DIR/.git" ]; then
  echo "Updating $DIR"
  git -C "$DIR" pull --ff-only --no-rebase --quiet || echo "Could not update $DIR (local changes?); continuing with it as it is."
else
  echo "Downloading openskycam to $DIR"
  git clone --quiet --depth 1 "$REPO" "$DIR"
fi
cd "$DIR"
echo "Installing dependencies (a minute or two)"
npm install --no-audit --no-fund --loglevel=error
# Piped into bash, this script's stdin is the script itself: the guided setup reads the terminal instead.
if [ -t 0 ]; then
  exec npm run --silent setup
elif (: </dev/tty) 2>/dev/null; then
  exec npm run --silent setup </dev/tty
else
  echo "Installed. To set up, run this from a terminal: cd $DIR && npm run setup"
fi

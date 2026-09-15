#!/bin/bash
# systemd / cron entrypoint. Ubuntu's /usr/bin/node is v12 and has no fetch.
set -euo pipefail
cd /var/www/VomeSync-server

NODE=""
if [ -n "${NVM_DIR:-}" ] && [ -s "$NVM_DIR/nvm.sh" ]; then
	# shellcheck disable=SC1090
	. "$NVM_DIR/nvm.sh"
	NODE="$(command -v node || true)"
fi
if [ -z "$NODE" ]; then
	for candidate in /home/vortitron/.nvm/versions/node/v*/bin/node; do
		if [ -x "$candidate" ]; then
			NODE="$candidate"
		fi
	done
fi
if [ -z "$NODE" ]; then
	NODE="$(command -v node || true)"
fi
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
	echo "no usable node binary" >&2
	exit 1
fi

exec "$NODE" catalogue/cli.js observe "$@"

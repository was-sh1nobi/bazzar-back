#!/usr/bin/env bash
set -euo pipefail

# Runs on the VPS via SSH. Assumes:
#   * bun installed for the target user
#   * systemd user/global unit bazzar.service present (see bazzar.service)
#   * secrets dropped into /etc/bazzar/.env (or a path the unit points to)

APP_DIR="$HOME/bazzar-back"
INSTANCE="$(systemd-escape --suffix=service bazzar)"

install -d "$APP_DIR"
cp -r /tmp/bazzar-src/* "$APP_DIR/"
cd "$APP_DIR"
bun install --frozen-lockfile

systemctl --user daemon-reload
systemctl --user restart "$INSTANCE"
systemctl --user is-active "$INSTANCE" >/dev/null || {
    journalctl --user -u "$INSTANCE" -n 30 --no-pager >&2
    exit 1
}
rm -rf /tmp/bazzar-src
echo "deployed: $(systemctl --user show "$INSTANCE" --property=ActiveState --value)"

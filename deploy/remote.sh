#!/usr/bin/env bash
set -euo pipefail

# Runs on the VPS via SSH. Assumes:
#   * bun installed for the target user (add its bin dir to PATH below if not
#     already on the system PATH)
#   * /var/www/bazzar is writable by the SSH user (deploy as root if it isn't)
#   * first run creates /var/www/bazzar/.env from the shipped .env.example —
#     the unit refuses to start without it

APP_DIR="/var/www/bazzar"
UNIT_DIR="$HOME/.config/systemd/user"
INSTANCE="$(systemd-escape --suffix=service bazzar)"

mkdir -p "$APP_DIR"

# Bootstrap the env file if this is the first deploy on this host.
if [ ! -f "$APP_DIR/.env" ]; then
    cp /tmp/bazzar-src/.env.example "$APP_DIR/.env"
    echo "::warning::no .env found on server; copied .env.example to $APP_DIR/.env — review it"
fi

cp -r /tmp/bazzar-src/. "$APP_DIR/"

cd "$APP_DIR"
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
bun install --frozen-lockfile

# Install/update the systemd user unit from the repo so the service exists.
mkdir -p "$UNIT_DIR"
cp /tmp/bazzar-src/deploy/bazzar.service "$UNIT_DIR/$INSTANCE"

systemctl --user daemon-reload
systemctl --user enable --now "$INSTANCE" >/dev/null 2>&1 || true
systemctl --user restart "$INSTANCE"
systemctl --user is-active "$INSTANCE" >/dev/null || {
    journalctl --user -u "$INSTANCE" -n 30 --no-pager >&2
    exit 1
}
rm -rf /tmp/bazzar-src
echo "deployed to $APP_DIR: $(systemctl --user show "$INSTANCE" --property=ActiveState --value)"

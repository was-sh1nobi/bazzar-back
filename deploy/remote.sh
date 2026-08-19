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
if [ -x "$BUN_INSTALL/bin/bun" ]; then
    export PATH="$BUN_INSTALL/bin:$PATH"
else
    command -v bun >/dev/null || { echo "::error::bun not found on $SSH_USER@$SSH_HOST"; exit 1; }
fi
bun install --frozen-lockfile

# --- Create and enable the systemd user unit, remotely and automatically. ---

# 1) Make sure the user manager is actually running so systemctl --user works.
if ! systemctl --user is-system-running >/dev/null 2>&1; then
    systemctl enable --now systemd-user --no-pager >/dev/null 2>&1 \
        || loginctl enable-linger "${USER:-$(id -un)}" \
        || true   # real failure surfaces at the restart below
fi

# 2) Install the unit file from the repo.
mkdir -p "$UNIT_DIR"
cp /tmp/bazzar-src/deploy/bazzar.service "$UNIT_DIR/$INSTANCE"

systemctl --user daemon-reload

# 3) Enable (persist), then start/restart.
systemctl --user enable "$INSTANCE" >/dev/null 2>&1 || true
systemctl --user restart "$INSTANCE"

# 4) Verify, or dump the journal so the failure is visible.
systemctl --user is-active "$INSTANCE" >/dev/null || {
    echo "::error::bazzar.service failed to start"
    journalctl --user -u "$INSTANCE" -n 30 --no-pager >&2 || true
    exit 1
}

rm -rf /tmp/bazzar-src
echo "deployed to $APP_DIR: $(systemctl --user show "$INSTANCE" --property=ActiveState --value)"

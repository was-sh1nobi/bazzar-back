#!/usr/bin/env bash
set -euo pipefail

APP_NAME="bazzar"
APP_DIR="/var/www/bazzar"
SRC_DIR="/tmp/bazzar-src"

UNIT_DIR="$HOME/.config/systemd/user"
UNIT_FILE="$UNIT_DIR/${APP_NAME}.service"

echo "== [1/6] preparing application directory"

mkdir -p "$APP_DIR"
mkdir -p "$UNIT_DIR"

echo "== [2/6] preparing environment"

if [ ! -f "$APP_DIR/.env" ]; then
    if [ ! -f "$SRC_DIR/.env.example" ]; then
        echo "ERROR: .env.example not found"
        exit 1
    fi

    cp "$SRC_DIR/.env.example" "$APP_DIR/.env"

    echo "::warning:: No .env found."
    echo "::warning:: Copied .env.example to $APP_DIR/.env"
    echo "::warning:: You MUST configure production environment variables."
fi

echo "== [3/6] updating application"

# Preserve the existing .env.
cp -r "$SRC_DIR/." "$APP_DIR/"

# Restore .env if the uploaded source contains one.
# This should normally not happen, but protects the production env.
if [ -f "$SRC_DIR/.env.example" ] && [ ! -f "$APP_DIR/.env" ]; then
    cp "$SRC_DIR/.env.example" "$APP_DIR/.env"
fi

cd "$APP_DIR"

echo "== [4/6] configuring Bun"

export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"

if [ -x "$BUN_INSTALL/bin/bun" ]; then
    export PATH="$BUN_INSTALL/bin:$PATH"
fi

if ! command -v bun >/dev/null 2>&1; then
    echo "ERROR: Bun was not found."
    echo "BUN_INSTALL=$BUN_INSTALL"
    echo "PATH=$PATH"
    exit 1
fi

echo "Bun version: $(bun --version)"

echo "Installing dependencies..."

bun install --frozen-lockfile

echo "== [5/6] configuring systemd user service"

if [ ! -f "$SRC_DIR/deploy/bazzar.service" ]; then
    echo "ERROR: $SRC_DIR/deploy/bazzar.service not found"
    exit 1
fi

cp "$SRC_DIR/deploy/bazzar.service" "$UNIT_FILE"

# Make sure the user systemd manager survives SSH logout/reboot.
loginctl enable-linger "$(id -un)" >/dev/null 2>&1 || true

systemctl --user daemon-reload

systemctl --user enable "$APP_NAME.service"

echo "Restarting $APP_NAME.service..."

systemctl --user restart "$APP_NAME.service"

echo "== [6/6] verifying deployment"

if ! systemctl --user is-active --quiet "$APP_NAME.service"; then
    echo "ERROR: $APP_NAME.service failed to start."
    echo
    echo "---- systemd status ----"
    systemctl --user status "$APP_NAME.service" --no-pager || true
    echo
    echo "---- journal ----"
    journalctl --user \
        -u "$APP_NAME.service" \
        -n 50 \
        --no-pager || true

    exit 1
fi

echo
echo "========================================"
echo " Deployment successful"
echo "========================================"
echo "Application : $APP_NAME"
echo "Directory   : $APP_DIR"
echo "Service     : $APP_NAME.service"
echo "Status      : $(systemctl --user is-active "$APP_NAME.service")"
echo "Bun         : $(bun --version)"
echo "========================================"

rm -rf "$SRC_DIR"
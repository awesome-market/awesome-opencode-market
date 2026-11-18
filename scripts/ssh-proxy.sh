#!/bin/bash
# SSH SOCKS5 proxy with auto-reconnect.
#   scripts/ssh-proxy.sh [ip] [username] [port]
#
# ip / username / port are optional — ip and username not given on the
# command line are asked for interactively, one prompt at a time; port
# defaults to 1080. The password is ALWAYS
# asked interactively and lives only in this process's environment (the
# askpass helper on disk holds a variable reference, not the secret).
#

# Point the pipeline at it with:
#   export MARKET_PROXY=socks5://127.0.0.1:<port>
set -u
IP="${1:-}"
USER="${2:-}"
PORT="${3:-1080}"
[ -n "$IP" ] || read -rp "ssh ip: " IP
[ -n "$USER" ] || read -rp "ssh username: " USER
[ -n "$IP" ] && [ -n "$USER" ] || { echo "ip and username are required"; exit 1; }
SSH_HOST="$USER@$IP"

read -rsp "ssh password (memory only): " SSH_PASS; echo

# askpass helper: ssh reads the password from OUR env via this stub —
# the file itself contains no secret and is removed on exit.
ADIR=$(mktemp -d)
cat >"$ADIR/askpass.sh" <<'EOS'
#!/bin/sh
printf '%s\n' "$SSH_PASS"
EOS
chmod 700 "$ADIR/askpass.sh"
export SSH_ASKPASS="$ADIR/askpass.sh" SSH_ASKPASS_REQUIRE=force DISPLAY=none SSH_PASS

SSHPID=""
QUIT=0
cleanup() {
  [ -n "$SSHPID" ] && kill "$SSHPID" 2>/dev/null
  rm -rf "$ADIR"
}
on_signal() { QUIT=1; [ -n "$SSHPID" ] && kill "$SSHPID" 2>/dev/null; }
trap on_signal INT TERM   # INT must NOT run cleanup directly — the old trap
                          # killed ssh then let the supervise loop respawn it
trap cleanup EXIT

alive() { nc -z 127.0.0.1 "$PORT" 2>/dev/null; }

echo "starting socks5://127.0.0.1:$PORT — export MARKET_PROXY=socks5://127.0.0.1:$PORT"
while [ "$QUIT" = 0 ]; do
  ssh -N -D "127.0.0.1:$PORT" \
      -o ExitOnForwardFailure=yes \
      -o ServerAliveInterval=15 -o ServerAliveCountMax=2 \
      -o ConnectTimeout=10 \
      -o StrictHostKeyChecking=accept-new \
      -o NumberOfPasswordPrompts=1 \
      "$SSH_HOST" &
  SSHPID=$!
  for _ in $(seq 1 20); do alive && break; sleep 0.5; done
  if alive; then
    echo "[$(date +%H:%M:%S)] proxy UP → socks5://127.0.0.1:$PORT"
  fi
  wait "$SSHPID" 2>/dev/null
  [ "$QUIT" = 1 ] && break
  echo "[$(date +%H:%M:%S)] ssh exited — reconnecting in 3s…"
  sleep 3
done
echo "[$(date +%H:%M:%S)] bye"

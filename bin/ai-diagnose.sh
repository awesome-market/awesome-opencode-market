#!/bin/bash
# ai-diagnose 定时入口 — launchd 每小时调用。
# 流程:同步 catalog 分支 worktree → diagnose 写临时 verdict 文件 → 重放式推送。
# 推送循环每轮 fetch+reset 后重新 append 同一批 verdict——任何远端并发变更
# (catalog/verify/digest/人工 verdict)都不会丢本地裁决,也不会撞 append-only
# 文件尾冲突。失败=退出非零,launchd 日志可查;断网=静默下轮补跑。
set -uo pipefail

REPO=/Volumes/2t/code/opencode-market
CAT=$HOME/.local/share/opencode-market-catalog   # dedicated catalog-branch checkout
LOGD=$HOME/Library/Logs/opencode-market
STATEF=$HOME/.local/share/opencode-market/diagnose-attempts.json
mkdir -p "$LOGD" "$(dirname "$CAT")" "$(dirname "$STATEF")"

# single-instance guard — launchd stacks runs when a slow tick overruns the
# hour; two runners double-burn the LLM and rebase-race on push. mkdir is
# atomic on macOS (no flock shipped). Stale lock = run died; clear it manually.
LOCK=$HOME/.local/share/opencode-market/diagnose.lock
mkdir "$LOCK" 2>/dev/null || { echo "[diagnose] another run in progress — skipping"; exit 0; }
# release on EVERY exit — early exits (missing ai.env, offline fetch) must not
# leave a stale lock that skips every future tick
trap 'rm -f "${TMPV:-}"; rmdir "$LOCK" 2>/dev/null' EXIT

# launchd appends to fixed files forever — trim past 5MB, keep the tail
for f in "$LOGD/ai-diagnose.log" "$LOGD/ai-diagnose.err.log"; do
  [ -f "$f" ] && [ "$(stat -f%z "$f" 2>/dev/null || echo 0)" -gt 5242880 ] \
    && { tail -c 1048576 "$f" > "$f.t"; mv "$f.t" "$f"; }
done

cd "$REPO" || exit 1

ENVF=$HOME/.config/opencode-market/ai.env
[ -f "$ENVF" ] || { echo "[diagnose] $ENVF missing — no LLM config, nothing to run"; exit 1; }
set -a; . "$ENVF"; set +a
export HF_HOME=/Volumes/2t/huggingface_tmp
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# clone/push 只用远端 URL —— 本地路径 clone 的 origin 指向本地 repo,
# push 退出码 0 但远端永远收不到(假成功);worktree origin 漂移时自愈
URL="$(git -C "$REPO" remote get-url origin 2>/dev/null || true)"
if [ ! -d "$CAT/.git" ]; then
  [ -n "$URL" ] && git clone --single-branch --branch catalog "$URL" "$CAT" 2>/dev/null \
    || { echo "[diagnose] catalog branch not found — nothing to review"; exit 0; }
fi
[ -n "$URL" ] && [ "$(git -C "$CAT" remote get-url origin 2>/dev/null)" != "$URL" ] && git -C "$CAT" remote set-url origin "$URL"
cd "$CAT"
# 拿不到远端状态就不审:离线跑完 push 必败,verdict 只会被下一轮 reset 丢弃
git fetch origin catalog || { echo "[diagnose] fetch failed (offline?) — silent, retry next tick"; exit 0; }
# reset 失败必须退出——没有 -e,失败会拿陈旧 index 审一遍,产出错配 verdict
git reset --hard origin/catalog -q || { echo "[diagnose] reset failed — refusing to review stale state"; exit 1; }
touch ai-verdicts.jsonl

cd "$REPO"
# bounded per run — the queue drains over many hours, one launchd tick must not
# monopolise the LLM (3300 pending × ~1-2min each would run for days)
DIAGNOSE_LIMIT=${DIAGNOSE_LIMIT:-50}
DIAGNOSE_BUDGET=${DIAGNOSE_BUDGET:-45}   # minutes of LLM time per run
TMPV=$(mktemp -t ai-verdicts)

npx tsx pipeline/ai/diagnose.ts \
  --index "$CAT/index.json" --verdicts "$CAT/ai-verdicts.jsonl" --out "$TMPV" \
  --limit "$DIAGNOSE_LIMIT" --budget "$DIAGNOSE_BUDGET" --state "$STATEF" \
  ${DIAGNOSE_NAME:+--name "$DIAGNOSE_NAME"} ${DIAGNOSE_FORCE:+--force} \
  || exit $?

[ -s "$TMPV" ] || { echo "[diagnose] no new verdicts"; exit 0; }

# Replay push: verdicts live in $TMPV, not the worktree — a failed push just
# means re-append onto the newest origin/catalog next attempt.
cd "$CAT"
for i in 1 2 3 4; do
  git fetch origin catalog -q || { echo "[diagnose] fetch attempt $i failed"; sleep 3; continue; }
  git reset --hard origin/catalog -q || { echo "[diagnose] reset attempt $i failed"; sleep 3; continue; }
  touch ai-verdicts.jsonl
  # append only lines not already on the branch — a push that succeeded but
  # reported failure must not produce duplicate verdict lines next attempt
  comm -13 <(sort -u ai-verdicts.jsonl) <(sort -u "$TMPV") >> ai-verdicts.jsonl
  git add ai-verdicts.jsonl
  # staged diff empty = the exact lines are already on origin/catalog
  # (an earlier push succeeded but reported failure) — treat as landed
  git diff --cached --quiet && { echo "[diagnose] verdicts already on origin/catalog"; exit 0; }
  git commit -qm "ai-diagnose: $(date '+%F %H:%M')" \
    || { echo "[diagnose] commit attempt $i failed"; sleep 3; continue; }
  git push -q origin catalog && exit 0
  echo "[diagnose] push attempt $i failed"; sleep 3
done
echo "[diagnose] verdicts NOT pushed after retries — next run re-reviews them (wasteful but fail-closed)"
exit 1

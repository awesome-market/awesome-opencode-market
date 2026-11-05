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
SWEEPF=$HOME/.local/share/opencode-market/diagnose-sweep.stamp
# verdicts whose push never landed — replayed into the next run's payload and
# fed back as evidence so the same keys aren't re-reviewed at LLM cost
SPOOL=$HOME/.local/share/opencode-market/pending-verdicts.jsonl
mkdir -p "$LOGD" "$(dirname "$CAT")" "$(dirname "$STATEF")"

# single-instance guard — launchd stacks runs when a slow tick overruns the
# hour; two runners double-burn the LLM and rebase-race on push. mkdir is
# atomic on macOS (no flock shipped). A SIGKILL'd/wedged run leaves the dir —
# without an age check every future tick skips forever (D-11). Runs are
# bounded (~45min budget + sweep), so a lock older than 2h is reclaimed.
LOCK=$HOME/.local/share/opencode-market/diagnose.lock
if ! mkdir "$LOCK" 2>/dev/null; then
  AGE=$(( $(date +%s) - $(stat -f%m "$LOCK" 2>/dev/null || echo 0) ))
  if [ "$AGE" -gt 7200 ] && rmdir "$LOCK" 2>/dev/null && mkdir "$LOCK" 2>/dev/null; then
    echo "[diagnose] reclaimed stale lock (${AGE}s old)"
  else
    echo "[diagnose] another run in progress — skipping"; exit 0
  fi
fi
# release on EVERY exit — early exits (missing ai.env, offline fetch) must not
# leave a stale lock that skips every future tick
trap 'rm -f "${TMPV:-}" "${PAY:-}" "${VVIEW:-}"; rmdir "$LOCK" 2>/dev/null' EXIT

# launchd appends to fixed files forever — trim past 5MB, keep the tail
for f in "$LOGD/ai-diagnose.log" "$LOGD/ai-diagnose.err.log"; do
  [ -f "$f" ] && [ "$(stat -f%z "$f" 2>/dev/null || echo 0)" -gt 5242880 ] \
    && { tail -c 1048576 "$f" > "$f.t"; mv "$f.t" "$f"; }
done

cd "$REPO" || { echo "[diagnose] cannot cd $REPO — under launchd this is the macOS external-volume TCC block; run the script by hand or move the checkout to the system volume"; exit 1; }

ENVF=$HOME/.config/opencode-market/ai.env
[ -f "$ENVF" ] || { echo "[diagnose] $ENVF missing — no LLM config, nothing to run"; exit 1; }
# a malformed env file can kill sourcing mid-run — syntax-check first so the
# failure names the file instead of dying on a bare '.'
bash -n "$ENVF" 2>/dev/null || { echo "[diagnose] $ENVF has shell syntax errors — refusing to source it"; exit 1; }
set -a; . "$ENVF"; set +a
# HF_HOME only when the dir actually exists — pointing at a missing/external
# path makes the L0.5 model load fail silently inside the python subprocess
[ -d /Volumes/2t/huggingface_tmp ] && export HF_HOME=/Volumes/2t/huggingface_tmp
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
PAY=$(mktemp -t ai-payload)
VVIEW=$(mktemp -t verdicts-view)

# diagnose must see spooled (un-pushed) verdicts as already-decided — else a
# push that failed last run triggers a second LLM review of the same keys
sort -u "$CAT/ai-verdicts.jsonl" "$SPOOL" > "$VVIEW" 2>/dev/null \
  || cp "$CAT/ai-verdicts.jsonl" "$VVIEW"   # no spool yet → view = branch file

npx tsx pipeline/ai/diagnose.ts \
  --index "$CAT/index.json" --verdicts "$VVIEW" --out "$TMPV" \
  --limit "$DIAGNOSE_LIMIT" --budget "$DIAGNOSE_BUDGET" --state "$STATEF" \
  --sweep-state "$SWEEPF" \
  ${DIAGNOSE_NAME:+--name "$DIAGNOSE_NAME"} ${DIAGNOSE_FORCE:+--force} \
  || exit $?

# push payload = this run's verdicts ∪ unreplayed spool — an empty TMPV no
# longer short-circuits when the spool still has lines waiting to land
sort -u "$TMPV" "$SPOOL" > "$PAY" 2>/dev/null || cp "$TMPV" "$PAY"
[ -s "$PAY" ] || { echo "[diagnose] no new verdicts"; exit 0; }

# Replay push: verdicts live in $PAY, not the worktree — a failed push just
# means re-append onto the newest origin/catalog next attempt.
cd "$CAT"
for i in 1 2 3 4; do
  git fetch origin catalog -q || { echo "[diagnose] fetch attempt $i failed"; sleep 3; continue; }
  git reset --hard origin/catalog -q || { echo "[diagnose] reset attempt $i failed"; sleep 3; continue; }
  touch ai-verdicts.jsonl
  # append only lines not already on the branch — a push that succeeded but
  # reported failure must not produce duplicate verdict lines next attempt
  comm -13 <(sort -u ai-verdicts.jsonl) <(sort -u "$PAY") >> ai-verdicts.jsonl
  git add ai-verdicts.jsonl
  # staged diff empty = the exact lines are already on origin/catalog
  # (an earlier push succeeded but reported failure) — treat as landed
  git diff --cached --quiet && { echo "[diagnose] verdicts already on origin/catalog"; : > "$SPOOL"; exit 0; }
  git commit -qm "ai-diagnose: $(date '+%F %H:%M')" \
    || { echo "[diagnose] commit attempt $i failed"; sleep 3; continue; }
  git push -q origin catalog && { : > "$SPOOL"; exit 0; }
  echo "[diagnose] push attempt $i failed"; sleep 3
done
# push never landed — keep the payload for the next run instead of burning
# the LLM again; diagnose reads it via VVIEW so the keys stay decided
cp "$PAY" "$SPOOL"
echo "[diagnose] verdicts NOT pushed — spooled $(wc -l < "$SPOOL" | tr -d ' ') lines for next run's replay (fail-closed, no LLM waste)"
exit 1

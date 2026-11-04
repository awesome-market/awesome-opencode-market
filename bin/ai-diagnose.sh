#!/bin/bash
# ai-diagnose 定时入口 — launchd 每小时调用。
# 流程:同步 catalog 分支 worktree → diagnose → 追加 verdicts → 推送。
# 失败=退出非零，launchd 日志可查；catalog 推送失败重试 3 次。
set -uo pipefail

REPO=/Volumes/2t/code/opencode-market
CAT=$HOME/.local/share/opencode-market-catalog   # dedicated catalog-branch checkout
cd "$REPO" || exit 1
set -a; . "$HOME/.config/opencode-market/ai.env"; set +a
export HF_HOME=/Volumes/2t/huggingface_tmp
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

mkdir -p "$(dirname "$CAT")"
if [ ! -d "$CAT/.git" ]; then
  git clone --single-branch --branch catalog "$REPO" "$CAT" 2>/dev/null \
    || git clone --single-branch --branch catalog "$(git -C "$REPO" remote get-url origin)" "$CAT" \
    || { echo "[diagnose] catalog branch not found — nothing to review"; exit 0; }
fi
cd "$CAT" && git fetch origin catalog && git reset --hard origin/catalog -q
touch ai-verdicts.jsonl

cd "$REPO"
# bounded per run — the queue drains over many hours, one launchd tick must not
# monopolise the LLM (3300 pending × ~1-2min each would run for days)
DIAGNOSE_LIMIT=${DIAGNOSE_LIMIT:-50}
npx tsx pipeline/ai/diagnose.ts \
  --index "$CAT/index.json" --verdicts "$CAT/ai-verdicts.jsonl" --out "$CAT/ai-verdicts.jsonl" \
  --limit "$DIAGNOSE_LIMIT" ${DIAGNOSE_NAME:+--name "$DIAGNOSE_NAME"} \
  || exit $?

cd "$CAT"
git add ai-verdicts.jsonl
git commit -qm "ai-diagnose: $(date '+%F %H:%M')" 2>/dev/null || { echo "[diagnose] no new verdicts"; exit 0; }
for i in 1 2 3; do
  git pull --rebase -q origin catalog 2>/dev/null
  git push -q origin catalog && exit 0
  echo "[diagnose] push attempt $i failed"; sleep 3
done
exit 1

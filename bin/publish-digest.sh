#!/bin/bash
# publish-digest 定时入口 — launchd 每日 21:00 调用。
# 写 digest/YYYY-MM-DD.md + digest-state.json 到 catalog 分支并推送。
# digest-state 更新后，日报窗口内的 pass verdict 才成熟 → 下一次 catalog
# pipeline 运行时可放行。脚本顺序因此负载：先 digest 落地，pipeline 再消费。
set -uo pipefail

REPO=/Volumes/2t/code/opencode-market
CAT=$HOME/.local/share/opencode-market-catalog
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

mkdir -p "$(dirname "$CAT")"
if [ ! -d "$CAT/.git" ]; then
  git clone --single-branch --branch catalog "$REPO" "$CAT" 2>/dev/null \
    || git clone --single-branch --branch catalog "$(git -C "$REPO" remote get-url origin)" "$CAT" \
    || { echo "[digest] catalog branch not found"; exit 1; }
fi
cd "$CAT" && git fetch origin catalog && git reset --hard origin/catalog -q
touch ai-verdicts.jsonl

cd "$REPO"
npx tsx pipeline/ai/digest.ts \
  --index "$CAT/index.json" --verdicts "$CAT/ai-verdicts.jsonl" \
  --state "$CAT/digest-state.json" --out-dir "$CAT" || exit $?

cd "$CAT"
git add digest/ digest-state.json
git commit -qm "digest: $(date +%F)" 2>/dev/null || { echo "[digest] nothing changed"; exit 0; }
for i in 1 2 3; do
  git pull --rebase -q origin catalog 2>/dev/null
  git push -q origin catalog && exit 0
  echo "[digest] push attempt $i failed"; sleep 3
done
exit 1

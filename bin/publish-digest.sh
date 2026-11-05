#!/bin/bash
# publish-digest 定时入口(手动兜底) — 日常 digest 已搬到 Actions(digest.yml),
# 本脚本留作本机手动/launchd 兜底。
# 写 digest/YYYY-MM-DD.md + digest-state.json 到 catalog 分支并推送。
# digest-state 更新后,日报窗口内的 pass verdict 才成熟 → 下一次 catalog
# pipeline 运行时可放行。脚本顺序因此负载:先 digest 落地,pipeline 再消费。
#
# 运行环境约束(与 ai-diagnose.sh 同构):
# - 渲染代码跑在 $CODED —— 钉在 origin/main 的独立 checkout,不碰开发工作区。
# - $CATDG 是本脚本专属的 catalog checkout —— 绝不与 ai-diagnose 共享
#   worktree(两个 launchd 任务可以并发;共享 checkout 会 reset 掉对方的
#   staged 工作、把对方的 git add 裹进自己的 commit)。
# - 推送循环内重渲染:远端并发推进时 reset 后必须按新远端重新生成,不推陈旧产物。
# - MARKET_GIT_URL 优先于开发 checkout 的 origin(launchd TCC 可能读不到外置卷)。
set -uo pipefail

REPO=${MARKET_REPO:-/Volumes/2t/code/opencode-market}
CATDG=$HOME/.local/share/opencode-market-catalog-digest   # 本脚本专属的 catalog checkout
CODED=$HOME/.local/share/opencode-market-code-digest      # pinned origin/main code checkout
LOGD=$HOME/Library/Logs/opencode-market
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
mkdir -p "$LOGD" "$(dirname "$CATDG")"

log() { printf '%s [digest] %s\n' "$(date '+%F %T')" "$*"; }

# single-instance guard — 同 ai-diagnose:mkdir 原子锁 + 超时回收
LOCK=$HOME/.local/share/opencode-market/digest.lock
if ! mkdir "$LOCK" 2>/dev/null; then
  AGE=$(( $(date +%s) - $(stat -f%m "$LOCK" 2>/dev/null || echo 0) ))
  if [ "$AGE" -gt 7200 ] && rmdir "$LOCK" 2>/dev/null && mkdir "$LOCK" 2>/dev/null; then
    log "reclaimed stale lock (${AGE}s old)"
  else
    log "another run in progress — skipping"; exit 0
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

# ai.env 可选 —— digest 不烧 LLM;只为 MARKET_GIT_URL/MARKET_REPO_URL override。
# 语法坏不该挡兜底:警告后继续。
ENVF=$HOME/.config/opencode-market/ai.env
if [ -f "$ENVF" ]; then
  if bash -n "$ENVF" 2>/dev/null; then set -a; . "$ENVF"; set +a
  else log "$ENVF has shell syntax errors — ignoring env overrides"; fi
fi

# clone/push 只用远端 URL —— 绝不 clone 本地路径:本地 clone 的 origin 指向
# 本地 repo,push 退出码 0 但远端永远收不到(假成功,静默丢日报)
URL=${MARKET_GIT_URL:-$(git -C "$REPO" remote get-url origin 2>/dev/null || true)}
[ -n "$URL" ] || { log "no remote URL — set MARKET_GIT_URL in $ENVF (dev checkout $REPO unreadable?)"; exit 1; }
# digest rows link to per-item [review] issues — phone: tap link → tap a label
export MARKET_REPO_URL="${MARKET_REPO_URL:-$(printf '%s' "$URL" | sed -E 's#^git@([^:]+):#https://\1/#; s#\.git$##')}"

alert() {
  # best-effort: 本地兜底失败也要有 issue 面,不能只在 launchd 日志里烂掉
  command -v gh >/dev/null 2>&1 || return 0
  local slug
  slug=$(printf '%s' "$URL" | sed -nE 's#.*github\.com[:/]([^/]+/[^/]+?)(\.git)?$#\1#p')
  [ -n "$slug" ] || return 0
  gh label create pipeline-alert -R "$slug" --force >/dev/null 2>&1
  gh issue list -R "$slug" --label pipeline-alert --state open --search "publish-digest" --json number --jq '.[0].number' 2>/dev/null | grep -q . && return 0
  gh issue create -R "$slug" --label pipeline-alert \
    --title "publish-digest failed on $(hostname -s 2>/dev/null || echo local)" \
    --body "本机兜底 publish-digest 连续失败。查 launchd 日志 ~/Library/Logs/opencode-market/,以及 worktree remote 是否与 $URL 一致: git -C $CATDG remote -v" >/dev/null 2>&1
  return 0
}

# pinned code checkout — 钉 origin/main;lockfile 变化才 npm ci
if ! git -C "$CODED" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git clone --single-branch --branch main "$URL" "$CODED" \
    || { log "code checkout clone failed ($URL) — check auth/network"; exit 1; }
fi
git -C "$CODED" remote get-url origin >/dev/null 2>&1 || git -C "$CODED" remote add origin "$URL"
[ "$(git -C "$CODED" remote get-url origin)" = "$URL" ] || git -C "$CODED" remote set-url origin "$URL"
git -C "$CODED" fetch -q origin main || { log "code fetch failed (offline?) — silent, retry next tick"; exit 0; }
git -C "$CODED" reset -q --hard origin/main || { log "code checkout reset failed"; exit 1; }
LOCKHASH=$(shasum -a 256 "$CODED/package-lock.json" | cut -d' ' -f1)
if [ "$(cat "$CODED/.deps-stamp" 2>/dev/null)" != "$LOCKHASH" ]; then
  (cd "$CODED" && npm ci --no-audit --no-fund) >/dev/null \
    || { log "npm ci failed in $CODED — cannot run pinned pipeline"; exit 1; }
  echo "$LOCKHASH" > "$CODED/.deps-stamp"
fi

# 本脚本专属的 catalog checkout —— 与 ai-diagnose 的 $CAT 物理隔离;
# 失败分类与 ai-diagnose 同构(不可达→静默下轮;分支缺席→无事可做)
if ! git -C "$CATDG" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if ! git ls-remote --exit-code --heads "$URL" refs/heads/catalog >/dev/null 2>&1; then
    git ls-remote "$URL" >/dev/null 2>&1 \
      || { log "cannot reach remote $URL (auth/network) — silent, retry next tick"; exit 0; }
    log "catalog branch not found on remote — nothing to publish"; exit 0
  fi
  git clone --single-branch --branch catalog "$URL" "$CATDG" \
    || { log "catalog clone failed ($URL) — check auth/network/disk"; exit 1; }
fi
git -C "$CATDG" remote get-url origin >/dev/null 2>&1 || git -C "$CATDG" remote add origin "$URL"
[ "$(git -C "$CATDG" remote get-url origin)" = "$URL" ] || git -C "$CATDG" remote set-url origin "$URL"
# repo-local identity —— digest 提交固定 bot 名,watchdog/审计一眼可辨
git -C "$CATDG" config user.name "market-bot"
git -C "$CATDG" config user.email "market-bot@users.noreply.github.com"
cd "$CATDG" || exit 1

for i in 1 2 3 4; do
  # fetch+reset at the TOP of every iteration: a previous failed commit is
  # discarded and the digest re-renders against the freshest remote state
  git fetch origin catalog -q || { log "fetch attempt $i failed (offline?)"; sleep 3; continue; }
  # reset 失败必须重试——没有 -e,失败会继续拿陈旧状态渲染并推失真日报
  git reset --hard origin/catalog -q || { log "reset attempt $i failed"; sleep 3; continue; }
  # reset 不碰 untracked:上轮的残留渲染产物会混进 git add,先清掉
  git clean -fd digest/ >/dev/null 2>&1 || true
  (cd "$CODED" && npx tsx pipeline/ai/digest.ts \
    --index "$CATDG/index.json" --verdicts "$CATDG/ai-verdicts.jsonl" \
    --state "$CATDG/digest-state.json" --out-dir "$CATDG") || { log "render attempt $i failed"; sleep 3; continue; }
  git add digest/ digest-state.json
  git diff --cached --quiet && { log "nothing changed vs origin"; exit 0; }
  git commit -qm "digest: $(date +%F)" || { log "commit attempt $i failed"; sleep 3; continue; }
  git push -q origin catalog && exit 0
  log "push attempt $i failed — re-fetching remote head and re-rendering"; sleep 3
done
alert
exit 1

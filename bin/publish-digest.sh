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

# `stat -f` is BSD-only — GNU stat needs `-c` (same portability fix as
# ai-diagnose.sh: probe once, run under either userland)
if stat -f%m / >/dev/null 2>&1; then
  _mtime() { stat -f%m "$1" 2>/dev/null || echo 0; }
else
  _mtime() { stat -c %Y "$1" 2>/dev/null || echo 0; }
fi

REPO=${MARKET_REPO:-/Volumes/2t/code/opencode-market}
CATDG=$HOME/.local/share/opencode-market-catalog-digest   # 本脚本专属的 catalog checkout
CODED=$HOME/.local/share/opencode-market-code-digest      # pinned origin/main code checkout
LOGD=$HOME/Library/Logs/opencode-market
LOCK=$HOME/.local/share/opencode-market/digest.lock
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
# 锁父目录必须先建:mkdir 不带 -p 父级缺失会失败,而下方把"建锁失败"一律
# 当成"另一 run 在跑"静默 exit 0——ai-diagnose 先跑过的机器没这问题,
# 只跑本兜底的机器会永远 skip(假阴性,日报静默断供)
mkdir -p "$LOGD" "$(dirname "$CATDG")" "$(dirname "$LOCK")"

log() { printf '%s [digest] %s\n' "$(date '+%F %T')" "$*"; }

# single-instance guard — 同 ai-diagnose:mkdir 原子锁 + 超时回收。
# 回收必须原子:两次同时回收时,rmdir+mkdir 会让第二个回收者删掉第一个
# 刚建的新锁(双双放行)。mv 是原子操作——先改名者拿走旧锁,败者 mv 撞
# ENOENT 落入 skip 分支;新 mkdir 也复核——缝隙里挤进来的合法竞争者仍赢。
# 与 ai-diagnose 同款加固:锁里记 owner pid——age>2h 但 owner 还活着
# (比如 git push 卡在凭据提示)时绝不抢锁;否则旧主的迟到 EXIT trap 会
# rmdir 掉新主的锁,放进第三个并发 run 共享 $CATDG worktree。
# (LOCK 已在上方定义——mkdir -p 需要它的父目录先行存在)
if ! mkdir "$LOCK" 2>/dev/null; then
  AGE=$(( $(date +%s) - $(_mtime "$LOCK") ))
  OLD_PID=$(cat "$LOCK/pid" 2>/dev/null || true)
  OWNER_DEAD=0
  case $OLD_PID in
    '') OWNER_DEAD=1 ;;                          # pre-pid-era lock, or crash before the write
    *[!0-9]*) OWNER_DEAD=1 ;;                    # corrupt pid file — treat as dead
    *) kill -0 "$OLD_PID" 2>/dev/null || OWNER_DEAD=1 ;;
  esac
  RECLAIMED=0
  if [ "$AGE" -gt 7200 ] && [ "$OWNER_DEAD" = 1 ] \
     && mv "$LOCK" "$LOCK.stale.$$" 2>/dev/null && mkdir "$LOCK" 2>/dev/null; then
    RECLAIMED=1
    log "reclaimed stale lock (${AGE}s old${OLD_PID:+, owner pid $OLD_PID gone})"
  fi
  rm -rf "$LOCK.stale.$$" 2>/dev/null   # the dir now holds a pid file — rmdir can't
  [ "$RECLAIMED" = 1 ] || { log "another run in progress — skipping"; exit 0; }
fi
echo $$ > "$LOCK/pid" 2>/dev/null || true
# ownership-checked release: stale-reclaim 后 $LOCK 归新主——旧主的迟到
# 退出绝不能删掉它(否则第三个 run 与新主并发共用 $CATDG)
trap '[ "$(cat "$LOCK/pid" 2>/dev/null)" = "$$" ] && { rm -f "$LOCK/pid"; rmdir "$LOCK"; }' EXIT
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
  # in:title — 无此限定的 body 匹配会让无关 open issue 压住真告警(fail-quiet)
  local existing
  # `// empty` — '.[0].number' on an EMPTY list prints "null", and any grep/
  # non-empty check would mistake that for an existing issue → alert never
  # created (silent suppression)
  existing=$(gh issue list -R "$slug" --label pipeline-alert --state open --search "publish-digest in:title" --json number --jq '.[0].number // empty' 2>/dev/null | head -1)
  if [ -n "$existing" ]; then
    # 复发也留痕——连败 vs 一次失败,严重度不同
    gh issue comment "$existing" -R "$slug" --body "$(date '+%F %T') 再次失败——查 launchd 日志 ~/Library/Logs/opencode-market/" >/dev/null 2>&1
    return 0
  fi
  gh issue create -R "$slug" --label pipeline-alert \
    --title "publish-digest failed on $(hostname -s 2>/dev/null || echo local)" \
    --body "本机兜底 publish-digest 连续失败。查 launchd 日志 ~/Library/Logs/opencode-market/,以及 worktree remote 是否与 $URL 一致: git -C $CATDG remote -v" >/dev/null 2>&1
  return 0
}

# pinned code checkout — 钉 origin/main;lockfile 变化才 npm ci
if ! git -C "$CODED" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git clone --depth=1 --single-branch --branch main "$URL" "$CODED" \
    || { log "code checkout clone failed ($URL) — check auth/network"; exit 1; }
fi
git -C "$CODED" remote get-url origin >/dev/null 2>&1 || git -C "$CODED" remote add origin "$URL"
[ "$(git -C "$CODED" remote get-url origin)" = "$URL" ] || git -C "$CODED" remote set-url origin "$URL"
# 与 §4/§5 同款浅化:持久 checkout 无限积累历史;tip 即所需(渲染只看最新态)。
# forced refspec 在远端被改写时仍能更新跟踪引用。
git -C "$CODED" fetch -q --depth=1 origin '+refs/heads/main:refs/remotes/origin/main' || { log "code fetch failed (offline?) — silent, retry next tick"; exit 0; }
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
  git clone --depth=1 --single-branch --branch catalog "$URL" "$CATDG" \
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
  # --depth=1:渲染只看 tip(index.json 每提交 ~14MB,全史无界膨胀同 §4);
  # forced refspec 防远端重写楔死重试环。
  git fetch -q --depth=1 origin '+refs/heads/catalog:refs/remotes/origin/catalog' || { log "fetch attempt $i failed (offline?)"; sleep 3; continue; }
  # reset 失败必须重试——没有 -e,失败会继续拿陈旧状态渲染并推失真日报
  git reset --hard origin/catalog -q || { log "reset attempt $i failed"; sleep 3; continue; }
  # reset 不碰 untracked:上轮的残留渲染产物会混进 git add,先清掉
  git clean -fd digest/ >/dev/null 2>&1 || true
  # 与 digest.yml 班内同款压实:丢超 180d 被取代的 AI 行(human/最新/窗内全保留,
  # 语义不变)。兜底路径漏了它,长期只走本机时 jsonl 无界增长且压实改动不落库。
  # 失败非致命——日志变大而已,不挡渲染。渲染代码在 $CODED(catalog 分支无源码)。
  (cd "$CODED" && npx tsx pipeline/verdicts-compact.ts "$CATDG/ai-verdicts.jsonl") \
    || log "verdicts compact failed (non-fatal) — rendering on the un-compacted log"
  (cd "$CODED" && npx tsx pipeline/ai/digest.ts \
    --index "$CATDG/index.json" --verdicts "$CATDG/ai-verdicts.jsonl" \
    --state "$CATDG/digest-state.json" --out-dir "$CATDG") || { log "render attempt $i failed"; sleep 3; continue; }
  # add 必须进重试环:失败会部分暂存(ignored 路径 exit 1 但其余照收)或全丢,
  # 放行后 diff --cached 会把"只提交了 state 没提交日报"误判成正常 commit——
  # 成熟锚推进而公告面缺失,异议窗形同虚设还全程绿(C-2/V-S 同类)
  git add digest/ digest-state.json || { log "add attempt $i failed"; sleep 3; continue; }
  # 压实可能改写了 jsonl——存在才暂存(与 CI 同条件);压实本身非致命,
  # 这一格 add 失败也只丢本班压实,不挡日报
  [ -f "$CATDG/ai-verdicts.jsonl" ] && git add ai-verdicts.jsonl || true
  git diff --cached --quiet && { log "nothing changed vs origin"; exit 0; }
  git commit -qm "digest: $(date +%F)" || { log "commit attempt $i failed"; sleep 3; continue; }
  git push -q origin catalog && exit 0
  log "push attempt $i failed — re-fetching remote head and re-rendering"; sleep 3
done
alert
exit 1

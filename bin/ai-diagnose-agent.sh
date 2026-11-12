#!/bin/bash
# ai-diagnose 常驻守护循环 —— 前台进程，给任意 supervisor（launchd/第三方保活）
# 提供"一个永远不主动退出的进程"。结构：
#
#   while :; do 刷新脚本副本 → 跑一轮 diagnose → 按结果睡 TICK/RETRY → 再来
#
# 为什么循环在 shim 而不是 ai-diagnose.sh 里：守护的入口文件自己不能包含
# 循环 —— bash 惰性读脚本，运行中的文件被下一轮 cp/git reset 替换会读到
# 乱码。shim 是装在系统卷的稳定外壳（安装时拷一次），它每轮刷新并 exec 的
# $DST 才是可变的业务脚本。刷新源按优先级：
#   1. $REPO  —— 开发 checkout；终端上下文可读时拿到未提交的 wrapper 改动
#   2. $CODE  —— 钉 origin/main 的 pinned checkout，系统卷永远可读；由被运行
#               的脚本自己 git reset 同步，wrapper 版本最坏落后一轮 tick
#   3. 缓存   —— 两个源都读不到时跑上一份缓存副本（MARKET_GIT_URL +
#               $CODE/$CAT 都在系统卷，诊断本身不依赖开发 checkout）
# 退出码约定（supervisor 据此选睡眠）：
#   ai-diagnose.sh exit 0  = 本轮无 actionable 工作（含成功/暂停/空队列）
#   非零                  = 失败（含瞬时网络）→ RETRY 间隔后自动重试
# 信号：TERM/INT 转发给当前子进程（轮次或 sleep）后退出，保活程序可干净重启。
set -u

DIR=$HOME/.local/share/opencode-market/bin
DST=$DIR/ai-diagnose.sh
mkdir -p "$DIR"

TICK=${DIAGNOSE_TICK:-3600}     # 正常节拍（对齐原 launchd 每小时设计）
RETRY=${DIAGNOSE_RETRY:-300}    # 失败重试间隔

# MARKET_GIT_PROXY：给本机所有 git 子进程统一覆盖代理 —— ~/.gitconfig 里的
# LAN 代理在 launchd/守护上下文可能不可达，环境注入配置优先级高于文件配置，
# 由 supervisor（plist EnvironmentVariables 或第三方保活环境）按机器配置。
if [ -n "${MARKET_GIT_PROXY:-}" ]; then
  export GIT_CONFIG_COUNT=1
  export GIT_CONFIG_KEY_0=http.proxy GIT_CONFIG_VALUE_0=$MARKET_GIT_PROXY
fi

log() { printf '%s [agent] %s\n' "$(date '+%F %T')" "$*"; }

CHILD=
shutdown() {
  [ -n "$CHILD" ] && kill -"$1" "$CHILD" 2>/dev/null
  exit "$2"
}
trap 'shutdown TERM 143' TERM
trap 'shutdown INT 130' INT

while :; do
  for SRC in "${MARKET_REPO:-/Volumes/2t/code/opencode-market}/bin/ai-diagnose.sh" \
             "$HOME/.local/share/opencode-market-code/bin/ai-diagnose.sh"; do
    cp "$SRC" "$DST" 2>/dev/null && break
  done
  if [ ! -f "$DST" ]; then
    log "no ai-diagnose.sh — repo/code/cache all unreadable; retry in ${RETRY}s"
    sleep "$RETRY" & CHILD=$!
    wait "$CHILD"; CHILD=
    continue
  fi

  bash "$DST" & CHILD=$!
  wait "$CHILD"; rc=$?; CHILD=
  if [ "$rc" -eq 0 ]; then S=$TICK; else S=$RETRY; fi
  log "sweep finished (rc=$rc) — next in ${S}s"

  sleep "$S" & CHILD=$!   # 后台 sleep + wait —— 信号可中断，不用等满整段
  wait "$CHILD"; CHILD=
done

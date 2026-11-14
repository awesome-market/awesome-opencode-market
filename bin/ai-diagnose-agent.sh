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

# agent 旋钮也从 ai.env 读 —— 那是 worker 自己的诊断配置文件，TICK/RETRY
# 只是搭车；文件缺失或语法错不致命（worker 启动时会做硬校验）。
ENVF=$HOME/.config/opencode-market/ai.env
[ -f "$ENVF" ] && bash -n "$ENVF" 2>/dev/null && { set -a; . "$ENVF"; set +a; }

# 用法: ai-diagnose-agent.sh [devin] —— devin 参数把 judge 切到 devin -p
# 单次会话后端（export AI_BACKEND 透传给 worker，ai.env 里没有该变量时
# 继承值生效）；不传参走 ai.env/环境里的默认（本地 ornith）。参数优先于
# ai.env 同名变量。
case ${1:-} in
  ''|--) ;;
  devin|--devin) export AI_BACKEND=devin ;;
  *) echo "usage: $0 [devin]" >&2; exit 2 ;;
esac

TICK=${DIAGNOSE_TICK:-1800}     # 正常节拍：30min——对齐 hourly catalog + 事件驱动 verify 后的判词时延目标
RETRY=${DIAGNOSE_RETRY:-300}    # 失败重试间隔

# MARKET_GIT_PROXY：给本机所有 git 子进程统一覆盖代理 —— ~/.gitconfig 里的
# LAN 代理在 launchd/守护上下文可能不可达，环境注入配置优先级高于文件配置，
# 由 supervisor（plist EnvironmentVariables 或第三方保活环境）按机器配置。
if [ -n "${MARKET_GIT_PROXY:-}" ]; then
  export GIT_CONFIG_COUNT=1
  export GIT_CONFIG_KEY_0=http.proxy GIT_CONFIG_VALUE_0=$MARKET_GIT_PROXY
fi

# 与 ai-diagnose.sh 同源的仓库解析：在哪个仓的外壳就盯哪个仓 —
# 刷新源和 worker 的 MARKET_REPO 都由它定（worker 跑的是 $DST 状态目录副本，
# 自己的 rev-parse 会落空，靠这里 export）。作为安装副本（$DIR）运行时
# rev-parse 落空 → 旧默认 fork，行为与之前一致。
SELF_REPO=$(git -C "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd -P)" rev-parse --show-toplevel 2>/dev/null || true)
export MARKET_REPO=${MARKET_REPO:-${SELF_REPO:-/Volumes/2t/code/opencode-market}}

log() { printf '%s [agent] %s\n' "$(date '+[%Y-%m-%d %H:%M:%S]')" "$*"; }
log "judge backend: ${AI_BACKEND:-omlx (local ornith)}"

# 每行最左补 [yyyy-mm-dd HH:mm:ss] 本地时区戳 —— worker 的 log() 已自带
# 该格式（透传不双标），diagnose.ts 的 '[diagnose] …' 控制台行和杂项输出
# （npm 警告/tsx 错误）在这里补齐。bash 3.2 无 %(...)T，date 每行一次 fork
# 对日志量级无所谓。
stamp() {
  local l
  while IFS= read -r l; do
    case $l in
      \[?[0-9]*) printf '%s\n' "$l" ;;
      *) printf '%s %s\n' "$(date '+[%Y-%m-%d %H:%M:%S]')" "$l" ;;
    esac
  done
}

CHILD=
KEYPID=
shutdown() {
  [ -n "$KEYPID" ] && kill "$KEYPID" 2>/dev/null
  [ -n "$CHILD" ] && kill -"$1" "$CHILD" 2>/dev/null
  [ -t 0 ] && stty sane </dev/tty 2>/dev/null
  exit "$2"
}
trap 'shutdown TERM 143' TERM
trap 'shutdown INT 130' INT

# 键盘热键（仅前台 TTY 启用；launchd 无 tty 自动跳过——headless 无回归）：
#   p / 空格 = pause —— 调 $0 pause 翻 catalog:diagnose.paused；正在跑的
#     sweep 逐条循环检测到该文件即在本条边界提前收队（已写判词照常推送）
#   r / c    = resume —— 移除 flag，队列继续
#   q        = 退出守护（TERM 走正常信号链，当前子进程一并收）
# 后台读键子进程直接调 pause|resume——不等主循环醒来，按键即时生效。git
# 操作数秒，JOB 去抖防连打堆叠；每个按键都回显，用户有响应。
KEYJOB=
keyctl() {
  [ -n "$KEYJOB" ] && kill -0 "$KEYJOB" 2>/dev/null && { log "hotkey $1 ignored — flip still running"; return; }
  bash "$DST" "$1" 'hotkey' > >(stamp) 2>&1 &
  KEYJOB=$!
  log "hotkey → $1 (pid $KEYJOB)"
  # resume 时守护若正睡在间隔段，杀父进程名下直系 sleep 让下一轮立即开跑
  # （flag 已翻，醒来那轮自然继续）。读键循环在子 shell 里，看不到父的
  # PHASE/CHILD 变量——但 $$ 在子 shell 仍指父 pid，pkill -P 命中当前
  # sleep 子进程；work 段 worker 是 bash 不匹配，天然空操作，无需相位。
  [ "$1" = resume ] && pkill -P $$ -x sleep 2>/dev/null
  return 0
}
if [ -t 0 ]; then
  log "hotkeys: p/space=pause  r/c=resume  q=quit"
  (
    stty -echo -icanon min 1 time 0 </dev/tty 2>/dev/null
    trap 'stty sane </dev/tty 2>/dev/null' EXIT
    while IFS= read -rsn1 k; do
      case $k in
        p|P|' ') keyctl pause ;;
        r|R|c|C) keyctl resume ;;
        q|Q) log "hotkey → quit"; kill -TERM $$ 2>/dev/null ;;
      esac
    done </dev/tty
  ) &
  KEYPID=$!
fi

while :; do
  for SRC in "$MARKET_REPO/bin/ai-diagnose.sh" \
             "$HOME/.local/share/opencode-market-code/bin/ai-diagnose.sh"; do
    cp "$SRC" "$DST" 2>/dev/null && break
  done
  if [ ! -f "$DST" ]; then
    log "no ai-diagnose.sh — repo/code/cache all unreadable; retry in ${RETRY}s"
    sleep "$RETRY" & CHILD=$!
    wait "$CHILD"; CHILD=
    continue
  fi

  # >(stamp) 进程替换保留直接子进程关系 —— $! 仍是 worker，rc/信号转发不变
  bash "$DST" > >(stamp) 2> >(stamp >&2) & CHILD=$!
  wait "$CHILD"; rc=$?; CHILD=
  if [ "$rc" -eq 0 ]; then S=$TICK; else S=$RETRY; fi
  log "sweep finished (rc=$rc) — next in ${S}s"

  sleep "$S" & CHILD=$!   # 后台 sleep + wait —— 信号可中断，不用等满整段
  wait "$CHILD"; CHILD=
done

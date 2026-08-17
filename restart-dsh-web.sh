#!/usr/bin/env bash
# =============================================================================
# 通用 dsh web 重启脚本 —— 不硬编码端口 / host / profile，任何服务器都能用
#
# 行为：优先走 systemd（dsh-web.service 存在时），否则自动发现正在运行的
#       dsh web 进程，读取其原始启动参数（命令行）与工作目录，用相同参数
#       脱离终端重启（nohup）。找不到进程时用 dsh web 启动。
#
# 用法:
#   bash restart-dsh-web.sh           自动发现并重启唯一一个 dsh web
#   bash restart-dsh-web.sh -p <PID>  指定进程 PID
#   bash restart-dsh-web.sh -n        只打印将执行的命令，不真正重启
#   bash restart-dsh-web.sh -l <文件> 指定日志文件（默认 /tmp/dsh-web.log）
#   环境变量 DSH_WEB_LOG 亦可覆盖日志路径
# =============================================================================
set -u

LOG="${DSH_WEB_LOG:-/tmp/dsh-web.log}"
DRY=0
TARGET_PID=""

usage() {
  echo "用法: bash restart-dsh-web.sh [-p PID] [-n] [-l LOG]"
  echo ""
  echo "  -p, --pid PID    指定要重启的 dsh web 进程 PID"
  echo "  -n, --dry-run    只打印将执行的命令，不真正重启"
  echo "  -l, --log FILE   日志文件路径（默认 /tmp/dsh-web.log，可用 DSH_WEB_LOG 覆盖）"
  echo "  -h, --help       显示本帮助"
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    -n|--dry-run) DRY=1; shift ;;
    -p|--pid) TARGET_PID="$2"; shift 2 ;;
    -l|--log) LOG="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

# ---- 0) systemd 优先：dsh-web.service 存在且活跃时走 systemctl ----
#  干净、单实例；避免 kill 裸进程后与 systemd 的 Restart=always 抢拉起。
if [ -z "$TARGET_PID" ] && command -v systemctl >/dev/null 2>&1 \
  && systemctl list-unit-files 2>/dev/null | grep -q '^dsh-web.service'; then
  if [ "$DRY" -eq 1 ]; then
    echo "[systemd] 将执行: systemctl restart dsh-web.service"
    exit 0
  fi
  echo "[systemd] 重启 dsh-web.service ..."
  systemctl restart dsh-web.service || { echo "[错误] systemctl restart 失败" >&2; exit 1; }
  # 轮询等待激活（DSH web 冷启动可能超过 3 秒）
  WAIT=0
  while [ "$WAIT" -lt 30 ]; do
    if systemctl is-active dsh-web.service >/dev/null 2>&1; then
      echo "[systemd] dsh-web.service 运行中 ✓（等待 ${WAIT}s）"
      exit 0
    fi
    sleep 1
    WAIT=$((WAIT + 1))
  done
  echo "[警告] dsh-web.service 重启后 30 秒内未激活，诊断信息如下:" >&2
  echo "  --- systemctl status ---" >&2
  systemctl status dsh-web.service --no-pager -l 2>&1 | head -20 >&2 || true
  echo "  --- 最近日志 (journalctl -u dsh-web.service -n 30) ---" >&2
  journalctl -u dsh-web.service -n 30 --no-pager 2>&1 | tail -30 >&2 || true
  exit 1
fi

# ---- 发现运行中的 dsh web 进程（命令行含 dsh 且含独立令牌 web）----
candidates=""
for d in /proc/[0-9]*; do
  p="${d#/proc/}"
  cmd="$(xargs -0 < "$d/cmdline" 2>/dev/null)"
  [ -n "$cmd" ] || continue
  case "$cmd" in
    *dsh*) ;;
    *) continue ;;
  esac
  case " $cmd " in
    *" web "*) candidates="$candidates $p" ;;
  esac
done

# ---- 选择目标 PID ----
if [ -n "$TARGET_PID" ]; then
  PID="$TARGET_PID"
elif [ -z "$candidates" ]; then
  PID=""
  echo "[提示] 未发现运行中的 dsh web，将直接以 dsh web 启动。"
else
  set -- $candidates
  if [ $# -gt 1 ]; then
    echo "[错误] 发现多个 dsh web 进程，请用 -p 指定其一:" >&2
    for p in $candidates; do
      echo "  PID $p  ->  $(xargs -0 < /proc/$p/cmdline 2>/dev/null)" >&2
    done
    exit 1
  fi
  PID="$1"
fi

# ---- 提取原始参数与工作目录 ----
if [ -n "$PID" ]; then
  CWD="$(readlink "/proc/$PID/cwd" 2>/dev/null)"
  [ -n "$CWD" ] || CWD="$(pwd)"
  args=()
  readarray -d "" -t args < "/proc/$PID/cmdline" 2>/dev/null
  if [ ${#args[@]} -eq 0 ]; then
    echo "[警告] 无法读取 PID=$PID 的命令行（进程可能已退出），改用 dsh web 启动。" >&2
    args=(dsh web)
  fi
  echo "[发现] dsh web 进程 PID=$PID"
  echo "  工作目录: $CWD"
  echo "  命令: ${args[*]}"
else
  CWD="$(pwd)"
  args=(dsh web)
fi

# ---- 停止旧进程 ----
if [ -n "$PID" ] && [ "$DRY" -eq 0 ]; then
  echo "==> 停止旧进程 PID=$PID ..."
  kill "$PID" 2>/dev/null
  i=0
  while kill -0 "$PID" 2>/dev/null && [ $i -lt 20 ]; do
    sleep 0.5
    i=$((i+1))
  done
  if kill -0 "$PID" 2>/dev/null; then
    echo "  旧进程未退出，强制结束..."
    kill -9 "$PID" 2>/dev/null
    sleep 1
  fi
fi

# ---- 启动新进程 ----
echo "==> 启动 dsh web ..."
echo "  日志: $LOG"
if [ "$DRY" -eq 0 ]; then
  (
    cd "$CWD" || exit 1
    nohup "${args[@]}" > "$LOG" 2>&1 &
    echo $! > /tmp/dsh-web.pid
  )
  NEW_PID="$(cat /tmp/dsh-web.pid 2>/dev/null)"
  echo "  新进程 PID: $NEW_PID"
  sleep 3
  if [ -n "$NEW_PID" ] && kill -0 "$NEW_PID" 2>/dev/null; then
    echo "==> 新进程存活，最近日志:"
  else
    echo "==> [警告] 新进程可能已退出，最近日志:"
  fi
  tail -20 "$LOG" 2>/dev/null
else
  echo "  [dry-run] 将执行: cd $CWD && nohup ${args[*]} > $LOG 2>&1 &"
fi

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
  # 端口预检：重启前先确认 12608 没有被非 systemd 托管的进程占用
  # （旧的手动 dsh web / nohup 残留会抢端口，导致新进程 EADDRINUSE 崩溃）。
  PORT_CHECK="12608"
  SERVICE_CMD="$(systemctl show dsh-web.service -p ExecStart --value 2>/dev/null)"
  PORT_CHECK="$(echo "$SERVICE_CMD" | sed -n 's/.*--port[= ]\([0-9]*\).*/\1/p' | head -1)"
  [ -n "$PORT_CHECK" ] || PORT_CHECK="12608"
  PORT_OWNER="$(ss -ltnp 2>/dev/null | grep ":$PORT_CHECK " | grep -v "pid=$(systemctl show dsh-web.service -p MainPID --value 2>/dev/null)" | head -3 || true)"
  if [ -n "$PORT_OWNER" ]; then
    echo "[警告] 端口 ${PORT_CHECK} 已被其他进程占用（非当前 systemd 服务）:" >&2
    echo "$PORT_OWNER" >&2
    echo "  这会导致重启后 dsh web 因 EADDRINUSE 崩溃。" >&2
    echo "  处置: 确认该进程是残留的旧 dsh web 后，先停止它再重启，例如:" >&2
    echo "    kill <占用进程 PID>" >&2
    echo "  （若不确定占用者，先执行: ss -ltnp | grep :${PORT_CHECK} 查看）" >&2
    echo "  继续尝试重启 ..." >&2
  fi
  echo "[systemd] 重启 dsh-web.service ..."
  systemctl restart dsh-web.service || { echo "[错误] systemctl restart 失败" >&2; exit 1; }
  # 轮询等待激活（DSH web 冷启动可能超过 3 秒）
  WAIT=0
  while [ "$WAIT" -lt 30 ]; do
    if systemctl is-active dsh-web.service >/dev/null 2>&1; then
      break
    fi
    sleep 1
    WAIT=$((WAIT + 1))
  done
  if ! systemctl is-active dsh-web.service >/dev/null 2>&1; then
    echo "[警告] dsh-web.service 重启后 30 秒内未激活，诊断信息如下:" >&2
    echo "  --- systemctl status ---" >&2
    systemctl status dsh-web.service --no-pager -l 2>&1 | head -20 >&2 || true
    echo "  --- 最近日志 (journalctl -u dsh-web.service -n 30) ---" >&2
    journalctl -u dsh-web.service -n 30 --no-pager 2>&1 | tail -30 >&2 || true
    exit 1
  fi
  echo "[systemd] dsh-web.service 运行中 ✓（等待 ${WAIT}s）"
  # 端口 + HTTP 健康检查：is-active 只代表进程存在；再确认页面真正可访问。
  # 从服务的启动参数中提取 --port（无则回退到 12608 探测）。
  PORT="12608"
  MAIN_PID="$(systemctl show dsh-web.service -p MainPID --value 2>/dev/null)"
  if [ -n "$MAIN_PID" ] && [ -f "/proc/$MAIN_PID/cmdline" ]; then
    CMDLINE="$(tr '\0' ' ' < "/proc/$MAIN_PID/cmdline" 2>/dev/null)"
    PORT="$(echo "$CMDLINE" | sed -n 's/.*--port[= ]\([0-9]*\).*/\1/p' | head -1)"
    [ -n "$PORT" ] || PORT="12608"
  fi
  echo "  --- HTTP 健康检查: http://127.0.0.1:${PORT} ---"
  CODE=""
  if command -v curl >/dev/null 2>&1; then
    CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "http://127.0.0.1:${PORT}/" 2>/dev/null || true)"
  elif command -v wget >/dev/null 2>&1; then
    CODE="$(wget -q -O /dev/null --timeout=15 "http://127.0.0.1:${PORT}/" 2>/dev/null && echo 200 || true)"
  fi
  if [ -n "$CODE" ] && [ "$CODE" != "000" ]; then
    echo "  HTTP ${CODE} ✓ — dsh web 已就绪，刷新浏览器即可看到插件"
  else
    echo "  [警告] 进程已运行但页面探测未返回 HTTP 200。" >&2
    echo "  最常见原因: 端口被其他进程占用（EADDRINUSE），占用情况:" >&2
    ss -ltnp 2>/dev/null | grep ":$PORT " | head -5 >&2 || true
    echo "  若确有占用，先 kill 占用进程再重跑本脚本；或确认服务真实监听端口: ss -ltnp | grep node" >&2
  fi
  exit 0
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

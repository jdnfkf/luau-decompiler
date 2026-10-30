#!/usr/bin/env bash
#=============================================================
#  luau-api.sh - 启动 Luau 反编译 HTTP API
#
#  用法:
#     ./luau-api.sh                    听 127.0.0.1:8787 (只本机, 最安全)
#     ./luau-api.sh --port 9000
#     ./luau-api.sh --host 0.0.0.0     允许局域网访问
#
#  需要先把本脚本和 luau_api_server.py 放到 lunaux-offline/ 目录里:
#     cp luau-api.sh luau_api_server.py "/storage/emulated/0/1/LunaUX反编译工具-1/lunaux-offline/"
#
#  后台常驻:
#     nohup ./luau-api.sh > /dev/null 2>&1 &
#=============================================================

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

# 找启动器: 优先同目录, 再找 lunaux-offline/ 子目录
if [ -x "$HERE/luna" ]; then
  LAUNCHER="$HERE/luna"
elif [ -x "$HERE/lunaux-offline/luna" ]; then
  LAUNCHER="$HERE/lunaux-offline/luna"
elif [ -x "$HOME/lunaux-offline/luna" ]; then
  LAUNCHER="$HOME/lunaux-offline/luna"
else
  echo "[错误] 找不到 luna 启动器" >&2
  echo "       把本脚本放进 lunaux-offline/ 目录, 或先跑 install-offline.sh" >&2
  exit 1
fi

exec "$LAUNCHER" "$HERE/luau_api_server.py" "$@"

#!/bin/bash

echo "🚀 启动 HTX 监控系统..."
echo ""

# 启动 Web 配置界面
echo "📱 启动 Web 配置界面..."
node web-server.js &
WEB_PID=$!

# 等待 2 秒让 Web 服务器启动
sleep 2

# 启动监控程序
echo "📊 启动监控程序..."
node realtime-pnl.js &
MONITOR_PID=$!

echo ""
echo "✅ 系统已启动"
echo ""
echo "📱 Web 配置界面: http://localhost:3000"
echo "📊 监控程序 PID: $MONITOR_PID"
echo "🌐 Web 服务器 PID: $WEB_PID"
echo ""
echo "💡 按 Ctrl+C 停止所有服务"
echo ""

# 捕获退出信号
trap "echo ''; echo '👋 正在停止服务...'; kill $WEB_PID $MONITOR_PID 2>/dev/null; exit 0" SIGINT SIGTERM

# 等待进程
wait

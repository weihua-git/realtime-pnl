#!/bin/bash

# API 端点测试脚本
# 使用方法: bash test-api.sh
# 注意: 需要先启动 web-server.js

echo "🌐 开始 API 端点测试..."
echo ""

# 配置
API_BASE="http://localhost:3000"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASSED=0
FAILED=0

test_pass() {
    echo -e "${GREEN}✅ PASS${NC}: $1"
    ((PASSED++))
}

test_fail() {
    echo -e "${RED}❌ FAIL${NC}: $1"
    ((FAILED++))
}

test_section() {
    echo ""
    echo -e "${YELLOW}========================================${NC}"
    echo -e "${YELLOW}  $1${NC}"
    echo -e "${YELLOW}========================================${NC}"
}

# 检查服务器是否运行
test_section "检查服务器状态"

if curl -s "$API_BASE" > /dev/null 2>&1; then
    test_pass "Web 服务器运行正常"
else
    test_fail "Web 服务器未运行（请先启动: node web-server.js）"
    exit 1
fi

# ==================== 测试配置 API ====================
test_section "测试配置 API"

# GET /api/config
echo "测试: GET /api/config"
RESPONSE=$(curl -s "$API_BASE/api/config")
if echo "$RESPONSE" | grep -q "watchContracts"; then
    test_pass "GET /api/config - 返回配置数据"
else
    test_fail "GET /api/config - 响应格式错误"
fi

# POST /api/config
echo "测试: POST /api/config"
TEST_CONFIG='{"watchContracts":["BTC-USDT"],"priceTargets":{"enabled":true,"targets":[]}}'
RESPONSE=$(curl -s -X POST "$API_BASE/api/config" \
    -H "Content-Type: application/json" \
    -d "$TEST_CONFIG")
if echo "$RESPONSE" | grep -q "success"; then
    test_pass "POST /api/config - 保存配置成功"
else
    test_fail "POST /api/config - 保存配置失败"
fi

# ==================== 测试市场分析 API ====================
test_section "测试市场分析 API"

# GET /api/analysis/:symbol
echo "测试: GET /api/analysis/BTC-USDT"
RESPONSE=$(curl -s "$API_BASE/api/analysis/BTC-USDT")
if echo "$RESPONSE" | grep -q "suggestion"; then
    test_pass "GET /api/analysis/:symbol - 返回分析数据"
else
    test_fail "GET /api/analysis/:symbol - 响应格式错误"
fi

# ==================== 测试量化交易 API ====================
test_section "测试量化交易 API"

# GET /api/quant/history
echo "测试: GET /api/quant/history"
RESPONSE=$(curl -s "$API_BASE/api/quant/history?symbol=BTC-USDT&mode=test")
if echo "$RESPONSE" | grep -q "success"; then
    test_pass "GET /api/quant/history - 返回历史订单"
else
    test_fail "GET /api/quant/history - 响应格式错误"
fi

# POST /api/quant/reset (仅测试模式)
echo "测试: POST /api/quant/reset"
RESPONSE=$(curl -s -X POST "$API_BASE/api/quant/reset" \
    -H "Content-Type: application/json" \
    -d '{"symbol":"BTC-USDT"}')
if echo "$RESPONSE" | grep -q "success"; then
    test_pass "POST /api/quant/reset - 重置成功"
else
    test_fail "POST /api/quant/reset - 重置失败"
fi

# POST /api/quant/stop
echo "测试: POST /api/quant/stop"
RESPONSE=$(curl -s -X POST "$API_BASE/api/quant/stop" \
    -H "Content-Type: application/json")
if echo "$RESPONSE" | grep -q "success\|message"; then
    test_pass "POST /api/quant/stop - API 响应正常"
else
    test_fail "POST /api/quant/stop - API 响应异常"
fi

# ==================== 测试 WebSocket ====================
test_section "测试 WebSocket 连接"

# 使用 wscat 测试（如果安装了）
if command -v wscat &> /dev/null; then
    echo "测试: WebSocket 连接"
    timeout 3 wscat -c "ws://localhost:3000" > /dev/null 2>&1
    if [ $? -eq 124 ]; then
        test_pass "WebSocket - 连接成功"
    else
        test_fail "WebSocket - 连接失败"
    fi
else
    echo -e "${BLUE}ℹ️  INFO${NC}: wscat 未安装，跳过 WebSocket 测试"
    echo "  安装: npm install -g wscat"
fi

# ==================== 测试总结 ====================
test_section "测试总结"

TOTAL=$((PASSED + FAILED))
PASS_RATE=$(awk "BEGIN {printf \"%.2f\", ($PASSED/$TOTAL)*100}")

echo ""
echo -e "${BLUE}总测试数: $TOTAL${NC}"
echo -e "${GREEN}通过: $PASSED${NC}"
echo -e "${RED}失败: $FAILED${NC}"
echo -e "${YELLOW}通过率: $PASS_RATE%${NC}"
echo ""

if [ "$FAILED" -eq 0 ]; then
    echo -e "${GREEN}🎉 所有 API 测试通过！${NC}"
    exit 0
else
    echo -e "${RED}⚠️  部分 API 测试失败${NC}"
    exit 1
fi

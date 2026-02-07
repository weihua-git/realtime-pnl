#!/bin/bash

# 快速测试脚本 - 验证量化交易功能
# 使用方法: bash quick-test.sh

echo "🚀 开始快速测试..."
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 测试计数
PASSED=0
FAILED=0

# 测试函数
test_pass() {
    echo -e "${GREEN}✅ PASS${NC}: $1"
    ((PASSED++))
}

test_fail() {
    echo -e "${RED}❌ FAIL${NC}: $1"
    ((FAILED++))
}

test_info() {
    echo -e "${BLUE}ℹ️  INFO${NC}: $1"
}

test_section() {
    echo ""
    echo -e "${YELLOW}========================================${NC}"
    echo -e "${YELLOW}  $1${NC}"
    echo -e "${YELLOW}========================================${NC}"
}

# ==================== 测试 1: 环境检查 ====================
test_section "测试 1: 环境检查"

# 检查 Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    test_pass "Node.js 已安装 ($NODE_VERSION)"
else
    test_fail "Node.js 未安装"
fi

# 检查 Redis
if command -v redis-cli &> /dev/null; then
    if redis-cli ping &> /dev/null; then
        test_pass "Redis 运行正常"
    else
        test_fail "Redis 未运行"
    fi
else
    test_fail "Redis 未安装"
fi

# 检查 .env 文件
if [ -f ".env" ]; then
    test_pass ".env 文件存在"
    
    # 检查关键配置
    if grep -q "QUANT_ENABLED=true" .env; then
        test_pass "量化交易已启用"
    else
        test_info "量化交易未启用（QUANT_ENABLED=true）"
    fi
    
    if grep -q "QUANT_TEST_MODE=true" .env; then
        test_pass "测试模式已启用"
    else
        test_info "测试模式未启用（建议先测试）"
    fi
else
    test_fail ".env 文件不存在"
fi

# ==================== 测试 2: 文件完整性 ====================
test_section "测试 2: 文件完整性"

# 检查核心文件
FILES=(
    "src/services/quant-trader.js"
    "src/services/scalping-signal-generator.js"
    "src/services/simple-signal-generator.js"
    "web-server.js"
    "realtime-pnl.js"
    "web/index.html"
    "web/js/app.js"
    "web/css/style.css"
)

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        test_pass "文件存在: $file"
    else
        test_fail "文件缺失: $file"
    fi
done

# ==================== 测试 3: 语法检查 ====================
test_section "测试 3: JavaScript 语法检查"

# 检查 JS 文件语法
JS_FILES=(
    "src/services/quant-trader.js"
    "web-server.js"
    "web/js/app.js"
)

for file in "${JS_FILES[@]}"; do
    if node --check "$file" 2>/dev/null; then
        test_pass "语法正确: $file"
    else
        test_fail "语法错误: $file"
    fi
done

# ==================== 测试 4: HTML 结构检查 ====================
test_section "测试 4: HTML 结构检查"

# 检查 HTML 标签匹配
HTML_FILE="web/index.html"

if [ -f "$HTML_FILE" ]; then
    OPEN_DIVS=$(grep -o '<div' "$HTML_FILE" | wc -l)
    CLOSE_DIVS=$(grep -o '</div>' "$HTML_FILE" | wc -l)
    
    if [ "$OPEN_DIVS" -eq "$CLOSE_DIVS" ]; then
        test_pass "HTML div 标签匹配 ($OPEN_DIVS 个)"
    else
        test_fail "HTML div 标签不匹配 (开: $OPEN_DIVS, 闭: $CLOSE_DIVS)"
    fi
    
    # 检查是否只有一个 </html>
    HTML_CLOSE=$(grep -c '</html>' "$HTML_FILE")
    if [ "$HTML_CLOSE" -eq 1 ]; then
        test_pass "HTML 结构正确（1个 </html> 标签）"
    else
        test_fail "HTML 结构错误（$HTML_CLOSE 个 </html> 标签）"
    fi
    
    # 检查关键页面是否存在
    if grep -q "currentTab === 'trading'" "$HTML_FILE"; then
        test_pass "智能交易页面存在"
    else
        test_fail "智能交易页面缺失"
    fi
fi

# ==================== 测试 5: Redis 数据检查 ====================
test_section "测试 5: Redis 数据结构"

if command -v redis-cli &> /dev/null && redis-cli ping &> /dev/null; then
    # 检查是否有量化交易数据
    QUANT_KEYS=$(redis-cli keys "quant:*" 2>/dev/null | wc -l)
    
    if [ "$QUANT_KEYS" -gt 0 ]; then
        test_info "发现 $QUANT_KEYS 个量化交易相关的 Redis 键"
        
        # 列出键
        redis-cli keys "quant:*" 2>/dev/null | while read key; do
            test_info "  - $key"
        done
    else
        test_info "暂无量化交易数据（首次运行正常）"
    fi
fi

# ==================== 测试 6: 依赖包检查 ====================
test_section "测试 6: NPM 依赖包"

if [ -f "package.json" ]; then
    # 检查关键依赖
    DEPS=(
        "express"
        "ws"
        "ioredis"
        "axios"
        "dotenv"
    )
    
    for dep in "${DEPS[@]}"; do
        if grep -q "\"$dep\"" package.json; then
            test_pass "依赖存在: $dep"
        else
            test_fail "依赖缺失: $dep"
        fi
    done
    
    # 检查 node_modules
    if [ -d "node_modules" ]; then
        test_pass "node_modules 目录存在"
    else
        test_fail "node_modules 目录不存在（需要运行 npm install）"
    fi
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
    echo -e "${GREEN}🎉 所有测试通过！可以启动程序了${NC}"
    echo ""
    echo "启动命令:"
    echo "  node realtime-pnl.js    # 启动监控程序"
    echo "  node web-server.js      # 启动 Web 服务器"
    echo ""
    exit 0
else
    echo -e "${RED}⚠️  部分测试失败，请检查上述错误${NC}"
    echo ""
    exit 1
fi

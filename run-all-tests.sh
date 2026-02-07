#!/bin/bash

# 运行所有测试的主脚本
# 使用方法: bash run-all-tests.sh

echo "🧪 量化交易系统 - 完整测试套件"
echo "================================"
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

TOTAL_PASSED=0
TOTAL_FAILED=0

# ==================== 阶段 1: 快速环境检查 ====================
echo -e "${BLUE}📋 阶段 1/3: 快速环境检查${NC}"
echo ""

bash quick-test.sh
RESULT=$?

if [ $RESULT -eq 0 ]; then
    echo -e "${GREEN}✅ 阶段 1 通过${NC}"
    ((TOTAL_PASSED++))
else
    echo -e "${RED}❌ 阶段 1 失败 - 请先修复环境问题${NC}"
    ((TOTAL_FAILED++))
    exit 1
fi

echo ""
echo "按 Enter 继续下一阶段测试..."
read

# ==================== 阶段 2: 功能单元测试 ====================
echo ""
echo -e "${BLUE}📋 阶段 2/3: 功能单元测试${NC}"
echo ""

if [ -f "test-quant-trading.js" ]; then
    node test-quant-trading.js
    RESULT=$?
    
    if [ $RESULT -eq 0 ]; then
        echo -e "${GREEN}✅ 阶段 2 通过${NC}"
        ((TOTAL_PASSED++))
    else
        echo -e "${RED}❌ 阶段 2 失败${NC}"
        ((TOTAL_FAILED++))
    fi
else
    echo -e "${YELLOW}⚠️  跳过阶段 2 - test-quant-trading.js 不存在${NC}"
fi

echo ""
echo "按 Enter 继续下一阶段测试..."
read

# ==================== 阶段 3: API 端点测试 ====================
echo ""
echo -e "${BLUE}📋 阶段 3/3: API 端点测试${NC}"
echo ""
echo -e "${YELLOW}注意: 此测试需要服务器运行${NC}"
echo "请确保已启动:"
echo "  1. node realtime-pnl.js"
echo "  2. node web-server.js"
echo ""
echo "是否继续 API 测试? (y/n)"
read -r CONTINUE

if [ "$CONTINUE" = "y" ] || [ "$CONTINUE" = "Y" ]; then
    bash test-api.sh
    RESULT=$?
    
    if [ $RESULT -eq 0 ]; then
        echo -e "${GREEN}✅ 阶段 3 通过${NC}"
        ((TOTAL_PASSED++))
    else
        echo -e "${RED}❌ 阶段 3 失败${NC}"
        ((TOTAL_FAILED++))
    fi
else
    echo -e "${YELLOW}⚠️  跳过阶段 3 - API 测试${NC}"
fi

# ==================== 测试总结 ====================
echo ""
echo "========================================"
echo -e "${BLUE}📊 测试总结${NC}"
echo "========================================"
echo ""

TOTAL=$((TOTAL_PASSED + TOTAL_FAILED))

echo -e "${BLUE}完成阶段: $TOTAL${NC}"
echo -e "${GREEN}通过: $TOTAL_PASSED${NC}"
echo -e "${RED}失败: $TOTAL_FAILED${NC}"
echo ""

if [ $TOTAL_FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 恭喜！所有测试阶段都通过了！${NC}"
    echo ""
    echo "系统已准备就绪，可以开始使用："
    echo ""
    echo "1. 测试模式（推荐）："
    echo "   - 确保 .env 中 QUANT_TEST_MODE=true"
    echo "   - 启动: node realtime-pnl.js"
    echo "   - Web: node web-server.js"
    echo "   - 访问: http://localhost:3000"
    echo ""
    echo "2. 实盘模式（谨慎）："
    echo "   - 设置 QUANT_TEST_MODE=false"
    echo "   - 从小资金开始"
    echo "   - 密切监控"
    echo ""
    exit 0
else
    echo -e "${RED}⚠️  部分测试失败，请检查上述错误${NC}"
    echo ""
    echo "建议："
    echo "1. 查看失败的测试输出"
    echo "2. 修复问题后重新运行"
    echo "3. 参考 docs/测试指南.md"
    echo ""
    exit 1
fi

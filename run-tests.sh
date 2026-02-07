#!/bin/bash

# 量化交易逻辑测试脚本
# 运行所有测试并生成报告

echo "🧪 量化交易逻辑测试套件"
echo "========================================"
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查 Node.js 版本
echo "📋 检查环境..."
NODE_VERSION=$(node -v)
echo "   Node.js 版本: $NODE_VERSION"
echo ""

# 运行单元测试
echo "🔬 运行单元测试..."
echo "========================================"
node test-quant-logic.js

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ 单元测试通过${NC}"
else
    echo ""
    echo -e "${RED}❌ 单元测试失败${NC}"
    exit 1
fi

echo ""
echo "========================================"
echo ""

# 运行集成测试
echo "🔗 运行集成测试..."
echo "========================================"
node test-quant-integration.js

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ 集成测试通过${NC}"
else
    echo ""
    echo -e "${RED}❌ 集成测试失败${NC}"
    exit 1
fi

echo ""
echo "========================================"
echo ""

# 生成测试报告
echo "📊 生成测试报告..."
node generate-test-report.js

echo ""
echo "========================================"
echo -e "${GREEN}🎉 所有测试通过！${NC}"
echo "========================================"
echo ""
echo "📄 测试报告已生成: test-report.md"
echo ""


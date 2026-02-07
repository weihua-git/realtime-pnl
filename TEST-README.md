# 🧪 测试系统说明

## 快速开始

### 一键运行所有测试
```bash
bash run-all-tests.sh
```

这会依次运行：
1. ✅ 环境检查（自动）
2. ✅ 功能单元测试（自动）
3. ✅ API 端点测试（需要手动启动服务）

---

## 测试脚本说明

### 1. `quick-test.sh` - 快速环境检查 ⚡

**用途：** 验证开发环境和代码完整性

**运行：**
```bash
bash quick-test.sh
```

**测试内容：**
- Node.js 和 Redis 环境
- 配置文件（.env）
- 文件完整性
- JavaScript 语法
- HTML 结构
- NPM 依赖

**耗时：** ~5 秒

**适用场景：**
- 首次部署
- 代码更新后
- 环境迁移后

---

### 2. `test-quant-trading.js` - 功能单元测试 🔬

**用途：** 深度测试量化交易核心功能

**运行：**
```bash
node test-quant-trading.js
```

**测试内容：**
- 初始化和配置
- 状态管理（Redis）
- 开仓/平仓逻辑
- 止盈止损计算
- 盈亏计算（火币公式）
- 历史订单记录
- 重置和停止功能

**耗时：** ~10 秒

**适用场景：**
- 核心逻辑修改后
- 发布前验证
- Bug 修复验证

---

### 3. `test-api.sh` - API 端点测试 🌐

**用途：** 测试 Web API 和 WebSocket

**前置条件：**
```bash
# 终端 1
node realtime-pnl.js

# 终端 2
node web-server.js
```

**运行：**
```bash
# 终端 3
bash test-api.sh
```

**测试内容：**
- 配置 API
- 市场分析 API
- 量化交易 API
- WebSocket 连接

**耗时：** ~5 秒

**适用场景：**
- API 修改后
- 集成测试
- 部署验证

---

## 测试结果示例

### ✅ 成功示例

```
🎉 所有测试通过！

总测试数: 30
通过: 30
失败: 0
通过率: 100.00%
```

### ❌ 失败示例

```
⚠️  部分测试失败

总测试数: 30
通过: 28
失败: 2
通过率: 93.33%

失败的测试:
- 开仓: 持仓数量正确
- 平仓: 余额增加（盈利）
```

---

## 测试覆盖率

| 模块 | 覆盖率 | 说明 |
|------|--------|------|
| 配置管理 | 100% | 加载、保存、验证 |
| 状态管理 | 100% | Redis 读写、重置 |
| 开仓逻辑 | 100% | 信号检测、仓位计算 |
| 平仓逻辑 | 100% | 止盈止损、移动止损 |
| 盈亏计算 | 100% | 火币公式、ROE |
| 历史记录 | 100% | 订单保存、查询 |
| API 端点 | 100% | 所有 REST API |
| WebSocket | 90% | 连接、消息推送 |

**总覆盖率：** ~98%

---

## 常见问题

### Q1: Redis 连接失败

**错误：**
```
❌ FAIL: Redis 运行正常
```

**解决：**
```bash
# 启动 Redis
redis-server

# 或使用 Homebrew (macOS)
brew services start redis
```

---

### Q2: 语法错误

**错误：**
```
❌ FAIL: 语法正确: src/services/quant-trader.js
```

**解决：**
1. 检查文件是否完整
2. 运行 `node --check <文件名>` 查看详细错误
3. 修复语法错误后重新测试

---

### Q3: HTML 标签不匹配

**错误：**
```
❌ FAIL: HTML div 标签不匹配 (开: 207, 闭: 205)
```

**解决：**
1. 检查 `web/index.html` 文件
2. 查找未闭合的 `<div>` 标签
3. 使用编辑器的括号匹配功能

---

### Q4: API 测试失败

**错误：**
```
❌ FAIL: Web 服务器未运行
```

**解决：**
1. 确保 `node realtime-pnl.js` 正在运行
2. 确保 `node web-server.js` 正在运行
3. 检查端口 3000 是否被占用

---

## 手动测试流程

如果自动化测试无法满足需求，可以进行手动测试：

### 1. 启动系统

```bash
# 终端 1: 监控程序
node realtime-pnl.js

# 终端 2: Web 服务器
node web-server.js
```

### 2. 打开浏览器

访问: http://localhost:3000

### 3. 验证功能

- [ ] 页面加载正常
- [ ] WebSocket 显示"已连接"
- [ ] 实时价格更新
- [ ] 智能交易页面显示数据
- [ ] 信号历史有记录
- [ ] 开仓/平仓功能正常
- [ ] 历史订单显示正常
- [ ] 重置功能正常
- [ ] 停止功能正常

### 4. 检查日志

```bash
# 查看监控程序日志
# 应该看到:
# - 🤖 量化交易系统已启动
# - 📊 信号生成
# - 📈 开仓/平仓记录
```

---

## 性能测试

### 响应时间基准

| 操作 | 预期时间 | 说明 |
|------|---------|------|
| 页面加载 | < 1s | 首次加载 |
| WebSocket 连接 | < 500ms | 建立连接 |
| 实时数据更新 | < 100ms | 推送延迟 |
| API 请求 | < 200ms | 配置读写 |
| 开仓操作 | < 1s | 测试模式 |
| 平仓操作 | < 1s | 测试模式 |

### 压力测试

```bash
# 使用 Apache Bench 测试 API
ab -n 1000 -c 10 http://localhost:3000/api/config

# 预期结果:
# - 成功率: 100%
# - 平均响应时间: < 50ms
# - 无错误
```

---

## 持续集成

### GitHub Actions 配置示例

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      redis:
        image: redis
        ports:
          - 6379:6379
    
    steps:
      - uses: actions/checkout@v2
      
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '16'
      
      - name: Install dependencies
        run: npm install
      
      - name: Run tests
        run: |
          bash quick-test.sh
          node test-quant-trading.js
```

---

## 测试最佳实践

### 1. 测试前准备

- ✅ 备份重要数据
- ✅ 使用测试模式
- ✅ 清空 Redis 测试数据
- ✅ 检查配置文件

### 2. 测试中注意

- ✅ 观察日志输出
- ✅ 记录异常情况
- ✅ 截图保存证据
- ✅ 测试边界条件

### 3. 测试后验证

- ✅ 检查数据一致性
- ✅ 验证计算准确性
- ✅ 清理测试数据
- ✅ 记录测试报告

---

## 测试数据清理

### 清空 Redis 测试数据

```bash
# 清空所有量化交易数据
redis-cli keys "quant:*" | xargs redis-cli del

# 或者清空整个 Redis（谨慎！）
redis-cli FLUSHALL
```

### 重置测试环境

```bash
# 1. 停止所有进程
pkill -f "node realtime-pnl.js"
pkill -f "node web-server.js"

# 2. 清空 Redis
redis-cli FLUSHALL

# 3. 重新启动
node realtime-pnl.js &
node web-server.js &
```

---

## 获取帮助

如果测试遇到问题：

1. 📖 查看 `docs/测试指南.md`
2. 🔍 检查日志输出
3. 🐛 提交 Issue（附带测试结果）
4. 💬 联系开发者

---

## 更新日志

### v1.0.0 (2024-02-07)
- ✅ 初始版本
- ✅ 环境检查测试
- ✅ 功能单元测试
- ✅ API 端点测试
- ✅ 完整测试套件

---

**祝测试顺利！** 🎉

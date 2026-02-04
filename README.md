# HTX 永续合约监听工具

这是一个用于监听 HTX（原火币）永续合约私人动态的 Node.js 工具，可以实时监听订单、持仓、账户余额等数据变化。

## 功能特性

✅ **订单监听** - 实时监听订单创建、成交、撤销等状态变化  
✅ **持仓监听** - 实时监听持仓变化、盈亏情况  
✅ **账户监听** - 实时监听账户余额、保证金变化  
✅ **成交监听** - 实时监听订单成交详情  
✅ **强平监听** - 监听市场强平订单（公共数据）  
✅ **实时盈亏** - 订阅市场行情，实时计算持仓盈亏  
✅ **智能通知** - 支持 Bark（iOS，< 1秒）和 Telegram 通知  
✅ **自动重连** - 连接断开时自动重连  
✅ **多合约支持** - 支持监听所有合约或指定合约

## 安装依赖

```bash
npm install
```

## 配置

1. 复制配置文件模板：

```bash
cp config.example.env .env
```

2. 编辑 `.env` 文件，填入你的 HTX API 密钥：

```env
HTX_ACCESS_KEY=your_access_key_here
HTX_SECRET_KEY=your_secret_key_here
WS_URL=wss://api.hbdm.com/linear-swap-notification
```

### 获取 API 密钥

1. 登录 HTX 官网
2. 进入 API 管理页面
3. 创建新的 API Key
4. **重要**：需要开启"读取"权限，不需要"交易"权限
5. 绑定 IP 地址（推荐）以提高安全性

## 使用方法

### 基础监听（订单、持仓变化）

```bash
npm start
```

### 实时盈亏监控（推荐）⭐

```bash
node realtime-pnl.js
```

**功能：**
- ✅ 实时显示持仓盈亏（随价格变化）
- ✅ 显示持仓价值（USDT）
- ✅ 自动管理订阅（平仓自动取消，开仓自动订阅）
- ✅ 智能通知系统（Telegram + Bark）

**通知系统（可选）：**

支持两种通知方式，可单独使用或同时使用：

1. **Bark（推荐，iOS 专用）** ⚡
   - 延迟 < 1 秒（使用 Apple APNs）
   - 完全免费
   - 自定义铃声、图标、分组
   - 配置简单，只需一个 Key

2. **Telegram（备选）**
   - 延迟 3-15 秒
   - 跨平台支持
   - 可查看历史消息

**通知触发条件：**
- 盈利达到 3% 或 2 USDT 自动通知
- 亏损达到 -5% 或 -2 USDT 自动警告
- 每小时发送持仓汇总
- 可自定义阈值和频率

**配置通知：**

**方式 1：仅使用 Bark（推荐）**
1. 查看 `Bark配置指南.md`
2. 在 `.env` 中添加 `BARK_KEY`
3. 运行 `node test-bark.js` 测试通知

**方式 2：仅使用 Telegram**
1. 查看 `Telegram配置指南.md`
2. 在 `.env` 中添加 `TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_CHAT_ID`
3. 运行 `node test-telegram.js` 测试通知

**方式 3：同时使用（双保险）**
1. 同时配置 Bark 和 Telegram
2. 运行 `node test-unified.js` 测试所有通知
3. Bark 提供低延迟实时通知，Telegram 提供历史记录

**不配置通知：**
- 程序正常运行，只在控制台显示
- 不影响任何功能

### 开发模式（自动重启）

```bash
npm run dev
```

## 代码示例

### 基础使用

```javascript
import { HTXFuturesClient } from './client.js';

const client = new HTXFuturesClient(ACCESS_KEY, SECRET_KEY, WS_URL);

// 连接
await client.connect();

// 订阅所有合约的订单更新
client.subscribeOrders('*');

// 订阅所有合约的持仓更新
client.subscribePositions('*');

// 订阅所有合约的账户更新
client.subscribeAccounts('*');
```

### 订阅特定合约

```javascript
// 只监听 BTC-USDT 合约
client.subscribeOrders('BTC-USDT');
client.subscribePositions('BTC-USDT');
client.subscribeAccounts('BTC-USDT');

// 监听 ETH-USDT 合约
client.subscribeOrders('ETH-USDT');
```

### 自定义事件处理

```javascript
// 订单更新事件
client.on('orders', (data) => {
  console.log('订单更新:', data);
  // 你的自定义处理逻辑
});

// 持仓更新事件
client.on('positions', (data) => {
  console.log('持仓更新:', data);
  // 你的自定义处理逻辑
});

// 账户更新事件
client.on('accounts', (data) => {
  console.log('账户更新:', data);
  // 你的自定义处理逻辑
});

// 成交订单事件
client.on('matchOrders', (data) => {
  console.log('订单成交:', data);
  // 你的自定义处理逻辑
});
```

## 数据结构说明

### 订单数据 (orders)

```javascript
{
  contract_code: "BTC-USDT",      // 合约代码
  order_id: 123456789,            // 订单ID
  direction: "buy",               // 方向：buy/sell
  offset: "open",                 // 开平：open/close
  price: 50000,                   // 价格
  volume: 1,                      // 数量
  status: 6,                      // 状态：6=完全成交
  order_type: 1,                  // 订单类型
  created_at: 1234567890000       // 创建时间
}
```

### 持仓数据 (positions)

```javascript
{
  contract_code: "BTC-USDT",      // 合约代码
  direction: "buy",               // 方向：buy=多/sell=空
  volume: 10,                     // 持仓量
  available: 10,                  // 可平量
  cost_open: 50000,               // 开仓均价
  position_margin: 1000,          // 持仓保证金
  profit_unreal: 100,             // 未实现盈亏
  profit_rate: 10                 // 收益率
}
```

### 账户数据 (accounts_unify - 统一账户)

```javascript
{
  margin_asset: "USDT",           // 保证金币种
  margin_balance: 10000,          // 账户权益
  margin_available: 8000,         // 可用保证金
  margin_frozen: 2000,            // 冻结保证金
  profit_real: 100,               // 已实现盈亏
  profit_unreal: 50               // 未实现盈亏
}
```

**注意**：HTX 已升级为统一账户模式，使用 `accounts_unify` 频道。

## 项目结构

```
heyue/
├── auth.js              # HTX API 认证模块
├── client.js            # WebSocket 客户端核心模块
├── index.js             # 主程序入口
├── package.json         # 项目配置
├── config.example.env   # 配置文件模板
├── .env                 # 实际配置文件（需自行创建）
└── README.md            # 说明文档
```

## 注意事项

1. **API 权限**：确保 API Key 有"读取"权限
2. **网络连接**：需要稳定的网络连接，程序会自动重连
3. **数据延迟**：WebSocket 推送通常有 100-500ms 延迟
4. **安全性**：不要将 `.env` 文件提交到版本控制系统
5. **测试环境**：建议先在测试网测试

## WebSocket 地址

- **正式环境**：`wss://api.hbdm.com/linear-swap-notification`
- **测试环境**：`wss://api.hbdm.vn/linear-swap-notification`

## 常见问题

### 1. 认证失败

- 检查 API Key 和 Secret Key 是否正确
- 确认 API Key 有"读取"权限
- 检查系统时间是否准确

### 2. 连接断开

- 程序会自动重连，无需手动处理
- 检查网络连接是否稳定

### 3. 没有数据推送

- 确认账户有持仓或订单
- 尝试手动下单测试
- 检查订阅的合约代码是否正确

### 4. 持仓监听只推送一次？

**重要说明**：这是正常行为！

- HTX 的 `positions` 推送**只在持仓实际变化时触发**（开仓/平仓/调整保证金等）
- 如果只是价格变化，持仓本身没有操作，**不会推送**
- 这不是 bug，而是 HTX 的设计机制

**如果需要实时监控盈亏变化**，有两个方案：

#### 方案 1：订阅市场行情 + 自己计算（推荐）

```bash
# 使用实时盈亏监控脚本
node realtime-pnl.js
```

这个脚本会：
1. 订阅持仓更新获取持仓信息
2. 订阅市场行情获取最新价格
3. 自动计算实时盈亏和收益率

**注意**：HTX 永续合约有不同的合约面值：
- BTC-USDT: 0.001 BTC/张
- ETH-USDT: 0.01 ETH/张
- 其他币种: 通常 1 USD/张

盈亏计算公式：
```
未实现盈亏 = (价格差) × 持仓量 × 合约面值
```

#### 方案 2：定时轮询 REST API

使用 HTX 的 REST API 定时查询持仓信息（不推荐，有频率限制）

### 5. 为什么会自动重连？

WebSocket 重连是正常的，常见原因：

1. **网络波动** - 临时网络中断
2. **服务器维护** - HTX 服务器重启或维护
3. **心跳超时** - 超过 60 秒未收到服务器心跳
4. **连接空闲** - 长时间无数据交换

**调试重连问题：**

```bash
# 使用调试模式查看详细信息
node realtime-pnl-debug.js
```

这个脚本会显示：
- 每次连接和断开的详细信息
- 心跳发送和接收情况
- 消息统计和延迟
- 重连次数和原因

**优化建议：**
- 确保网络稳定
- 程序会自动重连，无需手动干预
- 重连后会自动恢复订阅

### 6. 账户订阅失败

- HTX 已升级为统一账户模式
- 使用 `accounts_unify` 而不是 `accounts`
- 代码已自动处理，无需手动修改

### 7. 强平订单订阅失败

- 强平订单是公共频道，需要指定具体合约
- 不支持使用 `*` 订阅所有合约
- 示例：`client.subscribeLiquidationOrders('BTC-USDT')`

## 技术支持

- HTX API 文档：https://www.htx.com/zh-cn/opend/newApiPages/
- WebSocket 文档：https://www.htx.com/zh-cn/opend/newApiPages/?type=2

## License

MIT


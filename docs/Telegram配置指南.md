# Telegram Bot 配置指南

## 第一步：创建 Telegram Bot

### 1. 找到 BotFather

在 Telegram 中搜索 `@BotFather` 并打开对话。

### 2. 创建新机器人

发送命令：
```
/newbot
```

### 3. 设置机器人名称

BotFather 会要求你输入机器人的名称（显示名称），例如：
```
HTX Monitor Bot
```

### 4. 设置机器人用户名

然后输入用户名（必须以 `bot` 结尾），例如：
```
htx_monitor_bot
```

### 5. 获取 Bot Token

创建成功后，BotFather 会给你一个 Token，类似：
```
1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
```

**重要：** 保存这个 Token，这就是你的 `TELEGRAM_BOT_TOKEN`

---

## 第二步：获取 Chat ID

### 方法 1：使用 userinfobot（推荐）

1. 在 Telegram 中搜索 `@userinfobot`
2. 点击 Start 或发送任意消息
3. 机器人会返回你的信息，包括 `Id`
4. 这个 `Id` 就是你的 `TELEGRAM_CHAT_ID`

示例返回：
```
Id: 123456789
First name: Your Name
Username: @your_username
```

### 方法 2：使用 getUpdates API

1. 先给你的机器人发送一条消息（任意内容）
2. 在浏览器中访问：
```
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
```

3. 在返回的 JSON 中找到 `chat.id`：
```json
{
  "ok": true,
  "result": [{
    "message": {
      "chat": {
        "id": 123456789,  // 这就是你的 Chat ID
        "first_name": "Your Name"
      }
    }
  }]
}
```

---

## 第三步：配置环境变量

编辑 `.env` 文件，添加：

```env
# Telegram Bot Token（从 BotFather 获取）
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz

# Telegram Chat ID（你的用户 ID）
TELEGRAM_CHAT_ID=123456789
```

---

## 第四步：测试通知

运行测试脚本：

```bash
node test-telegram.js
```

如果配置正确，你会在 Telegram 收到测试消息。

---

## 通知配置说明

在 `realtime-pnl-telegram.js` 中可以配置通知参数：

```javascript
const notifier = new TelegramNotifier(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, {
  profitThreshold: 3,           // 盈利 3% 时通知
  lossThreshold: -5,            // 亏损 5% 时通知
  timeInterval: 3600000,        // 1 小时定时通知（毫秒）
  repeatInterval: 300000,       // 5 分钟内不重复通知（毫秒）
  enableTimeNotification: true, // 启用定时通知
  enableProfitNotification: true, // 启用盈利通知
  enableLossNotification: true,   // 启用亏损通知
});
```

### 配置参数说明

| 参数 | 说明 | 默认值 | 示例 |
|------|------|--------|------|
| profitThreshold | 盈利通知阈值（%） | 3 | 盈利达到 3% 时通知 |
| lossThreshold | 亏损通知阈值（%） | -5 | 亏损达到 -5% 时通知 |
| timeInterval | 定时通知间隔（毫秒） | 60 * 60 * 1000 | 1 小时 |
| repeatInterval | 重复通知间隔（毫秒） | 5 * 60 * 1000 | 5 分钟 |
| enableTimeNotification | 是否启用定时通知 | true | true/false |
| enableProfitNotification | 是否启用盈利通知 | true | true/false |
| enableLossNotification | 是否启用亏损通知 | true | true/false |

### 时间配置示例

```javascript
// 使用 分钟 × 60 × 1000 的格式更直观
1 分钟  = 1 * 60 * 1000
5 分钟  = 5 * 60 * 1000
10 分钟 = 10 * 60 * 1000
30 分钟 = 30 * 60 * 1000
1 小时  = 60 * 60 * 1000
2 小时  = 120 * 60 * 1000
```

---

## 通知类型

### 1. 盈利通知

当收益率达到设定阈值时触发：

```
🎉 盈利提醒

🟢 ETH-USDT 空仓

📊 持仓信息
持仓量: 21 张 (0.2100 ETH)
持仓价值: 479.22 USDT
保证金: 47.93 USDT

💰 价格信息
最新价: 2282.00 USDT
开仓价: 2273.76 USDT
价差: 8.24 USDT

📈 盈亏情况
未实现盈亏: 1.7304 USDT
收益率: 3.61%

⏰ 2026/2/4 12:00:00
```

### 2. 亏损警告

当亏损达到设定阈值时触发：

```
⚠️ 亏损警告

🔴 ETH-USDT 空仓

📊 持仓信息
...
```

### 3. 定时汇总

定期发送所有持仓的汇总信息：

```
📊 持仓定时汇总

🟢 总体情况
总盈亏: 2.50 USDT
总收益率: 5.21%
总保证金: 47.93 USDT
总持仓价值: 479.22 USDT

📋 各持仓详情
🟢 ETH-USDT 空: 2.50 USDT (5.21%)

⏰ 2026/2/4 12:00:00
```

---

## 自定义通知

你可以在代码中使用 `notifier.notify()` 发送自定义通知：

```javascript
// 发送简单消息
await notifier.notify('这是一条测试消息');

// 发送 Markdown 格式消息
await notifier.notify(`
*粗体文本*
_斜体文本_
\`代码文本\`
[链接](https://example.com)
`);

// 发送静默通知（不发出声音）
await notifier.notify('静默消息', { silent: true });
```

---

## 常见问题

### Q1: 收不到通知？

**检查：**
1. Bot Token 是否正确？
2. Chat ID 是否正确？
3. 是否给机器人发送过消息？（必须先发送消息激活）
4. 网络是否能访问 Telegram API？

**解决：**
```bash
# 运行测试脚本
node test-telegram.js

# 查看错误信息
```

### Q2: 通知太频繁？

**调整 `repeatInterval`：**
```javascript
repeatInterval: 600000,  // 改为 10 分钟
```

### Q3: 想要更频繁的定时通知？

**调整 `timeInterval`：**
```javascript
timeInterval: 1800000,  // 改为 30 分钟
```

### Q4: 只想要盈利通知，不要亏损通知？

**禁用亏损通知：**
```javascript
enableLossNotification: false,
```

### Q5: 如何发送到群组？

1. 将机器人添加到群组
2. 使用 `@userinfobot` 在群组中获取群组 ID
3. 群组 ID 通常是负数，例如 `-123456789`
4. 将群组 ID 设置为 `TELEGRAM_CHAT_ID`

---

## 高级用法

### 发送到多个聊天

创建多个通知器实例：

```javascript
const notifier1 = new TelegramNotifier(BOT_TOKEN, CHAT_ID_1, config);
const notifier2 = new TelegramNotifier(BOT_TOKEN, CHAT_ID_2, config);

// 同时发送
await notifier1.notifyPositionPnL(data);
await notifier2.notifyPositionPnL(data);
```

### 条件通知

根据不同条件发送不同通知：

```javascript
if (profitRate > 10) {
  await notifier.notify('🎉 盈利超过 10%，建议止盈！');
} else if (profitRate < -10) {
  await notifier.notify('🚨 亏损超过 10%，注意风险！');
}
```

### 查看通知历史

```javascript
// 获取最近 10 条通知
const history = notifier.getNotificationHistory(10);
console.log(history);

// 清除历史
notifier.clearNotificationHistory();
```

---

## 安全建议

1. **不要泄露 Bot Token**
   - 不要提交到 Git
   - 不要分享给他人
   - 定期更换 Token

2. **保护 Chat ID**
   - 不要公开你的 Chat ID
   - 避免陌生人给你的机器人发消息

3. **使用 .gitignore**
   ```
   .env
   ```

4. **如果 Token 泄露**
   - 立即在 BotFather 中使用 `/revoke` 撤销
   - 重新生成新的 Token

---

## 运行监控

配置完成后，运行：

```bash
# 实时盈亏监控（自动检测 Telegram 配置）
node realtime-pnl.js
```

**说明：**
- 如果配置了 Telegram，自动启用通知功能
- 如果没配置 Telegram，正常运行，只显示控制台输出
- 平仓后自动取消订阅，开仓后自动订阅行情

祝交易顺利！🚀

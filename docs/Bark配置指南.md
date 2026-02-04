# Bark 推送配置指南（iOS 专用）

## 为什么选择 Bark？

Bark 是专为 iOS 设计的推送通知应用，具有以下优势：

- ⚡ **超低延迟**：< 1 秒，使用 Apple Push Notification Service (APNs)
- 💰 **完全免费**：开源项目，无需付费
- 🎵 **丰富功能**：自定义铃声、图标、分组、优先级
- 🔒 **隐私安全**：可以自建服务器
- 📱 **iOS 原生**：完美支持 iPhone/iPad

相比 Telegram（延迟 3-15 秒），Bark 的推送几乎是实时的！

## 配置步骤

### 1. 安装 Bark 应用

在 App Store 搜索 "Bark" 并下载安装

<img src="https://day.app/assets/bark_logo.png" width="100">

### 2. 获取推送 Key

1. 打开 Bark 应用
2. 你会看到一个推送地址，类似：
   ```
   https://api.day.app/xxxxxx/
   ```
3. 其中 `xxxxxx` 就是你的 **Bark Key**
4. 点击复制按钮复制这个 Key

### 3. 配置环境变量

在项目根目录的 `.env` 文件中添加：

```env
# Bark 推送配置
BARK_KEY=你复制的Key
```

例如：
```env
BARK_KEY=AbCdEfGhIjKlMnOp
```

### 4. 测试推送

运行测试脚本：

```bash
node test-bark.js
```

如果配置正确，你的 iPhone 会立即收到测试通知！

## 高级配置（可选）

### 自定义音效

在 `.env` 中添加：

```env
BARK_SOUND=alarm
```

可用音效：
- `alarm` - 闹钟（紧急）
- `bell` - 铃声（默认）
- `glass` - 玻璃
- `horn` - 号角
- `minuet` - 小步舞曲
- `multiwayinvitation` - 多方邀请
- `newmail` - 新邮件
- `noir` - 黑色
- `paymentsuccess` - 支付成功
- `shake` - 震动
- `sherwoodforest` - 舍伍德森林
- `spell` - 咒语
- `telegraph` - 电报

### 自定义分组

在 `.env` 中添加：

```env
BARK_GROUP=我的交易通知
```

这样所有通知会归类到同一个分组中。

### 自建服务器

如果你有自己的 Bark 服务器：

```env
BARK_SERVER=https://your-bark-server.com
```

## 使用统一通知器

项目支持同时使用 Telegram 和 Bark，或单独使用任一方式：

```bash
# 测试统一通知器（会同时发送到 Telegram 和 Bark）
node test-unified.js
```

### 推荐配置

**仅使用 Bark（推荐）**：
```env
# 只配置 Bark
BARK_KEY=你的Key

# 不配置或注释掉 Telegram
# TELEGRAM_BOT_TOKEN=
# TELEGRAM_CHAT_ID=
```

**同时使用（双保险）**：
```env
# Bark 作为主要通知（低延迟）
BARK_KEY=你的Key

# Telegram 作为备份（可查看历史）
TELEGRAM_BOT_TOKEN=你的Token
TELEGRAM_CHAT_ID=你的ChatID
```

## 通知效果

### 盈利通知
```
🎉 BTC-USDT 盈利 5.50%

📈 多仓 10张
💰 盈亏: 20.00 USDT
📊 价格: 45000.00 (成本 43000.00)
📍 持仓: 0.0010 BTC
```

### 亏损通知
```
⚠️ ETH-USDT 亏损 7.50%

📉 空仓 20张
💰 盈亏: -15.00 USDT
📊 价格: 2500.00 (成本 2400.00)
📍 持仓: 0.0200 ETH
```

### 汇总通知
```
📊 持仓汇总 📈 2.50%

💰 总盈亏: 5.00 USDT
📊 总收益率: 2.50%
📋 持仓数: 2

📈 BTC-USDT 多: 20.00 (5.50%)
📉 ETH-USDT 空: -15.00 (-7.50%)
```

## 常见问题

### Q: 没有收到通知？

1. 检查 Bark Key 是否正确
2. 确保 iPhone 已联网
3. 检查 iPhone 设置 → 通知 → Bark，确保允许通知
4. 尝试在 Bark 应用内发送测试通知

### Q: 通知延迟高？

Bark 使用 APNs，延迟通常 < 1 秒。如果延迟高：
1. 检查网络连接
2. 确认使用的是官方服务器或稳定的自建服务器
3. 重启 Bark 应用

### Q: 可以在 Android 上使用吗？

Bark 是 iOS 专用的。Android 用户建议使用 Telegram 或其他推送服务。

### Q: 推送有数量限制吗？

官方服务器没有明确的数量限制，但建议合理使用。如果需要大量推送，可以自建服务器。

### Q: 如何自建 Bark 服务器？

参考官方文档：https://github.com/Finb/bark-server

## 相关链接

- Bark GitHub: https://github.com/Finb/Bark
- Bark 官网: https://bark.day.app
- Bark Server: https://github.com/Finb/bark-server

## 技术支持

如有问题，请查看项目的 `常见问题解答.md` 或提交 Issue。

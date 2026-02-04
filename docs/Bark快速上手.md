# Bark 快速上手（3 分钟配置）

## 第一步：安装 Bark（1 分钟）

1. 打开 iPhone 的 App Store
2. 搜索 "Bark"
3. 下载并安装（完全免费）

<img src="https://day.app/assets/bark_logo.png" width="80">

## 第二步：获取 Key（30 秒）

1. 打开 Bark 应用
2. 你会看到类似这样的界面：

```
推送地址：
https://api.day.app/AbCdEfGhIjKlMnOp/

点击复制
```

3. 点击"复制"按钮
4. 你复制的内容中，`AbCdEfGhIjKlMnOp` 这部分就是你的 **Bark Key**

## 第三步：配置项目（30 秒）

1. 打开项目根目录的 `.env` 文件
2. 找到 `BARK_KEY=` 这一行
3. 粘贴你的 Key：

```env
BARK_KEY=AbCdEfGhIjKlMnOp
```

4. 保存文件

## 第四步：测试（1 分钟）

在项目目录运行：

```bash
node test-bark.js
```

如果配置正确，你的 iPhone 会立即收到 5 条测试通知！

## 第五步：开始使用

运行监控程序：

```bash
node realtime-pnl.js
```

现在，当你的持仓盈亏达到阈值时，会立即收到 Bark 通知！

## 通知效果预览

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

## 自定义配置（可选）

### 修改音效

在 `.env` 中添加：

```env
BARK_SOUND=alarm
```

可用音效：
- `alarm` - 闹钟（紧急）
- `bell` - 铃声（默认）
- `paymentsuccess` - 支付成功
- 更多音效见 `Bark配置指南.md`

### 修改分组

```env
BARK_GROUP=我的交易通知
```

### 修改通知阈值

编辑 `realtime-pnl.js`，找到：

```javascript
notificationConfig: {
  profitThreshold: 3,           // 盈利 3% 时通知
  lossThreshold: -5,            // 亏损 5% 时通知
  profitAmountThreshold: 2,     // 盈利 2 USDT 时通知
  lossAmountThreshold: -2,      // 亏损 2 USDT 时通知
}
```

修改为你想要的值。

## 常见问题

### Q: 没收到通知？

1. 检查 Bark Key 是否正确
2. 确保 iPhone 联网
3. 检查 iPhone 设置 → 通知 → Bark，确保允许通知
4. 在 Bark 应用内发送测试通知

### Q: 通知延迟高？

Bark 使用 Apple APNs，延迟通常 < 1 秒。如果延迟高：
1. 检查网络连接
2. 重启 Bark 应用
3. 确认使用的是官方服务器

### Q: 可以和 Telegram 一起用吗？

可以！同时配置 `BARK_KEY` 和 `TELEGRAM_BOT_TOKEN`，程序会同时发送到两个渠道。

### Q: 推送有数量限制吗？

官方服务器没有明确限制，但建议合理使用。

## 下一步

- 查看 `Bark配置指南.md` 了解更多高级功能
- 查看 `通知对比.md` 对比 Bark 和 Telegram
- 运行 `node test-unified.js` 测试统一通知器

## 技术支持

- Bark GitHub: https://github.com/Finb/Bark
- Bark 官网: https://bark.day.app
- 项目问题: 查看 `常见问题解答.md`

---

**就这么简单！** 🎉

现在你的 iPhone 会在持仓盈亏变化时立即收到通知，延迟 < 1 秒！

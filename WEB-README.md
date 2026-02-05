# 🌐 Web 配置界面

## 📁 项目结构

```
├── web/                          # Web 前端文件
│   ├── index.html                # 主页面
│   ├── css/
│   │   └── style.css             # 样式文件
│   └── js/
│       └── app.js                # Vue 应用逻辑
│
├── data/                         # 数据文件目录
│   └── config.json               # 配置文件（自动生成）
│
├── web-server.js                 # Express 服务器
├── market-config.js              # 配置管理器（支持热重载）
├── realtime-pnl.js               # 监控程序（已改造）
├── start-all.sh                  # 一键启动脚本
│
└── docs/
    ├── Web配置指南.md            # 详细使用指南
    └── 使用示例.md               # 实际使用场景
```

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动服务

**方式一：分别启动**

```bash
# 终端 1：启动 Web 配置界面
npm run web

# 终端 2：启动监控程序
npm start
```

**方式二：一键启动**

```bash
./start-all.sh
```

### 3. 访问配置页面

- 本地：http://localhost:3000
- 局域网：http://你的IP:3000

## ✨ 核心功能

### 🎯 价格目标监控

设置价格达到或跌破某个值时触发通知。

**示例**：
- ETH-USDT 达到 2300 → 价格 ≥ 2300 时通知
- BTC-USDT 跌破 50000 → 价格 ≤ 50000 时通知

### 📋 监控合约列表

选择要监控的合约，支持：
- BTC-USDT
- ETH-USDT
- SOL-USDT
- DOGE-USDT
- XRP-USDT
- 等等...

### ⏱️ 多时间窗口监控

监控价格在不同时间窗口的变化：
- 5秒、10秒、30秒、1分钟、5分钟、1小时
- 可设置变化幅度（%）和变化金额（USDT）阈值

### 🔔 持仓通知配置

- **盈利通知**：盈利达到指定比例或金额时通知
- **亏损通知**：亏损达到指定比例或金额时通知
- **定时通知**：定期发送持仓汇总

## 🔄 配置热重载

配置修改后 **10 秒内自动生效**，无需重启程序！

### 工作原理

```
手机/电脑修改配置
    ↓
保存到 config.json
    ↓
监控程序每 10 秒检查文件变化
    ↓
检测到变化 → 重载配置
    ↓
新配置立即生效
```

## 📱 移动端支持

### iOS Safari

1. 访问配置页面
2. 点击"分享" → "添加到主屏幕"
3. 像 App 一样使用

### Android Chrome

1. 访问配置页面
2. 菜单 → "添加到主屏幕"
3. 像 App 一样使用

## 🔧 技术栈

- **前端**：Vue 3 (CDN) + 原生 CSS
- **后端**：Express.js
- **存储**：JSON 文件
- **通信**：HTTP REST API

**特点**：
- ✅ 零数据库依赖
- ✅ 轻量级（< 100KB）
- ✅ 响应式设计
- ✅ 开箱即用

## 📖 API 接口

### GET /api/config

获取当前配置

**响应**：
```json
{
  "watchContracts": ["ETH-USDT"],
  "priceChangeConfig": { ... },
  "priceTargets": { ... },
  "notificationConfig": { ... }
}
```

### POST /api/config

保存配置

**请求体**：
```json
{
  "watchContracts": ["ETH-USDT", "BTC-USDT"],
  "priceTargets": {
    "enabled": true,
    "targets": [
      {
        "symbol": "ETH-USDT",
        "targetPrice": 2300,
        "direction": "above",
        "notified": false
      }
    ]
  },
  ...
}
```

**响应**：
```json
{
  "success": true,
  "message": "配置已保存"
}
```

### GET /api/data

获取监控数据（占位接口，后续实现）

## 🔐 安全建议

### 局域网使用（推荐）

只在局域网内访问，不暴露到公网。

### 公网访问（需要额外配置）

1. 使用 Nginx 反向代理
2. 配置 HTTPS（Let's Encrypt）
3. 添加认证（Basic Auth 或 JWT）
4. 设置 IP 白名单

## 📊 数据展示（开发中）

即将支持：
- 📈 实时持仓盈亏
- 📊 盈亏曲线图
- 🎯 价格监控状态
- 📋 通知历史记录

## 🐛 故障排查

### 配置修改后没有生效

1. 检查监控程序是否运行
2. 查看日志确认是否输出"配置已重新加载"
3. 等待最多 10 秒

### 手机无法访问

1. 确保手机和电脑在同一局域网
2. 检查防火墙是否开放 3000 端口
3. 使用电脑的局域网 IP（不是 localhost）

### 页面显示空白

1. 检查浏览器控制台错误
2. 确认 config.json 格式正确
3. 清除浏览器缓存

## 📚 相关文档

- [Web配置指南.md](docs/Web配置指南.md) - 详细使用指南
- [使用示例.md](docs/使用示例.md) - 实际使用场景
- [Bark配置指南.md](docs/Bark配置指南.md) - Bark 通知配置
- [Telegram配置指南.md](docs/Telegram配置指南.md) - Telegram 通知配置

## 💡 使用技巧

1. **配置备份**：定期备份 `data/config.json`
2. **批量修改**：直接编辑 JSON 文件更快
3. **多设备同步**：配置文件是共享的
4. **实时日志**：查看监控程序输出了解状态

## 🎯 后续计划

- [ ] 数据展示功能（持仓、盈亏、图表）
- [ ] 历史记录查询
- [ ] 配置导入/导出
- [ ] 多用户支持
- [ ] WebSocket 实时推送
- [ ] 移动端 App（Capacitor）

---

**简单、轻量、易用！** 🚀

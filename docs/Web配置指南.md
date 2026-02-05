# 📱 Web 配置界面使用指南

## 🎯 功能概述

Web 配置界面提供了一个简单易用的 H5 页面，让你可以在手机或电脑上随时修改监控配置，无需重启程序。

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动服务

**方式一：分别启动（推荐调试）**

```bash
# 终端 1：启动 Web 配置界面
npm run web

# 终端 2：启动监控程序
npm start
```

**方式二：一键启动（推荐生产）**

```bash
# macOS/Linux
chmod +x start-all.sh
./start-all.sh

# 或使用 PM2（更稳定）
pm2 start web-server.js --name "web"
pm2 start realtime-pnl.js --name "monitor"
pm2 save
```

### 3. 访问配置页面

- **本地访问**: http://localhost:3000
- **局域网访问**: http://你的IP:3000
- **手机访问**: 确保手机和电脑在同一局域网，访问 http://电脑IP:3000

## 📋 配置项说明

### 🎯 价格目标监控

设置价格达到或跌破某个值时触发通知。

- **币种**: 选择要监控的合约（ETH-USDT、BTC-USDT 等）
- **目标价格**: 设置目标价格（如 2300）
- **方向**: 
  - `达到 ≥`: 价格达到或超过目标价时通知
  - `跌破 ≤`: 价格跌破目标价时通知

**示例**：
- ETH-USDT 达到 2300 → 当 ETH 价格 ≥ 2300 时通知
- BTC-USDT 跌破 50000 → 当 BTC 价格 ≤ 50000 时通知

### 📋 监控合约列表

选择要监控的合约，即使没有持仓也会监控价格变化。

### ⏱️ 多时间窗口监控

监控价格在不同时间窗口的变化幅度，满足条件时通知。

- **变化幅度 (%)**: 价格变化百分比阈值
- **变化金额 (USDT)**: 价格变化金额阈值
- **通知间隔**: 同一合约最少间隔多久通知一次

**示例**：
- 5秒窗口：变化 0.05% 或 0.5 USDT → 快速波动提醒
- 1小时窗口：变化 1% 或 5 USDT → 趋势变化提醒

### 🔔 持仓通知配置

设置持仓盈亏通知条件。

**盈利通知**：
- 盈利比例：如 3% 表示盈利达到 3% 时通知
- 盈利金额：如 2 USDT 表示盈利达到 2 USDT 时通知

**亏损通知**：
- 亏损比例：如 5% 表示亏损达到 5% 时通知
- 亏损金额：如 2 USDT 表示亏损达到 2 USDT 时通知

**定时通知**：
- 间隔：每隔指定时间发送一次持仓汇总

## 🔄 配置热重载

配置保存后，监控程序会在 **10 秒内自动检测并应用新配置**，无需重启！

### 工作流程

1. 在 Web 页面修改配置（如 ETH-USDT 目标价 2200 → 2300）
2. 点击"保存配置"
3. 配置写入 `data/config.json`
4. 监控程序每 10 秒检查文件变化
5. 检测到变化后自动重载配置
6. 新配置立即生效

### 查看日志

监控程序会输出配置变化日志：

```
🔄 检测到配置变化，正在应用新配置...

✅ 新配置已应用

💡 持仓监控配置：
   盈利通知: ✅ 3% 或 2 USDT
   亏损通知: ❌ -5% 或 -2 USDT
   定时通知: ❌ 每 60 分钟

💡 行情监控配置：
   监控合约: ETH-USDT
   多时间窗口监控: ❌ 关闭
   价格目标监控: ✅ 开启
      - ETH-USDT: 达到 2300 USDT
```

## 📱 移动端使用

### iOS Safari

1. 访问配置页面
2. 点击底部"分享"按钮
3. 选择"添加到主屏幕"
4. 像 App 一样使用

### Android Chrome

1. 访问配置页面
2. 点击右上角菜单
3. 选择"添加到主屏幕"
4. 像 App 一样使用

## 🔐 安全建议

### 局域网使用（推荐）

只在局域网内访问，不暴露到公网。

### 公网访问（需要额外配置）

如果需要在外网访问：

1. **使用 Nginx 反向代理 + HTTPS**

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

2. **添加简单认证**（可选）

修改 `web-server.js` 添加密码保护：

```javascript
// 简单的 Basic Auth
app.use((req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || auth !== 'Basic ' + Buffer.from('user:password').toString('base64')) {
    res.setHeader('WWW-Authenticate', 'Basic');
    res.status(401).send('需要认证');
  } else {
    next();
  }
});
```

## 🐛 常见问题

### 配置修改后没有生效？

1. 检查监控程序是否正在运行
2. 查看监控程序日志，确认是否输出"配置已重新加载"
3. 等待最多 10 秒（配置检查间隔）

### 手机无法访问？

1. 确保手机和电脑在同一局域网
2. 检查电脑防火墙是否开放 3000 端口
3. 使用电脑的局域网 IP（不是 localhost）

### 页面显示空白？

1. 检查浏览器控制台是否有错误
2. 确认 `data/config.json` 文件格式正确
3. 尝试清除浏览器缓存

## 📊 数据展示（开发中）

数据展示功能即将支持：

- 📈 实时持仓盈亏
- 📊 盈亏曲线图
- 🎯 价格监控状态
- 📋 通知历史记录

## 💡 技术栈

- **前端**: Vue 3 (CDN) + 原生 CSS
- **后端**: Express.js
- **存储**: JSON 文件
- **通信**: HTTP REST API

简单、轻量、无数据库依赖！

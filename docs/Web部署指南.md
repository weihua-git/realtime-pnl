# 🚀 Web 配置界面部署指南

## 本地开发环境

### 1. 安装依赖

```bash
npm install
```

### 2. 启动服务

```bash
# 方式一：分别启动
npm run web      # 终端 1
npm start        # 终端 2

# 方式二：一键启动
./start-all.sh
```

### 3. 访问

- http://localhost:3000

---

## 服务器部署

### 方案一：使用 PM2（推荐）

#### 1. 安装 PM2

```bash
npm install -g pm2
```

#### 2. 启动服务

```bash
# 启动 Web 服务器
pm2 start web-server.js --name "htx-web"

# 启动监控程序
pm2 start realtime-pnl.js --name "htx-monitor"

# 保存配置
pm2 save

# 设置开机自启
pm2 startup
```

#### 3. 管理服务

```bash
# 查看状态
pm2 status

# 查看日志
pm2 logs htx-web
pm2 logs htx-monitor

# 重启服务
pm2 restart htx-web
pm2 restart htx-monitor

# 停止服务
pm2 stop htx-web
pm2 stop htx-monitor

# 删除服务
pm2 delete htx-web
pm2 delete htx-monitor
```

---

### 方案二：使用 systemd

#### 1. 创建服务文件

**Web 服务器**

```bash
sudo nano /etc/systemd/system/htx-web.service
```

```ini
[Unit]
Description=HTX Web Config Server
After=network.target

[Service]
Type=simple
User=你的用户名
WorkingDirectory=/path/to/htx-monitor
ExecStart=/usr/bin/node web-server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

**监控程序**

```bash
sudo nano /etc/systemd/system/htx-monitor.service
```

```ini
[Unit]
Description=HTX Monitor Service
After=network.target

[Service]
Type=simple
User=你的用户名
WorkingDirectory=/path/to/htx-monitor
ExecStart=/usr/bin/node realtime-pnl.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

#### 2. 启动服务

```bash
# 重载 systemd
sudo systemctl daemon-reload

# 启动服务
sudo systemctl start htx-web
sudo systemctl start htx-monitor

# 设置开机自启
sudo systemctl enable htx-web
sudo systemctl enable htx-monitor

# 查看状态
sudo systemctl status htx-web
sudo systemctl status htx-monitor
```

#### 3. 管理服务

```bash
# 查看日志
sudo journalctl -u htx-web -f
sudo journalctl -u htx-monitor -f

# 重启服务
sudo systemctl restart htx-web
sudo systemctl restart htx-monitor

# 停止服务
sudo systemctl stop htx-web
sudo systemctl stop htx-monitor
```

---

## Nginx 反向代理（可选）

### 1. 安装 Nginx

```bash
# Ubuntu/Debian
sudo apt install nginx

# CentOS/RHEL
sudo yum install nginx
```

### 2. 配置 Nginx

```bash
sudo nano /etc/nginx/sites-available/htx-monitor
```

```nginx
server {
    listen 80;
    server_name your-domain.com;  # 替换为你的域名或 IP

    # 访问日志
    access_log /var/log/nginx/htx-monitor.access.log;
    error_log /var/log/nginx/htx-monitor.error.log;

    # 反向代理到 Web 服务器
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 3. 启用配置

```bash
# 创建软链接
sudo ln -s /etc/nginx/sites-available/htx-monitor /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重启 Nginx
sudo systemctl restart nginx
```

### 4. 配置 HTTPS（推荐）

使用 Let's Encrypt 免费证书：

```bash
# 安装 Certbot
sudo apt install certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d your-domain.com

# 自动续期
sudo certbot renew --dry-run
```

Certbot 会自动修改 Nginx 配置，添加 HTTPS 支持。

---

## 防火墙配置

### Ubuntu/Debian (UFW)

```bash
# 开放 3000 端口（如果不使用 Nginx）
sudo ufw allow 3000

# 或开放 80/443 端口（使用 Nginx）
sudo ufw allow 80
sudo ufw allow 443

# 查看状态
sudo ufw status
```

### CentOS/RHEL (firewalld)

```bash
# 开放 3000 端口
sudo firewall-cmd --permanent --add-port=3000/tcp

# 或开放 80/443 端口
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https

# 重载配置
sudo firewall-cmd --reload
```

---

## 安全加固

### 1. 添加 Basic Auth

修改 `web-server.js`：

```javascript
// 在所有路由之前添加
app.use((req, res, next) => {
  const auth = req.headers.authorization;
  const credentials = Buffer.from('admin:your-password').toString('base64');
  
  if (!auth || auth !== `Basic ${credentials}`) {
    res.setHeader('WWW-Authenticate', 'Basic realm="HTX Monitor"');
    return res.status(401).send('需要认证');
  }
  
  next();
});
```

### 2. IP 白名单

```javascript
const allowedIPs = ['192.168.1.100', '10.0.0.50'];

app.use((req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  
  if (!allowedIPs.includes(clientIP)) {
    return res.status(403).send('访问被拒绝');
  }
  
  next();
});
```

### 3. 限流

```bash
npm install express-rate-limit
```

```javascript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 100 // 最多 100 个请求
});

app.use('/api/', limiter);
```

---

## 监控和日志

### PM2 监控

```bash
# 实时监控
pm2 monit

# Web 监控面板
pm2 install pm2-server-monit
```

### 日志管理

```bash
# PM2 日志
pm2 logs --lines 100

# 日志轮转
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

---

## 备份和恢复

### 备份配置

```bash
# 手动备份
cp data/config.json data/config.backup.$(date +%Y%m%d).json

# 定时备份（crontab）
0 2 * * * cp /path/to/htx-monitor/data/config.json /path/to/backup/config.$(date +\%Y\%m\%d).json
```

### 恢复配置

```bash
cp data/config.backup.20260205.json data/config.json
```

---

## 性能优化

### 1. 启用 Gzip 压缩

```javascript
import compression from 'compression';
app.use(compression());
```

### 2. 静态文件缓存

```javascript
app.use(express.static('web', {
  maxAge: '1d',
  etag: true
}));
```

### 3. Node.js 优化

```bash
# 增加内存限制
node --max-old-space-size=2048 web-server.js
```

---

## 故障排查

### 服务无法启动

```bash
# 检查端口占用
lsof -i :3000

# 检查日志
pm2 logs htx-web --err
```

### 配置不生效

```bash
# 检查文件权限
ls -la data/config.json

# 检查文件格式
cat data/config.json | jq .
```

### 内存泄漏

```bash
# 监控内存使用
pm2 monit

# 定期重启
pm2 restart htx-web --cron "0 3 * * *"
```

---

## 更新部署

### 1. 拉取最新代码

```bash
git pull origin main
```

### 2. 安装依赖

```bash
npm install
```

### 3. 重启服务

```bash
# PM2
pm2 restart all

# systemd
sudo systemctl restart htx-web htx-monitor
```

---

## 多实例部署

如果需要为多个用户部署独立实例：

```bash
# 用户 1
PORT=3001 pm2 start web-server.js --name "htx-web-user1"
pm2 start realtime-pnl.js --name "htx-monitor-user1"

# 用户 2
PORT=3002 pm2 start web-server.js --name "htx-web-user2"
pm2 start realtime-pnl.js --name "htx-monitor-user2"
```

---

## 云服务器推荐

- **阿里云 ECS**：1核2G 起步
- **腾讯云 CVM**：1核2G 起步
- **AWS EC2**：t2.micro（免费套餐）
- **DigitalOcean**：$5/月 起步

**配置要求**：
- CPU: 1 核
- 内存: 1GB（推荐 2GB）
- 硬盘: 20GB
- 带宽: 1Mbps

---

**部署完成后，记得测试所有功能！** 🎉

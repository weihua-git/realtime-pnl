# Redis 使用说明

## 📋 概述

项目已从文件存储迁移到 Redis，大幅提升配置和数据读写性能。

## 🚀 优势

### 性能对比
- **文件读写**: ~10-50ms
- **Redis 读写**: ~1-3ms
- **性能提升**: 10-50倍

### 其他优势
- ✅ 内存存储，极速读写
- ✅ 自动过期机制，无需手动清理
- ✅ 支持并发访问
- ✅ 数据持久化（可选）
- ✅ 更好的缓存支持

## 🔧 配置

### Redis 连接信息

配置通过 `.env` 文件设置：

```bash
# Redis 主机地址（默认：127.0.0.1）
REDIS_HOST=127.0.0.1

# Redis 端口（默认：6379）
REDIS_PORT=6379

# Redis 数据库编号（0-15，默认：3）
REDIS_DB=3

# Redis 密码（如果没有密码则留空或注释掉）
# REDIS_PASSWORD=your_password
```

### 不同环境配置示例

#### 本地开发环境
```bash
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_DB=3
# REDIS_PASSWORD=
```

#### 测试环境
```bash
REDIS_HOST=test-redis.example.com
REDIS_PORT=6379
REDIS_DB=3
REDIS_PASSWORD=test_password
```

#### 生产环境
```bash
REDIS_HOST=prod-redis.example.com
REDIS_PORT=6379
REDIS_DB=3
REDIS_PASSWORD=strong_password_here
```

### 启动 Redis
```bash
# macOS (Homebrew)
brew services start redis

# Linux
sudo systemctl start redis

# 或直接运行
redis-server
```

### 验证连接
```bash
# 测试 Redis 连接
node test-redis.js

# 或使用 redis-cli
redis-cli -n 3
> KEYS htx:*
```

## 📦 数据结构

### 键名前缀
所有键名使用 `htx:` 前缀，避免与其他应用冲突。

### 存储的数据

#### 1. 配置数据
- **键名**: `htx:config`
- **类型**: JSON 字符串
- **过期**: 永久
- **内容**: 监控配置、价格目标、通知设置等

#### 2. 实时价格
- **键名**: `htx:price:{symbol}`
- **类型**: JSON 字符串
- **过期**: 60秒
- **示例**: `htx:price:ETH-USDT`

#### 3. 持仓数据
- **键名**: `htx:positions`
- **类型**: JSON 字符串
- **过期**: 300秒（5分钟）

#### 4. 量化交易数据
- **键名**: `htx:quant`
- **类型**: JSON 字符串
- **过期**: 300秒（5分钟）

#### 5. 缓存数据
- **键名**: `htx:cache:{key}`
- **类型**: JSON 字符串
- **过期**: 可自定义（默认300秒）

## 🔍 常用命令

### 查看所有键
```bash
redis-cli -n 3
> KEYS htx:*
```

### 查看配置
```bash
> GET htx:config
```

### 查看价格
```bash
> GET htx:price:ETH-USDT
```

### 清空所有数据
```bash
> FLUSHDB
```

### 查看键的过期时间
```bash
> TTL htx:price:ETH-USDT
```

## 📊 监控

### 查看 Redis 状态
```bash
redis-cli -n 3 INFO
```

### 查看内存使用
```bash
redis-cli -n 3 INFO memory
```

### 实时监控命令
```bash
redis-cli -n 3 MONITOR
```

## 🛠️ API 使用

### 配置管理
```javascript
import { redisClient } from './redis-client.js';

// 保存配置
await redisClient.saveConfig(config);

// 读取配置
const config = await redisClient.getConfig();
```

### 价格数据
```javascript
// 保存价格
await redisClient.savePrice('ETH-USDT', {
  price: 1900.50,
  timestamp: Date.now()
});

// 读取价格
const price = await redisClient.getPrice('ETH-USDT');

// 批量读取所有价格
const allPrices = await redisClient.getAllPrices();
```

### 缓存操作
```javascript
// 设置缓存（TTL 60秒）
await redisClient.setCache('my-key', { data: 'value' }, 60);

// 读取缓存
const data = await redisClient.getCache('my-key');

// 删除缓存
await redisClient.delCache('my-key');

// 清空所有缓存
await redisClient.clearAllCache();
```

## ⚠️ 注意事项

1. **Redis 必须运行**: 确保 Redis 服务已启动
2. **DB 隔离**: 使用 DB 3，不影响其他应用
3. **数据过期**: 价格和持仓数据会自动过期，配置数据永久保存
4. **错误处理**: 代码已包含 Redis 连接失败的降级处理
5. **性能**: Redis 在内存中运行，重启后数据会丢失（除非开启持久化）

## 🔄 迁移说明

### 从文件迁移到 Redis

如果你之前使用文件存储，首次启动时：

1. 程序会自动从 Redis 读取配置
2. 如果 Redis 中没有配置，会使用默认配置
3. 旧的 `data/config.json` 文件不再使用（可以删除）

### 数据备份

虽然 Redis 很快，但建议定期备份重要配置：

```bash
# 导出配置
redis-cli -n 3 GET htx:config > config-backup.json

# 恢复配置
redis-cli -n 3 SET htx:config "$(cat config-backup.json)"
```

## 🐛 故障排查

### Redis 连接失败
```bash
# 检查 Redis 是否运行
redis-cli ping
# 应该返回 PONG

# 检查端口
lsof -i :6379

# 查看日志
tail -f /usr/local/var/log/redis.log
```

### 数据丢失
- Redis 默认不持久化，重启会丢失数据
- 如需持久化，修改 `redis.conf` 开启 AOF 或 RDB

### 性能问题
- 检查内存使用: `redis-cli INFO memory`
- 清理过期键: `redis-cli -n 3 FLUSHDB`
- 优化 TTL 设置

## 📈 性能优化建议

1. **合理设置 TTL**: 根据数据更新频率设置过期时间
2. **批量操作**: 使用 `getAllPrices()` 而不是多次 `getPrice()`
3. **避免大键**: 单个键值不要超过 1MB
4. **监控内存**: 定期检查 Redis 内存使用情况

## 🎯 最佳实践

1. ✅ 使用统一的键名前缀 (`htx:`)
2. ✅ 为临时数据设置合理的 TTL
3. ✅ 使用 JSON 格式存储复杂数据
4. ✅ 捕获并处理 Redis 错误
5. ✅ 定期备份重要配置数据

import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Redis 客户端封装
 * 用于替代文件读写，提升性能
 */
class RedisClient {
  constructor() {
    // 从环境变量读取配置
    const config = {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      db: parseInt(process.env.REDIS_DB || '3'),
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false
    };

    // 如果设置了密码，添加到配置中
    if (process.env.REDIS_PASSWORD) {
      config.password = process.env.REDIS_PASSWORD;
    }

    console.log(`🔧 Redis: ${config.host}:${config.port} DB ${config.db}`);

    this.redis = new Redis(config);
    this.isReady = false;

    this.redis.on('connect', () => {
      console.log(`✅ Redis 已连接 (DB ${config.db})`);
    });

    this.redis.on('ready', () => {
      this.isReady = true;
    });

    this.redis.on('error', (err) => {
      console.error('❌ Redis 错误:', err.message);
    });

    this.redis.on('close', () => {
      this.isReady = false;
    });

    // 键名前缀
    this.PREFIX = 'htx:';
  }

  /**
   * 等待 Redis 就绪
   */
  async waitForReady(timeout = 5000) {
    if (this.isReady) {
      return true;
    }

    const startTime = Date.now();
    while (!this.isReady && Date.now() - startTime < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return this.isReady;
  }

  /**
   * 获取配置
   */
  async getConfig() {
    try {
      const data = await this.redis.get(`${this.PREFIX}config`);
      if (data) {
        return JSON.parse(data);
      }
      return null;
    } catch (error) {
      console.error('❌ Redis 获取配置失败:', error.message);
      return null;
    }
  }

  /**
   * 保存配置
   */
  async saveConfig(config) {
    try {
      await this.redis.set(`${this.PREFIX}config`, JSON.stringify(config));
      return true;
    } catch (error) {
      console.error('❌ Redis 保存配置失败:', error.message);
      return false;
    }
  }

  /**
   * 获取实时数据
   */
  async getRealtimeData() {
    try {
      const data = await this.redis.get(`${this.PREFIX}realtime`);
      if (data) {
        return JSON.parse(data);
      }
      return null;
    } catch (error) {
      console.error('❌ Redis 获取实时数据失败:', error.message);
      return null;
    }
  }

  /**
   * 保存实时数据
   */
  async saveRealtimeData(data) {
    try {
      await this.redis.set(`${this.PREFIX}realtime`, JSON.stringify(data), 'EX', 300); // 5分钟过期
      return true;
    } catch (error) {
      console.error('❌ Redis 保存实时数据失败:', error.message);
      return false;
    }
  }

  /**
   * 获取价格数据
   */
  async getPrice(symbol) {
    try {
      const data = await this.redis.get(`${this.PREFIX}price:${symbol}`);
      if (data) {
        return JSON.parse(data);
      }
      return null;
    } catch (error) {
      console.error(`❌ Redis 获取价格失败 (${symbol}):`, error.message);
      return null;
    }
  }

  /**
   * 保存价格数据
   */
  async savePrice(symbol, priceData) {
    try {
      await this.redis.set(
        `${this.PREFIX}price:${symbol}`,
        JSON.stringify(priceData),
        'EX',
        60 // 1分钟过期
      );
      return true;
    } catch (error) {
      console.error(`❌ Redis 保存价格失败 (${symbol}):`, error.message);
      return false;
    }
  }

  /**
   * 批量获取价格
   */
  async getAllPrices() {
    try {
      const keys = await this.redis.keys(`${this.PREFIX}price:*`);
      if (keys.length === 0) {
        return {};
      }

      const values = await this.redis.mget(keys);
      const prices = {};

      keys.forEach((key, index) => {
        const symbol = key.replace(`${this.PREFIX}price:`, '');
        if (values[index]) {
          try {
            prices[symbol] = JSON.parse(values[index]);
          } catch (error) {
            console.error(`解析价格数据失败 (${symbol}):`, error.message);
          }
        }
      });

      return prices;
    } catch (error) {
      console.error('❌ Redis 批量获取价格失败:', error.message);
      return {};
    }
  }

  /**
   * 获取持仓数据
   */
  async getPositions() {
    try {
      const data = await this.redis.get(`${this.PREFIX}positions`);
      if (data) {
        return JSON.parse(data);
      }
      return {};
    } catch (error) {
      console.error('❌ Redis 获取持仓失败:', error.message);
      return {};
    }
  }

  /**
   * 保存持仓数据
   */
  async savePositions(positions) {
    try {
      await this.redis.set(`${this.PREFIX}positions`, JSON.stringify(positions), 'EX', 300);
      return true;
    } catch (error) {
      console.error('❌ Redis 保存持仓失败:', error.message);
      return false;
    }
  }

  /**
   * 获取量化交易数据
   */
  async getQuantData() {
    try {
      const data = await this.redis.get(`${this.PREFIX}quant`);
      if (data) {
        return JSON.parse(data);
      }
      return null;
    } catch (error) {
      console.error('❌ Redis 获取量化数据失败:', error.message);
      return null;
    }
  }

  /**
   * 保存量化交易数据
   */
  async saveQuantData(quantData) {
    try {
      await this.redis.set(`${this.PREFIX}quant`, JSON.stringify(quantData), 'EX', 300);
      return true;
    } catch (error) {
      console.error('❌ Redis 保存量化数据失败:', error.message);
      return false;
    }
  }

  /**
   * 设置缓存（通用）
   */
  async setCache(key, value, ttl = 300) {
    try {
      const fullKey = `${this.PREFIX}cache:${key}`;
      if (ttl > 0) {
        await this.redis.set(fullKey, JSON.stringify(value), 'EX', ttl);
      } else {
        // ttl = 0 表示永久保存
        await this.redis.set(fullKey, JSON.stringify(value));
      }
      return true;
    } catch (error) {
      console.error(`❌ Redis 设置缓存失败 (${key}):`, error.message);
      return false;
    }
  }

  /**
   * 获取缓存（通用）
   */
  async getCache(key) {
    try {
      const data = await this.redis.get(`${this.PREFIX}cache:${key}`);
      if (data) {
        return JSON.parse(data);
      }
      return null;
    } catch (error) {
      console.error(`❌ Redis 获取缓存失败 (${key}):`, error.message);
      return null;
    }
  }

  /**
   * 删除缓存
   */
  async delCache(key) {
    try {
      await this.redis.del(`${this.PREFIX}cache:${key}`);
      return true;
    } catch (error) {
      console.error(`❌ Redis 删除缓存失败 (${key}):`, error.message);
      return false;
    }
  }

  /**
   * 清空所有缓存
   */
  async clearAllCache() {
    try {
      const keys = await this.redis.keys(`${this.PREFIX}cache:*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      return true;
    } catch (error) {
      console.error('❌ Redis 清空缓存失败:', error.message);
      return false;
    }
  }

  /**
   * 关闭连接
   */
  async close() {
    await this.redis.quit();
  }

  /**
   * 检查连接状态
   */
  isConnected() {
    return this.redis.status === 'ready';
  }
}

// 导出单例
export const redisClient = new RedisClient();

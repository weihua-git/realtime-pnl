import { EventEmitter } from 'events';
import { redisClient } from './redis-client.js';

/**
 * 配置管理器 - 使用 Redis 存储，支持热重载
 */
class ConfigManager extends EventEmitter {
  constructor() {
    super();
    this.config = null;
    this.checkInterval = null;
    this.lastConfigHash = null;
  }

  // 加载配置（从 Redis）
  async loadConfig() {
    try {
      // 等待 Redis 就绪
      const ready = await redisClient.waitForReady(5000);
      if (!ready) {
        console.warn('⚠️  Redis 未就绪，使用默认配置');
        this.config = this.getDefaultConfig();
        return this.config;
      }

      const newConfig = await redisClient.getConfig();
      
      if (!newConfig) {
        // Redis 中没有配置，使用默认配置并保存
        this.config = this.getDefaultConfig();
        await redisClient.saveConfig(this.config);
        return this.config;
      }
      
      // 检查配置是否变化
      const newHash = JSON.stringify(newConfig);
      const configChanged = this.lastConfigHash !== newHash;
      
      if (configChanged) {
        this.config = newConfig;
        this.lastConfigHash = newHash;
        this.emit('configChanged', this.config);
      }
      
      return this.config;
    } catch (error) {
      console.error('❌ 从 Redis 加载配置失败:', error.message);
      
      // 如果 Redis 失败，使用默认配置
      if (!this.config) {
        this.config = this.getDefaultConfig();
      }
      
      return this.config;
    }
  }

  // 默认配置
  getDefaultConfig() {
    return {
      watchContracts: ['ETH-USDT'],
      priceChangeConfig: {
        enabled: false,
        timeWindows: [
          { duration: 5 * 1000, threshold: 0.05, amountThreshold: 0.5, name: '5秒' },
          { duration: 10 * 1000, threshold: 0.1, amountThreshold: 1, name: '10秒' },
          { duration: 30 * 1000, threshold: 0.5, amountThreshold: 1.1, name: '30秒' },
          { duration: 60 * 1000, threshold: 0.5, amountThreshold: 2, name: '1分钟' },
          { duration: 5 * 60 * 1000, threshold: 1, amountThreshold: 5, name: '5分钟' },
          { duration: 60 * 60 * 1000, threshold: 1, amountThreshold: 5, name: '1小时' },
        ],
        minNotifyInterval: 2 * 60 * 1000,
      },
      priceTargets: {
        enabled: true,
        targets: [
          {
            symbol: 'ETH-USDT',
            targetPrice: 2200,
            direction: 'above',
            notifyOnce: false,
            notifyInterval: 60,
            rangePercent: 0,
            lastNotifyTime: 0,
          },
        ],
      },
      notificationConfig: {
        profitThreshold: 3,
        lossThreshold: -5,
        profitAmountThreshold: 2,
        lossAmountThreshold: -2,
        timeInterval: 3600000,
        repeatInterval: 5000,
        enableTimeNotification: false,
        enableProfitNotification: true,
        enableLossNotification: false,
      }
    };
  }

  // 启动配置监听（每 5 秒检查一次 Redis）
  startWatching() {
    this.checkInterval = setInterval(async () => {
      await this.loadConfig();
    }, 5000); // Redis 更快，可以更频繁检查
  }

  // 停止监听
  stopWatching() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  // 获取当前配置
  getConfig() {
    return this.config;
  }

  // 保存配置到 Redis
  async saveConfig(newConfig) {
    try {
      const success = await redisClient.saveConfig(newConfig);
      
      if (success) {
        this.config = newConfig;
        this.lastConfigHash = JSON.stringify(newConfig);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('❌ 保存配置到 Redis 失败:', error.message);
      return false;
    }
  }
}

// 创建全局配置管理器实例
const configManager = new ConfigManager();

// 初始化加载配置
await configManager.loadConfig();

// 导出配置对象（兼容旧代码）
export const marketConfig = configManager.getConfig();

// 导出配置管理器
export { configManager };

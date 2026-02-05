import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG_FILE = path.join(__dirname, 'data', 'config.json');

/**
 * 配置管理器 - 支持热重载
 */
class ConfigManager extends EventEmitter {
  constructor() {
    super();
    this.config = null;
    this.lastModified = null;
    this.checkInterval = null;
  }

  // 加载配置
  async loadConfig() {
    try {
      const data = await fs.readFile(CONFIG_FILE, 'utf-8');
      const stats = await fs.stat(CONFIG_FILE);
      
      const newConfig = JSON.parse(data);
      const configChanged = JSON.stringify(this.config) !== JSON.stringify(newConfig);
      
      if (configChanged) {
        this.config = newConfig;
        this.lastModified = stats.mtimeMs;
        this.emit('configChanged', this.config);
        console.log('🔄 配置已重新加载');
      }
      
      return this.config;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // 文件不存在，使用默认配置
        this.config = this.getDefaultConfig();
        console.log('⚠️  配置文件不存在，使用默认配置');
      } else {
        console.error('❌ 加载配置失败:', error.message);
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

  // 启动配置监听（每 10 秒检查一次）
  startWatching() {
    this.checkInterval = setInterval(async () => {
      await this.loadConfig();
    }, 10000);
    console.log('👀 配置文件监听已启动（每 10 秒检查一次）');
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

  // 保存配置到文件
  async saveConfig(newConfig) {
    try {
      await fs.writeFile(CONFIG_FILE, JSON.stringify(newConfig, null, 2), 'utf-8');
      this.config = newConfig;
      const stats = await fs.stat(CONFIG_FILE);
      this.lastModified = stats.mtimeMs;
      console.log('💾 配置已保存');
      return true;
    } catch (error) {
      console.error('❌ 保存配置失败:', error.message);
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

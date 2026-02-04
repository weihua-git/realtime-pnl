import { TelegramNotifier } from './telegram-notifier.js';
import { BarkNotifier } from './bark-notifier.js';

/**
 * 统一通知器
 * 支持同时使用 Telegram 和 Bark，或单独使用任一通知方式
 */
export class UnifiedNotifier {
  constructor(config = {}) {
    this.notifiers = [];
    
    // 初始化 Telegram 通知器
    if (config.telegram && config.telegram.botToken && config.telegram.chatId) {
      try {
        this.telegramNotifier = new TelegramNotifier(
          config.telegram.botToken,
          config.telegram.chatId,
          config.notificationConfig || {}
        );
        this.notifiers.push({
          name: 'Telegram',
          instance: this.telegramNotifier
        });
        console.log('✅ Telegram 通知器已启用');
      } catch (error) {
        console.error('❌ Telegram 通知器初始化失败:', error.message);
      }
    }
    
    // 初始化 Bark 通知器
    if (config.bark && config.bark.key) {
      try {
        this.barkNotifier = new BarkNotifier(
          config.bark.key,
          {
            ...config.notificationConfig,
            barkServer: config.bark.server,
            sound: config.bark.sound,
            group: config.bark.group,
            autoCopy: config.bark.autoCopy
          }
        );
        this.notifiers.push({
          name: 'Bark',
          instance: this.barkNotifier
        });
        console.log('✅ Bark 通知器已启用');
      } catch (error) {
        console.error('❌ Bark 通知器初始化失败:', error.message);
      }
    }
    
    if (this.notifiers.length === 0) {
      console.warn('⚠️ 未配置任何通知方式，通知功能将不可用');
    } else {
      console.log(`📢 已启用 ${this.notifiers.length} 个通知渠道: ${this.notifiers.map(n => n.name).join(', ')}`);
    }
  }

  /**
   * 发送持仓盈亏通知到所有启用的通知器
   */
  async notifyPositionPnL(positionData) {
    if (this.notifiers.length === 0) {
      return false;
    }
    
    const results = await Promise.allSettled(
      this.notifiers.map(notifier => 
        notifier.instance.notifyPositionPnL(positionData)
      )
    );
    
    // 只要有一个成功就返回 true
    return results.some(result => result.status === 'fulfilled' && result.value === true);
  }

  /**
   * 发送定时汇总通知到所有启用的通知器
   */
  async notifyTimeSummary(positions) {
    if (this.notifiers.length === 0) {
      return false;
    }
    
    const results = await Promise.allSettled(
      this.notifiers.map(notifier => 
        notifier.instance.notifyTimeSummary(positions)
      )
    );
    
    return results.some(result => result.status === 'fulfilled' && result.value === true);
  }

  /**
   * 发送自定义通知
   * @param {string} message - 消息内容（Telegram 使用）
   * @param {string} title - 标题（Bark 使用）
   * @param {string} body - 内容（Bark 使用）
   * @param {object} options - 额外选项
   */
  async notify(message, title = '', body = '', options = {}) {
    if (this.notifiers.length === 0) {
      return false;
    }
    
    const promises = this.notifiers.map(notifier => {
      if (notifier.name === 'Telegram') {
        return notifier.instance.notify(message, options);
      } else if (notifier.name === 'Bark') {
        return notifier.instance.notify(title || '通知', body || message, options);
      }
    });
    
    const results = await Promise.allSettled(promises);
    return results.some(result => result.status === 'fulfilled' && result.value === true);
  }

  /**
   * 测试所有通知器
   */
  async testNotification() {
    if (this.notifiers.length === 0) {
      console.error('❌ 未配置任何通知方式');
      return false;
    }
    
    console.log(`\n🧪 开始测试 ${this.notifiers.length} 个通知渠道...\n`);
    
    const results = await Promise.allSettled(
      this.notifiers.map(async (notifier) => {
        console.log(`📤 测试 ${notifier.name} 通知...`);
        const success = await notifier.instance.testNotification();
        if (success) {
          console.log(`✅ ${notifier.name} 测试成功`);
        } else {
          console.log(`❌ ${notifier.name} 测试失败`);
        }
        return { name: notifier.name, success };
      })
    );
    
    const successCount = results.filter(
      r => r.status === 'fulfilled' && r.value.success
    ).length;
    
    console.log(`\n📊 测试完成: ${successCount}/${this.notifiers.length} 个通知渠道可用\n`);
    
    return successCount > 0;
  }

  /**
   * 获取所有通知器的历史记录
   */
  getAllNotificationHistory(limit = 10) {
    const history = {};
    
    this.notifiers.forEach(notifier => {
      history[notifier.name] = notifier.instance.getNotificationHistory(limit);
    });
    
    return history;
  }

  /**
   * 清除所有通知器的历史记录
   */
  clearAllNotificationHistory() {
    this.notifiers.forEach(notifier => {
      notifier.instance.clearNotificationHistory();
    });
  }

  /**
   * 获取已启用的通知器列表
   */
  getEnabledNotifiers() {
    return this.notifiers.map(n => n.name);
  }

  /**
   * 检查是否有可用的通知器
   */
  hasNotifiers() {
    return this.notifiers.length > 0;
  }
}

import axios from 'axios';

/**
 * Bark 通知器（iOS 专用，低延迟推送）
 * 使用 Apple Push Notification Service (APNs)
 * 延迟 < 1 秒，完全免费
 */
export class BarkNotifier {
  constructor(barkKey, config = {}) {
    this.barkKey = barkKey;
    this.baseUrl = config.barkServer || 'https://api.day.app';
    
    // 通知配置
    this.config = {
      // 盈利通知阈值（百分比）
      profitThreshold: config.profitThreshold || 3,
      // 亏损通知阈值（百分比）
      lossThreshold: config.lossThreshold || -5,
      // 盈利通知阈值（绝对金额 USDT）
      profitAmountThreshold: config.profitAmountThreshold || null,
      // 亏损通知阈值（绝对金额 USDT）
      lossAmountThreshold: config.lossAmountThreshold || null,
      // 时间通知间隔（毫秒）
      timeInterval: config.timeInterval || 3600000, // 默认 1 小时
      // 是否启用时间通知
      enableTimeNotification: config.enableTimeNotification !== false,
      // 是否启用盈利通知
      enableProfitNotification: config.enableProfitNotification !== false,
      // 是否启用亏损通知
      enableLossNotification: config.enableLossNotification !== false,
      // 重复通知间隔（避免频繁通知）
      repeatInterval: config.repeatInterval || 300000, // 5 分钟
      // Bark 音效（可选：alarm, bell, glass, horn, minuet, multiwayinvitation, 
      //              newmail, noir, paymentsuccess, shake, sherwoodforest, spell, telegraph）
      sound: config.sound || 'bell',
      // 通知分组
      group: config.group || 'HTX交易',
      // 是否自动复制内容到剪贴板
      autoCopy: config.autoCopy || false,
    };
    
    // 通知状态跟踪
    this.lastNotification = {};
    this.lastTimeNotification = Date.now();
    this.notificationHistory = [];
    
    // 阈值状态跟踪（用于边界触发）
    this.thresholdState = {};
  }

  /**
   * 发送 Bark 通知
   * @param {string} title - 通知标题
   * @param {string} body - 通知内容
   * @param {object} options - 额外选项
   */
  async sendNotification(title, body, options = {}) {
    try {
      const params = {
        title: title,
        body: body,
        group: options.group || this.config.group,
        icon: options.icon || undefined,
        level: options.level || 'active', // active, timeSensitive, passive
        badge: options.badge || undefined,
        autoCopy: options.autoCopy ? '1' : undefined,
        url: options.url || undefined,
      };
      
      // 处理 sound 参数：空字符串表示静音，不传 sound 参数
      if (options.sound !== undefined && options.sound !== '') {
        params.sound = options.sound;
      } else if (options.sound === undefined) {
        // 如果没有指定 sound，使用默认配置
        params.sound = this.config.sound;
      }
      // 如果 options.sound === ''，则不添加 sound 参数（静音）

      // 移除 undefined 值
      Object.keys(params).forEach(key => params[key] === undefined && delete params[key]);

      const url = `${this.baseUrl}/${this.barkKey}`;
      
      const response = await axios.post(url, params, {
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        }
      });
      
      if (response.data.code === 200) {
        console.log('✅ Bark 通知发送成功');
        return true;
      } else {
        console.error('❌ Bark 通知发送失败:', response.data.message);
        return false;
      }
    } catch (error) {
      console.error('❌ Bark 通知发送错误:', error.message);
      return false;
    }
  }

  /**
   * 检查是否应该发送通知（智能触发）
   */
  shouldNotify(key, profitRate, profitAmount) {
    const now = Date.now();
    
    const currentState = this.thresholdState[key] || {
      aboveProfitThreshold: false,
      belowLossThreshold: false,
      lastNotifyTime: 0,
      lastNotifyRate: null,
      lastNotifyAmount: null,
    };
    
    let shouldSend = false;
    
    // 检查盈利阈值
    const reachedProfitRate = this.config.enableProfitNotification && 
                               profitRate >= this.config.profitThreshold;
    const reachedProfitAmount = this.config.enableProfitNotification && 
                                this.config.profitAmountThreshold !== null && 
                                profitAmount >= this.config.profitAmountThreshold;
    
    if (reachedProfitRate || reachedProfitAmount) {
      if (!currentState.aboveProfitThreshold) {
        shouldSend = true;
        currentState.aboveProfitThreshold = true;
        currentState.belowLossThreshold = false;
        currentState.lastNotifyRate = profitRate;
        currentState.lastNotifyAmount = profitAmount;
      } else {
        // 继续上升检查
        let shouldNotifyContinue = false;
        
        if (currentState.lastNotifyRate !== null) {
          const rateChange = profitRate - currentState.lastNotifyRate;
          if (rateChange >= 1.0) {
            shouldNotifyContinue = true;
          }
        }
        
        if (this.config.profitAmountThreshold !== null && currentState.lastNotifyAmount !== null) {
          const amountChange = profitAmount - currentState.lastNotifyAmount;
          if (amountChange >= 1.0) {
            shouldNotifyContinue = true;
          }
        }
        
        if (shouldNotifyContinue) {
          shouldSend = true;
          currentState.lastNotifyRate = profitRate;
          currentState.lastNotifyAmount = profitAmount;
        }
      }
    } else if (profitRate < this.config.profitThreshold - 0.5 && 
               (this.config.profitAmountThreshold === null || profitAmount < this.config.profitAmountThreshold - 0.5)) {
      currentState.aboveProfitThreshold = false;
      currentState.lastNotifyRate = null;
      currentState.lastNotifyAmount = null;
    }
    
    // 检查亏损阈值
    const reachedLossRate = this.config.enableLossNotification && 
                            profitRate <= this.config.lossThreshold;
    const reachedLossAmount = this.config.enableLossNotification && 
                              this.config.lossAmountThreshold !== null && 
                              profitAmount <= this.config.lossAmountThreshold;
    
    if (reachedLossRate || reachedLossAmount) {
      if (!currentState.belowLossThreshold) {
        shouldSend = true;
        currentState.belowLossThreshold = true;
        currentState.aboveProfitThreshold = false;
        currentState.lastNotifyRate = profitRate;
        currentState.lastNotifyAmount = profitAmount;
      } else {
        // 继续下降检查
        let shouldNotifyContinue = false;
        
        if (currentState.lastNotifyRate !== null) {
          const rateChange = currentState.lastNotifyRate - profitRate;
          if (rateChange >= 1.0) {
            shouldNotifyContinue = true;
          }
        }
        
        if (this.config.lossAmountThreshold !== null && currentState.lastNotifyAmount !== null) {
          const amountChange = currentState.lastNotifyAmount - profitAmount;
          if (amountChange >= 1.0) {
            shouldNotifyContinue = true;
          }
        }
        
        if (shouldNotifyContinue) {
          shouldSend = true;
          currentState.lastNotifyRate = profitRate;
          currentState.lastNotifyAmount = profitAmount;
        }
      }
    } else if (profitRate > this.config.lossThreshold + 0.5 && 
               (this.config.lossAmountThreshold === null || profitAmount > this.config.lossAmountThreshold + 0.5)) {
      currentState.belowLossThreshold = false;
      currentState.lastNotifyRate = null;
      currentState.lastNotifyAmount = null;
    }
    
    this.thresholdState[key] = currentState;
    
    if (shouldSend) {
      const timeSinceLastNotify = now - currentState.lastNotifyTime;
      if (timeSinceLastNotify >= this.config.repeatInterval) {
        currentState.lastNotifyTime = now;
        return true;
      }
    }
    
    return false;
  }

  /**
   * 检查是否应该发送定时通知
   */
  shouldNotifyByTime() {
    const now = Date.now();
    if (!this.config.enableTimeNotification) {
      return false;
    }
    
    if (now - this.lastTimeNotification >= this.config.timeInterval) {
      this.lastTimeNotification = now;
      return true;
    }
    
    return false;
  }

  /**
   * 发送持仓盈亏通知
   */
  async notifyPositionPnL(positionData) {
    const {
      contractCode,
      direction,
      volume,
      actualPosition,
      lastPrice,
      costOpen,
      profitUnreal,
      profitRate
    } = positionData;
    
    const key = `${contractCode}_${direction}`;
    
    if (!this.shouldNotify(key, profitRate, profitUnreal)) {
      return false;
    }
    
    const directionText = direction === 'buy' ? '多仓' : '空仓';
    const emoji = profitRate >= 0 ? '📈' : '📉';
    
    // 标题
    const title = profitRate >= this.config.profitThreshold 
      ? `🎉 ${contractCode} 盈利 ${profitRate.toFixed(2)}%`
      : `⚠️ ${contractCode} 亏损 ${Math.abs(profitRate).toFixed(2)}%`;
    
    // 内容
    const body = `${emoji} ${directionText} ${volume}张
💰 盈亏: ${profitUnreal.toFixed(2)} USDT
📊 价格: ${lastPrice.toFixed(2)} (成本 ${costOpen.toFixed(2)})
📍 持仓: ${actualPosition.toFixed(4)} ${contractCode.split('-')[0]}`;
    
    // 根据盈亏设置不同的音效和级别
    const isProfitable = profitRate >= this.config.profitThreshold;
    const isLoss = profitRate <= this.config.lossThreshold;
    
    const options = {
      sound: isProfitable ? 'paymentsuccess' : (isLoss ? 'alarm' : 'bell'),
      level: Math.abs(profitRate) >= 10 ? 'timeSensitive' : 'active',
      icon: profitRate >= 0 ? 'https://cdn-icons-png.flaticon.com/512/7518/7518366.png' : 
                              'https://cdn-icons-png.flaticon.com/512/7518/7518329.png'
    };
    
    const success = await this.sendNotification(title, body, options);
    
    if (success) {
      this.notificationHistory.push({
        time: Date.now(),
        type: 'pnl',
        contractCode,
        direction,
        profitRate,
        profitUnreal
      });
    }
    
    return success;
  }

  /**
   * 发送定时汇总通知
   */
  async notifyTimeSummary(positions) {
    if (!this.shouldNotifyByTime()) {
      return false;
    }
    
    if (positions.length === 0) {
      return false;
    }
    
    let totalProfit = 0;
    let totalMargin = 0;
    
    positions.forEach(pos => {
      totalProfit += pos.profitUnreal;
      totalMargin += pos.positionMargin;
    });
    
    const totalRate = totalMargin > 0 ? (totalProfit / totalMargin * 100) : 0;
    
    const title = `📊 持仓汇总 ${totalRate >= 0 ? '📈' : '📉'} ${totalRate.toFixed(2)}%`;
    
    const positionLines = positions.map(pos => {
      const emoji = pos.profitRate >= 0 ? '📈' : '📉';
      const dir = pos.direction === 'buy' ? '多' : '空';
      return `${emoji} ${pos.contractCode} ${dir}: ${pos.profitUnreal.toFixed(2)} (${pos.profitRate.toFixed(2)}%)`;
    }).join('\n');
    
    const body = `💰 总盈亏: ${totalProfit.toFixed(2)} USDT
📊 总收益率: ${totalRate.toFixed(2)}%
📋 持仓数: ${positions.length}

${positionLines}`;
    
    const options = {
      sound: 'bell',
      level: 'active'
    };
    
    const success = await this.sendNotification(title, body, options);
    
    if (success) {
      this.notificationHistory.push({
        time: Date.now(),
        type: 'summary',
        totalProfit,
        totalRate,
        positionCount: positions.length
      });
    }
    
    return success;
  }

  /**
   * 发送自定义通知
   */
  async notify(title, body, options = {}) {
    return await this.sendNotification(title, body, options);
  }

  /**
   * 测试通知
   */
  async testNotification() {
    const title = '🤖 HTX 监控机器人';
    const body = `✅ Bark 通知测试成功！

📋 当前配置
盈利阈值: ${this.config.profitThreshold}%
亏损阈值: ${this.config.lossThreshold}%
定时间隔: ${this.config.timeInterval / 60000} 分钟

⏰ ${new Date().toLocaleString('zh-CN')}`;
    
    const options = {
      sound: 'bell',
      level: 'active'
    };
    
    return await this.sendNotification(title, body, options);
  }

  /**
   * 获取通知历史
   */
  getNotificationHistory(limit = 10) {
    return this.notificationHistory.slice(-limit);
  }

  /**
   * 清除通知历史
   */
  clearNotificationHistory() {
    this.notificationHistory = [];
    this.lastNotification = {};
  }
}

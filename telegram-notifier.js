import axios from 'axios';

/**
 * Telegram 通知器
 * 用于发送交易通知到 Telegram
 */
export class TelegramNotifier {
  constructor(botToken, chatId, config = {}) {
    this.botToken = botToken;
    this.chatId = chatId;
    this.apiUrl = `https://api.telegram.org/bot${botToken}`;
    
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
    };
    
    // 通知状态跟踪
    this.lastNotification = {};
    this.lastTimeNotification = Date.now();
    this.notificationHistory = [];
    
    // 阈值状态跟踪（用于边界触发）
    this.thresholdState = {}; // 记录每个持仓是否在阈值范围内
  }

  /**
   * 发送消息到 Telegram
   */
  async sendMessage(text, options = {}) {
    try {
      const response = await axios.post(`${this.apiUrl}/sendMessage`, {
        chat_id: this.chatId,
        text: text,
        parse_mode: options.parseMode || 'Markdown',
        disable_notification: options.silent || false,
      });
      
      if (response.data.ok) {
        console.log('✅ Telegram 通知发送成功');
        return true;
      } else {
        console.error('❌ Telegram 通知发送失败:', response.data.description);
        return false;
      }
    } catch (error) {
      console.error('❌ Telegram 通知发送错误:', error.message);
      return false;
    }
  }

  /**
   * 检查是否应该发送通知（智能触发）
   * 1. 首次达到阈值通知（百分比或金额）
   * 2. 跌破后再次达到通知
   * 3. 持续上升/下降每变化一定幅度通知
   */
  shouldNotify(key, profitRate, profitAmount) {
    const now = Date.now();
    
    // 获取当前状态
    const currentState = this.thresholdState[key] || {
      aboveProfitThreshold: false,
      belowLossThreshold: false,
      lastNotifyTime: 0,
      lastNotifyRate: null,     // 上次通知时的收益率
      lastNotifyAmount: null,   // 上次通知时的盈亏金额
    };
    
    let shouldSend = false;
    let notifyType = null;
    
    // 检查盈利阈值（百分比或金额，满足任一即可）
    const reachedProfitRate = this.config.enableProfitNotification && 
                               profitRate >= this.config.profitThreshold;
    const reachedProfitAmount = this.config.enableProfitNotification && 
                                this.config.profitAmountThreshold !== null && 
                                profitAmount >= this.config.profitAmountThreshold;
    
    if (reachedProfitRate || reachedProfitAmount) {
      if (!currentState.aboveProfitThreshold) {
        // 首次达到阈值
        shouldSend = true;
        notifyType = 'profit';
        currentState.aboveProfitThreshold = true;
        currentState.belowLossThreshold = false;
        currentState.lastNotifyRate = profitRate;
        currentState.lastNotifyAmount = profitAmount;
      } else {
        // 已经在阈值以上，检查是否继续上升
        let shouldNotifyContinue = false;
        
        // 检查百分比变化（上升 1%）
        if (currentState.lastNotifyRate !== null) {
          const rateChange = profitRate - currentState.lastNotifyRate;
          if (rateChange >= 1.0) {
            shouldNotifyContinue = true;
          }
        }
        
        // 检查金额变化（上升 1 USDT）
        if (this.config.profitAmountThreshold !== null && currentState.lastNotifyAmount !== null) {
          const amountChange = profitAmount - currentState.lastNotifyAmount;
          if (amountChange >= 1.0) {
            shouldNotifyContinue = true;
          }
        }
        
        if (shouldNotifyContinue) {
          shouldSend = true;
          notifyType = 'profit_continue';
          currentState.lastNotifyRate = profitRate;
          currentState.lastNotifyAmount = profitAmount;
        }
      }
    } else if (profitRate < this.config.profitThreshold - 0.5 && 
               (this.config.profitAmountThreshold === null || profitAmount < this.config.profitAmountThreshold - 0.5)) {
      // 跌破阈值，重置状态
      currentState.aboveProfitThreshold = false;
      currentState.lastNotifyRate = null;
      currentState.lastNotifyAmount = null;
    }
    
    // 检查亏损阈值（百分比或金额，满足任一即可）
    const reachedLossRate = this.config.enableLossNotification && 
                            profitRate <= this.config.lossThreshold;
    const reachedLossAmount = this.config.enableLossNotification && 
                              this.config.lossAmountThreshold !== null && 
                              profitAmount <= this.config.lossAmountThreshold;
    
    if (reachedLossRate || reachedLossAmount) {
      if (!currentState.belowLossThreshold) {
        // 首次达到阈值
        shouldSend = true;
        notifyType = 'loss';
        currentState.belowLossThreshold = true;
        currentState.aboveProfitThreshold = false;
        currentState.lastNotifyRate = profitRate;
        currentState.lastNotifyAmount = profitAmount;
      } else {
        // 已经在阈值以下，检查是否继续下降
        let shouldNotifyContinue = false;
        
        // 检查百分比变化（下降 1%）
        if (currentState.lastNotifyRate !== null) {
          const rateChange = currentState.lastNotifyRate - profitRate;
          if (rateChange >= 1.0) {
            shouldNotifyContinue = true;
          }
        }
        
        // 检查金额变化（下降 1 USDT）
        if (this.config.lossAmountThreshold !== null && currentState.lastNotifyAmount !== null) {
          const amountChange = currentState.lastNotifyAmount - profitAmount;
          if (amountChange >= 1.0) {
            shouldNotifyContinue = true;
          }
        }
        
        if (shouldNotifyContinue) {
          shouldSend = true;
          notifyType = 'loss_continue';
          currentState.lastNotifyRate = profitRate;
          currentState.lastNotifyAmount = profitAmount;
        }
      }
    } else if (profitRate > this.config.lossThreshold + 0.5 && 
               (this.config.lossAmountThreshold === null || profitAmount > this.config.lossAmountThreshold + 0.5)) {
      // 回升超过阈值，重置状态
      currentState.belowLossThreshold = false;
      currentState.lastNotifyRate = null;
      currentState.lastNotifyAmount = null;
    }
    
    // 更新状态
    this.thresholdState[key] = currentState;
    
    // 如果应该发送，检查重复通知间隔（防止短时间内重复）
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
      positionValue,
      positionMargin,
      lastPrice,
      costOpen,
      profitUnreal,
      profitRate
    } = positionData;
    
    const key = `${contractCode}_${direction}`;
    
    // 检查是否应该通知（智能边界触发，传入金额）
    if (!this.shouldNotify(key, profitRate, profitUnreal)) {
      return false;
    }
    
    // 构建消息
    const emoji = profitRate >= 0 ? '🟢' : '🔴';
    const directionText = direction === 'buy' ? '多仓' : '空仓';
    const alertType = profitRate >= this.config.profitThreshold ? '🎉 盈利提醒' : '⚠️ 亏损警告';
    
    const message = `
${alertType}

${emoji} *${contractCode}* ${directionText}

📊 *持仓信息*
持仓量: \`${volume}\` 张 (${actualPosition.toFixed(4)} ${contractCode.split('-')[0]})
持仓价值: \`${positionValue.toFixed(2)}\` USDT
保证金: \`${positionMargin.toFixed(2)}\` USDT

💰 *价格信息*
最新价: \`${lastPrice.toFixed(2)}\` USDT
开仓价: \`${costOpen.toFixed(2)}\` USDT
价差: \`${(lastPrice - costOpen).toFixed(2)}\` USDT

📈 *盈亏情况*
未实现盈亏: \`${profitUnreal.toFixed(4)}\` USDT
收益率: \`${profitRate.toFixed(2)}%\`

⏰ ${new Date().toLocaleString('zh-CN')}
`.trim();
    
    const success = await this.sendMessage(message);
    
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
    
    // 计算总盈亏
    let totalProfit = 0;
    let totalMargin = 0;
    let totalValue = 0;
    
    const positionLines = positions.map(pos => {
      totalProfit += pos.profitUnreal;
      totalMargin += pos.positionMargin;
      totalValue += pos.positionValue;
      
      const emoji = pos.profitRate >= 0 ? '🟢' : '🔴';
      const directionText = pos.direction === 'buy' ? '多' : '空';
      
      return `${emoji} ${pos.contractCode} ${directionText}: ${pos.profitUnreal.toFixed(2)} USDT (${pos.profitRate.toFixed(2)}%)`;
    }).join('\n');
    
    const totalRate = totalMargin > 0 ? (totalProfit / totalMargin * 100) : 0;
    const overallEmoji = totalRate >= 0 ? '🟢' : '🔴';
    
    const message = `
📊 *持仓定时汇总*

${overallEmoji} *总体情况*
总盈亏: \`${totalProfit.toFixed(2)}\` USDT
总收益率: \`${totalRate.toFixed(2)}%\`
总保证金: \`${totalMargin.toFixed(2)}\` USDT
总持仓价值: \`${totalValue.toFixed(2)}\` USDT

📋 *各持仓详情*
${positionLines}

⏰ ${new Date().toLocaleString('zh-CN')}
`.trim();
    
    const success = await this.sendMessage(message);
    
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
  async notify(message, options = {}) {
    return await this.sendMessage(message, options);
  }

  /**
   * 测试通知
   */
  async testNotification() {
    const message = `
🤖 *HTX 监控机器人*

✅ 通知功能测试成功！

📋 *当前配置*
盈利通知阈值: \`${this.config.profitThreshold}%\`
亏损通知阈值: \`${this.config.lossThreshold}%\`
定时通知间隔: \`${this.config.timeInterval / 60000}\` 分钟
重复通知间隔: \`${this.config.repeatInterval / 60000}\` 分钟

⏰ ${new Date().toLocaleString('zh-CN')}
`.trim();
    
    return await this.sendMessage(message);
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

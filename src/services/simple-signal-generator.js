import axios from 'axios';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('简化信号');

/**
 * 简化版交易信号生成器
 * 只关注最核心的指标：趋势 + 动量 + 风险收益比
 */
export class SimpleSignalGenerator {
  constructor(accessKey, secretKey) {
    this.accessKey = accessKey;
    this.secretKey = secretKey;
    this.baseUrl = 'https://api.hbdm.com';
  }

  /**
   * 生成交易信号（简化版）
   * @param {string} symbol - 交易对（如 BTC-USDT）
   * @param {number} currentPrice - 当前价格
   * @param {object} config - 量化配置（止盈止损等）
   * @returns {object} { action: 'long'|'short'|'hold', confidence: 0-100, reason: string }
   */
  async generateSignal(symbol, currentPrice, config) {
    try {
      // 1. 获取K线数据（只需要1小时和4小时）
      const kline1h = await this.getKlineData(symbol, '60min', 100);
      const kline4h = await this.getKlineData(symbol, '4hour', 50);

      if (!kline1h || !kline4h) {
        return { action: 'hold', confidence: 0, reason: '数据不足' };
      }

      // 2. 计算核心指标
      const trend = this.calculateTrend(kline1h, kline4h, currentPrice);
      const momentum = this.calculateMomentum(kline1h, currentPrice);
      const riskReward = this.calculateRiskReward(currentPrice, config);

      // 3. 综合判断
      return this.makeDecision(trend, momentum, riskReward, currentPrice);

    } catch (error) {
      logger.error('生成信号失败:', error.message);
      return { action: 'hold', confidence: 0, reason: '分析失败' };
    }
  }

  /**
   * 获取K线数据
   */
  async getKlineData(symbol, period, size) {
    try {
      const contractCode = symbol; // BTC-USDT
      const url = `${this.baseUrl}/linear-swap-ex/market/history/kline`;
      
      const response = await axios.get(url, {
        params: {
          contract_code: contractCode,
          period: period,
          size: size
        }
      });

      if (response.data.status === 'ok' && response.data.data) {
        // 反转为新→旧顺序
        return response.data.data.reverse();
      }

      return null;
    } catch (error) {
      logger.error(`获取K线失败 (${period}):`, error.message);
      return null;
    }
  }

  /**
   * 计算趋势（最重要）
   * 使用简单移动平均线：MA20 和 MA50
   */
  calculateTrend(kline1h, kline4h, currentPrice) {
    // 1小时级别趋势
    const ma20_1h = this.calculateMA(kline1h, 20);
    const ma50_1h = this.calculateMA(kline1h, 50);

    // 4小时级别趋势
    const ma20_4h = this.calculateMA(kline4h, 20);

    let score = 0;
    let signals = [];

    logger.debug(`\n  📈 趋势分析:`);
    logger.debug(`     当前价格: ${currentPrice.toFixed(2)}`);
    logger.debug(`     MA20(1H): ${ma20_1h.toFixed(2)}`);
    logger.debug(`     MA50(1H): ${ma50_1h.toFixed(2)}`);
    logger.debug(`     MA20(4H): ${ma20_4h.toFixed(2)}`);

    // 1小时趋势判断（权重 40%）
    if (currentPrice > ma20_1h && currentPrice > ma50_1h) {
      score += 40;
      signals.push('1H上升趋势');
      logger.debug(`     ✅ 1H上升趋势 (+40分): 价格 > MA20 且 > MA50`);
    } else if (currentPrice < ma20_1h && currentPrice < ma50_1h) {
      score -= 40;
      signals.push('1H下降趋势');
      logger.debug(`     ❌ 1H下降趋势 (-40分): 价格 < MA20 且 < MA50`);
    } else {
      logger.debug(`     ⚪ 1H趋势不明 (0分)`);
    }

    // 4小时趋势判断（权重 30%）
    if (currentPrice > ma20_4h) {
      score += 30;
      signals.push('4H上升趋势');
      logger.debug(`     ✅ 4H上升趋势 (+30分): 价格 > MA20`);
    } else if (currentPrice < ma20_4h) {
      score -= 30;
      signals.push('4H下降趋势');
      logger.debug(`     ❌ 4H下降趋势 (-30分): 价格 < MA20`);
    } else {
      logger.debug(`     ⚪ 4H趋势不明 (0分)`);
    }

    // 均线排列（权重 30%）
    if (ma20_1h > ma50_1h) {
      score += 30;
      signals.push('均线多头排列');
      logger.debug(`     ✅ 均线多头排列 (+30分): MA20 > MA50`);
    } else if (ma20_1h < ma50_1h) {
      score -= 30;
      signals.push('均线空头排列');
      logger.debug(`     ❌ 均线空头排列 (-30分): MA20 < MA50`);
    } else {
      logger.debug(`     ⚪ 均线持平 (0分)`);
    }

    logger.debug(`     趋势总分: ${score}/100`);

    return {
      score: score, // -100 到 100
      ma20_1h,
      ma50_1h,
      ma20_4h,
      signals
    };
  }

  /**
   * 计算动量（次重要）
   * 使用 RSI 和价格变化率
   */
  calculateMomentum(kline1h, currentPrice) {
    // RSI 指标
    const rsi = this.calculateRSI(kline1h, 14);

    // 最近价格变化率
    const priceChange1h = ((currentPrice - kline1h[0].close) / kline1h[0].close) * 100;
    const priceChange24h = kline1h[23] ? ((currentPrice - kline1h[23].close) / kline1h[23].close) * 100 : 0;

    let score = 0;
    let signals = [];

    logger.debug(`\n  ⚡ 动量分析:`);
    logger.debug(`     RSI(14): ${rsi.toFixed(1)}`);
    logger.debug(`     1H涨跌: ${priceChange1h >= 0 ? '+' : ''}${priceChange1h.toFixed(2)}%`);
    logger.debug(`     24H涨跌: ${priceChange24h >= 0 ? '+' : ''}${priceChange24h.toFixed(2)}%`);

    // RSI 判断（权重 50%）
    if (rsi < 30) {
      score += 50; // 超卖，看涨
      signals.push(`RSI超卖(${rsi.toFixed(0)})`);
      logger.debug(`     ✅ RSI超卖 (+50分): RSI < 30`);
    } else if (rsi > 70) {
      score -= 50; // 超买，看跌
      signals.push(`RSI超买(${rsi.toFixed(0)})`);
      logger.debug(`     ❌ RSI超买 (-50分): RSI > 70`);
    } else if (rsi >= 40 && rsi <= 60) {
      // 中性区域，根据趋势加分
      if (rsi > 50) {
        score += 20;
        signals.push(`RSI偏多(${rsi.toFixed(0)})`);
        logger.debug(`     ✅ RSI偏多 (+20分): 50 < RSI < 60`);
      } else {
        score -= 20;
        signals.push(`RSI偏空(${rsi.toFixed(0)})`);
        logger.debug(`     ❌ RSI偏空 (-20分): 40 < RSI < 50`);
      }
    } else {
      logger.debug(`     ⚪ RSI中性 (0分): ${rsi.toFixed(1)}`);
    }

    // 价格动量（权重 50%）
    if (priceChange1h > 0.5 && priceChange24h > 1) {
      score += 50;
      signals.push('价格上涨动能强');
      logger.debug(`     ✅ 价格上涨动能强 (+50分): 1H>0.5% 且 24H>1%`);
    } else if (priceChange1h < -0.5 && priceChange24h < -1) {
      score -= 50;
      signals.push('价格下跌动能强');
      logger.debug(`     ❌ 价格下跌动能强 (-50分): 1H<-0.5% 且 24H<-1%`);
    } else {
      logger.debug(`     ⚪ 价格动能一般 (0分)`);
    }

    logger.debug(`     动量总分: ${score}/100`);

    return {
      score: score, // -100 到 100
      rsi,
      priceChange1h,
      priceChange24h,
      signals
    };
  }

  /**
   * 计算风险收益比
   * 基于用户设置的止盈止损
   */
  calculateRiskReward(currentPrice, config) {
    const { takeProfit, stopLoss } = config;

    // 风险收益比 = 止盈 / 止损
    const ratio = takeProfit / stopLoss;

    let score = 0;
    let signals = [];

    logger.debug(`\n  💰 风险收益分析:`);
    logger.debug(`     止盈: ${(takeProfit * 100).toFixed(1)}%`);
    logger.debug(`     止损: ${(stopLoss * 100).toFixed(1)}%`);
    logger.debug(`     风险收益比: 1:${ratio.toFixed(2)}`);

    // 风险收益比越高，越值得交易
    if (ratio >= 2) {
      score = 100; // 1:2 以上，非常好
      signals.push(`风险收益比优秀(1:${ratio.toFixed(1)})`);
      logger.debug(`     ✅ 风险收益比优秀 (100分): ≥1:2`);
    } else if (ratio >= 1.5) {
      score = 70; // 1:1.5，良好
      signals.push(`风险收益比良好(1:${ratio.toFixed(1)})`);
      logger.debug(`     ✅ 风险收益比良好 (70分): ≥1:1.5`);
    } else if (ratio >= 1) {
      score = 40; // 1:1，一般
      signals.push(`风险收益比一般(1:${ratio.toFixed(1)})`);
      logger.debug(`     ⚪ 风险收益比一般 (40分): ≥1:1`);
    } else {
      score = 0; // 小于1:1，不建议
      signals.push(`风险收益比不佳(1:${ratio.toFixed(1)})`);
      logger.debug(`     ❌ 风险收益比不佳 (0分): <1:1`);
    }

    return {
      score: score, // 0 到 100
      ratio,
      signals
    };
  }

  /**
   * 综合决策
   */
  makeDecision(trend, momentum, riskReward, currentPrice) {
    // 权重分配：
    // 趋势 50%，动量 30%，风险收益比 20%
    const trendScore = trend.score * 0.5;
    const momentumScore = momentum.score * 0.3;
    const riskScore = riskReward.score * 0.2;

    const totalScore = trendScore + momentumScore + riskScore;

    // 归一化到 0-100
    const confidence = Math.min(100, Math.max(0, (totalScore + 100) / 2));

    // 决策逻辑
    let action = 'hold';
    let reason = '';

    if (totalScore > 30) {
      action = 'long';
      reason = '做多信号';
    } else if (totalScore < -30) {
      action = 'short';
      reason = '做空信号';
    } else {
      action = 'hold';
      reason = '观望';
    }

    // 汇总信号
    const allSignals = [
      ...trend.signals,
      ...momentum.signals,
      ...riskReward.signals
    ];

    logger.debug(`\n📊 综合决策:`);
    logger.debug(`   趋势得分: ${trend.score.toFixed(0)} (权重50%) → 加权: ${trendScore.toFixed(1)}`);
    logger.debug(`   动量得分: ${momentum.score.toFixed(0)} (权重30%) → 加权: ${momentumScore.toFixed(1)}`);
    logger.debug(`   风险收益: ${riskReward.score.toFixed(0)} (权重20%) → 加权: ${riskScore.toFixed(1)}`);
    logger.debug(`   综合得分: ${totalScore.toFixed(1)} (范围: -100 到 100)`);
    logger.debug(`   信心指数: ${confidence.toFixed(0)}%`);
    logger.debug(`   决策阈值: 做多>30, 做空<-30, 其他观望`);
    logger.debug(`   最终决策: ${action.toUpperCase()} (${reason})`);
    logger.debug(`   信号详情: ${allSignals.join(', ')}\n`);    logger.debug(`   信心指数: ${confidence.toFixed(0)}%`);
    logger.debug(`   决策: ${action.toUpperCase()}`);

    return {
      action,
      confidence: Math.round(confidence),
      reason,
      signals: allSignals,
      details: {
        trend: trend.score,
        momentum: momentum.score,
        riskReward: riskReward.score,
        total: totalScore
      }
    };
  }

  /**
   * 计算简单移动平均线
   */
  calculateMA(kline, period) {
    if (!kline || kline.length < period) return 0;

    const prices = kline.slice(0, period).map(k => Number(k.close));
    const sum = prices.reduce((a, b) => a + b, 0);
    return sum / period;
  }

  /**
   * 计算 RSI
   */
  calculateRSI(kline, period = 14) {
    if (!kline || kline.length < period + 1) return 50;

    const prices = kline.slice(0, period + 1).map(k => Number(k.close));
    
    let gains = 0;
    let losses = 0;

    for (let i = 1; i < prices.length; i++) {
      const change = prices[i - 1] - prices[i]; // 注意：新→旧顺序
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return rsi;
  }
}

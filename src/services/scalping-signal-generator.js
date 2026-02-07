import axios from 'axios';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('超短线信号');

/**
 * 超短线交易信号生成器（Scalping）
 * 专注于小资金快进快出，几秒到几分钟的交易
 */
export class ScalpingSignalGenerator {
  constructor(accessKey, secretKey) {
    this.accessKey = accessKey;
    this.secretKey = secretKey;
    this.baseUrl = 'https://api.hbdm.com';
    
    // 价格历史（用于计算短期波动）
    this.priceHistory = [];
    this.maxHistorySize = 60; // 保留最近60个价格点
  }

  /**
   * 生成超短线交易信号
   * @param {string} symbol - 交易对
   * @param {number} currentPrice - 当前价格
   * @param {object} config - 配置（保证金、止盈止损等）
   */
  async generateSignal(symbol, currentPrice, config) {
    try {
      // 1. 记录价格历史
      this.addPriceToHistory(currentPrice);

      // 2. 获取1分钟和5分钟K线（超短线只看短周期）
      const kline1m = await this.getKlineData(symbol, '1min', 30);
      const kline5m = await this.getKlineData(symbol, '5min', 20);

      if (!kline1m || !kline5m) {
        return { action: 'hold', confidence: 0, reason: '数据不足' };
      }

      // 3. 计算核心指标
      const momentum = this.calculateShortMomentum(kline1m, currentPrice);
      const volatility = this.calculateVolatility(kline1m);
      const trend = this.calculateMicroTrend(kline5m, currentPrice);
      const profitPotential = this.calculateProfitPotential(currentPrice, config, volatility);

      // 4. 综合决策
      return this.makeScalpingDecision(momentum, volatility, trend, profitPotential, currentPrice, config);

    } catch (error) {
      logger.error('生成超短线信号失败:', error.message);
      return { action: 'hold', confidence: 0, reason: '分析失败' };
    }
  }

  /**
   * 添加价格到历史
   */
  addPriceToHistory(price) {
    this.priceHistory.unshift(price);
    if (this.priceHistory.length > this.maxHistorySize) {
      this.priceHistory = this.priceHistory.slice(0, this.maxHistorySize);
    }
  }

  /**
   * 获取K线数据
   */
  async getKlineData(symbol, period, size) {
    try {
      const url = `${this.baseUrl}/linear-swap-ex/market/history/kline`;
      const response = await axios.get(url, {
        params: {
          contract_code: symbol,
          period: period,
          size: size
        }
      });

      if (response.data.status === 'ok' && response.data.data) {
        return response.data.data.reverse();
      }
      return null;
    } catch (error) {
      logger.error(`获取K线失败 (${period}):`, error.message);
      return null;
    }
  }

  /**
   * 计算短期动量（最近几秒到几分钟的价格变化）
   */
  calculateShortMomentum(kline1m, currentPrice) {
    let score = 0;
    let signals = [];

    // 最近1分钟变化
    const change1m = kline1m[0] ? ((currentPrice - kline1m[0].close) / kline1m[0].close) * 100 : 0;
    
    // 最近3分钟变化
    const change3m = kline1m[2] ? ((currentPrice - kline1m[2].close) / kline1m[2].close) * 100 : 0;
    
    // 最近5分钟变化
    const change5m = kline1m[4] ? ((currentPrice - kline1m[4].close) / kline1m[4].close) * 100 : 0;

    logger.debug(`\n  ⚡ 短期动量:`);
    logger.debug(`     1分钟: ${change1m >= 0 ? '+' : ''}${change1m.toFixed(3)}%`);
    logger.debug(`     3分钟: ${change3m >= 0 ? '+' : ''}${change3m.toFixed(3)}%`);
    logger.debug(`     5分钟: ${change5m >= 0 ? '+' : ''}${change5m.toFixed(3)}%`);

    // 判断短期趋势
    if (change1m > 0.05 && change3m > 0.1) {
      score += 60;
      signals.push('短期上涨动能');
      logger.debug(`     ✅ 短期上涨动能 (+60分)`);
    } else if (change1m < -0.05 && change3m < -0.1) {
      score -= 60;
      signals.push('短期下跌动能');
      logger.debug(`     ❌ 短期下跌动能 (-60分)`);
    }

    // 加速判断（动量增强）
    if (Math.abs(change1m) > Math.abs(change3m) * 0.5) {
      if (change1m > 0) {
        score += 20;
        signals.push('加速上涨');
        logger.debug(`     ✅ 加速上涨 (+20分)`);
      } else {
        score -= 20;
        signals.push('加速下跌');
        logger.debug(`     ❌ 加速下跌 (-20分)`);
      }
    }

    logger.debug(`     动量得分: ${score}/100`);

    return {
      score,
      change1m,
      change3m,
      change5m,
      signals
    };
  }

  /**
   * 计算波动率（判断市场活跃度）
   */
  calculateVolatility(kline1m) {
    if (!kline1m || kline1m.length < 10) {
      return { score: 0, volatility: 0, signals: [] };
    }

    // 计算最近10根K线的波动率
    let totalVolatility = 0;
    for (let i = 0; i < Math.min(10, kline1m.length); i++) {
      const high = Number(kline1m[i].high);
      const low = Number(kline1m[i].low);
      const close = Number(kline1m[i].close);
      totalVolatility += ((high - low) / close) * 100;
    }
    const avgVolatility = totalVolatility / Math.min(10, kline1m.length);

    let score = 0;
    let signals = [];

    logger.debug(`\n  📊 波动率分析:`);
    logger.debug(`     平均波动: ${avgVolatility.toFixed(3)}%`);

    // 波动率适中最好（太低没机会，太高风险大）
    if (avgVolatility >= 0.05 && avgVolatility <= 0.2) {
      score = 80;
      signals.push('波动率适中');
      logger.debug(`     ✅ 波动率适中 (80分): 0.05%-0.2%`);
    } else if (avgVolatility > 0.2 && avgVolatility <= 0.5) {
      score = 50;
      signals.push('波动率偏高');
      logger.debug(`     ⚠️  波动率偏高 (50分): 0.2%-0.5%`);
    } else if (avgVolatility < 0.05) {
      score = 20;
      signals.push('波动率过低');
      logger.debug(`     ❌ 波动率过低 (20分): <0.05%`);
    } else {
      score = 10;
      signals.push('波动率过高');
      logger.debug(`     ❌ 波动率过高 (10分): >0.5%`);
    }

    return {
      score,
      volatility: avgVolatility,
      signals
    };
  }

  /**
   * 计算微趋势（5分钟级别的小趋势）
   */
  calculateMicroTrend(kline5m, currentPrice) {
    if (!kline5m || kline5m.length < 5) {
      return { score: 0, signals: [] };
    }

    let score = 0;
    let signals = [];

    // 简单MA5
    const ma5 = kline5m.slice(0, 5).reduce((sum, k) => sum + Number(k.close), 0) / 5;

    // 最近5根K线的趋势
    const prices = kline5m.slice(0, 5).map(k => Number(k.close));
    let upCount = 0;
    let downCount = 0;
    for (let i = 0; i < prices.length - 1; i++) {
      if (prices[i] > prices[i + 1]) upCount++;
      else downCount++;
    }

    logger.debug(`\n  📈 微趋势分析:`);
    logger.debug(`     MA5: ${ma5.toFixed(2)}`);
    logger.debug(`     最近5根: ${upCount}涨 ${downCount}跌`);

    // 趋势判断
    if (currentPrice > ma5 && upCount >= 3) {
      score = 40;
      signals.push('微趋势向上');
      logger.debug(`     ✅ 微趋势向上 (40分)`);
    } else if (currentPrice < ma5 && downCount >= 3) {
      score = -40;
      signals.push('微趋势向下');
      logger.debug(`     ❌ 微趋势向下 (-40分)`);
    } else {
      signals.push('微趋势震荡');
      logger.debug(`     ⚪ 微趋势震荡 (0分)`);
    }

    // 逆向思维：连续单边后可能反转
    if (upCount >= 4) {
      score -= 20;
      signals.push('连涨警惕回调');
      logger.debug(`     ⚠️  连涨警惕回调 (-20分)`);
    } else if (downCount >= 4) {
      score += 20;
      signals.push('连跌可能反弹');
      logger.debug(`     ⚠️  连跌可能反弹 (+20分)`);
    }

    return {
      score,
      ma5,
      upCount,
      downCount,
      signals
    };
  }

  /**
   * 计算盈利潜力（基于保证金和波动率）
   */
  calculateProfitPotential(currentPrice, config, volatility) {
    const { positionSize, leverage, stopLoss, takeProfit } = config;
    
    // 假设余额100U，实际会从配置读取
    const balance = 100;
    const margin = balance * positionSize;
    const positionValue = margin * leverage;

    // 根据波动率估算达到止盈需要的时间
    const takeProfitPercent = takeProfit; // 如 0.01 = 1%
    const priceChangeNeeded = takeProfitPercent / leverage; // 价格需要变化的百分比
    
    // 如果波动率够大，容易达到止盈
    const canReachTarget = volatility.volatility >= priceChangeNeeded * 0.5;

    let score = 0;
    let signals = [];

    logger.debug(`\n  💰 盈利潜力:`);
    logger.debug(`     保证金: ${margin.toFixed(2)} USDT`);
    logger.debug(`     持仓值: ${positionValue.toFixed(2)} USDT`);
    logger.debug(`     止盈需要价格变化: ${(priceChangeNeeded * 100).toFixed(3)}%`);
    logger.debug(`     当前波动率: ${(volatility.volatility).toFixed(3)}%`);

    if (canReachTarget) {
      score = 100;
      signals.push('易达止盈');
      logger.debug(`     ✅ 易达止盈 (100分): 波动率足够`);
    } else {
      score = 30;
      signals.push('难达止盈');
      logger.debug(`     ❌ 难达止盈 (30分): 波动率不足`);
    }

    return {
      score,
      margin,
      positionValue,
      priceChangeNeeded,
      signals
    };
  }

  /**
   * 超短线决策
   */
  makeScalpingDecision(momentum, volatility, trend, profitPotential, currentPrice, config) {
    // 权重：动量40%，波动率30%，微趋势20%，盈利潜力10%
    const momentumScore = momentum.score * 0.4;
    const volatilityScore = volatility.score * 0.3;
    const trendScore = trend.score * 0.2;
    const profitScore = profitPotential.score * 0.1;

    const totalScore = momentumScore + volatilityScore + trendScore + profitScore;
    const confidence = Math.min(100, Math.max(0, 50 + totalScore / 2));

    let action = 'hold';
    let reason = '';

    // 超短线阈值更低（20分就可以考虑）
    if (totalScore > 20) {
      action = 'long';
      reason = '超短线做多';
    } else if (totalScore < -20) {
      action = 'short';
      reason = '超短线做空';
    } else {
      action = 'hold';
      reason = '等待机会';
    }

    const allSignals = [
      ...momentum.signals,
      ...volatility.signals,
      ...trend.signals,
      ...profitPotential.signals
    ];

    logger.debug(`\n📊 超短线决策:`);
    logger.debug(`   动量: ${momentum.score.toFixed(0)} (权重40%) → ${momentumScore.toFixed(1)}`);
    logger.debug(`   波动: ${volatility.score.toFixed(0)} (权重30%) → ${volatilityScore.toFixed(1)}`);
    logger.debug(`   趋势: ${trend.score.toFixed(0)} (权重20%) → ${trendScore.toFixed(1)}`);
    logger.debug(`   盈利: ${profitPotential.score.toFixed(0)} (权重10%) → ${profitScore.toFixed(1)}`);
    logger.debug(`   综合: ${totalScore.toFixed(1)}`);
    logger.debug(`   信心: ${confidence.toFixed(0)}%`);
    logger.debug(`   决策: ${action.toUpperCase()} (阈值: ±20)`);
    logger.debug(`   信号: ${allSignals.join(', ')}\n`);

    return {
      action,
      confidence: Math.round(confidence),
      reason,
      signals: allSignals,
      details: {
        momentum: momentum.score,
        volatility: volatility.score,
        trend: trend.score,
        profitPotential: profitPotential.score,
        total: totalScore
      }
    };
  }
}

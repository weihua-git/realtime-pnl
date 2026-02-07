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
    
    // 价格历史（用于计算实时波动率）
    this.priceHistory = [];
    this.maxHistorySize = 60; // 保留最近60个价格点
    this.priceTimestamps = []; // 记录价格时间戳
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
      const volume = this.calculateVolumeAnalysis(kline1m); // 新增：成交量分析
      const bollingerBands = this.calculateBollingerBands(kline5m, currentPrice); // 新增：布林带
      const trend = this.calculateMicroTrend(kline5m, currentPrice);

      // 4. 综合决策
      return this.makeScalpingDecision(momentum, volatility, volume, bollingerBands, trend, currentPrice, config);

    } catch (error) {
      logger.error('生成超短线信号失败:', error.message);
      return { action: 'hold', confidence: 0, reason: '分析失败' };
    }
  }

  /**
   * 添加价格到历史
   */
  addPriceToHistory(price) {
    const now = Date.now();
    this.priceHistory.unshift(price);
    this.priceTimestamps.unshift(now);
    
    if (this.priceHistory.length > this.maxHistorySize) {
      this.priceHistory = this.priceHistory.slice(0, this.maxHistorySize);
      this.priceTimestamps = this.priceTimestamps.slice(0, this.maxHistorySize);
    }
  }
  
  /**
   * 计算实时波动率（使用价格历史）
   */
  calculateRealtimeVolatility() {
    if (this.priceHistory.length < 10) {
      return 0;
    }
    
    // 计算最近10个价格点的标准差
    const prices = this.priceHistory.slice(0, 10);
    const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);
    
    // 归一化为百分比
    return (stdDev / mean) * 100;
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

    // 判断短期趋势（提高阈值，减少噪音）
    if (change1m > 0.1 && change3m > 0.2) {
      score += 60;
      signals.push('短期上涨动能');
      logger.debug(`     ✅ 短期上涨动能 (+60分)`);
    } else if (change1m < -0.1 && change3m < -0.2) {
      score -= 60;
      signals.push('短期下跌动能');
      logger.debug(`     ❌ 短期下跌动能 (-60分)`);
    }

    // 加速判断（修正逻辑：比较加速度）
    // 如果1分钟变化幅度 > 3分钟平均变化幅度，说明在加速
    const avg3mChange = change3m / 3; // 3分钟的平均每分钟变化
    if (Math.abs(change1m) > Math.abs(avg3mChange) * 1.5) {
      if (change1m > 0) {
        score += 20;
        signals.push('加速上涨');
        logger.debug(`     ✅ 加速上涨 (+20分): 1分钟变化 > 3分钟均速×1.5`);
      } else {
        score -= 20;
        signals.push('加速下跌');
        logger.debug(`     ❌ 加速下跌 (-20分): 1分钟变化 > 3分钟均速×1.5`);
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

    // 波动率适中最好（调整阈值更符合实际）
    if (avgVolatility >= 0.1 && avgVolatility <= 0.4) {
      score = 80;
      signals.push('波动率适中');
      logger.debug(`     ✅ 波动率适中 (80分): 0.1%-0.4%`);
    } else if (avgVolatility > 0.4 && avgVolatility <= 0.8) {
      score = 50;
      signals.push('波动率偏高');
      logger.debug(`     ⚠️  波动率偏高 (50分): 0.4%-0.8%`);
    } else if (avgVolatility < 0.1) {
      score = 20;
      signals.push('波动率过低');
      logger.debug(`     ❌ 波动率过低 (20分): <0.1%`);
    } else {
      score = 10;
      signals.push('波动率过高');
      logger.debug(`     ❌ 波动率过高 (10分): >0.8%`);
    }

    return {
      score,
      volatility: avgVolatility,
      signals
    };
  }

  /**
   * 计算成交量分析（判断资金流向）
   */
  calculateVolumeAnalysis(kline1m) {
    if (!kline1m || kline1m.length < 5) {
      return { score: 0, signals: [] };
    }

    let score = 0;
    let signals = [];

    // 最近5根K线的成交量
    const volumes = kline1m.slice(0, 5).map(k => Number(k.amount));
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const currentVolume = volumes[0];
    const volumeRatio = currentVolume / avgVolume;

    logger.debug(`\n  📊 成交量分析:`);
    logger.debug(`     当前成交量: ${currentVolume.toFixed(0)}`);
    logger.debug(`     平均成交量: ${avgVolume.toFixed(0)}`);
    logger.debug(`     成交量比: ${volumeRatio.toFixed(2)}x`);

    // 成交量放大 = 资金流入，趋势可能延续
    if (volumeRatio >= 2) {
      score = 60;
      signals.push('成交量暴增');
      logger.debug(`     ✅ 成交量暴增 (60分): ≥2倍`);
    } else if (volumeRatio >= 1.5) {
      score = 40;
      signals.push('成交量放大');
      logger.debug(`     ✅ 成交量放大 (40分): ≥1.5倍`);
    } else if (volumeRatio >= 1.2) {
      score = 20;
      signals.push('成交量温和增加');
      logger.debug(`     ✅ 成交量温和增加 (20分): ≥1.2倍`);
    } else if (volumeRatio < 0.5) {
      score = -40;
      signals.push('成交量萎缩');
      logger.debug(`     ❌ 成交量萎缩 (-40分): <0.5倍`);
    } else {
      signals.push('成交量平稳');
      logger.debug(`     ⚪ 成交量平稳 (0分)`);
    }

    logger.debug(`     成交量得分: ${score}/100`);

    return {
      score,
      currentVolume,
      avgVolume,
      volumeRatio,
      signals
    };
  }

  /**
   * 计算布林带（判断超买超卖）
   */
  calculateBollingerBands(kline5m, currentPrice) {
    if (!kline5m || kline5m.length < 20) {
      return { score: 0, signals: [] };
    }

    let score = 0;
    let signals = [];

    // 计算20周期均线和标准差
    const prices = kline5m.slice(0, 20).map(k => Number(k.close));
    const ma20 = prices.reduce((a, b) => a + b, 0) / prices.length;
    
    const variance = prices.reduce((sum, p) => sum + Math.pow(p - ma20, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);
    
    const upperBand = ma20 + 2 * stdDev;
    const lowerBand = ma20 - 2 * stdDev;
    const middleBand = ma20;
    
    // 计算价格在布林带中的位置（0-1之间）
    const bandWidth = upperBand - lowerBand;
    const pricePosition = (currentPrice - lowerBand) / bandWidth;

    logger.debug(`\n  📉 布林带分析:`);
    logger.debug(`     上轨: ${upperBand.toFixed(2)}`);
    logger.debug(`     中轨: ${middleBand.toFixed(2)}`);
    logger.debug(`     下轨: ${lowerBand.toFixed(2)}`);
    logger.debug(`     当前价格: ${currentPrice.toFixed(2)}`);
    logger.debug(`     位置: ${(pricePosition * 100).toFixed(1)}%`);

    // 价格触及下轨 = 超卖，可能反弹（做多信号）
    if (pricePosition <= 0.1) {
      score = 50;
      signals.push('触及下轨(超卖)');
      logger.debug(`     ✅ 触及下轨超卖 (50分): 位置≤10%`);
    } else if (pricePosition <= 0.3) {
      score = 30;
      signals.push('接近下轨');
      logger.debug(`     ✅ 接近下轨 (30分): 位置≤30%`);
    }
    // 价格触及上轨 = 超买，可能回调（做空信号）
    else if (pricePosition >= 0.9) {
      score = -50;
      signals.push('触及上轨(超买)');
      logger.debug(`     ❌ 触及上轨超买 (-50分): 位置≥90%`);
    } else if (pricePosition >= 0.7) {
      score = -30;
      signals.push('接近上轨');
      logger.debug(`     ❌ 接近上轨 (-30分): 位置≥70%`);
    }
    // 价格在中轨附近 = 中性
    else {
      signals.push('布林带中性');
      logger.debug(`     ⚪ 布林带中性 (0分): 30%-70%`);
    }

    logger.debug(`     布林带得分: ${score}/100`);

    return {
      score,
      upperBand,
      middleBand,
      lowerBand,
      pricePosition,
      signals
    };
  }

  /**
   * 计算微趋势（5分钟级别的小趋势）- 简化版
   */
  calculateMicroTrend(kline5m, currentPrice) {
    if (!kline5m || kline5m.length < 5) {
      return { score: 0, signals: [] };
    }

    let score = 0;
    let signals = [];

    // 简单MA5
    const ma5 = kline5m.slice(0, 5).reduce((sum, k) => sum + Number(k.close), 0) / 5;

    // 最近3根K线的趋势（简化：只看3根，更快速）
    const prices = kline5m.slice(0, 3).map(k => Number(k.close));
    const isUptrend = prices[0] > prices[1] && prices[1] > prices[2];
    const isDowntrend = prices[0] < prices[1] && prices[1] < prices[2];

    logger.debug(`\n  📈 微趋势分析:`);
    logger.debug(`     MA5: ${ma5.toFixed(2)}`);
    logger.debug(`     最近3根: ${prices.map(p => p.toFixed(2)).join(' → ')}`);

    // 趋势判断（简化逻辑）
    if (currentPrice > ma5 && isUptrend) {
      score = 30;
      signals.push('微趋势向上');
      logger.debug(`     ✅ 微趋势向上 (30分)`);
    } else if (currentPrice < ma5 && isDowntrend) {
      score = -30;
      signals.push('微趋势向下');
      logger.debug(`     ❌ 微趋势向下 (-30分)`);
    } else {
      signals.push('微趋势震荡');
      logger.debug(`     ⚪ 微趋势震荡 (0分)`);
    }

    logger.debug(`     微趋势得分: ${score}/100`);

    return {
      score,
      ma5,
      signals
    };
  }



  /**
   * 超短线决策（优化版）
   */
  makeScalpingDecision(momentum, volatility, volume, bollingerBands, trend, currentPrice, config) {
    // 新权重分配：
    // 动量30%，成交量25%，布林带20%，波动率15%，微趋势10%
    const momentumScore = momentum.score * 0.30;
    const volumeScore = volume.score * 0.25;
    const bollingerScore = bollingerBands.score * 0.20;
    const volatilityScore = volatility.score * 0.15;
    const trendScore = trend.score * 0.10;

    const totalScore = momentumScore + volumeScore + bollingerScore + volatilityScore + trendScore;
    const confidence = Math.min(100, Math.max(0, 50 + totalScore / 2));

    let action = 'hold';
    let reason = '';

    // 超短线阈值：30分
    if (totalScore > 30) {
      action = 'long';
      reason = '超短线做多';
    } else if (totalScore < -30) {
      action = 'short';
      reason = '超短线做空';
    } else {
      action = 'hold';
      reason = '等待机会';
    }

    const allSignals = [
      ...momentum.signals,
      ...volume.signals,
      ...bollingerBands.signals,
      ...volatility.signals,
      ...trend.signals
    ];

    logger.debug(`\n📊 超短线决策:`);
    logger.debug(`   动量: ${momentum.score.toFixed(0)} (权重30%) → ${momentumScore.toFixed(1)}`);
    logger.debug(`   成交量: ${volume.score.toFixed(0)} (权重25%) → ${volumeScore.toFixed(1)}`);
    logger.debug(`   布林带: ${bollingerBands.score.toFixed(0)} (权重20%) → ${bollingerScore.toFixed(1)}`);
    logger.debug(`   波动率: ${volatility.score.toFixed(0)} (权重15%) → ${volatilityScore.toFixed(1)}`);
    logger.debug(`   微趋势: ${trend.score.toFixed(0)} (权重10%) → ${trendScore.toFixed(1)}`);
    logger.debug(`   综合得分: ${totalScore.toFixed(1)}`);
    logger.debug(`   信心指数: ${confidence.toFixed(0)}%`);
    logger.debug(`   最终决策: ${action.toUpperCase()} (阈值: ±30)`);
    logger.debug(`   信号详情: ${allSignals.join(', ')}\n`);

    return {
      action,
      confidence: Math.round(confidence),
      reason,
      signals: allSignals,
      details: {
        momentum: momentum.score,
        volume: volume.score,
        bollingerBands: bollingerBands.score,
        volatility: volatility.score,
        trend: trend.score,
        total: totalScore
      }
    };
  }
}

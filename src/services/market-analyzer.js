import axios from 'axios';
import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('市场分析');

/**
 * 市场数据分析器
 * 提供火币 App 没有的高级分析功能
 * 使用 API Key 认证，避免 IP 限制
 */
export class MarketAnalyzer {
  constructor(accessKey = null, secretKey = null) {
    this.baseUrl = 'https://api.hbdm.com';
    this.accessKey = accessKey;
    this.secretKey = secretKey;
    this.cache = new Map(); // 缓存 K线数据
    this.cacheExpiry = 5 * 60 * 1000; // 缓存 5 分钟（减少 API 调用）
    this.requestDelay = 500; // 请求间隔 500ms（避免限流）
    this.lastRequestTime = 0; // 上次请求时间
  }

  /**
   * 生成签名（如果提供了 API Key）
   */
  generateSignature(method, host, path, params) {
    if (!this.accessKey || !this.secretKey) {
      return null;
    }

    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '');
    
    const signParams = {
      AccessKeyId: this.accessKey,
      SignatureMethod: 'HmacSHA256',
      SignatureVersion: '2',
      Timestamp: timestamp,
      ...params
    };

    // 按字母顺序排序参数
    const sortedParams = Object.keys(signParams)
      .sort()
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(signParams[key])}`)
      .join('&');

    // 构建签名字符串
    const signString = `${method}\n${host}\n${path}\n${sortedParams}`;

    // 生成签名
    const signature = crypto
      .createHmac('sha256', this.secretKey)
      .update(signString)
      .digest('base64');

    return {
      ...signParams,
      Signature: signature
    };
  }

  /**
   * 获取 K线数据（使用公开 API，不需要签名）
   * @param {string} symbol - 合约代码，如 ETH-USDT
   * @param {string} period - 周期：1min, 5min, 15min, 30min, 60min, 4hour, 1day, 1week
   * @param {number} size - 数据条数
   */
  async getKlineData(symbol, period, size = 200) {
    logger.trace(`原始 symbol: "${symbol}"`);
    
    const cacheKey = `${symbol}_${period}_${size}`;
    const cached = this.cache.get(cacheKey);
    
    // 检查缓存
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      logger.debug(`使用缓存数据: ${symbol} ${period}`);
      return cached.data; // 缓存的数据已经是 { klines, latestPrice } 格式
    }

    // 限流：确保请求间隔至少 500ms
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.requestDelay) {
      await new Promise(resolve => setTimeout(resolve, this.requestDelay - timeSinceLastRequest));
    }

    // 最多重试 3 次，使用指数退避
    let lastError = null;
    for (let retry = 0; retry < 3; retry++) {
      try {
        // 指数退避：第1次立即，第2次等1秒，第3次等2秒
        if (retry > 0) {
          const backoffDelay = Math.pow(2, retry - 1) * 1000;
          logger.debug(`重试 ${retry}/3，等待 ${backoffDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }

        const path = '/linear-swap-ex/market/history/kline';
        const params = {
          contract_code: symbol.toUpperCase(),  // 保留连字符，如 ETH-USDT
          period: period,
          size: size
        };

        logger.trace(`请求参数:`, params);

        // K线数据是公开的，直接使用公开 API
        const queryString = Object.keys(params)
          .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
          .join('&');
        
        const url = `${this.baseUrl}${path}?${queryString}`;
        logger.trace(`完整 URL: ${url}`);

        this.lastRequestTime = Date.now();

        const response = await axios.get(url, {
          timeout: 15000, // 增加超时时间到 15 秒
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        });

        if (response.data.status === 'ok') {
          // 反转数组：从旧→新 变成 新→旧，并转换数值类型
          const data = response.data.data.reverse().map(k => ({
            ...k,
            open: +k.open,
            high: +k.high,
            low: +k.low,
            close: +k.close,
            amount: +k.amount || 0,
            vol: +k.vol || 0
          }));
          
          // 调试：打印K线数据顺序
          if (data.length >= 2) {
            logger.trace(`K线数据顺序检查 (${symbol} ${period}):`);
            logger.trace(`   第1条 (最新): ${new Date(data[0].id * 1000).toLocaleString('zh-CN')} - ${data[0].close}`);
            logger.trace(`   最后1条 (最早): ${new Date(data[data.length - 1].id * 1000).toLocaleString('zh-CN')} - ${data[data.length - 1].close}`);
          }
          
          // 缓存数据（保存为对象格式）
          const resultData = { klines: data, latestPrice: data[0]?.close || null };
          this.cache.set(cacheKey, {
            data: resultData,
            timestamp: Date.now()
          });
          logger.debug(`成功获取 K线数据: ${symbol} ${period} (${data.length} 条)`);
          return resultData;
        } else {
          lastError = new Error(`API 返回错误: ${response.data.err_msg || response.data['err-msg'] || 'Unknown error'}`);
        }
      } catch (error) {
        lastError = error;
        const errorMsg = error.response?.data?.err_msg || error.response?.data?.['err-msg'] || error.message;
        logger.warn(`获取失败 (${symbol} ${period}, 尝试 ${retry + 1}/3): ${errorMsg}`);
        
        // 如果是 404 或参数错误，不要重试
        if (error.response?.status === 404 || errorMsg.includes('invalid')) {
          logger.error(`参数错误，停止重试`);
          break;
        }
        
        if (retry < 2) {
          // 不是最后一次重试，继续
          continue;
        }
      }
    }

    // 所有重试都失败了
    logger.error(`获取K线数据最终失败 (${symbol} ${period}):`, lastError.message);
    return { klines: [], latestPrice: null };
  }

  /**
   * 多时间窗口涨跌分析
   * @param {string} symbol - 合约代码
   * @param {number} currentPrice - 当前价格
   */
  async analyzeMultiTimeframe(symbol, currentPrice) {
    // 优化：使用合适的周期和数量
    const timeframes = [
      { name: '30分钟', period: '1min', bars: 30 },    // 30 * 1分钟 = 30分钟
      { name: '1小时', period: '1min', bars: 60 },     // 60 * 1分钟 = 1小时
      { name: '4小时', period: '5min', bars: 48 },     // 48 * 5分钟 = 4小时
      { name: '24小时', period: '30min', bars: 48 },   // 48 * 30分钟 = 24小时
      { name: '7天', period: '4hour', bars: 42 },      // 42 * 4小时 = 7天
      { name: '30天', period: '1day', bars: 30 }       // 30 * 1天 = 30天
    ];

    const results = [];
    const fetchedData = {}; // 缓存已获取的数据

    for (const tf of timeframes) {
      try {
        // 检查是否已经获取过这个周期的数据
        const dataKey = `${tf.period}_${tf.bars}`;
        let result = fetchedData[dataKey];
        
        if (!result) {
          result = await this.getKlineData(symbol, tf.period, tf.bars);
          fetchedData[dataKey] = result;
        }
        
        const klines = result.klines || [];
        if (klines.length === 0) {
          logger.warn(`${tf.name} K线数据为空，跳过`);
          continue;
        }

        // 取最早的K线作为起始价格（K线数组是从新到旧排序，所以最早的在末尾）
        const startPrice = klines[klines.length - 1].close;
        const change = currentPrice - startPrice;
        const changePercent = (change / startPrice) * 100;

        results.push({
          timeframe: tf.name,
          startPrice: startPrice,
          currentPrice: currentPrice,
          change: change,
          changePercent: changePercent,
          trend: changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'neutral'
        });
      } catch (error) {
        logger.error(`分析 ${tf.name} 时出错:`, error.message);
      }
    }

    return results;
  }

  /**
   * 价格区间分析（高低点）
   * @param {string} symbol - 合约代码
   * @param {number} currentPrice - 当前价格
   */
  async analyzePriceRange(symbol, currentPrice) {
    // 优化：使用合适的周期
    const timeframes = [
      { name: '1小时', period: '1min', bars: 60 },
      { name: '4小时', period: '5min', bars: 48 },
      { name: '24小时', period: '30min', bars: 48 },
      { name: '7天', period: '4hour', bars: 42 },
      { name: '30天', period: '1day', bars: 30 }
    ];

    const results = [];
    const fetchedData = {};

    for (const tf of timeframes) {
      try {
        const dataKey = `${tf.period}_${tf.bars}`;
        let result = fetchedData[dataKey];
        
        if (!result) {
          result = await this.getKlineData(symbol, tf.period, tf.bars);
          fetchedData[dataKey] = result;
        }
        
        const klines = result.klines || [];
        if (klines.length === 0) {
          logger.warn(`${tf.name} K线数据为空，跳过价格区间分析`);
          continue;
        }

        // 计算高低点
        let highest = -Infinity;
        let lowest = Infinity;

        klines.forEach(k => {
          if (k.high > highest) highest = k.high;
          if (k.low < lowest) lowest = k.low;
        });

        // 计算振幅
        const amplitude = ((highest - lowest) / lowest) * 100;

        // 计算当前价格在区间中的位置（0-100%）
        const position = ((currentPrice - lowest) / (highest - lowest)) * 100;

        // 计算距离高低点的百分比
        const distanceToHigh = ((highest - currentPrice) / currentPrice) * 100;
        const distanceToLow = ((currentPrice - lowest) / currentPrice) * 100;

        results.push({
          timeframe: tf.name,
          highest: highest,
          lowest: lowest,
          amplitude: amplitude,
          currentPrice: currentPrice,
          position: position,
          distanceToHigh: distanceToHigh,
          distanceToLow: distanceToLow
        });
      } catch (error) {
        logger.error(`分析 ${tf.name} 价格区间时出错:`, error.message);
      }
    }

    return results;
  }

  /**
   * 波动率分析（优化版，复用数据）
   * @param {string} symbol - 合约代码
   */
  async analyzeVolatility(symbol) {
    const timeframes = [
      { name: '1小时', period: '1min', bars: 60 },
      { name: '24小时', period: '30min', bars: 48 },
      { name: '7天', period: '4hour', bars: 42 }
    ];

    const results = [];
    const fetchedData = {};

    for (const tf of timeframes) {
      try {
        const dataKey = `${tf.period}_${tf.bars}`;
        let result = fetchedData[dataKey];
        
        if (!result) {
          result = await this.getKlineData(symbol, tf.period, tf.bars);
          fetchedData[dataKey] = result;
        }
        
        const klines = result.klines || [];
        if (klines.length < 2) {
          logger.warn(`${tf.name} K线数据不足，跳过波动率分析`);
          continue;
        }

        // 计算价格变化率
        const changes = [];
        for (let i = 1; i < klines.length; i++) {
          const change = ((klines[i].close - klines[i - 1].close) / klines[i - 1].close) * 100;
          changes.push(Math.abs(change));
        }

        // 计算平均波动率
        const avgVolatility = changes.reduce((a, b) => a + b, 0) / changes.length;

        // 计算最大单次波动
        const maxVolatility = Math.max(...changes);

        // 计算波动率标准差
        const mean = avgVolatility;
        const variance = changes.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / changes.length;
        const stdDev = Math.sqrt(variance);

        // 波动率等级
        let level = 'low';
        if (avgVolatility > 2) level = 'high';
        else if (avgVolatility > 1) level = 'medium';

        results.push({
          timeframe: tf.name,
          avgVolatility: avgVolatility,
          maxVolatility: maxVolatility,
          stdDev: stdDev,
          level: level
        });
      } catch (error) {
        logger.error(`分析 ${tf.name} 波动率时出错:`, error.message);
      }
    }

    return results;
  }

  /**
   * 持仓成本分析
   * @param {string} symbol - 合约代码
   * @param {number} costPrice - 持仓成本价
   * @param {number} currentPrice - 当前价格
   */
  async analyzeCostPosition(symbol, costPrice, currentPrice) {
    // 获取 7 天数据
    const result = await this.getKlineData(symbol, '4hour', 42);  // 42 * 4小时 = 7天
    const klines = result.klines || [];
    
    if (klines.length === 0) {
      return null;
    }

    // 计算 7 天高低点
    let highest = -Infinity;
    let lowest = Infinity;

    klines.forEach(k => {
      if (k.high > highest) highest = k.high;
      if (k.low < lowest) lowest = k.low;
    });

    // 计算持仓成本在区间中的位置
    const costPosition = ((costPrice - lowest) / (highest - lowest)) * 100;
    const currentPosition = ((currentPrice - lowest) / (highest - lowest)) * 100;

    // 计算盈亏
    const profitLoss = currentPrice - costPrice;
    const profitLossPercent = (profitLoss / costPrice) * 100;

    // 判断持仓位置
    let positionLevel = 'medium';
    let suggestion = '';

    if (costPosition < 30) {
      positionLevel = 'good'; // 低位建仓
      suggestion = '持仓成本较低，处于有利位置';
    } else if (costPosition > 70) {
      positionLevel = 'bad'; // 高位建仓
      suggestion = '持仓成本较高，建议等待回调';
    } else {
      positionLevel = 'medium';
      suggestion = '持仓成本适中';
    }

    return {
      costPrice: costPrice,
      currentPrice: currentPrice,
      highest: highest,
      lowest: lowest,
      costPosition: costPosition,
      currentPosition: currentPosition,
      profitLoss: profitLoss,
      profitLossPercent: profitLossPercent,
      positionLevel: positionLevel,
      suggestion: suggestion
    };
  }

  /**
   * 计算移动平均线 (MA)
   * @param {Array} klines - K线数据
   * @param {number} period - 周期
   */
  calculateMA(klines, period) {
    if (klines.length < period) return null;
    
    // 使用最近的 period 条数据
    const recent = klines.slice(-period);
    const prices = recent.map(k => k.close);
    const sum = prices.reduce((a, b) => a + b, 0);
    return sum / period;
  }

  /**
   * 计算 RSI (相对强弱指标)
   * @param {Array} klines - K线数据
   * @param {number} period - 周期，默认 14
   */
  calculateRSI(klines, period = 14) {
    if (klines.length < period + 1) return null;

    // 使用最近的 period+1 条数据
    const recent = klines.slice(-(period + 1));
    
    let gains = 0;
    let losses = 0;

    // 计算前 period 个周期的平均涨跌
    for (let i = 0; i < period; i++) {
      const change = recent[i].close - recent[i + 1].close;
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

  /**
   * 计算 MACD
   * @param {Array} klines - K线数据
   */
  calculateMACD(klines) {
    if (klines.length < 26) return null;

    // 使用最近的 26 条数据
    const recent = klines.slice(-26);

    // 计算 EMA
    const calculateEMA = (data, period) => {
      const k = 2 / (period + 1);
      let ema = data[data.length - 1];
      
      for (let i = data.length - 2; i >= 0; i--) {
        ema = data[i] * k + ema * (1 - k);
      }
      
      return ema;
    };

    const prices = recent.map(k => k.close);
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    const dif = ema12 - ema26;

    return {
      dif: dif,
      signal: dif > 0 ? 'bullish' : 'bearish'
    };
  }

  /**
   * 计算布林带
   * @param {Array} klines - K线数据
   * @param {number} period - 周期，默认 20
   * @param {number} stdDev - 标准差倍数，默认 2
   */
  calculateBollingerBands(klines, period = 20, stdDev = 2) {
    if (klines.length < period) return null;

    // 使用最近的 period 条数据
    const recent = klines.slice(-period);
    const prices = recent.map(k => k.close);
    const ma = prices.reduce((a, b) => a + b, 0) / period;

    // 计算标准差
    const variance = prices.reduce((sum, price) => sum + Math.pow(price - ma, 2), 0) / period;
    const sd = Math.sqrt(variance);

    return {
      upper: ma + (stdDev * sd),
      middle: ma,
      lower: ma - (stdDev * sd)
    };
  }

  /**
   * 智能交易建议（增强版）
   * @param {string} symbol - 合约代码
   * @param {number} currentPrice - 当前价格
   * @param {Object} preloadedData - 预加载的数据（可选，避免重复请求）
   * @param {boolean} clearCache - 是否清除缓存（默认 false）
   */
  async generateTradingSuggestion(symbol, currentPrice, preloadedData = null, clearCache = false) {
    // 如果需要清除缓存
    if (clearCache) {
      logger.debug('清除缓存，获取最新数据...');
      this.cache.clear();
    }
    
    let multiTimeframe, priceRange, volatility, klines1h, klines4h;

    // 如果提供了预加载数据，直接使用
    if (preloadedData) {
      multiTimeframe = preloadedData.multiTimeframe;
      priceRange = preloadedData.priceRange;
      volatility = preloadedData.volatility;
      klines1h = preloadedData.klines1h;
      klines4h = preloadedData.klines4h;
    } else {
      // 否则重新获取
      multiTimeframe = await this.analyzeMultiTimeframe(symbol, currentPrice);
      priceRange = await this.analyzePriceRange(symbol, currentPrice);
      volatility = await this.analyzeVolatility(symbol);
      const result1h = await this.getKlineData(symbol, '15min', 100);
      const result4h = await this.getKlineData(symbol, '60min', 300);  // 增加到 300 条以支持 MA200
      klines1h = result1h.klines || [];
      klines4h = result4h.klines || [];
    }

    if (!multiTimeframe || multiTimeframe.length === 0 || !priceRange || priceRange.length === 0 || !klines1h || klines1h.length === 0) {
      return null;
    }

    // ==================== 技术指标计算 ====================
    
    // 1. 移动平均线
    const ma20 = this.calculateMA(klines1h, 20);
    const ma50 = this.calculateMA(klines1h, 50);
    const ma200 = this.calculateMA(klines4h, 200);

    // 2. RSI
    const rsi = this.calculateRSI(klines1h, 14);

    // 3. MACD
    const macd = this.calculateMACD(klines1h);

    // 4. 布林带
    const bb = this.calculateBollingerBands(klines1h, 20, 2);

    // ==================== 趋势分析 ====================
    
    // 分析短期趋势（30分钟、1小时）
    const shortTerm = multiTimeframe.slice(0, 2);
    const shortTermUp = shortTerm.filter(t => t.trend === 'up').length;
    const shortTermTrend = shortTermUp >= 1 ? 'up' : 'down';

    // 分析中期趋势（4小时、24小时）
    const midTerm = multiTimeframe.slice(2, 4);
    const midTermUp = midTerm.filter(t => t.trend === 'up').length;
    const midTermTrend = midTermUp >= 1 ? 'up' : 'down';

    // 分析长期趋势（7天、30天）
    const longTerm = multiTimeframe.slice(4, 6);
    const longTermUp = longTerm.filter(t => t.trend === 'up').length;
    const longTermTrend = longTermUp >= 1 ? 'up' : 'down';

    // 获取价格区间
    const range1h = priceRange.find(r => r.timeframe === '1小时');
    const range24h = priceRange.find(r => r.timeframe === '24小时');

    // ==================== 交易信号生成 ====================
    
    let action = 'hold'; // long (做多), short (做空), hold (观望)
    let confidence = 0; // 0-100
    let reasons = [];
    let signals = {
      bullish: 0,  // 看涨信号
      bearish: 0   // 看跌信号
    };

    // ========== 做多信号 ==========

    // 信号 1：多周期趋势向上
    if (shortTermTrend === 'up' && midTermTrend === 'up') {
      signals.bullish += 20;
      reasons.push('✅ 短期和中期趋势向上');
    }
    if (longTermTrend === 'up') {
      signals.bullish += 10;
      reasons.push('✅ 长期趋势向上');
    }

    // 信号 2：价格在移动平均线之上（多头排列）
    if (ma20 && ma50 && currentPrice > ma20 && ma20 > ma50) {
      signals.bullish += 15;
      reasons.push('✅ 均线多头排列（价格 > MA20 > MA50）');
    }

    // 信号 3：RSI 超卖反弹
    if (rsi && rsi < 30) {
      signals.bullish += 15;
      reasons.push(`✅ RSI 超卖 (${rsi.toFixed(1)})，可能反弹`);
    } else if (rsi && rsi >= 30 && rsi < 50) {
      signals.bullish += 5;
      reasons.push(`✅ RSI 适中 (${rsi.toFixed(1)})，有上涨空间`);
    }

    // 信号 4：MACD 金叉
    if (macd && macd.signal === 'bullish') {
      signals.bullish += 10;
      reasons.push('✅ MACD 看涨信号');
    }

    // 信号 5：价格触及布林带下轨（超卖）
    if (bb && currentPrice <= bb.lower) {
      signals.bullish += 15;
      reasons.push('✅ 价格触及布林带下轨，超卖反弹机会');
    }

    // 信号 6：价格接近区间低点
    if (range24h && range24h.position < 30) {
      signals.bullish += 10;
      reasons.push('✅ 价格接近24小时低点');
    }

    // 信号 7：1小时内快速下跌后企稳
    if (range1h && range1h.position < 20 && shortTermTrend === 'up') {
      signals.bullish += 10;
      reasons.push('✅ 短期快速下跌后企稳，可能反弹');
    }

    // ========== 做空信号 ==========

    // 信号 1：多周期趋势向下
    if (shortTermTrend === 'down' && midTermTrend === 'down') {
      signals.bearish += 20;
      reasons.push('❌ 短期和中期趋势向下');
    }
    if (longTermTrend === 'down') {
      signals.bearish += 10;
      reasons.push('❌ 长期趋势向下');
    }

    // 信号 2：价格在移动平均线之下（空头排列）
    if (ma20 && ma50 && currentPrice < ma20 && ma20 < ma50) {
      signals.bearish += 15;
      reasons.push('❌ 均线空头排列（价格 < MA20 < MA50）');
    }

    // 信号 3：RSI 超买回调
    if (rsi && rsi > 70) {
      signals.bearish += 15;
      reasons.push(`❌ RSI 超买 (${rsi.toFixed(1)})，可能回调`);
    } else if (rsi && rsi > 50 && rsi <= 70) {
      signals.bearish += 5;
      reasons.push(`❌ RSI 偏高 (${rsi.toFixed(1)})，有回调压力`);
    }

    // 信号 4：MACD 死叉
    if (macd && macd.signal === 'bearish') {
      signals.bearish += 10;
      reasons.push('❌ MACD 看跌信号');
    }

    // 信号 5：价格触及布林带上轨（超买）
    if (bb && currentPrice >= bb.upper) {
      signals.bearish += 15;
      reasons.push('❌ 价格触及布林带上轨，超买回调风险');
    }

    // 信号 6：价格接近区间高点
    if (range24h && range24h.position > 70) {
      signals.bearish += 10;
      reasons.push('❌ 价格接近24小时高点');
    }

    // 信号 7：1小时内快速上涨后滞涨
    if (range1h && range1h.position > 80 && shortTermTrend === 'down') {
      signals.bearish += 10;
      reasons.push('❌ 短期快速上涨后滞涨，可能回调');
    }

    // ========== 风险控制信号 ==========

    // 波动率过高 → 降低信心
    const vol24h = volatility.find(v => v.timeframe === '24小时');
    if (vol24h && vol24h.level === 'high') {
      signals.bullish -= 10;
      signals.bearish -= 10;
      reasons.push('⚠️ 市场波动较大，建议降低仓位');
    }

    // 趋势不明确 → 观望
    if (shortTermTrend !== midTermTrend) {
      signals.bullish -= 5;
      signals.bearish -= 5;
      reasons.push('⚠️ 短期和中期趋势不一致');
    }

    // ==================== 最终决策 ====================
    
    // 计算信心指数
    const totalSignals = signals.bullish + signals.bearish;
    
    if (signals.bullish > signals.bearish) {
      action = 'long';
      confidence = Math.min(signals.bullish, 100);
    } else if (signals.bearish > signals.bullish) {
      action = 'short';
      confidence = Math.min(signals.bearish, 100);
    } else {
      action = 'hold';
      confidence = 50;
      reasons.push('💡 多空信号均衡，建议观望');
    }

    // 信心指数太低 → 观望
    if (confidence < 40) {
      action = 'hold';
      reasons.push('💡 信号强度不足，建议观望');
    }

    return {
      action: action,
      confidence: confidence,
      reasons: reasons,
      signals: signals,
      indicators: {
        ma20: ma20,
        ma50: ma50,
        rsi: rsi,
        macd: macd,
        bollingerBands: bb
      },
      trends: {
        shortTerm: shortTermTrend,
        midTerm: midTermTrend,
        longTerm: longTermTrend
      },
      pricePosition: range24h ? range24h.position : null
    };
  }

  /**
   * 综合分析报告（优化版，减少 API 调用）
   * @param {string} symbol - 合约代码
   * @param {number} currentPrice - 当前价格
   * @param {number} costPrice - 持仓成本价（可选）
   */
  async generateReport(symbol, currentPrice, costPrice = null) {
    logger.info(`\n📊 正在生成 ${symbol} 的分析报告...\n`);

    // 清除缓存，确保获取最新数据
    logger.debug('清除缓存，获取最新数据...');
    this.cache.clear();

    const report = {
      symbol: symbol,
      currentPrice: currentPrice,
      timestamp: Date.now(),
      multiTimeframe: null,
      priceRange: null,
      volatility: null,
      costPosition: null,
      suggestion: null
    };

    // 1. 多时间窗口分析
    logger.debug('📈 分析多时间窗口涨跌...');
    report.multiTimeframe = await this.analyzeMultiTimeframe(symbol, currentPrice);

    // 2. 价格区间分析
    logger.debug('📊 分析价格区间...');
    report.priceRange = await this.analyzePriceRange(symbol, currentPrice);

    // 3. 波动率分析
    logger.debug('📉 分析波动率...');
    report.volatility = await this.analyzeVolatility(symbol);

    // 4. 持仓成本分析（如果提供）
    if (costPrice) {
      logger.debug('💼 分析持仓成本...');
      report.costPosition = await this.analyzeCostPosition(symbol, costPrice, currentPrice);
    }

    // 5. 智能交易建议（复用已获取的数据）
    logger.debug('🤖 生成交易建议...');
    const result1h = await this.getKlineData(symbol, '15min', 100);
    const result4h = await this.getKlineData(symbol, '60min', 300);  // 增加到 300 条以支持 MA200
    
    report.suggestion = await this.generateTradingSuggestion(symbol, currentPrice, {
      multiTimeframe: report.multiTimeframe,
      priceRange: report.priceRange,
      volatility: report.volatility,
      klines1h: result1h.klines || [],
      klines4h: result4h.klines || []
    });

    logger.info('✅ 分析报告生成完成\n');

    return report;
  }

  /**
   * 打印分析报告（控制台格式）
   */
  printReport(report) {
    logger.info('═══════════════════════════════════════════════════════');
    logger.info(`📊 ${report.symbol} 市场分析报告`);
    logger.info(`⏰ ${new Date(report.timestamp).toLocaleString('zh-CN')}`);
    logger.info(`💰 当前价格: ${report.currentPrice.toFixed(2)} USDT`);
    logger.info('═══════════════════════════════════════════════════════\n');

    // 1. 多时间窗口分析
    if (report.multiTimeframe && report.multiTimeframe.length > 0) {
      logger.info('📈 多时间窗口涨跌分析');
      logger.info('───────────────────────────────────────────────────────');
      report.multiTimeframe.forEach(tf => {
        const emoji = tf.trend === 'up' ? '📈' : tf.trend === 'down' ? '📉' : '➡️';
        const sign = tf.changePercent >= 0 ? '+' : '';
        logger.info(`${emoji} ${tf.timeframe.padEnd(8)} ${sign}${tf.changePercent.toFixed(2)}%  (${tf.startPrice.toFixed(2)} → ${tf.currentPrice.toFixed(2)})`);
      });
      logger.info('');
    }

    // 2. 价格区间分析
    if (report.priceRange && report.priceRange.length > 0) {
      logger.info('📊 价格区间分析（高低点）');
      logger.info('───────────────────────────────────────────────────────');
      report.priceRange.forEach(range => {
        logger.info(`\n${range.timeframe}:`);
        logger.info(`  最高: ${range.highest.toFixed(2)} (+${range.distanceToHigh.toFixed(2)}%)`);
        logger.info(`  最低: ${range.lowest.toFixed(2)} (-${range.distanceToLow.toFixed(2)}%)`);
        logger.info(`  振幅: ${range.amplitude.toFixed(2)}%`);
        logger.info(`  当前位置: ${range.position.toFixed(0)}% ${this.getPositionBar(range.position)}`);
      });
      logger.info('');
    }

    // 3. 波动率分析
    if (report.volatility && report.volatility.length > 0) {
      logger.info('📉 波动率分析');
      logger.info('───────────────────────────────────────────────────────');
      report.volatility.forEach(vol => {
        const levelEmoji = vol.level === 'high' ? '🔴' : vol.level === 'medium' ? '🟡' : '🟢';
        logger.info(`${levelEmoji} ${vol.timeframe.padEnd(8)} 平均: ${vol.avgVolatility.toFixed(2)}%  最大: ${vol.maxVolatility.toFixed(2)}%`);
      });
      logger.info('');
    }

    // 4. 持仓成本分析
    if (report.costPosition) {
      logger.info('💼 持仓成本分析');
      logger.info('───────────────────────────────────────────────────────');
      const cp = report.costPosition;
      const plEmoji = cp.profitLoss >= 0 ? '🟢' : '🔴';
      const plSign = cp.profitLoss >= 0 ? '+' : '';
      logger.info(`  持仓成本: ${cp.costPrice.toFixed(2)} USDT`);
      logger.info(`  当前价格: ${cp.currentPrice.toFixed(2)} USDT`);
      logger.info(`  ${plEmoji} 盈亏: ${plSign}${cp.profitLoss.toFixed(2)} USDT (${plSign}${cp.profitLossPercent.toFixed(2)}%)`);
      logger.info(`  成本位置: ${cp.costPosition.toFixed(0)}% ${this.getPositionBar(cp.costPosition)}`);
      logger.info(`  💡 ${cp.suggestion}`);
      logger.info('');
    }

    // 5. 智能交易建议
    if (report.suggestion) {
      logger.info('🤖 智能交易建议');
      logger.info('───────────────────────────────────────────────────────');
      const sug = report.suggestion;
      
      // 操作建议
      let actionText = '';
      let actionEmoji = '';
      if (sug.action === 'long') {
        actionText = '做多 (买入开多)';
        actionEmoji = '🟢';
      } else if (sug.action === 'short') {
        actionText = '做空 (卖出开空)';
        actionEmoji = '🔴';
      } else {
        actionText = '观望 (暂不操作)';
        actionEmoji = '🟡';
      }
      
      logger.info(`  ${actionEmoji} 建议操作: ${actionText}`);
      logger.info(`  📊 信心指数: ${sug.confidence}% ${'█'.repeat(Math.floor(sug.confidence / 10))}`);
      logger.info(`  📈 看涨信号: ${sug.signals.bullish} 分`);
      logger.info(`  📉 看跌信号: ${sug.signals.bearish} 分`);
      
      logger.info(`\n  趋势分析:`);
      logger.info(`    短期: ${sug.trends.shortTerm === 'up' ? '📈 上涨' : '📉 下跌'}`);
      logger.info(`    中期: ${sug.trends.midTerm === 'up' ? '📈 上涨' : '📉 下跌'}`);
      logger.info(`    长期: ${sug.trends.longTerm === 'up' ? '📈 上涨' : '📉 下跌'}`);
      
      if (sug.indicators) {
        logger.info(`\n  技术指标:`);
        if (sug.indicators.ma20) {
          logger.info(`    MA20: ${sug.indicators.ma20.toFixed(2)}`);
        }
        if (sug.indicators.ma50) {
          logger.info(`    MA50: ${sug.indicators.ma50.toFixed(2)}`);
        }
        if (sug.indicators.rsi) {
          const rsiLevel = sug.indicators.rsi > 70 ? '超买' : sug.indicators.rsi < 30 ? '超卖' : '正常';
          logger.info(`    RSI: ${sug.indicators.rsi.toFixed(1)} (${rsiLevel})`);
        }
        if (sug.indicators.macd) {
          logger.info(`    MACD: ${sug.indicators.macd.signal === 'bullish' ? '看涨' : '看跌'}`);
        }
        if (sug.indicators.bollingerBands) {
          const bb = sug.indicators.bollingerBands;
          logger.info(`    布林带: 上轨 ${bb.upper.toFixed(2)} | 中轨 ${bb.middle.toFixed(2)} | 下轨 ${bb.lower.toFixed(2)}`);
        }
      }
      
      logger.info(`\n  分析依据:`);
      sug.reasons.forEach(reason => {
        logger.info(`    ${reason}`);
      });
      
      // 操作建议
      logger.info(`\n  💡 操作建议:`);
      if (sug.action === 'long') {
        logger.info(`    • 建议开多，止损设在近期低点下方`);
        logger.info(`    • 建议仓位: ${sug.confidence > 70 ? '中等' : '轻仓'}`);
        logger.info(`    • 目标位: 观察上方阻力位`);
      } else if (sug.action === 'short') {
        logger.info(`    • 建议开空，止损设在近期高点上方`);
        logger.info(`    • 建议仓位: ${sug.confidence > 70 ? '中等' : '轻仓'}`);
        logger.info(`    • 目标位: 观察下方支撑位`);
      } else {
        logger.info(`    • 当前信号不明确，建议观望`);
        logger.info(`    • 等待更明确的趋势信号`);
        logger.info(`    • 可设置价格提醒，关注市场变化`);
      }
      
      logger.info('');
    }

    logger.info('═══════════════════════════════════════════════════════\n');
  }

  /**
   * 生成位置条形图
   */
  getPositionBar(position) {
    const total = 20;
    const filled = Math.max(0, Math.min(total, Math.floor((position / 100) * total)));
    const bar = '█'.repeat(filled) + '░'.repeat(total - filled);
    return `[${bar}]`;
  }
}

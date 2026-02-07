import { MarketAnalyzer } from '../services/market-analyzer.js';

/**
 * 量化交易模块
 * 集成到 realtime-pnl.js 中使用
 */
export class QuantTrader {
  constructor(config) {
    this.config = {
      enabled: config.enabled !== false, // 默认启用
      testMode: config.testMode !== false, // 默认测试模式
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      symbol: config.symbol || 'BTC-USDT',
      leverage: config.leverage || 5,
      initialBalance: config.initialBalance || 1000,
      positionSize: config.positionSize || 0.1,
      stopLoss: config.stopLoss || 0.02,
      takeProfit: config.takeProfit || 0.05,
      trailingStop: config.trailingStop || 0.03,
      maxPositions: config.maxPositions || 1,
      signalCheckInterval: config.signalCheckInterval || 30000, // 30秒检查一次信号
      minConfidence: config.minConfidence || 60, // 最小信心指数（0-100）
      makerFee: config.makerFee || 0.0002, // Maker 手续费 0.02%
      takerFee: config.takerFee || 0.0005, // Taker 手续费 0.05%（市价单）
    };

    this.analyzer = new MarketAnalyzer(config.accessKey, config.secretKey);
    this.dataCollector = config.dataCollector; // 数据收集器
    
    // 交易状态
    this.balance = this.config.initialBalance;
    this.positions = [];
    this.orders = [];
    this.lastPrice = 0;
    this.lastSignalCheckTime = 0;
    this.isCheckingSignal = false; // 信号检查锁
    this.isOpeningPosition = false; // 开仓锁
    
    // 统计数据
    this.stats = {
      totalTrades: 0,
      winTrades: 0,
      lossTrades: 0,
      totalProfit: 0,
      totalFees: 0, // 总手续费
      maxDrawdown: 0,
      peakBalance: this.config.initialBalance,
    };

    console.log('\n🤖 量化交易模块初始化');
    console.log(`   状态: ${this.config.enabled ? '✅ 已启用' : '❌ 已关闭'}`);
    console.log(`   模式: ${this.config.testMode ? '测试模式 (模拟交易)' : '实盘模式 (真实交易)'}`);
    console.log(`   交易对: ${this.config.symbol}`);
    console.log(`   初始资金: ${this.balance.toFixed(2)} USDT`);
    console.log(`   杠杆: ${this.config.leverage}x`);
    console.log(`   仓位: ${(this.config.positionSize * 100).toFixed(0)}%`);
    console.log(`   止损: ${(this.config.stopLoss * 100).toFixed(0)}% | 止盈: ${(this.config.takeProfit * 100).toFixed(0)}%`);
    console.log(`   最小信心指数: ${this.config.minConfidence}%`);
    
    if (!this.config.enabled) {
      console.log(`\n💡 提示: 在 .env 中设置 QUANT_ENABLED=true 启用量化交易\n`);
    } else {
      console.log(`\n✅ 量化交易已启动，等待 ${this.config.symbol} 行情数据...\n`);
    }
  }

  /**
   * 价格更新时调用（实时响应）
   */
  async onPriceUpdate(contractCode, price) {
    if (!this.config.enabled) {
      return;
    }

    // 调试日志
    if (contractCode === this.config.symbol) {
      console.log(`🔍 [量化] 收到价格更新: ${contractCode} = ${price.toFixed(2)} USDT`);
    }

    if (contractCode !== this.config.symbol) {
      return;
    }

    this.lastPrice = price;

    // 1. 检查现有持仓的止盈止损（实时）
    await this.checkPositions(price);

    // 2. 检查交易信号（限流：每30秒一次，且不能并发）
    const now = Date.now();
    if (!this.isCheckingSignal && 
        now - this.lastSignalCheckTime > this.config.signalCheckInterval &&
        this.positions.length < this.config.maxPositions) {
      
      this.isCheckingSignal = true;
      this.lastSignalCheckTime = now;
      
      try {
        await this.checkSignals(price);
      } finally {
        this.isCheckingSignal = false;
      }
    }

    // 3. 更新数据到收集器（供 Web 界面使用）
    this.updateDataCollector();
  }

  /**
   * 更新数据收集器
   */
  updateDataCollector() {
    if (!this.dataCollector) return;

    const status = this.getStatus();
    this.dataCollector.updateQuantData(status).catch(error => {
      console.error('❌ [量化] 更新数据收集器失败:', error.message);
    });
  }

  /**
   * 检查持仓的止盈止损
   */
  async checkPositions(currentPrice) {
    for (let i = this.positions.length - 1; i >= 0; i--) {
      const position = this.positions[i];
      const { direction, entryPrice, size, highestPrice, lowestPrice } = position;

      // 更新最高/最低价（用于移动止损）
      if (direction === 'long') {
        position.highestPrice = Math.max(highestPrice || entryPrice, currentPrice);
      } else {
        position.lowestPrice = Math.min(lowestPrice || entryPrice, currentPrice);
      }

      // 计算当前盈亏（价格变化百分比）
      let priceChangePercent;
      if (direction === 'long') {
        priceChangePercent = (currentPrice - entryPrice) / entryPrice;
      } else {
        priceChangePercent = (entryPrice - currentPrice) / entryPrice;
      }

      // 计算实际收益率（考虑杠杆）
      const profitPercent = priceChangePercent * this.config.leverage;

      // 调试日志
      console.log(`[调试] ${direction.toUpperCase()} 持仓检查: 入场=${entryPrice.toFixed(2)}, 当前=${currentPrice.toFixed(2)}, 价格变化=${(priceChangePercent * 100).toFixed(2)}%, 收益率=${(profitPercent * 100).toFixed(2)}% (${this.config.leverage}x杠杆), 止损=${(this.config.stopLoss * 100).toFixed(0)}%, 止盈=${(this.config.takeProfit * 100).toFixed(0)}%`);

      // 止损检查（按收益率）
      if (profitPercent <= -this.config.stopLoss) {
        console.log(`\n🛑 [量化] 触发止损: ${direction.toUpperCase()} @ ${currentPrice.toFixed(2)} (收益率 ${(profitPercent * 100).toFixed(2)}%)`);
        await this.closePosition(position, currentPrice, '止损');
        continue;
      }

      // 止盈检查（按收益率）
      if (profitPercent >= this.config.takeProfit) {
        console.log(`\n🎯 [量化] 触发止盈: ${direction.toUpperCase()} @ ${currentPrice.toFixed(2)} (收益率 ${(profitPercent * 100).toFixed(2)}%)`);
        await this.closePosition(position, currentPrice, '止盈');
        continue;
      }

      // 移动止损检查（按收益率）
      if (direction === 'long' && position.highestPrice) {
        const priceDrawdown = (position.highestPrice - currentPrice) / position.highestPrice;
        const drawdown = priceDrawdown * this.config.leverage; // 考虑杠杆
        if (drawdown >= this.config.trailingStop) {
          console.log(`\n📉 [量化] 触发移动止损: ${direction.toUpperCase()} @ ${currentPrice.toFixed(2)} (从最高点回撤收益率 ${(drawdown * 100).toFixed(2)}%)`);
          await this.closePosition(position, currentPrice, '移动止损');
          continue;
        }
      } else if (direction === 'short' && position.lowestPrice) {
        const priceDrawup = (currentPrice - position.lowestPrice) / position.lowestPrice;
        const drawup = priceDrawup * this.config.leverage; // 考虑杠杆
        if (drawup >= this.config.trailingStop) {
          console.log(`\n📈 [量化] 触发移动止损: ${direction.toUpperCase()} @ ${currentPrice.toFixed(2)} (从最低点反弹收益率 ${(drawup * 100).toFixed(2)}%)`);
          await this.closePosition(position, currentPrice, '移动止损');
          continue;
        }
      }
    }
  }

  /**
   * 检查交易信号
   */
  async checkSignals(currentPrice) {
    try {
      // 清除缓存，获取最新数据
      const suggestion = await this.analyzer.generateTradingSuggestion(this.config.symbol, currentPrice, null, true);

      if (!suggestion || suggestion.confidence < this.config.minConfidence) {
        if (suggestion && suggestion.confidence > 0) {
          console.log(`� [量化] 信号强度不足: ${suggestion.confidence}% < ${this.config.minConfidence}% (${suggestion.action})`);
        }
        return;
      }

      if (suggestion.action === 'long') {
        console.log(`\n� [量化] 检测到做多信号 (信心: ${suggestion.confidence}%)`);
        await this.openPosition('long', currentPrice, suggestion);
      } else if (suggestion.action === 'short') {
        console.log(`\n�📉 [量化] 检测到做空信号 (信心: ${suggestion.confidence}%)`);
        await this.openPosition('short', currentPrice, suggestion);
      }
    } catch (error) {
      console.error('❌ [量化] 信号检查错误:', error.message);
    }
  }

  /**
   * 开仓
   */
  async openPosition(direction, price, suggestion) {
    // 再次检查持仓数（防止并发开仓）
    if (this.positions.length >= this.config.maxPositions) {
      console.log(`⚠️ [量化] 已达到最大持仓数 ${this.config.maxPositions}，取消开仓`);
      return;
    }

    // 开仓锁
    if (this.isOpeningPosition) {
      console.log(`⚠️ [量化] 正在开仓中，跳过本次请求`);
      return;
    }

    this.isOpeningPosition = true;

    try {
      const positionValue = this.balance * this.config.positionSize;
      const size = (positionValue * this.config.leverage) / price;
      
      // 计算开仓手续费（使用 Taker 费率，因为是市价单）
      const openFee = positionValue * this.config.takerFee;
      
      // 从余额中扣除手续费
      this.balance -= openFee;
      this.stats.totalFees += openFee;

      const position = {
        id: Date.now(),
        direction: direction,
        entryPrice: price,
        size: size,
        value: positionValue,
        leverage: this.config.leverage,
        openTime: new Date(),
        openFee: openFee, // 记录开仓手续费
        highestPrice: direction === 'long' ? price : null,
        lowestPrice: direction === 'short' ? price : null,
        suggestion: suggestion,
      };

      if (this.config.testMode) {
        // 测试模式：直接添加持仓
        this.positions.push(position);
        console.log(`✅ [量化] 模拟开仓: ${direction.toUpperCase()} ${size.toFixed(4)} @ ${price.toFixed(2)}`);
        console.log(`   保证金: ${positionValue.toFixed(2)} USDT | 杠杆: ${this.config.leverage}x`);
        console.log(`   开仓手续费: ${openFee.toFixed(4)} USDT (${(this.config.takerFee * 100).toFixed(2)}%)`);
        console.log(`   当前持仓数: ${this.positions.length}/${this.config.maxPositions}`);
      } else {
        // 实盘模式：调用火币 API 开仓并设置止盈止损
        const success = await this.placeOrderWithTPSL(direction, size, price);
        if (success) {
          this.positions.push(position);
          console.log(`✅ [量化] 实盘开仓成功: ${direction.toUpperCase()} ${size.toFixed(4)} @ ${price.toFixed(2)}`);
          console.log(`   保证金: ${positionValue.toFixed(2)} USDT | 杠杆: ${this.config.leverage}x`);
          console.log(`   开仓手续费: ${openFee.toFixed(4)} USDT (${(this.config.takerFee * 100).toFixed(2)}%)`);
          console.log(`   当前持仓数: ${this.positions.length}/${this.config.maxPositions}`);
        } else {
          console.log(`❌ [量化] 实盘开仓失败`);
          // 开仓失败，退还手续费
          this.balance += openFee;
          this.stats.totalFees -= openFee;
          return;
        }
      }

      this.orders.push({
        ...position,
        type: 'open',
        status: 'filled',
      });

      // 更新数据收集器
      this.updateDataCollector();
    } finally {
      this.isOpeningPosition = false;
    }
  }

  /**
   * 下单并设置止盈止损（实盘模式）
   */
  async placeOrderWithTPSL(direction, size, price) {
    try {
      const axios = (await import('axios')).default;
      const crypto = (await import('crypto')).default;

      // 1. 先开仓
      const openSuccess = await this.placeOrder(direction, size, 'open');
      if (!openSuccess) {
        return false;
      }

      // 2. 计算止盈止损价格
      const stopLossPrice = direction === 'long'
        ? price * (1 - this.config.stopLoss)
        : price * (1 + this.config.stopLoss);
      
      const takeProfitPrice = direction === 'long'
        ? price * (1 + this.config.takeProfit)
        : price * (1 - this.config.takeProfit);

      // 3. 设置止盈止损订单（火币的 TP/SL 订单）
      await this.setTPSLOrder(direction, size, stopLossPrice, takeProfitPrice);

      return true;
    } catch (error) {
      console.error('❌ [量化] 下单失败:', error.message);
      return false;
    }
  }

  /**
   * 设置止盈止损订单
   */
  async setTPSLOrder(direction, size, stopLossPrice, takeProfitPrice) {
    try {
      const axios = (await import('axios')).default;
      const crypto = (await import('crypto')).default;

      const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '');
      const path = '/linear-swap-api/v1/swap_tpsl_order';

      // 火币止盈止损订单参数
      const params = {
        contract_code: this.config.symbol,
        direction: direction === 'long' ? 'sell' : 'buy', // 平仓方向相反
        volume: Math.floor(size), // 张数必须是整数
        // 止损
        sl_trigger_price: stopLossPrice.toFixed(2),
        sl_order_price: stopLossPrice.toFixed(2),
        sl_order_price_type: 'optimal_5', // 对手价
        // 止盈
        tp_trigger_price: takeProfitPrice.toFixed(2),
        tp_order_price: takeProfitPrice.toFixed(2),
        tp_order_price_type: 'optimal_5', // 对手价
      };

      // 生成签名
      const signature = this.generateSignature('POST', 'api.hbdm.com', path, {
        AccessKeyId: this.config.accessKey,
        SignatureMethod: 'HmacSHA256',
        SignatureVersion: '2',
        Timestamp: timestamp,
      });

      const url = `https://api.hbdm.com${path}`;
      const response = await axios.post(url, params, {
        headers: {
          'Content-Type': 'application/json',
        },
        params: signature,
      });

      if (response.data.status === 'ok') {
        console.log(`✅ [量化] 止盈止损订单设置成功`);
        console.log(`   止损价: ${stopLossPrice.toFixed(2)} USDT`);
        console.log(`   止盈价: ${takeProfitPrice.toFixed(2)} USDT`);
        return true;
      } else {
        console.error('❌ [量化] 止盈止损订单失败:', response.data.err_msg);
        return false;
      }
    } catch (error) {
      console.error('❌ [量化] 止盈止损订单错误:', error.message);
      return false;
    }
  }

  /**
   * 下单（开仓/平仓）
   */
  async placeOrder(direction, size, offset = 'open') {
    try {
      const axios = (await import('axios')).default;
      const crypto = (await import('crypto')).default;

      const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '');
      const path = '/linear-swap-api/v1/swap_order';

      const params = {
        contract_code: this.config.symbol,
        volume: Math.floor(size), // 张数必须是整数
        direction: direction === 'long' || direction === 'buy' ? 'buy' : 'sell',
        offset: offset,
        lever_rate: this.config.leverage,
        order_price_type: 'optimal_5', // 对手价
      };

      // 生成签名
      const signature = this.generateSignature('POST', 'api.hbdm.com', path, {
        AccessKeyId: this.config.accessKey,
        SignatureMethod: 'HmacSHA256',
        SignatureVersion: '2',
        Timestamp: timestamp,
      });

      const url = `https://api.hbdm.com${path}`;
      const response = await axios.post(url, params, {
        headers: {
          'Content-Type': 'application/json',
        },
        params: signature,
      });

      if (response.data.status === 'ok') {
        return true;
      } else {
        console.error('❌ [量化] 下单失败:', response.data.err_msg);
        return false;
      }
    } catch (error) {
      console.error('❌ [量化] 下单错误:', error.message);
      return false;
    }
  }

  /**
   * 生成签名
   */
  generateSignature(method, host, path, params) {
    const crypto = require('crypto');
    
    const sortedParams = Object.keys(params)
      .sort()
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');

    const signString = `${method}\n${host}\n${path}\n${sortedParams}`;
    const signature = crypto
      .createHmac('sha256', this.config.secretKey)
      .update(signString)
      .digest('base64');

    return {
      ...params,
      Signature: signature,
    };
  }

  /**
   * 平仓
   */
  async closePosition(position, price, reason) {
    const { direction, entryPrice, size, value, openFee } = position;

    // 计算价格变化百分比
    let priceChangePercent;
    if (direction === 'long') {
      priceChangePercent = (price - entryPrice) / entryPrice;
    } else {
      priceChangePercent = (entryPrice - price) / entryPrice;
    }

    // 计算平仓手续费
    const closeFee = value * this.config.takerFee;
    
    // 计算实际盈亏（考虑杠杆和手续费）
    const profitBeforeFee = value * priceChangePercent * this.config.leverage;
    const profit = profitBeforeFee - closeFee; // 扣除平仓手续费（开仓手续费已在开仓时扣除）
    const profitPercent = priceChangePercent * this.config.leverage * 100;
    const totalFees = openFee + closeFee;

    // 更新余额和统计
    this.balance += profit;
    this.stats.totalFees += closeFee;
    
    console.log(`✅ [量化] ${this.config.testMode ? '模拟' : '实盘'}平仓: ${direction.toUpperCase()} @ ${price.toFixed(2)}`);
    console.log(`   价格变化: ${(priceChangePercent * 100).toFixed(2)}% → 收益率: ${profitPercent >= 0 ? '+' : ''}${profitPercent.toFixed(2)}% (${this.config.leverage}x杠杆)`);
    console.log(`   盈亏(扣费前): ${profitBeforeFee >= 0 ? '+' : ''}${profitBeforeFee.toFixed(4)} USDT`);
    console.log(`   手续费: ${totalFees.toFixed(4)} USDT (开仓 ${openFee.toFixed(4)} + 平仓 ${closeFee.toFixed(4)})`);
    console.log(`   净盈亏: ${profit >= 0 ? '+' : ''}${profit.toFixed(4)} USDT`);
    console.log(`   原因: ${reason}`);

    // 更新统计
    this.stats.totalTrades++;
    if (profit > 0) {
      this.stats.winTrades++;
    } else {
      this.stats.lossTrades++;
    }
    this.stats.totalProfit += profit;

    // 更新最大回撤
    if (this.balance > this.stats.peakBalance) {
      this.stats.peakBalance = this.balance;
    }
    const drawdown = (this.stats.peakBalance - this.balance) / this.stats.peakBalance;
    if (drawdown > this.stats.maxDrawdown) {
      this.stats.maxDrawdown = drawdown;
    }

    // 记录订单
    this.orders.push({
      ...position,
      type: 'close',
      closePrice: price,
      closeTime: new Date(),
      profit: profit,
      profitPercent: profitPercent,
      reason: reason,
      status: 'filled',
    });

    // 移除持仓
    this.positions = this.positions.filter(p => p.id !== position.id);

    // 更新数据收集器
    this.updateDataCollector();
  }

  /**
   * 获取状态摘要
   */
  getStatus() {
    if (!this.config.enabled) {
      return null;
    }

    return {
      enabled: this.config.enabled,
      testMode: this.config.testMode,
      symbol: this.config.symbol,
      balance: this.balance,
      lastPrice: this.lastPrice,
      positions: this.positions.map(pos => {
        let profitUSDT, profitPercent, roe;
        if (pos.direction === 'long') {
          profitUSDT = (this.lastPrice - pos.entryPrice) * pos.size;
          profitPercent = (this.lastPrice - pos.entryPrice) / pos.entryPrice * 100;
        } else {
          profitUSDT = (pos.entryPrice - this.lastPrice) * pos.size;
          profitPercent = (pos.entryPrice - this.lastPrice) / pos.entryPrice * 100;
        }
        roe = (profitUSDT / pos.value) * 100;

        return {
          direction: pos.direction,
          entryPrice: pos.entryPrice,
          size: pos.size,
          value: pos.value,
          profitUSDT: profitUSDT,
          profitPercent: profitPercent,
          roe: roe,
          openTime: pos.openTime,
        };
      }),
      stats: this.stats,
    };
  }

  /**
   * 打印状态
   */
  printStatus() {
    if (!this.config.enabled) {
      return;
    }

    console.log(`\n${'═'.repeat(80)}`);
    console.log(`🤖 [量化交易] ${this.config.symbol} - ${this.config.testMode ? '测试模式' : '实盘模式'}`);
    console.log(`${'─'.repeat(80)}`);
    console.log(`💰 账户余额: ${this.balance.toFixed(2)} USDT`);
    console.log(`💵 当前价格: ${this.lastPrice.toFixed(2)} USDT`);
    console.log(`📈 持仓数量: ${this.positions.length}/${this.config.maxPositions}`);

    if (this.positions.length > 0) {
      console.log(`\n持仓详情:`);
      this.positions.forEach((pos, idx) => {
        let profitUSDT, profitPercent, roe;
        if (pos.direction === 'long') {
          profitUSDT = (this.lastPrice - pos.entryPrice) * pos.size;
          profitPercent = (this.lastPrice - pos.entryPrice) / pos.entryPrice * 100;
        } else {
          profitUSDT = (pos.entryPrice - this.lastPrice) * pos.size;
          profitPercent = (pos.entryPrice - this.lastPrice) / pos.entryPrice * 100;
        }
        roe = (profitUSDT / pos.value) * 100;

        const emoji = profitUSDT >= 0 ? '🟢' : '🔴';
        const sign = profitUSDT >= 0 ? '+' : '';

        console.log(`\n  持仓 #${idx + 1} ${emoji}`);
        console.log(`    方向: ${pos.direction === 'long' ? '做多 (LONG)' : '做空 (SHORT)'}`);
        console.log(`    开仓价: ${pos.entryPrice.toFixed(2)} | 最新价: ${this.lastPrice.toFixed(2)}`);
        console.log(`    保证金: ${pos.value.toFixed(2)} USDT | 杠杆: ${pos.leverage}x`);
        console.log(`    ${emoji} 收益: ${sign}${profitUSDT.toFixed(2)} USDT (ROE: ${sign}${roe.toFixed(2)}%)`);
      });
    }

    console.log(`\n统计数据:`);
    console.log(`  总交易: ${this.stats.totalTrades} | 胜: ${this.stats.winTrades} | 负: ${this.stats.lossTrades}`);
    console.log(`  胜率: ${this.stats.totalTrades > 0 ? ((this.stats.winTrades / this.stats.totalTrades) * 100).toFixed(2) : 0}%`);
    
    const totalProfitPercent = (this.stats.totalProfit / this.config.initialBalance) * 100;
    const emoji = this.stats.totalProfit >= 0 ? '🟢' : '🔴';
    const sign = this.stats.totalProfit >= 0 ? '+' : '';
    
    console.log(`  ${emoji} 总盈亏: ${sign}${this.stats.totalProfit.toFixed(2)} USDT (${sign}${totalProfitPercent.toFixed(2)}%)`);
    console.log(`  💸 总手续费: ${this.stats.totalFees.toFixed(4)} USDT`);
    console.log(`  📉 最大回撤: ${(this.stats.maxDrawdown * 100).toFixed(2)}%`);
    console.log(`${'═'.repeat(80)}\n`);
  }
}

import { MarketAnalyzer } from './market-analyzer.js';
import { HTXFuturesClient } from './client.js';
import axios from 'axios';
import crypto from 'crypto';

/**
 * 量化交易引擎
 * 支持测试模式和实盘模式
 */
export class TradingEngine {
  constructor(config) {
    this.config = {
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      testMode: config.testMode !== false, // 默认测试模式
      symbol: config.symbol || 'BTC-USDT',
      leverage: config.leverage || 5,
      initialBalance: config.initialBalance || 1000, // 测试模式初始资金
      positionSize: config.positionSize || 0.1, // 每次开仓比例（10%）
      stopLoss: config.stopLoss || 0.02, // 止损 2%
      takeProfit: config.takeProfit || 0.05, // 止盈 5%
      trailingStop: config.trailingStop || 0.03, // 移动止损 3%
      maxPositions: config.maxPositions || 1, // 最大持仓数
      checkInterval: config.checkInterval || 10000, // 检查间隔 10秒
    };

    this.analyzer = new MarketAnalyzer(config.accessKey, config.secretKey);
    this.client = null;
    
    // 交易状态
    this.balance = this.config.initialBalance;
    this.positions = []; // 当前持仓
    this.orders = []; // 历史订单
    this.isRunning = false;
    this.lastPrice = 0;
    this.lastSignalCheckTime = 0; // 上次检查交易信号的时间
    
    // 统计数据
    this.stats = {
      totalTrades: 0,
      winTrades: 0,
      lossTrades: 0,
      totalProfit: 0,
      maxDrawdown: 0,
      peakBalance: this.config.initialBalance,
    };
  }

  /**
   * 启动交易引擎
   */
  async start() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('🚀 量化交易引擎启动');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`📊 交易对: ${this.config.symbol}`);
    console.log(`🔧 模式: ${this.config.testMode ? '测试模式 (模拟交易)' : '实盘模式 (真实交易)'}`);
    console.log(`💰 ${this.config.testMode ? '初始资金' : '账户余额'}: ${this.balance.toFixed(2)} USDT`);
    console.log(`📈 杠杆倍数: ${this.config.leverage}x`);
    console.log(`📊 仓位大小: ${(this.config.positionSize * 100).toFixed(0)}%`);
    console.log(`🛡️ 止损: ${(this.config.stopLoss * 100).toFixed(0)}%`);
    console.log(`🎯 止盈: ${(this.config.takeProfit * 100).toFixed(0)}%`);
    console.log(`📉 移动止损: ${(this.config.trailingStop * 100).toFixed(0)}%`);
    console.log('═══════════════════════════════════════════════════════\n');

    this.isRunning = true;

    // 测试模式和实盘模式都连接 WebSocket 获取实时价格
    await this.connectWebSocket();

    // 启动主循环
    this.mainLoop();
  }

  /**
   * 连接 WebSocket（获取实时行情）
   */
  async connectWebSocket() {
    console.log('🔗 连接实时行情...');
    
    // 使用公共 WebSocket（不需要认证，只获取行情）
    const WebSocket = (await import('ws')).default;
    const pako = (await import('pako')).default;
    
    this.ws = new WebSocket('wss://api.hbdm.com/linear-swap-ws');
    
    this.ws.on('open', () => {
      console.log('✅ 实时行情连接成功');
      
      // 订阅行情
      const subMessage = {
        sub: `market.${this.config.symbol}.ticker`,
        id: `ticker_${Date.now()}`
      };
      this.ws.send(JSON.stringify(subMessage));
      console.log(`📊 订阅 ${this.config.symbol} 实时行情\n`);
    });

    this.ws.on('message', (data) => {
      try {
        const text = pako.inflate(data, { to: 'string' });
        const message = JSON.parse(text);

        // 处理 ping
        if (message.ping) {
          this.ws.send(JSON.stringify({ pong: message.ping }));
          return;
        }

        // 处理行情推送 - 每次收到新价格立即检查
        if (message.tick && message.tick.last) {
          const newPrice = parseFloat(message.tick.last);
          
          // 价格变化才处理（避免重复）
          if (newPrice !== this.lastPrice) {
            this.lastPrice = newPrice;
            
            // 立即检查持仓和交易信号
            this.onPriceUpdate(newPrice).catch(error => {
              console.error('❌ 价格更新处理错误:', error.message);
            });
          }
        }
      } catch (error) {
        // 忽略解析错误
      }
    });

    this.ws.on('error', (error) => {
      console.error('❌ WebSocket 错误:', error.message);
    });

    this.ws.on('close', () => {
      console.log('🔌 WebSocket 连接关闭');
      if (this.isRunning) {
        console.log('⏳ 5秒后重连...');
        setTimeout(() => this.connectWebSocket(), 5000);
      }
    });

    // 等待连接建立
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  /**
   * 价格更新时的处理（实时响应）
   */
  async onPriceUpdate(currentPrice) {
    // 1. 检查现有持仓的止盈止损
    await this.checkPositions(currentPrice);

    // 2. 如果没有达到最大持仓数，检查是否有新的交易信号（限流：每30秒检查一次）
    const now = Date.now();
    if (!this.lastSignalCheckTime || now - this.lastSignalCheckTime > 30000) {
      if (this.positions.length < this.config.maxPositions) {
        await this.checkSignals(currentPrice);
        this.lastSignalCheckTime = now;
      }
    }
  }

  /**
   * 主循环（定期打印状态）
   */
  async mainLoop() {
    while (this.isRunning) {
      try {
        // 定期打印状态（每10秒）
        if (this.lastPrice > 0) {
          this.printStatus();
        }
        await this.sleep(10000);
      } catch (error) {
        console.error('❌ 主循环错误:', error.message);
        await this.sleep(5000);
      }
    }
  }



  /**
   * 检查持仓的止盈止损
   */
  async checkPositions(currentPrice) {
    for (const position of this.positions) {
      const { direction, entryPrice, size, highestPrice, lowestPrice } = position;

      // 更新最高/最低价（用于移动止损）
      if (direction === 'long') {
        position.highestPrice = Math.max(highestPrice || entryPrice, currentPrice);
      } else {
        position.lowestPrice = Math.min(lowestPrice || entryPrice, currentPrice);
      }

      // 计算当前盈亏
      let profitPercent;
      if (direction === 'long') {
        profitPercent = (currentPrice - entryPrice) / entryPrice;
      } else {
        profitPercent = (entryPrice - currentPrice) / entryPrice;
      }

      // 止损检查
      if (profitPercent <= -this.config.stopLoss) {
        console.log(`\n🛑 触发止损: ${direction.toUpperCase()} @ ${currentPrice.toFixed(2)} (亏损 ${(profitPercent * 100).toFixed(2)}%)`);
        await this.closePosition(position, currentPrice, '止损');
        continue;
      }

      // 止盈检查
      if (profitPercent >= this.config.takeProfit) {
        console.log(`\n🎯 触发止盈: ${direction.toUpperCase()} @ ${currentPrice.toFixed(2)} (盈利 ${(profitPercent * 100).toFixed(2)}%)`);
        await this.closePosition(position, currentPrice, '止盈');
        continue;
      }

      // 移动止损检查
      if (direction === 'long' && position.highestPrice) {
        const drawdown = (position.highestPrice - currentPrice) / position.highestPrice;
        if (drawdown >= this.config.trailingStop) {
          console.log(`\n📉 触发移动止损: ${direction.toUpperCase()} @ ${currentPrice.toFixed(2)} (回撤 ${(drawdown * 100).toFixed(2)}%)`);
          await this.closePosition(position, currentPrice, '移动止损');
          continue;
        }
      } else if (direction === 'short' && position.lowestPrice) {
        const drawup = (currentPrice - position.lowestPrice) / position.lowestPrice;
        if (drawup >= this.config.trailingStop) {
          console.log(`\n📈 触发移动止损: ${direction.toUpperCase()} @ ${currentPrice.toFixed(2)} (回升 ${(drawup * 100).toFixed(2)}%)`);
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
    // 使用市场分析器生成交易建议，清除缓存获取最新数据
    const suggestion = await this.analyzer.generateTradingSuggestion(this.config.symbol, currentPrice, null, true);

    if (!suggestion) {
      return;
    }

    // 信心指数必须大于 60 才开仓
    if (suggestion.confidence < 60) {
      return;
    }

    // 根据建议开仓
    if (suggestion.action === 'long') {
      console.log(`\n📈 检测到做多信号 (信心: ${suggestion.confidence}%)`);
      await this.openPosition('long', currentPrice, suggestion);
    } else if (suggestion.action === 'short') {
      console.log(`\n📉 检测到做空信号 (信心: ${suggestion.confidence}%)`);
      await this.openPosition('short', currentPrice, suggestion);
    }
  }

  /**
   * 开仓
   */
  async openPosition(direction, price, suggestion) {
    // 计算仓位大小
    const positionValue = this.balance * this.config.positionSize;
    const size = (positionValue * this.config.leverage) / price;

    const position = {
      id: Date.now(),
      direction: direction,
      entryPrice: price,
      size: size,
      value: positionValue,
      leverage: this.config.leverage,
      openTime: new Date(),
      highestPrice: direction === 'long' ? price : null,
      lowestPrice: direction === 'short' ? price : null,
      suggestion: suggestion,
    };

    if (this.config.testMode) {
      // 测试模式：直接添加持仓
      this.positions.push(position);
      console.log(`✅ 模拟开仓成功: ${direction.toUpperCase()} ${size.toFixed(4)} @ ${price.toFixed(2)}`);
    } else {
      // 实盘模式：调用火币 API 下单
      const success = await this.placeOrder(direction, size, price);
      if (success) {
        this.positions.push(position);
        console.log(`✅ 实盘开仓成功: ${direction.toUpperCase()} ${size.toFixed(4)} @ ${price.toFixed(2)}`);
      } else {
        console.log(`❌ 实盘开仓失败`);
      }
    }

    // 记录订单
    this.orders.push({
      ...position,
      type: 'open',
      status: 'filled',
    });
  }

  /**
   * 平仓
   */
  async closePosition(position, price, reason) {
    const { direction, entryPrice, size, value } = position;

    // 计算盈亏
    let profit;
    if (direction === 'long') {
      profit = (price - entryPrice) * size;
    } else {
      profit = (entryPrice - price) * size;
    }

    const profitPercent = (profit / value) * 100;

    if (this.config.testMode) {
      // 测试模式：更新余额
      this.balance += profit;
      console.log(`✅ 模拟平仓成功: ${direction.toUpperCase()} @ ${price.toFixed(2)} | 盈亏: ${profit.toFixed(2)} USDT (${profitPercent.toFixed(2)}%)`);
    } else {
      // 实盘模式：调用火币 API 平仓
      const success = await this.placeOrder(direction === 'long' ? 'sell' : 'buy', size, price, true);
      if (success) {
        console.log(`✅ 实盘平仓成功: ${direction.toUpperCase()} @ ${price.toFixed(2)} | 盈亏: ${profit.toFixed(2)} USDT (${profitPercent.toFixed(2)}%)`);
      } else {
        console.log(`❌ 实盘平仓失败`);
        return;
      }
    }

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
  }

  /**
   * 下单（实盘模式）
   */
  async placeOrder(direction, size, price, isClose = false) {
    try {
      const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '');
      const path = '/linear-swap-api/v1/swap_order';
      
      const params = {
        contract_code: this.config.symbol,
        volume: size.toFixed(0),
        direction: direction === 'long' || direction === 'buy' ? 'buy' : 'sell',
        offset: isClose ? 'close' : 'open',
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
        console.error('❌ 下单失败:', response.data.err_msg);
        return false;
      }
    } catch (error) {
      console.error('❌ 下单错误:', error.message);
      return false;
    }
  }

  /**
   * 生成签名
   */
  generateSignature(method, host, path, params) {
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
   * 打印状态
   */
  printStatus() {
    const timestamp = new Date().toLocaleString('zh-CN');
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`[${timestamp}] 📊 交易状态`);
    console.log(`${'─'.repeat(80)}`);
    console.log(`� 账户余额: ${this.balance.toFixed(2)} USDT`);
    console.log(`💵 当前价格: ${this.lastPrice.toFixed(2)} USDT`);
    console.log(`📈 持仓数量: ${this.positions.length}/${this.config.maxPositions}`);
    
    if (this.positions.length > 0) {
      console.log(`\n${'─'.repeat(80)}`);
      console.log(`📋 持仓详情:`);
      console.log(`${'─'.repeat(80)}`);
      
      this.positions.forEach((pos, idx) => {
        // 计算盈亏
        let profitUSDT, profitPercent;
        if (pos.direction === 'long') {
          profitUSDT = (this.lastPrice - pos.entryPrice) * pos.size;
          profitPercent = (this.lastPrice - pos.entryPrice) / pos.entryPrice * 100;
        } else {
          profitUSDT = (pos.entryPrice - this.lastPrice) * pos.size;
          profitPercent = (pos.entryPrice - this.lastPrice) / pos.entryPrice * 100;
        }

        // 计算保证金（仓位价值 / 杠杆）
        const margin = pos.value;
        
        // 计算收益率（基于保证金）
        const roe = (profitUSDT / margin) * 100;

        // 计算持仓时长
        const holdTime = Math.floor((Date.now() - pos.openTime.getTime()) / 1000 / 60); // 分钟
        const holdTimeStr = holdTime >= 60 
          ? `${Math.floor(holdTime / 60)}小时${holdTime % 60}分钟`
          : `${holdTime}分钟`;

        const emoji = profitUSDT >= 0 ? '🟢' : '🔴';
        const sign = profitUSDT >= 0 ? '+' : '';
        
        console.log(`\n持仓 #${idx + 1} ${emoji}`);
        console.log(`  方向: ${pos.direction === 'long' ? '做多 (LONG)' : '做空 (SHORT)'}`);
        console.log(`  数量: ${pos.size.toFixed(4)} ${this.config.symbol.split('-')[0]}`);
        console.log(`  杠杆: ${pos.leverage}x`);
        console.log(`  开仓价格: ${pos.entryPrice.toFixed(2)} USDT`);
        console.log(`  最新价格: ${this.lastPrice.toFixed(2)} USDT`);
        console.log(`  保证金: ${margin.toFixed(2)} USDT`);
        console.log(`  ${emoji} 收益: ${sign}${profitUSDT.toFixed(2)} USDT`);
        console.log(`  ${emoji} 收益率(ROE): ${sign}${roe.toFixed(2)}%`);
        console.log(`  ${emoji} 价格涨跌: ${sign}${profitPercent.toFixed(2)}%`);
        console.log(`  持仓时长: ${holdTimeStr}`);
        
        // 显示最高/最低价（用于移动止损）
        if (pos.direction === 'long' && pos.highestPrice) {
          const drawdown = ((pos.highestPrice - this.lastPrice) / pos.highestPrice * 100);
          console.log(`  最高价: ${pos.highestPrice.toFixed(2)} USDT (回撤 ${drawdown.toFixed(2)}%)`);
        } else if (pos.direction === 'short' && pos.lowestPrice) {
          const drawup = ((this.lastPrice - pos.lowestPrice) / pos.lowestPrice * 100);
          console.log(`  最低价: ${pos.lowestPrice.toFixed(2)} USDT (反弹 ${drawup.toFixed(2)}%)`);
        }

        // 显示止盈止损位
        const stopLossPrice = pos.direction === 'long'
          ? pos.entryPrice * (1 - this.config.stopLoss)
          : pos.entryPrice * (1 + this.config.stopLoss);
        const takeProfitPrice = pos.direction === 'long'
          ? pos.entryPrice * (1 + this.config.takeProfit)
          : pos.entryPrice * (1 - this.config.takeProfit);
        
        console.log(`  🛡️ 止损价: ${stopLossPrice.toFixed(2)} USDT (${this.config.stopLoss * 100}%)`);
        console.log(`  🎯 止盈价: ${takeProfitPrice.toFixed(2)} USDT (${this.config.takeProfit * 100}%)`);
      });
    }

    console.log(`\n${'─'.repeat(80)}`);
    console.log(`📊 统计数据:`);
    console.log(`${'─'.repeat(80)}`);
    console.log(`  总交易次数: ${this.stats.totalTrades} 笔`);
    console.log(`  盈利次数: ${this.stats.winTrades} 笔 | 亏损次数: ${this.stats.lossTrades} 笔`);
    console.log(`  胜率: ${this.stats.totalTrades > 0 ? ((this.stats.winTrades / this.stats.totalTrades) * 100).toFixed(2) : 0}%`);
    
    const totalProfitPercent = (this.stats.totalProfit / this.config.initialBalance) * 100;
    const totalProfitEmoji = this.stats.totalProfit >= 0 ? '🟢' : '🔴';
    const totalProfitSign = this.stats.totalProfit >= 0 ? '+' : '';
    
    console.log(`  ${totalProfitEmoji} 总盈亏: ${totalProfitSign}${this.stats.totalProfit.toFixed(2)} USDT (${totalProfitSign}${totalProfitPercent.toFixed(2)}%)`);
    console.log(`  最大回撤: ${(this.stats.maxDrawdown * 100).toFixed(2)}%`);
    console.log(`${'═'.repeat(80)}`);
  }

  /**
   * 停止交易引擎
   */
  stop() {
    console.log('\n🛑 停止交易引擎...');
    this.isRunning = false;
    
    if (this.client) {
      this.client.close();
    }

    // 打印最终报告
    this.printFinalReport();
  }

  /**
   * 打印最终报告
   */
  printFinalReport() {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('📊 交易总结报告');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`💰 初始资金: ${this.config.initialBalance.toFixed(2)} USDT`);
    console.log(`💵 最终余额: ${this.balance.toFixed(2)} USDT`);
    console.log(`📈 总盈亏: ${this.stats.totalProfit.toFixed(2)} USDT (${((this.stats.totalProfit / this.config.initialBalance) * 100).toFixed(2)}%)`);
    console.log(`\n📊 交易统计:`);
    console.log(`  总交易次数: ${this.stats.totalTrades}`);
    console.log(`  盈利次数: ${this.stats.winTrades}`);
    console.log(`  亏损次数: ${this.stats.lossTrades}`);
    console.log(`  胜率: ${this.stats.totalTrades > 0 ? ((this.stats.winTrades / this.stats.totalTrades) * 100).toFixed(2) : 0}%`);
    console.log(`  最大回撤: ${(this.stats.maxDrawdown * 100).toFixed(2)}%`);
    console.log('═══════════════════════════════════════════════════════\n');
  }

  /**
   * 睡眠
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

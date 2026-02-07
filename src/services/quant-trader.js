import { MarketAnalyzer } from '../services/market-analyzer.js';
import { SimpleSignalGenerator } from '../services/simple-signal-generator.js';
import { ScalpingSignalGenerator } from '../services/scalping-signal-generator.js';
import { createLogger } from '../utils/logger.js';
import { redisClient } from '../config/redis-client.js';

const logger = createLogger('量化交易');

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
      signalMode: config.signalMode || 'simple', // 信号模式：'simple' 简化版，'advanced' 复杂版
      makerFee: config.makerFee || 0.0002, // Maker 手续费 0.02%
      takerFee: config.takerFee || 0.0005, // Taker 手续费 0.05%（市价单）
    };

    // 初始化信号生成器（根据配置选择）
    if (this.config.signalMode === 'scalping') {
      this.signalGenerator = new ScalpingSignalGenerator(config.accessKey, config.secretKey);
      logger.info('📊 使用超短线信号生成器（快进快出）');
    } else if (this.config.signalMode === 'simple') {
      this.signalGenerator = new SimpleSignalGenerator(config.accessKey, config.secretKey);
      logger.info('📊 使用简化版信号生成器');
    } else {
      this.analyzer = new MarketAnalyzer(config.accessKey, config.secretKey);
      logger.info('📊 使用复杂版信号生成器');
    }
    
    this.dataCollector = config.dataCollector; // 数据收集器
    
    // Redis 键名：测试模式和实盘模式使用不同的键，严格隔离
    // 格式：quant:test:BTC-USDT 或 quant:live:BTC-USDT
    const modePrefix = this.config.testMode ? 'test' : 'live';
    this.redisKey = `quant:${modePrefix}:${this.config.symbol}`;
    
    // 交易状态（将从 Redis 加载或使用默认值）
    this.balance = this.config.initialBalance;
    this.positions = [];
    this.orders = [];
    this.lastPrice = 0;
    this.lastSignalCheckTime = 0;
    this.lastSignalCheckPrice = 0; // 上次检查信号时的价格
    this.lastPositionAnalysisTime = 0; // 上次持仓分析时间
    this.lastPositionAnalysisPrice = 0; // 上次持仓分析时的价格
    this.isCheckingSignal = false; // 信号检查锁
    this.isAnalyzingPosition = false; // 持仓分析锁
    this.isOpeningPosition = false; // 开仓锁
    this.needVerifyPositions = false; // 是否需要验证持仓（重启后，仅测试模式）
    this.hasVerifiedPositions = false; // 是否已验证持仓
    
    // 信号历史（最多保留20条）
    this.signalHistory = [];
    
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
    
    // 初始化：加载状态
    this.initPromise = this.loadState();
    
    // 启动命令监听（测试模式）
    if (this.config.testMode) {
      this.startCommandListener();
    }
    
    // 启动配置热重载监听（使用 Redis Pub/Sub）
    this.startConfigReloader();
  }
  
  /**
   * 启动配置热重载（使用 Redis Pub/Sub 立即监听）
   */
  async startConfigReloader() {
    try {
      const Redis = (await import('ioredis')).default;
      
      // 创建订阅客户端（独立连接）
      this.configSubscriber = new Redis({
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        db: parseInt(process.env.REDIS_DB || '3'),
        password: process.env.REDIS_PASSWORD || undefined
      });
      
      // 订阅配置更新频道
      await this.configSubscriber.subscribe('htx:config:update', (err) => {
        if (err) {
          logger.error('订阅配置更新频道失败:', err.message);
        } else {
          logger.debug('✅ 已订阅配置更新频道');
        }
      });
      
      // 监听配置更新消息
      this.configSubscriber.on('message', async (channel, message) => {
        if (channel === 'htx:config:update') {
          logger.debug('📨 收到配置更新通知');
          await this.reloadConfig();
        }
      });
      
    } catch (error) {
      logger.error('启动配置热重载失败:', error.message);
    }
  }
  
  /**
   * 重新加载配置（带锁保护）
   */
  async reloadConfig() {
    // 配置更新锁，防止并发更新
    if (this.isReloadingConfig) {
      logger.debug('配置正在更新中，跳过本次请求');
      return;
    }
    
    this.isReloadingConfig = true;
    
    try {
      const { redisClient } = await import('../config/redis-client.js');
      const config = await redisClient.getConfig();
      
      if (!config || !config.quantConfig) {
        return;
      }
      
      const newConfig = config.quantConfig;
      
      // 检查是否有配置变化
      let hasChanges = false;
      const changes = [];
      
      // 检查可热更新的配置项
      if (newConfig.enabled !== undefined && newConfig.enabled !== this.config.enabled) {
        this.config.enabled = newConfig.enabled;
        hasChanges = true;
        changes.push(`启用状态: ${newConfig.enabled ? '✅ 已启用' : '❌ 已关闭'}`);
      }
      
      if (newConfig.positionSize !== undefined && newConfig.positionSize !== this.config.positionSize) {
        this.config.positionSize = newConfig.positionSize;
        hasChanges = true;
        changes.push(`开仓比例: ${(newConfig.positionSize * 100).toFixed(0)}%`);
      }
      
      if (newConfig.stopLoss !== undefined && newConfig.stopLoss !== this.config.stopLoss) {
        this.config.stopLoss = newConfig.stopLoss;
        hasChanges = true;
        changes.push(`止损: ${(newConfig.stopLoss * 100).toFixed(0)}%`);
      }
      
      if (newConfig.takeProfit !== undefined && newConfig.takeProfit !== this.config.takeProfit) {
        this.config.takeProfit = newConfig.takeProfit;
        hasChanges = true;
        changes.push(`止盈: ${(newConfig.takeProfit * 100).toFixed(0)}%`);
      }
      
      if (newConfig.trailingStop !== undefined && newConfig.trailingStop !== this.config.trailingStop) {
        this.config.trailingStop = newConfig.trailingStop;
        hasChanges = true;
        changes.push(`移动止损: ${(newConfig.trailingStop * 100).toFixed(0)}%`);
      }
      
      if (newConfig.maxPositions !== undefined && newConfig.maxPositions !== this.config.maxPositions) {
        this.config.maxPositions = newConfig.maxPositions;
        hasChanges = true;
        changes.push(`最大持仓数: ${newConfig.maxPositions}`);
      }
      
      if (newConfig.minConfidence !== undefined && newConfig.minConfidence !== this.config.minConfidence) {
        this.config.minConfidence = newConfig.minConfidence;
        hasChanges = true;
        changes.push(`最小信心指数: ${newConfig.minConfidence}%`);
      }
      
      if (hasChanges) {
        logger.info('\n🔄 配置已自动更新：');
        changes.forEach(change => logger.info(`   ${change}`));
        logger.info('');
      }
      
      // 不可热更新的配置项（需要重启）
      const needRestart = [];
      
      if (newConfig.testMode !== undefined && newConfig.testMode !== this.config.testMode) {
        needRestart.push(`模式: ${newConfig.testMode ? '测试' : '实盘'}`);
      }
      
      if (newConfig.symbol !== undefined && newConfig.symbol !== this.config.symbol) {
        needRestart.push(`交易对: ${newConfig.symbol}`);
      }
      
      if (newConfig.leverage !== undefined && newConfig.leverage !== this.config.leverage) {
        needRestart.push(`杠杆: ${newConfig.leverage}x`);
      }
      
      if (newConfig.initialBalance !== undefined && newConfig.initialBalance !== this.config.initialBalance) {
        needRestart.push(`初始资金: ${newConfig.initialBalance} USDT`);
      }
      
      if (needRestart.length > 0) {
        logger.warn('\n⚠️  以下配置需要重启程序才能生效：');
        needRestart.forEach(item => logger.warn(`   ${item}`));
        logger.warn('   请重启监控程序: node realtime-pnl.js\n');
      }
      
    } catch (error) {
      logger.error('重新加载配置失败:', error.message);
    } finally {
      this.isReloadingConfig = false;
    }
  }
  
  /**
   * 启动命令监听（通过 Redis 接收重置命令）
   */
  startCommandListener() {
    // 每秒检查一次是否有命令
    this.commandCheckInterval = setInterval(async () => {
      try {
        const command = await redisClient.getCache(`quant:command:${this.config.symbol}`);
        if (command && command.timestamp > Date.now() - 5000) {
          if (command.action === 'reset') {
            logger.info('📨 收到重置命令，正在重置状态...');
            
            // 重新从 Redis 读取最新配置
            try {
              const { redisClient: rc } = await import('../config/redis-client.js');
              const config = await rc.getConfig();
              
              if (config && config.quantConfig && config.quantConfig.initialBalance !== undefined) {
                this.config.initialBalance = config.quantConfig.initialBalance;
                logger.info(`✅ 使用最新配置的初始资金: ${this.config.initialBalance} USDT`);
              }
            } catch (error) {
              logger.warn('读取最新配置失败，使用当前配置:', error.message);
            }
            
            // 重置内存中的状态
            this.balance = this.config.initialBalance;
            this.positions = [];
            this.orders = [];
            this.lastPrice = 0;
            this.stats = {
              totalTrades: 0,
              winTrades: 0,
              lossTrades: 0,
              totalProfit: 0,
              totalFees: 0,
              maxDrawdown: 0,
              peakBalance: this.config.initialBalance,
            };
            
            // 删除命令（避免重复执行）
            await redisClient.delCache(`quant:command:${this.config.symbol}`);
            
            // 更新前端
            this.updateDataCollector();
            
            logger.info('✅ 状态已重置（通过命令）');
          } else if (command.action === 'stop') {
            logger.info('📨 收到停止命令...');
            
            const result = await this.stop();
            
            // 删除命令
            await redisClient.delCache(`quant:command:${this.config.symbol}`);
            
            if (result.success) {
              logger.info('✅ 量化交易已停止');
              // 更新前端
              this.updateDataCollector();
            } else {
              logger.warn(`⚠️  ${result.message}`);
            }
          }
        }
      } catch (error) {
        logger.error('检查命令失败:', error.message);
      }
    }, 1000); // 每秒检查一次
  }
  
  /**
   * 从 Redis 加载状态（仅测试模式）
   */
  async loadState() {
    if (!this.config.testMode) {
      logger.info('🔴 实盘模式：从 WebSocket 实时获取持仓数据');
      // 实盘模式不需要加载状态，直接从 WebSocket 获取
      // 持仓数据会通过 onPositionsUpdate() 实时更新
      this.printInitInfo();
      return;
    }
    
    try {
      const savedState = await redisClient.getCache(this.redisKey);
      
      if (savedState) {
        this.balance = savedState.balance || this.config.initialBalance;
        this.positions = savedState.positions || [];
        this.orders = savedState.orders || [];
        this.stats = savedState.stats || this.stats;
        
        logger.info('✅ 从 Redis 加载测试模式状态');
        logger.info(`   Redis Key: ${this.redisKey}`);
        logger.info(`   余额: ${this.balance.toFixed(2)} USDT`);
        logger.info(`   持仓数: ${this.positions.length}`);
        logger.info(`   总交易: ${this.stats.totalTrades}`);
        
        // 如果有持仓，标记需要验证（仅测试模式）
        if (this.positions.length > 0) {
          this.needVerifyPositions = true;
          logger.warn(`⚠️  检测到 ${this.positions.length} 个测试持仓，将在收到价格后验证是否需要平仓`);
        }
      } else {
        logger.info('📝 首次启动测试模式，使用初始状态');
      }
    } catch (error) {
      logger.error('加载测试状态失败:', error.message);
    }
    
    this.printInitInfo();
  }
  
  /**
   * 实盘模式：从 WebSocket 更新持仓数据
   * 由 realtime-pnl.js 调用
   */
  onPositionsUpdate(positionsData) {
    if (this.config.testMode) {
      return; // 测试模式不处理 WebSocket 持仓
    }
    
    // 清空当前持仓
    this.positions = [];
    
    if (!positionsData || positionsData.length === 0) {
      logger.debug('实盘持仓为空');
      return;
    }
    
    // 转换 WebSocket 持仓格式为我们的格式
    positionsData.forEach(pos => {
      if (pos.volume > 0 && pos.contract_code === this.config.symbol) {
        this.positions.push({
          id: Date.now() + Math.random(),
          direction: pos.direction === 'buy' ? 'long' : 'short',
          entryPrice: Number(pos.cost_open),
          size: Number(pos.volume),
          value: Number(pos.position_margin) * this.config.leverage, // 持仓价值 = 保证金 × 杠杆
          leverage: Number(pos.lever_rate),
          openTime: new Date(),
          openFee: 0, // WebSocket 无法获取历史手续费
          highestPrice: pos.direction === 'buy' ? Number(pos.cost_open) : null,
          lowestPrice: pos.direction === 'sell' ? Number(pos.cost_open) : null,
          suggestion: null,
        });
      }
    });
    
    logger.debug(`实盘持仓更新: ${this.positions.length} 个`);
  }
  
  /**
   * 保存状态到 Redis（仅测试模式）
   */
  async saveState() {
    if (!this.config.testMode) {
      return; // 🔴 实盘模式不保存到 Redis
    }
    
    try {
      const state = {
        balance: this.balance,
        positions: this.positions,
        orders: this.orders,
        stats: this.stats,
        lastUpdate: Date.now()
      };
      
      // 使用 setCache 方法，不设置过期时间（永久保存）
      // 键名包含 test/live 前缀，与实盘模式严格隔离
      await redisClient.setCache(this.redisKey, state, 0);
      logger.trace(`测试状态已保存到 Redis (${this.redisKey})`);
      
      // 保存历史订单（单独存储，方便查询）
      await this.saveOrderHistory();
    } catch (error) {
      logger.error('保存测试状态失败:', error.message);
    }
  }
  
  /**
   * 保存历史订单到 Redis
   */
  async saveOrderHistory() {
    try {
      // 只保存已平仓的订单
      const closedOrders = this.orders.filter(order => order.type === 'close');
      
      if (closedOrders.length === 0) {
        return;
      }
      
      // Redis 键名：quant:history:test:BTC-USDT 或 quant:history:live:BTC-USDT
      const modePrefix = this.config.testMode ? 'test' : 'live';
      const historyKey = `quant:history:${modePrefix}:${this.config.symbol}`;
      
      // 保存最近 100 条历史订单
      const recentOrders = closedOrders.slice(-100);
      
      await redisClient.setCache(historyKey, recentOrders, 0);
      logger.trace(`历史订单已保存: ${recentOrders.length} 条`);
    } catch (error) {
      logger.error('保存历史订单失败:', error.message);
    }
  }
  
  /**
   * 获取历史订单
   */
  async getOrderHistory() {
    try {
      const modePrefix = this.config.testMode ? 'test' : 'live';
      const historyKey = `quant:history:${modePrefix}:${this.config.symbol}`;
      
      const history = await redisClient.getCache(historyKey);
      return history || [];
    } catch (error) {
      logger.error('获取历史订单失败:', error.message);
      return [];
    }
  }
  
  /**
   * 重置状态（清空所有数据，仅测试模式）
   */
  async resetState() {
    if (!this.config.testMode) {
      logger.error('🔴 实盘模式不允许重置状态！');
      return false;
    }
    
    // 重新从 Redis 读取最新配置
    try {
      const { redisClient } = await import('../config/redis-client.js');
      const config = await redisClient.getConfig();
      
      if (config && config.quantConfig && config.quantConfig.initialBalance !== undefined) {
        this.config.initialBalance = config.quantConfig.initialBalance;
        logger.info(`✅ 使用最新配置的初始资金: ${this.config.initialBalance} USDT`);
      }
    } catch (error) {
      logger.warn('读取最新配置失败，使用当前配置:', error.message);
    }
    
    this.balance = this.config.initialBalance;
    this.positions = [];
    this.orders = [];
    this.lastPrice = 0;
    this.stats = {
      totalTrades: 0,
      winTrades: 0,
      lossTrades: 0,
      totalProfit: 0,
      totalFees: 0,
      maxDrawdown: 0,
      peakBalance: this.config.initialBalance,
    };
    
    await redisClient.delCache(this.redisKey);
    logger.info(`✅ 测试模式状态已重置 (${this.redisKey})`);
    
    // 更新数据收集器
    this.updateDataCollector();
    return true;
  }
  
  /**
   * 打印初始化信息
   */
  printInitInfo() {
    const modeEmoji = this.config.testMode ? '🧪' : '🔴';
    const modeText = this.config.testMode ? '测试模式 (模拟交易)' : '实盘模式 (真实交易)';
    
    logger.info('\n🤖 量化交易模块初始化');
    logger.info(`   状态: ${this.config.enabled ? '✅ 已启用' : '❌ 已关闭'}`);
    logger.info(`   模式: ${modeEmoji} ${modeText}`);
    logger.info(`   交易对: ${this.config.symbol}`);
    logger.info(`   ${this.config.testMode ? '测试' : '实盘'}资金: ${this.balance.toFixed(2)} USDT`);
    logger.info(`   杠杆: ${this.config.leverage}x`);
    logger.info(`   仓位: ${(this.config.positionSize * 100).toFixed(0)}%`);
    logger.info(`   止损: ${(this.config.stopLoss * 100).toFixed(0)}% | 止盈: ${(this.config.takeProfit * 100).toFixed(0)}%`);
    logger.info(`   最小信心指数: ${this.config.minConfidence}%`);
    
    if (!this.config.enabled) {
      logger.info(`\n💡 提示: 在 .env 中设置 QUANT_ENABLED=true 启用量化交易\n`);
    } else {
      if (!this.config.testMode) {
        logger.warn(`\n🔴 警告: 实盘模式已启用，将使用真实资金交易！\n`);
      } else {
        logger.info(`\n✅ 测试模式已启动，等待 ${this.config.symbol} 行情数据...\n`);
      }
    }
  }

  /**
   * 价格更新时调用（实时响应）
   */
  async onPriceUpdate(contractCode, price) {
    // 等待初始化完成
    await this.initPromise;
    
    if (!this.config.enabled) {
      return;
    }

    // 调试日志
    if (contractCode === this.config.symbol) {
      logger.debug(`收到价格更新: ${contractCode} = ${price.toFixed(2)} USDT`);
    }

    if (contractCode !== this.config.symbol) {
      return;
    }

    this.lastPrice = price;

    // 0. 首次收到价格时，验证从 Redis 加载的持仓（仅测试模式）
    if (this.config.testMode && this.needVerifyPositions && !this.hasVerifiedPositions) {
      await this.verifyPositionsOnStartup(price);
      this.hasVerifiedPositions = true;
      this.needVerifyPositions = false;
    }

    // 1. 检查现有持仓的止盈止损（实时）
    await this.checkPositions(price);

    // 2. 检查交易信号（智能触发：价格变化或时间到期）
    const now = Date.now();
    const timeSinceLastCheck = now - this.lastSignalCheckTime;
    const priceChangePercent = this.lastSignalCheckPrice > 0 
      ? Math.abs((price - this.lastSignalCheckPrice) / this.lastSignalCheckPrice) 
      : 1;
    
    // 触发条件：
    // 1. 价格变化 >= 0.1%（灵敏触发）
    // 2. 或者距离上次检查超过30秒（兜底）
    const shouldCheck = !this.isCheckingSignal && 
                       this.positions.length < this.config.maxPositions &&
                       (priceChangePercent >= 0.001 || timeSinceLastCheck > this.config.signalCheckInterval);
    
    if (shouldCheck) {
      this.isCheckingSignal = true;
      this.lastSignalCheckTime = now;
      this.lastSignalCheckPrice = price;
      
      // 记录触发原因
      if (priceChangePercent >= 0.001) {
        logger.debug(`🔍 价格变化触发信号检查: ${(priceChangePercent * 100).toFixed(2)}%`);
      } else {
        logger.debug(`⏰ 时间到期触发信号检查: ${(timeSinceLastCheck / 1000).toFixed(0)}秒`);
      }
      
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
      logger.error('更新数据收集器失败:', error.message);
    });
  }

  /**
   * 启动时验证持仓（检查是否应该被平仓，仅测试模式）
   */
  async verifyPositionsOnStartup(currentPrice) {
    if (!this.config.testMode) {
      return; // 🔴 实盘模式不验证（从 API 获取真实持仓）
    }
    
    logger.info(`\n🔍 验证测试持仓状态 (当前价格: ${currentPrice.toFixed(2)})`);
    
    const positionsToClose = [];
    
    for (const position of this.positions) {
      const { direction, entryPrice, openTime, value } = position;
      
      // 计算价格变化百分比
      let priceChangePercent;
      if (direction === 'long') {
        priceChangePercent = (currentPrice - entryPrice) / entryPrice;
      } else {
        priceChangePercent = (entryPrice - currentPrice) / entryPrice;
      }
      
      // 火币官方公式：盈亏(USDT) = 价格变化% × 持仓量(USDT)
      const profitUSDT = priceChangePercent * value;
      
      // ROE = 盈亏 / 保证金
      const margin = value / this.config.leverage;
      const roe = profitUSDT / margin;
      
      // 计算离线时长
      const offlineTime = Date.now() - new Date(openTime).getTime();
      const offlineMinutes = Math.floor(offlineTime / 60000);
      
      logger.info(`\n  测试持仓 ${direction.toUpperCase()}:`);
      logger.info(`    开仓价: ${entryPrice.toFixed(2)}`);
      logger.info(`    当前价: ${currentPrice.toFixed(2)}`);
      logger.info(`    价格变化: ${(priceChangePercent * 100).toFixed(2)}%`);
      logger.info(`    盈亏: ${profitUSDT >= 0 ? '+' : ''}${profitUSDT.toFixed(2)} USDT`);
      logger.info(`    ROE: ${(roe * 100).toFixed(2)}%`);
      logger.info(`    开仓时间: ${offlineMinutes} 分钟前`);
      
      // 检查是否触发止损
      if (roe <= -this.config.stopLoss) {
        logger.warn(`    ⚠️  触发止损 (ROE ${(roe * 100).toFixed(2)}% <= -${(this.config.stopLoss * 100).toFixed(0)}%)`);
        positionsToClose.push({ position, reason: '止损（离线期间）' });
        continue;
      }
      
      // 检查是否触发止盈
      if (roe >= this.config.takeProfit) {
        logger.info(`    ✅ 触发止盈 (ROE ${(roe * 100).toFixed(2)}% >= ${(this.config.takeProfit * 100).toFixed(0)}%)`);
        positionsToClose.push({ position, reason: '止盈（离线期间）' });
        continue;
      }
      
      logger.info(`    ✅ 持仓有效，继续持有`);
    }
    
    // 平仓需要关闭的持仓
    if (positionsToClose.length > 0) {
      logger.warn(`\n⚠️  发现 ${positionsToClose.length} 个测试持仓需要平仓（离线期间触发）`);
      for (const { position, reason } of positionsToClose) {
        await this.closePosition(position, currentPrice, reason);
      }
    } else if (this.positions.length > 0) {
      logger.info(`\n✅ 所有测试持仓验证通过，继续持有`);
    }
  }

  /**
   * 检查持仓的止盈止损（智能版）
   */
  async checkPositions(currentPrice) {
    for (let i = this.positions.length - 1; i >= 0; i--) {
      const position = this.positions[i];
      const { direction, entryPrice, size, highestPrice, lowestPrice, value } = position;

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

      // 火币官方公式：盈亏(USDT) = 价格变化% × 持仓量(USDT)
      const positionValue = position.value; // 持仓量 = 保证金 × 杠杆
      const profitUSDT = priceChangePercent * positionValue;
      
      // ROE（收益率）= 盈亏 / 保证金
      const margin = positionValue / this.config.leverage;
      const roe = profitUSDT / margin; // 或简化为：priceChangePercent * leverage

      // 调试日志
      logger.debug(`${direction.toUpperCase()} 持仓检查: 入场=${entryPrice.toFixed(2)}, 当前=${currentPrice.toFixed(2)}, 价格变化=${(priceChangePercent * 100).toFixed(2)}%, 盈亏=${profitUSDT.toFixed(2)} USDT, ROE=${(roe * 100).toFixed(2)}% (${this.config.leverage}x杠杆), 止损=${(this.config.stopLoss * 100).toFixed(0)}%, 止盈=${(this.config.takeProfit * 100).toFixed(0)}%`);

      // 🔥 智能分析：持仓期间持续分析趋势（带限流）
      const shouldEarlyExit = await this.analyzePositionTrend(position, currentPrice, roe);
      
      if (shouldEarlyExit.action === 'exit') {
        logger.info(`\n🎯 智能平仓: ${direction.toUpperCase()} @ ${currentPrice.toFixed(2)}`);
        logger.info(`   原因: ${shouldEarlyExit.reason}`);
        logger.info(`   当前ROE: ${(roe * 100).toFixed(2)}%`);
        await this.closePosition(position, currentPrice, shouldEarlyExit.reason);
        continue;
      }

      // 止损检查（按 ROE）
      if (roe <= -this.config.stopLoss) {
        logger.info(`\n🛑 触发止损: ${direction.toUpperCase()} @ ${currentPrice.toFixed(2)} (ROE ${(roe * 100).toFixed(2)}%)`);
        await this.closePosition(position, currentPrice, '止损');
        continue;
      }

      // 止盈检查（按 ROE）
      if (roe >= this.config.takeProfit) {
        logger.info(`\n🎯 触发止盈: ${direction.toUpperCase()} @ ${currentPrice.toFixed(2)} (ROE ${(roe * 100).toFixed(2)}%)`);
        await this.closePosition(position, currentPrice, '止盈');
        continue;
      }

      // 移动止损检查（按 ROE）
      if (direction === 'long' && position.highestPrice) {
        // 从最高点回撤的价格变化
        const priceDrawdown = (position.highestPrice - currentPrice) / position.highestPrice;
        // 回撤的盈亏(USDT)
        const drawdownUSDT = priceDrawdown * positionValue;
        // 回撤的 ROE
        const drawdownROE = drawdownUSDT / margin;
        
        if (drawdownROE >= this.config.trailingStop) {
          logger.info(`\n📉 触发移动止损: ${direction.toUpperCase()} @ ${currentPrice.toFixed(2)} (从最高点回撤 ROE ${(drawdownROE * 100).toFixed(2)}%)`);
          await this.closePosition(position, currentPrice, '移动止损');
          continue;
        }
      } else if (direction === 'short' && position.lowestPrice) {
        // 从最低点反弹的价格变化
        const priceDrawup = (currentPrice - position.lowestPrice) / position.lowestPrice;
        // 反弹的盈亏(USDT)
        const drawupUSDT = priceDrawup * positionValue;
        // 反弹的 ROE
        const drawupROE = drawupUSDT / margin;
        
        if (drawupROE >= this.config.trailingStop) {
          logger.info(`\n📈 触发移动止损: ${direction.toUpperCase()} @ ${currentPrice.toFixed(2)} (从最低点反弹 ROE ${(drawupROE * 100).toFixed(2)}%)`);
          await this.closePosition(position, currentPrice, '移动止损');
          continue;
        }
      }
    }
  }

  /**
   * 分析持仓期间的趋势（智能提前平仓）
   * 带限流机制，避免 API 调用过于频繁
   */
  async analyzePositionTrend(position, currentPrice, currentROE) {
    try {
      // 只在超短线和简化模式下使用智能分析
      if (this.config.signalMode !== 'scalping' && this.config.signalMode !== 'simple') {
        return { action: 'hold', reason: '' };
      }

      // 🔒 限流机制：避免 API 调用过于频繁
      const now = Date.now();
      const timeSinceLastAnalysis = now - this.lastPositionAnalysisTime;
      const priceChangePercent = this.lastPositionAnalysisPrice > 0 
        ? Math.abs((currentPrice - this.lastPositionAnalysisPrice) / this.lastPositionAnalysisPrice) 
        : 1;
      
      // 触发条件（比开仓信号更宽松）：
      // 1. 价格变化 >= 0.3%（避免过于频繁）
      // 2. 或者距离上次分析超过 60 秒（兜底，比开仓信号慢一倍）
      // 3. 且没有正在分析中（防止并发）
      const shouldAnalyze = !this.isAnalyzingPosition &&
                           (priceChangePercent >= 0.003 || timeSinceLastAnalysis > 60000);
      
      if (!shouldAnalyze) {
        logger.trace(`持仓分析跳过: 价格变化${(priceChangePercent * 100).toFixed(3)}% < 0.3%, 距上次${(timeSinceLastAnalysis / 1000).toFixed(0)}秒 < 60秒`);
        return { action: 'hold', reason: '' };
      }

      // 加锁
      this.isAnalyzingPosition = true;
      this.lastPositionAnalysisTime = now;
      this.lastPositionAnalysisPrice = currentPrice;

      // 记录触发原因
      if (priceChangePercent >= 0.003) {
        logger.debug(`🔍 持仓分析触发（价格变化）: ${(priceChangePercent * 100).toFixed(2)}%`);
      } else {
        logger.debug(`⏰ 持仓分析触发（时间到期）: ${(timeSinceLastAnalysis / 1000).toFixed(0)}秒`);
      }

      // 获取最新信号
      const suggestion = await this.signalGenerator.generateSignal(
        this.config.symbol,
        currentPrice,
        {
          positionSize: this.config.positionSize,
          takeProfit: this.config.takeProfit,
          stopLoss: this.config.stopLoss,
          leverage: this.config.leverage
        }
      );

      // 解锁
      this.isAnalyzingPosition = false;

      if (!suggestion) {
        return { action: 'hold', reason: '' };
      }

      const { direction } = position;

      // 情况1：已经盈利，但趋势反转 → 提前止盈
      if (currentROE > 0) {
        // 做多持仓，但出现做空信号
        if (direction === 'long' && suggestion.action === 'short' && suggestion.confidence >= 60) {
          return {
            action: 'exit',
            reason: `智能提前止盈（趋势反转，信心${suggestion.confidence}%）`
          };
        }
        // 做空持仓，但出现做多信号
        if (direction === 'short' && suggestion.action === 'long' && suggestion.confidence >= 60) {
          return {
            action: 'exit',
            reason: `智能提前止盈（趋势反转，信心${suggestion.confidence}%）`
          };
        }

        // 已经盈利50%以上，且信号变弱 → 落袋为安
        if (currentROE >= this.config.takeProfit * 0.5 && suggestion.action === 'hold') {
          return {
            action: 'exit',
            reason: `智能提前止盈（已盈利${(currentROE * 100).toFixed(1)}%，信号转弱）`
          };
        }
      }

      // 情况2：正在亏损，且趋势继续恶化 → 提前止损
      if (currentROE < 0 && currentROE > -this.config.stopLoss) {
        // 做多持仓，但做空信号很强
        if (direction === 'long' && suggestion.action === 'short' && suggestion.confidence >= 70) {
          return {
            action: 'exit',
            reason: `智能提前止损（趋势恶化，信心${suggestion.confidence}%）`
          };
        }
        // 做空持仓，但做多信号很强
        if (direction === 'short' && suggestion.action === 'long' && suggestion.confidence >= 70) {
          return {
            action: 'exit',
            reason: `智能提前止损（趋势恶化，信心${suggestion.confidence}%）`
          };
        }
      }

      // 情况3：盈利不多，但趋势减弱 → 保本离场
      if (currentROE > 0 && currentROE < this.config.takeProfit * 0.3) {
        if (suggestion.action === 'hold' && suggestion.confidence < 40) {
          return {
            action: 'exit',
            reason: `智能保本离场（小盈${(currentROE * 100).toFixed(1)}%，趋势不明）`
          };
        }
      }

      return { action: 'hold', reason: '' };

    } catch (error) {
      logger.error('分析持仓趋势失败:', error.message);
      this.isAnalyzingPosition = false; // 确保解锁
      return { action: 'hold', reason: '' };
    }
  }

  /**
   * 检查交易信号
   */
  async checkSignals(currentPrice) {
    try {
      let suggestion;

      // 根据配置选择信号生成器
      if (this.config.signalMode === 'scalping' || this.config.signalMode === 'simple') {
        // 超短线/简化版：直接生成信号
        suggestion = await this.signalGenerator.generateSignal(
          this.config.symbol,
          currentPrice,
          {
            positionSize: this.config.positionSize,
            takeProfit: this.config.takeProfit,
            stopLoss: this.config.stopLoss,
            leverage: this.config.leverage
          }
        );
      } else {
        // 复杂版：使用市场分析器
        suggestion = await this.analyzer.generateTradingSuggestion(
          this.config.symbol,
          currentPrice,
          null,
          true
        );
      }

      // 记录信号到历史（无论是否满足条件）
      this.addSignalToHistory({
        timestamp: Date.now(),
        price: currentPrice,
        action: suggestion?.action || 'unknown',
        confidence: suggestion?.confidence || 0,
        signals: suggestion?.signals || [],
        reason: suggestion?.reason || '',
        executed: false // 是否执行了开仓
      });

      if (!suggestion || suggestion.confidence < this.config.minConfidence) {
        if (suggestion && suggestion.confidence > 0) {
          logger.info(`� 信号强度不足: ${suggestion.confidence}% < ${this.config.minConfidence}% (${suggestion.action})`);
        }
        return;
      }

      if (suggestion.action === 'long') {
        logger.info(`\n� 检测到做多信号 (信心: ${suggestion.confidence}%)`);
        if (suggestion.signals) {
          logger.info(`   信号: ${suggestion.signals.join(', ')}`);
        }
        // 标记为已执行
        this.signalHistory[0].executed = true;
        await this.openPosition('long', currentPrice, suggestion);
      } else if (suggestion.action === 'short') {
        logger.info(`\n📉 检测到做空信号 (信心: ${suggestion.confidence}%)`);
        if (suggestion.signals) {
          logger.info(`   信号: ${suggestion.signals.join(', ')}`);
        }
        // 标记为已执行
        this.signalHistory[0].executed = true;
        await this.openPosition('short', currentPrice, suggestion);
      } else if (suggestion.action === 'hold') {
        logger.info(`\n🟡 观望信号 (信心: ${suggestion.confidence}%) - 暂不操作`);
        if (suggestion.signals) {
          logger.info(`   信号: ${suggestion.signals.join(', ')}`);
        }
      }
    } catch (error) {
      logger.error('信号检查错误:', error.message);
    }
  }

  /**
   * 添加信号到历史记录
   */
  addSignalToHistory(signal) {
    this.signalHistory.unshift(signal); // 添加到开头
    
    // 只保留最近20条
    if (this.signalHistory.length > 20) {
      this.signalHistory = this.signalHistory.slice(0, 20);
    }
  }

  /**
   * 开仓
   */
  async openPosition(direction, price, suggestion) {
    // 再次检查持仓数（防止并发开仓）
    if (this.positions.length >= this.config.maxPositions) {
      logger.warn(`已达到最大持仓数 ${this.config.maxPositions}，取消开仓`);
      return;
    }

    // 开仓锁
    if (this.isOpeningPosition) {
      logger.warn(`正在开仓中，跳过本次请求`);
      return;
    }

    this.isOpeningPosition = true;

    try {
      const positionValue = this.balance * this.config.positionSize;
      
      // 计算张数（根据火币合约规则）
      // BTC-USDT: 1张 = 0.001 BTC = 价格 * 0.001 USDT
      // ETH-USDT: 1张 = 0.01 ETH = 价格 * 0.01 USDT
      const contractSize = this.getContractSize(this.config.symbol);
      const contractValue = price * contractSize; // 1张的价值
      const size = (positionValue * this.config.leverage) / contractValue; // 张数
      const roundedSize = Math.floor(size); // 向下取整
      
      if (roundedSize < 1) {
        logger.warn(`计算张数不足1张 (${size.toFixed(4)})，取消开仓`);
        this.isOpeningPosition = false;
        return;
      }
      
      // 计算开仓手续费（使用 Taker 费率，因为是市价单）
      const openFee = positionValue * this.config.takerFee;
      
      // 从余额中扣除手续费
      this.balance -= openFee;
      this.stats.totalFees += openFee;

      const position = {
        id: Date.now(),
        direction: direction,
        entryPrice: price,
        size: roundedSize,
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
        logger.info(`✅ 模拟开仓: ${direction.toUpperCase()} ${roundedSize} 张 @ ${price.toFixed(2)}`);
        logger.info(`   保证金: ${positionValue.toFixed(2)} USDT | 杠杆: ${this.config.leverage}x`);
        logger.info(`   开仓手续费: ${openFee.toFixed(4)} USDT (${(this.config.takerFee * 100).toFixed(2)}%)`);
        logger.info(`   当前持仓数: ${this.positions.length}/${this.config.maxPositions}`);
      } else {
        // 实盘模式：调用火币 API 开仓并设置止盈止损
        const success = await this.placeOrderWithTPSL(direction, roundedSize, price);
        if (success) {
          this.positions.push(position);
          logger.info(`✅ 实盘开仓成功: ${direction.toUpperCase()} ${roundedSize} 张 @ ${price.toFixed(2)}`);
          logger.info(`   保证金: ${positionValue.toFixed(2)} USDT | 杠杆: ${this.config.leverage}x`);
          logger.info(`   开仓手续费: ${openFee.toFixed(4)} USDT (${(this.config.takerFee * 100).toFixed(2)}%)`);
          logger.info(`   当前持仓数: ${this.positions.length}/${this.config.maxPositions}`);
        } else {
          logger.error(`实盘开仓失败`);
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

      // 保存状态到 Redis
      await this.saveState();

      // 更新数据收集器
      this.updateDataCollector();
    } finally {
      this.isOpeningPosition = false;
    }
  }
  
  /**
   * 获取合约面值（每张合约代表多少币）
   */
  getContractSize(symbol) {
    const contractSizes = {
      'BTC-USDT': 0.001,  // 1张 = 0.001 BTC
      'ETH-USDT': 0.01,   // 1张 = 0.01 ETH
      'EOS-USDT': 1,      // 1张 = 1 EOS
      'LTC-USDT': 0.1,    // 1张 = 0.1 LTC
      'BCH-USDT': 0.01,   // 1张 = 0.01 BCH
      'XRP-USDT': 10,     // 1张 = 10 XRP
      'TRX-USDT': 100,    // 1张 = 100 TRX
    };
    
    return contractSizes[symbol] || 0.001; // 默认 BTC
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
      logger.error('下单失败:', error.message);
      return false;
    }
  }

  /**
   * 设置止盈止损订单（支持创建和修改）
   * 火币的 swap_tpsl_order 接口可以直接修改现有的止盈止损
   * 不需要先取消再创建，一次调用即可完成
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
        logger.info(`✅ 止盈止损订单设置成功`);
        logger.info(`   止损价: ${stopLossPrice.toFixed(2)} USDT`);
        logger.info(`   止盈价: ${takeProfitPrice.toFixed(2)} USDT`);
        return true;
      } else {
        logger.error('止盈止损订单失败:', response.data.err_msg);
        return false;
      }
    } catch (error) {
      logger.error('止盈止损订单错误:', error.message);
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
        logger.error('下单失败:', response.data.err_msg);
        return false;
      }
    } catch (error) {
      logger.error('下单错误:', error.message);
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

    // 实盘模式：先调用火币 API 平仓
    if (!this.config.testMode) {
      // 智能平仓：直接平仓，不需要取消止盈止损
      // 因为平仓后，止盈止损订单会自动失效
      const closeDirection = direction === 'long' ? 'sell' : 'buy';
      const success = await this.placeOrder(closeDirection, size, 'close');
      if (!success) {
        logger.error(`❌ 实盘平仓失败，保留持仓`);
        return;
      }
    }

    // 计算价格变化百分比
    let priceChangePercent;
    if (direction === 'long') {
      priceChangePercent = (price - entryPrice) / entryPrice;
    } else {
      priceChangePercent = (entryPrice - price) / entryPrice;
    }

    // 火币官方公式：盈亏 = 价格变化率 × 持仓量(USDT)
    // 持仓量(USDT) = value = 保证金 × 杠杆
    const profitBeforeFee = priceChangePercent * value;
    
    // 计算平仓手续费（基于持仓价值）
    const closeFee = value * this.config.takerFee;
    
    // 净盈亏 = 盈亏 - 平仓手续费（开仓手续费已在开仓时扣除）
    const profit = profitBeforeFee - closeFee;
    
    // 收益率（ROE）= 盈亏 / 保证金
    const margin = value / this.config.leverage;
    const roe = (profit / margin) * 100;
    const totalFees = openFee + closeFee;

    // 更新余额和统计
    this.balance += profit;
    this.stats.totalFees += closeFee;
    
    logger.info(`✅ ${this.config.testMode ? '模拟' : '实盘'}平仓: ${direction.toUpperCase()} @ ${price.toFixed(2)}`);
    logger.info(`   价格变化: ${(priceChangePercent * 100).toFixed(2)}%`);
    logger.info(`   盈亏(扣费前): ${profitBeforeFee >= 0 ? '+' : ''}${profitBeforeFee.toFixed(4)} USDT`);
    logger.info(`   手续费: ${totalFees.toFixed(4)} USDT (开仓 ${openFee.toFixed(4)} + 平仓 ${closeFee.toFixed(4)})`);
    logger.info(`   净盈亏: ${profit >= 0 ? '+' : ''}${profit.toFixed(4)} USDT`);
    logger.info(`   ROE: ${roe >= 0 ? '+' : ''}${roe.toFixed(2)}% (${this.config.leverage}x杠杆)`);
    logger.info(`   原因: ${reason}`);

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
      profitPercent: priceChangePercent * 100, // 价格变化百分比
      roe: roe, // ROE 收益率
      reason: reason,
      status: 'filled',
    });

    // 移除持仓
    this.positions = this.positions.filter(p => p.id !== position.id);

    // 保存状态到 Redis
    await this.saveState();

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
      config: {
        leverage: this.config.leverage,
        positionSize: this.config.positionSize,
        stopLoss: this.config.stopLoss,
        takeProfit: this.config.takeProfit,
        trailingStop: this.config.trailingStop,
        maxPositions: this.config.maxPositions,
        minConfidence: this.config.minConfidence
      },
      positions: this.positions.map(pos => {
        // 计算价格变化百分比
        let priceChangePercent;
        if (pos.direction === 'long') {
          priceChangePercent = (this.lastPrice - pos.entryPrice) / pos.entryPrice;
        } else {
          priceChangePercent = (pos.entryPrice - this.lastPrice) / pos.entryPrice;
        }
        
        // 火币官方公式：盈亏(USDT) = 价格变化% × 持仓量(USDT)
        const profitUSDT = priceChangePercent * pos.value;
        
        // ROE = 盈亏 / 保证金
        const margin = pos.value / this.config.leverage;
        const roe = (profitUSDT / margin) * 100;

        return {
          direction: pos.direction,
          entryPrice: pos.entryPrice,
          size: pos.size,
          value: pos.value,
          profitUSDT: profitUSDT,
          profitPercent: priceChangePercent * 100,
          roe: roe,
          openTime: pos.openTime,
        };
      }),
      stats: this.stats,
      signalHistory: this.signalHistory, // 信号历史
      canStop: this.positions.length === 0, // 是否可以停止（无持仓时才能停止）
    };
  }
  
  /**
   * 停止量化交易
   */
  async stop() {
    if (this.positions.length > 0) {
      logger.warn(`⚠️  当前有 ${this.positions.length} 个持仓，无法停止量化交易`);
      return {
        success: false,
        message: `当前有 ${this.positions.length} 个持仓，请先平仓后再停止`,
        positions: this.positions.length
      };
    }
    
    this.config.enabled = false;
    logger.info('🛑 量化交易已停止');
    
    // 更新配置到 Redis
    try {
      const { redisClient } = await import('../config/redis-client.js');
      const config = await redisClient.getConfig();
      if (config && config.quantConfig) {
        config.quantConfig.enabled = false;
        await redisClient.setCache('htx:config', config, 0);
      }
    } catch (error) {
      logger.error('更新配置失败:', error.message);
    }
    
    return {
      success: true,
      message: '量化交易已停止'
    };
  }

  /**
   * 打印状态
   */
  printStatus() {
    if (!this.config.enabled) {
      return;
    }

    logger.info(`\n${'═'.repeat(80)}`);
    logger.info(`🤖 [量化交易] ${this.config.symbol} - ${this.config.testMode ? '测试模式' : '实盘模式'}`);
    logger.info(`${'─'.repeat(80)}`);
    logger.info(`💰 账户余额: ${this.balance.toFixed(2)} USDT`);
    logger.info(`💵 当前价格: ${this.lastPrice.toFixed(2)} USDT`);
    logger.info(`📈 持仓数量: ${this.positions.length}/${this.config.maxPositions}`);

    if (this.positions.length > 0) {
      logger.info(`\n持仓详情:`);
      this.positions.forEach((pos, idx) => {
        // 计算价格变化百分比
        let priceChangePercent;
        if (pos.direction === 'long') {
          priceChangePercent = (this.lastPrice - pos.entryPrice) / pos.entryPrice;
        } else {
          priceChangePercent = (pos.entryPrice - this.lastPrice) / pos.entryPrice;
        }
        
        // 火币官方公式：盈亏(USDT) = 价格变化% × 持仓量(USDT)
        const profitUSDT = priceChangePercent * pos.value;
        
        // ROE = 盈亏 / 保证金
        const margin = pos.value / this.config.leverage;
        const roe = (profitUSDT / margin) * 100;

        const emoji = profitUSDT >= 0 ? '🟢' : '🔴';
        const sign = profitUSDT >= 0 ? '+' : '';

        logger.info(`\n  持仓 #${idx + 1} ${emoji}`);
        logger.info(`    方向: ${pos.direction === 'long' ? '做多 (LONG)' : '做空 (SHORT)'}`);
        logger.info(`    开仓价: ${pos.entryPrice.toFixed(2)} | 最新价: ${this.lastPrice.toFixed(2)}`);
        logger.info(`    保证金: ${(pos.value / pos.leverage).toFixed(2)} USDT | 杠杆: ${pos.leverage}x`);
        logger.info(`    ${emoji} 收益: ${sign}${profitUSDT.toFixed(2)} USDT (ROE: ${sign}${roe.toFixed(2)}%)`);
      });
    }

    logger.info(`\n统计数据:`);
    logger.info(`  总交易: ${this.stats.totalTrades} | 胜: ${this.stats.winTrades} | 负: ${this.stats.lossTrades}`);
    logger.info(`  胜率: ${this.stats.totalTrades > 0 ? ((this.stats.winTrades / this.stats.totalTrades) * 100).toFixed(2) : 0}%`);
    
    const totalProfitPercent = (this.stats.totalProfit / this.config.initialBalance) * 100;
    const emoji = this.stats.totalProfit >= 0 ? '🟢' : '🔴';
    const sign = this.stats.totalProfit >= 0 ? '+' : '';
    
    logger.info(`  ${emoji} 总盈亏: ${sign}${this.stats.totalProfit.toFixed(2)} USDT (${sign}${totalProfitPercent.toFixed(2)}%)`);
    logger.info(`  💸 总手续费: ${this.stats.totalFees.toFixed(4)} USDT`);
    logger.info(`  📉 最大回撤: ${(this.stats.maxDrawdown * 100).toFixed(2)}%`);
    logger.info(`${'═'.repeat(80)}\n`);
  }
}

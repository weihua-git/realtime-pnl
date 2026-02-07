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
      enabled: config.enabled === true, // 默认关闭，需要手动启用
      testMode: config.testMode !== false, // 默认测试模式
      dryRun: config.dryRun === true, // 模拟下单模式（使用实盘数据但不真实下单）
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
    this.realBalance = null; // 真实账户余额（实盘模式从API查询）
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
    
    // 订单监控
    this.pendingOrders = new Map(); // 待确认订单 Map<orderId, {type, timeout, retryCount}>
    this.wsClient = null; // 复用 realtime-pnl.js 的 WebSocket 客户端
    
    // crypto 模块（延迟加载）
    this._crypto = null;
    this._initCrypto();
    
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
    
    // 启动命令监听（测试和实盘都需要）
    this.startCommandListener();
    
    // 启动配置热重载监听（使用 Redis Pub/Sub）
    this.startConfigReloader();
  }
  
  /**
   * 初始化 crypto 模块
   */
  async _initCrypto() {
    try {
      const crypto = await import('crypto');
      this._crypto = crypto.default || crypto;
    } catch (error) {
      logger.error('初始化 crypto 模块失败:', error.message);
    }
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
      
      // ⚠️ 策略资金热更新（有风险，会影响盈亏统计）
      if (newConfig.initialBalance !== undefined && newConfig.initialBalance !== this.config.initialBalance) {
        const oldBalance = this.config.initialBalance;
        this.config.initialBalance = newConfig.initialBalance;
        
        // 如果没有持仓，可以安全更新
        if (this.positions.length === 0) {
          this.balance = newConfig.initialBalance;
          hasChanges = true;
          changes.push(`策略资金: ${newConfig.initialBalance} USDT (已更新)`);
          
          // 重置统计数据
          this.stats.peakBalance = newConfig.initialBalance;
        } else {
          logger.warn(`⚠️  策略资金变更: ${oldBalance} → ${newConfig.initialBalance} USDT`);
          logger.warn(`   当前有 ${this.positions.length} 个持仓，建议平仓后再修改`);
          logger.warn(`   配置已保存，重启后生效`);
        }
      }
      
      if (hasChanges) {
        logger.info('\n🔄 配置已自动更新：');
        changes.forEach(change => logger.info(`   ${change}`));
        logger.info('');
        
        // 🔥 立即更新前端显示
        this.updateDataCollector();
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
          } else if (command.action === 'start') {
            logger.info('📨 收到启动命令...');
            
            // 启用量化交易
            this.config.enabled = true;
            
            // 删除命令
            await redisClient.delCache(`quant:command:${this.config.symbol}`);
            
            logger.info('✅ 量化交易已启动');
            
            // 更新前端
            this.updateDataCollector();
          }
        }
      } catch (error) {
        logger.error('检查命令失败:', error.message);
      }
    }, 1000); // 每秒检查一次
  }
  
  /**
   * 从 Redis 加载状态
   */
  async loadState() {
    try {
      const savedState = await redisClient.getCache(this.redisKey);
      
      if (savedState) {
        this.balance = savedState.balance || this.config.initialBalance;
        this.positions = savedState.positions || [];
        this.orders = savedState.orders || [];
        this.stats = savedState.stats || this.stats;
        
        logger.info(`✅ 从 Redis 加载${this.config.testMode ? '测试' : '实盘'}模式状态`);
        logger.info(`   Redis Key: ${this.redisKey}`);
        logger.info(`   余额: ${this.balance.toFixed(2)} USDT`);
        logger.info(`   持仓数: ${this.positions.length}`);
        logger.info(`   总交易: ${this.stats.totalTrades}`);
        
        // 如果有持仓，标记需要验证（仅测试模式）
        if (this.config.testMode && this.positions.length > 0) {
          this.needVerifyPositions = true;
          logger.warn(`⚠️  检测到 ${this.positions.length} 个测试持仓，将在收到价格后验证是否需要平仓`);
        }
        
        // 实盘模式：如果有持仓，从 WebSocket 实时同步
        if (!this.config.testMode && this.positions.length > 0) {
          logger.info(`📡 实盘模式：将从 WebSocket 实时同步持仓数据`);
        }
      } else {
        logger.info(`📝 首次启动${this.config.testMode ? '测试' : '实盘'}模式，使用初始状态`);
        logger.info(`   初始余额: ${this.config.initialBalance} USDT`);
      }
    } catch (error) {
      logger.error('加载状态失败:', error.message);
    }
    
    // 🔥 实盘模式和模拟下单模式：查询真实账户余额
    if (!this.config.testMode) {
      logger.info('📡 正在查询真实账户余额...');
      const realBalance = await this.fetchRealBalance();
      if (realBalance) {
        this.realBalance = realBalance;
        logger.info(`💰 真实账户余额: ${realBalance.marginAvailable.toFixed(2)} USDT (可用) | ${realBalance.marginBalance.toFixed(2)} USDT (权益)`);
      } else {
        logger.warn('⚠️  查询真实账户余额失败，请检查API权限');
      }
    } else {
      logger.debug('测试模式，不查询真实余额');
    }
    
    this.printInitInfo();
    
    // 初始化完成后立即保存一次状态（确保前端能获取到数据）
    await this.saveState();
  }
  
  /**
   * 实盘模式：从 WebSocket 更新持仓数据
   * 由 realtime-pnl.js 调用
   */
  onPositionsUpdate(positionsData) {
    if (this.config.testMode) {
      return; // 测试模式不处理 WebSocket 持仓
    }
    
    if (!positionsData || positionsData.length === 0) {
      // 持仓清空，移除所有持仓
      if (this.positions.length > 0) {
        logger.info('实盘持仓已全部平仓');
        this.positions = [];
      }
      return;
    }
    
    // 🔥 智能合并：保留历史追踪数据（highestPrice/lowestPrice）
    const newPositions = [];
    
    positionsData.forEach(pos => {
      if (pos.volume > 0 && pos.contract_code === this.config.symbol) {
        const direction = pos.direction === 'buy' ? 'long' : 'short';
        
        // 查找是否已存在相同方向的持仓
        const existingPos = this.positions.find(p => p.direction === direction);
        
        if (existingPos) {
          // 保留历史追踪数据
          newPositions.push({
            ...existingPos,
            entryPrice: Number(pos.cost_open), // 更新开仓均价
            size: Number(pos.volume), // 更新持仓量
            value: Number(pos.position_margin) * this.config.leverage,
            leverage: Number(pos.lever_rate),
          });
        } else {
          // 新持仓
          newPositions.push({
            id: Date.now() + Math.random(),
            direction: direction,
            entryPrice: Number(pos.cost_open),
            size: Number(pos.volume),
            value: Number(pos.position_margin) * this.config.leverage,
            leverage: Number(pos.lever_rate),
            openTime: new Date(),
            openFee: 0, // WebSocket 无法获取历史手续费
            highestPrice: direction === 'long' ? Number(pos.cost_open) : null,
            lowestPrice: direction === 'short' ? Number(pos.cost_open) : null,
            suggestion: null,
          });
        }
      }
    });
    
    this.positions = newPositions;
    logger.debug(`实盘持仓更新: ${this.positions.length} 个`);
  }
  
  /**
   * 保存状态到 Redis
   */
  async saveState() {
    try {
      // 🔥 更新到 dataCollector（用于 Web 界面显示，测试和实盘都需要）
      if (this.dataCollector) {
        await this.dataCollector.updateQuantData(this.getStatus());
      }
      
      // 保存完整状态到 Redis（测试和实盘都保存）
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
      logger.trace(`状态已保存到 Redis (${this.redisKey})`);
      
      // 保存历史订单（单独存储，方便查询）
      await this.saveOrderHistory();
    } catch (error) {
      logger.error('保存状态失败:', error.message);
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
        logger.trace('没有已平仓订单需要保存');
        return;
      }
      
      // Redis 键名：quant:history:test:BTC-USDT 或 quant:history:live:BTC-USDT
      const modePrefix = this.config.testMode ? 'test' : 'live';
      const historyKey = `quant:history:${modePrefix}:${this.config.symbol}`;
      
      // 保存最近 100 条历史订单
      const recentOrders = closedOrders.slice(-100);
      
      await redisClient.setCache(historyKey, recentOrders, 0);
      logger.info(`📜 历史订单已保存: ${recentOrders.length} 条 (${historyKey})`);
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
   * 查询真实账户余额（实盘模式和模拟下单模式）
   */
  async fetchRealBalance() {
    if (this.config.testMode) {
      return null; // 只有测试模式不查询真实余额
    }

    try {
      const axios = (await import('axios')).default;
      const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '');
      
      // 🔥 使用新的统一账户接口（GET请求，不需要contract_code）
      const path = '/linear-swap-api/v3/unified_account_info';

      // 生成签名（GET请求，query参数）
      const signature = this.generateSignature('GET', 'api.hbdm.com', path, {
        AccessKeyId: this.config.accessKey,
        SignatureMethod: 'HmacSHA256',
        SignatureVersion: '2',
        Timestamp: timestamp,
      });

      const url = `https://api.hbdm.com${path}`;
      const response = await axios.get(url, {
        params: signature, // GET请求参数在query中
      });

      // 新接口返回格式：{ code: 200, msg: 'ok', data: [...] }
      if ((response.data.code === 200 || response.data.msg === 'ok') && response.data.data && response.data.data.length > 0) {
        // 找到 USDT 资产
        const usdtAccount = response.data.data.find(account => account.margin_asset === 'USDT');
        
        if (usdtAccount) {
          return {
            marginBalance: usdtAccount.margin_balance || 0, // 账户权益
            marginAvailable: usdtAccount.withdraw_available || 0, // 可用余额
            marginFrozen: usdtAccount.margin_frozen || 0, // 冻结保证金
            profitUnreal: usdtAccount.cross_profit_unreal || 0, // 未实现盈亏
          };
        } else {
          logger.warn('未找到 USDT 资产账户');
          return null;
        }
      }

      return null;
    } catch (error) {
      logger.error('查询账户余额失败:', error.message);
      if (error.response?.data) {
        logger.error('API响应:', JSON.stringify(error.response.data));
      }
      return null;
    }
  }

  /**
   * 打印初始化信息
   */
  printInitInfo() {
    const modeEmoji = this.config.testMode ? '🧪' : '🔴';
    const modeText = this.config.testMode ? '测试模式 (模拟交易)' : '实盘模式 (真实交易)';
    const dryRunText = this.config.dryRun ? ' [模拟下单]' : '';
    
    logger.info('\n🤖 量化交易模块初始化');
    logger.info(`   状态: ${this.config.enabled ? '✅ 已启用' : '❌ 已关闭'}`);
    logger.info(`   模式: ${modeEmoji} ${modeText}${dryRunText}`);
    logger.info(`   交易对: ${this.config.symbol}`);
    logger.info(`   策略资金: ${this.balance.toFixed(2)} USDT ${this.config.testMode ? '(模拟)' : '(用于计算开仓)'}`);
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
    // 1. 价格变化 >= 0.3%（避免过于频繁触发API限流）
    // 2. 或者距离上次检查超过30秒（兜底）
    const shouldCheck = !this.isCheckingSignal && 
                       this.positions.length < this.config.maxPositions &&
                       (priceChangePercent >= 0.003 || timeSinceLastCheck > this.config.signalCheckInterval);
    
    if (shouldCheck) {
      this.isCheckingSignal = true;
      this.lastSignalCheckTime = now;
      this.lastSignalCheckPrice = price;
      
      // 记录触发原因
      if (priceChangePercent >= 0.003) {
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
      
      // 火币官方公式：盈亏(USDT) = (平仓价 - 开仓价) × 合约张数 × 合约面值
      // 注意：盈亏与杠杆无关！杠杆只影响保证金占用
      const contractSize = this.getContractSize(this.config.symbol);
      let profitUSDT;
      if (direction === 'long') {
        profitUSDT = (currentPrice - entryPrice) * position.size * contractSize;
      } else {
        profitUSDT = (entryPrice - currentPrice) * position.size * contractSize;
      }
      
      // ROE = 盈亏 / 保证金
      const margin = value;
      const roe = profitUSDT / margin;
      
      // 计算价格变化百分比（用于日志显示）
      const priceChangePercent = direction === 'long'
        ? (currentPrice - entryPrice) / entryPrice
        : (entryPrice - currentPrice) / entryPrice;
      
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

      // 火币官方公式：盈亏(USDT) = (平仓价 - 开仓价) × 合约张数 × 合约面值
      // 注意：盈亏与杠杆无关！杠杆只影响保证金占用
      const contractSize = this.getContractSize(this.config.symbol);
      let profitUSDT;
      if (direction === 'long') {
        profitUSDT = (currentPrice - entryPrice) * size * contractSize;
      } else {
        profitUSDT = (entryPrice - currentPrice) * size * contractSize;
      }
      
      // ROE（收益率）= 盈亏 / 保证金
      const margin = value;
      const roe = profitUSDT / margin;

      // 调试日志
      logger.debug(`${direction.toUpperCase()} 持仓检查: 入场=${entryPrice.toFixed(2)}, 当前=${currentPrice.toFixed(2)}, 张数=${size}, 盈亏=${profitUSDT.toFixed(2)} USDT, ROE=${(roe * 100).toFixed(2)}%, 止损=${(this.config.stopLoss * 100).toFixed(0)}%, 止盈=${(this.config.takeProfit * 100).toFixed(0)}%`);

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

      // 移动止损检查（只在盈利时生效）
      if (direction === 'long' && position.highestPrice) {
        // 计算当前盈亏
        const contractSize = this.getContractSize(this.config.symbol);
        const currentProfitUSDT = (currentPrice - entryPrice) * size * contractSize;
        const currentROE = currentProfitUSDT / margin;
        
        // 只有盈利时才检查移动止损
        if (currentROE > 0) {
          // 从最高点回撤的盈亏
          const drawdownUSDT = (position.highestPrice - currentPrice) * size * contractSize;
          const drawdownROE = drawdownUSDT / margin;
          
          if (drawdownROE >= this.config.trailingStop) {
            logger.info(`\n� 触发移动止损: ${direction.toUpperCase()} @ ${currentPrice.toFixed(2)} (从最高点回撤 ROE ${(drawdownROE * 100).toFixed(2)}%)`);
            await this.closePosition(position, currentPrice, '移动止损');
            continue;
          }
        }
      } else if (direction === 'short' && position.lowestPrice) {
        // 计算当前盈亏
        const contractSize = this.getContractSize(this.config.symbol);
        const currentProfitUSDT = (entryPrice - currentPrice) * size * contractSize;
        const currentROE = currentProfitUSDT / margin;
        
        // 只有盈利时才检查移动止损
        if (currentROE > 0) {
          // 从最低点反弹的盈亏
          const drawupUSDT = (currentPrice - position.lowestPrice) * size * contractSize;
          const drawupROE = drawupUSDT / margin;
          
          if (drawupROE >= this.config.trailingStop) {
            logger.info(`\n📈 触发移动止损: ${direction.toUpperCase()} @ ${currentPrice.toFixed(2)} (从最低点反弹 ROE ${(drawupROE * 100).toFixed(2)}%)`);
            await this.closePosition(position, currentPrice, '移动止损');
            continue;
          }
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
          logger.debug(`⏸️ 信号强度不足: ${suggestion.confidence}% < ${this.config.minConfidence}% (${suggestion.action})`);
        }
        return;
      }

      if (suggestion.action === 'long') {
        logger.info(`\n📈 检测到做多信号 (信心: ${suggestion.confidence}%)`);
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
        logger.debug(`🟡 观望信号 (信心: ${suggestion.confidence}%) - 暂不操作`);
        if (suggestion.signals) {
          logger.debug(`   信号: ${suggestion.signals.join(', ')}`);
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
      
      // 🔥 新增：检查余额是否充足（测试模式）
      if (this.config.testMode && positionValue > this.balance) {
        logger.warn(`❌ 余额不足：需要 ${positionValue.toFixed(2)} USDT，当前余额 ${this.balance.toFixed(2)} USDT`);
        return;
      }
      
      // 计算张数（根据火币合约规则）
      // BTC-USDT: 1张 = 0.001 BTC = 价格 * 0.001 USDT
      // ETH-USDT: 1张 = 0.01 ETH = 价格 * 0.01 USDT
      const contractSize = this.getContractSize(this.config.symbol);
      const contractValue = price * contractSize; // 1张的价值
      const size = (positionValue * this.config.leverage) / contractValue; // 张数
      const roundedSize = Math.floor(size); // 向下取整
      
      if (roundedSize < 1) {
        logger.warn(`计算张数不足1张 (${size.toFixed(4)})，取消开仓`);
        return;
      }
      
      // 🔥 修正：手续费应该基于实际成交金额（张数 × 合约面值 × 价格）
      const actualTradeValue = roundedSize * contractSize * price;
      const openFee = actualTradeValue * this.config.takerFee;
      
      // 🔥 新增：检查扣除手续费后余额是否为负（测试模式）
      if (this.config.testMode && (this.balance - openFee) < 0) {
        logger.warn(`❌ 扣除手续费后余额不足：手续费 ${openFee.toFixed(4)} USDT，当前余额 ${this.balance.toFixed(2)} USDT`);
        return;
      }

      // 🔥 关键修复：先尝试开仓，成功后再扣除手续费和创建持仓对象
      let openSuccess = true;
      
      if (!this.config.testMode) {
        // 实盘模式：先调用火币 API 开仓并设置止盈止损（等待订单成交）
        const openResult = await this.placeOrderWithTPSL(direction, roundedSize, price);
        if (!openResult.success) {
          logger.error(`❌ 实盘开仓失败，取消本次交易`);
          return;
        }
        
        // 🔥 关键修复：使用实际成交价格
        if (openResult.filledPrice) {
          price = openResult.filledPrice;
          logger.debug(`📍 使用实际成交价: ${price.toFixed(2)} USDT`);
        }
        
        // 🔥 只有订单成交后才会执行到这里
      }
      
      // 开仓成功（或测试模式），扣除手续费并创建持仓对象
      // 注意：
      // - 测试模式：只扣除手续费，保证金不扣除（因为保证金会在平仓时返还）
      // - 实盘模式：火币会自动扣除保证金+手续费，但我们这里不需要同步余额
      //   因为我们的 balance 是虚拟余额，用于计算盈亏，不是实际账户余额
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

      // 添加持仓
      this.positions.push(position);
      
      if (this.config.testMode) {
        logger.info(`✅ 模拟开仓: ${direction.toUpperCase()} ${roundedSize} 张 @ ${price.toFixed(2)}`);
      } else {
        logger.info(`✅ 实盘开仓成功: ${direction.toUpperCase()} ${roundedSize} 张 @ ${price.toFixed(2)}`);
      }
      logger.info(`   保证金: ${positionValue.toFixed(2)} USDT | 杠杆: ${this.config.leverage}x`);
      logger.info(`   开仓手续费: ${openFee.toFixed(4)} USDT (${(this.config.takerFee * 100).toFixed(2)}%)`);
      logger.info(`   当前持仓数: ${this.positions.length}/${this.config.maxPositions}`);

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
   * 格式化价格精度（火币要求）
   * @param {number} price - 价格
   * @param {string} symbol - 交易对
   * @returns {string} 格式化后的价格字符串
   */
  formatPrice(price, symbol = null) {
    const targetSymbol = symbol || this.config.symbol;
    
    // 不同交易对的价格精度要求
    const precisionMap = {
      'BTC-USDT': 2,  // BTC 价格精度 2 位小数
      'ETH-USDT': 2,  // ETH 价格精度 2 位小数
      'EOS-USDT': 4,  // EOS 价格精度 4 位小数
      'LTC-USDT': 2,  // LTC 价格精度 2 位小数
      'BCH-USDT': 2,  // BCH 价格精度 2 位小数
      'XRP-USDT': 4,  // XRP 价格精度 4 位小数
      'TRX-USDT': 6,  // TRX 价格精度 6 位小数
    };
    
    const precision = precisionMap[targetSymbol] || 2; // 默认 2 位小数
    
    // 确保转换为数字，然后格式化为字符串
    const numPrice = typeof price === 'string' ? parseFloat(price) : price;
    return numPrice.toFixed(precision);
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
   * 返回 Promise，等待订单确认成交
   * 返回：{ success: boolean, filledPrice: number }
   */
  async placeOrderWithTPSL(direction, size, price) {
    return new Promise(async (resolve, reject) => {
      try {
        // 🔥 关键说明：火币的止盈止损设置
        // 火币的止盈止损参数直接使用价格变动百分比，不需要除以杠杆
        // 例如：设置止损 2%，就是价格变动 2%
        // 但是实际 ROE = 价格变动% × 杠杆倍数
        // 所以：价格变动 2%，杠杆 5x，实际 ROE = 10%
        
        // 因此，如果用户配置的是 ROE（收益率），需要转换为价格变动
        // 但如果用户配置的就是价格变动百分比，则直接使用
        
        // 🔥 修正：根据配置含义决定是否转换
        // 当前 .env 中的配置说明是 "止损比例（0.02 = 2%，5倍杠杆下实际亏损10%）"
        // 这说明配置的是价格变动百分比，不是 ROE
        // 所以直接使用配置值，不需要除以杠杆
        
        const priceChangeForStopLoss = this.config.stopLoss;
        const priceChangeForTakeProfit = this.config.takeProfit;
        
        // 计算止盈止损价格
        const stopLossPrice = direction === 'long'
          ? price * (1 - priceChangeForStopLoss)
          : price * (1 + priceChangeForStopLoss);
        
        const takeProfitPrice = direction === 'long'
          ? price * (1 + priceChangeForTakeProfit)
          : price * (1 - priceChangeForTakeProfit);

        // 调试日志：显示计算的价格
        logger.debug(`📊 价格计算 (杠杆 ${this.config.leverage}x):`);
        logger.debug(`   价格变动止损: ${(priceChangeForStopLoss * 100).toFixed(2)}% → 实际 ROE: ${(priceChangeForStopLoss * this.config.leverage * 100).toFixed(2)}%`);
        logger.debug(`   价格变动止盈: ${(priceChangeForTakeProfit * 100).toFixed(2)}% → 实际 ROE: ${(priceChangeForTakeProfit * this.config.leverage * 100).toFixed(2)}%`);
        logger.debug(`   开仓价: ${price} -> ${this.formatPrice(price)}`);
        logger.debug(`   止损价: ${stopLossPrice.toFixed(2)} -> ${this.formatPrice(stopLossPrice)}`);
        logger.debug(`   止盈价: ${takeProfitPrice.toFixed(2)} -> ${this.formatPrice(takeProfitPrice)}`);

        // 🔥 关键改进：开仓时直接设置止盈止损（一次性完成，零延迟）
        const tpslParams = {
          tp_trigger_price: takeProfitPrice,
          tp_order_price: takeProfitPrice,
          tp_order_price_type: 'limit', // 限价单，减少滑点
          sl_trigger_price: stopLossPrice,
          sl_order_price: stopLossPrice,
          sl_order_price_type: 'limit', // 限价单，减少滑点
        };

        // 1. 使用限价单开仓，同时设置止盈止损
        const openResult = await this.placeOrder(direction, size, 'open', price, true, tpslParams);
        if (!openResult.success) {
          return resolve({ success: false });
        }

        const { orderId } = openResult;

        // 2. 监控开仓订单状态
        await this.monitorOrder(
          orderId,
          'open',
          async (order) => {
            // 开仓成功，止盈止损已自动设置
            // 🔥 关键修复：使用实际成交价格
            const filledPrice = order.trade_avg_price || price;
            
            logger.info('✅ 开仓订单已成交，止盈止损已同步设置');
            logger.info(`   实际成交价: ${this.formatPrice(filledPrice)} USDT`);
            logger.info(`   止损价: ${this.formatPrice(stopLossPrice)} USDT`);
            logger.info(`   止盈价: ${this.formatPrice(takeProfitPrice)} USDT`);
            
            resolve({ success: true, filledPrice });
          },
          async (order) => {
            // 开仓失败
            logger.error('❌ 开仓订单失败');
            resolve({ success: false });
          }
        );
      } catch (error) {
        logger.error('下单失败:', error.message);
        reject(error);
      }
    });
  }

  /**
   * 设置止盈止损订单（支持创建和修改）
   * 火币的 swap_cross_tpsl_order 接口可以直接修改现有的止盈止损
   * 不需要先取消再创建，一次调用即可完成
   */
  async setTPSLOrder(direction, size, stopLossPrice, takeProfitPrice) {
    try {
      // 🔥 模拟下单模式：不调用真实API
      if (this.config.dryRun) {
        logger.info(`🎭 [模拟] 设置止盈止损 (模拟)`);
        logger.info(`   止损: ${this.formatPrice(stopLossPrice)} | 止盈: ${this.formatPrice(takeProfitPrice)}`);
        return true;
      }

      const axios = (await import('axios')).default;

      const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '');
      const path = '/linear-swap-api/v1/swap_tpsl_order'; // ✅ 逐仓端点

      // 火币止盈止损订单参数
      const params = {
        contract_code: this.config.symbol,
        direction: direction === 'long' ? 'sell' : 'buy', // 平仓方向相反
        volume: Math.floor(size), // 张数必须是整数
        // 止损
        sl_trigger_price: this.formatPrice(stopLossPrice),
        sl_order_price: this.formatPrice(stopLossPrice),
        sl_order_price_type: 'limit', // ✅ 限价单，减少滑点
        // 止盈
        tp_trigger_price: this.formatPrice(takeProfitPrice),
        tp_order_price: this.formatPrice(takeProfitPrice),
        tp_order_price_type: 'limit', // ✅ 限价单，减少滑点
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

      if (response.data.status === 'ok' && response.data.data) {
        const orderId = response.data.data.order_id || response.data.data.order_id_str;
        logger.info(`✅ 止盈止损订单设置成功 (订单ID: ${orderId})`);
        logger.info(`   止损价: ${this.formatPrice(stopLossPrice)} USDT`);
        logger.info(`   止盈价: ${this.formatPrice(takeProfitPrice)} USDT`);
        return { success: true, orderId };
      } else {
        logger.error('止盈止损订单失败:', response.data.err_msg || '未知错误');
        logger.error('响应详情:', JSON.stringify(response.data));
        return { success: false, error: response.data.err_msg };
      }
    } catch (error) {
      logger.error('止盈止损订单错误:', error.message);
      if (error.response) {
        logger.error('API 响应:', JSON.stringify(error.response.data));
      }
      return { success: false, error: error.message };
    }
  }

  /**
   * 取消止盈止损订单
   */
  async cancelTPSLOrders(contractCode, direction) {
    try {
      // 🔥 模拟下单模式：不调用真实API
      if (this.config.dryRun) {
        logger.debug(`🎭 [模拟] 取消止盈止损订单 (模拟)`);
        return true;
      }

      const axios = (await import('axios')).default;

      const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '');
      const path = '/linear-swap-api/v1/swap_tpsl_cancelall';

      const params = {
        contract_code: contractCode,
        direction: direction === 'long' ? 'sell' : 'buy', // 平仓方向
      };

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
        logger.warn('取消止盈止损订单失败:', response.data.err_msg);
        return false;
      }
    } catch (error) {
      logger.warn('取消止盈止损订单错误:', error.message);
      return false;
    }
  }

  /**
   * 下单（开仓/平仓）
   * @param {string} direction - 方向：'long', 'short', 'buy', 'sell'
   * @param {number} size - 张数
   * @param {string} offset - 开平：'open', 'close'
   * @param {number} price - 价格（可选，不传则使用对手价）
   * @param {boolean} returnOrderId - 是否返回订单ID（用于监控）
   * @param {object} tpsl - 止盈止损参数（可选）{ tp_trigger_price, tp_order_price, tp_order_price_type, sl_trigger_price, sl_order_price, sl_order_price_type }
   */
  async placeOrder(direction, size, offset = 'open', price = null, returnOrderId = false, tpsl = null) {
    try {
      // 🔥 模拟下单模式：不调用真实API
      if (this.config.dryRun) {
        const fakeOrderId = `DRY_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        logger.info(`🎭 [模拟下单] ${offset === 'open' ? '开仓' : '平仓'} ${direction.toUpperCase()}`);
        logger.info(`   订单ID: ${fakeOrderId} (模拟)`);
        logger.info(`   张数: ${Math.floor(size)} | 价格: ${price ? price.toFixed(2) : '市价'}`);
        
        // 模拟模式也显示止盈止损信息
        if (tpsl && offset === 'open') {
          logger.info(`   止损: ${this.formatPrice(tpsl.sl_trigger_price)} | 止盈: ${this.formatPrice(tpsl.tp_trigger_price)}`);
        }
        
        if (returnOrderId) {
          return {
            success: true,
            orderId: fakeOrderId,
          };
        }
        return true;
      }

      const axios = (await import('axios')).default;

      const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '');
      const path = '/linear-swap-api/v1/swap_order'; // ✅ 逐仓端点
      
      const params = {
        contract_code: this.config.symbol,
        volume: Math.floor(size), // 张数必须是整数
        direction: direction === 'long' || direction === 'buy' ? 'buy' : 'sell',
        offset: offset,
        lever_rate: this.config.leverage,
        order_price_type: price ? 'limit' : 'optimal_5', // 有价格用限价单，否则用对手价
      };

      // 限价单必须提供价格
      if (price) {
        params.price = this.formatPrice(price);
      }

      // 🔥 新增：开仓时直接设置止盈止损（一次性完成，避免延迟）
      if (tpsl && offset === 'open') {
        if (tpsl.tp_trigger_price) {
          params.tp_trigger_price = this.formatPrice(tpsl.tp_trigger_price);
          params.tp_order_price = this.formatPrice(tpsl.tp_order_price);
          params.tp_order_price_type = tpsl.tp_order_price_type || 'limit';
        }
        if (tpsl.sl_trigger_price) {
          params.sl_trigger_price = this.formatPrice(tpsl.sl_trigger_price);
          params.sl_order_price = this.formatPrice(tpsl.sl_order_price);
          params.sl_order_price_type = tpsl.sl_order_price_type || 'limit';
        }
        
        // 调试日志：显示实际发送的参数
        logger.debug('📋 开仓订单参数:', JSON.stringify(params, null, 2));
      }

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
        const orderId = response.data.data?.order_id_str || response.data.data?.order_id;
        logger.info(`✅ 订单提交成功: ${offset === 'open' ? '开仓' : '平仓'} ${direction.toUpperCase()}`);
        logger.info(`   订单ID: ${orderId}`);
        
        if (returnOrderId) {
          return {
            success: true,
            orderId: orderId,
          };
        }
        return true;
      } else {
        logger.error('下单失败:', response.data.err_msg);
        logger.error('响应详情:', JSON.stringify(response.data));
        
        if (returnOrderId) {
          return { success: false, error: response.data.err_msg };
        }
        return false;
      }
    } catch (error) {
      logger.error('下单错误:', error.message);
      if (error.response) {
        logger.error('API 响应:', JSON.stringify(error.response.data));
      }
      
      if (returnOrderId) {
        return { success: false, error: error.message };
      }
      return false;
    }
  }

  /**
   * 生成签名（同步方法）
   */
  generateSignature(method, host, path, params) {
    // 在 ES6 模块中，需要在调用方已经 import crypto
    // 这里直接使用调用方传入的 crypto 实例
    // 或者使用全局的 crypto（如果有）
    const crypto = this._crypto;
    if (!crypto) {
      throw new Error('crypto module not initialized. Call setCrypto() first.');
    }
    
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
   * 设置 crypto 模块（由调用方传入）
   */
  setCrypto(crypto) {
    this._crypto = crypto;
  }

  /**
   * 平仓
   */
  async closePosition(position, price, reason) {
    const { direction, entryPrice, size, value, openFee } = position;

    // 实盘模式：先调用火币 API 平仓
    if (!this.config.testMode) {
      const closeDirection = direction === 'long' ? 'sell' : 'buy';
      
      return new Promise(async (resolve) => {
        const closeResult = await this.placeOrder(closeDirection, size, 'close', null, true);
        if (!closeResult.success) {
          logger.error(`❌ 实盘平仓失败，保留持仓`);
          return resolve();
        }

        const { orderId } = closeResult;

        // 监控平仓订单状态
        await this.monitorOrder(
          orderId,
          'close',
          async (order) => {
            // 平仓成功
            logger.info('✅ 平仓订单已成交');
            
            // 取消止盈止损订单（避免残留）
            try {
              await this.cancelTPSLOrders(this.config.symbol, direction);
              logger.debug('✅ 已取消止盈止损订单');
            } catch (error) {
              logger.warn('⚠️ 取消止盈止损订单失败（可能已自动失效）:', error.message);
            }

            // 执行平仓后的余额和统计更新
            this.finishClosePosition(position, price, reason);
            resolve();
          },
          async (order) => {
            // 平仓失败
            logger.error('❌ 平仓订单失败，保留持仓');
            resolve();
          }
        );
      });
    } else {
      // 测试模式：直接执行平仓逻辑
      this.finishClosePosition(position, price, reason);
    }
  }

  /**
   * 完成平仓（更新余额和统计）
   */
  async finishClosePosition(position, price, reason) {
    const { direction, entryPrice, size, value, openFee } = position;

    // 火币官方公式：盈亏(USDT) = (平仓价 - 开仓价) × 合约张数 × 合约面值
    // 注意：盈亏与杠杆无关！杠杆只影响保证金占用
    const contractSize = this.getContractSize(this.config.symbol);
    let profitBeforeFee;
    if (direction === 'long') {
      profitBeforeFee = (price - entryPrice) * size * contractSize;
    } else {
      profitBeforeFee = (entryPrice - price) * size * contractSize;
    }
    
    // 计算平仓手续费（基于实际成交金额）
    const actualTradeValue = size * contractSize * price;
    const closeFee = actualTradeValue * this.config.takerFee;
    
    // 净盈亏 = 盈亏 - 平仓手续费（开仓手续费已在开仓时扣除）
    const profit = profitBeforeFee - closeFee;
    
    // 收益率（ROE）= 盈亏 / 保证金
    const margin = value;
    const roe = (profit / margin) * 100;
    const totalFees = openFee + closeFee;

    // 更新余额和统计
    this.balance += profit;
    this.stats.totalFees += closeFee;
    
    // 计算价格变化百分比（用于日志显示）
    const priceChangePercent = direction === 'long' 
      ? (price - entryPrice) / entryPrice 
      : (entryPrice - price) / entryPrice;
    
    logger.info(`✅ ${this.config.testMode ? '模拟' : '实盘'}平仓: ${direction.toUpperCase()} @ ${price.toFixed(2)}`);
    logger.info(`   开仓价: ${entryPrice.toFixed(2)} | 张数: ${size}`);
    logger.info(`   价格变化: ${(priceChangePercent * 100).toFixed(2)}%`);
    logger.info(`   盈亏(扣费前): ${profitBeforeFee >= 0 ? '+' : ''}${profitBeforeFee.toFixed(4)} USDT`);
    logger.info(`   手续费: ${totalFees.toFixed(4)} USDT (开仓 ${openFee.toFixed(4)} + 平仓 ${closeFee.toFixed(4)})`);
    logger.info(`   净盈亏: ${profit >= 0 ? '+' : ''}${profit.toFixed(4)} USDT`);
    logger.info(`   ROE: ${roe >= 0 ? '+' : ''}${roe.toFixed(2)}%`);
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

    // 保存状态到 Redis（包括历史订单）
    await this.saveState();
    
    logger.info(`📊 当前订单总数: ${this.orders.length}, 已平仓: ${this.orders.filter(o => o.type === 'close').length}`);

    // 更新数据收集器
    this.updateDataCollector();
  }

  /**
   * 获取状态摘要
   */
  getStatus() {
    // 始终返回状态（包括 enabled=false 的情况）
    return {
      enabled: this.config.enabled,
      testMode: this.config.testMode,
      symbol: this.config.symbol,
      balance: this.balance, // 模拟余额或初始资金
      realBalance: this.realBalance, // 真实账户余额（实盘模式）
      lastPrice: this.lastPrice,
      config: {
        leverage: this.config.leverage,
        positionSize: this.config.positionSize,
        stopLoss: this.config.stopLoss,
        takeProfit: this.config.takeProfit,
        trailingStop: this.config.trailingStop,
        maxPositions: this.config.maxPositions,
        minConfidence: this.config.minConfidence,
        dryRun: this.config.dryRun, // 模拟下单模式
      },
      positions: this.positions.map(pos => {
        // 火币官方公式：盈亏(USDT) = (当前价 - 开仓价) × 合约张数 × 合约面值
        // 注意：盈亏与杠杆无关！
        const contractSize = this.getContractSize(this.config.symbol);
        let profitUSDT;
        if (pos.direction === 'long') {
          profitUSDT = (this.lastPrice - pos.entryPrice) * pos.size * contractSize;
        } else {
          profitUSDT = (pos.entryPrice - this.lastPrice) * pos.size * contractSize;
        }
        
        // ROE = 盈亏 / 保证金
        const margin = pos.value;
        const roe = (profitUSDT / margin) * 100;
        
        // 价格变化百分比（用于显示）
        const priceChangePercent = pos.direction === 'long'
          ? (this.lastPrice - pos.entryPrice) / pos.entryPrice
          : (pos.entryPrice - this.lastPrice) / pos.entryPrice;

        return {
          direction: pos.direction,
          entryPrice: pos.entryPrice,
          size: pos.size,
          value: pos.value,
          symbol: this.config.symbol, // 添加交易对信息
          profitUSDT: profitUSDT,
          profitPercent: priceChangePercent * 100,
          roe: roe,
          openTime: pos.openTime,
          openFee: pos.openFee || 0, // 开仓手续费
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
    logger.debug(`🔍 检查是否可以停止: 持仓数 = ${this.positions.length}`);
    
    if (this.positions.length > 0) {
      logger.warn(`⚠️  当前有 ${this.positions.length} 个持仓，无法停止量化交易`);
      logger.warn(`   持仓详情: ${JSON.stringify(this.positions.map(p => ({
        direction: p.direction,
        size: p.size,
        entryPrice: p.entryPrice
      })))}`);
      return {
        success: false,
        message: `当前有 ${this.positions.length} 个持仓，请先平仓后再停止`,
        positions: this.positions.length
      };
    }
    
    this.config.enabled = false;
    
    // 清理订单监听器（如果有）
    if (this.wsClient && this.wsClient.eventHandlers && this.wsClient.eventHandlers.orders) {
      this.wsClient.eventHandlers.orders = [];
      logger.info('✅ 已清理订单监听器');
    }
    
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
        // 火币官方公式：盈亏(USDT) = (当前价 - 开仓价) × 合约张数 × 合约面值
        const contractSize = this.getContractSize(this.config.symbol);
        let profitUSDT;
        if (pos.direction === 'long') {
          profitUSDT = (this.lastPrice - pos.entryPrice) * pos.size * contractSize;
        } else {
          profitUSDT = (pos.entryPrice - this.lastPrice) * pos.size * contractSize;
        }
        
        // ROE = 盈亏 / 保证金
        const margin = pos.value;
        const roe = (profitUSDT / margin) * 100;

        const emoji = profitUSDT >= 0 ? '🟢' : '🔴';
        const sign = profitUSDT >= 0 ? '+' : '';

        logger.info(`\n  持仓 #${idx + 1} ${emoji}`);
        logger.info(`    方向: ${pos.direction === 'long' ? '做多 (LONG)' : '做空 (SHORT)'}`);
        logger.info(`    开仓价: ${pos.entryPrice.toFixed(2)} | 最新价: ${this.lastPrice.toFixed(2)}`);
        logger.info(`    保证金: ${margin.toFixed(2)} USDT | 杠杆: ${pos.leverage}x | 张数: ${pos.size}`);
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

  /**
   * 设置 WebSocket 客户端（由 realtime-pnl.js 传入）
   */
  setWebSocketClient(wsClient) {
    this.wsClient = wsClient;
    
    if (!this.config.testMode && wsClient) {
      // 订阅订单推送
      wsClient.subscribeOrders(this.config.symbol);
      
      // 订阅账户余额推送（实时更新真实余额）
      wsClient.subscribeAccounts(this.config.symbol);
      
      // 监听订单更新
      wsClient.on('orders', (data) => {
        // 处理所有订单推送，在 handleOrderUpdate 中过滤
        this.handleOrderUpdate(data);
      });
      
      // 监听账户余额更新
      wsClient.on('accounts', (data) => {
        this.handleAccountUpdate(data);
      });
      
      logger.info('✅ 已复用主程序的 WebSocket 连接订阅订单和账户推送');
    }
  }

  /**
   * 处理账户余额更新推送
   */
  handleAccountUpdate(data) {
    // 验证数据
    if (!data) {
      logger.warn('⚠️ 收到空的账户推送数据');
      return;
    }

    // data 可能是单个账户对象或账户数组
    const accounts = Array.isArray(data) ? data : [data];

    accounts.forEach(account => {
      // 验证账户对象
      if (!account || typeof account !== 'object') {
        logger.warn('⚠️ 收到无效的账户对象:', account);
        return;
      }

      // 只处理当前交易对的账户
      if (account.contract_code && account.contract_code !== this.config.symbol) {
        return;
      }

      // 更新真实余额
      if (this.realBalance) {
        this.realBalance.marginBalance = account.margin_balance || this.realBalance.marginBalance;
        this.realBalance.marginAvailable = account.margin_available || this.realBalance.marginAvailable;
        this.realBalance.marginFrozen = account.margin_frozen || this.realBalance.marginFrozen;
        this.realBalance.profitUnreal = account.profit_unreal || this.realBalance.profitUnreal;
        
        logger.debug(`💰 账户余额更新: ${this.realBalance.marginAvailable.toFixed(2)} USDT (可用)`);
        
        // 更新前端显示
        this.updateDataCollector();
      }
    });
  }

  /**
   * 处理订单更新推送
   */
  handleOrderUpdate(data) {
    // 验证数据
    if (!data) {
      logger.warn('⚠️ 收到空的订单推送数据');
      return;
    }

    // data 可能是单个订单对象或订单数组
    const orders = Array.isArray(data) ? data : [data];

    orders.forEach(order => {
      // 验证订单对象
      if (!order || typeof order !== 'object') {
        logger.warn('⚠️ 收到无效的订单对象:', order);
        return;
      }

      // 只处理当前交易对的订单
      if (order.contract_code && order.contract_code !== this.config.symbol) {
        return;
      }

      const orderId = order.order_id_str || order.order_id;
      const status = order.status;

      // 检查是否是我们监控的订单
      const pendingOrder = this.pendingOrders.get(orderId);

      if (!pendingOrder) {
        return; // 不是我们的订单
      }

      logger.info(`📬 收到订单推送: ${orderId} | 状态: ${this.getOrderStatusText(status)}`);

      // 订单状态处理
      if (status === 6) {
        // 全部成交
        logger.info(`✅ 订单已成交: ${orderId}`);
        this.pendingOrders.delete(orderId);
        
        // 清除超时定时器
        if (pendingOrder.timeout) {
          clearTimeout(pendingOrder.timeout);
        }
        if (pendingOrder.maxTimeout) {
          clearTimeout(pendingOrder.maxTimeout);
        }
        
        // 执行成功回调
        if (pendingOrder.onSuccess) {
          pendingOrder.onSuccess(order);
        }
      } else if (status === 7 || status === 10) {
        // 已撤单或失败
        logger.warn(`❌ 订单失败: ${orderId} | 状态: ${this.getOrderStatusText(status)}`);
        this.pendingOrders.delete(orderId);
        
        // 清除超时定时器
        if (pendingOrder.timeout) {
          clearTimeout(pendingOrder.timeout);
        }
        if (pendingOrder.maxTimeout) {
          clearTimeout(pendingOrder.maxTimeout);
        }
        
        // 执行失败回调
        if (pendingOrder.onFailure) {
          pendingOrder.onFailure(order);
        }
      } else if (status === 4) {
        // 部分成交
        logger.info(`⏳ 订单部分成交: ${orderId}`);
      }
    });
  }

  /**
   * 获取订单状态文本
   */
  getOrderStatusText(status) {
    const statusMap = {
      1: '准备提交',
      2: '准备提交',
      3: '已提交',
      4: '部分成交',
      5: '部分成交已撤单',
      6: '全部成交',
      7: '已撤单',
      10: '失败',
      11: '撤单中',
    };
    return statusMap[status] || `未知(${status})`;
  }

  /**
   * 监控订单状态（混合方案：WebSocket + 超时查询）
   */
  async monitorOrder(orderId, type, onSuccess, onFailure) {
    const orderInfo = {
      orderId,
      type, // 'open', 'close', 'tpsl'
      startTime: Date.now(),
      retryCount: 0,
      onSuccess,
      onFailure,
    };

    this.pendingOrders.set(orderId, orderInfo);

    // 实盘模式：依赖 WebSocket 推送 + 超时查询
    if (!this.config.testMode) {
      // 设置超时查询（3秒后如果还没收到推送，主动查询一次）
      orderInfo.timeout = setTimeout(async () => {
        logger.warn(`⏰ 订单 ${orderId} 超过3秒未收到推送，主动查询状态...`);
        await this.checkOrderStatus(orderId, orderInfo);
      }, 3000);

      // 设置最大超时（10秒后如果还是挂起，取消订单并重试）
      orderInfo.maxTimeout = setTimeout(async () => {
        if (this.pendingOrders.has(orderId)) {
          logger.error(`❌ 订单 ${orderId} 超过10秒仍未成交，取消订单并重试...`);
          await this.handlePendingOrderTimeout(orderId, orderInfo);
        }
      }, 10000);
    } else {
      // 测试模式：立即标记为成功
      setTimeout(() => {
        if (onSuccess) {
          onSuccess({ order_id: orderId, status: 6 });
        }
        this.pendingOrders.delete(orderId);
      }, 100);
    }
  }

  /**
   * 查询订单状态
   */
  async checkOrderStatus(orderId, orderInfo) {
    try {
      const axios = (await import('axios')).default;

      const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '');
      const path = '/linear-swap-api/v1/swap_order_info';

      const params = {
        contract_code: this.config.symbol,
        order_id: orderId,
      };

      const signature = this.generateSignature('POST', 'api.hbdm.com', path, {
        AccessKeyId: this.config.accessKey,
        SignatureMethod: 'HmacSHA256',
        SignatureVersion: '2',
        Timestamp: timestamp,
      });

      const url = `https://api.hbdm.com${path}`;
      const response = await axios.post(url, params, {
        headers: { 'Content-Type': 'application/json' },
        params: signature,
      });

      if (response.data.status === 'ok' && response.data.data && response.data.data.length > 0) {
        const order = response.data.data[0];
        const status = order.status;

        logger.info(`🔍 查询订单状态: ${orderId} | 状态: ${this.getOrderStatusText(status)}`);

        if (status === 6) {
          // 全部成交
          this.pendingOrders.delete(orderId);
          if (orderInfo.timeout) clearTimeout(orderInfo.timeout);
          if (orderInfo.maxTimeout) clearTimeout(orderInfo.maxTimeout);
          if (orderInfo.onSuccess) orderInfo.onSuccess(order);
        } else if (status === 7 || status === 10) {
          // 已撤单或失败
          this.pendingOrders.delete(orderId);
          if (orderInfo.timeout) clearTimeout(orderInfo.timeout);
          if (orderInfo.maxTimeout) clearTimeout(orderInfo.maxTimeout);
          if (orderInfo.onFailure) orderInfo.onFailure(order);
        } else if (status === 3 || status === 4) {
          // 还在挂单中，继续等待
          logger.info(`⏳ 订单 ${orderId} 仍在挂单中...`);
        }
      } else {
        logger.error('查询订单状态失败:', response.data.err_msg);
      }
    } catch (error) {
      logger.error('查询订单状态错误:', error.message);
    }
  }

  /**
   * 处理挂起订单超时
   */
  async handlePendingOrderTimeout(orderId, orderInfo) {
    try {
      // 1. 取消原订单
      await this.cancelOrder(orderId);
      
      // 2. 使用市价单重新下单
      logger.warn(`🔄 使用市价单重新下单...`);
      
      if (orderInfo.type === 'open') {
        // 重新开仓（使用对手价）
        // 这里需要从 orderInfo 中获取原始参数
        // 暂时标记为失败，让上层重试
        if (orderInfo.onFailure) {
          orderInfo.onFailure({ order_id: orderId, status: 10, reason: 'timeout' });
        }
      } else if (orderInfo.type === 'close') {
        // 重新平仓（使用对手价）
        if (orderInfo.onFailure) {
          orderInfo.onFailure({ order_id: orderId, status: 10, reason: 'timeout' });
        }
      }
      
      this.pendingOrders.delete(orderId);
    } catch (error) {
      logger.error('处理超时订单失败:', error.message);
    }
  }

  /**
   * 取消订单
   */
  async cancelOrder(orderId) {
    try {
      const axios = (await import('axios')).default;

      const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '');
      const path = '/linear-swap-api/v1/swap_cancel';

      const params = {
        contract_code: this.config.symbol,
        order_id: orderId,
      };

      const signature = this.generateSignature('POST', 'api.hbdm.com', path, {
        AccessKeyId: this.config.accessKey,
        SignatureMethod: 'HmacSHA256',
        SignatureVersion: '2',
        Timestamp: timestamp,
      });

      const url = `https://api.hbdm.com${path}`;
      const response = await axios.post(url, params, {
        headers: { 'Content-Type': 'application/json' },
        params: signature,
      });

      if (response.data.status === 'ok') {
        logger.info(`✅ 订单已取消: ${orderId}`);
        return true;
      } else {
        logger.error('取消订单失败:', response.data.err_msg);
        return false;
      }
    } catch (error) {
      logger.error('取消订单错误:', error.message);
      return false;
    }
  }
}

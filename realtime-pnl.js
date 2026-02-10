import dotenv from 'dotenv';
import { HTXFuturesClient } from './src/core/client.js';
import { UnifiedNotifier } from './src/services/unified-notifier.js';
import { marketConfig, configManager } from './src/config/market-config.js';
import { dataCollector } from './src/services/data-collector.js';
import { QuantTrader } from './src/services/quant-trader.js';
import { createLogger } from './src/utils/logger.js';
import WebSocket from 'ws';
import pako from 'pako';

dotenv.config();

const logger = createLogger('主程序');

const ACCESS_KEY = process.env.HTX_ACCESS_KEY;
const SECRET_KEY = process.env.HTX_SECRET_KEY;
const WS_URL = process.env.WS_URL || 'wss://api.hbdm.com/linear-swap-notification';
const MARKET_WS_URL = 'wss://api.hbdm.com/linear-swap-ws';

// 通知配置
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const BARK_KEY = process.env.BARK_KEY;
const BARK_SERVER = process.env.BARK_SERVER;

/**
 * 统一监控程序
 * 1. 持仓盈亏实时监控
 * 2. 市场行情趋势监控
 * 3. Telegram 智能通知
 */
async function main() {
  if (!ACCESS_KEY || !SECRET_KEY) {
    logger.error('请先配置 HTX_ACCESS_KEY 和 HTX_SECRET_KEY');
    process.exit(1);
  }

  logger.info('🚀 HTX 统一监控启动中...\n');
  logger.info('📊 功能：');
  logger.info('   ✅ 持仓盈亏实时监控');
  logger.info('   ✅ 市场行情趋势监控');
  logger.info('   ✅ 智能通知系统（Telegram + Bark）');
  logger.info('   ✅ 实时数据收集（供 Web 分析使用）');
  logger.info('   ✅ 量化交易（可选）\n');

  // 加载历史数据
  await dataCollector.loadData();

  // 从 Redis 加载配置（优先）或使用环境变量
  const config = await configManager.getConfig();
  const quantConfig = config.quantConfig || {};
  
  // 初始化量化交易模块
  const quantTrader = new QuantTrader({
    enabled: quantConfig.enabled !== undefined ? quantConfig.enabled : (process.env.QUANT_ENABLED === 'true'),
    testMode: quantConfig.testMode !== undefined ? quantConfig.testMode : (process.env.QUANT_TEST_MODE !== 'false'),
    dryRun: quantConfig.dryRun !== undefined ? quantConfig.dryRun : (process.env.QUANT_DRY_RUN === 'true'),
    accessKey: ACCESS_KEY,
    secretKey: SECRET_KEY,
    symbol: quantConfig.symbol || process.env.QUANT_SYMBOL || 'BTC-USDT',
    leverage: quantConfig.leverage || parseInt(process.env.QUANT_LEVERAGE) || 10,
    initialBalance: quantConfig.initialBalance || parseFloat(process.env.QUANT_INITIAL_BALANCE) || 1000,
    positionSize: quantConfig.positionSize || parseFloat(process.env.QUANT_POSITION_SIZE) || 0.1,
    stopLoss: quantConfig.stopLoss || parseFloat(process.env.QUANT_STOP_LOSS) || 0.02,
    takeProfit: quantConfig.takeProfit || parseFloat(process.env.QUANT_TAKE_PROFIT) || 0.05,
    trailingStop: quantConfig.trailingStop || parseFloat(process.env.QUANT_TRAILING_STOP) || 0.03,
    maxPositions: quantConfig.maxPositions || parseInt(process.env.QUANT_MAX_POSITIONS) || 1,
    minConfidence: quantConfig.minConfidence || parseInt(process.env.QUANT_MIN_CONFIDENCE) || 60,
    signalMode: quantConfig.signalMode || process.env.QUANT_SIGNAL_MODE || 'simple', // 默认使用简化版
    dataCollector: dataCollector, // 传入数据收集器
    notifier: null, // 🔥 稍后初始化
  });

  const client = new HTXFuturesClient(ACCESS_KEY, SECRET_KEY, WS_URL);
  const positions = new Map();
  let marketWs = null;
  let subscribedContracts = new Set();
  let notifier = null;

  // 行情监控配置
  let { watchContracts = ['ETH-USDT'], priceChangeConfig = { enabled: false, timeWindows: [], minNotifyInterval: 120000 } } = marketConfig || {};
  
  // 🔥 自动添加量化交易的交易对到监控列表
  const quantSymbol = process.env.QUANT_SYMBOL || 'BTC-USDT';
  if (!watchContracts.includes(quantSymbol)) {
    console.log(`\n💡 自动添加量化交易交易对到监控列表: ${quantSymbol}`);
    watchContracts.push(quantSymbol);
  }
  
  const priceTracker = {};

  // 初始化行情追踪器
  function initPriceTracker() {
    watchContracts.forEach(contract => {
      if (!priceTracker[contract]) {
        priceTracker[contract] = {
          priceHistory: [],         // 存储 { price, timestamp } 对象
          lastNotifyTime: 0,        // 上次通知时间
          lastNotifyPrice: null,    // 上次通知时的价格
        };
      }
    });
  }
  
  initPriceTracker();

  // 初始化统一通知器
  function initNotifier() {
    const hasTelegram = TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID;
    const hasBark = BARK_KEY;
    
    if (hasTelegram || hasBark) {
      console.log('📱 初始化通知系统...');
      const config = marketConfig.notificationConfig || {};
      
      notifier = new UnifiedNotifier({
        telegram: hasTelegram ? {
          botToken: TELEGRAM_BOT_TOKEN,
          chatId: TELEGRAM_CHAT_ID
        } : null,
        bark: hasBark ? {
          key: BARK_KEY,
          server: BARK_SERVER || 'https://api.day.app',
          sound: 'bell',
          group: 'HTX交易'
        } : null,
        notificationConfig: {
          profitThreshold: config.profitThreshold || 3,
          lossThreshold: config.lossThreshold || -5,
          profitAmountThreshold: config.profitAmountThreshold || 2,
          lossAmountThreshold: config.lossAmountThreshold || -2,
          timeInterval: config.timeInterval || 3600000,
          repeatInterval: config.repeatInterval || 5000,
          enableTimeNotification: config.enableTimeNotification || false,
          enableProfitNotification: config.enableProfitNotification !== false,
          enableLossNotification: config.enableLossNotification || false,
        }
      });

      // 初始化通知系统
      if (notifier.hasNotifiers()) {
        console.log(`✅ 通知系统已就绪 (${notifier.getEnabledNotifiers().join(' + ')})\n`);
        
        // 🔥 将通知器传递给量化交易模块
        quantTrader.notifier = notifier;
      } else {
        notifier = null;
      }
    } else {
      console.log('💡 未配置通知方式，仅显示控制台输出');
      console.log('💡 推荐配置 Bark（iOS，延迟<1秒）或 Telegram');
      console.log('💡 详见 Bark配置指南.md 或 Telegram配置指南.md\n');
    }
  }
  
  initNotifier();

  // ==================== 持仓监控 ====================

  // 监听持仓更新
  client.on('positions', (data) => {
    logger.info('\n💼 ===== 持仓变化通知 =====');
    
    positions.clear();
    const currentContracts = new Set();
    
    if (Array.isArray(data)) {
      logger.debug(`收到 ${data.length} 条持仓数据`);
      
      // 🔥 实盘模式：将持仓数据传递给量化交易模块
      if (!quantTrader.config.testMode) {
        quantTrader.onPositionsUpdate(data);
      }
      
      data.forEach(position => {
        const key = `${position.contract_code}_${position.direction}`;
        
        if (position.volume > 0) {
          positions.set(key, position);
          currentContracts.add(position.contract_code);
          
          logger.info(`✅ 有效持仓:`);
          logger.info(`   合约: ${position.contract_code}`);
          logger.info(`   方向: ${position.direction === 'buy' ? '多仓' : '空仓'}`);
          logger.info(`   持仓量: ${position.volume} 张`);
          logger.info(`   开仓价: ${position.cost_open}`);
          logger.info(`   保证金: ${position.position_margin} USDT`);
        }
      });
    }
    
    logger.info(`\n当前持仓数: ${positions.size}`);
    logger.info(`持仓合约: ${currentContracts.size > 0 ? Array.from(currentContracts).join(', ') : '无'}`);
    
    if (marketWs && marketWs.readyState === WebSocket.OPEN) {
      updateMarketSubscriptions(currentContracts);
    }
  });

  // 更新市场行情订阅
  function updateMarketSubscriptions(currentContracts) {
    // 取消已平仓合约的订阅
    subscribedContracts.forEach(contract => {
      if (!currentContracts.has(contract) && !watchContracts.includes(contract)) {
        console.log(`� 取消订阅: ${contract} (已平仓且不在监控列表)`);
        const unsubMsg = {
          unsub: `market.${contract}.detail`,
          id: `unsub_${contract}`
        };
        if (marketWs && marketWs.readyState === WebSocket.OPEN) {
          marketWs.send(JSON.stringify(unsubMsg));
        }
        subscribedContracts.delete(contract);
      }
    });
    
    // 订阅新开仓合约
    currentContracts.forEach(contract => {
      if (!subscribedContracts.has(contract)) {
        console.log(`� 新增订阅: ${contract} (新开仓)`);
        const subMsg = {
          sub: `market.${contract}.detail`,
          id: `detail_${contract}`
        };
        if (marketWs && marketWs.readyState === WebSocket.OPEN) {
          marketWs.send(JSON.stringify(subMsg));
        }
        subscribedContracts.add(contract);
      }
    });
  }

  // ==================== 行情监控 ====================

  // 分析价格变化（多时间窗口）
  async function analyzeTrend(contractCode, currentPrice) {
    const tracker = priceTracker[contractCode];
    if (!tracker) return;

    const now = Date.now();
    
    // 添加当前价格和时间戳
    tracker.priceHistory.push({ price: currentPrice, timestamp: now });
    
    // 清理超过最大时间窗口的旧数据（保留1小时+缓冲）
    const maxWindow = Math.max(...priceChangeConfig.timeWindows.map(w => w.duration));
    const cutoffTime = now - maxWindow - 5000; // 多保留5秒
    tracker.priceHistory = tracker.priceHistory.filter(item => item.timestamp > cutoffTime);
    
    // 检查价格目标监控
    const currentConfig = configManager.getConfig();
    if (currentConfig.priceTargets?.enabled) {
      await checkPriceTargets(contractCode, currentPrice);
    }
    
    // 如果多时间窗口监控已关闭，只显示价格
    if (!priceChangeConfig.enabled) {
      // 静默模式，不输出日志
      return;
    }
    
    // 检查所有时间窗口
    const changes = [];
    for (const window of priceChangeConfig.timeWindows) {
      const windowStartTime = now - window.duration;
      
      // 找到最接近时间窗口起点的价格
      let basePrice = null;
      let baseTime = null;
      
      for (let i = 0; i < tracker.priceHistory.length; i++) {
        if (tracker.priceHistory[i].timestamp <= windowStartTime) {
          basePrice = tracker.priceHistory[i].price;
          baseTime = tracker.priceHistory[i].timestamp;
        } else {
          break;
        }
      }
      
      // 如果有足够旧的数据，计算变化
      if (basePrice) {
        const priceChange = currentPrice - basePrice;
        const priceChangePercent = (priceChange / basePrice) * 100;
        const actualTimeSpan = (now - baseTime) / 1000;
        const absChange = Math.abs(priceChange);
        const absChangePercent = Math.abs(priceChangePercent);
        
        changes.push({
          window: window.name,
          duration: window.duration,
          threshold: window.threshold,
          amountThreshold: window.amountThreshold,
          basePrice,
          currentPrice,
          priceChange,
          priceChangePercent,
          actualTimeSpan,
          meetsThreshold: absChangePercent >= window.threshold || absChange >= window.amountThreshold
        });
      }
    }
    
    // 显示最短时间窗口的变化（用于日志）
    if (changes.length > 0) {
      const shortestChange = changes[0];
      // 只在有显著变化时输出
      const changeEmoji = shortestChange.priceChangePercent >= 0 ? '📈' : '📉';
      const changeSign = shortestChange.priceChangePercent >= 0 ? '+' : '';
      const amountSign = shortestChange.priceChange >= 0 ? '+' : '';
      console.log(`${changeEmoji} ${contractCode}: ${currentPrice.toFixed(2)} (${shortestChange.window} ${changeSign}${shortestChange.priceChangePercent.toFixed(2)}% / ${amountSign}${shortestChange.priceChange.toFixed(2)} USDT)`);
    }
    
    // 检查是否需要通知（找到最显著的变化）
    if (notifier && changes.length > 0) {
      const significantChanges = changes.filter(c => c.meetsThreshold);
      if (significantChanges.length > 0) {
        // 选择变化幅度最大的窗口进行通知
        const mostSignificant = significantChanges.reduce((max, c) => 
          Math.abs(c.priceChangePercent) > Math.abs(max.priceChangePercent) ? c : max
        );
        
        await checkAndNotifyPriceChange(contractCode, mostSignificant, tracker);
      }
    }
  }

  // 检查价格目标
  async function checkPriceTargets(contractCode, currentPrice) {
    const currentConfig = configManager.getConfig();
    if (!currentConfig.priceTargets?.targets) return;
    
    const now = Date.now();
    const targetsToRemove = [];
    let configChanged = false;
    
    for (let i = 0; i < currentConfig.priceTargets.targets.length; i++) {
      const target = currentConfig.priceTargets.targets[i];
      if (target.symbol !== contractCode) continue;
      
      // 检查通知间隔（如果设置了间隔且不是第一次通知）
      const notifyInterval = (target.notifyInterval || 0) * 1000; // 转换为毫秒
      const lastNotifyTime = target.lastNotifyTime || 0;
      if (notifyInterval > 0 && lastNotifyTime > 0 && (now - lastNotifyTime) < notifyInterval) {
        const remainingTime = Math.ceil((notifyInterval - (now - lastNotifyTime)) / 1000);
        logger.debug(`冷却期中，还需等待 ${remainingTime} 秒`);
        continue; // 还在冷却期，跳过
      }
      
      // 计算价格范围（如果设置了幅度）
      const rangePercent = target.rangePercent || 0;
      let triggerPriceLow = target.targetPrice;  // 触发下限
      let triggerPriceHigh = target.targetPrice; // 触发上限
      
      if (rangePercent > 0) {
        if (target.direction === 'above') {
          // 向上突破：在目标价 ~ 目标价+幅度 范围内通知
          triggerPriceLow = target.targetPrice;
          triggerPriceHigh = target.targetPrice * (1 + rangePercent / 100);
        } else {
          // 向下突破：在目标价-幅度 ~ 目标价 范围内通知
          triggerPriceLow = target.targetPrice * (1 - rangePercent / 100);
          triggerPriceHigh = target.targetPrice;
        }
      }
      
      logger.trace(`触发范围: ${triggerPriceLow.toFixed(2)} ~ ${triggerPriceHigh.toFixed(2)}`);
      
      // 检查是否触发
      let shouldNotify = false;
      let triggerType = '';
      
      if (target.direction === 'above') {
        // 向上突破：价格在 [目标价, 目标价+幅度] 范围内
        if (rangePercent > 0) {
          // 有幅度限制：目标价 <= 价格 <= 目标价+幅度
          if (currentPrice >= triggerPriceLow && currentPrice <= triggerPriceHigh) {
            shouldNotify = true;
            triggerType = `达到 ${target.targetPrice} (${rangePercent}% 范围内)`;
            logger.trace(`触发条件满足: ${triggerPriceLow.toFixed(2)} <= ${currentPrice.toFixed(2)} <= ${triggerPriceHigh.toFixed(2)}`);
          } else if (currentPrice < triggerPriceLow) {
            logger.trace(`未触发: ${currentPrice.toFixed(2)} < ${triggerPriceLow.toFixed(2)} (未达到目标价)`);
          } else {
            logger.trace(`未触发: ${currentPrice.toFixed(2)} > ${triggerPriceHigh.toFixed(2)} (超出幅度范围)`);
          }
        } else {
          // 无幅度限制：价格 >= 目标价
          if (currentPrice >= target.targetPrice) {
            shouldNotify = true;
            triggerType = `达到 ${target.targetPrice}`;
            logger.trace(`触发条件满足: ${currentPrice.toFixed(2)} >= ${target.targetPrice.toFixed(2)}`);
          } else {
            logger.trace(`未触发: ${currentPrice.toFixed(2)} < ${target.targetPrice.toFixed(2)}`);
          }
        }
      } else if (target.direction === 'below') {
        // 向下突破：价格在 [目标价-幅度, 目标价] 范围内
        if (rangePercent > 0) {
          // 有幅度限制：目标价-幅度 <= 价格 <= 目标价
          if (currentPrice >= triggerPriceLow && currentPrice <= triggerPriceHigh) {
            shouldNotify = true;
            triggerType = `跌破 ${target.targetPrice} (${rangePercent}% 范围内)`;
            logger.trace(`触发条件满足: ${triggerPriceLow.toFixed(2)} <= ${currentPrice.toFixed(2)} <= ${triggerPriceHigh.toFixed(2)}`);
          } else if (currentPrice > triggerPriceHigh) {
            logger.trace(`未触发: ${currentPrice.toFixed(2)} > ${triggerPriceHigh.toFixed(2)} (未跌破目标价)`);
          } else {
            logger.trace(`未触发: ${currentPrice.toFixed(2)} < ${triggerPriceLow.toFixed(2)} (超出幅度范围)`);
          }
        } else {
          // 无幅度限制：价格 <= 目标价
          if (currentPrice <= target.targetPrice) {
            shouldNotify = true;
            triggerType = `跌破 ${target.targetPrice}`;
            logger.trace(`触发条件满足: ${currentPrice.toFixed(2)} <= ${target.targetPrice.toFixed(2)}`);
          } else {
            logger.trace(`未触发: ${currentPrice.toFixed(2)} > ${target.targetPrice.toFixed(2)}`);
          }
        }
      }
      
      if (shouldNotify && notifier) {
        const emoji = target.direction === 'above' ? '🎯' : '⚠️';
        const directionText = target.direction === 'above' ? '达到' : '跌破';
        
        // 构建价格范围说明
        let priceRangeText = '';
        if (rangePercent > 0) {
          priceRangeText = `\n通知范围: \`${triggerPriceLow.toFixed(2)}\` ~ \`${triggerPriceHigh.toFixed(2)}\` USDT (${rangePercent}% 幅度)`;
        }
        
        // Telegram 格式消息
        const telegramMessage = `
${emoji} *价格目标${directionText}*

🎯 *${contractCode}*

📊 *价格信息*
目标价格: \`${target.targetPrice.toFixed(2)}\` USDT${priceRangeText}
当前价格: \`${currentPrice.toFixed(2)}\` USDT
触发条件: ${triggerType}

⏰ ${new Date().toLocaleString('zh-CN')}
`.trim();

        // Bark 格式消息
        const barkTitle = `${emoji} ${contractCode} ${triggerType}`;
        const barkBody = `📊 当前价格: ${currentPrice.toFixed(2)} USDT
⏰ ${new Date().toLocaleString('zh-CN')}`;

        await notifier.notify(telegramMessage, barkTitle, barkBody, {
          sound: 'bell',
          level: 'timeSensitive'
        });
        
        // 触发通知
        await notifier.sendNotification({
          title: `🎯 价格目标触发`,
          message: `${contractCode} ${triggerType}，当前价格 ${currentPrice.toFixed(2)}`,
          priority: 'high',
          data: {
            symbol: contractCode,
            price: currentPrice,
            targetPrice: target.targetPrice,
            direction: target.direction
          }
        });
        
        // 更新最后通知时间
        target.lastNotifyTime = now;
        configChanged = true;
        
        // 如果设置了只通知一次，标记为待移除
        if (target.notifyOnce) {
          targetsToRemove.push(i);
        }
      }
    }
    
    // 移除已完成的一次性目标（从后往前删除，避免索引问题）
    for (let i = targetsToRemove.length - 1; i >= 0; i--) {
      currentConfig.priceTargets.targets.splice(targetsToRemove[i], 1);
      configChanged = true;
    }
    
    // 如果配置有变化（移除目标或更新时间），保存配置
    if (configChanged) {
      // 重新读取配置文件，避免覆盖用户的手动修改
      const latestConfig = await configManager.loadConfig();
      // 只更新价格目标部分
      latestConfig.priceTargets = currentConfig.priceTargets;
      await configManager.saveConfig(latestConfig);
    }
  }

  // 计算趋势
  function calculateTrend(prices) {
    let upCount = 0;
    let downCount = 0;

    for (let i = 1; i < prices.length; i++) {
      if (prices[i] > prices[i - 1]) {
        upCount++;
      } else if (prices[i] < prices[i - 1]) {
        downCount++;
      }
    }

    if (upCount >= prices.length * trendConfig.trendThreshold) {
      return 'up';
    }
    if (downCount >= prices.length * trendConfig.trendThreshold) {
      return 'down';
    }

    return 'neutral';
  }

  // 检查并发送价格变化通知
  async function checkAndNotifyPriceChange(contractCode, changeData, tracker) {
    const now = Date.now();
    
    // 检查是否在最小通知间隔内
    if (now - tracker.lastNotifyTime < priceChangeConfig.minNotifyInterval) {
      return; // 同一合约在间隔时间内不重复通知
    }
    
    // 发送通知
    tracker.lastNotifyTime = now;
    tracker.lastNotifyPrice = changeData.currentPrice;
    
    const trend = changeData.priceChangePercent > 0 ? 'up' : 'down';
    const direction = trend === 'up' ? '上涨' : '下跌';
    
    await sendPriceChangeNotification(contractCode, changeData, trend, direction);
  }

  // 发送价格变化通知
  async function sendPriceChangeNotification(contractCode, changeData, trend, direction) {
    const emoji = trend === 'up' ? '📈' : '📉';
    const changeEmoji = trend === 'up' ? '🟢' : '🔴';

    // Telegram 格式消息
    const telegramMessage = `
${emoji} *行情${direction}提醒*

${changeEmoji} *${contractCode}*

📊 *价格信息*
起始价格: \`${changeData.basePrice.toFixed(2)}\` USDT (${changeData.window}前)
当前价格: \`${changeData.currentPrice.toFixed(2)}\` USDT
价格变化: \`${changeData.priceChange >= 0 ? '+' : ''}${changeData.priceChange.toFixed(2)}\` USDT
变化幅度: \`${changeData.priceChangePercent >= 0 ? '+' : ''}${changeData.priceChangePercent.toFixed(2)}%\`

⏱️ *趋势分析*
时间跨度: ${changeData.window} (${changeData.actualTimeSpan.toFixed(0)}秒)
持续${direction}: ${Math.abs(changeData.priceChangePercent).toFixed(2)}%

⏰ ${new Date().toLocaleString('zh-CN')}
`.trim();

    // Bark 格式消息
    const barkTitle = `${emoji} ${contractCode} ${direction} ${Math.abs(changeData.priceChangePercent).toFixed(2)}%`;
    const barkBody = `${changeEmoji} ${changeData.window}内${direction} ${Math.abs(changeData.priceChange).toFixed(2)} USDT
📊 ${changeData.basePrice.toFixed(2)} → ${changeData.currentPrice.toFixed(2)}
⏰ ${new Date().toLocaleString('zh-CN')}`;

    await notifier.notify(telegramMessage, barkTitle, barkBody, {
      sound: '', // 行情推送无音效（静默）
      level: 'passive' // 被动通知，不会打断用户
    });
  }


  // ==================== 市场行情连接 ====================

  function connectMarketWs() {
    logger.info('\n📊 连接市场行情 WebSocket...');
    marketWs = new WebSocket(MARKET_WS_URL);
    let pingInterval = null;

    marketWs.on('open', () => {
      logger.info('✅ 市场行情连接成功\n');
      
      pingInterval = setInterval(() => {
        if (marketWs && marketWs.readyState === WebSocket.OPEN) {
          marketWs.ping();
        }
      }, 20000);
      
      // 合并持仓合约和监控合约
      const allContracts = new Set([
        ...Array.from(positions.values()).map(p => p.contract_code),
        ...watchContracts
      ]);
      
      if (allContracts.size > 0) {
        logger.info('📡 订阅行情:', Array.from(allContracts).join(', '));
        allContracts.forEach(contract => {
          const subMsg = {
            sub: `market.${contract}.detail`,
            id: `detail_${contract}`
          };
          marketWs.send(JSON.stringify(subMsg));
          subscribedContracts.add(contract);
          logger.debug(`   → ${contract}`);
        });
      } else {
        logger.warn('当前无持仓且无监控合约');
      }
    });

    marketWs.on('message', (data) => {
      try {
        const text = pako.inflate(data, { to: 'string' });
        const message = JSON.parse(text);

        if (message.ping) {
          marketWs.send(JSON.stringify({ pong: message.ping }));
          return;
        }

        if (message.tick && message.ch) {
          const match = message.ch.match(/market\.([^.]+)\./);
          if (match) {
            const contractCode = match[1];
            const lastPrice = message.tick.close || message.tick.last;
            if (lastPrice) {
              // 更新实时价格数据
              dataCollector.updatePrice(contractCode, lastPrice);
              
              // 量化交易模块处理
              quantTrader.onPriceUpdate(contractCode, lastPrice).catch(error => {
                console.error('❌ [量化] 价格更新处理错误:', error.message);
              });
              
              // 持仓盈亏计算
              calculatePnL(contractCode, lastPrice);
              // 行情趋势分析
              analyzeTrend(contractCode, lastPrice);
            }
          }
        }

        if (message.status === 'ok' && message.subbed) {
          console.log(`✓ 行情订阅成功: ${message.subbed}`);
        }
        
        if (message.status === 'ok' && message.unsubbed) {
          console.log(`✓ 取消订阅成功: ${message.unsubbed}`);
        }
      } catch (error) {
        console.error('行情消息处理错误:', error.message);
      }
    });

    marketWs.on('error', (error) => {
      logger.error('市场行情连接错误:', error.message);
    });

    marketWs.on('close', (code) => {
      logger.info(`🔌 市场行情连接关闭 (code: ${code})`);
      
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
      
      subscribedContracts.clear();
      
      logger.info('⏳ 5秒后重连市场行情...');
      setTimeout(connectMarketWs, 5000);
    });

    marketWs.on('pong', () => {
      // 连接正常
    });
  }

  // 计算实时盈亏并发送通知
  async function calculatePnL(contractCode, lastPrice) {
    const allPositions = [];
    
    for (const direction of ['buy', 'sell']) {
      const key = `${contractCode}_${direction}`;
      const position = positions.get(key);
      
      if (!position || position.volume <= 0) {
        continue;
      }
      
      const costOpen = parseFloat(position.cost_open);
      const volume = parseFloat(position.volume);
      
      const contractSize = contractCode.includes('BTC') ? 0.001 : 
                          contractCode.includes('ETH') ? 0.01 : 1;
      
      const actualPosition = volume * contractSize;
      const positionValue = actualPosition * lastPrice;
      
      let profitUnreal;
      if (direction === 'buy') {
        profitUnreal = (lastPrice - costOpen) * volume * contractSize;
      } else {
        profitUnreal = (costOpen - lastPrice) * volume * contractSize;
      }
      
      const positionMargin = parseFloat(position.position_margin);
      const profitRate = positionMargin > 0 ? (profitUnreal / positionMargin * 100) : 0;
      
      const profitColor = profitUnreal >= 0 ? '🟢' : '🔴';
      const directionText = direction === 'buy' ? '多仓' : '空仓';
      
      console.log(`${profitColor} [${new Date().toLocaleTimeString('zh-CN')}] ${contractCode} ${directionText}`);
      console.log(`   持仓: ${volume} 张 × ${contractSize} = ${actualPosition.toFixed(4)} ${contractCode.split('-')[0]}`);
      console.log(`   持仓价值: ${positionValue.toFixed(2)} USDT | 保证金: ${positionMargin.toFixed(2)} USDT`);
      console.log(`   最新价: ${lastPrice.toFixed(2)} | 开仓价: ${costOpen.toFixed(2)}`);
      console.log(`   未实现盈亏: ${profitUnreal.toFixed(4)} USDT | 收益率: ${profitRate.toFixed(2)}%`);
      
      const positionData = {
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
      };
      
      allPositions.push(positionData);
      
      if (notifier) {
        await notifier.notifyPositionPnL(positionData);
      }
    }
    
    if (notifier && allPositions.length > 0) {
      await notifier.notifyTimeSummary(allPositions);
    }
  }

  // ==================== 配置热重载 ====================
  
  // 监听配置变化
  configManager.on('configChanged', (newConfig) => {
    console.log('\n🔄 检测到配置变化，正在应用新配置...\n');
    
    // 更新本地配置引用
    watchContracts = newConfig.watchContracts;
    priceChangeConfig = newConfig.priceChangeConfig;
    
    // 重新初始化价格追踪器
    initPriceTracker();
    
    // 重新初始化通知器
    initNotifier();
    
    // 🔥 更新量化交易模块的通知器
    quantTrader.notifier = notifier;
    
    // 更新市场订阅
    if (marketWs && marketWs.readyState === WebSocket.OPEN) {
      const currentContracts = new Set([
        ...Array.from(positions.values()).map(p => p.contract_code),
        ...watchContracts
      ]);
      updateMarketSubscriptions(currentContracts);
    }
    
    console.log('✅ 新配置已应用\n');
    printCurrentConfig();
  });
  
  // 启动配置监听
  configManager.startWatching();

  // 定期打印量化交易状态（每30秒）
  setInterval(() => {
    quantTrader.printStatus();
  }, 30000);

  // ==================== 启动 ====================

  try {
    await client.connect();
    
    client.subscribePositions('*');
    
    client.subscribe('positions_cross.*');

    // 🔥 将 WebSocket 客户端传给量化交易模块
    quantTrader.setWebSocketClient(client);

    // 等待持仓数据加载
    await new Promise(resolve => setTimeout(resolve, 3000));
    if (positions.size > 0) {
      const contracts = Array.from(new Set(
        Array.from(positions.values()).map(p => p.contract_code)
      ));
      console.log(`📋 持仓合约: ${contracts.join(', ')}`);
    } else {
      console.log('⚠️  当前无持仓');
    }
    
    connectMarketWs();

    console.log('\n✅ 监听已启动\n');
    
    printCurrentConfig();

  } catch (error) {
    console.error('❌ 启动失败:', error.message);
    process.exit(1);
  }

  // 打印当前配置
  function printCurrentConfig() {
    // 获取最新配置
    const currentConfig = configManager.getConfig();
    
    console.log('💡 持仓监控配置：');
    if (notifier) {
      // 从 UnifiedNotifier 的子通知器中获取配置
      const config = notifier.barkNotifier?.config || notifier.telegramNotifier?.config;
      if (config) {
        console.log(`   盈利通知: ${config.enableProfitNotification ? '✅' : '❌'} ${config.profitThreshold}% 或 ${config.profitAmountThreshold} USDT`);
        console.log(`   亏损通知: ${config.enableLossNotification ? '✅' : '❌'} ${config.lossThreshold}% 或 ${config.lossAmountThreshold} USDT`);
        console.log(`   定时通知: ${config.enableTimeNotification ? '✅' : '❌'} 每 ${config.timeInterval / 60000} 分钟`);
      }
    }
    
    console.log('\n💡 行情监控配置：');
    console.log(`   监控合约: ${watchContracts.join(', ')}`);
    console.log(`   多时间窗口监控: ${priceChangeConfig.enabled ? '✅ 开启' : '❌ 关闭'}`);
    if (priceChangeConfig.enabled) {
      priceChangeConfig.timeWindows.forEach(w => {
        console.log(`      - ${w.name}: 变化 ${w.threshold}% 或 ${w.amountThreshold} USDT 时通知`);
      });
      console.log(`   通知间隔: 同一合约最少 ${priceChangeConfig.minNotifyInterval / 60000} 分钟`);
    }
    
    if (currentConfig.priceTargets?.enabled) {
      console.log(`   价格目标监控: ✅ 开启`);
      currentConfig.priceTargets.targets.forEach(t => {
        const directionText = t.direction === 'above' ? '达到' : '跌破';
        console.log(`      - ${t.symbol}: ${directionText} ${t.targetPrice} USDT`);
      });
    }
    console.log('');
  }

  process.on('SIGINT', () => {
    console.log('\n\n👋 正在关闭连接...');
    configManager.stopWatching();
    client.close();
    if (marketWs) marketWs.close();
    process.exit(0);
  });
}

main().catch(error => {
  console.error('❌ 程序异常:', error);
  process.exit(1);
});

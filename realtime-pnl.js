import dotenv from 'dotenv';
import { HTXFuturesClient } from './client.js';
import { UnifiedNotifier } from './unified-notifier.js';
import { marketConfig } from './market-config.js';
import WebSocket from 'ws';
import pako from 'pako';

dotenv.config();

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
    console.error('❌ 请先配置 HTX_ACCESS_KEY 和 HTX_SECRET_KEY');
    process.exit(1);
  }

  console.log('🚀 HTX 统一监控启动中...\n');
  console.log('📊 功能：');
  console.log('   ✅ 持仓盈亏实时监控');
  console.log('   ✅ 市场行情趋势监控');
  console.log('   ✅ 智能通知系统（Telegram + Bark）\n');

  const client = new HTXFuturesClient(ACCESS_KEY, SECRET_KEY, WS_URL);
  const positions = new Map();
  let marketWs = null;
  let subscribedContracts = new Set();
  let notifier = null;

  // 行情监控配置
  const { watchContracts, priceChangeConfig } = marketConfig;
  const priceTracker = {};

  // 初始化行情追踪器
  watchContracts.forEach(contract => {
    priceTracker[contract] = {
      priceHistory: [],         // 存储 { price, timestamp } 对象
      lastNotifyTime: 0,        // 上次通知时间
      lastNotifyPrice: null,    // 上次通知时的价格
    };
  });

  // 初始化统一通知器
  const hasTelegram = TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID;
  const hasBark = BARK_KEY;
  
  if (hasTelegram || hasBark) {
    console.log('📱 初始化通知系统...');
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
        profitThreshold: 3,                    // 盈利 3% 时通知
        lossThreshold: -5,                     // 亏损 5% 时通知（已关闭）
        profitAmountThreshold: 2,              // 盈利 2 USDT 时通知
        lossAmountThreshold: -2,               // 亏损 2 USDT 时通知（已关闭）
        timeInterval: 60 * 60 * 1000,          // 1 小时定时通知（已关闭）
        repeatInterval: 5 * 1000,              // 5 秒防重复
        enableTimeNotification: false,         // 关闭定时通知
        enableProfitNotification: true,        // 保留涨幅通知
        enableLossNotification: false,         // 关闭亏损通知
      }
    });

    // 初始化通知系统
    if (notifier.hasNotifiers()) {
      console.log(`✅ 通知系统已就绪 (${notifier.getEnabledNotifiers().join(' + ')})\n`);
    } else {
      notifier = null;
    }
  } else {
    console.log('💡 未配置通知方式，仅显示控制台输出');
    console.log('💡 推荐配置 Bark（iOS，延迟<1秒）或 Telegram');
    console.log('💡 详见 Bark配置指南.md 或 Telegram配置指南.md\n');
  }

  // ==================== 持仓监控 ====================

  // 监听持仓更新
  client.on('positions', (data) => {
    console.log('\n💼 ===== 持仓变化通知 =====');
    
    positions.clear();
    const currentContracts = new Set();
    
    if (Array.isArray(data)) {
      console.log(`收到 ${data.length} 条持仓数据`);
      
      data.forEach(position => {
        const key = `${position.contract_code}_${position.direction}`;
        
        console.log(`\n检查: ${position.contract_code} ${position.direction} - 持仓量: ${position.volume}`);
        
        if (position.volume > 0) {
          positions.set(key, position);
          currentContracts.add(position.contract_code);
          
          console.log(`✅ 有效持仓:`);
          console.log(`   合约: ${position.contract_code}`);
          console.log(`   方向: ${position.direction === 'buy' ? '多仓' : '空仓'}`);
          console.log(`   持仓量: ${position.volume} 张`);
          console.log(`   开仓价: ${position.cost_open}`);
          console.log(`   保证金: ${position.position_margin} USDT`);
        }
      });
    }
    
    console.log(`\n当前持仓数: ${positions.size}`);
    console.log(`持仓合约: ${currentContracts.size > 0 ? Array.from(currentContracts).join(', ') : '无'}`);
    
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
    if (marketConfig.priceTargets?.enabled) {
      await checkPriceTargets(contractCode, currentPrice);
    }
    
    // 如果多时间窗口监控已关闭，只显示价格
    if (!priceChangeConfig.enabled) {
      console.log(`📊 [行情] ${contractCode}: ${currentPrice.toFixed(2)}`);
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
      const changeEmoji = shortestChange.priceChangePercent >= 0 ? '📈' : '📉';
      const changeSign = shortestChange.priceChangePercent >= 0 ? '+' : '';
      const amountSign = shortestChange.priceChange >= 0 ? '+' : '';
      console.log(`${changeEmoji} [行情] ${contractCode}: ${currentPrice.toFixed(2)} (${shortestChange.window} ${changeSign}${shortestChange.priceChangePercent.toFixed(2)}% / ${amountSign}${shortestChange.priceChange.toFixed(2)} USDT)`);
    } else {
      console.log(`📊 [行情] ${contractCode}: ${currentPrice.toFixed(2)} (数据收集中...)`);
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
    if (!marketConfig.priceTargets?.targets) return;
    
    for (const target of marketConfig.priceTargets.targets) {
      if (target.symbol !== contractCode || target.notified) continue;
      
      let shouldNotify = false;
      if (target.direction === 'above' && currentPrice >= target.targetPrice) {
        shouldNotify = true;
      } else if (target.direction === 'below' && currentPrice <= target.targetPrice) {
        shouldNotify = true;
      }
      
      if (shouldNotify && notifier) {
        target.notified = true;
        
        const emoji = target.direction === 'above' ? '🎯' : '⚠️';
        const directionText = target.direction === 'above' ? '达到' : '跌破';
        
        // Telegram 格式消息
        const telegramMessage = `
${emoji} *价格目标${directionText}*

🎯 *${contractCode}*

📊 *价格信息*
目标价格: \`${target.targetPrice.toFixed(2)}\` USDT
当前价格: \`${currentPrice.toFixed(2)}\` USDT
方向: ${directionText}目标价

⏰ ${new Date().toLocaleString('zh-CN')}
`.trim();

        // Bark 格式消息
        const barkTitle = `${emoji} ${contractCode} ${directionText}目标价 ${target.targetPrice}`;
        const barkBody = `📊 当前价格: ${currentPrice.toFixed(2)} USDT
⏰ ${new Date().toLocaleString('zh-CN')}`;

        await notifier.notify(telegramMessage, barkTitle, barkBody, {
          sound: 'bell',
          level: 'timeSensitive'
        });
        
        console.log(`🎯 [价格目标] ${contractCode} ${directionText}目标价 ${target.targetPrice}，当前价格 ${currentPrice.toFixed(2)}`);
      }
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
    console.log('\n📊 连接市场行情 WebSocket...');
    marketWs = new WebSocket(MARKET_WS_URL);
    let pingInterval = null;

    marketWs.on('open', () => {
      console.log('✅ 市场行情连接成功\n');
      
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
        console.log('📡 订阅行情:', Array.from(allContracts).join(', '));
        allContracts.forEach(contract => {
          const subMsg = {
            sub: `market.${contract}.detail`,
            id: `detail_${contract}`
          };
          marketWs.send(JSON.stringify(subMsg));
          subscribedContracts.add(contract);
          console.log(`   → ${contract}`);
        });
      } else {
        console.log('⚠️  当前无持仓且无监控合约');
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
      console.error('❌ 市场行情连接错误:', error.message);
    });

    marketWs.on('close', (code, reason) => {
      console.log(`🔌 市场行情连接关闭 (code: ${code})`);
      
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
      
      subscribedContracts.clear();
      
      console.log('⏳ 5秒后重连市场行情...');
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

  // ==================== 启动 ====================

  try {
    await client.connect();
    console.log('\n📡 订阅持仓更新...\n');
    
    client.subscribePositions('*');
    console.log('✓ 已订阅：逐仓持仓更新（所有合约）');
    
    client.subscribe('positions_cross.*');
    console.log('✓ 已订阅：全仓持仓更新（所有合约）');

    console.log('⏳ 等待持仓数据加载...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log(`\n📊 持仓检查: ${positions.size} 个持仓`);
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
    
    console.log('💡 持仓监控配置：');
    if (notifier) {
      // 从 UnifiedNotifier 的子通知器中获取配置
      const config = notifier.barkNotifier?.config || notifier.telegramNotifier?.config;
      if (config) {
        console.log(`   盈利通知: ${config.profitThreshold}% 或 ${config.profitAmountThreshold} USDT`);
        console.log(`   亏损通知: ${config.lossThreshold}% 或 ${config.lossAmountThreshold} USDT`);
        console.log(`   定时通知: 每 ${config.timeInterval / 60000} 分钟`);
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
    
    if (marketConfig.priceTargets?.enabled) {
      console.log(`   价格目标监控: ✅ 开启`);
      marketConfig.priceTargets.targets.forEach(t => {
        const directionText = t.direction === 'above' ? '达到' : '跌破';
        console.log(`      - ${t.symbol}: ${directionText} ${t.targetPrice} USDT`);
      });
    }
    console.log('');

  } catch (error) {
    console.error('❌ 启动失败:', error.message);
    process.exit(1);
  }

  process.on('SIGINT', () => {
    console.log('\n\n👋 正在关闭连接...');
    client.close();
    if (marketWs) marketWs.close();
    process.exit(0);
  });
}

main().catch(error => {
  console.error('❌ 程序异常:', error);
  process.exit(1);
});

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { MarketAnalyzer } from './src/services/market-analyzer.js';
import { dataCollector } from './src/services/data-collector.js';
import { redisClient } from './src/config/redis-client.js';
import { createLogger } from './src/utils/logger.js';

dotenv.config();

const logger = createLogger('Web服务');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.WEB_PORT || 3000;

// 初始化市场分析器
const analyzer = new MarketAnalyzer();

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, 'web')));

// 读取配置（从 Redis）
app.get('/api/config', async (req, res) => {
  try {
    let config = await redisClient.getConfig();
    
    if (!config) {
      // 如果 Redis 中没有配置，返回默认配置
      config = {
        watchContracts: ['ETH-USDT'],
        priceChangeConfig: {
          enabled: false,
          timeWindows: [],
          minNotifyInterval: 120000
        },
        priceTargets: {
          enabled: true,
          targets: []
        },
        notificationConfig: {
          profitThreshold: 3,
          lossThreshold: -5,
          profitAmountThreshold: 2,
          lossAmountThreshold: -2,
          timeInterval: 3600000,
          repeatInterval: 5000,
          enableTimeNotification: false,
          enableProfitNotification: true,
          enableLossNotification: false
        },
        quantConfig: {
          enabled: process.env.QUANT_ENABLED === 'true',
          testMode: process.env.QUANT_TEST_MODE !== 'false',
          symbol: process.env.QUANT_SYMBOL || 'BTC-USDT',
          leverage: parseInt(process.env.QUANT_LEVERAGE) || 10,
          initialBalance: parseFloat(process.env.QUANT_INITIAL_BALANCE) || 1000,
          positionSize: parseFloat(process.env.QUANT_POSITION_SIZE) || 0.1,
          stopLoss: parseFloat(process.env.QUANT_STOP_LOSS) || 0.02,
          takeProfit: parseFloat(process.env.QUANT_TAKE_PROFIT) || 0.05,
          trailingStop: parseFloat(process.env.QUANT_TRAILING_STOP) || 0.03,
          maxPositions: parseInt(process.env.QUANT_MAX_POSITIONS) || 1,
          minConfidence: parseInt(process.env.QUANT_MIN_CONFIDENCE) || 60
        }
      };
      
      // 保存默认配置到 Redis
      await redisClient.saveConfig(config);
    }
    
    // 如果配置中没有 quantConfig，添加默认值
    if (!config.quantConfig) {
      config.quantConfig = {
        enabled: process.env.QUANT_ENABLED === 'true',
        testMode: process.env.QUANT_TEST_MODE !== 'false',
        symbol: process.env.QUANT_SYMBOL || 'BTC-USDT',
        leverage: parseInt(process.env.QUANT_LEVERAGE) || 10,
        initialBalance: parseFloat(process.env.QUANT_INITIAL_BALANCE) || 1000,
        positionSize: parseFloat(process.env.QUANT_POSITION_SIZE) || 0.1,
        stopLoss: parseFloat(process.env.QUANT_STOP_LOSS) || 0.02,
        takeProfit: parseFloat(process.env.QUANT_TAKE_PROFIT) || 0.05,
        trailingStop: parseFloat(process.env.QUANT_TRAILING_STOP) || 0.03,
        maxPositions: parseInt(process.env.QUANT_MAX_POSITIONS) || 1,
        minConfidence: parseInt(process.env.QUANT_MIN_CONFIDENCE) || 60
      };
      await redisClient.saveConfig(config);
    }
    
    res.json(config);
  } catch (error) {
    logger.error('读取配置失败:', error);
    res.status(500).json({ error: '读取配置失败', message: error.message });
  }
});

// 保存配置（到 Redis）
app.post('/api/config', async (req, res) => {
  try {
    const success = await redisClient.saveConfig(req.body);
    
    if (success) {
      // 发布配置更新通知（立即通知所有订阅者）
      try {
        const Redis = (await import('ioredis')).default;
        const publisher = new Redis({
          host: process.env.REDIS_HOST || '127.0.0.1',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          db: parseInt(process.env.REDIS_DB || '3'),
          password: process.env.REDIS_PASSWORD || undefined
        });
        
        await publisher.publish('htx:config:update', JSON.stringify({
          timestamp: Date.now(),
          source: 'web-api'
        }));
        
        publisher.disconnect();
        logger.info('✅ 配置已保存并通知更新');
      } catch (error) {
        logger.error('发布配置更新通知失败:', error.message);
      }
      
      res.json({ success: true, message: '配置已保存到 Redis' });
    } else {
      res.status(500).json({ error: '保存配置失败' });
    }
  } catch (error) {
    logger.error('保存配置失败:', error);
    res.status(500).json({ error: '保存配置失败', message: error.message });
  }
});

// 获取监控数据（从 Redis）
app.get('/api/data', async (req, res) => {
  try {
    const data = await dataCollector.getAllData();
    res.json(data);
  } catch (error) {
    logger.error('获取数据失败:', error);
    // 返回空数据
    res.json({
      timestamp: Date.now(),
      positions: [],
      summary: {
        totalPnl: 0,
        todayPnl: 0,
        weekPnl: 0
      }
    });
  }
});

// 获取实时价格数据
app.get('/api/prices', async (req, res) => {
  try {
    const data = await dataCollector.getAllData();
    res.json(data);
  } catch (error) {
    logger.error('获取价格数据失败:', error);
    res.status(500).json({ error: '获取价格数据失败', message: error.message });
  }
});

// 获取指定合约的实时价格
app.get('/api/prices/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    // 重新加载最新数据
    await dataCollector.loadData();
    const priceData = dataCollector.getPrice(symbol);
    const positionData = dataCollector.getPosition(symbol);
    
    if (!priceData) {
      return res.status(404).json({ error: '未找到该合约的价格数据' });
    }
    
    res.json({
      symbol: symbol,
      price: priceData.price,
      timestamp: priceData.timestamp,
      position: positionData || null
    });
  } catch (error) {
    res.status(500).json({ error: '获取价格数据失败', message: error.message });
  }
});

// 获取市场分析报告（自动使用实时价格）
app.get('/api/analysis/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    let { price, cost } = req.query;
    
    // 如果没有提供价格，从实时数据中获取
    if (!price) {
      const priceData = await dataCollector.getPrice(symbol);
      if (priceData) {
        price = priceData.price;
        logger.debug(`使用实时价格: ${price}`);
      } else {
        return res.status(400).json({ 
          error: '未找到实时价格数据',
          message: '请先启动监控程序，或手动输入价格'
        });
      }
    }
    
    const currentPrice = parseFloat(price);
    
    // 如果没有提供成本，尝试从持仓数据中获取
    if (!cost) {
      const positionData = await dataCollector.getPosition(symbol);
      if (positionData && positionData.costPrice) {
        cost = positionData.costPrice;
        logger.debug(`使用持仓成本: ${cost}`);
      }
    }
    
    const costPrice = cost ? parseFloat(cost) : null;
    
    console.log(`📊 生成 ${symbol} 的分析报告 (价格: ${currentPrice}${costPrice ? `, 成本: ${costPrice}` : ''})`);
    
    const report = await analyzer.generateReport(symbol, currentPrice, costPrice);
    
    res.json(report);
  } catch (error) {
    console.error('生成分析报告失败:', error);
    res.status(500).json({ error: '生成分析报告失败', message: error.message });
  }
});

// 获取多时间窗口分析
app.get('/api/analysis/:symbol/timeframe', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { price } = req.query;
    
    if (!price) {
      return res.status(400).json({ error: '缺少 price 参数' });
    }
    
    const currentPrice = parseFloat(price);
    const result = await analyzer.analyzeMultiTimeframe(symbol, currentPrice);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: '分析失败', message: error.message });
  }
});

// 获取价格区间分析
app.get('/api/analysis/:symbol/range', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { price } = req.query;
    
    if (!price) {
      return res.status(400).json({ error: '缺少 price 参数' });
    }
    
    const currentPrice = parseFloat(price);
    const result = await analyzer.analyzePriceRange(symbol, currentPrice);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: '分析失败', message: error.message });
  }
});

// 获取交易建议
app.get('/api/analysis/:symbol/suggestion', async (req, res) => {
  try {
    const { symbol } = req.params;
    const { price } = req.query;
    
    if (!price) {
      return res.status(400).json({ error: '缺少 price 参数' });
    }
    
    const currentPrice = parseFloat(price);
    // 清除缓存，获取最新数据
    const result = await analyzer.generateTradingSuggestion(symbol, currentPrice, null, true);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: '分析失败', message: error.message });
  }
});

// 重置量化交易状态（仅测试模式）
app.post('/api/quant/reset', async (req, res) => {
  try {
    const { symbol } = req.body;
    const quantSymbol = symbol || process.env.QUANT_SYMBOL || 'BTC-USDT';
    const isTestMode = process.env.QUANT_TEST_MODE !== 'false';
    
    // 🔴 实盘模式不允许重置
    if (!isTestMode) {
      logger.error('🔴 实盘模式不允许重置状态！');
      return res.status(403).json({ 
        error: '实盘模式不允许重置',
        message: '为了安全，实盘模式不支持重置功能'
      });
    }
    
    // 1. 删除 Redis 中的测试模式量化交易状态
    const modePrefix = isTestMode ? 'test' : 'live';
    const redisKey = `quant:${modePrefix}:${quantSymbol}`;
    await redisClient.delCache(redisKey);
    
    // 2. 发送重置命令给 realtime-pnl.js 中的 QuantTrader 实例
    await redisClient.setCache(`quant:command:${quantSymbol}`, {
      action: 'reset',
      timestamp: Date.now()
    }, 10); // 10秒后过期
    
    // 3. 清空 dataCollector 中的量化数据（立即更新前端）
    const initialBalance = parseFloat(process.env.QUANT_INITIAL_BALANCE) || 1000;
    const resetData = {
      enabled: true,
      testMode: isTestMode,
      symbol: quantSymbol,
      balance: initialBalance,
      lastPrice: 0,
      positions: [],
      stats: {
        totalTrades: 0,
        winTrades: 0,
        lossTrades: 0,
        totalProfit: 0,
        totalFees: 0,
        maxDrawdown: 0,
        peakBalance: initialBalance
      }
    };
    await dataCollector.updateQuantData(resetData);
    
    logger.info(`✅ 测试模式量化交易状态已重置: ${redisKey}`);
    logger.info(`   已发送重置命令，监控程序将自动重置内存状态`);
    
    res.json({ 
      success: true, 
      message: `测试模式量化交易状态已重置 (${quantSymbol})`,
      redisKey: redisKey,
      note: '✅ 重置命令已发送，监控程序会自动重置（无需重启）'
    });
  } catch (error) {
    logger.error('重置量化交易状态失败:', error);
    res.status(500).json({ error: '重置失败', message: error.message });
  }
});

// 停止量化交易（无持仓时才能停止）
app.post('/api/quant/stop', async (req, res) => {
  try {
    const quantSymbol = process.env.QUANT_SYMBOL || 'BTC-USDT';
    
    // 发送停止命令
    await redisClient.setCache(`quant:command:${quantSymbol}`, {
      action: 'stop',
      timestamp: Date.now()
    }, 10); // 10秒后过期
    
    logger.info(`🛑 已发送停止命令: ${quantSymbol}`);
    
    res.json({ 
      success: true, 
      message: '停止命令已发送，如果有持仓将无法停止'
    });
  } catch (error) {
    logger.error('停止量化交易失败:', error);
    res.status(500).json({ error: '停止失败', message: error.message });
  }
});

// 启动量化交易
app.post('/api/quant/start', async (req, res) => {
  try {
    const quantSymbol = process.env.QUANT_SYMBOL || 'BTC-USDT';
    
    // 发送启动命令
    await redisClient.setCache(`quant:command:${quantSymbol}`, {
      action: 'start',
      timestamp: Date.now()
    }, 10); // 10秒后过期
    
    logger.info(`🚀 已发送启动命令: ${quantSymbol}`);
    
    res.json({ 
      success: true, 
      message: '启动命令已发送'
    });
  } catch (error) {
    logger.error('启动量化交易失败:', error);
    res.status(500).json({ error: '启动失败', message: error.message });
  }
});

// 获取历史订单
app.get('/api/quant/history', async (req, res) => {
  try {
    const { symbol, mode } = req.query;
    const quantSymbol = symbol || process.env.QUANT_SYMBOL || 'BTC-USDT';
    const isTestMode = mode ? (mode === 'test') : (process.env.QUANT_TEST_MODE !== 'false');
    
    const modePrefix = isTestMode ? 'test' : 'live';
    const historyKey = `quant:history:${modePrefix}:${quantSymbol}`;
    
    const history = await redisClient.getCache(historyKey);
    
    res.json({ 
      success: true, 
      data: history || [],
      symbol: quantSymbol,
      mode: modePrefix
    });
  } catch (error) {
    logger.error('获取历史订单失败:', error);
    res.status(500).json({ error: '获取失败', message: error.message });
  }
});

// 启动服务器
server.listen(PORT, () => {
  logger.info(`\n🌐 Web 配置界面已启动`);
  logger.info(`📱 访问地址: http://localhost:${PORT}`);
  logger.info(`📱 局域网访问: http://你的IP:${PORT}`);
  logger.info(`🔌 WebSocket: ws://localhost:${PORT}\n`);
});

// WebSocket 连接处理
wss.on('connection', (ws) => {
  logger.debug('新的 WebSocket 客户端连接');

  // 发送初始数据
  const sendData = async () => {
    try {
      const data = await dataCollector.getAllData();
      ws.send(JSON.stringify({
        type: 'update',
        data: data
      }));
    } catch (error) {
      logger.error('发送数据失败:', error.message);
    }
  };

  // 立即发送一次
  sendData();

  // 每秒推送最新数据
  const interval = setInterval(sendData, 1000);

  ws.on('close', () => {
    logger.debug('WebSocket 客户端断开');
    clearInterval(interval);
  });

  ws.on('error', (error) => {
    logger.error('WebSocket 错误:', error.message);
    clearInterval(interval);
  });
});

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { MarketAnalyzer } from './src/services/market-analyzer.js';
import { dataCollector } from './src/services/data-collector.js';
import { redisClient } from './src/config/redis-client.js';

dotenv.config();

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
        }
      };
      
      // 保存默认配置到 Redis
      await redisClient.saveConfig(config);
    }
    
    res.json(config);
  } catch (error) {
    console.error('读取配置失败:', error);
    res.status(500).json({ error: '读取配置失败', message: error.message });
  }
});

// 保存配置（到 Redis）
app.post('/api/config', async (req, res) => {
  try {
    const success = await redisClient.saveConfig(req.body);
    
    if (success) {
      res.json({ success: true, message: '配置已保存到 Redis' });
    } else {
      res.status(500).json({ error: '保存配置失败' });
    }
  } catch (error) {
    console.error('保存配置失败:', error);
    res.status(500).json({ error: '保存配置失败', message: error.message });
  }
});

// 获取监控数据（从 Redis）
app.get('/api/data', async (req, res) => {
  try {
    const data = await dataCollector.getAllData();
    res.json(data);
  } catch (error) {
    console.error('获取数据失败:', error);
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
    console.error('获取价格数据失败:', error);
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
        console.log(`📊 使用实时价格: ${price}`);
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
        console.log(`📊 使用持仓成本: ${cost}`);
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

// 启动服务器
server.listen(PORT, () => {
  console.log(`\n🌐 Web 配置界面已启动`);
  console.log(`📱 访问地址: http://localhost:${PORT}`);
  console.log(`📱 局域网访问: http://你的IP:${PORT}`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}\n`);
});

// WebSocket 连接处理
wss.on('connection', (ws) => {
  console.log('📱 新的 WebSocket 客户端连接');

  // 发送初始数据
  const sendData = async () => {
    try {
      const data = await dataCollector.getAllData();
      ws.send(JSON.stringify({
        type: 'update',
        data: data
      }));
    } catch (error) {
      console.error('发送数据失败:', error.message);
    }
  };

  // 立即发送一次
  sendData();

  // 每秒推送最新数据
  const interval = setInterval(sendData, 1000);

  ws.on('close', () => {
    console.log('📱 WebSocket 客户端断开');
    clearInterval(interval);
  });

  ws.on('error', (error) => {
    console.error('WebSocket 错误:', error.message);
    clearInterval(interval);
  });
});

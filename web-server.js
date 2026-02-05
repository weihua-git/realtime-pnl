import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { MarketAnalyzer } from './market-analyzer.js';
import { dataCollector } from './data-collector.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.WEB_PORT || 3000;
const CONFIG_FILE = path.join(__dirname, 'data', 'config.json');

// 初始化市场分析器
const analyzer = new MarketAnalyzer();

// 加载实时数据
await dataCollector.loadData();

// 中间件
app.use(express.json());
app.use(express.static(path.join(__dirname, 'web')));

// 确保 data 目录存在
async function ensureDataDir() {
  const dataDir = path.join(__dirname, 'data');
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
}

// 读取配置
app.get('/api/config', async (req, res) => {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf-8');
    res.json(JSON.parse(data));
  } catch (error) {
    if (error.code === 'ENOENT') {
      // 如果文件不存在，返回默认配置
      const defaultConfig = {
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
      res.json(defaultConfig);
    } else {
      res.status(500).json({ error: '读取配置失败', message: error.message });
    }
  }
});

// 保存配置
app.post('/api/config', async (req, res) => {
  try {
    await ensureDataDir();
    await fs.writeFile(CONFIG_FILE, JSON.stringify(req.body, null, 2), 'utf-8');
    res.json({ success: true, message: '配置已保存' });
  } catch (error) {
    res.status(500).json({ error: '保存配置失败', message: error.message });
  }
});

// 获取监控数据（占位接口）
app.get('/api/data', async (req, res) => {
  try {
    const dataFile = path.join(__dirname, 'data', 'monitor-data.json');
    try {
      const data = await fs.readFile(dataFile, 'utf-8');
      res.json(JSON.parse(data));
    } catch {
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
  } catch (error) {
    res.status(500).json({ error: '读取数据失败', message: error.message });
  }
});

// 获取实时价格数据
app.get('/api/prices', async (req, res) => {
  try {
    // 重新加载最新数据
    await dataCollector.loadData();
    const data = dataCollector.getAllData();
    res.json(data);
  } catch (error) {
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
      // 重新加载最新数据
      await dataCollector.loadData();
      const priceData = dataCollector.getPrice(symbol);
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
      const positionData = dataCollector.getPosition(symbol);
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
    const result = await analyzer.generateTradingSuggestion(symbol, currentPrice);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: '分析失败', message: error.message });
  }
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`\n🌐 Web 配置界面已启动`);
  console.log(`📱 访问地址: http://localhost:${PORT}`);
  console.log(`📱 局域网访问: http://你的IP:${PORT}\n`);
});

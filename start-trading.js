import dotenv from 'dotenv';
import { TradingEngine } from './trading-engine.js';

// 加载环境变量
dotenv.config();

/**
 * 启动量化交易
 */
async function main() {
  // 配置参数
  const config = {
    // API 密钥
    accessKey: process.env.HTX_ACCESS_KEY,
    secretKey: process.env.HTX_SECRET_KEY,

    // ========== 重要：测试/实盘模式切换 ==========
    testMode: true, // true = 测试模式（模拟交易），false = 实盘模式（真实交易）
    
    // 交易参数
    symbol: 'ETH-USDT', // 交易对
    leverage: 5, // 杠杆倍数
    
    // 测试模式参数
    initialBalance: 100, // 测试模式初始资金（USDT）
    
    // 仓位管理
    positionSize: 0.1, // 每次开仓使用账户余额的 10%
    maxPositions: 1, // 最大同时持仓数
    
    // 风险控制
    stopLoss: 0.02, // 止损 2%
    takeProfit: 0.05, // 止盈 5%
    trailingStop: 0.03, // 移动止损 3%（从最高点回撤 3% 平仓）
    
    // 检查间隔
    checkInterval: 3000, // 每 3 秒检查一次（3000 毫秒）
  };

  // 验证配置
  if (!config.accessKey || !config.secretKey) {
    console.error('❌ 错误: 请在 .env 文件中配置 HTX_ACCESS_KEY 和 HTX_SECRET_KEY');
    process.exit(1);
  }

  // 创建交易引擎
  const engine = new TradingEngine(config);

  // 启动引擎
  await engine.start();

  // 监听退出信号
  process.on('SIGINT', () => {
    console.log('\n\n收到退出信号...');
    engine.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n\n收到终止信号...');
    engine.stop();
    process.exit(0);
  });
}

// 运行
main().catch(error => {
  console.error('❌ 启动失败:', error);
  process.exit(1);
});

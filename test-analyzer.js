import { MarketAnalyzer } from './market-analyzer.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * 测试市场分析器
 */
async function testAnalyzer() {
  // 使用 API Key 初始化（避免 IP 限制）
  const analyzer = new MarketAnalyzer(
    process.env.HTX_ACCESS_KEY,
    process.env.HTX_SECRET_KEY
  );

  // 测试合约
  const symbol = 'ETH-USDT';
  
  // 模拟当前价格（实际使用时从 WebSocket 获取）
  const currentPrice = 2150;
  
  // 模拟持仓成本（可选）
  const costPrice = 2100;

  console.log('🚀 开始测试市场分析器...');
  console.log(`📡 使用 API Key: ${process.env.HTX_ACCESS_KEY ? '✅ 已配置' : '❌ 未配置（将使用公开接口）'}\n`);

  try {
    // 生成综合分析报告
    const report = await analyzer.generateReport(symbol, currentPrice, costPrice);
    
    // 打印报告
    analyzer.printReport(report);

    console.log('✅ 所有测试完成！\n');

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    console.error(error.stack);
  }
}

// 运行测试
testAnalyzer();

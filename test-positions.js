import dotenv from 'dotenv';
import { HTXFuturesClient } from './client.js';

dotenv.config();

const ACCESS_KEY = process.env.HTX_ACCESS_KEY;
const SECRET_KEY = process.env.HTX_SECRET_KEY;
const WS_URL = process.env.WS_URL || 'wss://api.hbdm.com/linear-swap-notification';

/**
 * 测试持仓监听机制
 * 
 * 这个脚本用于演示和测试 HTX 持仓推送的行为
 */
async function main() {
  if (!ACCESS_KEY || !SECRET_KEY) {
    console.error('❌ 请先配置 HTX_ACCESS_KEY 和 HTX_SECRET_KEY');
    process.exit(1);
  }

  console.log('🧪 测试持仓监听机制\n');
  console.log('=' .repeat(60));
  console.log('📚 知识点：HTX 持仓推送机制');
  console.log('=' .repeat(60));
  console.log('');
  console.log('✅ 会触发推送的情况：');
  console.log('   - 开仓（新建持仓）');
  console.log('   - 平仓（减少持仓）');
  console.log('   - 调整保证金');
  console.log('   - 强平');
  console.log('');
  console.log('❌ 不会触发推送的情况：');
  console.log('   - 价格变化（即使盈亏在变）');
  console.log('   - 持仓量不变');
  console.log('   - 只是查看持仓');
  console.log('');
  console.log('💡 解决方案：');
  console.log('   - 使用 realtime-pnl.js 脚本');
  console.log('   - 订阅市场行情 + 自己计算盈亏');
  console.log('');
  console.log('=' .repeat(60));
  console.log('');

  const client = new HTXFuturesClient(ACCESS_KEY, SECRET_KEY, WS_URL);

  let positionUpdateCount = 0;

  // 监听持仓更新
  client.on('positions', (data) => {
    positionUpdateCount++;
    const timestamp = new Date().toLocaleTimeString('zh-CN');
    
    console.log(`\n[${timestamp}] 🎯 收到第 ${positionUpdateCount} 次持仓推送`);
    console.log('━'.repeat(60));
    
    if (Array.isArray(data) && data.length > 0) {
      data.forEach((position, index) => {
        console.log(`\n持仓 #${index + 1}:`);
        console.log(`  合约: ${position.contract_code}`);
        console.log(`  方向: ${position.direction === 'buy' ? '多仓 📈' : '空仓 📉'}`);
        console.log(`  持仓量: ${position.volume}`);
        console.log(`  可平量: ${position.available}`);
        console.log(`  开仓均价: ${position.cost_open}`);
        console.log(`  持仓保证金: ${position.position_margin}`);
        console.log(`  未实现盈亏: ${position.profit_unreal}`);
        console.log(`  收益率: ${position.profit_rate}%`);
      });
    } else {
      console.log('  持仓已清空或无持仓');
    }
    
    console.log('\n━'.repeat(60));
  });

  try {
    await client.connect();
    
    console.log('📡 订阅持仓更新...\n');
    client.subscribePositions('*');
    
    console.log('✅ 监听已启动');
    console.log('');
    console.log('🔍 现在请观察：');
    console.log('   1. 如果你有持仓，会立即收到一次推送');
    console.log('   2. 之后只有在你进行交易操作时才会推送');
    console.log('   3. 价格变化不会触发推送');
    console.log('');
    console.log('🧪 测试建议：');
    console.log('   - 在 HTX 平台开一个小仓位');
    console.log('   - 观察是否收到推送');
    console.log('   - 等待价格变化，观察是否有新推送（不会有）');
    console.log('   - 平仓或调整仓位，观察是否收到推送（会有）');
    console.log('');
    console.log('⏳ 等待持仓变化...\n');

    // 每 30 秒提醒一次
    setInterval(() => {
      const now = new Date().toLocaleTimeString('zh-CN');
      console.log(`[${now}] ⏰ 仍在监听中... (共收到 ${positionUpdateCount} 次推送)`);
      
      if (positionUpdateCount === 0) {
        console.log('   💡 提示：如果一直没有推送，说明持仓没有变化');
        console.log('   💡 尝试在 HTX 平台进行交易操作来触发推送');
      }
    }, 30000);

  } catch (error) {
    console.error('❌ 启动失败:', error.message);
    process.exit(1);
  }

  process.on('SIGINT', () => {
    console.log('\n\n📊 测试总结：');
    console.log(`   - 总共收到 ${positionUpdateCount} 次持仓推送`);
    console.log('   - 如果需要实时盈亏监控，请使用 realtime-pnl.js');
    console.log('\n👋 再见！');
    client.close();
    process.exit(0);
  });
}

main().catch(error => {
  console.error('❌ 程序异常:', error);
  process.exit(1);
});

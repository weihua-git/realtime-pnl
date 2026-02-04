import dotenv from 'dotenv';
import { BarkNotifier } from './bark-notifier.js';

// 加载环境变量
dotenv.config();

/**
 * 测试 Bark 通知功能
 */
async function testBark() {
  console.log('🧪 开始测试 Bark 通知...\n');
  
  // 检查配置
  const barkKey = process.env.BARK_KEY;
  
  if (!barkKey) {
    console.error('❌ 错误: 未配置 BARK_KEY');
    console.log('\n📋 配置步骤:');
    console.log('1. 在 App Store 下载 "Bark" 应用');
    console.log('2. 打开 Bark，复制你的推送 Key');
    console.log('3. 在 .env 文件中添加: BARK_KEY=你的Key');
    process.exit(1);
  }
  
  console.log('✅ Bark Key 已配置\n');
  
  // 创建通知器
  const notifier = new BarkNotifier(barkKey, {
    profitThreshold: 3,
    lossThreshold: -5,
    sound: 'bell',
    group: 'HTX交易测试'
  });
  
  // 测试 1: 基础通知
  console.log('📤 测试 1: 发送基础通知...');
  await notifier.testNotification();
  await sleep(2000);
  
  // 测试 2: 盈利通知
  console.log('📤 测试 2: 发送盈利通知...');
  const profitPosition = {
    contractCode: 'BTC-USDT',
    direction: 'buy',
    volume: 10,
    actualPosition: 0.001,
    positionValue: 1000,
    positionMargin: 100,
    lastPrice: 45000,
    costOpen: 43000,
    profitUnreal: 20,
    profitRate: 5.5
  };
  await notifier.notifyPositionPnL(profitPosition);
  await sleep(2000);
  
  // 测试 3: 亏损通知
  console.log('📤 测试 3: 发送亏损通知...');
  const lossPosition = {
    contractCode: 'ETH-USDT',
    direction: 'sell',
    volume: 20,
    actualPosition: 0.02,
    positionValue: 2000,
    positionMargin: 200,
    lastPrice: 2500,
    costOpen: 2400,
    profitUnreal: -15,
    profitRate: -7.5
  };
  await notifier.notifyPositionPnL(lossPosition);
  await sleep(2000);
  
  // 测试 4: 汇总通知
  console.log('📤 测试 4: 发送汇总通知...');
  const positions = [profitPosition, lossPosition];
  // 强制触发定时通知
  notifier.lastTimeNotification = 0;
  await notifier.notifyTimeSummary(positions);
  await sleep(2000);
  
  // 测试 5: 自定义通知（不同音效）
  console.log('📤 测试 5: 发送自定义音效通知...');
  await notifier.notify(
    '🎵 音效测试',
    '这是一个使用 alarm 音效的紧急通知',
    { sound: 'alarm', level: 'timeSensitive' }
  );
  
  console.log('\n✅ 所有测试完成！');
  console.log('📱 请检查你的 iPhone 是否收到了 5 条 Bark 通知');
  console.log('\n💡 提示:');
  console.log('- 如果没收到，检查 Bark Key 是否正确');
  console.log('- 确保 iPhone 联网且 Bark 应用已安装');
  console.log('- 检查 iPhone 通知设置是否允许 Bark 推送');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 运行测试
testBark().catch(error => {
  console.error('❌ 测试失败:', error);
  process.exit(1);
});

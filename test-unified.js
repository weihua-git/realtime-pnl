import dotenv from 'dotenv';
import { UnifiedNotifier } from './unified-notifier.js';

// 加载环境变量
dotenv.config();

/**
 * 测试统一通知器（Telegram + Bark）
 */
async function testUnifiedNotifier() {
  console.log('🧪 开始测试统一通知系统...\n');
  
  // 配置检查
  const hasTelegram = process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID;
  const hasBark = process.env.BARK_KEY;
  
  console.log('📋 配置状态:');
  console.log(`  Telegram: ${hasTelegram ? '✅ 已配置' : '❌ 未配置'}`);
  console.log(`  Bark: ${hasBark ? '✅ 已配置' : '❌ 未配置'}`);
  console.log('');
  
  if (!hasTelegram && !hasBark) {
    console.error('❌ 错误: 至少需要配置一种通知方式');
    console.log('\n📋 Bark 配置步骤（推荐）:');
    console.log('1. 在 App Store 下载 "Bark" 应用');
    console.log('2. 打开 Bark，复制你的推送 Key');
    console.log('3. 在 .env 文件中添加: BARK_KEY=你的Key');
    process.exit(1);
  }
  
  // 创建统一通知器
  const notifier = new UnifiedNotifier({
    telegram: hasTelegram ? {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID
    } : null,
    bark: hasBark ? {
      key: process.env.BARK_KEY,
      server: process.env.BARK_SERVER || 'https://api.day.app',
      sound: 'bell',
      group: 'HTX交易'
    } : null,
    notificationConfig: {
      profitThreshold: 3,
      lossThreshold: -5,
      timeInterval: 3600000,
      repeatInterval: 300000
    }
  });
  
  if (!notifier.hasNotifiers()) {
    console.error('❌ 通知器初始化失败');
    process.exit(1);
  }
  
  console.log(`\n📢 已启用通知渠道: ${notifier.getEnabledNotifiers().join(', ')}\n`);
  
  // 测试基础通知
  console.log('📤 发送测试通知...');
  await notifier.testNotification();
  await sleep(3000);
  
  // 测试盈利通知
  console.log('📤 发送盈利通知...');
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
  await sleep(3000);
  
  // 测试亏损通知
  console.log('📤 发送亏损通知...');
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
  await sleep(3000);
  
  console.log('\n✅ 测试完成！');
  console.log(`📱 请检查你的设备是否收到了来自 ${notifier.getEnabledNotifiers().join(' 和 ')} 的通知`);
  
  // 显示通知历史
  const history = notifier.getAllNotificationHistory();
  console.log('\n📊 通知历史:');
  Object.entries(history).forEach(([name, records]) => {
    console.log(`\n  ${name}: ${records.length} 条记录`);
    records.forEach(record => {
      console.log(`    - ${record.type} | ${new Date(record.time).toLocaleString('zh-CN')}`);
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 运行测试
testUnifiedNotifier().catch(error => {
  console.error('❌ 测试失败:', error);
  process.exit(1);
});

import dotenv from 'dotenv';
import { UnifiedNotifier } from './unified-notifier.js';

dotenv.config();

async function quickTest() {
  console.log('🧪 快速测试统一通知器...\n');
  
  const notifier = new UnifiedNotifier({
    telegram: process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID ? {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID
    } : null,
    bark: process.env.BARK_KEY ? {
      key: process.env.BARK_KEY,
      server: process.env.BARK_SERVER || 'https://api.day.app',
      sound: 'bell',
      group: 'HTX交易'
    } : null,
    notificationConfig: {
      profitThreshold: 3,
      lossThreshold: -5,
      profitAmountThreshold: 2,
      lossAmountThreshold: -2,
      timeInterval: 3600000,
      repeatInterval: 5000
    }
  });
  
  if (!notifier.hasNotifiers()) {
    console.error('❌ 未配置任何通知方式');
    process.exit(1);
  }
  
  console.log(`✅ 已启用: ${notifier.getEnabledNotifiers().join(', ')}\n`);
  
  // 测试配置访问
  const config = notifier.barkNotifier?.config || notifier.telegramNotifier?.config;
  if (config) {
    console.log('📋 配置信息:');
    console.log(`   盈利阈值: ${config.profitThreshold}%`);
    console.log(`   亏损阈值: ${config.lossThreshold}%`);
    console.log(`   盈利金额: ${config.profitAmountThreshold} USDT`);
    console.log(`   亏损金额: ${config.lossAmountThreshold} USDT`);
  }
  
  console.log('\n✅ 配置测试成功！');
  process.exit(0);
}

quickTest().catch(error => {
  console.error('❌ 测试失败:', error.message);
  process.exit(1);
});

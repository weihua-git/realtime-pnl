import dotenv from 'dotenv';
import { TelegramNotifier } from './telegram-notifier.js';

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/**
 * 测试 Telegram 通知功能
 */
async function main() {
  console.log('🧪 Telegram 通知功能测试\n');
  console.log('=' .repeat(60));

  // 检查配置
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('❌ 请先配置 TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID');
    console.log('\n💡 配置步骤：');
    console.log('1. 复制 config.example.env 为 .env');
    console.log('2. 在 Telegram 中找 @BotFather 创建机器人');
    console.log('3. 获取 Bot Token');
    console.log('4. 在 Telegram 中找 @userinfobot 获取 Chat ID');
    console.log('5. 将 Token 和 Chat ID 填入 .env 文件');
    console.log('\n详细说明请查看：Telegram配置指南.md\n');
    process.exit(1);
  }

  console.log('✅ 配置检查通过');
  console.log(`Bot Token: ${TELEGRAM_BOT_TOKEN.substring(0, 10)}...`);
  console.log(`Chat ID: ${TELEGRAM_CHAT_ID}`);
  console.log('=' .repeat(60));
  console.log('');

  // 创建通知器
  const notifier = new TelegramNotifier(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, {
    profitThreshold: 3,
    lossThreshold: -5,
    timeInterval: 3600000,
    repeatInterval: 300000,
  });

  // 测试 1：基础通知测试
  console.log('📝 测试 1：发送基础测试通知...');
  const test1 = await notifier.testNotification();
  if (test1) {
    console.log('✅ 基础通知测试成功\n');
  } else {
    console.error('❌ 基础通知测试失败\n');
    process.exit(1);
  }

  await sleep(2000);

  // 测试 2：盈利通知测试
  console.log('📝 测试 2：发送盈利通知...');
  const profitData = {
    contractCode: 'ETH-USDT',
    direction: 'sell',
    volume: 21,
    actualPosition: 0.21,
    positionValue: 479.22,
    positionMargin: 47.93,
    lastPrice: 2282.00,
    costOpen: 2273.76,
    profitUnreal: 1.7304,
    profitRate: 3.61
  };
  
  const test2 = await notifier.notifyPositionPnL(profitData);
  if (test2) {
    console.log('✅ 盈利通知测试成功\n');
  } else {
    console.log('⚠️ 盈利通知未发送（可能未达到阈值）\n');
  }

  await sleep(2000);

  // 测试 3：亏损通知测试
  console.log('📝 测试 3：发送亏损通知...');
  const lossData = {
    contractCode: 'BTC-USDT',
    direction: 'buy',
    volume: 10,
    actualPosition: 0.01,
    positionValue: 1050.00,
    positionMargin: 105.00,
    lastPrice: 105000,
    costOpen: 110000,
    profitUnreal: -50.00,
    profitRate: -47.62
  };
  
  const test3 = await notifier.notifyPositionPnL(lossData);
  if (test3) {
    console.log('✅ 亏损通知测试成功\n');
  } else {
    console.log('⚠️ 亏损通知未发送（可能未达到阈值）\n');
  }

  await sleep(2000);

  // 测试 4：定时汇总通知测试
  console.log('📝 测试 4：发送定时汇总通知...');
  const positions = [
    {
      contractCode: 'ETH-USDT',
      direction: 'sell',
      profitUnreal: 1.73,
      profitRate: 3.61,
      positionMargin: 47.93,
      positionValue: 479.22
    },
    {
      contractCode: 'BTC-USDT',
      direction: 'buy',
      profitUnreal: -2.50,
      profitRate: -2.38,
      positionMargin: 105.00,
      positionValue: 1050.00
    }
  ];
  
  // 强制发送定时通知（重置时间）
  notifier.lastTimeNotification = 0;
  const test4 = await notifier.notifyTimeSummary(positions);
  if (test4) {
    console.log('✅ 定时汇总通知测试成功\n');
  } else {
    console.log('⚠️ 定时汇总通知未发送\n');
  }

  await sleep(2000);

  // 测试 5：自定义消息测试
  console.log('📝 测试 5：发送自定义消息...');
  const customMessage = `
🎯 *自定义消息测试*

这是一条自定义消息，支持 Markdown 格式：

✅ *粗体文本*
✅ _斜体文本_
✅ \`代码文本\`
✅ [链接](https://www.htx.com)

⏰ ${new Date().toLocaleString('zh-CN')}
`.trim();
  
  const test5 = await notifier.notify(customMessage);
  if (test5) {
    console.log('✅ 自定义消息测试成功\n');
  } else {
    console.error('❌ 自定义消息测试失败\n');
  }

  // 显示通知历史
  console.log('=' .repeat(60));
  console.log('📊 通知历史记录：');
  const history = notifier.getNotificationHistory();
  if (history.length > 0) {
    history.forEach((item, index) => {
      const time = new Date(item.time).toLocaleTimeString('zh-CN');
      console.log(`${index + 1}. [${time}] ${item.type} - ${item.contractCode || '汇总'}`);
    });
  } else {
    console.log('暂无历史记录');
  }
  console.log('=' .repeat(60));

  console.log('\n✅ 所有测试完成！');
  console.log('\n💡 提示：');
  console.log('   - 请检查 Telegram 是否收到了测试消息');
  console.log('   - 如果没有收到，请检查 Bot Token 和 Chat ID 是否正确');
  console.log('   - 确保已经给机器人发送过消息（点击 Start）');
  console.log('\n📖 详细配置说明请查看：Telegram配置指南.md\n');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(error => {
  console.error('❌ 测试失败:', error.message);
  process.exit(1);
});

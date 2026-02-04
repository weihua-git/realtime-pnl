import dotenv from 'dotenv';
import { BarkNotifier } from './bark-notifier.js';

dotenv.config();

/**
 * 测试不同场景的音效
 */
async function testSounds() {
  console.log('🎵 测试 Bark 音效配置...\n');
  
  const barkKey = process.env.BARK_KEY;
  
  if (!barkKey) {
    console.error('❌ 未配置 BARK_KEY');
    process.exit(1);
  }
  
  const notifier = new BarkNotifier(barkKey, {
    profitThreshold: 3,
    lossThreshold: -5,
    sound: 'bell',
    group: 'HTX音效测试'
  });
  
  console.log('📱 将发送 3 条测试通知，请注意音效差异：\n');
  
  // 测试 1: 盈利通知（paymentsuccess 音效）
  console.log('1️⃣ 盈利通知 - 音效: paymentsuccess（支付成功）');
  await notifier.notify(
    '🎉 盈利通知测试',
    '这是盈利通知，使用欢快的支付成功音效',
    { sound: 'paymentsuccess', level: 'active' }
  );
  await sleep(3000);
  
  // 测试 2: 亏损通知（alarm 音效）
  console.log('2️⃣ 亏损通知 - 音效: alarm（警报）');
  await notifier.notify(
    '⚠️ 亏损通知测试',
    '这是亏损通知，使用警报音效',
    { sound: 'alarm', level: 'active' }
  );
  await sleep(3000);
  
  // 测试 3: 行情推送（无音效）
  console.log('3️⃣ 行情推送 - 无音效（静默）');
  await notifier.notify(
    '📊 行情推送测试',
    '这是行情推送，静默通知，不会发出声音',
    { sound: '', level: 'passive' }
  );
  
  console.log('\n✅ 测试完成！');
  console.log('\n📋 音效说明：');
  console.log('   盈利通知: paymentsuccess（欢快）');
  console.log('   亏损通知: alarm（警报）');
  console.log('   行情推送: 无音效（静默）');
  console.log('\n💡 如果想修改音效，可以编辑 bark-notifier.js');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

testSounds().catch(error => {
  console.error('❌ 测试失败:', error);
  process.exit(1);
});

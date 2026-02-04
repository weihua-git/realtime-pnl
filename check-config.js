import dotenv from 'dotenv';
import { existsSync } from 'fs';

/**
 * 检查项目配置是否完整
 */
export default async function checkConfig() {
  console.log('🔍 检查项目配置...\n');
  
  let hasErrors = false;
  let hasWarnings = false;
  
  // 1. 检查 .env 文件
  if (!existsSync('.env')) {
    console.error('❌ 错误: 未找到 .env 文件');
    console.log('   请运行: cp config.example.env .env');
    hasErrors = true;
  } else {
    console.log('✅ .env 文件存在');
  }
  
  // 2. 加载环境变量
  dotenv.config();
  
  // 3. 检查必需的配置
  console.log('\n📋 检查必需配置:');
  
  if (!process.env.HTX_ACCESS_KEY) {
    console.error('   ❌ HTX_ACCESS_KEY 未配置');
    hasErrors = true;
  } else {
    console.log('   ✅ HTX_ACCESS_KEY 已配置');
  }
  
  if (!process.env.HTX_SECRET_KEY) {
    console.error('   ❌ HTX_SECRET_KEY 未配置');
    hasErrors = true;
  } else {
    console.log('   ✅ HTX_SECRET_KEY 已配置');
  }
  
  // 4. 检查可选的通知配置
  console.log('\n📱 检查通知配置:');
  
  const hasTelegram = process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID;
  const hasBark = process.env.BARK_KEY;
  
  if (hasBark) {
    console.log('   ✅ Bark 已配置');
  } else {
    console.log('   ⚠️  Bark 未配置（可选）');
    hasWarnings = true;
  }
  
  if (hasTelegram) {
    console.log('   ✅ Telegram 已配置');
  } else {
    console.log('   ⚠️  Telegram 未配置（可选）');
    hasWarnings = true;
  }
  
  if (!hasBark && !hasTelegram) {
    console.log('   ⚠️  未配置任何通知方式，将只显示控制台输出');
  }
  
  // 5. 检查关键文件
  console.log('\n📁 检查关键文件:');
  
  const requiredFiles = [
    'client.js',
    'auth.js',
    'realtime-pnl.js',
    'bark-notifier.js',
    'telegram-notifier.js',
    'unified-notifier.js',
    'market-config.js'
  ];
  
  for (const file of requiredFiles) {
    if (existsSync(file)) {
      console.log(`   ✅ ${file}`);
    } else {
      console.error(`   ❌ ${file} 缺失`);
      hasErrors = true;
    }
  }
  
  // 6. 检查依赖
  console.log('\n📦 检查依赖:');
  
  try {
    await import('axios');
    console.log('   ✅ axios');
  } catch {
    console.error('   ❌ axios 未安装');
    hasErrors = true;
  }
  
  try {
    await import('ws');
    console.log('   ✅ ws');
  } catch {
    console.error('   ❌ ws 未安装');
    hasErrors = true;
  }
  
  try {
    await import('pako');
    console.log('   ✅ pako');
  } catch {
    console.error('   ❌ pako 未安装');
    hasErrors = true;
  }
  
  try {
    await import('dotenv');
    console.log('   ✅ dotenv');
  } catch {
    console.error('   ❌ dotenv 未安装');
    hasErrors = true;
  }
  
  // 7. 总结
  console.log('\n' + '='.repeat(50));
  
  if (hasErrors) {
    console.error('\n❌ 配置检查失败，请修复上述错误');
    throw new Error('配置检查失败');
  } else if (hasWarnings) {
    console.log('\n⚠️  配置检查通过，但有警告');
    console.log('💡 建议配置 Bark 或 Telegram 以启用通知功能');
  } else {
    console.log('\n✅ 配置检查通过，所有配置完整');
  }
  
  console.log('\n📚 快速开始:');
  console.log('   npm start          - 启动监控');
  console.log('   npm run test       - 测试所有通知');
  console.log('   npm run test:bark  - 测试 Bark 通知');
  console.log('');
}

// 如果直接运行此文件
if (import.meta.url === `file://${process.argv[1]}`) {
  checkConfig().catch(error => {
    console.error('\n❌ 检查失败:', error.message);
    process.exit(1);
  });
}

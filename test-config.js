import { marketConfig, configManager } from './market-config.js';

console.log('📋 测试配置加载...\n');

console.log('当前配置:');
console.log(JSON.stringify(marketConfig, null, 2));

console.log('\n✅ 配置加载成功！');
console.log('\n监听配置变化（修改 data/config.json 测试热重载）...\n');

configManager.on('configChanged', (newConfig) => {
  console.log('🔄 检测到配置变化！');
  console.log('新配置:');
  console.log(JSON.stringify(newConfig, null, 2));
});

configManager.startWatching();

// 保持进程运行
process.on('SIGINT', () => {
  console.log('\n\n👋 停止测试');
  configManager.stopWatching();
  process.exit(0);
});

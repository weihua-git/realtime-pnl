import axios from 'axios';

const API_URL = 'http://localhost:3000/api';

console.log('🧪 测试 Web 配置 API...\n');

async function testAPI() {
  try {
    // 测试读取配置
    console.log('1️⃣ 测试读取配置...');
    const getResponse = await axios.get(`${API_URL}/config`);
    console.log('✅ 读取成功');
    console.log('当前配置:', JSON.stringify(getResponse.data, null, 2));
    
    // 测试修改配置
    console.log('\n2️⃣ 测试修改配置...');
    const newConfig = {
      ...getResponse.data,
      priceTargets: {
        enabled: true,
        targets: [
          {
            symbol: 'ETH-USDT',
            targetPrice: 2300, // 修改为 2300
            direction: 'above',
            notified: false
          }
        ]
      }
    };
    
    const postResponse = await axios.post(`${API_URL}/config`, newConfig);
    console.log('✅ 保存成功:', postResponse.data.message);
    
    // 验证修改
    console.log('\n3️⃣ 验证修改...');
    const verifyResponse = await axios.get(`${API_URL}/config`);
    const targetPrice = verifyResponse.data.priceTargets.targets[0].targetPrice;
    
    if (targetPrice === 2300) {
      console.log('✅ 配置已更新: ETH-USDT 目标价 = 2300');
    } else {
      console.log('❌ 配置未更新');
    }
    
    console.log('\n✅ 所有测试通过！');
    
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.error('❌ 无法连接到 Web 服务器');
      console.error('💡 请先运行: npm run web');
    } else {
      console.error('❌ 测试失败:', error.message);
    }
  }
}

testAPI();

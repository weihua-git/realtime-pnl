/**
 * 测试 Web API 端点
 */

import axios from 'axios';

const BASE_URL = 'http://localhost:3000';

async function testAPI() {
  console.log('🧪 开始测试 Web API...\n');

  try {
    // 1. 测试获取实时价格
    console.log('1️⃣ 测试获取实时价格...');
    const pricesRes = await axios.get(`${BASE_URL}/api/prices`);
    console.log('✅ 实时价格数据:', JSON.stringify(pricesRes.data, null, 2));

    // 2. 测试获取指定合约价格
    console.log('\n2️⃣ 测试获取 ETH-USDT 价格...');
    const ethPriceRes = await axios.get(`${BASE_URL}/api/prices/ETH-USDT`);
    console.log('✅ ETH-USDT 价格:', JSON.stringify(ethPriceRes.data, null, 2));

    // 3. 测试市场分析（自动获取价格）
    console.log('\n3️⃣ 测试市场分析（自动获取价格）...');
    const analysisRes = await axios.get(`${BASE_URL}/api/analysis/ETH-USDT`);
    console.log('✅ 分析报告生成成功');
    console.log('   - 当前价格:', analysisRes.data.currentPrice);
    console.log('   - 多时间窗口分析:', analysisRes.data.multiTimeframe?.length || 0, '个时间窗口');
    console.log('   - 价格区间分析:', analysisRes.data.priceRange?.length || 0, '个时间窗口');
    console.log('   - 波动率分析:', analysisRes.data.volatility?.length || 0, '个时间窗口');
    console.log('   - 交易建议:', analysisRes.data.suggestion?.action || 'N/A');
    console.log('   - 信心指数:', analysisRes.data.suggestion?.confidence || 0, '%');

    console.log('\n✅ 所有测试通过！');

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
    if (error.response) {
      console.error('   响应状态:', error.response.status);
      console.error('   响应数据:', error.response.data);
    }
  }
}

testAPI();

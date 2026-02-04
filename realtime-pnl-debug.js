import dotenv from 'dotenv';
import { HTXFuturesClient } from './client.js';
import WebSocket from 'ws';
import pako from 'pako';

dotenv.config();

const ACCESS_KEY = process.env.HTX_ACCESS_KEY;
const SECRET_KEY = process.env.HTX_SECRET_KEY;
const WS_URL = process.env.WS_URL || 'wss://api.hbdm.com/linear-swap-notification';
const MARKET_WS_URL = 'wss://api.hbdm.com/linear-swap-ws';

/**
 * 调试版本 - 显示详细的连接和数据信息
 */
async function main() {
  if (!ACCESS_KEY || !SECRET_KEY) {
    console.error('❌ 请先配置 HTX_ACCESS_KEY 和 HTX_SECRET_KEY');
    process.exit(1);
  }

  console.log('🐛 实时持仓盈亏监控 (调试模式)\n');
  console.log('=' .repeat(60));
  console.log('此模式会显示详细的连接、心跳和数据信息');
  console.log('=' .repeat(60));
  console.log('');

  const client = new HTXFuturesClient(ACCESS_KEY, SECRET_KEY, WS_URL);
  const positions = new Map();
  let marketWs = null;
  let messageCount = 0;
  let lastMessageTime = Date.now();

  // 统计信息
  const stats = {
    privateMessages: 0,
    marketMessages: 0,
    positionUpdates: 0,
    priceUpdates: 0,
    reconnects: 0,
    startTime: Date.now()
  };

  // 监听持仓更新
  client.on('positions', (data) => {
    stats.positionUpdates++;
    console.log(`\n[${new Date().toLocaleTimeString()}] 💼 持仓更新 (#${stats.positionUpdates})`);
    
    if (Array.isArray(data)) {
      data.forEach(position => {
        if (position.volume > 0) {
          const key = `${position.contract_code}_${position.direction}`;
          positions.set(key, position);
          
          console.log(`  ${position.contract_code} ${position.direction === 'buy' ? '多仓' : '空仓'}`);
          console.log(`  持仓量: ${position.volume} 张`);
          console.log(`  开仓价: ${position.cost_open}`);
          console.log(`  保证金: ${position.position_margin} USDT`);
          console.log(`  当前盈亏: ${position.profit_unreal} USDT (${position.profit_rate}%)`);
        }
      });
    }
  });

  // 连接市场行情
  function connectMarketWs() {
    stats.reconnects++;
    console.log(`\n[${new Date().toLocaleTimeString()}] 📊 连接市场行情 WebSocket (第 ${stats.reconnects} 次)`);
    
    marketWs = new WebSocket(MARKET_WS_URL);
    let pingInterval = null;
    let lastPing = 0;

    marketWs.on('open', () => {
      console.log(`[${new Date().toLocaleTimeString()}] ✅ 市场行情连接成功`);
      
      // 启动心跳
      pingInterval = setInterval(() => {
        if (marketWs && marketWs.readyState === WebSocket.OPEN) {
          lastPing = Date.now();
          marketWs.ping();
          console.log(`[${new Date().toLocaleTimeString()}] 💓 发送市场行情心跳`);
        }
      }, 20000);
      
      // 订阅行情
      const contracts = Array.from(new Set(
        Array.from(positions.values()).map(p => p.contract_code)
      ));
      
      if (contracts.length > 0) {
        console.log(`[${new Date().toLocaleTimeString()}] 📡 订阅行情:`, contracts.join(', '));
        contracts.forEach(contract => {
          const subMsg = {
            sub: `market.${contract}.detail`,
            id: `detail_${contract}`
          };
          marketWs.send(JSON.stringify(subMsg));
        });
      }
    });

    marketWs.on('message', (data) => {
      try {
        stats.marketMessages++;
        lastMessageTime = Date.now();
        
        const text = pako.inflate(data, { to: 'string' });
        const message = JSON.parse(text);

        // 处理 ping
        if (message.ping) {
          marketWs.send(JSON.stringify({ pong: message.ping }));
          console.log(`[${new Date().toLocaleTimeString()}] 💓 收到市场行情 ping, 响应 pong`);
          return;
        }

        // 处理行情数据
        if (message.tick && message.ch) {
          stats.priceUpdates++;
          const match = message.ch.match(/market\.([^.]+)\./);
          if (match) {
            const contractCode = match[1];
            const lastPrice = message.tick.close || message.tick.last;
            if (lastPrice) {
              calculatePnL(contractCode, lastPrice);
            }
          }
        }

        // 处理订阅响应
        if (message.status === 'ok' && message.subbed) {
          console.log(`[${new Date().toLocaleTimeString()}] ✓ 行情订阅成功: ${message.subbed}`);
        }
      } catch (error) {
        console.error(`[${new Date().toLocaleTimeString()}] ❌ 行情消息处理错误:`, error.message);
      }
    });

    marketWs.on('error', (error) => {
      console.error(`[${new Date().toLocaleTimeString()}] ❌ 市场行情错误:`, error.message);
    });

    marketWs.on('close', (code, reason) => {
      const reasonText = reason ? reason.toString() : '无';
      console.log(`[${new Date().toLocaleTimeString()}] 🔌 市场行情关闭 (code: ${code}, reason: ${reasonText})`);
      
      if (pingInterval) {
        clearInterval(pingInterval);
      }
      
      console.log(`[${new Date().toLocaleTimeString()}] ⏳ 5秒后重连...`);
      setTimeout(connectMarketWs, 5000);
    });

    marketWs.on('pong', () => {
      const latency = Date.now() - lastPing;
      console.log(`[${new Date().toLocaleTimeString()}] 💓 收到市场行情 pong (延迟: ${latency}ms)`);
    });
  }

  // 计算实时盈亏
  function calculatePnL(contractCode, lastPrice) {
    ['buy', 'sell'].forEach(direction => {
      const key = `${contractCode}_${direction}`;
      const position = positions.get(key);
      
      if (position && position.volume > 0) {
        const costOpen = parseFloat(position.cost_open);
        const volume = parseFloat(position.volume);
        
        // HTX 永续合约面值
        const contractSize = contractCode.includes('BTC') ? 0.001 : 
                            contractCode.includes('ETH') ? 0.01 : 1;
        
        // 实际持仓数量
        const actualPosition = volume * contractSize;
        
        // 持仓价值（USDT）
        const positionValue = actualPosition * lastPrice;
        
        // 计算盈亏
        let profitUnreal;
        if (direction === 'buy') {
          profitUnreal = (lastPrice - costOpen) * volume * contractSize;
        } else {
          profitUnreal = (costOpen - lastPrice) * volume * contractSize;
        }
        
        const positionMargin = parseFloat(position.position_margin);
        const profitRate = positionMargin > 0 ? (profitUnreal / positionMargin * 100) : 0;
        
        const profitColor = profitUnreal >= 0 ? '🟢' : '🔴';
        const directionText = direction === 'buy' ? '多仓' : '空仓';
        
        console.log(`${profitColor} [${new Date().toLocaleTimeString()}] ${contractCode} ${directionText} (#${stats.priceUpdates})`);
        console.log(`   持仓: ${volume} 张 × ${contractSize} = ${actualPosition.toFixed(4)} ${contractCode.split('-')[0]}`);
        console.log(`   持仓价值: ${positionValue.toFixed(2)} USDT | 保证金: ${positionMargin.toFixed(2)} USDT`);
        console.log(`   价格: ${lastPrice.toFixed(2)} (开仓: ${costOpen.toFixed(2)}, 差价: ${(lastPrice - costOpen).toFixed(2)})`);
        console.log(`   盈亏: ${profitUnreal.toFixed(4)} USDT | 收益率: ${profitRate.toFixed(2)}%`);
      }
    });
  }

  try {
    await client.connect();
    console.log(`[${new Date().toLocaleTimeString()}] 📡 订阅持仓更新...\n`);
    client.subscribePositions('*');
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    connectMarketWs();

    console.log('\n✅ 调试监听已启动\n');

    // 每 30 秒显示统计信息
    setInterval(() => {
      const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
      const timeSinceLastMsg = Math.floor((Date.now() - lastMessageTime) / 1000);
      
      console.log('\n' + '='.repeat(60));
      console.log(`📊 统计信息 (运行时间: ${uptime}秒)`);
      console.log('='.repeat(60));
      console.log(`持仓更新: ${stats.positionUpdates} 次`);
      console.log(`价格更新: ${stats.priceUpdates} 次`);
      console.log(`市场消息: ${stats.marketMessages} 条`);
      console.log(`重连次数: ${stats.reconnects - 1} 次`);
      console.log(`距上次消息: ${timeSinceLastMsg} 秒`);
      console.log('='.repeat(60) + '\n');
    }, 30000);

  } catch (error) {
    console.error('❌ 启动失败:', error.message);
    process.exit(1);
  }

  process.on('SIGINT', () => {
    console.log('\n\n📊 最终统计:');
    console.log(`  运行时间: ${Math.floor((Date.now() - stats.startTime) / 1000)} 秒`);
    console.log(`  持仓更新: ${stats.positionUpdates} 次`);
    console.log(`  价格更新: ${stats.priceUpdates} 次`);
    console.log(`  重连次数: ${stats.reconnects - 1} 次`);
    console.log('\n👋 再见！');
    client.close();
    if (marketWs) marketWs.close();
    process.exit(0);
  });
}

main().catch(error => {
  console.error('❌ 程序异常:', error);
  process.exit(1);
});

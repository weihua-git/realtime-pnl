import WebSocket from 'ws';
import pako from 'pako';
import crypto from 'crypto';
import { HTXAuth } from './auth.js';

/**
 * HTX 永续合约 WebSocket 客户端
 */
export class HTXFuturesClient {
  constructor(accessKey, secretKey, wsUrl) {
    this.auth = new HTXAuth(accessKey, secretKey);
    this.wsUrl = wsUrl;
    this.ws = null;
    this.isConnected = false;
    this.reconnectInterval = 5000;
    this.pingInterval = null;
    this.subscriptions = new Set();
    this.eventHandlers = {
      orders: [],
      positions: [],
      accounts: [],
      matchOrders: [],
      liquidationOrders: [],
      fundingRate: [],
      contractInfo: [],
      ticker: [],  // 添加行情事件
      positionPnL: []  // 添加实时盈亏事件
    };
    this.currentPositions = new Map();  // 缓存当前持仓
  }

  /**
   * 连接 WebSocket
   */
  connect() {
    return new Promise((resolve, reject) => {
      try {
        // HTX 私有频道需要先连接，然后发送认证消息
        console.log('🔗 正在连接 HTX WebSocket...');
        
        this.ws = new WebSocket(this.wsUrl);
        this.authResolved = false;

        this.ws.on('open', () => {
          console.log('✅ WebSocket 连接成功');
          this.isConnected = true;
          this.startPing();
          
          // 发送认证消息
          this.authenticate();
          
          resolve();
        });

        this.ws.on('message', (data) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (error) => {
          console.error('❌ WebSocket 错误:', error.message);
          reject(error);
        });

        this.ws.on('close', (code, reason) => {
          const reasonText = reason ? reason.toString() : '无';
          console.log(`🔌 WebSocket 连接关闭 (code: ${code}, reason: ${reasonText})`);
          this.isConnected = false;
          this.stopPing();
          
          // 只在非正常关闭时重连
          if (code !== 1000) {
            this.reconnect();
          }
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 处理接收到的消息
   */
  handleMessage(data) {
    try {
      // 解压 gzip 数据
      const text = pako.inflate(data, { to: 'string' });
      const message = JSON.parse(text);

      // 处理 ping（两种格式都支持）
      if (message.ping) {
        this.lastPongTime = Date.now(); // 更新最后收到 ping 的时间
        this.ws.send(JSON.stringify({ pong: message.ping }));
        return;
      }
      
      if (message.op === 'ping') {
        this.lastPongTime = Date.now(); // 更新最后收到 ping 的时间
        this.ws.send(JSON.stringify({ op: 'pong', ts: message.ts }));
        return;
      }

      // 处理服务器主动关闭通知
      if (message.op === 'close') {
        console.log('⚠️ 服务器发送关闭通知:', message['err-msg'] || '未知原因');
        return;
      }

      // 处理认证响应
      if (message.op === 'auth') {
        if (message['err-code'] === 0) {
          console.log('🔐 认证成功');
          this.authResolved = true;
          // 认证成功后，重新订阅之前的频道
          this.resubscribe();
        } else {
          console.error('❌ 认证失败:', message['err-msg']);
        }
        return;
      }

      // 处理订阅响应
      if (message.op === 'sub') {
        if (message['err-code'] === 0) {
          console.log('📡 订阅成功:', message.topic);
        } else {
          console.error('❌ 订阅失败:', message['err-msg']);
        }
        return;
      }

      // 处理推送数据
      if (message.op === 'notify') {
        this.handleNotification(message);
      }

    } catch (error) {
      console.error('❌ 消息处理错误:', error.message);
    }
  }

  /**
   * 处理推送通知
   */
  handleNotification(message) {
    const topic = message.topic;
    const timestamp = new Date().toLocaleString('zh-CN');

    // 订单更新
    if (topic.includes('orders')) {
      this.emit('orders', message.data);
      console.log(`\n[${timestamp}] 📋 订单更新:`, JSON.stringify(message.data, null, 2));
    }
    
    // 持仓更新
    else if (topic.includes('positions')) {
      // 缓存持仓数据用于实时计算
      if (Array.isArray(message.data)) {
        message.data.forEach(pos => {
          const key = `${pos.contract_code}_${pos.direction}`;
          this.currentPositions.set(key, pos);
        });
      }
      this.emit('positions', message.data);
      console.log(`\n[${timestamp}] 💼 持仓更新:`, JSON.stringify(message.data, null, 2));
    }
    
    // 账户余额更新
    else if (topic.includes('accounts')) {
      this.emit('accounts', message.data);
      console.log(`\n[${timestamp}] 💰 账户更新:`, JSON.stringify(message.data, null, 2));
    }
    
    // 成交订单
    else if (topic.includes('matchOrders')) {
      this.emit('matchOrders', message.data);
      console.log(`\n[${timestamp}] ✅ 订单成交:`, JSON.stringify(message.data, null, 2));
    }
    
    // 强平订单
    else if (topic.includes('liquidation_orders')) {
      this.emit('liquidationOrders', message.data);
      console.log(`\n[${timestamp}] ⚠️ 强平订单:`, JSON.stringify(message.data, null, 2));
    }
    
    // 行情推送（用于实时计算持仓盈亏）
    else if (topic.startsWith('market.') && topic.includes('.ticker.')) {
      this.emit('ticker', message.tick);
      // 根据最新价格计算持仓盈亏
      if (message.tick && message.tick.last) {
        this.calculatePositionPnL(message.tick);
      }
    }
  }

  /**
   * 根据最新行情计算持仓盈亏
   */
  calculatePositionPnL(tick) {
    const contractCode = tick.contract_code;
    const lastPrice = parseFloat(tick.last);
    
    // 检查是否有该合约的持仓
    ['buy', 'sell'].forEach(direction => {
      const key = `${contractCode}_${direction}`;
      const position = this.currentPositions.get(key);
      
      if (position && position.volume > 0) {
        const costOpen = parseFloat(position.cost_open);
        const volume = parseFloat(position.volume);
        
        // 计算未实现盈亏
        let profitUnreal;
        if (direction === 'buy') {
          // 多仓：(当前价 - 开仓价) * 持仓量
          profitUnreal = (lastPrice - costOpen) * volume;
        } else {
          // 空仓：(开仓价 - 当前价) * 持仓量
          profitUnreal = (costOpen - lastPrice) * volume;
        }
        
        // 计算收益率
        const positionMargin = parseFloat(position.position_margin);
        const profitRate = positionMargin > 0 ? (profitUnreal / positionMargin * 100) : 0;
        
        // 触发实时盈亏事件
        this.emit('positionPnL', {
          contract_code: contractCode,
          direction: direction,
          volume: volume,
          cost_open: costOpen,
          last_price: lastPrice,
          profit_unreal: profitUnreal.toFixed(4),
          profit_rate: profitRate.toFixed(2),
          timestamp: new Date().toISOString()
        });
      }
    });
  }

  /**
   * 订阅市场行情（用于实时计算持仓盈亏）
   * @param {string} contractCode - 合约代码，如 "BTC-USDT"
   */
  subscribeMarketTicker(contractCode) {
    // 注意：市场行情是公共频道，需要连接到公共 WebSocket
    // 格式：market.$contract_code.ticker
    const topic = `market.${contractCode}.ticker`;
    
    // 公共频道订阅（不需要认证）
    if (this.isConnected) {
      const subMessage = {
        sub: topic,
        id: `ticker_${Date.now()}`
      };
      this.ws.send(JSON.stringify(subMessage));
      console.log(`📊 订阅行情: ${contractCode}`);
    }
  }

  /**
   * 订阅订单更新
   * @param {string} contractCode - 合约代码，如 "BTC-USDT"，"*" 表示所有合约
   */
  subscribeOrders(contractCode = '*') {
    const topic = `orders.${contractCode}`;
    this.subscribe(topic);
  }

  /**
   * 订阅持仓更新
   * @param {string} contractCode - 合约代码，如 "BTC-USDT"，"*" 表示所有合约
   */
  subscribePositions(contractCode = '*') {
    const topic = `positions.${contractCode}`;
    this.subscribe(topic);
  }

  /**
   * 订阅账户余额更新（统一账户模式）
   * @param {string} contractCode - 合约代码，如 "BTC-USDT"，"*" 表示所有合约
   */
  subscribeAccounts(contractCode = '*') {
    // HTX 新版 API 使用 accounts_unify（统一账户）
    const topic = `accounts_unify.${contractCode}`;
    this.subscribe(topic);
  }

  /**
   * 订阅成交订单
   * @param {string} contractCode - 合约代码，如 "BTC-USDT"，"*" 表示所有合约
   */
  subscribeMatchOrders(contractCode = '*') {
    const topic = `matchOrders.${contractCode}`;
    this.subscribe(topic);
  }

  /**
   * 订阅强平订单（公共频道）
   * @param {string} contractCode - 合约代码，如 "BTC-USDT"，"*" 表示所有合约
   */
  subscribeLiquidationOrders(contractCode = '*') {
    // 强平订单是公共频道，格式为 public.$contract_code.liquidation_orders
    // 注意：公共频道不需要认证，但格式要正确
    const topic = `public.${contractCode}.liquidation_orders`;
    
    // 公共频道可以直接订阅，不需要等待认证
    if (this.isConnected) {
      const subMessage = {
        op: 'sub',
        topic: topic
      };
      this.ws.send(JSON.stringify(subMessage));
      this.subscriptions.add(topic);
    } else {
      this.subscriptions.add(topic);
    }
  }

  /**
   * 发送认证消息
   */
  authenticate() {
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '');
    const url = new URL(this.wsUrl);
    
    const params = {
      AccessKeyId: this.auth.accessKey,
      SignatureMethod: 'HmacSHA256',
      SignatureVersion: '2',
      Timestamp: timestamp
    };

    // 按字母顺序排序参数
    const sortedParams = Object.keys(params)
      .sort()
      .map(key => `${key}=${encodeURIComponent(params[key])}`)
      .join('&');

    // 构建签名字符串
    const signatureString = `GET\n${url.host}\n${url.pathname}\n${sortedParams}`;

    // 生成签名
    const signature = crypto
      .createHmac('sha256', this.auth.secretKey)
      .update(signatureString)
      .digest('base64');

    const authMessage = {
      op: 'auth',
      type: 'api',
      AccessKeyId: this.auth.accessKey,
      SignatureMethod: 'HmacSHA256',
      SignatureVersion: '2',
      Timestamp: timestamp,
      Signature: signature
    };

    console.log('🔐 发送认证请求...');
    this.ws.send(JSON.stringify(authMessage));
  }

  /**
   * 通用订阅方法
   */
  subscribe(topic) {
    if (!this.isConnected) {
      console.warn('⚠️ WebSocket 未连接，订阅将在连接后执行');
      this.subscriptions.add(topic);
      return;
    }

    // 保存订阅，等待认证完成后再发送
    this.subscriptions.add(topic);
    
    // 如果已经认证，立即订阅
    if (this.authResolved) {
      const subMessage = {
        op: 'sub',
        topic: topic
      };
      this.ws.send(JSON.stringify(subMessage));
    }
  }

  /**
   * 重新订阅所有频道
   */
  resubscribe() {
    if (!this.authResolved) {
      console.log('⏳ 等待认证完成后订阅...');
      return;
    }
    
    console.log('📡 认证成功，开始订阅频道...');
    for (const topic of this.subscriptions) {
      const subMessage = {
        op: 'sub',
        topic: topic
      };
      this.ws.send(JSON.stringify(subMessage));
    }
  }

  /**
   * 取消订阅
   */
  unsubscribe(topic) {
    const unsubMessage = {
      op: 'unsub',
      topic: topic
    };

    if (this.isConnected) {
      this.ws.send(JSON.stringify(unsubMessage));
    }
    this.subscriptions.delete(topic);
  }

  /**
   * 启动心跳
   */
  startPing() {
    this.lastPongTime = Date.now();
    
    this.pingInterval = setInterval(() => {
      if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
        // 检查是否超过 60 秒没有收到服务器的 ping
        const timeSinceLastPong = Date.now() - this.lastPongTime;
        if (timeSinceLastPong > 60000) {
          console.warn('⚠️ 超过 60 秒未收到服务器心跳，主动关闭连接');
          this.ws.close();
          return;
        }
        
        // 发送 WebSocket ping 帧
        try {
          this.ws.ping();
        } catch (error) {
          console.error('❌ 发送心跳失败:', error.message);
        }
      }
    }, 20000);
  }

  /**
   * 停止心跳
   */
  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * 重连
   */
  reconnect() {
    console.log(`⏳ ${this.reconnectInterval / 1000} 秒后尝试重连...`);
    setTimeout(() => {
      this.authResolved = false; // 重置认证状态
      this.connect().catch(error => {
        console.error('❌ 重连失败:', error.message);
      });
    }, this.reconnectInterval);
  }

  /**
   * 注册事件监听器
   */
  on(event, handler) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].push(handler);
    }
  }

  /**
   * 触发事件
   */
  emit(event, data) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].forEach(handler => handler(data));
    }
  }

  /**
   * 关闭连接
   */
  close() {
    this.stopPing();
    if (this.ws) {
      this.ws.close();
    }
  }
}


const { createApp } = Vue;

createApp({
  data() {
    return {
      currentTab: 'trading',
      configSubTab: 'basic', // 配置管理的二级 tab
      config: {
        watchContracts: [],
        priceChangeConfig: {
          enabled: false,
          timeWindows: [],
          minNotifyInterval: 120000
        },
        priceTargets: {
          enabled: true,
          targets: []
        },
        notificationConfig: {
          profitThreshold: 3,
          lossThreshold: -5,
          profitAmountThreshold: 2,
          lossAmountThreshold: -2,
          timeInterval: 3600000,
          repeatInterval: 5000,
          enableTimeNotification: false,
          enableProfitNotification: true,
          enableLossNotification: false
        },
        quantConfig: {
          enabled: false,
          testMode: true,
          symbol: 'BTC-USDT',
          leverage: 10,
          initialBalance: 1000,
          positionSize: 0.1,
          stopLoss: 0.02,
          takeProfit: 0.05,
          trailingStop: 0.03,
          maxPositions: 1,
          minConfidence: 60
        }
      },
      availableContracts: [
        'BTC-USDT',
        'ETH-USDT',
        'SOL-USDT',
        'DOGE-USDT',
        'XRP-USDT',
        'BNB-USDT',
        'ADA-USDT',
        'AVAX-USDT'
      ],
      saving: false,
      saveMessage: '',
      saveError: false,
      // 市场分析相关
      analysisSymbol: 'BTC-USDT',
      analysisReport: null,
      analysisLoading: false,
      // 实时数据
      realtimeData: {
        prices: {},
        positions: {},
        quant: null,
        timestamp: null
      },
      ws: null,
      wsConnected: false,
      wsReconnectTimer: null,
      wsHeartbeatTimer: null,
      wsLastMessageTime: 0,
      wsReconnectAttempts: 0, // 重连尝试次数
      wsMaxReconnectDelay: 5000, // 最大重连延迟（5秒）
      // 计算器相关
      calculator: {
        symbol: 'BTC-USDT',
        direction: 'long',
        entryPrice: 1900,  // 给一个默认值
        margin: 50,
        leverage: 10,
        stopLoss: 6,
        takeProfit: 10
      },
      calculatorResult: null,
      // 量化交易相关
      resettingQuant: false,
      stoppingQuant: false,
      startingQuant: false,
      orderHistory: [],
      showOrderHistory: false,
      // 信号历史展开状态
      showSignalHistory: false
    };
  },
  computed: {
    minNotifyIntervalMinutes: {
      get() {
        return this.config.priceChangeConfig.minNotifyInterval / 60000;
      },
      set(value) {
        this.config.priceChangeConfig.minNotifyInterval = value * 60000;
      }
    },
    timeIntervalMinutes: {
      get() {
        return this.config.notificationConfig.timeInterval / 60000;
      },
      set(value) {
        this.config.notificationConfig.timeInterval = value * 60000;
      }
    },
    lossThresholdAbs: {
      get() {
        return Math.abs(this.config.notificationConfig.lossThreshold);
      },
      set(value) {
        this.config.notificationConfig.lossThreshold = -Math.abs(value);
      }
    },
    lossAmountThresholdAbs: {
      get() {
        return Math.abs(this.config.notificationConfig.lossAmountThreshold);
      },
      set(value) {
        this.config.notificationConfig.lossAmountThreshold = -Math.abs(value);
      }
    },
    // 量化交易配置的百分比转换
    positionSizePercent: {
      get() {
        return (this.config.quantConfig?.positionSize || 0.1) * 100;
      },
      set(value) {
        if (this.config.quantConfig) {
          this.config.quantConfig.positionSize = value / 100;
        }
      }
    },
    stopLossPercent: {
      get() {
        return (this.config.quantConfig?.stopLoss || 0.02) * 100;
      },
      set(value) {
        if (this.config.quantConfig) {
          this.config.quantConfig.stopLoss = value / 100;
        }
      }
    },
    takeProfitPercent: {
      get() {
        return (this.config.quantConfig?.takeProfit || 0.05) * 100;
      },
      set(value) {
        if (this.config.quantConfig) {
          this.config.quantConfig.takeProfit = value / 100;
        }
      }
    },
    trailingStopPercent: {
      get() {
        return (this.config.quantConfig?.trailingStop || 0.03) * 100;
      },
      set(value) {
        if (this.config.quantConfig) {
          this.config.quantConfig.trailingStop = value / 100;
        }
      }
    }
  },
  mounted() {
    // 隐藏加载动画
    const loadingEl = document.querySelector('.app-loading');
    if (loadingEl) {
      loadingEl.style.display = 'none';
    }
    
    this.loadConfig();
    this.connectWebSocket();
    this.loadOrderHistory();
    // 监听计算器输入变化，自动计算
    this.$watch('calculator', () => {
      this.calculateResult();
    }, { deep: true });
    // 初始计算一次
    this.$nextTick(() => {
      this.calculateResult();
    });
    
    // 监听页面可见性变化（切换应用时）
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        console.log('👀 页面重新可见，检查 WebSocket 连接...');
        
        // 如果未连接或连接状态不对，立即重连
        if (!this.wsConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
          console.log('⚡ 立即重连 WebSocket...');
          this.wsReconnectAttempts = 0; // 重置重连次数，立即重连
          
          // 关闭旧连接
          if (this.ws) {
            this.ws.close();
          }
          
          // 立即重连
          this.connectWebSocket();
        } else {
          console.log('✅ WebSocket 连接正常');
        }
      } else {
        console.log('👋 页面不可见（切换到其他应用）');
      }
    });
    
    // 监听网络状态变化
    window.addEventListener('online', () => {
      console.log('🌐 网络已恢复，立即重连 WebSocket...');
      this.wsReconnectAttempts = 0;
      
      if (this.ws) {
        this.ws.close();
      }
      
      this.connectWebSocket();
    });
    
    window.addEventListener('offline', () => {
      console.log('📡 网络已断开');
      this.wsConnected = false;
    });
  },
  beforeUnmount() {
    if (this.ws) {
      this.ws.close();
    }
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
    }
    if (this.wsHeartbeatTimer) {
      clearInterval(this.wsHeartbeatTimer);
    }
  },
  methods: {
    // WebSocket 连接
    connectWebSocket() {
      // 清除旧的定时器
      if (this.wsReconnectTimer) {
        clearTimeout(this.wsReconnectTimer);
        this.wsReconnectTimer = null;
      }
      if (this.wsHeartbeatTimer) {
        clearInterval(this.wsHeartbeatTimer);
        this.wsHeartbeatTimer = null;
      }
      
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;
      
      console.log(`🔌 连接 WebSocket (尝试 ${this.wsReconnectAttempts + 1})...`);
      
      try {
        this.ws = new WebSocket(wsUrl);
      } catch (error) {
        console.error('❌ WebSocket 创建失败:', error);
        this.scheduleReconnect();
        return;
      }

      // 设置连接超时（10秒）
      const connectTimeout = setTimeout(() => {
        if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
          console.warn('⚠️ WebSocket 连接超时，关闭并重连...');
          this.ws.close();
        }
      }, 10000);

      this.ws.onopen = () => {
        clearTimeout(connectTimeout);
        console.log('✅ WebSocket 已连接');
        this.wsConnected = true;
        this.wsLastMessageTime = Date.now();
        this.wsReconnectAttempts = 0; // 重置重连次数
        
        // 启动心跳检测（每5秒检查一次，更频繁）
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          this.wsLastMessageTime = Date.now();
          const message = JSON.parse(event.data);
          
          if (message.type === 'update' && message.data) {
            this.realtimeData = message.data;
            
            // 如果计算器的开仓价格为0或默认值，且有实时价格，自动填充
            if (this.calculator.entryPrice === 0 || this.calculator.entryPrice === 1900) {
              const priceData = this.realtimeData.prices?.[this.calculator.symbol];
              if (priceData && typeof priceData === 'object' && priceData.price > 0) {
                this.calculator.entryPrice = parseFloat(priceData.price);
              }
            }
          }
        } catch (error) {
          console.error('❌ 解析 WebSocket 消息失败:', error);
        }
      };

      this.ws.onerror = (error) => {
        clearTimeout(connectTimeout);
        console.error('❌ WebSocket 错误:', error);
        this.wsConnected = false;
      };

      this.ws.onclose = (event) => {
        clearTimeout(connectTimeout);
        console.log(`🔌 WebSocket 已断开 (code: ${event.code}, reason: ${event.reason || '无'})`);
        this.wsConnected = false;
        
        // 清除心跳
        if (this.wsHeartbeatTimer) {
          clearInterval(this.wsHeartbeatTimer);
          this.wsHeartbeatTimer = null;
        }
        
        // 自动重连（使用指数退避，但有上限）
        this.scheduleReconnect();
      };
    },
    
    // 启动心跳检测
    startHeartbeat() {
      // 清除旧的心跳
      if (this.wsHeartbeatTimer) {
        clearInterval(this.wsHeartbeatTimer);
      }
      
      // 每5秒检查一次（更频繁，更快发现断线）
      this.wsHeartbeatTimer = setInterval(() => {
        const now = Date.now();
        const timeSinceLastMessage = now - this.wsLastMessageTime;
        
        // 如果超过15秒没收到消息，认为连接已断开（从30秒改为15秒）
        if (timeSinceLastMessage > 15000) {
          console.warn('⚠️ WebSocket 超过15秒未收到消息，尝试重连...');
          
          // 关闭旧连接
          if (this.ws) {
            this.ws.close();
          }
          
          // 重新连接
          this.connectWebSocket();
        } else if (timeSinceLastMessage > 8000) {
          // 超过8秒，发送 ping（从15秒改为8秒）
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try {
              this.ws.send(JSON.stringify({ type: 'ping' }));
              console.log('📡 发送心跳 ping');
            } catch (error) {
              console.error('❌ 发送心跳失败:', error);
            }
          }
        }
      }, 5000); // 从10秒改为5秒
    },
    
    // 安排重连（使用指数退避策略）
    scheduleReconnect() {
      if (this.wsReconnectTimer) {
        return; // 已经在重连中
      }
      
      // 计算重连延迟：第1次立即，第2次1秒，第3次2秒，第4次4秒，最多5秒
      const baseDelay = 1000;
      const delay = this.wsReconnectAttempts === 0 
        ? 0 
        : Math.min(baseDelay * Math.pow(2, this.wsReconnectAttempts - 1), this.wsMaxReconnectDelay);
      
      this.wsReconnectAttempts++;
      
      if (delay === 0) {
        console.log('⚡ 立即重连 WebSocket...');
        this.connectWebSocket();
      } else {
        console.log(`⏳ ${(delay / 1000).toFixed(1)}秒后重连 WebSocket...`);
        this.wsReconnectTimer = setTimeout(() => {
          this.wsReconnectTimer = null;
          this.connectWebSocket();
        }, delay);
      }
    },

    // 格式化时间
    formatTime(timestamp) {
      if (!timestamp) return '--:--:--';
      const date = new Date(timestamp);
      return date.toLocaleTimeString('zh-CN');
    },

    async loadConfig() {
      try {
        const response = await fetch('/api/config');
        const data = await response.json();
        
        // 兼容旧配置：为价格目标添加新字段的默认值
        if (data.priceTargets && data.priceTargets.targets) {
          data.priceTargets.targets = data.priceTargets.targets.map(target => ({
            symbol: target.symbol || 'BTC-USDT',
            targetPrice: target.targetPrice || 0,
            direction: target.direction || 'above',
            notifyOnce: target.notifyOnce !== undefined ? target.notifyOnce : false,
            notifyInterval: target.notifyInterval !== undefined ? target.notifyInterval : 60,
            rangePercent: target.rangePercent !== undefined ? target.rangePercent : 0,
            lastNotifyTime: target.lastNotifyTime || 0
          }));
        }
        
        this.config = data;
        
        // 加载计算器设置（除了开仓价格）
        if (data.calculatorSettings) {
          this.calculator.symbol = data.calculatorSettings.symbol || 'BTC-USDT';
          this.calculator.direction = data.calculatorSettings.direction || 'long';
          this.calculator.margin = data.calculatorSettings.margin || 50;
          this.calculator.leverage = data.calculatorSettings.leverage || 10;
          this.calculator.stopLoss = data.calculatorSettings.stopLoss || 6;
          this.calculator.takeProfit = data.calculatorSettings.takeProfit || 10;
          // 注意：不加载 entryPrice，保持实时价格
        }
      } catch (error) {
        console.error('加载配置失败:', error);
        alert('加载配置失败，请刷新页面重试');
      }
    },
    async saveConfig() {
      this.saving = true;
      this.saveMessage = '';
      this.saveError = false;
      
      try {
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(this.config)
        });
        
        const result = await response.json();
        
        if (response.ok) {
          this.saveMessage = '✅ ' + result.message;
          setTimeout(() => {
            this.saveMessage = '';
          }, 3000);
        } else {
          throw new Error(result.message || '保存失败');
        }
      } catch (error) {
        this.saveError = true;
        this.saveMessage = '❌ ' + error.message;
      } finally {
        this.saving = false;
      }
    },
    addTarget() {
      // 获取 BTC-USDT 的实时价格作为默认值
      const symbol = 'BTC-USDT';
      const priceData = this.realtimeData.prices?.[symbol];
      const defaultPrice = (priceData && typeof priceData === 'object' && priceData.price > 0) 
        ? parseFloat(priceData.price) 
        : 50000; // 如果没有实时价格，使用一个合理的默认值
      
      this.config.priceTargets.targets.push({
        symbol: symbol,
        targetPrice: defaultPrice,
        direction: 'above',
        notifyOnce: false,
        notifyInterval: 60,
        rangePercent: 0,
        lastNotifyTime: 0
      });
    },
    removeTarget(index) {
      this.config.priceTargets.targets.splice(index, 1);
    },
    toggleContract(contract) {
      const index = this.config.watchContracts.indexOf(contract);
      if (index > -1) {
        this.config.watchContracts.splice(index, 1);
      } else {
        this.config.watchContracts.push(contract);
      }
    },
    async loadAnalysis() {
      this.analysisLoading = true;
      this.analysisReport = null;
      
      try {
        // 直接调用 API，服务器会自动获取实时价格和持仓成本
        const url = `/api/analysis/${this.analysisSymbol}`;
        const response = await fetch(url);
        const data = await response.json();
        
        if (response.ok) {
          this.analysisReport = data;
        } else {
          throw new Error(data.message || '分析失败');
        }
      } catch (error) {
        alert('分析失败: ' + error.message);
      } finally {
        this.analysisLoading = false;
      }
    },
    getActionText(action) {
      const texts = {
        'long': '做多 (买入开多)',
        'short': '做空 (卖出开空)',
        'hold': '观望 (暂不操作)'
      };
      return texts[action] || action;
    },
    
    // 计算器方法
    getLivePrice(symbol) {
      const priceData = this.realtimeData.prices?.[symbol];
      if (priceData && typeof priceData === 'object') {
        return priceData.price?.toFixed(2) || '0.00';
      }
      return '0.00';
    },
    
    getPriceStatus(symbol) {
      const priceData = this.realtimeData.prices?.[symbol];
      if (priceData && priceData.price > 0) {
        const now = Date.now();
        const timeSinceUpdate = now - (priceData.timestamp || 0);
        
        if (timeSinceUpdate < 5000) {
          return '✅ 实时更新';
        } else if (timeSinceUpdate < 30000) {
          const seconds = Math.floor(timeSinceUpdate / 1000);
          return `⏱️ ${seconds}秒前更新`;
        } else {
          return '⚠️ 数据可能过期';
        }
      }
      return '⏳ 等待数据...';
    },
    
    useCurrentPrice() {
      const priceData = this.realtimeData.prices?.[this.calculator.symbol];
      if (priceData && typeof priceData === 'object' && priceData.price > 0) {
        this.calculator.entryPrice = parseFloat(priceData.price);
      } else {
        alert('暂无实时价格数据，请稍候');
      }
    },
    
    calculateResult() {
      const { direction, entryPrice, margin, leverage, stopLoss, takeProfit } = this.calculator;
      
      // 转换为数字
      const price = parseFloat(entryPrice);
      const marginNum = parseFloat(margin);
      const leverageNum = parseFloat(leverage);
      const stopLossNum = parseFloat(stopLoss);
      const takeProfitNum = parseFloat(takeProfit);
      
      // 验证输入
      if (!price || !marginNum || price <= 0 || marginNum <= 0) {
        console.log('计算器输入无效:', { price, marginNum });
        this.calculatorResult = null;
        return;
      }
      
      console.log('开始计算:', { direction, price, marginNum, leverageNum, stopLossNum, takeProfitNum });
      
      // 计算持仓价值（持仓量 USDT）
      const positionValue = marginNum * leverageNum;
      
      // 火币官方：手续费基于持仓价值
      const feeRate = 0.0005; // 0.05%
      const openFee = positionValue * feeRate;
      const closeFee = positionValue * feeRate;
      const totalFee = openFee + closeFee;
      
      // 计算止损/止盈价格
      // 用户输入的是 ROE%（收益率，基于保证金的盈亏百分比）
      // ROE = 价格变化% × 杠杆
      // 价格变化% = ROE / 杠杆
      const stopLossROE = stopLossNum / 100; // ROE（如 0.03 表示 3%）
      const takeProfitROE = takeProfitNum / 100; // ROE（如 0.05 表示 5%）
      
      // 计算价格变化百分比
      const stopLossPriceChangePercent = stopLossROE / leverageNum;
      const takeProfitPriceChangePercent = takeProfitROE / leverageNum;
      
      let stopLossPrice, takeProfitPrice;
      if (direction === 'long') {
        // 做多：止损价格 = 开仓价 × (1 - 价格变化%)
        stopLossPrice = price * (1 - stopLossPriceChangePercent);
        // 做多：止盈价格 = 开仓价 × (1 + 价格变化%)
        takeProfitPrice = price * (1 + takeProfitPriceChangePercent);
      } else {
        // 做空：止损价格 = 开仓价 × (1 + 价格变化%)
        stopLossPrice = price * (1 + stopLossPriceChangePercent);
        // 做空：止盈价格 = 开仓价 × (1 - 价格变化%)
        takeProfitPrice = price * (1 - takeProfitPriceChangePercent);
      }
      
      // 火币官方公式：盈亏 = 价格变化率 × 持仓量(USDT)
      // 止损盈亏
      const stopLossProfitBeforeFee = -stopLossPriceChangePercent * positionValue;
      const stopLossAmountBeforeFee = stopLossProfitBeforeFee;
      const stopLossAmount = stopLossProfitBeforeFee - totalFee;
      const stopLossRemaining = marginNum + stopLossAmount;
      
      // 止盈盈亏
      const takeProfitProfitBeforeFee = takeProfitPriceChangePercent * positionValue;
      const takeProfitAmountBeforeFee = takeProfitProfitBeforeFee;
      const takeProfitAmount = takeProfitProfitBeforeFee - totalFee;
      const takeProfitTotal = marginNum + takeProfitAmount;
      
      // 生成价格梯度表
      const priceChanges = direction === 'long' 
        ? [-10, -8, -6, -4, -2, -1, 0, 1, 2, 4, 6, 8, 10]
        : [10, 8, 6, 4, 2, 1, 0, -1, -2, -4, -6, -8, -10];
      
      const priceTable = priceChanges.map(priceChangePercent => {
        const priceChange = priceChangePercent / 100;
        
        let targetPrice, profitBeforeFee, roe;
        if (direction === 'long') {
          targetPrice = price * (1 + priceChange);
          // 火币公式：盈亏 = 价格变化率 × 持仓量
          profitBeforeFee = priceChange * positionValue;
        } else {
          targetPrice = price * (1 + priceChange);
          // 做空：价格上涨亏损，价格下跌盈利
          profitBeforeFee = -priceChange * positionValue;
        }
        
        const profitAmount = profitBeforeFee - totalFee;
        const totalBalance = marginNum + profitAmount;
        
        // ROE = 净盈亏 / 保证金
        roe = (profitAmount / marginNum) * 100;
        
        let priceChangeLabel;
        if (direction === 'long') {
          priceChangeLabel = priceChangePercent >= 0 ? `+${priceChangePercent}%` : `${priceChangePercent}%`;
        } else {
          priceChangeLabel = priceChangePercent >= 0 ? `+${priceChangePercent}%` : `${priceChangePercent}%`;
        }
        
        return {
          priceChange: priceChangeLabel,
          targetPrice,
          profitPercent: roe, // 改为显示 ROE
          profitAmount,
          totalBalance
        };
      });
      
      this.calculatorResult = {
        direction,
        entryPrice: price,
        margin: marginNum,
        leverage: leverageNum,
        positionValue,
        totalFee,
        stopLossPrice,
        stopLossPriceChange: stopLossPriceChangePercent * 100,
        stopLossAmountBeforeFee,
        stopLossAmount,
        stopLossRemaining,
        takeProfitPrice,
        takeProfitPriceChange: takeProfitPriceChangePercent * 100,
        takeProfitAmountBeforeFee,
        takeProfitAmount,
        takeProfitTotal,
        priceTable
      };
      
      console.log('计算完成:', this.calculatorResult);
    },
    
    // 复制价格到剪贴板
    copyPrice(price) {
      const priceText = price.toFixed(2);
      
      // 使用 Clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(priceText).then(() => {
          this.showCopySuccess(priceText);
        }).catch(err => {
          console.error('复制失败:', err);
          this.fallbackCopy(priceText);
        });
      } else {
        // 降级方案
        this.fallbackCopy(priceText);
      }
    },
    
    // 降级复制方案
    fallbackCopy(text) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      
      try {
        document.execCommand('copy');
        this.showCopySuccess(text);
      } catch (err) {
        console.error('复制失败:', err);
        alert('复制失败，请手动复制: ' + text);
      }
      
      document.body.removeChild(textarea);
    },
    
    // 显示复制成功提示
    showCopySuccess(text) {
      // 创建临时提示元素
      const toast = document.createElement('div');
      toast.textContent = `✅ 已复制: ${text}`;
      toast.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(16, 185, 129, 0.95);
        color: white;
        padding: 16px 24px;
        border-radius: 12px;
        font-size: 16px;
        font-weight: 600;
        z-index: 10000;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        animation: fadeInOut 2s ease-in-out;
      `;
      
      // 添加动画
      const style = document.createElement('style');
      style.textContent = `
        @keyframes fadeInOut {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
          15% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          85% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
        }
      `;
      document.head.appendChild(style);
      
      document.body.appendChild(toast);
      
      // 2秒后移除
      setTimeout(() => {
        document.body.removeChild(toast);
        document.head.removeChild(style);
      }, 2000);
    },
    
    // 保存计算器设置到配置
    async saveCalculatorSettings() {
      // 只保存设置，不保存开仓价格
      const calculatorSettings = {
        symbol: this.calculator.symbol,
        direction: this.calculator.direction,
        margin: this.calculator.margin,
        leverage: this.calculator.leverage,
        stopLoss: this.calculator.stopLoss,
        takeProfit: this.calculator.takeProfit
      };
      
      try {
        // 将计算器设置添加到配置中
        const configWithCalculator = {
          ...this.config,
          calculatorSettings: calculatorSettings
        };
        
        const response = await fetch('/api/config', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(configWithCalculator)
        });
        
        if (response.ok) {
          console.log('✅ 计算器设置已保存');
        }
      } catch (error) {
        console.error('保存计算器设置失败:', error);
      }
    },
    
    
    // 计算止损价格
    calculateStopLossPrice(position, config) {
      if (!position || !config) return 0;
      
      const { direction, entryPrice } = position;
      const { stopLoss, leverage } = config;
      
      // ROE = 价格变化% × 杠杆
      // 价格变化% = ROE / 杠杆
      const priceChangePercent = stopLoss / leverage;
      
      if (direction === 'long') {
        return entryPrice * (1 - priceChangePercent);
      } else {
        return entryPrice * (1 + priceChangePercent);
      }
    },
    
    // 计算止盈价格
    calculateTakeProfitPrice(position, config) {
      if (!position || !config) return 0;
      
      const { direction, entryPrice } = position;
      const { takeProfit, leverage } = config;
      
      const priceChangePercent = takeProfit / leverage;
      
      if (direction === 'long') {
        return entryPrice * (1 + priceChangePercent);
      } else {
        return entryPrice * (1 - priceChangePercent);
      }
    },
    
    // 计算止损金额（USDT）
    calculateStopLossUSDT(position, config) {
      if (!position || !config) return 0;
      
      const { value } = position; // 保证金
      const { stopLoss } = config; // ROE
      
      // 盈亏 = 保证金 × ROE
      return -(value * stopLoss);
    },
    
    // 计算止盈金额（USDT）
    calculateTakeProfitUSDT(position, config) {
      if (!position || !config) return 0;
      
      const { value } = position; // 保证金
      const { takeProfit } = config; // ROE
      
      return value * takeProfit;
    },
    
    // 重置量化交易
    async resetQuantTrading() {
      if (!confirm('确定要重置量化交易吗？\n\n这将清空所有测试数据（余额、持仓、订单、统计），并恢复到初始状态。')) {
        return;
      }
      
      this.resettingQuant = true;
      
      try {
        const symbol = this.realtimeData.quant?.symbol || 'BTC-USDT';
        const response = await fetch('/api/quant/reset', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ symbol })
        });
        
        const result = await response.json();
        
        if (response.ok) {
          // 重置成功，监控程序会自动重置内存状态
          alert(`✅ ${result.message}\n\n${result.note}`);
          // 重新加载历史订单
          await this.loadOrderHistory();
        } else {
          throw new Error(result.message || '重置失败');
        }
      } catch (error) {
        alert(`❌ 重置失败: ${error.message}`);
      } finally {
        this.resettingQuant = false;
      }
    },
    
    // 停止量化交易
    async stopQuantTrading() {
      if (this.realtimeData.quant?.positions?.length > 0) {
        alert('⚠️  当前有持仓，无法停止量化交易\n\n请先平仓后再停止');
        return;
      }
      
      if (!confirm('确定要停止量化交易吗？\n\n停止后需要手动重新启动。')) {
        return;
      }
      
      this.stoppingQuant = true;
      
      try {
        const response = await fetch('/api/quant/stop', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        const result = await response.json();
        
        if (response.ok) {
          alert(`✅ ${result.message}`);
        } else {
          throw new Error(result.message || '停止失败');
        }
      } catch (error) {
        alert(`❌ 停止失败: ${error.message}`);
      } finally {
        this.stoppingQuant = false;
      }
    },
    
    // 启动量化交易
    async startQuantTrading() {
      // 检查是否有价格数据
      const symbol = this.realtimeData.quant?.symbol || 'BTC-USDT';
      if (!this.realtimeData.prices || !this.realtimeData.prices[symbol]) {
        alert(`⚠️  缺少 ${symbol} 的价格数据\n\n请先在"配置管理 → 基础配置"中添加 ${symbol} 到监控合约列表，\n然后等待价格数据更新后再启动。`);
        return;
      }
      
      if (!confirm('确定要启动智能交易吗？\n\n启动后系统将自动进行交易。')) {
        return;
      }
      
      this.startingQuant = true;
      
      try {
        const response = await fetch('/api/quant/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        const result = await response.json();
        
        if (response.ok) {
          alert(`✅ ${result.message}\n\n系统将在收到价格数据后开始运行`);
        } else {
          throw new Error(result.message || '启动失败');
        }
      } catch (error) {
        alert(`❌ 启动失败: ${error.message}`);
      } finally {
        this.startingQuant = false;
      }
    },
    
    // 加载历史订单
    async loadOrderHistory() {
      try {
        const symbol = this.realtimeData.quant?.symbol || 'BTC-USDT';
        const mode = this.realtimeData.quant?.testMode ? 'test' : 'live';
        
        const response = await fetch(`/api/quant/history?symbol=${symbol}&mode=${mode}`);
        const result = await response.json();
        
        if (response.ok && result.success) {
          this.orderHistory = result.data || [];
        }
      } catch (error) {
        console.error('加载历史订单失败:', error);
      }
    },
    
    // 格式化时间
    formatTime(timestamp) {
      if (!timestamp) return '';
      const date = new Date(timestamp);
      return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  },
  
  watch: {
    // 监听计算器设置变化（除了开仓价格）
    'calculator.symbol'() {
      this.saveCalculatorSettings();
    },
    'calculator.direction'() {
      this.saveCalculatorSettings();
    },
    'calculator.margin'() {
      this.saveCalculatorSettings();
    },
    'calculator.leverage'() {
      this.saveCalculatorSettings();
    },
    'calculator.stopLoss'() {
      this.saveCalculatorSettings();
    },
    'calculator.takeProfit'() {
      this.saveCalculatorSettings();
    }
  }
}).mount('#app');

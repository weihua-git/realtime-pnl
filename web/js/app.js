const { createApp } = Vue;

createApp({
  data() {
    return {
      currentTab: 'config',
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
      analysisSymbol: 'ETH-USDT',
      analysisReport: null,
      analysisLoading: false
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
    }
  },
  mounted() {
    this.loadConfig();
  },
  methods: {
    async loadConfig() {
      try {
        const response = await fetch('/api/config');
        const data = await response.json();
        
        // 兼容旧配置：为价格目标添加新字段的默认值
        if (data.priceTargets && data.priceTargets.targets) {
          data.priceTargets.targets = data.priceTargets.targets.map(target => ({
            symbol: target.symbol || 'ETH-USDT',
            targetPrice: target.targetPrice || 0,
            direction: target.direction || 'above',
            notifyOnce: target.notifyOnce !== undefined ? target.notifyOnce : false,
            notifyInterval: target.notifyInterval !== undefined ? target.notifyInterval : 60,
            rangePercent: target.rangePercent !== undefined ? target.rangePercent : 0,
            lastNotifyTime: target.lastNotifyTime || 0
          }));
        }
        
        this.config = data;
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
      this.config.priceTargets.targets.push({
        symbol: 'ETH-USDT',
        targetPrice: 2200,
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
    }
  }
}).mount('#app');

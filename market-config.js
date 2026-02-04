/**
 * 行情监控配置
 */
export const marketConfig = {
  // 要监控的合约列表
  watchContracts: [
    // 'BTC-USDT',
    'ETH-USDT',
    // 'SOL-USDT',
    // 'DOGE-USDT',
    // 'XRP-USDT',
    // 可以添加更多合约
  ],

  // 多时间窗口价格变化检测配置
  priceChangeConfig: {
    // 多个时间窗口和对应的阈值
    timeWindows: [
      { duration: 5 * 1000, threshold: 0.05, amountThreshold: 0.5, name: '5秒' },        // 5秒内涨跌0.3%或1 USDT
      { duration: 10 * 1000, threshold: 0.1, amountThreshold: 1, name: '10秒' },      // 10秒内涨跌0.5%或2 USDT
      { duration: 30 * 1000, threshold: 0.5, amountThreshold: 1.1, name: '30秒' },      // 30秒内涨跌1%或5 USDT
      { duration: 60 * 1000, threshold: 0.5, amountThreshold: 2, name: '1分钟' },    // 1分钟内涨跌1.5%或10 USDT
      { duration: 5 * 60 * 1000, threshold: 1, amountThreshold: 5, name: '5分钟' },// 5分钟内涨跌3%或30 USDT
      { duration: 60 * 60 * 1000, threshold: 1, amountThreshold: 5, name: '1小时' },// 1小时内涨跌5%或100 USDT
    ],
    minNotifyInterval: 2 * 60 * 1000,  // 同一合约最少 2 分钟通知一次
  },
};

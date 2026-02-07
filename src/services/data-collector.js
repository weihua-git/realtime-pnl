import { redisClient } from '../config/redis-client.js';

/**
 * 数据收集器
 * 使用 Redis 存储实时价格和持仓数据，提升性能
 */
export class DataCollector {
  constructor() {
    this.redis = redisClient;
  }

  /**
   * 更新量化交易数据
   * @param {object} data - 量化交易状态数据
   */
  async updateQuantData(data) {
    const quantData = {
      ...data,
      timestamp: Date.now()
    };
    
    await this.redis.saveQuantData(quantData);
  }

  /**
   * 获取量化交易数据
   */
  async getQuantData() {
    return await this.redis.getQuantData();
  }

  /**
   * 更新价格数据
   * @param {string} symbol - 合约代码
   * @param {number} price - 当前价格
   */
  async updatePrice(symbol, price) {
    const priceData = {
      price: price,
      timestamp: Date.now()
    };
    
    await this.redis.savePrice(symbol, priceData);
  }

  /**
   * 更新持仓数据
   * @param {string} symbol - 合约代码
   * @param {object} position - 持仓信息
   */
  async updatePosition(symbol, position) {
    const positions = await this.redis.getPositions() || {};
    positions[symbol] = {
      ...position,
      timestamp: Date.now()
    };
    
    await this.redis.savePositions(positions);
  }

  /**
   * 获取价格数据
   * @param {string} symbol - 合约代码
   */
  async getPrice(symbol) {
    return await this.redis.getPrice(symbol);
  }

  /**
   * 获取持仓数据
   * @param {string} symbol - 合约代码
   */
  async getPosition(symbol) {
    const positions = await this.redis.getPositions() || {};
    return positions[symbol];
  }

  /**
   * 获取所有数据
   */
  async getAllData() {
    const [prices, positions, quant] = await Promise.all([
      this.redis.getAllPrices(),
      this.redis.getPositions(),
      this.redis.getQuantData()
    ]);
    
    return {
      prices: prices || {},
      positions: positions || {},
      quant: quant,
      timestamp: Date.now()
    };
  }

  /**
   * 保存数据（兼容旧接口，实际已在各个方法中保存）
   */
  async saveData() {
    // Redis 已在各个方法中实时保存，此方法保留用于兼容
    return true;
  }

  /**
   * 从 Redis 加载数据（兼容旧接口）
   */
  async loadData() {
    // Redis 是实时的，不需要加载
    console.log('✅ 使用 Redis 存储，无需加载文件');
    return true;
  }
}

// 创建全局实例
export const dataCollector = new DataCollector();

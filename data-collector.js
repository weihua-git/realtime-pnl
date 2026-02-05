import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 数据收集器
 * 从监控程序收集实时价格和持仓数据
 */
export class DataCollector {
  constructor() {
    this.dataFile = path.join(__dirname, 'data', 'realtime-data.json');
    this.priceData = new Map(); // 存储实时价格
    this.positionData = new Map(); // 存储持仓数据
  }

  /**
   * 更新价格数据
   * @param {string} symbol - 合约代码
   * @param {number} price - 当前价格
   */
  async updatePrice(symbol, price) {
    this.priceData.set(symbol, {
      price: price,
      timestamp: Date.now()
    });
    
    await this.saveData();
  }

  /**
   * 更新持仓数据
   * @param {string} symbol - 合约代码
   * @param {object} position - 持仓信息
   */
  async updatePosition(symbol, position) {
    this.positionData.set(symbol, {
      ...position,
      timestamp: Date.now()
    });
    
    await this.saveData();
  }

  /**
   * 获取价格数据
   * @param {string} symbol - 合约代码
   */
  getPrice(symbol) {
    return this.priceData.get(symbol);
  }

  /**
   * 获取持仓数据
   * @param {string} symbol - 合约代码
   */
  getPosition(symbol) {
    return this.positionData.get(symbol);
  }

  /**
   * 获取所有数据
   */
  getAllData() {
    return {
      prices: Object.fromEntries(this.priceData),
      positions: Object.fromEntries(this.positionData),
      timestamp: Date.now()
    };
  }

  /**
   * 保存数据到文件
   */
  async saveData() {
    try {
      const data = this.getAllData();
      await fs.writeFile(this.dataFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('保存数据失败:', error.message);
    }
  }

  /**
   * 从文件加载数据
   */
  async loadData() {
    try {
      const content = await fs.readFile(this.dataFile, 'utf-8');
      const data = JSON.parse(content);
      
      if (data.prices) {
        this.priceData = new Map(Object.entries(data.prices));
      }
      
      if (data.positions) {
        this.positionData = new Map(Object.entries(data.positions));
      }
      
      console.log('✅ 数据加载成功');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('加载数据失败:', error.message);
      }
    }
  }
}

// 创建全局实例
export const dataCollector = new DataCollector();

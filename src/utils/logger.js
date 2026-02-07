import dotenv from 'dotenv';

dotenv.config();

/**
 * 日志级别系统
 * 类似 Java Logger，支持不同级别的日志输出
 */
class Logger {
  constructor() {
    // 日志级别定义
    this.LEVELS = {
      ERROR: 0,   // 错误
      WARN: 1,    // 警告
      INFO: 2,    // 信息（默认）
      DEBUG: 3,   // 调试
      TRACE: 4    // 追踪（最详细）
    };

    // 从环境变量读取日志级别，默认 INFO
    const levelStr = (process.env.LOG_LEVEL || 'INFO').toUpperCase();
    this.currentLevel = this.LEVELS[levelStr] ?? this.LEVELS.INFO;

    // 颜色定义（终端颜色）
    this.COLORS = {
      ERROR: '\x1b[31m',   // 红色
      WARN: '\x1b[33m',    // 黄色
      INFO: '\x1b[36m',    // 青色
      DEBUG: '\x1b[35m',   // 紫色
      TRACE: '\x1b[90m',   // 灰色
      RESET: '\x1b[0m'
    };

    // 图标定义
    this.ICONS = {
      ERROR: '❌',
      WARN: '⚠️',
      INFO: 'ℹ️',
      DEBUG: '🔍',
      TRACE: '📝'
    };

    console.log(`📋 日志级别: ${levelStr} (${this.currentLevel})`);
  }

  /**
   * 判断是否应该输出该级别的日志
   */
  shouldLog(level) {
    return this.LEVELS[level] <= this.currentLevel;
  }

  /**
   * 格式化时间戳
   */
  getTimestamp() {
    const now = new Date();
    return now.toLocaleTimeString('zh-CN', { hour12: false });
  }

  /**
   * 输出日志
   */
  log(level, module, message, ...args) {
    if (!this.shouldLog(level)) {
      return;
    }

    const timestamp = this.getTimestamp();
    const color = this.COLORS[level];
    const icon = this.ICONS[level];
    const reset = this.COLORS.RESET;

    // 格式: [时间] 图标 [级别] [模块] 消息
    const prefix = `${color}[${timestamp}] ${icon} [${level}]${reset} ${module ? `[${module}]` : ''}`;
    
    if (args.length > 0) {
      console.log(prefix, message, ...args);
    } else {
      console.log(prefix, message);
    }
  }

  /**
   * ERROR 级别 - 错误信息
   */
  error(module, message, ...args) {
    this.log('ERROR', module, message, ...args);
  }

  /**
   * WARN 级别 - 警告信息
   */
  warn(module, message, ...args) {
    this.log('WARN', module, message, ...args);
  }

  /**
   * INFO 级别 - 一般信息（默认级别）
   */
  info(module, message, ...args) {
    this.log('INFO', module, message, ...args);
  }

  /**
   * DEBUG 级别 - 调试信息
   */
  debug(module, message, ...args) {
    this.log('DEBUG', module, message, ...args);
  }

  /**
   * TRACE 级别 - 追踪信息（最详细）
   */
  trace(module, message, ...args) {
    this.log('TRACE', module, message, ...args);
  }

  /**
   * 创建模块专用的 logger
   */
  module(moduleName) {
    return {
      error: (msg, ...args) => this.error(moduleName, msg, ...args),
      warn: (msg, ...args) => this.warn(moduleName, msg, ...args),
      info: (msg, ...args) => this.info(moduleName, msg, ...args),
      debug: (msg, ...args) => this.debug(moduleName, msg, ...args),
      trace: (msg, ...args) => this.trace(moduleName, msg, ...args)
    };
  }
}

// 导出单例
export const logger = new Logger();

// 导出便捷方法
export const createLogger = (moduleName) => logger.module(moduleName);

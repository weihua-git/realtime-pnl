import crypto from 'crypto';
import { URL } from 'url';

/**
 * HTX API 签名工具类
 */
export class HTXAuth {
  constructor(accessKey, secretKey) {
    this.accessKey = accessKey;
    this.secretKey = secretKey;
  }

  /**
   * 生成 WebSocket 认证参数
   * @param {string} host - WebSocket 主机地址
   * @param {string} path - WebSocket 路径
   * @returns {object} 认证参数对象
   */
  generateAuthParams(host, path) {
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '');
    
    const params = {
      AccessKeyId: this.accessKey,
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
    const signatureString = `GET\n${host}\n${path}\n${sortedParams}`;

    // 生成签名
    const signature = crypto
      .createHmac('sha256', this.secretKey)
      .update(signatureString)
      .digest('base64');

    return {
      ...params,
      Signature: signature
    };
  }

  /**
   * 生成完整的 WebSocket 认证 URL
   * @param {string} wsUrl - WebSocket 基础 URL
   * @returns {string} 带认证参数的完整 URL
   */
  generateAuthUrl(wsUrl) {
    const url = new URL(wsUrl);
    const authParams = this.generateAuthParams(url.host, url.pathname);
    
    const queryString = Object.keys(authParams)
      .map(key => `${key}=${encodeURIComponent(authParams[key])}`)
      .join('&');

    return `${wsUrl}?${queryString}`;
  }
}


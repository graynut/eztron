
const http = require('./http');
//const { log: logger } = require('../../found/logger');

const logger = (err, tip) => {
  console.log(tip);
  console.log(err);
}

const { isAddressValid } = require('./bytes');

const debug = (...args) => {
  // consale.log('DeBug[TronClient]', ...args);
}

/**
 * Token API Client 基础类
 */
class TokenClient {
  initOptions = {};
  host = null;
  connection = null;

  // 连接相关
  dropped = 0;
  keepAlive = false;
  keepAliveTimer = null;

  // 请求选项: 最大并发, 请求间隔, 是否返回时间统计
  rps;
  timing;
  requestTask = [];
  requestPending = 0;

  // keys 相关: key的最大并发, key每日最大使用次数
  keyRps;
  keyName;
  keyLimit;
  resetDay = 0;
  overloadKeys = [];
  apikeys = new Map();
  fronzekeys = new Map();

  // 供子类使用的一些静态方法
  static esleep = http.esleep;

  static isValidAddress(base58Address) {
    const valids = {};
    const onlyOne = !Array.isArray(base58Address);
    base58Address = onlyOne ? [base58Address] : base58Address;
    for (const addr of base58Address) {
      try {
        valids[addr] = isAddressValid(addr);
      } catch {
        valids[addr] = false;
      }
    }
    return onlyOne ? Object.values(valids)[0] : valids;
  }

  static log(data, msg) {
    let { request, host, ...response } = data||{};
    logger({host, request, response}, msg);
  }

  static autoLog(data, msg) {
    if (!data || data?.code !== 200) {
      TokenClient.log(data, msg || ('TokenClient_HTTP_ERROR_' + (data?.code||'UNKOWN')))
    }
    return data;
  }

  static formatOptions(address, options, callback) {
    const onlyOne = !Array.isArray(address);
    address = onlyOne ? [address] : address;
    let addrKey = 'address';
    if (callback) {
      const calltp = typeof callback;
      if (calltp === 'string') {
        addrKey = callback;
        callback = null;
      } else if (calltp !== 'function') {
        throw new Error('callback only support string or function')
      }
    }
    const multis = [];
    const addrStrs = [];
    for (const item of address) {
      const opts =
        typeof item === 'string'
          ? {
              ...options,
              [addrKey]: item,
            }
          : {
              ...options,
              ...item,
            };
      if (addrStrs.includes(opts[addrKey])) {
        continue;
      }
      addrStrs.push(opts[addrKey]);
      multis.push(callback ? callback(opts) : opts);
    }
    return [onlyOne, addrStrs, multis];
  }

  static formatResponse(address, response, onlyOne) {
    const result = {};
    for (let i = 0; i < address.length; i++) {
      result[address[i]] = TokenClient.autoLog(response[i]);
    }
    return onlyOne ? Object.values(result)[0] : result;
  }

  static testResponse(response, onlyOne) {
    for (let address in response) {
      TokenClient.autoLog(response[address]);
    }
    return onlyOne ? Object.values(response)[0] : response;
  }

  // 初始化
  constructor(options) {
    this.initOptions = options;
    let {
      host,
      keys = [],
      rps = 80,
      keyRps = 12,
      keyLimit = 33000,
      keyName = 'TRON-PRO-API-KEY',
      timing = false,
      keepAlive = false,
    } = options;
    this.host = host;
    this.rps = Math.max(1, rps - 1);
    this.timing = timing;
    this.keyRps = keyRps;
    this.keyName = keyName;
    this.keyLimit = keyLimit;
    this.keepAlive = keepAlive;
    this._setKeys(keys);
  }

  /**
   * 克隆当前对象
   * @returns {this}
   */
  clone(){
    return new this.constructor(this.initOptions);
  }

  // 打开 HTTP2 通道
  async connect(trytimes = 3, unping = false) {
    const self = this;
    if (self.connection) {
      if (!self.connection.closed) {
        if (unping) {
          self._setKeepAliveTimer(true);
        }
        return self;
      }
      self.dropped++;
      self.connection = null;
    }
    const connection = await http.createConnection(self.host, trytimes);
    connection.on('close', () => {
      self.connection = null;
    });
    self.connection = connection;
    if (!unping) {
      self._setKeepAliveTimer();
    }
    return self;
  }

  // 保持长链接, 定时发送 ping
  _setKeepAliveTimer(clear = false) {
    const self = this;
    if (self.keepAliveTimer) {
      clearTimeout(self.keepAliveTimer);
      self.keepAliveTimer = null;
    }
    if (clear || !self.keepAlive) {
      return self;
    }
    self.keepAliveTimer = setTimeout(() => {
      self.keepAliveTimer = null;
      if (self.connection && !self.connection.closed) {
        debug('PING');
        self.connection.ping(() => {});
        self._setKeepAliveTimer();
      }
    }, 10000);
    return self;
  }

  // 设置 api keys
  _setKeys(keys) {
    const self = this;
    for (const key of keys) {
      if (self.overloadKeys.includes(key) || self.apikeys.has(key)) {
        continue;
      }
      // 当前保持连接的数量, 今日总调用次数
      self.apikeys.set(key, [0, 0]);
    }
    return self;
  }

  // 获取可用 api keys: 获取数量, 最长可等待时间
  async _getKeys(amount = 1, maxwait = 0) {
    const self = this;
    const now = Date.now();
    const date = Math.floor(now / 86400000);
    // 每日重置
    if (date !== self.resetDay) {
      self.resetDay = date;
      for (key of self.overloadKeys) {
        self.apikeys.set(key, [0, 0]);
      }
    }
    // 解冻临时禁用的 key
    let key, val, count, total;
    for ([key, [val, total]] of self.fronzekeys) {
      if (val < now) {
        debug('unfronze', key);
        self.apikeys.set(key, [0, total]);
      }
    }
    // 获取可用 key
    const keys = [];
    let find = 0,
      remain,
      take;
    amount = Math.max(amount, 1);
    while (true) {
      for ([key, val] of self.apikeys) {
        [count, total] = val;
        if (total >= self.keyLimit) {
          self.apikeys.delete(key);
          self.overloadKeys.push(key);
          continue;
        }
        remain = self.keyRps - count;
        if (remain <= 0) {
          continue;
        }
        take = Math.min(remain, amount - find);
        val[0] += take;
        val[1] += take;
        find += take;
        keys.push(...Array(take).fill(key));
        if (find >= amount) {
          break;
        }
      }
      if (find >= amount || Date.now() - now >= maxwait) {
        break;
      }
      await http.esleep(10);
    }
    debug('getKeys', self.apikeys);
    return keys;
  }

  // 释放或临时禁用一个 api key
  async _freeKey(key, frozen) {
    debug('freeKey', key, frozen);
    const self = this;
    const row = key && self.apikeys.get(key);
    if (!row) {
      return self;
    }
    if (frozen) {
      // key 被限流了, 冻结 frozen 毫秒, 若 frozen 不是数字, 默认为 10s
      frozen = parseInt(frozen);
      self.apikeys.delete(key);
      self.fronzekeys.set(key, [Date.now() + (isNaN(frozen) ? 10000 : frozen), row[1]]);
    } else {
      row[0] = Math.max(0, row[0] - 1);
    }
    debug('afterFreeKey', self.apikeys, self.fronzekeys);
    return self;
  }

  // 接口: 请求前置函数, 可应用 key 到请求参数中
  async _beforeRequest(options, retry = false) {
    const key = (retry || !options[this.keyName]) && (await this._getKeys(1));
    return key
      ? {
          ...options,
          [this.keyName]: key[0],
        }
      : options;
  }

  // 接口: 请求后置函数
  async _afterRequest(response, options) {
    try {
      response.data = JSON.parse(response.data);
    } catch{}
    if (response.code !== 403) {
      return;
    }
    let key = options?.[this.keyName];
    // 本次请求没有使用 key, 那么可以带上 key 再试一次
    if (!key) {
      return await this._beforeRequest(options, true);
    }
    // 使用 key 了, 根据返回结果决定是否冻结当前 key, 换个 key 再试
    let frozen = true;
    if (typeof response?.data?.Error === 'string') {
      frozen = this._getFrozenTime(response.data.Error);
    }
    await this._freeKey(key, frozen);
    return frozen && (await this._beforeRequest(options, true));
  }

  // 接口: 从响应的错误内容, 返回 key 的冻结时长(毫秒), 返回 true 则冻结 10s
  _getFrozenTime(error) {
    debug('Error', error);
    return true;
  }

  // 发送一个请求
  async _sendRequest(options, maxRetry) {
    const self = this;
    const start = self.timing ? Date.now() : 0;
    await self.connect(3, true);
    options = await self._beforeRequest(options);
    const responses = await http.request(
      self.host,
      self.connection,
      options,
      async ({ options, code, headers, data, timing }, times) => {
        const response = { code, headers, data };
        if (timing) {
          response.timing = timing;
        }
        let trit = times + '/' + maxRetry;
        // 超出重试次数, 直接返回
        if (times >= maxRetry) {
          await self._freeKey(options?.[self.keyName]);
          debug('maxtry['+trit+']', code);
          return [response, -1];
        }
        debug('response['+trit+']', code);
        // http stream 错误 || 50X 错误
        if (code === -1 || (code > 500 && code < 600)) {
          return [response, 100];
        }
        // 根据后置函数返回结果 -> 决定是否重试
        const reoptions = await self._afterRequest(response, options);
        debug('retry', !!reoptions);
        return reoptions ? [response, 0, reoptions] : [response, -1];
      },
      start ? { connect: Date.now() - start } : null
    );
    self._setKeepAliveTimer();
    responses.host = this.host;
    responses.request = options;
    return responses;
  }

  // 发送一个请求 或 添加到任务队列
  async _request(options, maxRetry) {
    const self = this;
    if (self.requestPending > self.rps) {
      debug('request add to task', self.requestTask.length);
      return new Promise((resolve, reject) => {
        self.requestTask.push(() => {
          debug('request task pop', self.requestTask.length);
          self._request(options, maxRetry).then(resolve).catch(reject);
        });
      });
    }
    self.requestPending++;
    let res;
    try {
      res = await self._sendRequest(options, maxRetry);
    } catch (error) {
      logger(error, 'TokenClient_REQUEST_ERROR');
    }
    self.requestPending--;
    const task = self.requestTask.shift();
    task && task();
    return res;
  }

  // 发送请求, 可批量发送
  async request(options, multis, maxRetry = 3) {
    let self = this,
      batch = 0;
    if (typeof multis === 'number') {
      maxRetry = multis;
    } else if (Array.isArray(multis)) {
      batch = multis.length;
    }
    if (batch === 0) {
      multis = [{}];
    }
    const tasks = [];
    for (const row of multis) {
      tasks.push(
        self._request(
          {
            ...options,
            ...row,
          },
          maxRetry
        )
      );
    }
    const results = await Promise.all(tasks);
    return batch ? results : results[0];
  }
}

module.exports = TokenClient;

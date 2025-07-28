const TokenClient = require('./TokenClient');
const querystring = require("node:querystring");

/**
 * TronGridClient API 类 
 * https://api.trongrid.io
 */
class TronGridClient extends TokenClient {
  witoutedKey;

  constructor(config){
    super({
      host: 'https://api.trongrid.io',
      ...config
    })
  }

  withoutKey(without = true) {
    this.witoutedKey = !!without;
    return this;
  }

  // 接口: 请求前置函数, 可应用 key 到请求参数中
  async _beforeRequest(options, retry = false) {
    if (this.witoutedKey && !retry) {
      return options;
    }
    return await super._beforeRequest(options, retry);
  }

  // 获取账户的合约信息, 如果账户是合约地址的话
  async getContract(address, maxRetry) {
    const onlyOne = !Array.isArray(address);
    address = onlyOne ? [address] : [...new Set(address)];
    const res = await this.request({
      ":method": "POST",
      ":path": "/wallet/getcontractinfo"
    }, address.map(addr => ({
      payload: '{"value":"'+addr+'","visible":true}'
    })), maxRetry);
    return TokenClient.formatResponse(address, res, onlyOne)
  }

  // 请求 v1 accounts 接口, 可用于获取 trx 和所有 trc20 余额
  async getAccountsV1(address, maxRetry) {
    const onlyOne = !Array.isArray(address);
    address = onlyOne ? [address] : [...new Set(address)];
    const res = await this.request({
      ":method": "GET"
    }, address.map(addr => ({
      ":path": "/v1/accounts/" + addr
    })), maxRetry);
    return TokenClient.formatResponse(address, res, onlyOne)
  }

  // 获取指定地址的资源数据
  async getAccountResource(address, maxRetry) {
    const onlyOne = !Array.isArray(address);
    address = onlyOne ? [address] : [...new Set(address)];
    const res = await this.request({
      ":method": "POST",
      ":path": "/wallet/getaccountresource"
    }, address.map(addr => ({
      payload: '{"address":"'+addr+'","visible":true}'
    })), maxRetry);
    return TokenClient.formatResponse(address, res, onlyOne);
  }

  // 通过 txid 获取交易数据(已确认)
  async getTransactioninfo(txid, maxRetry) {
    const onlyOne = !Array.isArray(txid);
    txid = onlyOne ? [txid] : [...new Set(txid)];
    const res = await this.request({
      ":method": "POST",
      ":path": "/walletsolidity/gettransactioninfobyid"
    }, txid.map(val => ({
      payload: '{"value":"'+val+'"}'
    })), maxRetry);
    return TokenClient.formatResponse(txid, res, onlyOne);
  }

  /**
   * 请求 v1 Trc20 Transactions 接口, 可用于获取 TRC20/TRC721 类型的交易流水
   * @param { String|String[] } address
   * @param {{
   *  only_confirmed: Boolean,
   *  only_unconfirmed: Boolean,
   *  limit: Number,  默认20, 最大200
   *  min_timestamp: Number,
   *  max_timestamp: Number,
   *  contract_address: String, 合约地址,比如 USDT 为 TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t
   *  only_to: Boolean,
   *  only_from: Boolean,
   *  fingerprint: String,
   * 
   *  // 非请求参数
   *  format: false,    是否返回一个格式化的交易列表
   *  checkHash: false, 是否校验最后的 hash 值(主要用于充值轮询)
   *  lastHash: string, 若校验 hash, 指定最后的 hash 值
   *  
   * }} options 
   * @param {Number} maxRetry 
   * @returns
   */
  async getTrc20TransactionsV1(address, options, maxRetry) {
    // 整理请求参数
    const {format, checkHash, lastHash, ...opts} = options||{};
    let [onlyOne, addrStrs, multis] = TokenClient.formatOptions(address, opts, ({
      address:addr,
      ...options
    }) => {
      const query = querystring.stringify(options);
      return {
        ":path": '/v1/accounts/' + addr + '/transactions/trc20' + (query ? '?' + query : '')
      }
    });
    // 若校验 hash, 缓存初始请求参数
    const addrStarted = {};
    if (checkHash) {
      for (const [index, addr] of addrStrs.entries()) {
        addrStarted[addr] = {
          page: 0,
          path: multis[index][':path'],
        }
      }
    }
    // 开始查询
    const transactions = {};
    const withContract = Boolean(opts.contract_address);
    while (multis) {
      const addrList = addrStrs.entries();
      const res = await this.request({
        ":method": "GET"
      }, multis, maxRetry);
      multis = [];
      addrStrs = [];
      for (const [index, addr] of addrList) {
        const response = res[index];
        const datalist = response.code === 200 && format ? response?.data?.data : null;
        if (!Array.isArray(datalist)) {
          transactions[addr] = response;
          continue;
        }
        const lists = [];
        const dataTransfer = [];
        let found = !checkHash;
        for (const row of datalist) {
          if (row?.type !== 'Transfer') {
            continue;
          }
          const item = {
            id: row.transaction_id,
            time: row.block_timestamp,
            trader: row.to == addr ? row.from : row.to,
            amount: row.value * (row.to == addr ? 1 : -1),
            decimals: row?.token_info?.decimals,
          };
          if (!withContract) {
            item.symbol = row?.token_info?.symbol;
          }
          let add = true;
          if (checkHash) {
            if (!lastHash) {
              found = true;
            } else if (item.id === lastHash) {
              add = false;
              found = true;
            }
          }
          if (add) {
            lists.push(item);
            dataTransfer.push(row);
          }
          if (found) {
            break;
          }
        }
        // 需校验 hash 但未找到, 翻页尝试继续找
        if (!found && addrStarted[addr] && addrStarted[addr].page < 10 && response?.data?.meta?.fingerprint) {
          addrStarted[addr].page++;
          let link = addrStarted[addr].path;
          addrStrs.push(addr);
          multis.push({
            ":path": link + (link.indexOf('?') > -1 ? '&' : '?') + 'fingerprint=' + response.data.meta.fingerprint
          });
        }
        if (transactions[addr]) {
          let {data, transfers} = transactions[addr].data;
          data.push(...dataTransfer);
          transfers.push(...lists);
          Object.assign(response.data, {data, transfers});
        } else {
          Object.assign(response.data, {data: dataTransfer, transfers: lists});
        }
        transactions[addr] = response;
      }
      if (!multis.length) {
        multis = null;
      }
    }
    return TokenClient.testResponse(transactions, onlyOne);
  }

}

module.exports = TronGridClient;

const { GridClient } = require("./index");
const { txCheck, txCheckWithArgs } = require("./proto");
const { toUtf8Bytes, SigningKey, AbiCoder } = require('./protocol/ethers');
const {
  isHex,
  isString,
  isObject,
  isNotNullOrUndefined,
  assertValid,

  hex2Uint8Array,
  uint8Array2Hex,
  hexString2Utf8,

  keccak256,
  secp256k1Sign,

  toHexAddress,
  replaceAddressPrefix,
  pkToHex,
} = require("./bytes");

const postRequest = async (path, payload) => {
  const res = await GridClient.request({
    ":method": "POST",
    ":path": path,
    accept: "application/json",
    "content-type": "application/json",
    payload: JSON.stringify(payload),
  });
  if (res?.code !== 200 || !res?.data) {
    throw new Error("Post Failed:" + path);
  }
  return res?.data;
};

/** 
 * 使用 triggerSmartContract 的结果生成签名
-------------------------------------------------------------------------------------------------------------- */

const TRX_MESSAGE_HEADER = "\x19TRON Signed Message:\n32";
const ETH_MESSAGE_HEADER = "\x19Ethereum Signed Message:\n32";

async function sign(transaction, privateKey, priHexAddress, useTronHeader = true, multisig = false) {
  // Message signing
  if (isString(transaction)) {
    if (!isHex(transaction)) {
      throw new Error("Expected hex message input");
    }
    return signString(transaction, privateKey, useTronHeader);
  }
  if (!isObject(transaction)) {
    throw new Error("Invalid transaction provided");
  }
  if (!multisig && transaction.signature) {
    throw new Error("Transaction is already signed");
  }
  if (!multisig) {
    if (priHexAddress.toLowerCase() !== toHexAddress(transaction.raw_data.contract[0].parameter.value.owner_address)) {
      throw new Error("Private key does not match address in transaction");
    }
    if (!txCheck(transaction)) {
      throw new Error("Invalid transaction");
    }
  }
  return signTransaction(privateKey, transaction);
}

function signString(message, privateKey, useTronHeader = true) {
  message = message.replace(/^0x/, "");
  const value = `0x${privateKey.replace(/^0x/, "")}`;
  const signKey = new SigningKey(value);
  const messageBytes = [
    ...toUtf8Bytes(useTronHeader ? TRX_MESSAGE_HEADER : ETH_MESSAGE_HEADER),
    ...hex2Uint8Array(message, true),
  ];
  const messageDigest = keccak256(new Uint8Array(messageBytes));
  const signature = signKey.sign(messageDigest);
  const signatureHex = [
    "0x",
    signature.r.substring(2),
    signature.s.substring(2),
    Number(signature.v).toString(16),
  ].join("");
  return signatureHex;
}

// @TODO transaction type should be determined.
function signTransaction(priKeyBytes, transaction) {
  if (typeof priKeyBytes === "string") {
    priKeyBytes = hex2Uint8Array(priKeyBytes, true);
  }
  const txID = transaction.txID;
  const signature = ECKeySign(hex2Uint8Array(txID, true), priKeyBytes);
  if (Array.isArray(transaction.signature)) {
    if (!transaction.signature.includes(signature)) {
      transaction.signature.push(signature);
    }
  } else {
    transaction.signature = [signature];
  }
  return transaction;
}

function ECKeySign(hashBytes, priKeyBytes) {
  const signature = secp256k1Sign(uint8Array2Hex(hashBytes), uint8Array2Hex(priKeyBytes));
  const r = signature.r.toString(16);
  const s = signature.s.toString(16);
  const v = signature.recovery + 27;
  return r.padStart(64, "0") + s.padStart(64, "0") + v.toString(16).padStart(2, "0").toUpperCase();
}

/** 
 * 创建合约
-------------------------------------------------------------------------------------------------------------- */

async function triggerSmartContract(contractAddress, functionSelector, options, parameters, issuerAddress) {
  const { tokenValue, tokenId, callValue, feeLimit } = Object.assign(
    {
      callValue: 0,
      feeLimit: 150000000,
    },
    options
  );
  assertValid([
    {
      name: "feeLimit",
      type: "integer",
      value: feeLimit,
      gt: 0,
    },
    {
      name: "callValue",
      type: "integer",
      value: callValue,
      gte: 0,
    },
    {
      name: "parameters",
      type: "array",
      value: parameters,
    },
    {
      name: "contract",
      type: "address",
      value: contractAddress,
    },
    {
      name: "issuer",
      type: "address",
      value: issuerAddress,
      optional: true,
    },
    {
      name: "tokenValue",
      type: "integer",
      value: tokenValue,
      gte: 0,
      optional: true,
    },
    {
      name: "tokenId",
      type: "integer",
      value: tokenId,
      gte: 0,
      optional: true,
    },
  ]);
  const args = getTriggerSmartContractArgs(
    contractAddress,
    functionSelector,
    options,
    parameters,
    issuerAddress,
    tokenValue,
    tokenId,
    callValue,
    feeLimit
  );
  let pathInfo = "triggersmartcontract";
  if (options._isConstant) {
    pathInfo = "triggerconstantcontract";
  } else if (options.estimateEnergy) {
    pathInfo = "estimateenergy";
  }
  const transaction = await postRequest(`/wallet${options.confirmed ? "solidity" : ""}/${pathInfo}`, args);
  return resultManagerTriggerSmartContract(transaction, args, options);
}

function getTriggerSmartContractArgs(contractAddress, functionSelector, options, parameters, issuerAddress, tokenValue, tokenId, callValue, feeLimit) {
  const args = {
    contract_address: toHexAddress(contractAddress),
    owner_address: toHexAddress(issuerAddress),
  };
  if (functionSelector && isString(functionSelector)) {
    functionSelector = functionSelector.replace(/\s*/g, "");
    let parameterStr;
    if (parameters.length) {
      let types = [];
      const values = [];
      for (let i = 0; i < parameters.length; i++) {
        let { value } = parameters[i];
        const { type } = parameters[i];
        if (!type || !isString(type) || !type.length) {
          throw new Error("Invalid parameter type provided: " + type);
        }
        if (type === "address") {
          value = replaceAddressPrefix(value);
        } else if (type.match(/^([^\x5b]*)(\x5b|$)/)?.[0] === "address[") {
          value = replaceAddressPrefix(value);
        }
        types.push(type);
        values.push(value);
      }
      try {
        types = types.map((type) => {
          if (/trcToken/.test(type)) {
            type = type.replace(/trcToken/, "uint256");
          }
          return type;
        });
        const abi = new AbiCoder();
        parameterStr = abi.encode(types, values).replace(/^(0x)/, "");
      } catch (ex) {
        throw new Error(ex);
      }
    } else {
      parameterStr = "";
    }
    // work for abiv2 if passed the function abi in options
    // if (options.funcABIV2) {
    //   parameterStr = (0, abi_js_1.encodeParamsV2ByABI)(options.funcABIV2, options.parametersV2).replace(/^(0x)/, '');
    // }
    if (options.shieldedParameter && isString(options.shieldedParameter)) {
      parameterStr = options.shieldedParameter.replace(/^(0x)/, "");
    }
    if (options.rawParameter && isString(options.rawParameter)) {
      parameterStr = options.rawParameter.replace(/^(0x)/, "");
    }
    args.function_selector = functionSelector;
    args.parameter = parameterStr;
  } else if (options.input) {
    args.data = options.input;
  }
  args.call_value = parseInt(callValue);
  if (isNotNullOrUndefined(tokenValue)) {
    args.call_token_value = parseInt(tokenValue);
  }
  if (isNotNullOrUndefined(tokenId)) {
    args.token_id = parseInt(tokenId);
  }
  if (!(options._isConstant || options.estimateEnergy)) {
    args.fee_limit = parseInt(feeLimit);
  }
  if (options.permissionId) {
    args.Permission_id = options.permissionId;
  }
  return args;
}

function resultManagerTriggerSmartContract(transaction, data, options) {
  if (transaction?.Error) {
    throw new Error(transaction.Error);
  }
  let msg = transaction?.result?.message;
  if (msg) {
    throw new Error(isHex(msg) ? hexString2Utf8(msg) : msg);
  }
  if (!(options._isConstant || options.estimateEnergy)) {
    const authResult = txCheckWithArgs(transaction.transaction, data, options);
    if (!authResult) {
      throw new Error("Invalid transaction");
    }
    return transaction;
  }
  return transaction;
}

/** 
 * 广播合约
-------------------------------------------------------------------------------------------------------------- */

async function sendRawTransaction(signedTransaction) {
  if (!isObject(signedTransaction)) {
    throw new Error("Invalid transaction provided");
  }
  if (!signedTransaction.signature || !Array.isArray(signedTransaction.signature)) {
    throw new Error("Transaction is not signed");
  }
  const result = await postRequest("/wallet/broadcasttransaction", signedTransaction);
  return {
    ...result,
    transaction: signedTransaction,
  };
}

/** 
 * 广播合约
-------------------------------------------------------------------------------------------------------------- */

async function transfer(contractAddress, privateKey, toAddress, amount) {
  const issuerAddress = pkToHex(privateKey);
  const parameter = [
    { type: "address", value: toAddress },
    { type: "uint256", value: Math.floor(amount * 1000000) },
  ];
  const trigger = await triggerSmartContract(
    contractAddress,
    "transfer(address,uint256)",
    { feeLimit: 900000000 },
    parameter,
    issuerAddress
  );
  console.log("Custom_triggerSmartContract");
  console.dir(trigger, { depth: null });

  console.log("Custom_signSmartContract");
  const signed = await sign(trigger.transaction, privateKey, issuerAddress);
  console.dir(signed, { depth: null });


  console.log("Custom_sendRawTransaction");
  const result = await sendRawTransaction(signed);
  console.dir(result, { depth: null });
  return result;
}

module.exports = {
  sign,
  triggerSmartContract,
  sendRawTransaction,
  transfer,
};

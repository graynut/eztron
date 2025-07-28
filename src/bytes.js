/** 
 * validations function
------------------------------------------------------------------------ */
const { BigNumber } = require("bignumber.js");

function isBoolean(bool) {
  return typeof bool === "boolean";
}

function isInteger(number) {
  return number !== null && Number.isInteger(Number(number));
}

function isString(string) {
  return typeof string === "string" || (!!string && string.constructor && string.constructor.name === "String");
}

function isObject(obj) {
  return obj === Object(obj) && Object.prototype.toString.call(obj) !== "[object Array]";
}

function isNotNullOrUndefined(val) {
  return val !== null && typeof val !== "undefined";
}

function isHexChar(c) {
  if ((c >= "A" && c <= "F") || (c >= "a" && c <= "f") || (c >= "0" && c <= "9")) {
    return 1;
  }
  return 0;
}

function isHex(string) {
  return typeof string === "string" && !isNaN(parseInt(string, 16)) && /^(0x|)[a-fA-F0-9]+$/.test(string);
}

function isBigNumber(number) {
  return !!number && (number instanceof BigNumber || (number.constructor && number.constructor.name === "BigNumber"));
}

function assertString(string) {
  if (!isString(string)) {
    throw new Error("The passed value is not a valid utf-8 string");
  }
}

function assertHex(hexString) {
  if (!isHex(hexString)) {
    throw new Error("The passed value is not a valid hex string");
  }
}

const validError = {
  invalid(param) {
    return param.msg || `Invalid ${param.name}${param.type === "address" ? " address" : ""} provided`;
  },
  notPositive(param) {
    return `${param.name} must be a positive integer`;
  },
  notEqual(param) {
    return param.msg || `${param.names?.[0]} can not be equal to ${param.names?.[1]}`;
  },
};

function assertValid(params) {
  const normalized = {};
  let no = false;
  for (const param of params) {
    const { name, names, value, type, gt, lt, gte, lte, optional } = param;
    if (optional && (!isNotNullOrUndefined(value) || (type !== "boolean" && value === false))) {
      continue;
    }
    normalized[name] = param.value;
    switch (type) {
      case "address":
        if (!isString(value)) {
          no = true;
        } else if (value.length === 42) {
          if (value.startsWith("41") && isValidHexAddress(value)) {
            // hex 格式必须是 41 开头, 不支持 0x 开头
            normalized[name] = value;
          } else {
            no = true;
          }
        } else {
          let hex = b58AddresstoHex(value);
          if (hex) {
            normalized[name] = hex;
          } else {
            no = true;
          }
        }
        break;
      case "integer":
        if (
          !isInteger(value) ||
          (typeof gt === "number" && value <= gt) ||
          (typeof lt === "number" && value >= lt) ||
          (typeof gte === "number" && value < gte) ||
          (typeof lte === "number" && value > lte)
        ) {
          no = true;
        }
        break;
      case "positive-integer":
        if (!isInteger(value) || value <= 0) {
          throw new Error(validError.notPositive(param));
        }
        break;
      case "tokenId":
        if (!isString(value) || !value.length) {
          no = true;
        }
        break;
      case "notEmptyObject":
        if (!isObject(value) || !Object.keys(value).length) {
          no = true;
        }
        break;
      case "notEqual":
        if (names && normalized[names[0]] === normalized[names[1]]) {
          throw new Error(validError.notEqual(param));
        }
        break;
      case "resource":
        if (!["BANDWIDTH", "ENERGY"].includes(value)) {
          no = true;
        }
        break;
      case "hex":
        if (!isHex(value)) {
          no = true;
        }
        break;
      case "array":
        if (!Array.isArray(value)) {
          no = true;
        }
        break;
      case "not-empty-string":
        if (!isString(value) || !value.length) {
          no = true;
        }
        break;
      case "boolean":
        if (!isBoolean(value)) {
          no = true;
        }
        break;
      case "string":
        if (
          !isString(value) ||
          (typeof gt === "number" && value.length <= gt) ||
          (typeof lt === "number" && value.length >= lt) ||
          (typeof gte === "number" && value.length < gte) ||
          (typeof lte === "number" && value.length > lte)
        ) {
          no = true;
        }
        break;
    }
    if (no) {
      throw new Error(validError.invalid(param));
    }
  }
  return false;
}


/** 
 * convert function
------------------------------------------------------------------------ */

function hex2Uint8Array(hexString, assert) {
  if (assert) {
    assertHex(hexString);
  }
  return Uint8Array.from(Buffer.from(hexString.replace(/^0x/, ""), "hex"));
}

function uint8Array2Hex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

function hexString2Utf8(hexString, assert) {
  if (assert) {
    assertHex(hexString);
  }
  return Buffer.from(hexString.replace(/^0x/, ""), "hex").toString("utf8");
}

function utf8String2Hex(string, assert) {
  if (assert) {
    assertString(string);
  }
  return "0x" + Buffer.from(string, "utf8").toString("hex");
}

function toBigNumber(amount = 0) {
  if (isBigNumber(amount)) {
    return amount;
  }
  if (isString(amount) && /^(-|)0x/.test(amount)) {
    return new BigNumber(amount.replace("0x", ""), 16);
  }
  return new BigNumber(amount.toString(10), 10);
}

function decimalToHex(value) {
  const number = toBigNumber(value);
  const result = number.toString(16);
  return number.isLessThan(0) ? "-0x" + result.slice(1) : "0x" + result;
}

function any2Hex(val) {
  if (isBoolean(val)) {
    return decimalToHex(+val);
  }
  if (isBigNumber(val)) {
    return decimalToHex(val);
  }
  if (typeof val === "object") {
    return utf8String2Hex(JSON.stringify(val));
  }
  if (isString(val)) {
    if (/^(-|)0x/.test(val)) {
      return val;
    }
    if (!isFinite(val) || /^\s*$/.test(val)) {
      return utf8String2Hex(val);
    }
  }
  const result = decimalToHex(val);
  if (result === "0xNaN") {
    throw new Error("The passed value is not convertible to a hex string");
  }
  return result;
}

function any2Uint8Array(val) {
  if (val instanceof Uint8Array) {
    return val;
  }
  if (!val || val.length === 0) {
    return new Uint8Array([]);
  }
  if (!isHex(val)) {
    val = any2Hex(val);
  }
  return hex2Uint8Array(val);
}

/** 
 * hash / encryption funciton
------------------------------------------------------------------------ */

const BaseX = require("base-x");
const { createHash } = require("node:crypto");
const { keccak_256, secp256k1 } = require("./protocol/noble");

const Base58 = BaseX.default("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz");

function sha256(data, encoding = "hex") {
  return createHash("sha256").update(data, encoding).digest();
}

const HexCharacters = "0123456789abcdef";
function hexlify(data) {
  const bytes = any2Uint8Array(data);
  let result = "0x";
  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i];
    result += HexCharacters[(v & 0xf0) >> 4] + HexCharacters[v & 0x0f];
  }
  return result;
}

function keccak256(data) {
  return hexlify(keccak_256(any2Uint8Array(data)));
}

function hexlifySha256(data) {
  return hexlify(sha256(any2Uint8Array(data)));
}

function secp256k1Sign(...args) {
  return secp256k1.sign(...args);
}

/** 
 * trc20 function
------------------------------------------------------------------------ */

function replaceAddressPrefix(value) {
  if (Array.isArray(value)) {
    return value.map((v) => replaceAddressPrefix(v));
  }
  return toHexAddress(value).replace(/^(41)/, "0x");
}

function hexAddressToB58(hex) {
  const start = hex.slice(0, 2);
  if (start === "0x") {
    hex = "41" + hex.slice(2);
  } else if (start !== "41") {
    hex = "41" + hex;
  }
  const address = Buffer.from(hex, "hex");
  const hash = sha256(sha256(address));
  try {
    return Base58.encode(Buffer.concat([address, hash.subarray(0, 4)]));
  } catch {}
}

function b58AddresstoHex(address, uncheck) {
  if (typeof address !== "string" || address.length < 5 || !address.startsWith("T")) {
    return false;
  }
  let hex;
  try {
    hex = Base58.decode(address);
  } catch {
    return false;
  }
  if (hex.length < 5) {
    return false;
  }
  const offset = hex.length - 4;
  address = hex.subarray(0, offset);
  if (!uncheck) {
    const checkSum = hex.subarray(offset);
    const hash = sha256(sha256(address)).subarray(0, 4);
    for (let i = 0; i < 5; i++) {
      if (checkSum[i] !== hash[i]) {
        return false;
      }
    }
  }
  return "41" + Buffer.from(address).toString("hex").slice(2);
}

function isValidB58Address(address) {
  return Boolean(b58AddresstoHex(address));
}

function isValidHexAddress(address) {
  return Boolean(hexAddressToB58(address));
}

function isValidAddress(address) {
  if (!isString(address)) {
    return false;
  }
  if (address.length === 42) {
    return isValidHexAddress(address);
  }
  return isValidB58Address(address);
}

function toHexAddress(address) {
  if (isHex(address)) {
    return address.toLowerCase().replace(/^0x/, "41");
  }
  return b58AddresstoHex(address).toLowerCase();
}

function getPubKeyFromPriKey(priKeyBytes) {
  assertHex(priKeyBytes);
  const pubkey = secp256k1.ProjectivePoint.fromPrivateKey(hex2Uint8Array(priKeyBytes.padStart(64, "0")));
  const xHex = pubkey.x.toString(16).padStart(64, "0");
  const yHex = pubkey.y.toString(16).padStart(64, "0");
  return hex2Uint8Array(`04${xHex}${yHex}`);
}

function pkToHex(privateKey) {
  let pubBytes = getPubKeyFromPriKey(privateKey);
  if (pubBytes.length === 65) {
    pubBytes = pubBytes.slice(1);
  }
  const hash = keccak256(pubBytes).toString().substring(2);
  return "41" + hash.substring(24);
}

function pkToAddress(privateKey) {
  return hexAddressToB58(pkToHex(privateKey));
}

module.exports = {
  isBoolean,
  isInteger,
  isString,
  isObject,
  isNotNullOrUndefined,
  isHexChar,
  isHex,
  isBigNumber,
  assertString,
  assertHex,
  assertValid,

  hex2Uint8Array,
  uint8Array2Hex,
  hexString2Utf8,
  utf8String2Hex,
  toBigNumber,
  any2Hex,
  any2Uint8Array,

  sha256,
  Base58,
  hexlify,
  keccak256,
  hexlifySha256,
  secp256k1Sign,

  replaceAddressPrefix,
  hexAddressToB58,
  b58AddresstoHex,
  isValidB58Address,
  isValidHexAddress,
  isValidAddress,
  toHexAddress,
  pkToHex,
  pkToAddress,
};

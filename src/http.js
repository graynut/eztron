const http2 = require('node:http2');

const logTime = (msg) => {
  console.log(
    `${msg ?? ''}【${new Date().toLocaleString("cn", {timeZone: "Asia/Shanghai"})}】`
  )
}

const esleep = async (time = 1000) => {
  return time > 0
    ? new Promise((resolve) => {
        setTimeout(resolve, time);
      })
    : Promise.resolve();
}

// 创建 ClientHttp2Session
const createConnection = async (host, times = 3) => {
  return new Promise((resolve, reject) => {
    const tryNext = (error) => {
      if (times > 1) {
        setTimeout(() => {
          resolve(createConnection(host, --times));
        }, 100);
      } else {
        reject(error);
      }
    };
    try {
      const session = http2.connect(host);
      session
        .on('connect', () => {
          session.off('error', tryNext);
          resolve(session);
        })
        .on('error', tryNext);
    } catch (error) {
      tryNext(error);
    }
  });
}

/**
 * 使用 ClientHttp2Session 发送请求, 参数 options 多了一个 payload 用于设置 request body
 * @param { string } host
 * @param { import('http2').ClientHttp2Session } session
 * @param { import('http2').OutgoingHttpHeaders, payload:any } options
 * @param { ({options, code, headers, data, timing}, times) => [response, Number, options] } retry
 * @param { Boolean } timing 是否需要统计执行时长
 * @returns Promise<{code, headers, data}>
 * ```
 * retry 函数可根据请求结果, 判断当期请求 是否需要重新尝试
 *   options: 当前请求的 request 参数
 *      code: Response 的 HTTP Code, 有个 -1 的特殊值, 代表未收到响应
 *   headers: Response 的 headers
 *      data: Response 的 实体
 *    timing: 请求各阶段时长的统计信息
 *     times: 已重试的次数
 * 返回
 *  response: 处理后的请求结果, 该值将作为返回值
 *    Number: 否需要重试, 可用值 [ -1:不重试, 0:立即重试, >0 多少毫秒后重试 ]
 *   options: 若重试, 可重置 request 参数, 若无需重置, 该值为 false/null/undefined 都可以
 * ```
 */
const request = async (host, session, options, retry, timing) => {
  const start = timing ? Date.now() : 0;
  const response = await requestSession(
    host,
    session,
    options,
    retry,
    timing ? [] : null
  );
  if (timing) {
    const analytics = response.timing;
    response.timing = {
      ...timing,
      ...analytics[analytics.length - 1],
      total: Date.now() - start,
      retry: analytics,
    };
  }
  return response;
}

const requestSession = async (
  host,
  session,
  options,
  retry,
  timing = null,
  times = 0
) => {
  return new Promise((resolve) => {
    let code = 500,
      headers = {},
      data = '';
    const duration = timing
      ? {
          start: Date.now(),
          request: 0,
          response: 0,
          afterRequest() {
            duration.request = Date.now();
          },
        }
      : null;
    const onEnd = async (error) => {
      if (error) {
        code = -1;
        data = error;
      }
      let response = { code, headers, data },
        next = -1,
        reptions = null;
      if (duration) {
        duration.response = Date.now() - duration.request;
        duration.request = duration.request - duration.start;
        timing.push({
          request: duration.request,
          response: duration.response,
          total: duration.request + duration.response,
        });
        response.timing = timing;
      }
      if (retry && session && !session.closed) {
        try {
          response.options = options;
          [response, next, reptions] = await Promise.resolve(
            retry(response, times)
          );
        } catch (err) {
          logTime('HTTP_RETRY_ERROR');
          console.log('Host: ' + host);
          console.error(err);
        }
      }
      if (next < 0) {
        return resolve(response);
      }
      await esleep(next);
      resolve(
        await requestSession(
          host,
          session,
          reptions || options,
          retry,
          timing,
          ++times
        )
      );
    };
    try {
      const { payload, ...reqHeaders } = options;
      const client = session.request(reqHeaders);
      client
        .on('close', onEnd)
        .on('error', onEnd)
        .on('frameError', onEnd)
        .on('response', (res) => {
          headers = res;
          code = res[':status'];
        })
        .on('data', (chunk) => {
          data += chunk;
        });
      if (payload) {
        client.end(payload, duration?.afterRequest);
      } else if (duration) {
        duration.request = duration.start;
      }
    } catch (error) {
      onEnd(error);
    }
  });
}

module.exports = {
  logTime,
  esleep,
  createConnection,
  request,
}

const fs = require("node:fs");
const path = require("node:path");
const WebSocket = require("ws");
const { randomUUID } = require("crypto");
const debugLogger = require("./debugLogger");
const DatabaseManager = require("./database");
const {
  encodeFullClientRequest,
  encodeAudioOnlyRequest,
  parseAsrServerMessage,
  parseAsrServerErrorMessage,
  CONST,
} = require("./volcengineAsrWsCodec");
const { reportSkynetAsrLog } = require("../services/skynetAsrReportMain");

const SAUC_BIGMODEL_WS_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel";
const SAUC_BIGMODEL_ASYNC_WS_URL = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async";
const SAUC_BIGMODEL_NOSTREAM_WS_URL =
  "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream";
const WEBSOCKET_TIMEOUT_MS = 30000;
const DEFAULT_SAMPLE_RATE = 16000;
const PCM_CHUNK_MS = 200;
const PCM_BYTES_PER_SAMPLE = 2;
const PCM_CHANNELS = 1;
const PCM_CHUNK_BYTES =
  (DEFAULT_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE * PCM_CHANNELS * PCM_CHUNK_MS) / 1000;
const FINAL_RESULT_TIMEOUT_MS = 5000;
const LIVE_FINAL_RESULT_TIMEOUT_MS = 1600;
const MIN_FINAL_RESULT_TIMEOUT_MS = 200;
const DEFAULT_VOLCENGINE_RESOURCE_ID = "volc.seedasr.sauc.duration";
const DEFAULT_PROXY_STREAMING_PATH = "/zanbao/doubao-asr/streaming";
const DEFAULT_ASR_CONTEXT_HINT = "停顿时，不要添加标点符号";
const ASR_CONTEXT_HISTORY_LIMIT = 20;
const ASR_CONTEXT_TOKEN_LIMIT = 800;
let databaseManager = null;

function buildProxyStreamingUrl(origin, resourceId, options = {}) {
  const normalizedOrigin = String(origin || "").trim().replace(/\/+$/, "");
  if (!normalizedOrigin) {
    throw new Error("Streaming proxy origin not configured");
  }
  const endpoint = new URL(`${normalizedOrigin}${DEFAULT_PROXY_STREAMING_PATH}`);
  endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
  endpoint.searchParams.set("resourceId", resourceId || DEFAULT_VOLCENGINE_RESOURCE_ID);
  if (typeof options.wsUrl === "string" && options.wsUrl.trim()) {
    endpoint.searchParams.set("wsUrl", options.wsUrl.trim());
  }
  return endpoint.toString();
}

function buildHotwords(customDictionary) {
  if (!customDictionary) {
    return [];
  }

  const words = Array.isArray(customDictionary) ? customDictionary : [customDictionary];
  return words
    .map((item) => {
      if (typeof item === "string") {
        const word = item.trim();
        return word ? { word } : null;
      }
      if (item && typeof item === "object" && typeof item.word === "string") {
        const word = item.word.trim();
        return word ? { word } : null;
      }
      return null;
    })
    .filter(Boolean);
}

function getPersistentCustomDictionary() {
  try {
    if (!databaseManager) {
      databaseManager = new DatabaseManager();
    }
    const words = databaseManager.getDictionary();
    return Array.isArray(words) ? words : [];
  } catch (error) {
    debugLogger.warn(
      "Failed to load persistent custom dictionary",
      { error: error?.message || String(error) },
      "streaming"
    );
    return [];
  }
}

// 创建带分类码的底层错误，方便 UI 统一展示中文文案。
function createCodedError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// 安全解析 JSON string，上下文格式异常时返回 null，不阻断录音。
function safeParseJson(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// 读取可合并的对象型 JSON 配置。
function readJsonObject(value) {
  const parsed = typeof value === "string" ? safeParseJson(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return { ...parsed };
}

// 粗略估算 ASR context_data token 数，中文按字计，英文按词计。
function estimateContextTokens(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const chineseChars = text.match(/[\u4e00-\u9fff]/g)?.length || 0;
  const words = text.replace(/[\u4e00-\u9fff]/g, " ").match(/[A-Za-z0-9_]+/g)?.length || 0;
  return chineseChars + words;
}

// 规范化 context_data 中的一条文本上下文，最终只传豆包支持的 text 字段。
function normalizeContextDataItem(item) {
  if (typeof item === "string") {
    const text = item.replace(/\s+/g, " ").trim().slice(0, 240);
    return text ? { text } : null;
  }
  if (!item || typeof item !== "object") {
    return null;
  }
  const text = String(item.text || item.content || item.message || item.hint || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  return text ? { text } : null;
}

// 收集旧格式与新格式中的 context_data 文本项。
function collectContextDataItems(value) {
  const parsed = typeof value === "string" ? safeParseJson(value) : value;
  if (Array.isArray(parsed)) {
    return parsed.map(normalizeContextDataItem).filter(Boolean);
  }
  if (!parsed || typeof parsed !== "object") {
    return [];
  }

  const items = [];
  if (parsed.context_data !== undefined) {
    items.push(...collectContextDataItems(parsed.context_data));
  }
  if (Array.isArray(parsed.hints)) {
    items.push(...parsed.hints.map(normalizeContextDataItem).filter(Boolean));
  }
  if (typeof parsed.hint === "string") {
    const hint = normalizeContextDataItem(parsed.hint);
    if (hint) items.push(hint);
  }
  if (Array.isArray(parsed.history)) {
    items.push(...parsed.history.map(normalizeContextDataItem).filter(Boolean));
  }
  if (Array.isArray(parsed.messages)) {
    items.push(...parsed.messages.map(normalizeContextDataItem).filter(Boolean));
  }
  const ownText = normalizeContextDataItem(parsed);
  if (ownText) {
    items.push(ownText);
  }
  return items;
}

// 裁剪 context_data 文本项，控制在 20 条和粗略 800 token 内。
function trimContextDataItems(items) {
  const limited = [];
  const sourceItems = Array.isArray(items) ? items : [];
  const defaultItem = { text: DEFAULT_ASR_CONTEXT_HINT };
  let usedTokens = estimateContextTokens(defaultItem.text);

  for (let index = 0; index < sourceItems.length; index += 1) {
    const item = normalizeContextDataItem(sourceItems[index]);
    if (!item) continue;
    if (item.text === DEFAULT_ASR_CONTEXT_HINT) continue;
    const nextTokens = estimateContextTokens(item.text);
    if (
      limited.length >= ASR_CONTEXT_HISTORY_LIMIT - 1 ||
      usedTokens + nextTokens > ASR_CONTEXT_TOKEN_LIMIT
    ) {
      continue;
    }
    limited.push(item);
    usedTokens += nextTokens;
  }

  return [defaultItem, ...limited];
}

// 合并 context_data，并保持服务端要求的数组结构，由外层 corpus.context 统一序列化。
function mergeContextData(existingContextData) {
  const contextItems = collectContextDataItems(existingContextData);
  return trimContextDataItems(contextItems);
}

// 合并热词，保留已有对象结构并按 word 去重。
function mergeHotwords(...hotwordGroups) {
  const merged = [];
  const seen = new Set();

  for (const group of hotwordGroups) {
    const items = Array.isArray(group) ? group : [];
    for (const item of items) {
      const normalized = typeof item === "string" ? { word: item.trim() } : item;
      const word = String(normalized?.word || "").trim();
      if (!word || seen.has(word)) continue;
      seen.add(word);
      merged.push({ ...normalized, word });
    }
  }

  return merged;
}

// 归一化豆包内置词典名称，过滤空值。
function normalizeDictionaryName(value) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }
  return "";
}

// 从词典缓存对象中读取第一个词典名称。
function readFirstDictionaryNameFromCache(cache) {
  if (!cache || typeof cache !== "object" || Array.isArray(cache)) {
    return "";
  }
  const dictNames = Array.isArray(cache.dictNames) ? cache.dictNames : [];
  return normalizeDictionaryName(dictNames[0]);
}

// 读取主进程身份文件中的商家内置词典缓存。
function readPersistentMerchantBuiltInDictionaryCache() {
  try {
    const { app } = require("electron");
    const identityPath = path.join(app.getPath("userData"), "merchant-identity.json");
    if (!fs.existsSync(identityPath)) return null;
    const identity = JSON.parse(fs.readFileSync(identityPath, "utf8"));
    return identity?.merchantBuiltInDictionaryCache || identity?.builtInDictionaryCache || null;
  } catch {
    return null;
  }
}

// 解析豆包热词表名称：优先缓存首个词典名，其次保留外部传入值，最后使用默认 zanbao_words。
function resolveBoostingTableName(options = {}, corpusOverrides = {}) {
  const cacheCandidates = [
    readPersistentMerchantBuiltInDictionaryCache(),
    options.merchantBuiltInDictionaryCache,
    options.merchantBuiltInDictionary,
    options.builtInDictionaryCache,
  ];
  for (const cache of cacheCandidates) {
    const cachedName = readFirstDictionaryNameFromCache(cache);
    if (cachedName) return cachedName;
  }

  const listCandidates = [
    options.merchantBuiltInDictionaryNames,
    options.builtInDictionaryNames,
    corpusOverrides.dictNames,
  ];
  for (const dictNames of listCandidates) {
    if (!Array.isArray(dictNames)) continue;
    const cachedName = normalizeDictionaryName(dictNames[0]);
    if (cachedName) return cachedName;
  }

  return normalizeDictionaryName(corpusOverrides.boosting_table_name) || "zanbao_words";
}

function resolveCorpusContext(options = {}, corpusOverrides = {}) {
  const context = readJsonObject(corpusOverrides.context || options.request?.corpus?.context);
  if (!context.context_type) {
    context.context_type = "dialog_ctx";
  }
  context.context_data = mergeContextData(context.context_data);
  delete context.hotwords;
  return JSON.stringify(context);
}

class VolcengineStreaming {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.initSent = false;
    this.onPartialTranscript = null;
    this.onFinalTranscript = null;
    this.onError = null;
    this.onSessionEnd = null;
    this.pendingResolve = null;
    this.pendingReject = null;
    this.connectionTimeout = null;
    this.accumulatedText = "";
    this.closeResolve = null;
    this.coldStartBuffer = [];
    this.audioBytesSent = 0;
    this.resourceId = DEFAULT_VOLCENGINE_RESOURCE_ID;
    this.wsUrlOverride = "";
    this.wsUrl = "";
    this.finalResultResolve = null;
    this.finalSent = false;
    this.finalSentAt = 0;
    this.finalReceivedAt = 0;
    this.lastFinalSource = "";
    /** 最近一次首包中的豆包 request，供 Skynet 埋点（与 WS 实际发送一致） */
    this.lastClientRequestPayload = null;
    this.lastClientRequestId = null;
    this.authorization = "";
    this.proxyOrigin = "";
    this.appId = "";
    this.ak = "";
    this.useDirectDoubao = true;
  }

  setCredentials({ resourceId, wsUrl, authorization, proxyOrigin, appId, ak, useDirectDoubao }) {
    if (resourceId) this.resourceId = resourceId;
    this.wsUrlOverride = typeof wsUrl === "string" ? wsUrl.trim() : "";
    this.authorization = typeof authorization === "string" ? authorization.trim() : "";
    this.proxyOrigin = typeof proxyOrigin === "string" ? proxyOrigin.trim() : "";
    this.appId = typeof appId === "string" ? appId.trim() : "";
    this.ak = typeof ak === "string" ? ak.trim() : "";
    this.useDirectDoubao = useDirectDoubao !== false;
  }

  ensureCredentials() {
    if (this.useDirectDoubao && (!this.appId || !this.ak)) {
      throw new Error("Doubao ASR config missing appId or ak");
    }
    return true;
  }

  // 生成当前豆包流式识别模型标识，便于日志和对比页区分 1.0/2.0。
  getModelName() {
    return `doubao-streaming-bigmodel:${this.resourceId}`;
  }

  // 返回当前会话实际使用的火山 WebSocket 地址，便于定位 1.0/2.0 endpoint 差异。
  getWsUrl(options = {}) {
    if (this.useDirectDoubao) {
      return this.wsUrlOverride || SAUC_BIGMODEL_ASYNC_WS_URL;
    }
    return buildProxyStreamingUrl(this.proxyOrigin, this.resourceId, {
      ...options,
      wsUrl: this.wsUrlOverride,
    });
  }

  buildSessionConfig(options = {}) {
    const uid = options.uid || `youzanvoice-${randomUUID()}`;
    const audio = {
      format: "pcm",
      rate: options.sampleRate || 16000,
      bits: 16,
      channel: 1,
    };
    if (options.language && options.language !== "auto") {
      const lang = options.language;
      if (lang.startsWith("zh")) {
        audio.language = "zh-CN";
      } else if (lang.length === 2) {
        const map = { en: "en-US", ja: "ja-JP", ko: "ko-KR" };
        audio.language = map[lang] || `${lang}-${lang.toUpperCase()}`;
      } else {
        audio.language = lang;
      }
    }

    const requestOverrides = options.request || {};
    const corpusOverrides = requestOverrides.corpus || {};
    const corpusContext = resolveCorpusContext(options, corpusOverrides);
    const boostingTableName = resolveBoostingTableName(options, corpusOverrides);
    const corpus = {
      correct_table_name: "word_replace_zanbao",
      ...corpusOverrides,
      boosting_table_name: boostingTableName,
    };
    if (corpusContext) {
      corpus.context = corpusContext;
    }

    const request = {
      model_name: "bigmodel",
      show_utterances: true,
      enable_nonstream: true,
      enable_poi_fc: true,
      enable_itn: true,
      enable_ddc: true,
      enable_lid: true,
      ...requestOverrides,
      corpus,
    };
    console.log('[VolcengineStreaming] asr.request', request);

    const requestId =
      (typeof request.request_id === "string" && request.request_id.trim()) ||
      (typeof request.requestId === "string" && request.requestId.trim()) ||
      randomUUID();
    request.request_id = requestId;
    if ("requestId" in request) {
      delete request.requestId;
    }

    this.lastClientRequestId = requestId;
    try {
      this.lastClientRequestPayload = JSON.parse(JSON.stringify(request));
    } catch {
      this.lastClientRequestPayload = { ...request };
    }

    return {
      user: { uid },
      audio,
      request,
    };
  }

  async warmup() {
    try {
      this.ensureCredentials();
      debugLogger.debug("Volcengine streaming credentials verified", {}, "streaming");
      return;
    } catch (error) {
      debugLogger.error("Volcengine warmup failed", { error: error.message }, "streaming");
      throw error;
    }
  }

  hasWarmConnection() {
    return false;
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      sessionId: null,
    };
  }

  sendAudio(pcmBuffer) {
    const buf = Buffer.isBuffer(pcmBuffer) ? pcmBuffer : Buffer.from(pcmBuffer);

    if (!this.ws || !this.initSent) {
      this.coldStartBuffer.push(Buffer.from(buf));
      return false;
    }

    if (this.ws.readyState !== WebSocket.OPEN) {
      if (this.ws?.readyState === WebSocket.CONNECTING) {
        this.coldStartBuffer.push(Buffer.from(buf));
      }
      return false;
    }

    this._flushColdStart();

    try {
      const packet = encodeAudioOnlyRequest(buf);
      this.ws.send(packet);
      this.audioBytesSent += buf.length;
    } catch (err) {
      debugLogger.error("Volcengine sendAudio error", { error: err.message }, "streaming");
      return false;
    }
    return true;
  }

  _flushColdStart() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.initSent) return;
    if (this.coldStartBuffer.length === 0) return;

    debugLogger.debug(
      "Volcengine flushing cold-start PCM",
      { chunks: this.coldStartBuffer.length },
      "streaming"
    );
    for (const chunk of this.coldStartBuffer) {
      const packet = encodeAudioOnlyRequest(chunk);
      this.ws.send(packet);
      this.audioBytesSent += chunk.length;
    }
    this.coldStartBuffer = [];
  }

  _handleBinaryMessage(buffer) {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    if (buf.length < 2) return;

    const messageType = buf[1] >> 4;
    if (messageType === CONST.SERVER_ERROR_RESPONSE) {
      const parsed = parseAsrServerErrorMessage(buf);
      const msg =
        parsed?.error ||
        parsed?.message ||
        parsed?.msg ||
        parsed?.raw ||
        (typeof parsed === "string" ? parsed : "Volcengine ASR server error");
      debugLogger.error("Volcengine ASR server error", parsed || { message: msg }, "streaming");
      this.onError?.(createCodedError(String(msg), "ASR_SERVICE_ERROR"));
      return;
    }

    const parsed = parseAsrServerMessage(buf, { hasSequence: true });
    if (!parsed) return;

    const utterances =
      (Array.isArray(parsed.result?.utterances) && parsed.result.utterances) ||
      (Array.isArray(parsed.utterances) && parsed.utterances) ||
      [];

    let text = "";
    if (parsed.result && typeof parsed.result.text === "string") {
      text = parsed.result.text;
    } else if (parsed.result && Array.isArray(parsed.result) && parsed.result[0]?.text) {
      text = parsed.result.map((r) => r.text).join("");
    } else if (utterances.length) {
      text = utterances.map((u) => u.text || "").join("");
    } else if (typeof parsed.text === "string") {
      text = parsed.text;
    }

    if (!text) return;

    const hasUtteranceDefiniteness = utterances.some((u) => typeof u.definite === "boolean");
    const utterancesFinal = utterances.length > 0 && utterances.every((u) => u.definite);
    const sessionFinal = Boolean(parsed.is_final || parsed.final || parsed.result?.is_final);
    const isFinal = hasUtteranceDefiniteness ? utterancesFinal : sessionFinal;

    if (isFinal) {
      this.accumulatedText = text.trim();
      this.finalReceivedAt = Date.now();
      this.lastFinalSource = utterancesFinal ? "definite-utterances" : "session-final";
      this.onFinalTranscript?.(this.accumulatedText);
      if (this.finalResultResolve) {
        this.finalResultResolve(this.accumulatedText);
        this.finalResultResolve = null;
      }
    } else {
      this.onPartialTranscript?.(text);
    }
  }

  async transcribePCM(pcmBuffer, options = {}) {
    const buf = Buffer.isBuffer(pcmBuffer) ? pcmBuffer : Buffer.from(pcmBuffer);
    if (!buf.length) {
      return "";
    }

    this.accumulatedText = "";
    await this.connect(options);

    for (let offset = 0; offset < buf.length; offset += PCM_CHUNK_BYTES) {
      const chunk = buf.subarray(offset, offset + PCM_CHUNK_BYTES);
      this.sendAudio(chunk);
    }

    this.finalize();

    let finalText = this.accumulatedText;
    try {
      finalText = await Promise.race([
        new Promise((resolve) => {
          this.finalResultResolve = resolve;
        }),
        new Promise((resolve) => {
          setTimeout(() => resolve(this.accumulatedText), FINAL_RESULT_TIMEOUT_MS);
        }),
      ]);
    } finally {
      this.finalResultResolve = null;
      const result = await this.disconnect();
      finalText = result?.text || finalText || this.accumulatedText;
    }

    return typeof finalText === "string" ? finalText.trim() : "";
  }

  async connect(options = {}) {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {
        /* ignore */
      }
      this.cleanup();
    }

    this.accumulatedText = "";
    this.audioBytesSent = 0;
    this.coldStartBuffer = [];
    this.initSent = false;
    this.finalSent = false;
    this.finalSentAt = 0;
    this.finalReceivedAt = 0;
    this.lastFinalSource = "";
    this.lastClientRequestId = null;
    this.lastClientRequestPayload = null;

    this.ensureCredentials();
    const wsUrl = this.getWsUrl(options);
    this.wsUrl = wsUrl;
    const sessionConfig = this.buildSessionConfig(options);
    const connectId = randomUUID();
    const headers = this.useDirectDoubao
      ? {
          "X-Api-App-Key": this.appId,
          "X-Api-Access-Key": this.ak,
          "X-Api-Resource-Id": this.resourceId,
          "X-Api-Connect-Id": connectId,
          "X-Api-Request-Id": connectId,
        }
      : this.authorization
        ? { Authorization: this.authorization }
        : {};

    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;

      this.connectionTimeout = setTimeout(() => {
        this.cleanup();
        const err = createCodedError("Volcengine WebSocket connection timeout", "NETWORK_ERROR");
        if (this.pendingReject) {
          this.pendingReject(err);
          this.pendingReject = null;
          this.pendingResolve = null;
        }
      }, WEBSOCKET_TIMEOUT_MS);

      this.ws = new WebSocket(wsUrl, { headers });

      this.ws.on("open", () => {
        try {
          const initBuf = encodeFullClientRequest(sessionConfig);
          this.ws.send(initBuf);
          this.initSent = true;
          this.isConnected = true;
          this._flushColdStart();
          clearTimeout(this.connectionTimeout);
          this.connectionTimeout = null;
          if (this.pendingResolve) {
            this.pendingResolve();
            this.pendingResolve = null;
            this.pendingReject = null;
          }
          debugLogger.debug(
            "Volcengine streaming session started",
            { resourceId: this.resourceId, wsUrl, connectionMode: this.useDirectDoubao ? "direct_doubao" : "server_proxy" },
            "streaming"
          );
          reportSkynetAsrLog({
            requestId: this.lastClientRequestId || "",
            request: this.lastClientRequestPayload || {},
          });
        } catch (err) {
          clearTimeout(this.connectionTimeout);
          this.connectionTimeout = null;
          this.cleanup();
          if (this.pendingReject) {
            this.pendingReject(err);
            this.pendingReject = null;
            this.pendingResolve = null;
          }
        }
      });

      this.ws.on("message", (data) => {
        try {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
          this._handleBinaryMessage(buf);
        } catch (err) {
          debugLogger.error("Volcengine message error", { error: err.message }, "streaming");
        }
      });

      this.ws.on("error", (error) => {
        debugLogger.error("Volcengine WebSocket error", { error: error.message }, "streaming");
        error.code = error.code || "NETWORK_ERROR";
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
        if (this.pendingReject) {
          this.pendingReject(error);
          this.pendingReject = null;
          this.pendingResolve = null;
        }
        this.onError?.(error);
      });

      this.ws.on("close", (code, reason) => {
        const wasActive = this.isConnected;
        debugLogger.debug(
          "Volcengine WebSocket closed",
          { code, reason: reason?.toString(), wasActive },
          "streaming"
        );
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
        if (this.pendingReject) {
          this.pendingReject(
            createCodedError(`WebSocket closed before ready (code: ${code})`, "NETWORK_ERROR")
          );
          this.pendingReject = null;
          this.pendingResolve = null;
        }
        if (this.closeResolve) {
          this.closeResolve({
            text: this.accumulatedText,
            model: this.getModelName(),
            audioBytesSent: this.audioBytesSent,
            finalSource: this.lastFinalSource,
          });
          this.closeResolve = null;
        }
        this.cleanup();
        if (wasActive) {
          this.onSessionEnd?.({ text: this.accumulatedText });
        }
      });
    });
  }

  finalize() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.finalSent) {
      return false;
    }

    try {
      this.ws.send(encodeAudioOnlyRequest(Buffer.alloc(0), { isLast: true }));
      this.finalSent = true;
      this.finalSentAt = Date.now();
      return true;
    } catch (err) {
      debugLogger.error("Volcengine finalize error", { error: err.message }, "streaming");
      return false;
    }
  }

  waitForFinalResult(timeoutMs = LIVE_FINAL_RESULT_TIMEOUT_MS) {
    if (!this.finalSent) {
      return Promise.resolve(this.accumulatedText);
    }
    if (this.finalSentAt && this.finalReceivedAt >= this.finalSentAt && this.accumulatedText) {
      return Promise.resolve(this.accumulatedText);
    }

    const safeTimeoutMs = Math.max(
      MIN_FINAL_RESULT_TIMEOUT_MS,
      Math.min(Number(timeoutMs) || LIVE_FINAL_RESULT_TIMEOUT_MS, LIVE_FINAL_RESULT_TIMEOUT_MS)
    );
    return new Promise((resolve) => {
      let settled = false;
      const finish = (text) => {
        if (settled) return;
        settled = true;
        if (this.finalResultResolve === finish) {
          this.finalResultResolve = null;
        }
        resolve(typeof text === "string" ? text : this.accumulatedText);
      };

      this.finalResultResolve = finish;
      setTimeout(() => finish(this.accumulatedText), safeTimeoutMs);
    });
  }

  cleanup() {
    this.isConnected = false;
    this.initSent = false;
    this.ws = null;
    this.finalResultResolve = null;
    this.finalSent = false;
    this.finalSentAt = 0;
    this.finalReceivedAt = 0;
    this.lastFinalSource = "";
  }

  async disconnect(options = {}) {
    if (!this.ws) {
      return {
        text: this.accumulatedText,
        model: this.getModelName(),
        audioBytesSent: this.audioBytesSent,
        finalSource: this.lastFinalSource,
      };
    }

    if (this.ws.readyState === WebSocket.OPEN && this.finalSent) {
      const waitStart = Date.now();
      const finalResultTimeoutMs = options.finalResultTimeoutMs || LIVE_FINAL_RESULT_TIMEOUT_MS;
      await this.waitForFinalResult(finalResultTimeoutMs);
      debugLogger.info(
        "Volcengine final result wait complete",
        {
          requestedTimeoutMs: finalResultTimeoutMs,
          elapsedMs: Date.now() - waitStart,
          textLength: this.accumulatedText.length,
          finalSource: this.lastFinalSource,
        },
        "streaming"
      );
    }

    return new Promise((resolve) => {
      this.closeResolve = resolve;
      try {
        this.ws.close();
      } catch {
        this.cleanup();
        resolve({
          text: this.accumulatedText,
          model: this.getModelName(),
          audioBytesSent: this.audioBytesSent,
          finalSource: this.lastFinalSource,
        });
        this.closeResolve = null;
      }
    });
  }
}

module.exports = VolcengineStreaming;

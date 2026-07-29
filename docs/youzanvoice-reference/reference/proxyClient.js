const fs = require("node:fs");
const path = require("node:path");

// dev模式的host
const DEV_PROXY_HOST = "www.m-qa.youzan.com";
//线上模式的host
const PROD_PROXY_HOST = "www.youzan.com";
const PROXY_HOST =
  process.env.NODE_ENV === "development" ? DEV_PROXY_HOST : PROD_PROXY_HOST;
const PROXY_ORIGIN = `http://${PROXY_HOST}`;

const PROXY_HEADERS = {
  "content-type": "application/json",
};

/**
 * 生成用于终端打印的安全请求体，移除过大的文件 base64 内容。
 */
function sanitizeRequestBodyForLog(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return body;
  }

  if (!body.file || typeof body.file !== "object" || Array.isArray(body.file)) {
    return body;
  }

  const sanitizedFile = { ...body.file };
  delete sanitizedFile.data;
  delete sanitizedFile.contentBase64;
  delete sanitizedFile.base64;

  return {
    ...body,
    file: sanitizedFile,
  };
}

/**
 * 从上传接口响应中提取 uploadFileId，兼容不同命名风格。
 */
function extractUploadFileId(response) {
  const candidates = [
    response?.data?.uploadFileId,
    response?.data?.upload_file_id,
    response?.uploadFileId,
    response?.upload_file_id,
  ];
  const matched = candidates.find((value) => typeof value === "string" && value.trim());
  return matched ? matched.trim() : "";
}

/**
 * 读取本地商家身份文件。
 * 失败时返回空对象，避免影响主流程。
 */
function readMerchantIdentity() {
  try {
    const { app } = require("electron");
    const userDataDir = app.getPath("userData");
    const identityPath = path.join(userDataDir, "merchant-identity.json");
    if (!fs.existsSync(identityPath)) {
      return {};
    }
    const parsed = JSON.parse(fs.readFileSync(identityPath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * 读取当前登录用户名，用于代理请求透传。
 */
function getCurrentUserName() {
  try {
    const parsed = readMerchantIdentity();
    if (parsed?.phone) {
      const digits = String(parsed.phone).replace(/\D/g, "");
      return digits.length === 11 ? `${digits.slice(0, 3)}****${digits.slice(7)}` : digits;
    }
  } catch {
    // 忽略读取失败
  }
  return "";
}

/**
 * 读取当前登录 token，用于代理请求鉴权。
 */
function getCurrentAuthToken() {
  const parsed = readMerchantIdentity();
  const token = typeof parsed?.token === "string" ? parsed.token.trim() : "";
  return token;
}

/**
 * 为代理请求体补齐当前登录用户名，便于后端识别调用人。
 */
function withUserName(body) {
  return {
    ...(body && typeof body === "object" && !Array.isArray(body) ? body : {}),
    userName: getCurrentUserName(),
  };
}


function getProxyOrigin() {
  return PROXY_ORIGIN;
}

/**
 * 构造代理请求头。
 * 若本地存在登录 token，则附加到 authorization 字段。
 */
function buildProxyHeaders() {
  const token = getCurrentAuthToken();
  return {
    ...PROXY_HEADERS,
    _platform: process.arch === "arm64" ? "macOS" : "intel",
    ...(token ? { authorization: token } : {}),
  };
}

/**
 * GET 代理：查询参数与 `withUserName` 一致（会附加 `userName`）；对象值会 `JSON.stringify` 后入参。
 * @param {string} path  - 代理接口路径，如 "/zanbao/skynet-report.json"
 * @param {object} query - 查询字段（平铺进 search）
 * @param {string} label - 用于错误日志的标识
 * @returns {Promise<object>} 解析后的 JSON 响应
 */
async function proxyGet(path, query = {}, label = "Proxy") {
  const merged = withUserName(query);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === null) continue;
    const encoded =
      typeof value === "object" && !Array.isArray(value)
        ? JSON.stringify(value)
        : String(value);
    params.set(key, encoded);
  }
  const qs = params.toString();
  const url = `${getProxyOrigin(label)}${path}${qs ? `?${qs}` : ""}`;
  console.log(`[PROXY] ${label} GET ${url}`);
  const response = await fetch(url, {
    method: "GET",
    headers: buildProxyHeaders(),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `${label} GET failed (${response.status}): ${errorText || response.statusText}`
    );
  }

  const json = await response.json().catch(() => ({}));
  return json;
}

/**
 * @param {string} path  - 代理接口路径，如 "/zanbao/llm/proxy.json"
 * @param {object} body  - 请求体（会被 JSON.stringify）
 * @param {string} label - 用于错误日志的标识
 * @returns {Promise<object>} 解析后的 JSON 响应
 */
async function proxyPost(path, body, label = "Proxy") {
  const url = `${getProxyOrigin(label)}${path}`;
  const requestBody = withUserName(body);
  const safeRequestBody = sanitizeRequestBodyForLog(requestBody);
  console.log(`[PROXY] ${label} request to ${url}, body: ${JSON.stringify(safeRequestBody)}`);
  const response = await fetch(url, {
    method: "POST",
    headers: buildProxyHeaders(),
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `${label} request failed (${response.status}): ${errorText || response.statusText}`
    );
  }

  const json = await response.json().catch(() => ({}));
  console.log(`[PROXY] ${label} response: ${JSON.stringify(json)}`);
  return json;
}

/**
 * JSON 代理：在原有 JSON 请求体上追加 file 对象。
 */
async function proxyPostWithFile(path, body = {}, file = null, label = "Proxy") {
  const requestBody = {
    ...(body && typeof body === "object" && !Array.isArray(body) ? body : {}),
    ...(file ? { file } : {}),
  };
  return proxyPost(path, requestBody, label);
}

/**
 * multipart 代理：上传文件并附带简单表单字段。
 */
async function proxyPostMultipart(path, fields = {}, file = null, label = "Proxy") {
  const url = `${getProxyOrigin(label)}${path}`;
  const formData = new FormData();
  const mergedFields = withUserName(fields);

  for (const [key, value] of Object.entries(mergedFields)) {
    if (value === undefined || value === null) continue;
    formData.append(key, String(value));
  }

  if (file?.filePath) {
    const buffer = fs.readFileSync(file.filePath);
    const blob = new Blob([buffer], { type: file.mimeType || "application/octet-stream" });
    const fileName = file.fileName || path.basename(file.filePath) || "upload-file";
    formData.append("file", blob, fileName);
  }

  console.log(
    `[PROXY] ${label} multipart request to ${url}, body: ${JSON.stringify({
      ...mergedFields,
      file: file?.filePath
        ? {
            name: file.fileName || path.basename(file.filePath) || "upload-file",
            mimeType: file.mimeType || "application/octet-stream",
          }
        : undefined,
    })}`
  );

  const token = getCurrentAuthToken();
  const headers = { _platform: process.platform, ...(token ? { authorization: token } : {}) };
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `${label} multipart request failed (${response.status}): ${errorText || response.statusText}`
    );
  }

  const json = await response.json().catch(() => ({}));
  console.log(`[PROXY] ${label} response: ${JSON.stringify(json)}`);
  return json;
}

/**
 * 上传截图分析文件并返回 uploadFileId。
 */
async function proxyUploadAnalysisFile(file, label = "UploadAnalysisFile") {
  const response = await proxyPostMultipart(
    "/zanbao/llm/dify-flow/upload-file.json",
    { type: "image" },
    file,
    label
  );
  const uploadFileId = extractUploadFileId(response);
  if (!uploadFileId) {
    throw new Error("Upload file response missing uploadFileId");
  }
  return { uploadFileId, raw: response };
}

async function proxyPostRaw(path, body, label = "Proxy") {
  const url = `${getProxyOrigin(label)}${path}`;
  const requestBody = withUserName(body);
  const safeRequestBody = sanitizeRequestBodyForLog(requestBody);
  console.log(`[PROXY] ${label} raw request to ${url}, body: ${JSON.stringify(safeRequestBody)}`);
  const response = await fetch(url, {
    method: "POST",
    headers: buildProxyHeaders(),
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `${label} request failed (${response.status}): ${errorText || response.statusText}`
    );
  }

  return response;
}

module.exports = {
  proxyPost,
  proxyPostWithFile,
  proxyPostMultipart,
  proxyUploadAnalysisFile,
  proxyPostRaw,
  proxyGet,
  getCurrentUserName,
};

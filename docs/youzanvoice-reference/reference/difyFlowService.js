const {
  proxyPost,
  proxyPostWithFile,
  proxyUploadAnalysisFile,
  getCurrentUserName,
} = require("./proxyClient");
const AI_OPTIMIZE_PROXY_PATH = "/zanbao/llm/dify-flow/ai-optimize.json";
const AI_OPTIMIZE_STRUCTURED_QUERY_TYPE = "1";
const AI_OPTIMIZE_PLAIN_QUERY_TYPE = "2";
const COMMAND_DICTATION_QUERY_TYPE = "4";

const AI_OPTIMIZE_SCREENSHOT_QUERY_TYPE = "4";

// 根据结构化整理开关对应的提示模式，映射 Dify 工作流查询类型。
function getAiOptimizeQueryType(promptMode) {
  return promptMode === "structured"
    ? AI_OPTIMIZE_STRUCTURED_QUERY_TYPE
    : AI_OPTIMIZE_PLAIN_QUERY_TYPE;
}

class DifyFlowService {
  /**
   * 上传语音助手图片，并返回 uploadFileId。
   */
  async uploadAnalysisFile(file) {
    if (!file?.filePath) {
      throw new Error("Upload analysis file requires filePath");
    }
    return proxyUploadAnalysisFile(file, "UploadAnalysisFile");
  }

  /**
   * 调用后端 Dify Flow 代理接口做录音后智能优化。
   * @param {string} text
   * @returns {Promise<{answer: string, elapsedMs: number}>}
   */
  async queryAiOptimize(text, options = {}) {
    const trimmed = (text || "").trim();
    if (!trimmed) return { answer: "", elapsedMs: 0 };

    const startedAt = Date.now();
    const promptMode = options.promptMode === "structured" ? "structured" : "plain";
    const queryType = String(options.queryType || getAiOptimizeQueryType(promptMode));
    const requestBody = {
      text: trimmed,
      queryType,
      userName: getCurrentUserName() || "zanbao-desktop",
    };

    console.log(`[DifyFlowService] queryAiOptimize via proxy: ${trimmed}`);
    const response =
      queryType === AI_OPTIMIZE_SCREENSHOT_QUERY_TYPE && options.file
        ? await proxyPostWithFile(
            AI_OPTIMIZE_PROXY_PATH,
            requestBody,
            options.file,
            "AiOptimize"
          )
        : await proxyPost(AI_OPTIMIZE_PROXY_PATH, requestBody, "AiOptimize");

    const elapsedMs = Date.now() - startedAt;
    const normalizedAnswer = String(response?.data?.answer || "").trim();
    console.log(
      `[DifyFlowService] proxy optimize elapsedMs=${elapsedMs}, textLength=${normalizedAnswer.length}`
    );
    if (!normalizedAnswer) {
      throw new Error("AI optimize returned empty answer");
    }

    return { answer: normalizedAnswer, elapsedMs };
  }

  /**
   * 调用 Dify 指令输入工作流，把用户口述指令和选中文本上下文转换成最终可粘贴文本。
   * @param {{instruction?: string, selectedText?: string}} payload
   * @returns {Promise<{answer: string, elapsedMs: number}>}
   */
  async queryCommandText(payload = {}) {
    const instruction = String(payload?.instruction || "").trim();
    const selectedText = String(payload?.selectedText || "").trim();
    if (!instruction && !selectedText) {
      return { answer: "", elapsedMs: 0 };
    }

    const startedAt = Date.now();
    const composedText = selectedText
      ? `用户选中的文本：${selectedText}\n用户的指令：${instruction || "请根据选中文本生成合适内容"}`
      : instruction;

    console.log(
      `[DifyFlowService] queryCommandText via proxy: instructionLength=${instruction.length}, selectedLength=${selectedText.length}`
    );
    const response = await proxyPost(
      AI_OPTIMIZE_PROXY_PATH,
      {
        text: composedText,
        instruction,
        selectedText,
        context: selectedText,
        queryType: COMMAND_DICTATION_QUERY_TYPE,
        userName: getCurrentUserName() || "zanbao-desktop",
      },
      "DifyCommand"
    );

    const elapsedMs = Date.now() - startedAt;
    const normalizedAnswer = String(
      response?.data?.answer ||
        response?.data?.text ||
        response?.answer ||
        response?.text ||
        ""
    ).trim();
    console.log(
      `[DifyFlowService] command elapsedMs=${elapsedMs}, textLength=${normalizedAnswer.length}`
    );
    if (!normalizedAnswer) {
      throw new Error("Dify command returned empty answer");
    }

    return { answer: normalizedAnswer, elapsedMs };
  }
}

const service = new DifyFlowService();

module.exports = service;

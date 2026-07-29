# 有赞语音输入 3.2.3 参考源码

本目录文件来自本机已安装的**有赞语音输入 3.2.3** 的 `app.asar` 静态解包，**仅作 SayIt 功能研究与实现参考**，不构成对原软件的再分发或商业使用授权。

## 来源说明

- 产品：有赞语音输入
- 版本：3.2.3
- 解包方式：对本机安装包内 `app.asar` 做静态解包
- 用途：对照理解 ASR 流式、文本纠错学习、截图上下文、Dify 流程、代理客户端等实现思路，辅助 SayIt 自研实现

## 源路径 → 目标文件

| # | 解包源路径 | 目标文件 | 用途概要 |
|---|------------|----------|----------|
| 1 | `src/utils/correctionLearner.js` | `correctionLearner.js` | 用户纠错学习与替换规则沉淀 |
| 2 | `src/helpers/textEditMonitor.js` | `textEditMonitor.js` | 文本编辑/光标区域监听与输入状态辅助 |
| 3 | `src/services/screenshotCaptureService.js` | `screenshotCaptureService.js` | 屏幕截图采集，供上下文理解 |
| 4 | `src/services/difyFlowService.js` | `difyFlowService.js` | Dify 工作流调用封装 |
| 5 | `src/helpers/volcengineStreaming.js` | `volcengineStreaming.js` | 火山引擎 ASR 流式识别相关逻辑 |
| 6 | `src/services/proxyClient.js` | `proxyClient.js` | 代理/中转客户端请求封装 |
| 7 | `src/config/builtinAsrDictionary.js` | `builtinAsrDictionary.js` | 内置 ASR 热词/词典配置 |
| 8 | `src/utils/contextClassifier.ts` | `contextClassifier.ts` | 上下文场景分类（TypeScript） |

解包根目录示例（本机临时路径，可能随环境变化）：

```
.../youzanvoice-asar/
```

## 安全与配置约束

- **SayIt 必须使用自己的 ASR / LLM / 鉴权配置**，不得复用或照搬有赞侧账号体系。
- 本目录参考文件**不包含**、也**不应填入**任何 token、密钥、身份 JSON、数据库连接信息或日志中的敏感数据。
- 研究时请勿将凭据写入本目录或提交到版本库。
- 禁止复制本机用户数据目录中的运行时配置、登录态或缓存。

## 使用建议

1. 以「行为与模块边界」为参考，而非直接拷贝进生产路径。
2. 流式 ASR、纠错学习、截图上下文等能力，在 SayIt 中用自有接口与存储重新实现。
3. 若源码中出现占位或环境相关路径，以 SayIt 项目配置为准。

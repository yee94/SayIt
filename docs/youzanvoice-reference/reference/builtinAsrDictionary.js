export const BUILTIN_ASR_DICTIONARY = [
  "CRM",
  "风控",
  "跨境",
  "有赞企微助手",
  "线上问题",
  "会员",
  "微商城电商品牌版协议",
  "小程序",
  "云分销",
  "分时预约",
  "工单",
  "有赞云",
  "群团团",
  "碰碰贴",
  "AI",
  "GMV",
  "分销员",
  "飞连",
  "商机",
  "设计",
  "打印机",
  "MA",
  "值班表",
  "标签",
  "SDR",
  "API",
  "风险",
  "有赞寄件",
  "金额续费率",
  "模式",
  "CSQL",
  "CAS 账号",
  "调研",
  "链接",
  "打通",
  "四件套",
  "POS",
  "CSM",
  "技术干预",
  "客户",
  "应用市场",
  "福利大本营",
  "放心购",
  "BI",
  "月报",
  "组件",
  "快速回款",
  "门店",
  "SOP",
  "数据中台",
  "信息安全",
  "SSL",
  "IP",
  "URL",
  "UX",
  "SDK",
  "飞书管理员",
  "文案",
  "上门取件",
  "指标",
  "活码",
  "UI",
  "电梯",
  "电子面单",
  "帐号合并",
  "仪表盘",
  "产品矩阵",
  "工牌",
  "GEO",
  "CDP",
  "数据导出",
  "私有化部署",
  "IT 小助手",
  "密码框",
  "资损",
  "HRBP",
  "SRE",
  "飞连 VPN",
  "会员归属",
  "有赞",
  "鸦总",
  "hub",
  "融合舱",
  "臻选插件",
  "裱花间",
  "故障域",
  "中频零售",
  "星云有客",
  "流量管控",
  "私域四件套",
  "无主流量",
  "数据订正",
  "等级保护",
  "伙伴网络",
  "宽口径业绩",
  "触达业绩",
  "线索清洗",
  "有赞本地生活",
  "储值",
];

function normalizeDictionary(words = []) {
  return [...new Set((Array.isArray(words) ? words : []).map((w) => `${w || ""}`.trim()).filter(Boolean))];
}

export function getAsrDictionary(customWords = []) {
  return normalizeDictionary([...BUILTIN_ASR_DICTIONARY, ...customWords]);
}

export function buildAsrPrompt(customWords = []) {
  const merged = getAsrDictionary(customWords);
  if (merged.length === 0) return null;
  return merged.join(", ");
}

export function buildAsrSystemPrompt(customWords = []) {
  const merged = getAsrDictionary(customWords);
  if (merged.length === 0) {
    return "你是语音转文字助手。请只输出转写结果，不要解释，不要补充。";
  }
  return [
    "你是语音转文字助手。请只输出转写结果，不要解释，不要补充。",
    "当出现同音或近音词时，优先使用以下词典中的标准写法：",
    merged.join("、"),
  ].join("\n");
}

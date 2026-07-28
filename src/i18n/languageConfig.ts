export type SupportedLocale = "zh-CN" | "en" | "ja" | "ko";

export const FALLBACK_LOCALE: SupportedLocale = "zh-CN";

export const SUPPORTED_LOCALE_LIST: readonly SupportedLocale[] = [
  "zh-CN",
  "en",
  "ja",
  "ko",
] as const;

export interface LanguageOption {
  locale: SupportedLocale;
  displayName: string;
  whisperCode: string;
  htmlLang: string;
  navigatorPatternList: string[];
}

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  {
    locale: "zh-CN",
    displayName: "简体中文",
    whisperCode: "zh",
    htmlLang: "zh-Hans",
    // 系统繁体（zh-Hant / zh-TW）统一映射到简体中文
    navigatorPatternList: [
      "zh-Hans",
      "zh-CN",
      "zh-Hant-TW",
      "zh-Hant",
      "zh-TW",
    ],
  },
  {
    locale: "en",
    displayName: "English",
    whisperCode: "en",
    htmlLang: "en",
    navigatorPatternList: ["en"],
  },
  {
    locale: "ja",
    displayName: "日本語",
    whisperCode: "ja",
    htmlLang: "ja",
    navigatorPatternList: ["ja"],
  },
  {
    locale: "ko",
    displayName: "한국어",
    whisperCode: "ko",
    htmlLang: "ko",
    navigatorPatternList: ["ko"],
  },
];

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALE_LIST as readonly string[]).includes(value)
  );
}

/**
 * 规范化历史/外部 locale 字符串：
 * - zh-TW → zh-CN
 * - 合法 SupportedLocale 原样返回
 * - 非法值返回 null
 */
export function normalizeSupportedLocale(
  value: unknown,
): SupportedLocale | null {
  if (value === "zh-TW") return "zh-CN";
  if (isSupportedLocale(value)) return value;
  return null;
}

/**
 * 规范化转录语言：auto 保留；其余走 normalizeSupportedLocale。
 */
export function normalizeTranscriptionLocale(
  value: unknown,
): TranscriptionLocale | null {
  if (value === "auto") return "auto";
  return normalizeSupportedLocale(value);
}

export function detectSystemLocale(): SupportedLocale {
  const browserLanguageList =
    typeof navigator !== "undefined" ? navigator.languages : [];

  for (const browserLang of browserLanguageList) {
    // 1. Exact match（含 zh-Hant / zh-TW → zh-CN）
    for (const option of LANGUAGE_OPTIONS) {
      if (
        option.navigatorPatternList.some(
          (pattern) => pattern.toLowerCase() === browserLang.toLowerCase(),
        )
      ) {
        return option.locale;
      }
    }

    // 2. Script subtag match（如 zh-Hans-SG → zh-CN, zh-Hant-HK → zh-CN）
    for (const option of LANGUAGE_OPTIONS) {
      if (
        option.navigatorPatternList.some((pattern) =>
          browserLang.toLowerCase().startsWith(pattern.toLowerCase() + "-"),
        )
      ) {
        return option.locale;
      }
    }

    // 3. Language prefix match（如 ja-JP → ja, ko-KR → ko, en-US → en）
    const langPrefix = browserLang.split("-")[0].toLowerCase();
    for (const option of LANGUAGE_OPTIONS) {
      if (option.locale.toLowerCase() === langPrefix) {
        return option.locale;
      }
    }

    // 4. Bare "zh" → zh-CN
    if (langPrefix === "zh") {
      return "zh-CN";
    }
  }

  // 5. Fallback
  return FALLBACK_LOCALE;
}

export function getHtmlLangForLocale(locale: SupportedLocale): string {
  const option = LANGUAGE_OPTIONS.find((o) => o.locale === locale);
  return option?.htmlLang ?? "zh-Hans";
}

export function getWhisperCodeForLocale(locale: SupportedLocale): string {
  const option = LANGUAGE_OPTIONS.find((o) => o.locale === locale);
  return option?.whisperCode ?? "zh";
}

export type TranscriptionLocale = SupportedLocale | "auto";

export interface TranscriptionLanguageOption {
  locale: TranscriptionLocale;
  displayName: string;
  whisperCode: string | null;
}

export const TRANSCRIPTION_LANGUAGE_OPTIONS: TranscriptionLanguageOption[] = [
  {
    locale: "auto",
    displayName: "自动检测",
    whisperCode: null,
  },
  ...LANGUAGE_OPTIONS.map((opt) => ({
    locale: opt.locale as TranscriptionLocale,
    displayName: opt.displayName,
    whisperCode: opt.whisperCode,
  })),
];

export function getWhisperCodeForTranscriptionLocale(
  locale: TranscriptionLocale,
): string | null {
  if (locale === "auto") return null;
  return getWhisperCodeForLocale(locale);
}

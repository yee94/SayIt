export type SupportedLocale = "zh-CN" | "en" | "ja" | "zh-TW" | "ko";

export const FALLBACK_LOCALE: SupportedLocale = "zh-CN";

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
    navigatorPatternList: ["zh-Hans", "zh-CN"],
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
    locale: "zh-TW",
    displayName: "繁体中文",
    whisperCode: "zh",
    htmlLang: "zh-Hant",
    navigatorPatternList: ["zh-Hant-TW", "zh-Hant", "zh-TW"],
  },
  {
    locale: "ko",
    displayName: "한국어",
    whisperCode: "ko",
    htmlLang: "ko",
    navigatorPatternList: ["ko"],
  },
];

export function detectSystemLocale(): SupportedLocale {
  const browserLanguageList =
    typeof navigator !== "undefined" ? navigator.languages : [];

  for (const browserLang of browserLanguageList) {
    // 1. Exact match (e.g. "zh-Hant-TW" -> zh-TW)
    for (const option of LANGUAGE_OPTIONS) {
      if (
        option.navigatorPatternList.some(
          (pattern) => pattern.toLowerCase() === browserLang.toLowerCase(),
        )
      ) {
        return option.locale;
      }
    }

    // 2. Script subtag match (e.g. "zh-Hant" -> zh-TW, "zh-Hans" -> zh-CN)
    for (const option of LANGUAGE_OPTIONS) {
      if (
        option.navigatorPatternList.some((pattern) =>
          browserLang.toLowerCase().startsWith(pattern.toLowerCase() + "-"),
        )
      ) {
        return option.locale;
      }
    }

    // 3. Language prefix match (e.g. "ja-JP" -> ja, "ko-KR" -> ko, "en-US" -> en)
    const langPrefix = browserLang.split("-")[0].toLowerCase();
    for (const option of LANGUAGE_OPTIONS) {
      if (option.locale.toLowerCase() === langPrefix) {
        return option.locale;
      }
    }

    // 4. Bare "zh" -> zh-CN
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

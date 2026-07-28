import { createI18n } from "vue-i18n";
import { FALLBACK_LOCALE } from "./languageConfig";
import en from "./locales/en.json";
import ja from "./locales/ja.json";
import zhCN from "./locales/zh-CN.json";
import ko from "./locales/ko.json";

const i18n = createI18n({
  legacy: false,
  locale: FALLBACK_LOCALE,
  fallbackLocale: "en",
  messages: {
    en,
    ja,
    "zh-CN": zhCN,
    ko,
  },
});

export default i18n;

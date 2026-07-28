#!/usr/bin/env node
/**
 * 检测仓库文本中的繁体中文（OpenCC tw→cn 可区分的繁体字形）。
 *
 * 规则：
 * - 所有新增中文必须使用简体中文；禁止繁体中文
 * - 日语 locale 保持日语（排除 ja.json，并跳过 prompts.ts 的 ja 模板段）
 * - 允许展示用日语名称「日本語」
 *
 * 用法：node scripts/check-simplified-chinese.mjs
 * 退出码：0 通过，1 发现繁体
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const OpenCC = require("opencc-js");

const tw2cn = OpenCC.Converter({ from: "tw", to: "cn" });
const cn2tw = OpenCC.Converter({ from: "cn", to: "tw" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

/**
 * 扫描仓库根目录下全部文本源文件。
 * 仅排除构建产物目录与明确二进制；业务代码、tests、src-tauri、
 * implementation-artifacts、design.pen 等均在强制简体范围内。
 */

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "target",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".cache",
  "pnpm-store",
]);

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".yml",
  ".yaml",
  ".toml",
  ".mjs",
  ".js",
  ".cjs",
  ".ts",
  ".tsx",
  ".vue",
  ".json",
  ".sh",
  ".txt",
  ".html",
  ".css",
  ".scss",
  ".rs",
  ".pen",
  ".py",
  ".rb",
  ".go",
  ".java",
  ".kt",
  ".swift",
  ".sql",
  ".xml",
  ".svg",
  ".csv",
  ".ini",
  ".cfg",
  ".conf",
  ".env",
  ".gitignore",
  ".gitattributes",
  ".editorconfig",
  ".nvmrc",
  ".lock",
]);

/** 精确相对路径排除 */
const SKIP_RELATIVE_FILES = new Set(["src/i18n/locales/ja.json"]);

/** 允许保留的日语展示字串（内含 OpenCC 会判为繁体的汉字） */
const ALLOWED_LITERALS = ["日本語"];

/**
 * 是否为「繁体专属」汉字：
 * - tw→cn 会改变（确为繁体侧字形）
 * - cn→tw 保持不变（不是「简体被误映射」的字，如 么/坏）
 */
function isTraditionalOnlyChar(ch) {
  if (ch < "\u4e00" || ch > "\u9fff") return false;
  const simplified = tw2cn(ch);
  if (simplified === ch) return false;
  return cn2tw(ch) === ch;
}

function toPosixRelative(absPath) {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join("/");
}

function shouldSkipDir(name) {
  return SKIP_DIR_NAMES.has(name);
}

function shouldCheckFile(relPosix) {
  if (SKIP_RELATIVE_FILES.has(relPosix)) return false;

  // 隐藏锁档 / 二进制常见名
  const base = path.basename(relPosix);
  if (base === "pnpm-lock.yaml" || base === "Cargo.lock" || base === "package-lock.json") {
    return false;
  }

  const ext = path.extname(relPosix).toLowerCase();
  if (ext && !TEXT_EXTENSIONS.has(ext)) return false;

  // 无扩展名：常见文本配置 / scripts 下脚本
  if (!ext) {
    if (
      relPosix.startsWith("scripts/") ||
      base.startsWith(".") ||
      base === "Dockerfile" ||
      base === "Makefile" ||
      base === "LICENSE" ||
      base === "Procfile"
    ) {
      return true;
    }
    return false;
  }

  return true;
}

/**
 * 去掉 prompts.ts 中 ja 语系模板字面量内容，避免日文汉字触发误报。
 * 匹配：ja: `...` / "ja": `...` / ja : `...`
 */
function stripJaPromptTemplates(source) {
  return source.replace(
    /(["']?ja["']?\s*:\s*)`(?:\\`|[^`])*`/g,
    "$1``",
  );
}

function maskAllowedLiterals(text) {
  let out = text;
  for (const literal of ALLOWED_LITERALS) {
    out = out.split(literal).join("\uFFFC".repeat(literal.length));
  }
  return out;
}

function prepareContent(relPosix, raw) {
  let text = raw;
  if (relPosix === "src/i18n/prompts.ts" || relPosix.endsWith("/prompts.ts")) {
    text = stripJaPromptTemplates(text);
  }
  return maskAllowedLiterals(text);
}

function findTraditionalHits(text, maxHits = 20) {
  const hits = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (!isTraditionalOnlyChar(ch)) continue;
    const start = Math.max(0, i - 16);
    const end = Math.min(text.length, i + 16);
    const line = text.slice(0, i).split("\n").length;
    hits.push({
      char: ch,
      line,
      context: text.slice(start, end).replace(/\s+/g, " "),
    });
    if (hits.length >= maxHits) break;
  }
  return hits;
}

function walkFiles(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      walkFiles(abs, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const rel = toPosixRelative(abs);
    if (!shouldCheckFile(rel)) continue;
    out.push(abs);
  }
  return out;
}

function collectScanFiles() {
  return walkFiles(REPO_ROOT);
}

function main() {
  const files = collectScanFiles();
  const violations = [];

  for (const abs of files) {
    const rel = toPosixRelative(abs);
    let raw;
    try {
      raw = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (raw.includes("\0")) continue;

    const prepared = prepareContent(rel, raw);
    const hits = findTraditionalHits(prepared);
    if (hits.length === 0) continue;

    violations.push({ rel, hits });
  }

  if (violations.length === 0) {
    console.log(
      `[check-simplified-chinese] OK — scanned ${files.length} files, no traditional Chinese found.`,
    );
    process.exit(0);
  }

  console.error(
    `[check-simplified-chinese] FAIL — found traditional Chinese in ${violations.length} file(s):\n`,
  );
  for (const { rel, hits } of violations) {
    console.error(`  ${rel}`);
    for (const hit of hits) {
      console.error(
        `    L${hit.line}: 「${hit.char}」 …${hit.context}…`,
      );
    }
    console.error("");
  }
  console.error(
    "规则：所有新增中文必须使用简体中文；日语 locale 保持日语。\n" +
      "修复后重跑：node scripts/check-simplified-chinese.mjs",
  );
  process.exit(1);
}

main();

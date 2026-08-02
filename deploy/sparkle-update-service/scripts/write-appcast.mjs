#!/usr/bin/env node
/**
 * Upsert one Sparkle item into channels/{channel}/manifest.json then rebuild.
 *
 * Usage:
 *   node scripts/write-appcast.mjs \
 *     --channel stable \
 *     --version 1.15.0 \
 *     --sparkle-version 101500099 \
 *     --url https://github.com/yee94/SayIt/releases/download/v1.15.0/SayIt-1.15.0-macOS.zip \
 *     --length 49528507 \
 *     --ed-signature 'BASE64...' \
 *     --release-url https://github.com/yee94/SayIt/releases/tag/v1.15.0 \
 *     --published-at 2026-08-01T16:48:30Z \
 *     --notes-html '<p>Release notes</p>'
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function arg(name, fallback = undefined) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function required(name) {
  const value = arg(name);
  if (!value) {
    console.error(`Missing required --${name}`);
    process.exit(1);
  }
  return value;
}

const channel = required("channel");
if (!["stable", "beta"].includes(channel)) {
  console.error(`--channel must be stable or beta, got: ${channel}`);
  process.exit(1);
}

const shortVersionString = required("version");
const version = required("sparkle-version");
const url = required("url");
const length = required("length");
const edSignature = arg("ed-signature", "");
const releaseURL = arg("release-url", `https://github.com/yee94/SayIt/releases/tag/v${shortVersionString}`);
const publishedAt = arg("published-at", new Date().toISOString());
const releaseNotesHtml = arg("notes-html", `<p>SayIt ${shortVersionString}</p>`);
const title = arg("title", `Version ${shortVersionString}`);
const maxItems = Number(arg("max-items", "20"));

const channelDir = join(root, "channels", channel);
mkdirSync(channelDir, { recursive: true });
const manifestPath = join(channelDir, "manifest.json");

let manifest = { channel, items: [] };
if (existsSync(manifestPath)) {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(manifest.items)) manifest.items = [];
}

const nextItem = {
  title,
  shortVersionString,
  version: String(version),
  url,
  length: String(length),
  edSignature,
  releaseURL,
  publishedAt,
  releaseNotesHtml,
};

// Newest first; replace same shortVersionString if present.
manifest.items = [
  nextItem,
  ...manifest.items.filter((item) => item.shortVersionString !== shortVersionString),
].slice(0, maxItems);
manifest.channel = channel;
manifest.updatedAt = new Date().toISOString();

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${manifestPath} (${manifest.items.length} items)`);

const build = spawnSync(process.execPath, [join(root, "scripts", "build.mjs")], {
  stdio: "inherit",
  env: process.env,
});
process.exit(build.status ?? 1);

#!/usr/bin/env node
/**
 * Build static Sparkle appcast site for EdgeOne Pages.
 * Reads channel manifests under channels/ and writes dist/.
 */
import { mkdirSync, readFileSync, writeFileSync, cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outputDir = process.env.SAYIT_UPDATE_OUTPUT_DIR || "dist";
const dist = join(root, outputDir);

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatRfc822(iso) {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toUTCString();
  }
  return date.toUTCString();
}

function renderAppcast(channel, manifest) {
  const items = Array.isArray(manifest.items) ? manifest.items : [];
  const itemXml = items
    .map((item) => {
      const title = escapeXml(item.title || `Version ${item.shortVersionString}`);
      const version = escapeXml(item.version);
      const shortVersion = escapeXml(item.shortVersionString || item.version);
      const url = escapeXml(item.url);
      const length = escapeXml(item.length ?? 0);
      const edSignature = escapeXml(item.edSignature || "");
      const releaseNotes = item.releaseNotesHtml || `<p>SayIt ${escapeXml(item.shortVersionString || item.version)}</p>`;
      const link = escapeXml(item.releaseURL || "https://github.com/yee94/SayIt/releases");
      const pubDate = formatRfc822(item.publishedAt);

      const signatureAttr = edSignature
        ? `\n        sparkle:edSignature="${edSignature}"`
        : "";

      return `    <item>
      <title>${title}</title>
      <pubDate>${pubDate}</pubDate>
      <link>${link}</link>
      <description><![CDATA[${releaseNotes}]]></description>
      <sparkle:version>${version}</sparkle:version>
      <sparkle:shortVersionString>${shortVersion}</sparkle:shortVersionString>
      <enclosure
        url="${url}"${signatureAttr}
        length="${length}"
        type="application/zip" />
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"
  xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"
  xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>SayIt ${escapeXml(channel)} updates</title>
    <link>https://github.com/yee94/SayIt/releases</link>
    <description>SayIt ${escapeXml(channel)} Sparkle update feed</description>
    <language>en</language>
${itemXml}
  </channel>
</rss>
`;
}

function loadManifest(channel) {
  const path = join(root, "channels", channel, "manifest.json");
  if (!existsSync(path)) {
    return { channel, items: [] };
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

mkdirSync(dist, { recursive: true });
mkdirSync(join(dist, "updates", "stable"), { recursive: true });
mkdirSync(join(dist, "updates", "beta"), { recursive: true });

const stable = loadManifest("stable");
const beta = loadManifest("beta");

writeFileSync(join(dist, "updates", "stable", "appcast.xml"), renderAppcast("stable", stable));
writeFileSync(join(dist, "updates", "beta", "appcast.xml"), renderAppcast("beta", beta));

const health = {
  service: "sayit-sparkle-update",
  stableItems: (stable.items || []).length,
  betaItems: (beta.items || []).length,
  latestStable: stable.items?.[0]?.shortVersionString ?? null,
  latestBeta: beta.items?.[0]?.shortVersionString ?? null,
  generatedAt: new Date().toISOString(),
};
writeFileSync(join(dist, "health.json"), JSON.stringify(health, null, 2) + "\n");

const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>SayIt Sparkle Update Feed</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; color: #111; }
    code { background: #f4f4f5; padding: 0.15rem 0.35rem; border-radius: 4px; }
    a { color: #2563eb; }
  </style>
</head>
<body>
  <h1>SayIt Sparkle Update Feed</h1>
  <p>Hosted on EdgeOne Pages for in-app Sparkle updates.</p>
  <ul>
    <li><a href="/updates/stable/appcast.xml"><code>/updates/stable/appcast.xml</code></a></li>
    <li><a href="/updates/beta/appcast.xml"><code>/updates/beta/appcast.xml</code></a></li>
    <li><a href="/health.json"><code>/health.json</code></a></li>
  </ul>
</body>
</html>
`;
writeFileSync(join(dist, "index.html"), indexHtml);

// Keep a copy under public for local inspection / non-EdgeOne hosts.
mkdirSync(join(root, "public", "updates", "stable"), { recursive: true });
mkdirSync(join(root, "public", "updates", "beta"), { recursive: true });
cpSync(join(dist, "updates"), join(root, "public", "updates"), { recursive: true });
cpSync(join(dist, "health.json"), join(root, "public", "health.json"));
cpSync(join(dist, "index.html"), join(root, "public", "index.html"));

console.log(`Built Sparkle update site → ${outputDir}`);
console.log(`  stable items: ${health.stableItems}, latest=${health.latestStable}`);
console.log(`  beta items: ${health.betaItems}, latest=${health.latestBeta}`);

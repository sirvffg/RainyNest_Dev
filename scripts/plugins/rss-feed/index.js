"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// plugins/rss-feed/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => rssFeedPlugin
});
module.exports = __toCommonJS(index_exports);
function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function xmlResponse(xml) {
  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" }
  });
}
function rfc822(date) {
  return (date ?? /* @__PURE__ */ new Date()).toUTCString();
}
function iso8601(date) {
  return (date ?? /* @__PURE__ */ new Date()).toISOString();
}
function rssFeedPlugin(ctx) {
  const config = ctx.config || {};
  async function fetchPosts() {
    const limit = Math.max(1, Math.min(100, Number(config.limit) || 20));
    const posts = await ctx.db.post.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      take: limit,
      select: {
        title: true,
        slug: true,
        summary: true,
        content: true,
        publishedAt: true,
        updatedAt: true
      }
    });
    return posts;
  }
  return {
    customApi: [
      {
        method: "GET",
        path: "/rss.xml",
        auth: false,
        handler: async () => {
          const base = (ctx.site?.url || "http://localhost:3000").replace(/\/$/, "");
          const posts = await fetchPosts();
          const items = posts.map((p) => {
            const url = `${base}/blog/${p.slug}`;
            const description = p.summary || p.content.slice(0, 300);
            return [
              "    <item>",
              `      <title>${escapeXml(p.title)}</title>`,
              `      <link>${escapeXml(url)}</link>`,
              `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
              `      <pubDate>${rfc822(p.publishedAt)}</pubDate>`,
              `      <description><![CDATA[${description}]]></description>`,
              "    </item>"
            ].join("\n");
          }).join("\n");
          const xml = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
            "  <channel>",
            `    <title>${escapeXml(ctx.site?.title || "RainyNest")}</title>`,
            `    <link>${escapeXml(base)}</link>`,
            `    <description>${escapeXml(ctx.site?.description || "")}</description>`,
            "    <language>zh-CN</language>",
            `    <lastBuildDate>${rfc822(/* @__PURE__ */ new Date())}</lastBuildDate>`,
            `    <atom:link href="${escapeXml(`${base}/rss.xml`)}" rel="self" type="application/rss+xml" />`,
            items,
            "  </channel>",
            "</rss>"
          ].join("\n");
          return xmlResponse(xml);
        }
      },
      {
        method: "GET",
        path: "/atom.xml",
        auth: false,
        handler: async () => {
          const base = (ctx.site?.url || "http://localhost:3000").replace(/\/$/, "");
          const posts = await fetchPosts();
          const entries = posts.map((p) => {
            const url = `${base}/blog/${p.slug}`;
            const summary = p.summary || p.content.slice(0, 300);
            return [
              "  <entry>",
              `    <title>${escapeXml(p.title)}</title>`,
              `    <link href="${escapeXml(url)}" />`,
              `    <id>${escapeXml(url)}</id>`,
              `    <updated>${iso8601(p.updatedAt)}</updated>`,
              `    <published>${iso8601(p.publishedAt)}</published>`,
              `    <summary type="html"><![CDATA[${summary}]]></summary>`,
              "  </entry>"
            ].join("\n");
          }).join("\n");
          const xml = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<feed xmlns="http://www.w3.org/2005/Atom">',
            `  <title>${escapeXml(ctx.site?.title || "RainyNest")}</title>`,
            `  <subtitle>${escapeXml(ctx.site?.description || "")}</subtitle>`,
            `  <link href="${escapeXml(base)}" />`,
            `  <link href="${escapeXml(`${base}/atom.xml`)}" rel="self" />`,
            `  <id>${escapeXml(base)}</id>`,
            `  <updated>${iso8601(/* @__PURE__ */ new Date())}</updated>`,
            entries,
            "</feed>"
          ].join("\n");
          return xmlResponse(xml);
        }
      }
    ]
  };
}

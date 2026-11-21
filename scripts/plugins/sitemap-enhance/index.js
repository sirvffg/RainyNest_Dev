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

// plugins/sitemap-enhance/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => sitemapEnhancePlugin
});
module.exports = __toCommonJS(index_exports);
function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function w3cDate(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, "+00:00");
}
function sitemapEnhancePlugin(ctx) {
  return {
    customApi: [
      {
        method: "GET",
        path: "/sitemap.xml",
        auth: false,
        handler: async () => {
          const base = (ctx.site?.url || "http://localhost:3000").replace(/\/$/, "");
          const entries = [
            { loc: `${base}/`, priority: "1.0", freq: "daily" },
            { loc: `${base}/blog`, priority: "0.9", freq: "daily" },
            { loc: `${base}/archive`, priority: "0.5", freq: "weekly" },
            { loc: `${base}/tags`, priority: "0.4", freq: "weekly" },
            { loc: `${base}/gallery`, priority: "0.4", freq: "weekly" },
            { loc: `${base}/links`, priority: "0.4", freq: "monthly" }
          ];
          try {
            const posts = await ctx.db.post.findMany({
              where: { status: "PUBLISHED" },
              select: { slug: true, updatedAt: true },
              orderBy: { updatedAt: "desc" },
              take: 5e3
            });
            for (const p of posts) {
              entries.push({
                loc: `${base}/blog/${p.slug}`,
                lastmod: w3cDate(p.updatedAt),
                priority: "0.8",
                freq: "weekly"
              });
            }
            const categories = await ctx.db.category.findMany({ select: { slug: true } });
            for (const c of categories) {
              entries.push({ loc: `${base}/blog?category=${c.slug}`, priority: "0.5", freq: "weekly" });
            }
            const tags = await ctx.db.tag.findMany({ select: { slug: true } });
            for (const t of tags) {
              entries.push({ loc: `${base}/blog?tag=${t.slug}`, priority: "0.3", freq: "weekly" });
            }
            const galleries = await ctx.db.gallery.findMany({
              where: { status: "PUBLISHED" },
              select: { slug: true, updatedAt: true }
            });
            for (const g of galleries) {
              entries.push({
                loc: `${base}/gallery/${g.slug}`,
                lastmod: w3cDate(g.updatedAt),
                priority: "0.5",
                freq: "weekly"
              });
            }
          } catch (err) {
            ctx.logger.warn("sitemap \u6570\u636E\u67E5\u8BE2\u5931\u8D25\uFF0C\u4EC5\u8F93\u51FA\u9759\u6001\u9875", err);
          }
          const urls = entries.map(
            (e) => [
              "  <url>",
              `    <loc>${escapeXml(e.loc)}</loc>`,
              e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
              `    <changefreq>${e.freq}</changefreq>`,
              `    <priority>${e.priority}</priority>`,
              "  </url>"
            ].filter(Boolean).join("\n")
          ).join("\n");
          const xml = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
            urls,
            "</urlset>"
          ].join("\n");
          return new Response(xml, {
            headers: { "Content-Type": "application/xml; charset=utf-8" }
          });
        }
      }
    ]
  };
}

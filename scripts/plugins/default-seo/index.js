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

// plugins/default-seo/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => defaultSeoPlugin
});
module.exports = __toCommonJS(index_exports);
var SUMMARY_LENGTH = 120;
function toPlainText(content) {
  return content.replace(/```[\s\S]*?```/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#*`>_~\-|]/g, " ").replace(/\s+/g, " ").trim();
}
function defaultSeoPlugin(ctx) {
  const config = ctx.config || {};
  return {
    // 保存文章前：无 summary 时从 content 截取前 120 字符；coverImage 缺失时保留不动
    beforeSavePost(post, meta) {
      const summary = typeof post.summary === "string" ? post.summary.trim() : "";
      if (!summary) {
        const content = typeof post.content === "string" ? post.content : "";
        if (content) {
          const text = toPlainText(content);
          if (text) {
            meta.patch ??= {};
            meta.patch.summary = text.slice(0, SUMMARY_LENGTH);
          }
        }
      }
    },
    // 元数据生成时补 openGraph / twitter 字段
    onGenerateMetadata({ metadata, post }) {
      const base = (ctx.site?.url || "http://localhost:3000").replace(/\/$/, "");
      const title = metadata.title || post?.title || ctx.site?.title || "RainyNest";
      const description = metadata.description || post?.summary || ctx.site?.description || "";
      const url = post?.slug ? `${base}/blog/${post.slug}` : base;
      const images = metadata.images || (post?.coverImage ? [String(post.coverImage)] : void 0) || (ctx.site?.logo ? [ctx.site.logo] : void 0);
      metadata.title = title;
      metadata.description = description;
      metadata.openGraph = {
        title,
        description,
        url,
        siteName: ctx.site?.title || "RainyNest",
        type: post?.slug ? "article" : "website",
        ...images ? { images } : {}
      };
      metadata.twitter = {
        card: images ? "summary_large_image" : "summary",
        title,
        description,
        ...images ? { images } : {}
      };
      return metadata;
    },
    // <head> 注入站长平台验证 meta 标签
    injectHead() {
      const tags = [];
      if (config.googleVerification) {
        tags.push(
          `<meta name="google-site-verification" content="${config.googleVerification}" />`
        );
      }
      if (config.baiduVerification) {
        tags.push(
          `<meta name="baidu-site-verification" content="${config.baiduVerification}" />`
        );
      }
      return tags;
    }
  };
}

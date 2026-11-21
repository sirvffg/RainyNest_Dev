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

// plugins/related-posts/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => relatedPostsPlugin
});
module.exports = __toCommonJS(index_exports);
var import_react = require("react");
function relatedPostsPlugin(ctx) {
  const config = ctx.config || {};
  const defaultLimit = Math.max(1, Math.min(20, Number(config.limit) || 5));
  return {
    // 侧栏 widget：声明 API 容器，由前台 SidebarPluginWidgets 客户端组件按当前路径填充
    injectSidebarWidget() {
      return [
        {
          title: "\u76F8\u5173\u6587\u7AE0",
          order: 10,
          component: () => (0, import_react.createElement)("div", {
            "data-widget-api": "/api/plugin/related-posts/related",
            "data-widget-param": "slug",
            className: "anim-fade-in"
          }, (0, import_react.createElement)("p", { className: "py-1 text-xs text-fg-muted" }, "\u6B63\u5728\u52A0\u8F7D\u76F8\u5173\u6587\u7AE0..."))
        }
      ];
    },
    customApi: [
      {
        method: "GET",
        path: "/related",
        auth: false,
        handler: async (req) => {
          const params = new URL(req.url).searchParams;
          const slug = params.get("slug");
          const limit = Math.max(
            1,
            Math.min(20, Number(params.get("limit")) || defaultLimit)
          );
          const empty = new Response(JSON.stringify({ list: [] }), {
            headers: { "Content-Type": "application/json; charset=utf-8" }
          });
          if (!slug) return empty;
          const post = await ctx.db.post.findUnique({
            where: { slug },
            select: { id: true, tags: { select: { tagId: true } } }
          });
          if (!post || post.tags.length === 0) return empty;
          const tagIds = post.tags.map((t) => t.tagId);
          const rows = await ctx.db.postTag.findMany({
            where: {
              tagId: { in: tagIds },
              post: { status: "PUBLISHED", id: { not: post.id } }
            },
            select: {
              postId: true,
              post: { select: { title: true, slug: true, summary: true } }
            }
          });
          const score = /* @__PURE__ */ new Map();
          for (const row of rows) {
            const prev = score.get(row.postId);
            if (prev) {
              prev.hits += 1;
            } else {
              score.set(row.postId, {
                title: row.post.title,
                slug: row.post.slug,
                summary: row.post.summary,
                hits: 1
              });
            }
          }
          const list = [...score.values()].sort((a, b) => b.hits - a.hits).slice(0, limit).map(({ title, slug: s, summary }) => ({ title, slug: s, summary }));
          return new Response(JSON.stringify({ list }), {
            headers: { "Content-Type": "application/json; charset=utf-8" }
          });
        }
      }
    ]
  };
}

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

// plugins/announcement-bar/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => announcementBarPlugin
});
module.exports = __toCommonJS(index_exports);
function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function announcementBarPlugin(ctx) {
  const config = ctx.config || {};
  const enabled = config.enabled !== false;
  const message = (config.message || "").trim();
  const link = (config.link || "").trim();
  const linkText = (config.linkText || "\u67E5\u770B\u8BE6\u60C5").trim();
  const active = enabled && message.length > 0;
  const quickActions = enabled ? [{ label: "\u7F16\u8F91\u516C\u544A", icon: "megaphone", href: "/console/system/plugins" }] : [];
  const apiMiddleware = [
    {
      path: "/api/posts",
      methods: ["GET"],
      async handler(_req, next) {
        const res = await next();
        if (!active) return res;
        const headers = new Headers(res.headers);
        headers.set("x-announcement", encodeURIComponent(message));
        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers
        });
      }
    }
  ];
  const handlers = {
    // 主题顶栏按钮：点击跳转到 config.link（未配置链接时退化为纯按钮）
    injectHeaderAction() {
      if (!active) return [];
      return [
        {
          key: "announcement",
          label: "\u516C\u544A",
          icon: "megaphone",
          href: link || void 0,
          order: 10
        }
      ];
    },
    // 后台仪表盘快捷操作：跳到插件管理页编辑公告
    dashboardQuickAction: quickActions,
    // 页脚公告：返回一行 HTML，message 与链接均已转义
    injectFooter() {
      if (!active) return [];
      const linkHtml = link ? ` <a href="${escapeHtml(link)}" style="margin-left:8px;color:#2563eb;text-decoration:underline;">${escapeHtml(linkText)}</a>` : "";
      return [
        `<div class="rn-announcement" style="padding:8px 16px;text-align:center;font-size:13px;color:#475569;background:#f1f5f9;border-top:1px solid #e2e8f0;">${escapeHtml(message)}${linkHtml}</div>`
      ];
    },
    // API 拦截演示：/api/posts 响应追加 x-announcement 头
    apiMiddleware
  };
  if (enabled && config.useNotifier === true) {
    const notifier = {
      name: "announcement-bar",
      async send(notification) {
        const to = Array.isArray(notification.to) ? notification.to.join(", ") : notification.to;
        ctx.logger.info(
          `[\u516C\u544A\u680F] \u793A\u4F8B\u901A\u77E5\u5668\u63A5\u7BA1 ${notification.scene || "default"} \u2192 ${to}\uFF1A${notification.subject}`
        );
        return { ok: true, messageId: `announcement-${Date.now()}` };
      }
    };
    handlers.notifier = notifier;
  }
  return handlers;
}

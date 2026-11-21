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

// plugins/comment-filter/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => commentFilterPlugin
});
module.exports = __toCommonJS(index_exports);
function commentFilterPlugin(ctx) {
  const config = ctx.config || {};
  function parseList(raw) {
    if (!raw) return [];
    return raw.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean);
  }
  return {
    // 审核前检查：命中关键词或 IP 黑名单 → REJECTED；未命中 → void（走默认流程）
    beforeCommentApprove(comment) {
      const keywords = parseList(config.keywords);
      const blockIps = parseList(config.ips);
      if (comment.ip && blockIps.includes(comment.ip)) {
        ctx.logger.info(`\u8BC4\u8BBA\u547D\u4E2D IP \u9ED1\u540D\u5355 ${comment.ip}\uFF0C\u5DF2\u62D2\u7EDD`);
        return "REJECTED";
      }
      if (comment.content && keywords.length > 0) {
        const content = comment.content.toLowerCase();
        const hit = keywords.find((k) => content.includes(k.toLowerCase()));
        if (hit) {
          ctx.logger.info(`\u8BC4\u8BBA\u547D\u4E2D\u5173\u952E\u8BCD\u300C${hit}\u300D\uFF0C\u5DF2\u62D2\u7EDD`);
          return "REJECTED";
        }
      }
      return void 0;
    }
  };
}

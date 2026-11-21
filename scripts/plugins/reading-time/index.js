"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// plugins/reading-time/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => readingTimePlugin
});
module.exports = __toCommonJS(index_exports);
var import_react = __toESM(require("react"));
function readingTimePlugin(ctx) {
  const config = ctx.config || {};
  return {
    // Markdown 渲染前预处理：在文首注入阅读时间提示（示例：插件修改内容）
    onRenderMarkdown(content) {
      if (config.showWords === false) return content;
      const chars = content.replace(/\s/g, "").length;
      const wpm = config.wpm || 300;
      const minutes = Math.max(1, Math.round(chars / wpm));
      ctx.logger.info(`\u6587\u7AE0\u5B57\u6570 ${chars}\uFF0C\u9884\u8BA1\u9605\u8BFB ${minutes} \u5206\u949F`);
      return content;
    },
    // 摘要生成扩展点（首个有效返回值生效）
    excerptGenerator(content, length) {
      const plain = content.replace(/[#*`>\-\[\]()!]/g, "").replace(/\s+/g, " ").trim();
      return plain.slice(0, length || 160);
    },
    // 文末追加块：阅读信息（injectPostContent 扩展点演示）
    injectPostContent() {
      return [
        function ReadingFooter() {
          return import_react.default.createElement(
            "div",
            {
              style: {
                marginTop: 16,
                padding: "14px 18px",
                borderRadius: 12,
                border: "1px dashed #cbd5e1",
                fontSize: 13,
                color: "#64748b",
                textAlign: "center"
              }
            },
            "\u672C\u6587\u7531 RainyNest \u6E32\u67D3 \xB7 \u611F\u8C22\u9605\u8BFB"
          );
        }
      ];
    }
  };
}

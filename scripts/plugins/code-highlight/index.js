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

// plugins/code-highlight/index.ts
var index_exports = {};
__export(index_exports, {
  default: () => codeHighlightPlugin
});
module.exports = __toCommonJS(index_exports);
var RANGE_FENCE_RE = /^(`{3,})([A-Za-z0-9_+#.-]+)\{(\s*[\d,\-\s]+\s*)\}(.*)$/gm;
function codeHighlightPlugin(ctx) {
  const config = ctx.config || {};
  return {
    onRenderMarkdown(content) {
      if (!content || !content.includes("```")) return content;
      return content.replace(RANGE_FENCE_RE, (_m, fence, lang, range, rest) => {
        return `${fence}${lang} {${range.replace(/\s+/g, "")}}${rest}`;
      });
    },
    injectHead() {
      const radius = config.borderRadius || "12px";
      const css = [
        `<style data-plugin="code-highlight">`,
        `.expressive-code,`,
        `.expressive-code pre {`,
        `  border-radius: ${radius} !important;`,
        `}`,
        `.expressive-code .ec-line .ln,`,
        `.expressive-code code .line-number {`,
        `  color: var(--color-fg-muted) !important;`,
        `  user-select: none;`,
        `}`,
        `</style>`
      ];
      return [css.join("\n")];
    }
  };
}

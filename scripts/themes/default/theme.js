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

// themes/default/theme.ts
var theme_exports = {};
__export(theme_exports, {
  configToCssVariables: () => configToCssVariables
});
module.exports = __toCommonJS(theme_exports);
var radiusMap = {
  sharp: { sm: "0px", md: "0px", lg: "0px" },
  rounded: { sm: "4px", md: "8px", lg: "12px" },
  pill: { sm: "12px", md: "20px", lg: "28px" }
};
function shadeHex(hex, amount) {
  const m = hex.replace("#", "");
  if (m.length !== 6) return hex;
  const num = parseInt(m, 16);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp((num >> 16) + amount);
  const g = clamp((num >> 8 & 255) + amount);
  const b = clamp((num & 255) + amount);
  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6, "0")}`;
}
function getFontStack(key) {
  const fonts = {
    inter: "'Inter', system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif",
    "noto-sc": "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    serif: "'Source Serif 4', Georgia, 'Songti SC', 'SimSun', serif",
    mono: "'JetBrains Mono', 'Fira Code', Consolas, monospace"
  };
  return fonts[key] || fonts.inter;
}
function configToCssVariables(config) {
  const radius = radiusMap[config.basic.radiusStyle] || radiusMap.rounded;
  const primary = config.basic.primaryColor || "#3b82f6";
  const vars = {
    "--color-primary": primary,
    "--color-primary-hover": shadeHex(primary, -32),
    "--radius-sm": radius.sm,
    "--radius-md": radius.md,
    "--radius-lg": radius.lg,
    "--font-sans": getFontStack(config.basic.fontFamily),
    "--sidebar-position": config.layout.sidebarPosition
  };
  if (config.basic.bgMode === "dark") {
    vars["--color-bg"] = "#0f172a";
    vars["--color-bg-secondary"] = "#1e293b";
    vars["--color-fg"] = "#f1f5f9";
    vars["--color-fg-muted"] = "#94a3b8";
    vars["--color-border"] = "#334155";
  } else {
    vars["--color-bg"] = "#ffffff";
    vars["--color-bg-secondary"] = "#f8fafc";
    vars["--color-fg"] = "#0f172a";
    vars["--color-fg-muted"] = "#64748b";
    vars["--color-border"] = "#e2e8f0";
  }
  return vars;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  configToCssVariables
});

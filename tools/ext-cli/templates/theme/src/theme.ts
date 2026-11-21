// src/theme.ts — 配置值 → CSS 变量
export function configToCssVariables(config: Record<string, any>): Record<string, string> {
  const vars: Record<string, string> = {};
  if (config?.basic?.accentColor) {
    vars['--color-primary'] = config.basic.accentColor;
  }
  return vars;
}

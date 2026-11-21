// vendor/plugins/code-highlight/index.ts — 代码高亮增强（轻量字符串变换 + 主题微调 CSS）
// 说明：
// 1. 行高亮写法 ```lang{1,3-5} 转为 Expressive Code 标准 ```lang {1,3-5}
// 2. [!code highlight] / [!code mark] 增强标记为 Expressive Code 原生语法，原样保留
//    （完整文档见 https://expressive-code.com/reference/annotations/）
import type { PluginContext, ExtensionHandlers } from '@rainynest/plugin-types';

// ```ts{1,3-5} → ```ts {1,3-5}（语言与花括号间补空格，其余情况不动）
const RANGE_FENCE_RE = /^(`{3,})([A-Za-z0-9_+#.-]+)\{(\s*[\d,\-\s]+\s*)\}(.*)$/gm;

export default function codeHighlightPlugin(ctx: PluginContext): ExtensionHandlers {
  const config = (ctx.config || {}) as { borderRadius?: string };

  return {
    onRenderMarkdown(content: string) {
      if (!content || !content.includes('```')) return content;
      return content.replace(RANGE_FENCE_RE, (_m, fence, lang, range, rest) => {
        return `${fence}${lang} {${range.replace(/\s+/g, '')}}${rest}`;
      });
    },

    injectHead() {
      const radius = config.borderRadius || '12px';
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
        `</style>`,
      ];
      return [css.join('\n')];
    },
  };
}

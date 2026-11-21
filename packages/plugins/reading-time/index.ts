// vendor/plugins/reading-time/index.ts — 预装示例插件：阅读时间统计
import type { PluginContext, ExtensionHandlers } from '@rainynest/plugin-types';
import React from 'react';

export default function readingTimePlugin(ctx: PluginContext): ExtensionHandlers {
  const config = (ctx.config || {}) as { wpm?: number; showWords?: boolean };

  return {
    // Markdown 渲染前预处理：在文首注入阅读时间提示（示例：插件修改内容）
    onRenderMarkdown(content: string) {
      if (config.showWords === false) return content;

      const chars = content.replace(/\s/g, '').length;
      const wpm = config.wpm || 300;
      const minutes = Math.max(1, Math.round(chars / wpm));

      ctx.logger.info(`文章字数 ${chars}，预计阅读 ${minutes} 分钟`);
      return content;
    },

    // 摘要生成扩展点（首个有效返回值生效）
    excerptGenerator(content: string, length: number) {
      const plain = content
        .replace(/[#*`>\-\[\]()!]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      return plain.slice(0, length || 160);
    },

    // 文末追加块：阅读信息（injectPostContent 扩展点演示）
    injectPostContent() {
      return [
        function ReadingFooter() {
          return React.createElement(
            'div',
            {
              style: {
                marginTop: 16,
                padding: '14px 18px',
                borderRadius: 12,
                border: '1px dashed #cbd5e1',
                fontSize: 13,
                color: '#64748b',
                textAlign: 'center',
              },
            },
            '本文由 RainyNest 渲染 · 感谢阅读'
          );
        },
      ];
    },
  };
}


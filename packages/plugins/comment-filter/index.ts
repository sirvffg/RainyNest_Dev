// vendor/plugins/comment-filter/index.ts — 评论自动过滤（关键词 / IP 黑名单）
import type { PluginContext, ExtensionHandlers } from '@rainynest/plugin-types';

export default function commentFilterPlugin(ctx: PluginContext): ExtensionHandlers {
  const config = (ctx.config || {}) as { keywords?: string; ips?: string };

  function parseList(raw?: string): string[] {
    if (!raw) return [];
    return raw
      .split(/[,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return {
    // 审核前检查：命中关键词或 IP 黑名单 → REJECTED；未命中 → void（走默认流程）
    beforeCommentApprove(comment) {
      const keywords = parseList(config.keywords);
      const blockIps = parseList(config.ips);

      if (comment.ip && blockIps.includes(comment.ip)) {
        ctx.logger.info(`评论命中 IP 黑名单 ${comment.ip}，已拒绝`);
        return 'REJECTED';
      }

      if (comment.content && keywords.length > 0) {
        const content = comment.content.toLowerCase();
        const hit = keywords.find((k) => content.includes(k.toLowerCase()));
        if (hit) {
          ctx.logger.info(`评论命中关键词「${hit}」，已拒绝`);
          return 'REJECTED';
        }
      }

      return undefined;
    },
  };
}

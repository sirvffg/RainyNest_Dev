// vendor/plugins/related-posts/index.ts — 相关文章推荐（按共享标签数排序）
import { createElement } from 'react';
import type { PluginContext, ExtensionHandlers } from '@rainynest/plugin-types';

export default function relatedPostsPlugin(ctx: PluginContext): ExtensionHandlers {
  const config = (ctx.config || {}) as { limit?: number };
  const defaultLimit = Math.max(1, Math.min(20, Number(config.limit) || 5));

  return {
    // 侧栏 widget：声明 API 容器，由前台 SidebarPluginWidgets 客户端组件按当前路径填充
    injectSidebarWidget() {
      return [
        {
          title: '相关文章',
          order: 10,
          component: () =>
            createElement('div', {
              'data-widget-api': '/api/plugin/related-posts/related',
              'data-widget-param': 'slug',
              className: 'anim-fade-in',
            }, createElement('p', { className: 'py-1 text-xs text-fg-muted' }, '正在加载相关文章...')),
        },
      ];
    },

    customApi: [
      {
        method: 'GET',
        path: '/related',
        auth: false,
        handler: async (req: Request) => {
          const params = new URL(req.url).searchParams;
          const slug = params.get('slug');
          const limit = Math.max(
            1,
            Math.min(20, Number(params.get('limit')) || defaultLimit)
          );

          const empty = new Response(JSON.stringify({ list: [] }), {
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          });
          if (!slug) return empty;

          const post = await ctx.db.post.findUnique({
            where: { slug },
            select: { id: true, tags: { select: { tagId: true } } },
          });
          if (!post || post.tags.length === 0) return empty;

          const tagIds = post.tags.map((t: { tagId: string }) => t.tagId);

          // 找到共享这些标签的其他已发布文章
          const rows = await ctx.db.postTag.findMany({
            where: {
              tagId: { in: tagIds },
              post: { status: 'PUBLISHED', id: { not: post.id } },
            },
            select: {
              postId: true,
              post: { select: { title: true, slug: true, summary: true } },
            },
          });

          // 按共享标签数排序
          const score = new Map<string, { title: string; slug: string; summary: string | null; hits: number }>();
          for (const row of rows) {
            const prev = score.get(row.postId);
            if (prev) {
              prev.hits += 1;
            } else {
              score.set(row.postId, {
                title: row.post.title,
                slug: row.post.slug,
                summary: row.post.summary,
                hits: 1,
              });
            }
          }

          const list = [...score.values()]
            .sort((a, b) => b.hits - a.hits)
            .slice(0, limit)
            .map(({ title, slug: s, summary }) => ({ title, slug: s, summary }));

          return new Response(JSON.stringify({ list }), {
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          });
        },
      },
    ],
  };
}

// vendor/plugins/sitemap-enhance/index.ts — 完整 sitemap.xml（文章/分类/标签/相册）
import type { PluginContext, ExtensionHandlers } from '@rainynest/plugin-types';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function w3cDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

export default function sitemapEnhancePlugin(ctx: PluginContext): ExtensionHandlers {
  return {
    customApi: [
      {
        method: 'GET',
        path: '/sitemap.xml',
        auth: false,
        handler: async () => {
          const base = (ctx.site?.url || 'http://localhost:3000').replace(/\/$/, '');

          const entries: { loc: string; lastmod?: string; priority: string; freq: string }[] = [
            { loc: `${base}/`, priority: '1.0', freq: 'daily' },
            { loc: `${base}/blog`, priority: '0.9', freq: 'daily' },
            { loc: `${base}/archive`, priority: '0.5', freq: 'weekly' },
            { loc: `${base}/tags`, priority: '0.4', freq: 'weekly' },
            { loc: `${base}/gallery`, priority: '0.4', freq: 'weekly' },
            { loc: `${base}/links`, priority: '0.4', freq: 'monthly' },
          ];

          try {
            const posts = await ctx.db.post.findMany({
              where: { status: 'PUBLISHED' },
              select: { slug: true, updatedAt: true },
              orderBy: { updatedAt: 'desc' },
              take: 5000,
            });
            for (const p of posts) {
              entries.push({
                loc: `${base}/blog/${p.slug}`,
                lastmod: w3cDate(p.updatedAt),
                priority: '0.8',
                freq: 'weekly',
              });
            }

            const categories = await ctx.db.category.findMany({ select: { slug: true } });
            for (const c of categories) {
              entries.push({ loc: `${base}/blog?category=${c.slug}`, priority: '0.5', freq: 'weekly' });
            }

            const tags = await ctx.db.tag.findMany({ select: { slug: true } });
            for (const t of tags) {
              entries.push({ loc: `${base}/blog?tag=${t.slug}`, priority: '0.3', freq: 'weekly' });
            }

            const galleries = await ctx.db.gallery.findMany({
              where: { status: 'PUBLISHED' },
              select: { slug: true, updatedAt: true },
            });
            for (const g of galleries) {
              entries.push({
                loc: `${base}/gallery/${g.slug}`,
                lastmod: w3cDate(g.updatedAt),
                priority: '0.5',
                freq: 'weekly',
              });
            }
          } catch (err) {
            ctx.logger.warn('sitemap 数据查询失败，仅输出静态页', err);
          }

          const urls = entries
            .map((e) =>
              [
                '  <url>',
                `    <loc>${escapeXml(e.loc)}</loc>`,
                e.lastmod ? `    <lastmod>${e.lastmod}</lastmod>` : null,
                `    <changefreq>${e.freq}</changefreq>`,
                `    <priority>${e.priority}</priority>`,
                '  </url>',
              ]
                .filter(Boolean)
                .join('\n')
            )
            .join('\n');

          const xml = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
            urls,
            '</urlset>',
          ].join('\n');

          return new Response(xml, {
            headers: { 'Content-Type': 'application/xml; charset=utf-8' },
          });
        },
      },
    ],
  };
}

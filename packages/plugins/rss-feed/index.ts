// vendor/plugins/rss-feed/index.ts — RSS 2.0 / Atom 订阅源输出
import type { PluginContext, ExtensionHandlers } from '@rainynest/plugin-types';

interface FeedPost {
  title: string;
  slug: string;
  summary: string | null;
  content: string;
  publishedAt: Date | null;
  updatedAt: Date;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlResponse(xml: string): Response {
  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}

function rfc822(date: Date | null): string {
  return (date ?? new Date()).toUTCString();
}

function iso8601(date: Date | null): string {
  return (date ?? new Date()).toISOString();
}

export default function rssFeedPlugin(ctx: PluginContext): ExtensionHandlers {
  const config = (ctx.config || {}) as { limit?: number };

  async function fetchPosts(): Promise<FeedPost[]> {
    const limit = Math.max(1, Math.min(100, Number(config.limit) || 20));
    const posts = await ctx.db.post.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { publishedAt: 'desc' },
      take: limit,
      select: {
        title: true,
        slug: true,
        summary: true,
        content: true,
        publishedAt: true,
        updatedAt: true,
      },
    });
    return posts;
  }

  return {
    customApi: [
      {
        method: 'GET',
        path: '/rss.xml',
        auth: false,
        handler: async () => {
          const base = (ctx.site?.url || 'http://localhost:3000').replace(/\/$/, '');
          const posts = await fetchPosts();

          const items = posts
            .map((p) => {
              const url = `${base}/blog/${p.slug}`;
              const description = p.summary || p.content.slice(0, 300);
              return [
                '    <item>',
                `      <title>${escapeXml(p.title)}</title>`,
                `      <link>${escapeXml(url)}</link>`,
                `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
                `      <pubDate>${rfc822(p.publishedAt)}</pubDate>`,
                `      <description><![CDATA[${description}]]></description>`,
                '    </item>',
              ].join('\n');
            })
            .join('\n');

          const xml = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
            '  <channel>',
            `    <title>${escapeXml(ctx.site?.title || 'RainyNest')}</title>`,
            `    <link>${escapeXml(base)}</link>`,
            `    <description>${escapeXml(ctx.site?.description || '')}</description>`,
            '    <language>zh-CN</language>',
            `    <lastBuildDate>${rfc822(new Date())}</lastBuildDate>`,
            `    <atom:link href="${escapeXml(`${base}/rss.xml`)}" rel="self" type="application/rss+xml" />`,
            items,
            '  </channel>',
            '</rss>',
          ].join('\n');

          return xmlResponse(xml);
        },
      },
      {
        method: 'GET',
        path: '/atom.xml',
        auth: false,
        handler: async () => {
          const base = (ctx.site?.url || 'http://localhost:3000').replace(/\/$/, '');
          const posts = await fetchPosts();

          const entries = posts
            .map((p) => {
              const url = `${base}/blog/${p.slug}`;
              const summary = p.summary || p.content.slice(0, 300);
              return [
                '  <entry>',
                `    <title>${escapeXml(p.title)}</title>`,
                `    <link href="${escapeXml(url)}" />`,
                `    <id>${escapeXml(url)}</id>`,
                `    <updated>${iso8601(p.updatedAt)}</updated>`,
                `    <published>${iso8601(p.publishedAt)}</published>`,
                `    <summary type="html"><![CDATA[${summary}]]></summary>`,
                '  </entry>',
              ].join('\n');
            })
            .join('\n');

          const xml = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<feed xmlns="http://www.w3.org/2005/Atom">',
            `  <title>${escapeXml(ctx.site?.title || 'RainyNest')}</title>`,
            `  <subtitle>${escapeXml(ctx.site?.description || '')}</subtitle>`,
            `  <link href="${escapeXml(base)}" />`,
            `  <link href="${escapeXml(`${base}/atom.xml`)}" rel="self" />`,
            `  <id>${escapeXml(base)}</id>`,
            `  <updated>${iso8601(new Date())}</updated>`,
            entries,
            '</feed>',
          ].join('\n');

          return xmlResponse(xml);
        },
      },
    ],
  };
}

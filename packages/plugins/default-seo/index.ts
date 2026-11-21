// vendor/plugins/default-seo/index.ts — SEO 助手：摘要生成 + 元数据增强 + 站点验证标签
import type { PluginContext, ExtensionHandlers } from '@rainynest/plugin-types';

const SUMMARY_LENGTH = 120;

// 去除 Markdown 语法符号得到纯文本
function toPlainText(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, ' ')   // 代码块
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接保留文字
    .replace(/[#*`>_~\-|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function defaultSeoPlugin(ctx: PluginContext): ExtensionHandlers {
  const config = (ctx.config || {}) as {
    googleVerification?: string;
    baiduVerification?: string;
  };

  return {
    // 保存文章前：无 summary 时从 content 截取前 120 字符；coverImage 缺失时保留不动
    beforeSavePost(post: Record<string, unknown>, meta) {
      const summary = typeof post.summary === 'string' ? post.summary.trim() : '';
      if (!summary) {
        const content = typeof post.content === 'string' ? post.content : '';
        if (content) {
          const text = toPlainText(content);
          if (text) {
            meta.patch ??= {};
            meta.patch.summary = text.slice(0, SUMMARY_LENGTH);
          }
        }
      }
      // coverImage 为空时保留原值，不写入 patch
    },

    // 元数据生成时补 openGraph / twitter 字段
    onGenerateMetadata({ metadata, post }) {
      const base = (ctx.site?.url || 'http://localhost:3000').replace(/\/$/, '');
      const title =
        (metadata.title as string) ||
        (post?.title as string) ||
        ctx.site?.title ||
        'RainyNest';
      const description =
        (metadata.description as string) ||
        (post?.summary as string) ||
        ctx.site?.description ||
        '';
      const url = post?.slug ? `${base}/blog/${post.slug}` : base;
      const images = (metadata.images as string[]) ||
        (post?.coverImage ? [String(post.coverImage)] : undefined) ||
        (ctx.site?.logo ? [ctx.site.logo] : undefined);

      metadata.title = title;
      metadata.description = description;
      metadata.openGraph = {
        title,
        description,
        url,
        siteName: ctx.site?.title || 'RainyNest',
        type: post?.slug ? 'article' : 'website',
        ...(images ? { images } : {}),
      };
      metadata.twitter = {
        card: images ? 'summary_large_image' : 'summary',
        title,
        description,
        ...(images ? { images } : {}),
      };
      return metadata;
    },

    // <head> 注入站长平台验证 meta 标签
    injectHead() {
      const tags: string[] = [];
      if (config.googleVerification) {
        tags.push(
          `<meta name="google-site-verification" content="${config.googleVerification}" />`
        );
      }
      if (config.baiduVerification) {
        tags.push(
          `<meta name="baidu-site-verification" content="${config.baiduVerification}" />`
        );
      }
      return tags;
    },
  };
}

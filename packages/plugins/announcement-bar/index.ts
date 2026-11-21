// packages/plugins/announcement-bar/index.ts — 预装示例插件：站点公告栏
// 演示 0.3.0 新增 SPI：injectHeaderAction / dashboardQuickAction / injectFooter / apiMiddleware / notifier
import type {
  ApiMiddlewareDef,
  ExtensionHandlers,
  HeaderActionDef,
  PluginContext,
  PluginNotifier,
  QuickActionDef,
} from '@rainynest/plugin-types';

interface AnnouncementConfig {
  enabled?: boolean;
  message?: string;
  link?: string;
  linkText?: string;
  /** 是否提供通知器（默认关闭，避免接管并吞掉宿主的默认邮件通知） */
  useNotifier?: boolean;
}

/** HTML 转义：公告内容来自后台配置，注入页脚前必须转义 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export default function announcementBarPlugin(ctx: PluginContext): ExtensionHandlers {
  const config = (ctx.config || {}) as AnnouncementConfig;
  // 未配置 enabled 时默认启用
  const enabled = config.enabled !== false;
  const message = (config.message || '').trim();
  const link = (config.link || '').trim();
  const linkText = (config.linkText || '查看详情').trim();

  /** 是否展示公告内容（启用且公告非空） */
  const active = enabled && message.length > 0;

  // 后台仪表盘快捷操作：始终提供入口，便于配置公告
  const quickActions: QuickActionDef[] = enabled
    ? [{ label: '编辑公告', icon: 'megaphone', href: '/console/system/plugins' }]
    : [];

  // API 过滤器：命中 /api/posts 的 GET 请求时，在宿主响应上追加公告响应头
  const apiMiddleware: ApiMiddlewareDef[] = [
    {
      path: '/api/posts',
      methods: ['GET'],
      async handler(_req, next) {
        // 先放行到下一个中间件/宿主路由，拿到原始 Response
        const res = await next();
        if (!active) return res;

        const headers = new Headers(res.headers);
        // HTTP 头只允许单字节字符，中文公告先做 URL 编码
        headers.set('x-announcement', encodeURIComponent(message));
        // 复制 body/status/statusText，保留宿主响应内容
        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers,
        });
      },
    },
  ];

  const handlers: ExtensionHandlers = {
    // 主题顶栏按钮：点击跳转到 config.link（未配置链接时退化为纯按钮）
    injectHeaderAction(): HeaderActionDef[] {
      if (!active) return [];
      return [
        {
          key: 'announcement',
          label: '公告',
          icon: 'megaphone',
          href: link || undefined,
          order: 10,
        },
      ];
    },

    // 后台仪表盘快捷操作：跳到插件管理页编辑公告
    dashboardQuickAction: quickActions,

    // 页脚公告：返回一行 HTML，message 与链接均已转义
    injectFooter() {
      if (!active) return [];
      const linkHtml = link
        ? ` <a href="${escapeHtml(link)}" style="margin-left:8px;color:#2563eb;text-decoration:underline;">${escapeHtml(linkText)}</a>`
        : '';
      return [
        `<div class="rn-announcement" style="padding:8px 16px;text-align:center;font-size:13px;color:#475569;background:#f1f5f9;border-top:1px solid #e2e8f0;">${escapeHtml(message)}${linkHtml}</div>`,
      ];
    },

    // API 拦截演示：/api/posts 响应追加 x-announcement 头
    apiMiddleware,
  };

  // provider 型扩展点：只有显式开启 useNotifier 才提供，否则保持缺省（宿主继续用内置邮件通知）
  if (enabled && config.useNotifier === true) {
    const notifier: PluginNotifier = {
      name: 'announcement-bar',
      async send(notification) {
        const to = Array.isArray(notification.to) ? notification.to.join(', ') : notification.to;
        ctx.logger.info(
          `[公告栏] 示例通知器接管 ${notification.scene || 'default'} → ${to}：${notification.subject}`
        );
        // 示例实现只记录日志，实际项目中可在此对接钉钉 / 飞书 / Webhook
        return { ok: true, messageId: `announcement-${Date.now()}` };
      },
    };
    handlers.notifier = notifier;
  }

  return handlers;
}

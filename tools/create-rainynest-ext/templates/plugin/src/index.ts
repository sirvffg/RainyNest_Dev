// src/index.ts — __SLUG__ 插件入口
import type { PluginContext, ExtensionHandlers } from '@rainynest/plugin-types';

export default function createPlugin(ctx: PluginContext): ExtensionHandlers {
  ctx.logger.info('__SLUG__ 已加载，版本', ctx.version);

  return {
    // 在这里实现扩展点，例如：
    // onMount(ctx) {},
    // injectFooter() { return []; },

    // ── 0.3.0 新增 SPI 示例（按需取消注释）──

    // 1) apiMiddleware：/api 请求前置中间件，return Response 即拦截
    // apiMiddleware: [{
    //   path: '/api/posts', methods: ['GET'],
    //   async handler(_req, next) {
    //     const res = await next();
    //     const headers = new Headers(res.headers);
    //     headers.set('x-demo', '1');
    //     return new Response(res.body, { status: res.status, headers });
    //   },
    // }],

    // 2) attachmentStorage：provider 型扩展点，第一个提供的插件生效
    // attachmentStorage: {
    //   name: '__SLUG__',
    //   async upload(input) { return { url: `/uploads/${input.filename}` }; },
    // },

    // 3) injectHeaderAction：主题顶栏按钮
    // injectHeaderAction: () => [{ key: 'demo', label: '示例', href: '/' }],

    // 4) dashboardQuickAction：后台仪表盘快捷入口
    // dashboardQuickAction: [{ label: '示例入口', href: '/console' }],

    // 5) pluginDetailTab：插件详情页 Tab（组件动态加载）
    // pluginDetailTab: [{ key: 'demo', label: '示例', component: () => import('./admin.js') }],
  };
}

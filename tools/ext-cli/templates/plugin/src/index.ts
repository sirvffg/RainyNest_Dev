// src/index.ts — __SLUG__ 插件入口
import type { PluginContext, ExtensionHandlers } from '@rainynest/plugin-types';

export default function createPlugin(ctx: PluginContext): ExtensionHandlers {
  ctx.logger.info('__SLUG__ 已加载，版本', ctx.version);

  return {
    // 在这里实现扩展点，例如：
    // onMount(ctx) {},
    // injectFooter() { return []; },
  };
}

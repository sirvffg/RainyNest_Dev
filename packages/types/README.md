# @rainynest/plugin-types

RainyNest 博客插件/主题扩展开发的 SPI 类型定义。纯类型包，无运行时代码。

## 安装

```bash
npm i -D @rainynest/plugin-types
```

## 使用

```ts
import type { PluginContext, ExtensionHandlers } from '@rainynest/plugin-types';

export default function myPlugin(ctx: PluginContext): ExtensionHandlers {
  return {
    onMount(ctx) {
      ctx.logger.info('hello', ctx.site.title);
    },
  };
}
```

配合 CLI 使用：

```bash
npx @rainynest/ext new plugin my-plugin
npx @rainynest/ext build my-plugin -o dist
npx @rainynest/ext pack dist --format zip
# 产出 my-plugin.zip.rainy-plugin，到 RainyNest 后台「系统 → 插件」上传安装
```

## 主题开发（v0.3.2：Halo 级系统模板）

主题在 `templates/` 下按页面放置 TSX 即可覆盖系统布局：

```tsx
// templates/post.tsx
import type { PostDetailTemplateProps } from '@rainynest/plugin-types';

export default function PostDetail({ post, html, commentsCount, slots }: PostDetailTemplateProps) {
  return (
    <div>
      <h1>{post.title}</h1>
      <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
      {slots.contentBlocks}
      {slots.comments}
    </div>
  );
}
```

支持的模板名（Props 见 `ThemeTemplateMap`）：

`layout`、`home`、`post-list`、`post`（`post-detail` 兼容）、`page`、`archive`、`categories`、`category`、`tags`、`tag`、`search`、`moments`、`moment`、`links`、`gallery`、`photo`、`error`。

编译方式为混合模式：

- 已安装主题由宿主 `predev` / `prebuild` 生成静态注册表，**支持 `@/` 别名与 `'use client'` 客户端组件**
- 新安装、尚未重启的主题退回运行时编译，仅支持服务端模板
- 评论表单、目录、分页、灯箱等交互区块以 `props.slots` 传入，可直接复用，也可自行实现

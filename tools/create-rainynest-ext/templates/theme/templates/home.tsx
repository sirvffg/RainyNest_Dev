// templates/home.tsx — 首页模板示例（可删除）
// 已安装主题由宿主构建期注册表编译：支持 `@/` 别名与 `'use client'`。
import type { HomeTemplateProps } from '@rainynest/plugin-types';

export default function HomeTemplate({ site, posts, total, slots }: HomeTemplateProps) {
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{site.title}</h1>
        {site.subtitle ? <p className="text-sm text-fg-muted">{site.subtitle}</p> : null}
        <p className="text-xs text-fg-muted">
          共 {total} 篇文章 · 最近 {posts.length} 篇
        </p>
      </header>

      {/* 宿主预渲染的文章卡片网格（保留入场动画），也可自行遍历 posts 渲染 */}
      {slots.posts}
    </div>
  );
}

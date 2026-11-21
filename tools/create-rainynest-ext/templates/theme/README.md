# __SLUG__

RainyNest 主题。

## 开发

```bash
npm install
npm run dev    # 联调热更新，需要 RainyNest 主项目 .env 里的 EXT_DEV_TOKEN
```

## 模板

在 `templates/` 下按页面放置 TSX 即可覆盖系统布局，存在即生效：

| 文件 | 页面 |
|------|------|
| `layout.tsx` | 整体壳（Header/Sidebar/Footer 摆放） |
| `home.tsx` | 首页 |
| `post-list.tsx` | 博客列表 |
| `post.tsx` | 文章详情（旧名 `post-detail.tsx` 兼容） |
| `page.tsx` | 独立页面 |
| `archive.tsx` | 归档 |
| `categories.tsx` / `category.tsx` | 分类列表 / 详情 |
| `tags.tsx` / `tag.tsx` | 标签列表 / 详情 |
| `search.tsx` | 搜索 |
| `moments.tsx` / `moment.tsx` | 说说列表 / 详情 |
| `links.tsx` | 友链 |
| `gallery.tsx` / `photo.tsx` | 相册列表 / 详情 |
| `error.tsx` | 404 |

Props 类型从 `@rainynest/plugin-types` 导入，例如 `HomeTemplateProps`、`PostDetailTemplateProps`、`LayoutTemplateProps`。

**编译方式**：已安装主题由宿主 `predev` / `prebuild` 生成的注册表静态编译，支持 `@/` 别名与 `'use client'` 客户端组件；新装主题在重启前由运行时编译兜底（仅服务端模板）。修改模板后重启一次宿主即可获得完整能力。

评论表单、目录、分页、灯箱等交互区块由宿主以 `props.slots` 传入，可直接摆放，也可用 `'use client'` 自己实现。

`templates/plugins/<pluginSlug>/<name>.tsx` 可覆盖插件模板。

## 发布

```bash
npm run pack
# 产出 dist/__SLUG__.gz.rainy-theme，到 RainyNest 后台「系统 → 主题」上传安装
```

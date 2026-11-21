# RainyNest 插件 / 主题独立包方案

> 目标：插件和主题像 Halo 一样以单个压缩包分发，包内自包含；开发工具链脱离主项目；主项目发布包不再携带扩展源码。

## 1. 范围与原则

- 本方案只改「插件 + 主题」这一层，核心（文章、评论、统计、RBAC）不动。
- 扩展包 = 清单 + 已编译 JS + 静态资源，**一个 zip/tar.gz 装完所有东西**，服务器上不装依赖、不编译。
- 开发者只需要 Node + 扩展脚手架，**不需要 clone RainyNest 源码**。
- `vendor/` 目录退役：源码期开发放在独立目录/独立仓库，主项目运行时只认「已安装的扩展包」。

## 2. 包格式规范

### 2.1 插件包（*.zip.rainy-plugin / *.gz.rainy-plugin）

```
my-plugin.zip.rainy-plugin
├── plugin.json        # 清单（必填）
├── index.js           # 服务端入口：已编译 CJS，依赖已全部 bundle
├── admin.js           # 可选：后台页面组件（已编译，动态 import 加载）
├── assets/            # 可选：静态资源（css/img），经 /api/plugin/<slug>/assets/* 访问
├── migrations/        # 可选：插件独立库 SQL 迁移（plugin.json.database.migrations 引用）
├── README.md
└── LICENSE
```

**plugin.json 字段**（沿用现有 PluginMeta，新增两项）：

```json
{
  "slug": "reading-time",
  "name": "阅读时间",
  "version": "1.2.0",
  "description": "文首显示预计阅读时长",
  "author": "someone",
  "specVersion": "1.0",
  "requiresCore": ">=1.0.0",
  "entry": "index.js",
  "permissions": [{ "name": "plugin:reading-time:view", "displayName": "查看统计", "group": "插件" }],
  "roleTemplates": [],
  "database": { "enabled": true, "migrations": [{ "version": "1.0.0", "file": "migrations/001_init.sql" }] },
  "configSchema": { "wpm": { "type": "number", "label": "阅读速度", "default": 300 } }
}
```

**打包规则（自包含的关键）**：

- esbuild `bundle: true`：插件自己的 npm 依赖全部打进 index.js，服务器无需 npm install。
- external（由宿主提供，禁止打包）：`react`、`react-dom`、`@prisma/client`、`next`。
- 禁止原生模块（better-sqlite3、sharp 等）：数据一律走 `ctx.pluginDb`（宿主分配的 SQLite 库），图片走上传接口。
- 产物平台无关：纯 JS，Windows 打包 Linux 可用。

### 2.2 主题包（*.zip.rainy-theme / *.gz.rainy-theme）

```
my-theme.zip.rainy-theme
├── theme.json     # 清单 + 配置 schema + 默认值
├── theme.js       # 配置值 → CSS 变量 映射（已编译）
├── theme.css      # 主题样式（安装后经 /themes/<slug>/theme.css 访问）
├── preview.png    # 后台卡片预览图
├── templates/     # 可选：系统页面模板 + 插件模板覆盖
│   ├── layout.tsx        # 整体壳
│   ├── home.tsx          # 首页
│   ├── post-list.tsx     # 博客列表
│   ├── post.tsx          # 文章详情（post-detail.tsx 兼容）
│   ├── page.tsx / archive.tsx / categories.tsx / category.tsx
│   ├── tags.tsx / tag.tsx / search.tsx / moments.tsx / moment.tsx
│   ├── links.tsx / gallery.tsx / photo.tsx / error.tsx
│   └── plugins/<plugin>/<name>.tsx
└── assets/
```

**模板编译（混合模式）**：宿主 `predev` / `prebuild` 扫描已安装主题生成静态注册表，模板按普通 Next 模块编译，支持 `@/` 别名与 `'use client'`；新装未重启的主题由运行时 esbuild 兜底（仅服务端模板）。安装器白名单已包含 `.tsx`。

**命名规则**：格式标记插在类型后缀之前——`名称.zip.rainy-plugin`（zip 容器）、`名称.gz.rainy-theme`（tar.gz 容器）。安装器按**最后一段** `.rainy-plugin` / `.rainy-theme` 识别包类型，按其前的 `.zip` / `.gz` 选择解包器（`.gz` 一律按 tar.gz 处理）。两种容器内容结构完全一致。

### 2.3 兼容矩阵

- `specVersion`：包格式版本。宿主支持 `0.3.0` 与 `1.0`；不认识的版本拒装并提示。
- `requiresCore`：semver 区间，与核心版本比对，不满足则拒绝启用。
- 扩展点集合以 `specVersion 0.3.0` 冻结；新增扩展点只加不改，老包不受影响。

## 3. 独立开发套件（脱离主项目的 Node 工具链）

发布两个 npm 包：

| 包 | 作用 |
| --- | --- |
| `create-rainynest-ext` | 脚手架：`npm create rainynest-ext my-plugin` 生成插件/主题模板工程 |
| `@rainynest/ext` | CLI：`dev` / `build` / `pack`；类型定义随包分发 |

模板工程结构（与主项目零耦合）：

```
my-plugin/
├── src/index.ts        # 实现 ExtensionHandlers
├── src/admin.tsx       # 可选后台页
├── plugin.json         # 与打包清单同源
├── esbuild.config.mjs  # 引 @rainynest/ext 的统一构建配置
└── package.json        # devDependencies: @rainynest/ext, @rainynest/plugin-types
```

CLI 行为：

- `ext dev`：watch 编译 + 携带管理 token 调用临时安装接口热更新（上传临时包 → reload），浏览器即时可见。token 存在模板工程的本地 `.env`，不入库不入 git。
- `ext build`：esbuild bundle → 校验清单 → 产出 `.rainy-plugin` / `.rainy-theme`。
- 类型包 `@rainynest/plugin-types` 从 `lib/plugin/types.ts` 同步发布，开发者拿到 PluginContext / ExtensionHandlers 全类型。

## 4. 运行时：安装 / 升级 / 卸载

**目录布局**（运行时，持久，进备份）：

```
scripts/
├── plugins/<slug>/     # 已安装插件（内置预装 + 后台上传，同一目录）
├── themes/<slug>/      # 已安装主题（内置预装 + 后台上传，同一目录）
└── …                   # 现有构建/维护脚本
public/themes/<slug>/   # 主题静态资源副本（theme.css/preview/assets）
```

**安装流程**（`POST /api/console/plugins/install`，仅管理员）：

1. multipart 上传 zip/gz，大小上限 20 MB。
2. 解压到内存校验：必须含 `plugin.json`，`specVersion` 支持、`requiresCore` 满足、slug 合法（`[a-z0-9-]`）。
3. 逐条目防 zip-slip（规范化路径必须落在目标目录内），白名单后缀：`.js/.tsx/.json/.css/.png/.jpg/.jpeg/.svg/.webp/.sql/.md/.txt/.woff/.woff2/.ttf`。
4. 落盘 `scripts/plugins/<slug>/`（已存在则先备份旧版本；内置包目录同位置，靠 `source` 字段区分）。
5. 写/更新 Plugin 表（新增 `source` 字段：`builtin | uploaded`），跑 database.migrations。
6. `engine.reload()` 热加载，返回安装结果；前端局部刷新列表。

**升级**：版本必须大于已装版本；先备份旧目录，迁移失败或加载失败自动回滚并报错。

**卸载**（弹确认框，**询问是否保留插件数据**）：

- `builtin`：只允许停用，不允许删除（预装包随核心走）。
- `uploaded`：删除目录 + DB 记录；确认框二选一——「保留数据」（pluginDb 文件留在 db/plugins/，重装后数据还在）或「连数据一起删除」。

**主题安装**同流程，额外把静态资源复制到 `public/themes/<slug>/`，激活逻辑复用现有 Theme 表事务切换。

## 5. 对现有代码的改动点

| 现状 | 改为 |
| --- | --- |
| [engine.ts](file:///d:/File/代码/网站源码/RainyNest/lib/plugin/engine.ts#L18) 读 `.vendor-compiled/plugins` | 读 `scripts/plugins`（已编译产物，加载逻辑不变） |
| [theme.ts](file:///d:/File/代码/网站源码/RainyNest/lib/theme.ts#L8) 读 `.vendor-compiled/themes` | 读 `scripts/themes` |
| `build-vendor.js` 每次 prestart 清空重建 | 删除。内置包以解包形态直接随项目放在 `scripts/{plugins,themes}`，启动仅校验清单完整性，**运行时不再需要 esbuild** |
| `sync-themes.js` 清空复制 public/themes | 删除。主题安装时复制静态资源到 public/themes；prestart 只补缺失文件 |
| `vendor/` 源码目录 | 从主项目移除（源码迁到独立模板仓库）；`scripts/{plugins,themes}` 直接携带 8 插件 + default 主题的安装态产物（约 40 KB） |

## 6. 安全边界

- 仅 administrator 角色可上传/卸载；操作写审计日志。
- 上传包的 JS 与核心同进程执行（等同管理员信任，CMS 惯例），防线放在：specVersion 校验、路径穿越、白名单后缀、大小限制。
- 原生模块包在解压校验阶段直接拒绝（清单 `native: true` 检测 + 产物扫描 `.node` 文件）。

## 7. 里程碑（✅ 全部完成）

1. **M4 开发套件（✅）**：`@rainynest/ext` CLI（new/build/build-all/pack/dev）+ 模板 + 管理 token 临时安装接口（dev 热更新，自动读主项目 .env token）。
2. **M1 包格式冻结（✅）**：plugin.json/theme.json specVersion 1.0 由 CLI 的打包器实现并校验，规范随 CLI 落地。发布包只装产物（esbuild bundle + 白名单后缀），默认格式：插件 zip、主题 gz。
3. **M3 内置包迁移（✅）**：CLI build-all 把 8 插件 + default 主题打成安装态产物落 `scripts/{plugins,themes}`；engine/theme 路径切换；删除 build-vendor/sync-themes/vendor。
4. **M2 安装体系（✅）**：`installFromBuffer` 共享安装器（版本必须递增、备份回滚、zip-slip 防护）+ 插件/主题 install/uninstall API（builtin 禁卸、卸载询问保留数据）+ 后台「上传安装」按钮与卸载弹框 + Plugin/Theme `source` 字段迁移。主题静态资源由 `app/themes/[slug]/[...path]` 路由动态服务（next start 不会热加载 public/）。Windows 下 rmSync 静默失败用 rename 兜底 + 启动清扫。

## 8. 已确认决策

1. **包后缀**：`名称.zip.rainy-plugin` / `名称.gz.rainy-plugin`（gz 为 tar.gz），主题同理；按最后一段识别类型，前段识别容器格式。
2. **内置预装**：直接放主项目 `scripts/plugins`（插件）、`scripts/themes`（主题），与上传安装共用同一目录。
3. **卸载**：弹确认框询问是否保留插件数据。
4. **dev 热更新联调**：走「管理 token + 临时安装接口」。

## 9. 0.3.0 新增 SPI

> 0.3.0 只新增扩展点、不改动既有定义。清单可声明 `"specVersion": "0.3.0"`；1.0 老包继续可用，缺少 `specVersion` 时按 0.3.0 处理。
>
> **执行顺序**：provider 型扩展点（`attachmentStorage` / `notifier` / `searchProvider`）全局只取**第一个**提供者，其余插件即使提供也会被忽略；未提供 `notifier` 时宿主回退内置 SMTP。其余数组/收集型扩展点按**插件 slug 扫描顺序**逐个累加，数组顺序即执行/渲染顺序。

### 9.1 服务端

- **`apiMiddleware`** — 所有 `/api` 请求前置中间件；返回 `Response` 即拦截，调用 `next()` 继续。
```ts
apiMiddleware: [{
  path: '/api/posts',
  async handler(_req, next) {
    const res = await next(), h = new Headers(res.headers);
    h.set('x-demo', '1');
    return new Response(res.body, { status: res.status, headers: h });
  },
}]
```

- **`attachmentStorage`** — 替换默认本地附件存储（OSS / S3 / 七牛等），provider 型第一个生效。
```ts
attachmentStorage: {
  name: 'oss',
  async upload(input) {
    const url = await putToOss(input.buffer, input.filename);
    return { url, name: input.filename, size: input.size };
  },
  delete: async (url) => delFromOss(url),
},
```

- **`notifier`** — 接管评论审核、验证码、重置密码等通知发送，provider 型第一个生效。
```ts
notifier: {
  name: 'webhook',
  async send(msg) {
    const r = await fetch(WEBHOOK, { method: 'POST', body: JSON.stringify(msg) });
    return { ok: r.ok, error: r.ok ? undefined : String(r.status) };
  },
},
```

- **`providesTemplates`** — 声明插件自带 `templates/<name>.tsx`，可被当前主题同名模板覆盖。
```ts
providesTemplates: ['post-detail'],
```

### 9.2 主题端

- **`injectHeaderAction`** — 在站点顶栏追加按钮（结构化数据，由 Header 渲染）。
```ts
injectHeaderAction: () => [{
  key: 'github', label: 'GitHub', icon: 'github',
  href: 'https://github.com/example', order: 10,
}],
```

- **`injectSinglePageContent`** — 在独立页面（关于/友链等）底部追加 React 区块。
```ts
injectSinglePageContent: () => [
  function SponsorNote() {
    return <p>感谢支持</p>;
  },
],
```

- **`injectCommentField`** — 在评论表单追加自定义字段，提交值随评论存储。
```ts
injectCommentField: () => [{
  key: 'qq', label: 'QQ 号', type: 'text',
  required: false, placeholder: '选填',
}],
```

### 9.3 后台仪表盘与列表操作

- **`dashboardQuickAction`** — 仪表盘快捷入口，`href` 指向后台页面。
```ts
dashboardQuickAction: [{
  label: '编辑公告', icon: 'megaphone',
  href: '/console/system/plugins',
}],
```

- **`postListItemOperation`** — 文章列表行操作；`onClick` 为链接模板，支持 `{id}` / `{slug}`。
```ts
postListItemOperation: [{
  label: '刷新缓存', icon: 'refresh',
  onClick: '/console/system/plugins?post={id}',
  permissions: ['post:edit'],
}],
```

- **`pageListItemOperation`** — 独立页面列表行操作，写法同上。
```ts
pageListItemOperation: [{
  label: '预览页面', icon: 'eye',
  onClick: '/{slug}', permissions: ['page:view'],
}],
```

- **`commentListItemOperation`** — 评论列表行操作。
```ts
commentListItemOperation: [{
  label: '查看用户', icon: 'user',
  onClick: '/console/system/users?comment={id}',
  permissions: ['comment:edit'],
}],
```

- **`replyListItemOperation`** — 评论回复列表行操作。
```ts
replyListItemOperation: [{
  label: '定位原文', icon: 'corner-down-right',
  onClick: '/console/comments?reply={id}',
  permissions: ['comment:edit'],
}],
```

- **`pluginListItemOperation`** — 插件管理列表行操作。
```ts
pluginListItemOperation: [{
  label: '查看配置', icon: 'settings',
  onClick: '/console/system/plugins?slug={slug}',
  permissions: ['plugin:edit'],
}],
```

- **`themeListItemOperation`** — 主题管理列表行操作。
```ts
themeListItemOperation: [{
  label: '主题设置', icon: 'palette',
  onClick: '/console/system/themes?slug={slug}',
  permissions: ['theme:edit'],
}],
```

- **`attachmentListItemOperation`** — 附件列表行操作。
```ts
attachmentListItemOperation: [{
  label: '复制链接', icon: 'link',
  onClick: '/console/system/attachments?file={id}',
  permissions: ['attachment:view'],
}],
```

- **`backupListItemOperation`** — 备份列表行操作。
```ts
backupListItemOperation: [{
  label: '下载备份', icon: 'download',
  onClick: '/api/console/backups/{id}/download',
  permissions: ['backup:manage'],
}],
```

### 9.4 列表字段列

- **`postListItemField`** — 文章列表追加只读列，`render` 返回单元格文本。
```ts
postListItemField: [{
  key: 'wordCount', label: '字数', width: 90,
  render: (post) => String(post.content ?? '').length,
}],
```

- **`pageListItemField`** — 独立页面列表追加只读列。
```ts
pageListItemField: [{
  key: 'path', label: '路径', width: 160,
  render: (page) => `/${page.slug}`,
}],
```

- **`pluginListItemField`** — 插件列表追加只读列（如运行状态、版本）。
```ts
pluginListItemField: [{
  key: 'version', label: '已装版本', width: 100,
  render: (plugin) => plugin.version ?? '-',
}],
```

### 9.5 后台 Tab

- **`pluginDetailTab`** — 插件详情页追加 Tab，组件可动态加载。
```ts
pluginDetailTab: [{
  key: 'usage', label: '使用说明',
  component: () => import('./admin.js'),
}],
```

- **`themeListTab`** — 主题管理页追加 Tab。
```ts
themeListTab: [{
  key: 'market', label: '主题市场',
  component: () => import('./admin.js'),
}],
```

- **`attachmentSelectorTab`** — 附件选择器追加来源 Tab（如对象存储）。
```ts
attachmentSelectorTab: [{
  key: 'oss', label: '对象存储',
  component: () => import('./admin.js'),
}],
```

- **`pluginInstallTab`** — 插件安装页追加 Tab（如从市场安装）。
```ts
pluginInstallTab: [{
  key: 'market', label: '插件市场',
  component: () => import('./admin.js'),
}],
```

- **`backupTab`** — 备份页面追加 Tab（如远程备份）。
```ts
backupTab: [{
  key: 'remote', label: '远程备份',
  component: () => import('./admin.js'),
}],
```

- **`userDetailTab`** — 用户详情页追加 Tab。
```ts
userDetailTab: [{
  key: 'activity', label: '活跃度',
  component: () => import('./admin.js'),
}],
```

### 9.6 编辑器与评论 UI

- **`editorCreate`** — 编辑器工具栏按钮，支持插入模板与包裹选中内容。
```ts
editorCreate: () => [{
  key: 'callout', label: '提示块',
  insert: '> 💡 {selection}',
  wrap: ['> ', ''],
}],
```

- **`commentEditorReplace`** — 整体替换评论编辑器组件。
```ts
commentEditorReplace: () => MyCommentEditor,
```

- **`commentListItemContentReplace`** — 整体替换评论列表项内容组件。
```ts
commentListItemContentReplace: () => MyCommentItem,
```

- **`commentSubjectRef`** — 在评论旁展示关联主题（文章/页面/相册）入口。
```ts
commentSubjectRef: () => [{
  key: 'post', label: '文章', icon: 'file-text',
  href: (c) => `/blog/${c.post?.slug ?? ''}`,
}],
```


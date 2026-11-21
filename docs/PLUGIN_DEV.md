# RainyNest 插件开发文档

适用版本：宿主插件 SPI `@rainynest/plugin-types@0.3.2`，扩展 CLI `@rainynest/ext@0.1.1`，脚手架 `create-rainynest-ext@0.1.1`。

本文档以当前仓库代码为准，描述安装态插件（`scripts/plugins/<slug>/`）的清单、运行模型、生命周期、48 个扩展点、数据存储、API、后台 UI、模板、邮件与调试方式。所有类型名、字段名和函数签名均取自 `packages/types/index.ts` 与宿主实现。

---

## 1. 概览与能力边界

### 1.1 插件是什么

一个 RainyNest 插件是一个安装态目录：

```text
scripts/plugins/<slug>/
├── plugin.json          清单，决定 slug、版本、入口、配置、迁移
├── index.js             入口产物，CommonJS，默认导出工厂函数
├── admin.js             可选，后台页面产物
├── config.json          可选，首次启动时复制为默认配置
├── templates/           可选，插件自带模板
├── migrations/          可选，插件独立 SQLite 迁移 SQL
└── assets/              可选，静态资源
```

宿主在 Node 进程内扫描该目录，读取 `plugin.json`，`require` 入口产物，调用默认导出的工厂函数，得到扩展点实现集合。插件不是一个独立服务，也不是沙箱进程。

```ts
// index.ts 的最终形态（编译为 index.js）
import type { PluginContext, ExtensionHandlers } from '@rainynest/plugin-types';

export default function createPlugin(ctx: PluginContext): ExtensionHandlers {
  return {
    // 扩展点实现
  };
}
```

### 1.2 插件能做什么

| 能力 | 说明 | 入口 |
| --- | --- | --- |
| 内容处理 | 预处理 Markdown、生成摘要、生成 SEO 元数据、保存前后钩子 | `onRenderMarkdown`、`excerptGenerator`、`onGenerateMetadata`、`beforeSavePost` 等 |
| 前台 UI | 页头/页脚注入、文章与页面文末块、侧栏组件、顶栏按钮、评论替换与附加字段 | `injectHead`、`injectFooter`、`injectSidebarWidget` 等 |
| 后台 UI | 仪表盘卡片、快捷入口、列表字段、行操作、详情 Tab、自定义后台页面 | `dashboardWidget`、`postListItemField`、`customAdminRoutes` 等 |
| 数据持久化 | 宿主主库、访问统计库、插件独立 SQLite、插件 JSON 存储 | `ctx.db`、`ctx.analytics`、`ctx.pluginDb`、`ctx.pluginJson` |
| API | 自定义 REST 路由、对部分核心 API 做前置中间件 | `customApi`、`apiMiddleware` |
| 数据源替换 | 搜索提供者、附件存储、邮件通知器 | `searchProvider`、`attachmentStorage`、`notifier` |
| 主题模板 | 声明并提供可被主题覆盖的 TSX 模板 | `providesTemplates` |

### 1.3 插件不能做什么

| 限制 | 原因 |
| --- | --- |
| 不能修改或新增 Next.js 页面路由 | 宿主路由在构建期确定；只能通过 `customFrontendRoutes` 挂到 `/p/*` |
| 不能给既有后台页面注入客户端交互组件 | 后台扩展组件由 `renderToStaticMarkup` 渲染为静态 HTML，不进行客户端 hydration |
| 不能给既有前台页面注入客户端 hook 组件 | 除主题模板注册表外，前台注入块按静态 HTML 输出 |
| 不能拦截全部 API | `apiMiddleware` 只接在宿主显式调用 `pluginApiGate` 的少量路由上，见 8.7 |
| 不能直接读取其他插件的 JSON 或 SQLite 数据库 | 宿主没有跨插件数据 API；只能通过文件系统绕过（不推荐，且卸载语义不确定） |
| 不能在运行时安装 npm 依赖 | 入口由 esbuild 打包，依赖必须打进产物或在 externals 白名单中 |
| 不能使用任意原生模块 | CLI 产物扫描禁止 `.node`；宿主仅保证 `better-sqlite3` 等白名单模块可用 |
| 不能注册事件监听器 | `ctx.emitEvent` 只负责广播，宿主未暴露订阅 API |
| 不能声明定时任务 | SPI 无 cron/后台任务扩展点；可用外部系统调用 `customApi` |
| 不能声明核心版本上限 | 只支持 `requiresCore` 下限/区间要求，不支持声明“仅在核心 x 以下可用” |
| 不能依赖扩展点声明中的 `permissions` 做前台鉴权 | 权限过滤只作用于后台 Console 扩展点；公开前台注入（如 `injectHeaderAction`）不按权限过滤，见 4.9 |

### 1.4 信任模型

插件与宿主运行在同一个 Node 进程、同一个文件系统权限下，属于完全可信代码：

- 可以读取 `process.env`，包括数据库连接串、`AUTH_SECRET`、`EXT_DEV_TOKEN` 等。
- 可以使用宿主的 Prisma 客户端读写主库和访问库。
- 可以直接读写 `scripts/`、`db/`、`public/` 等目录。
- 可以发起任意网络请求。
- 同步 SQLite 调用会阻塞宿主事件循环。
- 插件抛出的异常会被逐扩展点捕获，但插件仍可能造成资源耗尽、数据损坏或拒绝服务。

因此只应安装来源可信的发布包。`ext-installer` 的字段校验、文件类型白名单和 20MB 限制只用于防止误操作与明显非法包，不构成安全沙箱。

### 1.5 术语

| 术语 | 含义 |
| --- | --- |
| 安装态 | `scripts/plugins/<slug>/` 下的已编译产物 |
| 源码态 | 插件作者工程中的 `src/`、`plugin.json` 等 |
| provider 型扩展点 | 宿主只取第一个提供者，如 `searchProvider`、`attachmentStorage`、`notifier` |
| 数组型扩展点 | 扩展点值是数组，宿主遍历收集，如 `dashboardWidget`、`customApi` |
| 函数型扩展点 | 扩展点值是函数，宿主需要调用后取得结果，如 `injectSidebarWidget` |
| 构建期注册表 | `predev`/`prebuild` 生成的 `lib/theme/generated-templates.ts` |
| 运行时兜底 | 未进入注册表的模板由 esbuild 现场编译 |

---

## 2. 快速开始

### 2.1 环境要求

- Node.js 20 及以上（CLI `engines` 要求 `>=20`）。
- 一个正在运行的 RainyNest 主项目，默认地址 `http://localhost:3000`。
- 主项目 `.env` 中配置开发令牌：

```bash
EXT_DEV_TOKEN=replace-with-a-long-random-string
```

修改 `.env` 后需要重启主项目。生产环境不要保留弱令牌；`dev-install` 接口同时接受带有 `plugin:install` 权限的后台 session，因此令牌等同管理员能力。

### 2.2 安装脚手架与生成工程

在 `RainyNest_Dev` 仓库内可直接运行本地脚手架：

```bash
node tools/create-rainynest-ext/index.js my-plugin
```

如果包已发布到 npm，也可以使用：

```bash
npm create rainynest-ext my-plugin
npm create rainynest-ext my-theme --theme
```

CLI 也提供等价命令：

```bash
node tools/ext-cli/bin/ext.js new plugin my-plugin
```

名称只允许小写字母、数字和连字符，且必须以字母或数字开头，例如 `reading-stats`。名称会作为 `slug` 写入清单，并决定安装目录名。

生成后的源码工程：

```text
my-plugin/
├── plugin.json
├── config.json
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts
    └── admin.tsx
```

`package.json` 默认脚本：

```json
{
  "scripts": {
    "dev": "ext dev . --site http://localhost:3000",
    "build": "ext build . -o dist",
    "pack": "ext build . -o dist && ext pack dist"
  }
}
```

依赖至少包含：

```json
{
  "devDependencies": {
    "@rainynest/ext": "^0.1.0",
    "@rainynest/plugin-types": "^0.3.2",
    "@types/react": "^19.1.0",
    "typescript": "^5.8.0"
  }
}
```

### 2.3 第一个插件

`plugin.json`：

```json
{
  "slug": "hello-rainynest",
  "name": "Hello RainyNest",
  "version": "0.1.0",
  "description": "演示插件",
  "author": "你的名字",
  "specVersion": "1.0",
  "requiresCore": ">=1.0.0",
  "entry": "index.ts",
  "permissions": [],
  "roleTemplates": [],
  "database": { "enabled": false },
  "configSchema": {
    "basic": {
      "label": "基础",
      "fields": {
        "message": { "type": "text", "label": "页脚文字", "default": "Hello" },
        "enabled": { "type": "switch", "label": "启用", "default": true }
      }
    }
  }
}
```

`config.json`：

```json
{
  "message": "Hello RainyNest",
  "enabled": true
}
```

`src/index.ts`：

```ts
import type { PluginContext, ExtensionHandlers } from '@rainynest/plugin-types';

export default function createPlugin(ctx: PluginContext): ExtensionHandlers {
  ctx.logger.info('hello-rainynest 已加载', ctx.version);

  return {
    onMount(mountCtx) {
      mountCtx.logger.info('onMount', { slug: mountCtx.slug });
    },

    injectFooter() {
      if (!ctx.config.enabled) return [];
      const text = String(ctx.config.message ?? 'Hello');
      return [`<div class="text-center text-xs text-gray-500">${text}</div>`];
    },

    customApi: [
      {
        method: 'GET',
        path: '/status',
        auth: false,
        async handler() {
          return Response.json({ ok: true, version: ctx.version });
        },
      },
    ],
  };
}
```

### 2.4 `ext dev` 联调

```bash
npm install
npm run dev
```

等价于：

```bash
ext dev . --site http://localhost:3000
```

执行流程：

1. 校验 `plugin.json`。
2. 用 esbuild 构建到 `.ext-dev/`。
3. 打包为 `slug.zip.rainy-plugin`。
4. 以 `multipart/form-data` POST 到 `http://localhost:3000/api/console/extensions/dev-install`，字段名 `file`。
5. 请求头携带 `x-ext-token: <EXT_DEV_TOKEN>`。
6. 宿主以 `dev: true` 调用安装器：跳过版本校验与数据库 upsert，仅落盘并热重载。
7. CLI 递归监听源码目录，变更后 500ms 去抖再次上传。

令牌来源优先级：

1. `--token <value>`。
2. 环境变量 `EXT_DEV_TOKEN`。
3. 当前工作目录及其上一级目录的 `.env` 文件。

站点地址来源：

1. `--site <url>`。
2. 环境变量 `EXT_SITE`。
3. 默认 `http://localhost:3000`。

注意事项：

- dev 安装不写 `Plugin` 表。若该 slug 之前上传安装过且 `isActive=false`，引擎仍会跳过它；先在后台启用，或删除数据库记录。
- dev 安装会覆盖 `scripts/plugins/<slug>/`，但不会自动执行版本升级校验。
- dev 安装会调用 `reloadPlugin`，清除该插件目录的 `require` 缓存并重置扩展注册表。
- 模板的 `@/` 别名与 `'use client'` 仍受构建期注册表限制，见第 10 章。

### 2.5 `ext build`

```bash
ext build . -o dist
```

构建规则：

| 项 | 规则 |
| --- | --- |
| 入口 | 优先 `index.ts`，其次 `index.js`；支持根目录或 `src/` |
| 后台页 | `admin.tsx` → `admin.js` |
| 主题映射 | `theme.ts` → `theme.js`（插件一般不需要） |
| 输出格式 | CommonJS，`platform: node`，`target: node20` |
| JSX | `automatic` |
| 依赖 | 默认 `bundle: true`，非 externals 依赖全部打进产物 |
| externals | `react`、`react/jsx-runtime`、`react/jsx-dev-runtime`、`react-dom`、`next`、`next/*`、`@prisma/client`、`@rainynest/plugin-types`、`better-sqlite3` |
| 静态复制 | `plugin.json`、`config.json`、`theme.json`、`theme.css`、`preview.png/jpg`、`README.md`、`LICENSE`、`assets/`、`migrations/`、`templates/` |
| 压缩 | 设置环境变量 `EXT_MINIFY=1` 开启 minify |
| 产物扫描 | 出现 `.node` 文件即失败 |

`ext build-all --src packages --out scripts` 用于批量构建内置包，目录约定为 `packages/plugins/<slug>` 与 `packages/themes/<slug>`。

### 2.6 `ext pack`

```bash
ext pack dist
# 或
ext pack dist --format zip -o release
```

默认格式：插件 `zip`，主题 `gz`。包名固定为：

```text
<slug>.zip.rainy-plugin
<slug>.gz.rainy-plugin
<slug>.zip.rainy-theme
<slug>.gz.rainy-theme
```

打包细节：

- 只收集白名单扩展名：`.js`、`.tsx`、`.json`、`.css`、`.png`、`.jpg`、`.jpeg`、`.svg`、`.webp`、`.sql`、`.md`、`.txt`、`.woff`、`.woff2`、`.ttf`。
- 跳过 `src/`、`node_modules/`、`dist/`。
- zip 内条目不带顶层目录，`plugin.json` 位于包根。
- gz 实际是 `tar.gz`，依赖系统 `tar`（Windows 10 及以上自带）。
- 手工打包时也必须保证 `plugin.json` 在包根，不能套一层目录。

### 2.7 后台上传安装与启用

入口：后台「系统 → 插件」。

接口：

```text
POST /api/console/plugins/install
Content-Type: multipart/form-data
字段：file
权限：plugin:install
```

安装器行为：

1. 文件名必须匹配 `*.zip.rainy-plugin` 或 `*.gz.rainy-plugin`，否则直接拒绝。
2. 解包到临时目录，校验路径不越界、文件类型在白名单、单文件不超过 20MB。
3. 以内容识别类型：包根存在 `plugin.json` 即按插件处理（文件名后缀只作提示）。
4. 校验 `slug`、`name`、`version`、`specVersion`。`specVersion` 是清单格式版本，只接受 `"1.0"`（与 SPI 类型包版本无关）。
5. `requiresCore` 存在时校验当前核心版本（读取宿主 `package.json` 的 `version`），不满足直接返回 400 并说明要求版本与当前版本。
6. 目标是 `native: true` 的已装插件时拒绝覆盖（内置插件不允许被上传包替换）。
7. 升级时要求新版本大于数据库中的旧版本；磁盘有目录但数据库无记录时视为首装，不做版本比较。
8. 备份旧目录，写入新目录，执行迁移，upsert `Plugin` 记录（`source: 'uploaded'`，新装 `isActive: false`）。
9. 调用 `reloadPlugin` 并 `revalidatePath('/', 'layout')`。
10. 任一步失败会删除新目录、恢复备份、重新加载。

上传成功后插件默认处于停用状态：

```text
POST /api/console/plugins/<slug>/activate
权限：plugin:activate
```

启用时宿主读取磁盘上的 `plugin.json`，upsert 记录为 `isActive=true`，重置插件缓存并重新校验全站页面。

### 2.8 安装态目录

构建并安装后，宿主的实际目录：

```text
scripts/plugins/hello-rainynest/
├── plugin.json
├── config.json
├── index.js
├── admin.js
├── templates/
│   └── stats-card.tsx
├── migrations/
│   └── 001_init.sql
└── assets/
```

`entry` 中的 `.ts`/`.tsx` 会被替换为 `.js` 后查找。默认 `entry` 为 `index.ts`，因此实际加载 `index.js`。

---

## 3. `plugin.json` 全字段

### 3.1 完整示例

```json
{
  "slug": "reading-stats",
  "name": "阅读统计",
  "version": "1.2.0",
  "description": "统计文章阅读时长并在侧栏展示热门文章",
  "author": "RainyNest Team",
  "entry": "index.ts",
  "specVersion": "1.0",
  "requiresCore": ">=1.0.0",
  "native": false,
  "permissions": [
    { "name": "plugin:reading-stats:view", "displayName": "查看阅读统计", "group": "插件" }
  ],
  "roleTemplates": [
    {
      "name": "reading-stats-viewer",
      "displayName": "阅读统计查看者",
      "description": "可以查看阅读统计面板",
      "dependsOn": ["reader"],
      "permissions": ["plugin:reading-stats:view"]
    }
  ],
  "database": {
    "enabled": true,
    "migrations": [
      { "version": "001", "description": "初始化阅读时长表", "file": "migrations/001_init.sql" }
    ]
  },
  "configSchema": {
    "basic": {
      "label": "基础设置",
      "fields": {
        "enabled": { "type": "switch", "label": "启用", "default": true },
        "minWords": { "type": "number", "label": "最少字数", "default": 200, "min": 0, "max": 10000, "step": 10 },
        "position": {
          "type": "select",
          "label": "侧栏位置",
          "default": "top",
          "options": [
            { "value": "top", "label": "顶部" },
            { "value": "bottom", "label": "底部" }
          ]
        }
      }
    }
  }
}
```

### 3.2 字段表

| 字段 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `slug` | `string` | 是 | 无 | 插件唯一标识，必须匹配 `^[a-z0-9][a-z0-9-]*$`，且应等于安装目录名 |
| `name` | `string` | 是 | 无 | 展示名称，后台列表与菜单使用 |
| `version` | `string` | 是 | 无 | 版本号，升级时必须大于已装版本；比较按 `.`/`-` 拆段，数字段按数值比较 |
| `description` | `string` | 否 | 无 | 后台列表描述 |
| `author` | `string` | 否 | 无 | 作者 |
| `entry` | `string` | 否 | `index.ts` | 源码入口；运行时会替换 `.ts`/`.tsx` 为 `.js` |
| `permissions` | `{ name: string; displayName: string; group: string }[]` | 否 | `[]` | 声明插件权限点；启动时 upsert 到 `Permission` 表，并参与后台扩展点的权限过滤 |
| `roleTemplates` | `RoleTemplate[]` | 否 | `[]` | 启动时导入角色模板与关联权限 |
| `database` | `{ enabled?: boolean; migrations?: Migration[] }` | 否 | 无 | 插件独立 SQLite 迁移声明 |
| `configSchema` | `Record<string, ConfigSchemaGroup>` | 否 | `{}` | 后台设置表单的结构描述 |
| `specVersion` | `string` | 否 | 无 | 清单（manifest）格式版本；安装器只接受 `"1.0"`，与 SPI / 类型包版本无关 |
| `requiresCore` | `string` | 否 | 无 | 要求宿主核心版本；安装与加载时都会校验，语法见 4.7 |
| `native` | `boolean` | 否 | `false` | 内置插件标记；禁止后台上传包覆盖，也禁止卸载 |
| 其他字段 | 任意 | 否 | 无 | 会被保留在列表响应中，但不参与宿主行为 |

`RoleTemplate` 结构：

```ts
interface RoleTemplate {
  name: string;
  displayName: string;
  description?: string;
  dependsOn?: string[];
  permissions: string[];
}
```

`Migration` 结构：

```ts
interface Migration {
  version: string;
  description?: string;
  file: string;
}
```

### 3.3 字段详解

#### `slug`

- 只允许小写字母、数字、连字符。
- 安装器以 `slug` 作为目标目录名，因此清单 slug 与目录名天然一致。
- 引擎加载时使用目录名作为 `ctx.slug`，并不读取 `meta.slug` 作为 slug。
- 手工把插件目录命名成 `Foo` 会导致 `ctx.slug` 与清单不一致，JSON 存储、SQLite 文件名、菜单地址都会使用目录名。
- 所有模板解析函数对 slug 使用 `^[a-z0-9][a-z0-9-]*$` 校验，包含大写字母会导致解析失败。

#### `version`

- 字符串，不强制 semver。
- 安装器使用 `compareSemver`：解析主/次/补丁三段数字，缺段按 `0`，忽略 `-beta` 等预发布后缀与 `+build`。
- 只有数据库存在同 slug 记录且磁盘已存在时才做“必须更大”校验；磁盘有目录但数据库无记录视为首装，不比较版本。
- `ctx.version` 来自清单版本，不会自动同步到数据库以外的位置。

#### `entry`

- 默认 `index.ts`。
- 查找前执行 `entry.replace(/\.tsx?$/, '.js')`，因此 `index.ts`、`index.tsx` 都指向 `index.js`。
- 如果 `entry` 写成 `index.js`，则原样使用。
- 文件不存在时跳过该插件，日志为“入口产物不存在”。

#### `permissions`

该字段用于声明插件希望拥有的权限，例如：

```json
{
  "permissions": [
    { "name": "plugin:rss-feed:view", "displayName": "查看 RSS 订阅", "group": "插件" }
  ]
}
```

当前宿主的实际行为（已生效）：

- `bootPlugins` 加载完成后调用 `importPluginPermissions`，把每个权限点 upsert 到 `Permission` 表（`name` 唯一，`displayName`、`group` 取声明值）。
- 后台 Console 扩展点通过 `filterDefsByPermissions(defs, session.user.permissions)` 过滤：用户权限含 `*` 时全部通过；定义未声明 `permissions`（或空数组）视为公开；否则要求定义声明的权限与用户权限有交集。
- 这些过滤是“展示层”过滤，不是沙箱：插件代码与核心同进程执行，敏感操作仍应在 `customApi` 或组件内部自行校验。
- 公开前台注入（如 `injectHeaderAction`、`injectCommentField`）目前不强制按权限过滤，见 4.9。

#### `requiresCore`

声明插件要求的最低/范围核心版本，语法见 4.7：

```json
{ "requiresCore": ">=1.2.0 <2.0.0" }
```

- 安装时校验，不满足返回 400，并在错误中给出要求版本与当前核心版本。
- 启动加载时再次校验，不满足跳过该插件并 `console.warn` 插件名、要求版本、当前版本。
- 插件列表接口对不满足的插件返回 `loadError`。
- 核心版本读取宿主主项目 `package.json` 的 `version`，进程内缓存。

#### `native`

标记内置插件：

```json
{ "native": true }
```

- 后台上传安装包时，若目标 slug 已装插件为 `native: true`，安装器拒绝覆盖。
- 后台卸载该插件时返回 403「内置插件不可卸载」，只能停用。
- 未标记 `native` 的内置插件仍由数据库 `source=builtin` 兜底禁止卸载（返回 400）。

#### `roleTemplates`

启动完成后、`onMount` 之前执行导入，逻辑在 `lib/plugin/role-templates.ts` 的 `importRoleTemplates`：

1. 对模板中的每个权限名执行 `db.permission.upsert`。
   - `name` 为权限名。
   - `displayName` 直接使用权限名，不使用模板的展示名。
   - `group` 使用插件 `name`，为空时用 slug。
2. 对模板执行 `db.roleTemplate.upsert`。
   - 唯一键是 `name`，跨插件同名的角色模板会互相覆盖。
   - `pluginSlug` 写入当前插件 slug。
   - `dependsOn` 被 `JSON.stringify` 后存入字符串字段。
3. 删除该模板旧的权限关联，再按本次权限列表重建。

每个插件的导入失败只记录日志，不影响插件加载与其他插件。

#### `database`

```ts
interface PluginDatabaseMeta {
  enabled?: boolean;
  migrations?: { version: string; description?: string; file: string }[];
}
```

- `enabled` 只控制是否执行迁移，不控制 `ctx.pluginDb` 是否可用。插件始终可以通过 `ctx.pluginDb` 打开自己的 SQLite。
- `migrations` 只在安装/升级/开发安装时执行，不在每次启动时执行。
- `file` 是相对插件目录的路径，例如 `migrations/001_init.sql`。
- 迁移表固定为 `_rn_migrations`，字段为 `version TEXT PRIMARY KEY`、`description TEXT`、`applied_at DATETIME`、`checksum TEXT`。
- `checksum` 始终写入 `null`，不校验文件是否被修改。
- 已存在的 `version` 会跳过。
- SQL 文件不存在时打印警告并跳过，不会标记该版本。
- SQL 通过 `db.exec(sql)` 执行，可以包含多条语句。
- 执行失败会抛出，安装器回滚安装目录，但已经执行的 SQL 不会自动回滚。

#### `configSchema`

类型形状：

```ts
type ConfigSchema = Record<string, {
  label?: string;
  fields?: Record<string, ConfigField>;
}>;
```

`ConfigField`：

```ts
interface ConfigField {
  type: string;
  label?: string;
  default?: unknown;
  placeholder?: string;
  help?: string;
  options?: (string | { value: string; label: string })[];
  min?: number;
  max?: number;
  step?: number;
  rows?: number;
}
```

### 3.4 `configSchema` 支持的类型与后台渲染

后台表单组件：`components/admin/ConfigForm.tsx`。分组按对象键顺序渲染；组标题优先 `group.label`，否则用组键；字段标题优先 `field.label`，否则用字段键。

| `type` | 值类型 | 后台控件 | 说明 |
| --- | --- | --- | --- |
| `switch` | `boolean` | 开关 | `boolean` 为同义类型 |
| `boolean` | `boolean` | 开关 | 与 `switch` 完全一致 |
| `number` | `number \| ''` | 数字输入 | 清空时保存为空字符串；支持 `min`、`max`、`step` |
| `range` | `number` | 滑块 | 默认 `min=0`、`max=100`、`step=1`；右上角显示当前值 |
| `slider` | `number` | 滑块 | 与 `range` 一致 |
| `select` | `string` | 下拉选择 | `options` 支持字符串或 `{value,label}` |
| `radio` | `string` | 胶囊单选组 | 点击切换 |
| `checkboxes` | `string[]` | 胶囊多选组 | 字符串历史值会按逗号拆分 |
| `multiselect` | `string[]` | 胶囊多选组 | 与 `checkboxes` 一致 |
| `textarea` | `string` | 多行文本框 | `rows` 默认 4 |
| `color` | `string` | 颜色选择器 + 文本框 | 选择器缺省显示 `#3b82f6`，文本框缺省为空 |
| `date` | `string` | 日期输入 | 原样字符串 |
| `time` | `string` | 时间输入 | 原样字符串 |
| `datetime-local` | `string` | 本地日期时间输入 | 原样字符串 |
| `url` | `string` | URL 输入 | |
| `email` | `string` | 邮箱输入 | |
| `password` | `string` | 密码输入 | |
| `text` | `string` | 单行文本 | 未知类型也回退为单行文本 |

默认值规则由 `buildDefaultConfig` 实现：

1. 以当前配置为基底。
2. 遍历 schema 中每个字段。
3. 当前值为 `undefined` 或 `null` 时使用 `field.default`。
4. 没有 `default` 时：
   - `switch`/`boolean` → `false`
   - `checkboxes` → `[]`
   - `number`/`range` → `field.min ?? 0`
   - 其他 → `''`
5. 对历史值做类型纠正：
   - `switch`/`boolean`：字符串 `"true"`、`"1"`、`"on"` 转为 `true`，其余转布尔值。
   - `number`/`range`：可转数字的字符串转数字。
   - `checkboxes`：字符串按逗号拆分。

保存时，后台把整个 `config` 对象 PUT 到：

```text
PUT /api/console/plugins/<slug>/config
权限：plugin:config
请求体：{ "config": { ... } }
```

宿主执行 `replace`，即整体覆盖 `<slug>.config.json`，不是浅合并。随后 `resetPluginCache()` 与 `revalidateSitePages()`。

### 3.5 `config.json` 与运行时配置

- 包内可带 `config.json` 作为默认配置。
- 首次启动时，如果 `db/plugins-json/<slug>.config.json` 不存在，宿主复制包内 `config.json`；不存在则写 `{}`。
- 已存在的配置永远不会被覆盖，升级保留用户配置。
- `ctx.config` 是启动时读取的快照，只读；宿主没有向插件暴露配置写入接口。
- 修改配置后，下次 `bootPlugins` 会重新读取；`PUT config` 已调用 `resetPluginCache()`，通常下一次扩展点执行即可看到新值。

### 3.6 清单校验规则

CLI 校验（`tools/ext-cli/lib/validate.js`）：

| 规则 | 行为 |
| --- | --- |
| 必填 | `slug`、`name`、`version` |
| slug | `^[a-z0-9][a-z0-9-]*$` |
| `specVersion` | 缺省补 `1.0` 并警告；只支持 `1.0` |
| 入口 | `entry` 或 `entry` 的 `.js` 版本必须存在于根目录或 `src/` |
| 产物 | 不允许 `.node` 文件 |

安装器校验（`lib/ext-installer.ts`）：

| 规则 | 行为 |
| --- | --- |
| 文件名 | 必须为 `*.zip.rainy-plugin` / `*.gz.rainy-plugin` / 主题对应后缀 |
| 包大小 | 不超过 20MB |
| 路径 | 解压路径不得越界 |
| 文件类型 | 与 CLI 白名单一致 |
| 根清单 | 包根必须存在 `plugin.json` 或 `theme.json` |
| 必填 | `slug`、`name`、`version` |
| slug | `^[a-z0-9][a-z0-9-]*$` |
| `specVersion` | 如果存在，必须严格等于 `"1.0"`，否则报错 |
| `requiresCore` | 存在时校验当前核心版本，不满足拒绝安装 |
| `native` | 目标已装插件为 `native: true` 时拒绝上传覆盖 |

`specVersion` 是清单（manifest）格式版本，不是插件 SPI 或 `@rainynest/plugin-types` 的版本。脚手架、CLI 与示例统一写 `"1.0"`；当前 SPI 类型包版本 `0.3.2` 与它无关。

`requiresCore` 与 `native` 均已参与安装与加载流程，详见 4.7 与 4.6。

---

## 4. 运行模型

### 4.1 进程与目录

- 插件运行在宿主 Node 进程内，没有子进程、Worker 或隔离上下文。
- 安装目录固定为 `<cwd>/scripts/plugins`。
- 独立 SQLite 固定为 `<cwd>/db/plugins-db/<slug>.db`。
- JSON 存储固定为 `<cwd>/db/plugins-json/<slug>.run.json` 与 `<slug>.config.json`。
- 上传文件默认落 `<cwd>/public/uploads/yyyyMM/`。

服务端代码必须依赖 `process.cwd()` 为项目根目录。Next.js 的 `next start` 与 `next dev` 都满足该前提。

### 4.2 扫描与加载顺序

`bootPlugins` 逻辑：

1. 如果已有并发启动 Promise `__rnPluginBooting`，直接复用。
2. 读取 `scripts/plugins` 下的目录。
3. 跳过名称匹配 `\.bak-\d+$` 或 `\.deleted-\d+$` 的残留目录。
4. 只处理目录，不处理文件。
5. 没有 `plugin.json` 的目录跳过。
6. 解析 `plugin.json`，失败记录日志并跳过。
7. 查询 `db.plugin.findUnique({ where: { slug: dir } })`：
   - 查询失败（数据库未就绪）按无记录处理。
   - 有记录且 `isActive=false` 时跳过。
   - **无记录时仍然加载**，因此手工复制目录即视为启用。
8. 校验 `requiresCore`：不满足时跳过该插件，日志打印插件名、要求版本与当前核心版本。
9. 计算入口文件，必须存在。
10. `require` 入口模块。
11. 确保配置文件存在并读取 `ctx.config`。
12. 构造 `PluginContext`。
13. 如果默认导出是函数，调用它得到 `ExtensionHandlers`；否则得到空对象。
14. 收集到插件列表。
15. 写入全局 `__rnPlugins`。
16. 导入所有 `permissions`（upsert 到权限表）。
17. 导入所有 `roleTemplates`。
18. 依次执行每个插件的 `onMount`。

目录顺序来自 `fs.readdirSync`，宿主没有额外排序。不同文件系统可能给出不同顺序，因此：

- 数组型扩展点的执行顺序不保证稳定。
- provider 型扩展点“第一个提供者”也不保证稳定。
- 不要依赖多个同类型插件之间的先后关系。

### 4.3 上下文构建

每个插件在加载时构造一次 `PluginContext`，`onMount` 时又构造一个新的同形对象：

```ts
export interface PluginContext {
  db: HostPrismaClient;
  analytics: HostPrismaClient;
  pluginDb: PluginDatabase;
  pluginJson: PluginJsonStore;
  slug: string;
  version: string;
  config: Record<string, any>;
  site: HostSiteSetting;
  env: Record<string, string | undefined>;
  logger: PluginLogger;
  emitEvent: (name: string, data: unknown) => void;
}
```

| 字段 | 实际内容 |
| --- | --- |
| `db` | 宿主 Prisma 客户端，主库 |
| `analytics` | 访问统计库 Prisma 客户端 |
| `pluginDb` | 懒加载代理，首次属性访问时才打开 `<slug>.db` |
| `pluginJson` | `<slug>.run.json` 存储，不是配置文件 |
| `slug` | 安装目录名 |
| `version` | `plugin.json.version` |
| `config` | `<slug>.config.json` 的启动快照 |
| `site` | 完整站点设置对象；类型只声明了 `id/title/description/keywords` 与索引签名，实际字段以 `SiteSetting` 为准，如 `url`、`email`、`smtpHost` |
| `env` | `process.env` 引用 |
| `logger` | 前缀 `[Plugin:<slug>]` 的 `console` 封装 |
| `emitEvent` | 向进程内 `Map` 广播；当前没有注册监听器的公开 API |

`pluginDb` 使用 `Proxy`，只有访问属性时才调用 `getPluginDb(slug)`。因此不使用数据库的插件不会生成空 `.db` 文件。

### 4.4 失败隔离

| 位置 | 失败行为 |
| --- | --- |
| `plugin.json` 解析 | 记录日志，跳过该插件 |
| 数据库记录查询 | 忽略错误，按无记录继续 |
| 入口不存在 | 记录日志，跳过该插件 |
| `require` 入口 | 捕获异常，记录日志，跳过该插件 |
| 默认导出不是函数 | 不报错，按空扩展集合加载 |
| 工厂函数抛错 | 捕获，记录日志，跳过该插件 |
| `onMount` 抛错 | 捕获，记录日志，继续其他插件 |
| `roleTemplates` 导入 | 每个插件独立 try/catch，记录日志 |
| 单个扩展点函数抛错 | `fireExtensionPoint` 捕获，记录日志，继续下一个插件 |
| 数组型扩展点元素非法 | 收集器通常忽略或断言失败，页面侧一般回退空数组 |
| 组件渲染失败 | 渲染辅助函数捕获，记录日志，返回空字符串或跳过该块 |
| 安装过程失败 | 删除新目录、恢复备份、重新加载 |
| JSON 文件损坏 | `get()` 返回 `{}`；`set()` 按空对象合并后覆盖 |
| 邮件 notifier 失败 | 回退 SMTP |

“失败隔离”只保证异常不向外扩散，不保证副作用被撤销。插件写了一半的数据、发出的请求、执行的 SQL 都不会自动回滚。

### 4.5 缓存、热重载与重启

全局状态：

```ts
const g = globalThis as unknown as {
  __rnPlugins?: LoadedPlugin[] | null;
  __rnPluginBooting?: Promise<void> | null;
};
```

三种操作：

| 函数 | 行为 | 调用方 |
| --- | --- | --- |
| `resetPluginCache()` | 只把 `__rnPlugins` 置为 `null`，不清 `require` 缓存 | 启用、停用、配置保存、卸载 |
| `reloadPlugin(slug)` | 删除该插件目录及其子路径的 `require.cache`，再 `resetPluginCache()` | 上传安装、dev 安装、安装回滚 |
| `bootPlugins()` | 重新扫描并加载 | 首次请求、扩展点执行、页面渲染 |

关键事实：

- `resetPluginCache` 不会重新读取磁盘上的 `index.js`。手工编辑安装态代码后，重新启用仍会拿到旧模块，需重启进程或走 dev 安装（其会清除缓存）。
- 新装模板要获得 `@/` 别名与 `'use client'`，必须重启 dev/build，使注册表重新生成；否则只走运行时 esbuild，仅服务端 JSX。
- 已安装并重启后，模板注册表内的模板按正常 Next 模块参与编译。
- 配置保存后会重置注册表，下一次加载会重新读取配置文件。
- 模板运行时编译按文件 `mtime` 缓存，文件修改后自动重编译。

`bootPlugins` 没有“已完成则直接返回”的短路：

- 并发调用由 `__rnPluginBooting` 去重。
- 完成后 `__rnPluginBooting` 置空。
- 再次直接调用会重新扫描、重新执行工厂函数并重新执行 `onMount`。
- `fireExtensionPoint`、`getPluginSearchProvider` 等会先判断 `__rnPlugins`，通常不会重复加载。
- `lib/plugin/ui.ts` 中的多个收集器入口直接调用 `bootPlugins()`，因此这些路径可能触发重复加载。
- `app/api/plugin/[...path]/route.ts` 每次分发也直接调用 `bootPlugins()`。

因此 `onMount` 必须幂等：建表用 `IF NOT EXISTS`，种子数据用 `INSERT OR IGNORE` 或先查询，避免重复插入。

### 4.6 启用、停用与卸载

| 操作 | 接口 | 行为 |
| --- | --- | --- |
| 启用 | `POST /api/console/plugins/<slug>/activate` | 校验磁盘 `plugin.json`；upsert `isActive=true`；重置缓存；校验页面 |
| 停用 | `POST /api/console/plugins/<slug>/deactivate` | 要求数据库已有记录；更新 `isActive=false`；重置缓存 |
| 卸载 | `DELETE /api/console/plugins/<slug>?keepData=1` | 内置插件禁止；删除目录；删除数据库记录；按需删除数据 |

卸载细节：

- `source=builtin` 的插件只允许停用，不允许卸载。
- 磁盘 `plugin.json` 标记 `native: true` 的插件卸载时直接返回 403「内置插件不可卸载」，早于 `source` 校验。
- `keepData=1` 保留：
  - `db/plugins-db/<slug>.db`、`-wal`、`-shm`
  - `db/plugins-json/<slug>.run.json`
  - `db/plugins-json/<slug>.config.json`
- 不保留时先关闭数据库连接，再删除上述文件。
- 删除目录使用 `rmDirSafe`，Windows 文件句柄占用时先改名为 `.deleted-<timestamp>` 再删；仍失败则留待启动清扫。
- 卸载失败返回 500，不保证目录已完全删除。

### 4.7 版本与 `requiresCore` 校验

| 校验 | 是否实现 | 位置 |
| --- | --- | --- |
| 上传包版本必须大于已装版本 | 是，仅在数据库已有记录时 | `installFromBuffer` |
| `specVersion` 支持范围 | 是，安装器只接受 `1.0` | `installFromBuffer` |
| `requiresCore` 最低核心版本 | 是，安装与加载都校验 | `installFromBuffer`、`bootPlugins` |
| 运行时 SPI 版本兼容 | 否 | 无读取点 |
| 插件依赖其他插件版本 | 否 | 无此字段 |

核心版本来源：宿主主项目 `package.json` 的 `version`，由 `lib/plugin/semver.ts` 的 `getCoreVersion()` 读取并进程内缓存。

支持的 `requiresCore` 语法：

| 写法 | 含义 |
| --- | --- |
| `1.2.3` 或 `=1.2.3` | 精确匹配 |
| `>=1.0.0`、`>1.0.0`、`<=1.2.0`、`<1.2.0` | 比较 |
| `^1.2.3` | 主版本非 0 锁主版本；`0.x` 锁次版本；`0.0.x` 锁补丁号 |
| `~1.2.3` | 锁主次版本，补丁可升 |
| `>=1.0.0 <2.0.0` | 空格表示 AND |
| `^1.0.0 \|\| ^2.0.0` | `\|\|` 表示 OR |
| 省略、空串或 `*` | 不限制 |

不满足时的表现：

- 上传安装：接口返回 400，错误信息包含要求版本与当前核心版本。
- 启动加载：跳过该插件，`console.warn` 打印插件名、要求版本、当前版本。
- 插件列表：该项带 `loadError` 字段说明原因。

版本比较示例：

```text
1.2.0 > 1.1.9
2.0.0 > 1.9.9
1.10.0 > 1.9.0
```

说明：当前实现只比较主/次/补丁三段，忽略 `-beta` 等预发布后缀，因此 `1.2.0` 与 `1.2.0-beta.1` 视为相等。

### 4.8 权限模型

当前存在四层容易混淆的“权限”：

| 层 | 字段/名称 | 是否生效 | 说明 |
| --- | --- | --- | --- |
| 宿主后台权限 | `plugin:install`、`plugin:activate`、`plugin:deactivate`、`plugin:config`、`plugin:uninstall` | 是 | 由 `requirePermission` 校验 |
| 插件清单权限 | `plugin.json.permissions` | 是 | 启动时 upsert 到 `Permission` 表，并参与后台扩展点过滤 |
| 角色模板权限 | `roleTemplates[].permissions` | 是 | 会 upsert 到权限表并绑定角色模板，供角色系统使用 |
| 扩展点权限 | `permissions?: string[]` | 部分是 | 后台 Console 扩展点按当前登录用户权限过滤；公开前台注入不强制过滤 |

因此：

- 后台扩展点定义里的 `permissions` 现在会生效：用户权限含 `*` 全通过；定义未声明权限视为公开；否则要求有交集。
- 公开前台注入（`injectHeaderAction`、`injectCommentField` 等）目前不按权限隐藏，仍应自行判断。
- `customApi` 的 `auth: true` 只检查“已登录”，不检查具体权限。
- 后台 `customAdminRoutes` 页面只受 `/console` 布局的登录校验保护，没有路由级权限。

### 4.9 后台扩展的权限过滤

后台 Console 扩展点统一通过 `filterDefsByPermissions(defs, session.user.permissions)` 过滤：

- `collectTabs`、`collectListOperations`、`collectListFields`、`collectDashboardWidgets`、`collectQuickActions`、`collectEditorActions`、`collectCommentSubjectRefs` 都接收权限参数并过滤。
- `collectHeaderActions`、`collectCommentFields` 也支持传入权限数组，但当前唯一调用方是公开前台，未传权限，因此不过滤。
- 调用方（如 `/api/console/plugins`、`/api/console/plugin-widgets`、`/api/posts`、`/api/comments`、`/api/plugin/editor-actions`）从 session 读取 `permissions` 传入。
- 规则：`*` 全部通过；定义无 `permissions`（或空数组）视为公开；否则要求声明的权限名与用户权限有交集。
- 这是展示层过滤，不构成代码沙箱；插件仍应在 `customApi`、目标页面或组件内部做真正的鉴权。

---

## 5. 生命周期钩子

本章只列 `ExtensionHandlers` 中真实存在的生命周期函数。其余扩展点见第 6 章。

### 5.1 生命周期总表

| 钩子 | 触发时机 | 参数 | 返回值 | 失败影响 |
| --- | --- | --- | --- | --- |
| `onMount` | 每次 `bootPlugins` 加载完成后 | `PluginContext` | `void \| Promise<void>` | 记录日志，继续其他插件 |
| `beforeSavePost` | 新建文章、更新文章写库前 | `post` 数据对象、`meta` | `void \| Promise<void>` | 记录日志，保存继续 |
| `afterSavePost` | 文章创建/更新成功后 | `post` 记录 | `void \| Promise<void>` | 记录日志，响应不受影响 |
| `beforeDeletePost` | 删除文章前 | `postId: string` | `void \| Promise<void>` | 记录日志，删除继续 |
| `beforeCommentApprove` | 创建评论写库前 | 评论草稿对象 | 状态字符串或 `void` | 记录日志，使用站点默认状态 |

### 5.2 `onMount`

类型：

```ts
onMount?: (ctx: PluginContext) => void | Promise<void>;
```

调用位置：`lib/plugin/engine.ts` 的 `bootPlugins`，在所有插件工厂函数执行完、`roleTemplates` 导入完之后。

参数：

| 字段 | 说明 |
| --- | --- |
| `ctx` | 新构造的上下文，`config` 与加载时相同，`pluginDb` 为懒加载代理 |

返回值：无。

适用场景：

- 确保插件表存在（必须幂等）。
- 写入一次性种子数据。
- 注册进程内缓存。
- 打印版本与配置。

不要在 `onMount` 中执行长时间阻塞操作：它在启动路径与部分请求路径上同步等待。

示例：

```ts
onMount(ctx) {
  ctx.pluginDb.exec(`
    CREATE TABLE IF NOT EXISTS reading_stats (
      slug TEXT PRIMARY KEY,
      minutes INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  ctx.logger.info('reading-stats mounted', ctx.config.enabled);
}
```

### 5.3 `beforeSavePost`

类型：

```ts
beforeSavePost?: (
  post: Record<string, any>,
  meta: BeforeSavePostMeta
) => void | Promise<void>;

interface BeforeSavePostMeta {
  patch?: Record<string, any>;
}
```

调用位置：

- `app/api/posts/route.ts` 的 `POST`。
- `app/api/posts/[id]/route.ts` 的 `PUT`。

调用时机：输入校验完成、数据对象组装完成、写库之前。

参数：

| 参数 | 说明 |
| --- | --- |
| `post` | 即将写入 Prisma 的数据对象，含 `title`、`slug`、`content`、`html`、`summary`、`status`、`categoryId`、`words` 等 |
| `meta.patch` | 宿主提供的可变补丁对象，初始为 `{}` |

返回值：无。插件通过修改 `meta.patch` 影响最终写入。

宿主处理：

```ts
const meta = { patch: {} as Record<string, unknown> };
await fireExtensionPoint('beforeSavePost', data, meta);
for (const [k, v] of Object.entries(meta.patch || {})) {
  if (v !== undefined) data[k] = v;
}
```

注意事项：

- 所有实现都会执行，补丁按插件顺序依次覆盖，后执行者优先。
- `undefined` 值被忽略。
- 没有字段白名单；写入未知字段会导致 Prisma 报错，进而保存失败。
- 直接修改 `post` 对象也能生效，但语义不如 `meta.patch` 清晰。
- 插件异常被捕获，不影响保存。

示例：

```ts
beforeSavePost(post, meta) {
  if (typeof post.title === 'string') {
    meta.patch = {
      ...(meta.patch ?? {}),
      title: post.title.trim(),
    };
  }
}
```

### 5.4 `afterSavePost`

类型：

```ts
afterSavePost?: (post: Record<string, any>) => void | Promise<void>;
```

调用位置：

- `app/api/posts/route.ts` 创建成功后。
- `app/api/posts/[id]/route.ts` 更新成功后。

参数：Prisma 返回的文章记录，含 `tags` 与 `category` 关联。

返回值：无。

适用场景：

- 写入插件独立统计表。
- 发送 webhook。
- 清理缓存。
- 构建搜索索引。

注意：

- 在响应返回前被 `await`，耗时操作会拖慢保存请求。
- 异常被捕获，不会让保存失败。
- 更新接口在事务提交后调用，能读到最新数据。

示例：

```ts
async afterSavePost(post) {
  const words = Number(post.words ?? 0);
  const minutes = Math.max(1, Math.ceil(words / 300));
  ctx.pluginDb
    .prepare('INSERT INTO reading_stats (slug, minutes) VALUES (?, ?) ON CONFLICT(slug) DO UPDATE SET minutes=excluded.minutes, updated_at=CURRENT_TIMESTAMP')
    .run(String(post.slug), minutes);
}
```

### 5.5 `beforeDeletePost`

类型：

```ts
beforeDeletePost?: (postId: string) => void | Promise<void>;
```

调用位置：`app/api/posts/[id]/route.ts` 的 `DELETE`，删除数据库记录之前。

参数：文章 id。

返回值：无。

适用场景：清理插件侧关联数据、删除远程缓存。

注意：

- 无法阻止删除，除非抛错；即使抛错也只记录日志，删除继续。
- 此时文章仍存在，可查询 slug 等信息。

示例：

```ts
async beforeDeletePost(postId) {
  const post = await ctx.db.post.findUnique({ where: { id: postId }, select: { slug: true } });
  if (post) {
    ctx.pluginDb.prepare('DELETE FROM reading_stats WHERE slug = ?').run(post.slug);
  }
}
```

### 5.6 `beforeCommentApprove`

类型：

```ts
beforeCommentApprove?: (comment: {
  postId: string;
  userId: string;
  content: string;
  parentId?: string | null;
  ip?: string;
  userAgent?: string;
}) =>
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | void
  | Promise<'PENDING' | 'APPROVED' | 'REJECTED' | void>;
```

调用位置：`app/api/comments/route.ts` 的 `POST`，评论创建前。

初始状态：

```ts
let status = site.commentModeration ? 'PENDING' : 'APPROVED';
```

宿主取所有结果中的第一个有效状态：

```ts
const results = await fireExtensionPoint('beforeCommentApprove', {...});
const first = results[0];
if (first === 'APPROVED' || first === 'REJECTED' || first === 'PENDING') {
  status = first;
}
```

因此：

- 只认第一个返回值。
- 返回 `void` 时保留站点默认状态。
- 返回其他字符串无效。
- 插件异常不影响评论创建。
- 参数中没有 `post` 内容，只有 id；需要更多信息可自行查询。

示例：

```ts
beforeCommentApprove(comment) {
  if (comment.content.includes('spam-keyword')) return 'REJECTED';
  if (comment.parentId) return 'APPROVED';
  return;
}
```

### 5.7 生命周期与接口覆盖矩阵

| 动作 | `beforeSavePost` | `afterSavePost` | `beforeDeletePost` | `beforeCommentApprove` |
| --- | --- | --- | --- | --- |
| `POST /api/posts` | 是 | 是 | 否 | 否 |
| `PUT /api/posts/[id]` | 是 | 是 | 否 | 否 |
| `DELETE /api/posts/[id]` | 否 | 否 | 是 | 否 |
| `POST /api/comments` | 否 | 否 | 否 | 是 |
| 后台批量操作 | 取决于是否走上述接口 | 同左 | 同左 | 否 |

---

## 6. 扩展点手册

### 6.1 执行模型与通用约定

`ExtensionHandlers` 的 48 个键按宿主处理方式分为四类：

| 类别 | 宿主处理 | 顺序 | 典型扩展点 |
| --- | --- | --- | --- |
| 函数调用后取全部结果 | `fireExtensionPoint` 逐个 `await`，收集非 `undefined` 返回值 | 插件加载顺序 | `onRenderMarkdown`、`injectHead`、`injectFooter` |
| 函数调用后取第一个 | 逐插件调用，第一个非空结果生效 | 插件加载顺序 | `injectCommentWidget`、`commentEditorReplace`、`commentListItemContentReplace` |
| 函数调用后取第一个值 | 同 provider 语义 | 插件加载顺序 | `searchProvider`、`attachmentStorage`、`notifier` |
| 数组属性 | 直接遍历，不调用函数 | 插件加载顺序，元素顺序即数组顺序 | `dashboardWidget`、`customApi`、`customAdminRoutes` |
| 函数返回数组或直接数组 | `collectPluginDefinitions` 两种形态都接受：函数会先被调用，再展开返回值 | 插件加载顺序 | `injectHeaderAction`、`injectCommentField`、`editorCreate`、`commentSubjectRef` |
| 函数返回数组（组件型） | 收集器显式调用函数取得组件数组 | 插件加载顺序 | `injectSidebarWidget`、`injectPostContent`、`injectSinglePageContent` |

通用规则：

- 所有回调都应该是可重入的；可能被重复调用。
- 组件不使用参数调用：`Comp({})`，因此组件需要的数据应在渲染时自行读取。
- 组件渲染使用 `renderToStaticMarkup`，得到 HTML 字符串，不进行 hydration。
- 后台与前台注入组件的异常会被捕获并记录，通常表现为该块消失。
- 后台扩展点定义的 `permissions` 会按当前登录用户过滤；公开前台注入不强制过滤，见 4.9。

### 6.2 生命周期

#### 6.2.1 `onMount`

类型：

```ts
onMount?: (ctx: PluginContext) => void | Promise<void>;
```

宿主：`lib/plugin/engine.ts` 的 `bootPlugins`。

参数：新的 `PluginContext`。

返回：无。

时机：所有插件工厂执行完、角色模板导入完之后；每次重新加载都会执行。

失败：捕获并记录，继续其他插件。

示例：见 5.2。

#### 6.2.2 `beforeSavePost`

类型：

```ts
beforeSavePost?: (
  post: Record<string, any>,
  meta: BeforeSavePostMeta
) => void | Promise<void>;

interface BeforeSavePostMeta {
  patch?: Record<string, any>;
}
```

宿主：`app/api/posts/route.ts` 的 `POST`；`app/api/posts/[id]/route.ts` 的 `PUT`。

参数：即将写库的文章数据；`meta.patch` 为可写补丁。

返回：无；通过 `meta.patch` 影响写入。

失败：捕获并记录，保存继续。

示例：

```ts
beforeSavePost(post, meta) {
  meta.patch = { ...(meta.patch ?? {}), title: String(post.title ?? '').trim() };
}
```

#### 6.2.3 `beforeCommentApprove`

类型：

```ts
beforeCommentApprove?: (comment: {
  postId: string;
  userId: string;
  content: string;
  parentId?: string | null;
  ip?: string;
  userAgent?: string;
}) =>
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | void
  | Promise<'PENDING' | 'APPROVED' | 'REJECTED' | void>;
```

宿主：`app/api/comments/route.ts` 的 `POST`。

参数：评论草稿。

返回：新的审核状态；只取第一个插件的有效返回值。

失败：捕获并记录，使用站点默认状态。

示例：

```ts
beforeCommentApprove(comment) {
  if (/(广告|加微信)/.test(comment.content)) return 'REJECTED';
  return undefined;
}
```

#### 6.2.4 `afterSavePost`

类型：

```ts
afterSavePost?: (post: Record<string, any>) => void | Promise<void>;
```

宿主：文章创建与更新接口，写库成功后。

参数：含关联的 Prisma 文章记录。

返回：无。

失败：捕获并记录，不影响接口响应。

示例：见 5.4。

#### 6.2.5 `beforeDeletePost`

类型：

```ts
beforeDeletePost?: (postId: string) => void | Promise<void>;
```

宿主：`DELETE /api/posts/[id]`。

参数：文章 id。

返回：无。

失败：捕获并记录，删除继续。

示例：见 5.5。

### 6.3 内容渲染

#### 6.3.1 `onRenderMarkdown`

类型：

```ts
onRenderMarkdown?: (content: string) => string | Promise<string>;
```

宿主：`lib/markdown/processor.ts` 的 `renderMarkdown`，在默认 Markdown 管线之后调用。

参数：

| 参数 | 说明 |
| --- | --- |
| `content` | 已完成基础渲染的 HTML 字符串 |

返回：替换后的 HTML 字符串；返回 `undefined` 或非字符串时保留上一步结果。

执行顺序：所有插件都会执行，宿主按加载顺序依次赋值，最后一个返回字符串的插件结果生效。

失败：捕获并记录，继续下一个插件。

示例：

```ts
onRenderMarkdown(html) {
  return html.replaceAll('<table>', '<div class="table-wrap"><table>')
             .replaceAll('</table>', '</table></div>');
}
```

注意：

- 不要在每次调用时做重量级全量解析。
- 修改 HTML 时避免破坏代码块与行内代码。
- 该钩子对文章正文渲染生效，缓存命中时不会重新执行。

#### 6.3.2 `excerptGenerator`

类型：

```ts
excerptGenerator?: (content: string, length: number) => string | Promise<string>;
```

宿主：`app/api/posts/route.ts` 的 `POST`；`app/api/posts/[id]/route.ts` 的 `PUT`。

参数：

| 参数 | 说明 |
| --- | --- |
| `content` | 原始 Markdown 或纯文本内容 |
| `length` | 请求的摘要长度，通常为 200 |

返回：摘要字符串。

执行顺序：只取第一个返回非空字符串的插件；后续插件不覆盖。

失败：捕获并记录，回退宿主默认截断。

示例：

```ts
excerptGenerator(content, length) {
  const text = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, length);
}
```

#### 6.3.3 `onGenerateMetadata`

类型：

```ts
onGenerateMetadata?: (input: MetadataPatchInput) => Record<string, unknown> | Promise<Record<string, unknown>>;

interface MetadataPatchInput {
  metadata: Record<string, any>;
  post: Record<string, any> | null;
}
```

宿主：`app/(site)/blog/[slug]/page.tsx` 的 `generateMetadata`。

参数：

| 参数 | 说明 |
| --- | --- |
| `metadata` | 已构造的 Next Metadata，如 `title`、`description`、`openGraph`、`twitter` |
| `post` | 当前文章记录；列表页或非文章页可能为 `null` |

返回：要合并到 Metadata 的补丁对象。

执行顺序：只取第一个有效结果，后续插件不覆盖。

失败：捕获并记录，使用原始 Metadata。

示例：

```ts
onGenerateMetadata({ metadata, post }) {
  if (!post) return {};
  return {
    openGraph: {
      ...(metadata.openGraph ?? {}),
      type: 'article',
      publishedTime: post.publishedAt ?? undefined,
      modifiedTime: post.updatedAt ?? undefined,
    },
  };
}
```

注意：

- 返回对象会与现有 Metadata 做浅合并，嵌套字段需自行展开。
- 不要在内部发起慢请求，元数据生成在页面渲染路径上。

#### 6.3.4 `injectHead`

类型：

```ts
injectHead?: () => (string | ReactNode)[] | Promise<(string | ReactNode)[]>;
```

宿主：`components/layout/PluginHead.tsx`，在根布局 `<head>` 中渲染。

渲染规则：

- 字符串会按 HTML 解析，只保留以下标签：`style`、`script`、`meta`、`link`。
- 其他标签与文本会被丢弃。
- `ReactNode` 通过 `renderToStaticMarkup` 输出，但根节点限制同上。

执行顺序：所有插件结果拼接。

失败：单个插件异常被捕获；非法字符串可能产生警告。

示例：

```ts
injectHead() {
  return [
    `<meta name="theme-color" content="#2563eb" />`,
    `<style>.reading-progress{position:fixed;top:0;left:0;height:2px;background:#2563eb;z-index:99}</style>`,
  ];
}
```

安全提示：字符串直接进入 `<head>`，不要拼接用户输入；配置值需要转义。

#### 6.3.5 `injectFooter`

类型：

```ts
injectFooter?: () => (string | ReactNode)[] | Promise<(string | ReactNode)[]>;
```

宿主：`lib/plugin/ui.ts` 的 `collectInjectFooter`；调用方为 `app/(site)/layout.tsx`。

渲染规则：

- 字符串按 HTML 插入页脚容器。
- `ReactNode` 通过 `renderToStaticMarkup` 输出。
- 输出包在页脚区域内，不保证位于 `<footer>` 标签内部。

执行顺序：所有插件结果按加载顺序拼接。

失败：捕获并记录，返回已收集的部分。

示例：

```ts
injectFooter() {
  return [
    `<div class="py-6 text-center text-xs text-gray-500">Powered by RainyNest</div>`,
  ];
}
```

### 6.4 前台 UI

#### 6.4.1 `injectSidebarWidget`

类型：

```ts
injectSidebarWidget?: () => SidebarWidgetDef[];

interface SidebarWidgetDef {
  title?: string;
  component: ComponentType | (() => Promise<{ default: ComponentType }>);
  order?: number;
}
```

宿主：`lib/plugin/engine.ts` 的 `getPluginSidebarWidgets`；调用方为 `components/layout/Sidebar.tsx`。

参数：无。

返回：侧栏组件定义数组。

排序：按 `order` 升序；未提供按 0；相同 order 保持插件加载顺序。

渲染：

- 组件无 props 调用。
- 输出 HTML 插入侧栏。
- 支持 `() => import('./widget.js')` 形式，宿主会取 `default`。

失败：单个组件渲染失败记录日志并跳过。

示例：

```ts
injectSidebarWidget() {
  return [
    {
      title: '热门文章',
      order: 10,
      component: async () => {
        const list = await ctx.db.post.findMany({
          where: { status: 'PUBLISHED' },
          orderBy: { views: 'desc' },
          take: 5,
          select: { title: true, slug: true },
        });
        return {
          default: function HotPosts() {
            return React.createElement(
              'ul',
              { className: 'space-y-2 text-sm' },
              list.map((p) =>
                React.createElement(
                  'li',
                  { key: p.slug },
                  React.createElement('a', { href: `/blog/${p.slug}` }, p.title)
                )
              )
            );
          },
        };
      },
    },
  ];
}
```

宿主对 `data-widget-api` 有可选约定：侧栏组件渲染出的元素若带该属性，宿主脚本会请求指定 API 并把 `list` 填充为链接。插件仍应保证无脚本时内容可读。

#### 6.4.2 `injectHeaderAction`

类型：

```ts
injectHeaderAction?: () => HeaderActionDef[];

interface HeaderActionDef {
  key: string;
  label: string;
  icon?: string;
  href?: string;
  order?: number;
  permissions?: string[];
}
```

宿主：`lib/plugin/ui.ts` 的 `collectHeaderActions`；调用方为 `app/(site)/layout.tsx`，最终由 `components/layout/Header.tsx` 渲染。

返回：顶栏按钮定义数组。

渲染：按 `order` 升序，渲染为 `<Link href={action.href}>`；没有 `href` 时仍会渲染但不可点击。

执行顺序：数组元素顺序决定同 order 下的顺序。

失败：收集器异常返回空数组。

形态：函数返回数组或直接数组都可以。`collectPluginDefinitions` 在值为函数时会先调用，再展开返回值；声明式数组则直接遍历。推荐按类型声明写函数：

```ts
injectHeaderAction: () => [
  { key: 'rss', label: 'RSS', href: '/rss.xml', order: 10 },
]
```

直接数组写法（需要类型断言）：

```ts
const handlers = {
  injectHeaderAction: [
    { key: 'rss', label: 'RSS', href: '/rss.xml', order: 10 },
  ],
} as unknown as ExtensionHandlers;
```

权限：`HeaderActionDef.permissions` 目前不参与前台过滤（前台是公开注入），敏感按钮请在组件或目标页面自行校验。

#### 6.4.3 `injectPostContent`

类型：

```ts
injectPostContent?: () => ComponentType[];
```

宿主：`lib/plugin/ui.ts` 的 `collectPostContentHtml`；调用方为 `app/(site)/blog/[slug]/page.tsx`。

返回：组件数组；每个组件渲染为一段 HTML，追加到文章正文之后。

顺序：插件加载顺序，插件内数组顺序。

失败：单个组件失败记录日志并跳过。

示例：

```ts
injectPostContent() {
  return [
    function ThanksBlock() {
      return React.createElement(
        'div',
        { className: 'mt-8 rounded border border-gray-200 p-4 text-sm text-gray-600' },
        '感谢阅读，欢迎订阅本站。'
      );
    },
  ];
}
```

注意：组件拿不到当前文章对象，如需文章数据，应在组件闭包外通过 `customApi` 或全局缓存提供，或把内容做成可被客户端脚本替换的占位块。

#### 6.4.4 `injectSinglePageContent`

类型：

```ts
injectSinglePageContent?: () => ComponentType[];
```

宿主：`lib/plugin/ui.ts` 的 `collectSinglePageContentHtml`；调用方为 `app/(site)/pages/[slug]/page.tsx`。

返回：组件数组；渲染为 HTML 追加到独立页面正文之后。

顺序与失败行为同 `injectPostContent`。

示例：

```ts
injectSinglePageContent() {
  return [
    function ContactBlock() {
      return React.createElement(
        'p',
        { className: 'mt-6 text-sm text-gray-500' },
        '如需合作，请通过站内联系方式与我们联系。'
      );
    },
  ];
}
```

#### 6.4.5 `injectCommentWidget`

类型：

```ts
injectCommentWidget?: () => ComponentType | null;
```

宿主：`lib/plugin/ui.ts` 的 `getCommentWidgetHtml`；调用方为文章详情页。

返回：一个组件或 `null`。

执行顺序：第一个返回非空组件的插件生效，后续插件不再渲染。

失败：该插件渲染失败会继续尝试下一个插件。

用途：用第三方评论系统整体替换内置评论区。

示例：

```ts
injectCommentWidget() {
  return function ExternalComments() {
    return React.createElement('div', { id: 'external-comments', 'data-post': '' });
  };
}
```

宿主只在组件返回非空时使用；组件返回 `null` 等同于未提供。

#### 6.4.6 `injectCommentField`

类型：

```ts
injectCommentField?: () => CommentFieldDef[];

type CommentFieldType = 'text' | 'textarea' | 'email' | 'url' | 'number' | 'select';

interface CommentFieldDef {
  key: string;
  label: string;
  type?: CommentFieldType;
  required?: boolean;
  placeholder?: string;
  options?: { label: string; value: string }[];
  defaultValue?: string;
}
```

宿主：`lib/plugin/ui.ts` 的 `collectCommentFields`；调用方为文章详情页，最终传入 `components/comment/CommentForm.tsx`。

前端行为：

- 初始值使用 `defaultValue ?? ''`。
- `textarea` 渲染多行输入。
- `select` 使用 `options` 渲染下拉。
- `number`、`email`、`url` 使用对应 input 类型，其余为 `text`。
- `required` 为真时提交前检查非空。
- 所有字段值放入 `extra` 对象，随评论一起 POST。
- 后端 `createSchema` 中 `extra: z.record(z.string()).optional()`。
- 值以字符串保存，不做类型转换。

失败：收集异常返回空数组。

形态：函数返回数组或直接数组都可以，收集器会先调用函数再展开。推荐按类型声明写函数：

```ts
injectCommentField: () => [
  { key: 'website', label: '网站', type: 'url', required: false },
]
```

当前运行时可用写法：

```ts
const handlers = {
  injectCommentField: [
    { key: 'website', label: '网站', type: 'url', placeholder: 'https://' },
  ],
} as unknown as ExtensionHandlers;
```

### 6.5 数据与通知

#### 6.5.1 `onPageView`

类型：

```ts
onPageView?: (data: { path: string; ip: string; sessionId?: string }) => void | Promise<void>;
```

宿主：`app/api/analytics/pv/route.ts` 的 `POST`，在写入内置访问统计后触发。

参数：

| 参数 | 说明 |
| --- | --- |
| `path` | 访问路径 |
| `ip` | 客户端 IP；可能为空字符串 |
| `sessionId` | 访客会话标识，可能为 `undefined` |

返回：无。

执行顺序：所有插件都会执行。

失败：捕获并记录，不影响统计接口响应。

示例：

```ts
async onPageView({ path, sessionId }) {
  if (!sessionId) return;
  ctx.pluginDb
    .prepare('INSERT INTO page_views (path, session_id) VALUES (?, ?)')
    .run(path, sessionId);
}
```

注意：该接口可能被高频调用，避免同步重操作与逐条写放大。

#### 6.5.2 `searchProvider`

类型：

```ts
searchProvider?: SearchProvider;

interface SearchProvider {
  name: string;
  builtIn?: boolean;
  search: (
    query: string,
    options?: { limit?: number; offset?: number }
  ) => Promise<SearchResult[]>;
}

interface SearchResult {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  snippet: string;
  score: number;
}
```

宿主：`lib/search/default-provider.ts` 的 `getSearchProvider`，通过 `getPluginSearchProvider()` 取第一个提供者；调用方为搜索页与搜索 API。

返回：搜索结果数组。

执行顺序：只取第一个提供者；如果第一个插件失败，不会尝试第二个提供者，而是由调用方处理异常或回退默认搜索。

失败：搜索函数抛错会传递给调用方；宿主没有内建重试。

示例：

```ts
searchProvider: {
  name: 'sqlite-fts',
  async search(query, options) {
    const limit = options?.limit ?? 10;
    const offset = options?.offset ?? 0;
    const rows = ctx.pluginDb
      .prepare('SELECT id, slug, title, summary FROM posts_fts WHERE posts_fts MATCH ? LIMIT ? OFFSET ?')
      .all(query, limit, offset) as any[];
    return rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      slug: String(r.slug),
      summary: r.summary ?? null,
      snippet: String(r.summary ?? ''),
      score: 1,
    }));
  },
},
```

注意：

- `builtIn` 字段宿主不使用，仅作标记。
- 需要自己维护索引；插件没有搜索重建钩子。

#### 6.5.3 `attachmentStorage`

类型：

```ts
attachmentStorage?: AttachmentStorageProvider;

interface AttachmentUploadInput {
  filename: string;
  mimeType: string;
  size: number;
  buffer: Uint8Array;
}

interface AttachmentStorageResult {
  url: string;
  id?: string;
  name?: string;
  size?: number;
  meta?: Record<string, unknown>;
}

interface AttachmentStorageProvider {
  name: string;
  upload: (input: AttachmentUploadInput) => Promise<AttachmentStorageResult>;
  delete?: (urlOrId: string) => Promise<boolean>;
}
```

宿主：`app/api/upload/route.ts` 的 `POST`。

行为：

1. 校验登录与 `photo:upload` 权限。
2. 仅接受图片 MIME：`image/jpeg`、`image/png`、`image/webp`、`image/gif`。
3. 单文件不超过 10MB。
4. 使用 `sharp` 归一化图片。
5. 调用第一个 `attachmentStorage` 提供者。
6. 提供者抛错或返回的 `url` 为空时，回退本地磁盘。
7. 附件记录中的 `storage` 字段写入提供者名称；本地回退时写入 `local`。

执行顺序：只取第一个提供者。

失败：回退本地，不尝试第二个提供者。

示例：

```ts
attachmentStorage: {
  name: 's3',
  async upload({ filename, mimeType, buffer }) {
    const key = `uploads/${Date.now()}-${filename}`;
    await s3.putObject({ Bucket: 'blog', Key: key, Body: buffer, ContentType: mimeType });
    return { url: `https://cdn.example.com/${key}`, id: key, name: filename, size: buffer.byteLength };
  },
  async delete(urlOrId) {
    await s3.deleteObject({ Bucket: 'blog', Key: urlOrId });
    return true;
  },
},
```

限制：

- 只能处理图片上传；其他附件不经过该扩展点。
- 宿主不会调用 `delete`；删除附件时不会自动清理远端对象，需要插件自行监听或提供管理入口。
- `size` 是归一化前的原始大小。

#### 6.5.4 `notifier`

类型：

```ts
notifier?: PluginNotifier;

interface PluginNotification {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  scene?: string;
}

interface PluginNotifier {
  name: string;
  send: (message: PluginNotification) => Promise<{ ok: boolean; error?: string; messageId?: string }>;
}
```

宿主：`lib/mailer.ts` 的 `sendMail`。

行为：

1. `getPluginNotifier()` 取第一个插件的 notifier。
2. 调用 `send(message)`。
3. 返回 `{ ok: true }` 时结束。
4. 返回 `{ ok: false }`、抛错或没有 notifier 时回退站点 SMTP。

执行顺序：只取第一个 notifier；第一个失败不会尝试第二个 notifier。

失败：记录错误并回退 SMTP；SMTP 也失败时返回错误。

场景值：类型注释列出 `comment-approve`、`comment-pending`、`email-code`、`password-reset`、`test`，但当前宿主内置邮件调用没有传 `scene`，实际值为 `undefined`。插件应处理缺省场景。

示例：

```ts
notifier: {
  name: 'webhook-mail',
  async send(message) {
    try {
      const res = await fetch('https://mail.example.com/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message),
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const data = await res.json();
      return { ok: true, messageId: data.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
},
```

### 6.6 API

#### 6.6.1 `apiMiddleware`

类型：

```ts
apiMiddleware?: ApiMiddlewareDef[];

interface ApiMiddlewareDef {
  path?: string;
  methods?: ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE')[];
  handler: (
    req: Request,
    next: () => Promise<Response>
  ) => Response | void | Promise<Response | void>;
}
```

宿主：`lib/plugin/api-gate.ts` 的 `pluginApiGate`，内部调用 `runApiMiddlewares`。

匹配规则：

- `path` 为前缀匹配，例如 `/api/posts` 同时匹配 `/api/posts/123`。
- `path` 留空匹配所有被覆盖的路由。
- `methods` 留空匹配所有方法。
- 方法比较不区分大小写。

执行顺序：

- 按插件加载顺序、插件内数组顺序组成链。
- 每个中间件拿到 `next`，调用它进入下一环。
- 最后一环返回 `new Response(null, { status: 204 })` 作为占位。

返回语义：

| 返回 | 行为 |
| --- | --- |
| `Response` | 立即作为最终响应，后续中间件与原接口都不执行 |
| `undefined` / `null` | 自动进入下一环 |
| 调用并 `await next()` 后返回其结果 | 正常链式放行 |
| 调用 `next()` 后不返回该结果 | 宿主会再次调用下一环，可能重复执行 |

失败：

- 任一中间件抛错会使整个链中止，`pluginApiGate` 捕获后返回 `null`，原接口继续执行。
- 这是 fail-open 行为，不能把安全策略只放在中间件里。

204：

- 链尾占位是 204，`runApiMiddlewares` 会把 204 转为 `null`。
- 中间件主动返回 204 也会被视为“放行”，无法用它阻止请求。
- 需要拦截时返回 401、403 或其他带状态码的 `Response`。

示例：

```ts
apiMiddleware: [
  {
    path: '/api/comments',
    methods: ['POST'],
    async handler(req, next) {
      const ua = req.headers.get('user-agent') ?? '';
      if (!ua) {
        return Response.json({ error: '缺少 User-Agent' }, { status: 400 });
      }
      const res = await next();
      res.headers.set('x-comment-guard', '1');
      return res;
    },
  },
],
```

#### 6.6.2 `customApi`

类型：

```ts
customApi?: CustomApiRouteDef[];

interface CustomApiRouteDef {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  handler: (req: Request) => Promise<Response>;
  auth: boolean;
}
```

宿主：`app/api/plugin/[...path]/route.ts` 的 `GET`、`POST`、`PUT`、`DELETE`。

路由格式：

```text
/api/plugin/<slug><path>
```

匹配规则：

- 请求路径去掉 `/api/plugin/<slug>` 后得到剩余路径，必须是 `/xxx` 形式。
- `def.path` 必须带前导 `/`，并与之完全相等。
- 不支持路径参数、通配符、尾部斜杠容错。
- 查询字符串不参与匹配，通过 `new URL(req.url).searchParams` 读取。
- 请求体由插件自行解析，例如 `await req.json()`。
- 只支持四个方法；`PATCH`、`OPTIONS` 没有导出。

鉴权：

- `def.auth !== false` 时要求已登录，否则返回 401。
- `auth` 在类型中是必填布尔值；运行时省略也会按需要鉴权处理。
- 不校验具体权限。
- `auth: true` 的接口仍要防 CSRF；宿主不提供自动 CSRF 校验。

异常：

- handler 抛错返回 500。
- 未知路由返回 404。
- 未启用、未加载或 slug 不匹配返回 404。

执行顺序：按插件加载顺序、数组顺序匹配，第一个匹配的路由生效。

示例：

```ts
customApi: [
  {
    method: 'GET',
    path: '/top',
    auth: false,
    async handler(req) {
      const limit = Number(new URL(req.url).searchParams.get('limit') ?? 8);
      const list = await ctx.db.post.findMany({
        where: { status: 'PUBLISHED' },
        orderBy: { views: 'desc' },
        take: Math.min(Math.max(limit, 1), 20),
        select: { id: true, title: true, slug: true, views: true },
      });
      return Response.json({ list });
    },
  },
  {
    method: 'POST',
    path: '/rebuild',
    auth: true,
    async handler(req) {
      if (!ctx.config.enabled) {
        return Response.json({ error: '插件未启用' }, { status: 403 });
      }
      const body = await req.json().catch(() => ({}));
      return Response.json({ ok: true, received: body });
    },
  },
],
```

路径大小写敏感，slug 与目录名一致。

### 6.7 编辑器

#### 6.7.1 `editorCreate`

类型：

```ts
editorCreate?: () => EditorActionDef[];

interface EditorActionDef {
  key: string;
  label: string;
  icon?: string;
  insert?: string;
  wrap?: [string, string];
  shortcut?: string;
  permissions?: string[];
}
```

宿主：`lib/plugin/ui.ts` 的 `collectEditorActions`；接口 `GET /api/plugin/editor-actions`；前端 `components/admin/MilkdownEditor.tsx`。

前端行为：

- 页面加载时请求工具按钮列表。
- 每个按钮显示 `label`，`shortcut` 仅作为 `title` 提示，不注册真实快捷键。
- 点击时：
  - 取当前选区文本。
  - 若有 `insert`，把 `{selection}` 替换为选中文本。
  - 若有 `wrap`，把选中文本前后包裹。
  - 使用 `document.execCommand('insertText')` 写入。
- 没有任何 `insert`/`wrap` 的按钮点击后通常没有效果。

失败：收集异常返回空列表；按钮不影响编辑器主流程。

形态：函数返回数组或直接数组都可以，`collectEditorActions` 会先调用函数再展开。推荐按类型声明写函数：

```ts
editorCreate: () => [
  { key: 'spoiler', label: '折叠', insert: '<details><summary>展开</summary>\n{selection}\n</details>' },
]
```

当前运行时可用写法：

```ts
const handlers = {
  editorCreate: [
    { key: 'spoiler', label: '折叠', insert: '<details><summary>展开</summary>\n{selection}\n</details>' },
  ],
} as unknown as ExtensionHandlers;
```

### 6.8 评论

#### 6.8.1 `commentEditorReplace`

类型：

```ts
commentEditorReplace?: () => ComponentType | null;
```

宿主：`lib/plugin/ui.ts` 的 `getCommentEditorHtml` / `getCommentEditorComponent`；调用方为 `app/(site)/blog/[slug]/page.tsx`。

返回：替换内置评论编辑器的组件，或 `null`。返回的组件会以 props `{ postId, fields }` 进行服务端渲染：

```ts
interface CommentEditorProps {
  postId: string;
  fields: CommentFieldDef[];
}
```

执行顺序：第一个返回非空组件的插件生效。

接入状态：已接入。文章详情页会先取组件，再用 `renderPluginComponentHtml(comp, { postId, fields })` 渲染为 HTML，替换内置 `CommentForm`。

限制：

- 服务端静态渲染，React 状态、事件与 effect 不会水合；插件需自带静态表单（原生 `form` 提交到自建 API）或内联脚本。
- 渲染抛错时回退内置评论表单，不会导致整页 500。
- 组件拿不到当前登录用户，需要时由插件在服务端读取或通过 `customApi` 提供。

示例：

```ts
commentEditorReplace() {
  return function RichCommentEditor(props: { postId: string; fields: unknown[] }) {
    return React.createElement(
      'form',
      { method: 'post', action: `/api/plugin/my-plugin/comment?post=${props.postId}` },
      React.createElement('textarea', { name: 'content', required: true }),
      React.createElement('button', { type: 'submit' }, '提交')
    );
  };
}
```

#### 6.8.2 `commentListItemContentReplace`

类型：

```ts
commentListItemContentReplace?: () => ComponentType | null;
```

宿主：`lib/plugin/ui.ts` 的 `getCommentContentRendererHtml` / `getCommentContentRenderer`；调用方为文章详情页与 `CommentList`。

返回：替换单条评论内容渲染的组件，或 `null`。组件以 props `{ comment }` 渲染，逐条生成 HTML 后通过 `contentHtml` 传给 `CommentList`。

执行顺序：第一个非空组件生效。

接入状态：已接入。文章详情页对每条评论调用渲染器生成 `contentHtml`，`CommentList` 优先使用它，渲染失败或为空时回退默认的 `renderCommentContent`。

限制：

- 同样是服务端静态渲染，React 状态与事件不会水合。
- 每条评论独立渲染，插件不要依赖跨评论共享状态。
- 渲染抛错时该条回退内置渲染，不影响其他评论。

示例：

```ts
commentListItemContentReplace() {
  return function RichComment(props: { comment: { contentMd?: string | null } }) {
    return React.createElement(
      'div',
      { className: 'prose' },
      props.comment.contentMd ?? ''
    );
  };
}
```

#### 6.8.3 `commentSubjectRef`

类型：

```ts
commentSubjectRef?: () => CommentSubjectRefDef[];

interface CommentSubjectRefDef {
  key: string;
  label: string;
  href: (item: Record<string, any>) => string;
  icon?: string;
}
```

宿主：`lib/plugin/ui.ts` 的 `collectCommentSubjectRefs`；调用方为 `GET /api/comments`。

返回：评论来源引用定义数组。

行为：

- 只取第一个定义。
- 为每条评论附加：

```ts
_subject: {
  key: ref.key,
  label: ref.label,
  href: ref.href(comment),
}
```

- `href` 抛错时该条评论不加 `_subject`。

执行顺序：数组第一个元素生效。

失败：收集异常返回空数组。

形态：函数返回数组或直接数组都可以，`collectCommentSubjectRefs` 会先调用函数再展开。推荐按类型声明写函数：

```ts
commentSubjectRef: () => [
  {
    key: 'moment',
    label: '动态',
    href: (c) => `/moments/${c.momentId}`,
  },
]
```

当前运行时可用写法：

```ts
const handlers = {
  commentSubjectRef: [
    {
      key: 'moment',
      label: '动态',
      href: (c: Record<string, any>) => `/moments/${c.momentId}`,
    },
  ],
} as unknown as ExtensionHandlers;
```

### 6.9 模板

#### 6.9.1 `providesTemplates`

类型：

```ts
providesTemplates?: string[];
```

宿主：`lib/plugin/engine.ts` 的 `getProvidedTemplates`。

返回：模板名数组，例如 `['stats-card', 'author-box']`。

约束：

- 模板名必须匹配 `^[a-z0-9][a-z0-9-]*$`。
- 对应文件为 `scripts/plugins/<slug>/templates/<name>.tsx`。
- 数组只声明名称，不声明路径与 props。

执行顺序：所有插件的声明会合并为一个列表；当前宿主没有页面自动消费该列表。

实际解析由主题侧调用 `resolvePluginTemplate` 完成：

1. 主题覆盖：`scripts/themes/<theme>/templates/plugins/<slug>/<name>.tsx`。
2. 插件自带：`scripts/plugins/<slug>/templates/<name>.tsx`。

详见第 10 章。

示例：

```ts
providesTemplates: ['stats-card'],
```

### 6.10 后台通用

#### 6.10.1 `dashboardWidget`

类型：

```ts
dashboardWidget?: DashboardWidgetDef[];

interface DashboardWidgetDef {
  title: string;
  icon?: string;
  component: ComponentType | (() => Promise<{ default: ComponentType }>);
  permissions?: string[];
  colSpan?: number;
}
```

宿主：`lib/plugin/ui.ts` 的 `collectDashboardWidgets`；接口 `GET /api/console/plugin-widgets`；调用方为后台仪表盘。

返回：卡片数组。

渲染：组件无 props，输出 HTML；`colSpan` 缺省为 1，宿主只做简单网格布局。

执行顺序：插件加载顺序加数组顺序。

失败：单卡片失败跳过。

权限：定义了 `permissions` 时按当前登录用户权限过滤；未定义视为公开。

示例：

```ts
dashboardWidget: [
  {
    title: '阅读统计',
    icon: 'activity',
    colSpan: 2,
    component: async function StatsCard() {
      const row = ctx.pluginDb
        .prepare('SELECT COUNT(*) AS total, SUM(minutes) AS minutes FROM reading_stats')
        .get() as { total: number; minutes: number | null };
      return React.createElement(
        'div',
        { className: 'text-sm text-gray-600' },
        `已统计 ${row.total} 篇，共 ${row.minutes ?? 0} 分钟`
      );
    },
  },
],
```

#### 6.10.2 `dashboardQuickAction`

类型：

```ts
dashboardQuickAction?: QuickActionDef[];

interface QuickActionDef {
  label: string;
  icon?: string;
  href: string;
  permissions?: string[];
}
```

宿主：`lib/plugin/ui.ts` 的 `collectQuickActions`；接口同仪表盘组件。

渲染：链接列表，点击跳转 `href`。

执行顺序：数组顺序。

失败：收集异常返回空。

权限：定义了 `permissions` 时按当前登录用户权限过滤；未定义视为公开。

示例：

```ts
dashboardQuickAction: [
  { label: '打开阅读统计', href: '/console/plugin-ext/reading-stats', icon: 'chart' },
],
```

### 6.11 后台列表操作

以下 8 个扩展点共用同一类型与同一收集器 `collectListOperations`。

类型：

```ts
interface ListItemOperationDef {
  label: string;
  icon?: string;
  variant?: 'default' | 'ghost' | 'outline';
  onClick?: string;
  permissions?: string[];
}
```

公共语义：

- `onClick` 不是函数，而是链接模板。
- 宿主把 `onClick` 映射为 `hrefTemplate`；未提供时为空字符串。
- 页面按各自的占位符替换后渲染 `<a>`。
- `variant`、`icon` 会被收集，但多数页面当前只渲染文字链接。
- 定义了 `permissions` 时按当前登录用户权限过滤；未定义视为公开。
- 无服务端点击回调，操作必须通过跳转页面完成。
- 所有操作都没有确认弹窗或 POST 能力；危险操作请在目标页面二次确认。

#### 6.11.1 `postListItemOperation`

宿主：`app/api/posts/route.ts` 的 `GET`；文章列表页。

占位符：`{id}`、`{slug}`。

示例：

```ts
postListItemOperation: [
  { label: '查看统计', onClick: '/console/plugin-ext/reading-stats?post={id}' },
],
```

#### 6.11.2 `pageListItemOperation`

宿主：`app/api/pages/route.ts` 的 `GET`；页面列表。

占位符：`{id}`、`{slug}`。

示例：

```ts
pageListItemOperation: [
  { label: '预览', onClick: '/p/{slug}' },
],
```

#### 6.11.3 `commentListItemOperation`

宿主：`app/api/comments/route.ts` 的 `GET`；评论管理列表。

占位符：`{id}`。

示例：

```ts
commentListItemOperation: [
  { label: '查看用户', onClick: '/console/users?comment={id}' },
],
```

#### 6.11.4 `replyListItemOperation`

宿主：`app/api/comments/route.ts` 的 `GET`，与评论一起返回 `replyOperations`。

占位符：`{id}`。

**当前状态**：接口会返回 `replyOperations`，但评论管理页没有渲染该字段，因此当前不会显示。保留定义以备前端接入。

示例：

```ts
replyListItemOperation: [
  { label: '回复详情', onClick: '/console/comments?reply={id}' },
],
```

#### 6.11.5 `pluginListItemOperation`

宿主：`app/api/console/plugins/route.ts` 的 `GET`；插件列表。

占位符：`{slug}`、`{id}`。

示例：

```ts
pluginListItemOperation: [
  { label: '打开面板', onClick: '/console/plugin-ext/reading-stats' },
],
```

#### 6.11.6 `themeListItemOperation`

宿主：`app/api/console/themes/route.ts` 的 `GET`；主题列表。

占位符：`{slug}`。

示例：

```ts
themeListItemOperation: [
  { label: '主题设置', onClick: '/console/themes?theme={slug}' },
],
```

#### 6.11.7 `attachmentListItemOperation`

宿主：`app/api/console/attachments/route.ts` 的 `GET`；附件库。

占位符：`{id}`、`{url}`。`{url}` 会经过 `encodeURIComponent`。

示例：

```ts
attachmentListItemOperation: [
  { label: '压缩预览', onClick: '/console/plugin-ext/image-tools?url={url}' },
],
```

#### 6.11.8 `backupListItemOperation`

宿主：`app/api/console/backup/route.ts` 的 `GET`；备份列表。

占位符：`{name}`，替换时会 `encodeURIComponent`。

示例：

```ts
backupListItemOperation: [
  { label: '上传到云', onClick: '/console/plugin-ext/cloud-backup?file={name}' },
],
```

### 6.12 后台列表字段

以下 3 个扩展点共用 `ListItemFieldDef` 与 `collectListFields`。

类型：

```ts
interface ListItemFieldDef {
  key: string;
  label: string;
  width?: number;
  sortable?: boolean;
  render: (item: Record<string, any>) => string | number | null | Promise<string | number | null>;
}
```

公共语义：

- 字段以 `_fields` 对象附加到每行数据。
- `render` 可异步。
- 返回值转为字符串；`null`/`undefined` 显示为空。
- 异常显示为空，不影响主表格。
- `width`、`sortable` 被收集，但当前列表页主要使用 `key`/`label` 与渲染结果。
- 字段只读，不能编辑。
- `permissions` 不存在于此类型，无法按权限隐藏。

#### 6.12.1 `postListItemField`

宿主：`GET /api/posts`；文章列表。

示例：

```ts
postListItemField: [
  {
    key: 'reading_minutes',
    label: '阅读时长',
    render: (post) => {
      const row = ctx.pluginDb
        .prepare('SELECT minutes FROM reading_stats WHERE slug = ?')
        .get(String(post.slug)) as { minutes?: number } | undefined;
      return row?.minutes ? `${row.minutes} 分钟` : '-';
    },
  },
],
```

#### 6.12.2 `pageListItemField`

宿主：`GET /api/pages`；页面列表。

示例：

```ts
pageListItemField: [
  {
    key: 'slug_length',
    label: '短链长度',
    render: (page) => String(page.slug ?? '').length,
  },
],
```

#### 6.12.3 `pluginListItemField`

宿主：`GET /api/console/plugins`；插件列表。

示例：

```ts
pluginListItemField: [
  {
    key: 'table_rows',
    label: '统计条数',
    render: () => {
      const row = ctx.pluginDb
        .prepare('SELECT COUNT(*) AS n FROM reading_stats')
        .get() as { n: number };
      return row.n;
    },
  },
],
```

### 6.13 后台 Tab

以下 6 个扩展点共用 `TabDef` 与 `collectTabs`。

类型：

```ts
interface TabDef {
  key: string;
  label: string;
  icon?: string;
  permissions?: string[];
  component: ComponentType | (() => Promise<{ default: ComponentType }>);
}
```

公共语义：

- 每个 Tab 的组件无 props 渲染为静态 HTML。
- 定义了 `permissions` 时按当前登录用户权限过滤；未定义视为公开。
- 收集异常返回空数组。
- Tab 内容不支持客户端交互；需要交互时使用原生表单或链接到自定义页面。

#### 6.13.1 `pluginDetailTab`

宿主：`GET /api/console/plugins`；插件列表的详情抽屉。

行为：宿主返回带 `pluginSlug` 的 Tab 列表，前端按当前插件 slug 过滤。

示例：

```ts
pluginDetailTab: [
  {
    key: 'config-hint',
    label: '说明',
    component: function Hint() {
      return React.createElement('p', { className: 'text-sm' }, '修改配置后保存即可生效。');
    },
  },
],
```

#### 6.13.2 `themeListTab`

宿主：`GET /api/console/themes`；主题列表。

示例：

```ts
themeListTab: [
  {
    key: 'theme-tip',
    label: '主题提示',
    component: function Tip() {
      return React.createElement('p', { className: 'text-sm' }, '主题覆盖模板位于 templates/plugins。');
    },
  },
],
```

#### 6.13.3 `attachmentSelectorTab`

宿主：`GET /api/console/attachments`；附件选择器。

示例：

```ts
attachmentSelectorTab: [
  {
    key: 'remote',
    label: '远程图片',
    component: function Remote() {
      return React.createElement('p', { className: 'text-sm' }, '在此展示远程图库说明。');
    },
  },
],
```

#### 6.13.4 `pluginInstallTab`

宿主：`GET /api/console/plugins`；插件安装区域。

行为：所有插件提供的安装 Tab 都会显示，与当前插件无关。

示例：

```ts
pluginInstallTab: [
  {
    key: 'install-help',
    label: '安装说明',
    component: function Help() {
      return React.createElement('p', { className: 'text-sm' }, '上传 .zip.rainy-plugin 文件。');
    },
  },
],
```

#### 6.13.5 `backupTab`

宿主：`GET /api/console/backup`；备份页面。

示例：

```ts
backupTab: [
  {
    key: 'cloud',
    label: '云备份',
    component: function Cloud() {
      return React.createElement('p', { className: 'text-sm' }, '云备份说明。');
    },
  },
],
```

#### 6.13.6 `userDetailTab`

宿主：`GET /api/console/users`；用户详情。

示例：

```ts
userDetailTab: [
  {
    key: 'activity',
    label: '活跃度',
    component: function Activity() {
      return React.createElement('p', { className: 'text-sm' }, '活跃度说明。');
    },
  },
],
```

### 6.14 后台路由

#### 6.14.1 `customAdminRoutes`

类型：

```ts
customAdminRoutes?: AdminRouteDef[];

interface AdminRouteDef {
  path: string;
  title: string;
  icon?: string;
  group?: string;
  hideSidebar?: boolean;
  component: () => Promise<{ default: ComponentType }>;
}
```

宿主：

- 菜单：`lib/plugin/admin.ts` 的 `getPluginNavItems`，由 `app/console/layout.tsx` 注入 `ConsoleShell`。
- 页面：`app/console/plugin-ext/[slug]/[[...path]]/page.tsx`。

行为：

- 菜单地址为 `/console/plugin-ext/<slug>/<path>`。
- `path` 不要带前导 `/`；带前导 `/` 会生成双斜杠并导致页面匹配失败。
- `path` 为空字符串时，访问 `/console/plugin-ext/<slug>` 命中该路由。
- 匹配使用完整路径字符串相等，不支持动态段。
- `component` 必须返回含 `default` 的模块，通常是 `() => import('./admin.js')`。
- 页面组件无 props，只做静态 HTML。
- 导航分组：
  - 与内置分组同名时并入该分组：`总览`、`内容`、`站点`、`系统`、`工具`。
  - 提供了其他 `group` 时新建同名分组。
  - 未提供 `group` 时进入“插件”分组。
- 导航图标固定为 Puzzle，`icon` 不生效。
- `hideSidebar` 被解析但不生效，侧栏仍显示。
- 后台布局只校验登录，没有路由级权限；页面内的敏感操作需自行鉴权。

示例：

```ts
customAdminRoutes: [
  {
    path: '',
    title: '阅读统计',
    group: '工具',
    component: () => import('./admin.js'),
  },
  {
    path: 'settings-hint',
    title: '阅读设置说明',
    group: '工具',
    component: () => import('./admin.js'),
  },
],
```

`admin.tsx`：

```tsx
export default async function ReadingAdmin() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">阅读统计</h1>
      <p className="text-sm text-fg-muted">数据来自插件独立 SQLite。</p>
      <a className="text-sm text-primary" href="/console/system/plugins">
        返回插件列表
      </a>
    </div>
  );
}
```

#### 6.14.2 `customFrontendRoutes`

类型：

```ts
customFrontendRoutes?: FrontendRouteDef[];

interface FrontendRouteDef {
  path: string;
  title: string;
  component: () => Promise<{ default: ComponentType }>;
  ssr?: boolean;
}
```

宿主：`app/(site)/p/[...path]/page.tsx`。

路由格式：

```text
/p/<slug>/<path>
```

行为：

- `path` 不带前导 `/`。
- 匹配完整剩余路径，精确相等。
- `component` 动态导入并取 `default`。
- 组件无 props。
- 使用站点布局包裹。
- `title` 当前不参与页面标题生成。
- `ssr` 被解析但不生效，始终按服务端组件渲染。
- 未匹配时 `notFound()`。

示例：

```ts
customFrontendRoutes: [
  {
    path: 'about-stats',
    title: '阅读统计',
    component: () => import('./admin.js'),
  },
],
```

访问地址：`/p/reading-stats/about-stats`。

注意：

- 前台路由与后台页面共用 `admin.js` 时，后台样式与前台布局可能冲突，建议使用独立页面产物或内联样式。
- CLI 只固定编译 `index`、`admin`、`theme` 三个入口；其他页面若被静态导入会被打包进入口，若被动态导入需要单独存在的 `admin.js`。

### 6.15 扩展点数量自检

按 `ExtensionHandlers` 实际键统计：

| 分组 | 数量 | 键 |
| --- | --- | --- |
| 生命周期 | 5 | `onMount`、`beforeSavePost`、`beforeCommentApprove`、`afterSavePost`、`beforeDeletePost` |
| 内容渲染 | 5 | `onGenerateMetadata`、`onRenderMarkdown`、`excerptGenerator`、`injectHead`、`injectFooter` |
| 前台 UI | 6 | `injectSidebarWidget`、`injectHeaderAction`、`injectPostContent`、`injectSinglePageContent`、`injectCommentWidget`、`injectCommentField` |
| 数据与通知 | 4 | `onPageView`、`searchProvider`、`attachmentStorage`、`notifier` |
| API | 2 | `apiMiddleware`、`customApi` |
| 编辑器 | 1 | `editorCreate` |
| 评论 | 3 | `commentEditorReplace`、`commentListItemContentReplace`、`commentSubjectRef` |
| 模板 | 1 | `providesTemplates` |
| 后台 UI 与路由 | 21 | 2 个仪表盘、8 个列表操作、3 个列表字段、6 个 Tab、`customAdminRoutes`、`customFrontendRoutes` |
| 合计 | 48 | 与 `ExtensionHandlers` 一致 |

---

## 7. 数据存储

插件有四类持久化位置：

| 存储 | 位置 | 访问方式 | 适用 |
| --- | --- | --- | --- |
| 宿主主库 | 由 `DATABASE_URL` 决定 | `ctx.db` | 需要与文章、用户、评论关联的数据 |
| 访问统计库 | 由统计配置决定 | `ctx.analytics` | 访问日志、PV/UV |
| 插件独立 SQLite | `db/plugins-db/<slug>.db` | `ctx.pluginDb` | 插件私有结构化数据 |
| 插件 JSON | `db/plugins-json/<slug>.run.json`、`<slug>.config.json` | `ctx.pluginJson`、`ctx.config` | 小体积键值、运行状态、配置 |

### 7.1 JSON 运行存储

接口：

```ts
interface PluginJsonStore {
  get(): Promise<Record<string, any>>;
  set(patch: Record<string, any>): Promise<Record<string, any>>;
  replace(data: Record<string, any>): Promise<void>;
}
```

对应文件：`db/plugins-json/<slug>.run.json`。

行为：

- `get()` 每次直接读文件。
- 文件不存在或 JSON 解析失败时返回 `{}`，不抛错。
- `set(patch)` 是浅合并，返回合并后的完整对象。
- `replace(data)` 整体覆盖，返回 `void`。
- 同一文件的写入通过队列串行化，避免并发写交错。
- 没有删除单个键的 API；可以 `replace` 整个对象。
- 没有大小限制与 schema 校验。

示例：

```ts
async onMount(ctx) {
  const state = await ctx.pluginJson.get();
  if (!state.installedAt) {
    await ctx.pluginJson.set({ installedAt: new Date().toISOString(), runs: 0 });
  }
  await ctx.pluginJson.set({ runs: Number(state.runs ?? 0) + 1 });
}
```

注意：

- 类型注释中把该存储描述为 `<slug>.config.json`，实际实现使用 `<slug>.run.json`；配置请用 `ctx.config`。
- 不要用它存放大数组或高频计数；每次写入都会重写整个文件。
- 多进程部署时该存储没有跨进程锁，只有进程内队列。

### 7.2 配置存储

文件：`db/plugins-json/<slug>.config.json`。

- 安装/启动时 `ensurePluginConfigFile` 初始化：
  - 已有文件不覆盖。
  - 否则复制包内 `config.json`。
  - 包内没有则写 `{}`。
- 插件只通过 `ctx.config` 读取快照。
- 后台通过 `PUT /api/console/plugins/<slug>/config` 整体覆盖。
- 插件没有写入配置的公开 API。
- 升级不会覆盖用户配置。

配置文件是明文 JSON，敏感信息（API Key、SMTP 密码）会直接落盘，需要自行限制文件权限或使用环境变量。

### 7.3 插件独立 SQLite

接口：

```ts
interface PluginDbStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface PluginDatabase {
  prepare(sql: string): PluginDbStatement;
  exec(sql: string): unknown;
  pragma(source: string, options?: unknown): unknown;
}
```

实际实现：

- 使用 `better-sqlite3`。
- 文件：`db/plugins-db/<slug>.db`。
- 首次访问属性时创建目录并打开连接。
- `journal_mode = WAL`。
- `foreign_keys = ON`。
- 连接按 slug 缓存在进程内。
- 卸载时可关闭并删除。

示例：

```ts
ctx.pluginDb.exec(`
  CREATE TABLE IF NOT EXISTS reading_stats (
    slug TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    minutes INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const row = ctx.pluginDb
  .prepare('SELECT minutes FROM reading_stats WHERE slug = ?')
  .get(slug) as { minutes: number } | undefined;

ctx.pluginDb
  .prepare('INSERT INTO reading_stats (slug, title, minutes, views) VALUES (?, ?, ?, ?) ON CONFLICT(slug) DO UPDATE SET title=excluded.title, minutes=excluded.minutes')
  .run(slug, title, minutes, 0);
```

限制：

- 类型只暴露 `prepare`、`exec`、`pragma`，没有显式的 `transaction`。
- 实际对象是 better-sqlite3 的 `Database`，但不要依赖类型未声明的成员，升级可能变化。
- 同步 API 会阻塞宿主事件循环；避免全表扫描与大事务。
- WAL 模式下会生成 `-wal` 与 `-shm` 文件。
- 不要用 `ATTACH DATABASE` 访问其他插件库。

### 7.4 迁移

清单：

```json
{
  "database": {
    "enabled": true,
    "migrations": [
      { "version": "001", "description": "初始化", "file": "migrations/001_init.sql" },
      { "version": "002", "description": "增加浏览量", "file": "migrations/002_views.sql" }
    ]
  }
}
```

执行时机：

- 上传安装。
- 版本升级。
- dev 安装。
- 不包含普通启动。

执行过程（`lib/plugin/migrator.ts`）：

1. 若 `database.enabled` 不为真或没有迁移，直接返回。
2. 打开插件数据库。
3. 创建 `_rn_migrations` 表。
4. 查询已应用版本。
5. 逐个处理迁移：
   - 已存在则跳过。
   - 文件不存在时打印警告并跳过，不写入记录。
   - 读取 SQL，使用 `db.exec` 执行。
   - 插入 `version`、`description`、`applied_at`、`checksum=null`。
6. 任一迁移抛错则中止后续迁移并向上抛出。

回滚语义：

- 安装器会恢复插件目录。
- 已经执行的 SQL 不会回滚。
- 修复后重新安装时，已记录的版本会跳过，未记录的版本继续执行。

建议：

- 每个迁移只做增量变更。
- 不要修改已发布迁移文件；追加新版本。
- 需要数据修复时写成可重复执行的 SQL 或在新版本中处理。
- 应用启动时仍应使用 `CREATE TABLE IF NOT EXISTS` 兜底，防止手工复制目录或迁移失败。

### 7.5 上传与附件存储

上传入口：`POST /api/upload`。

限制：

- 需要登录。
- 需要 `photo:upload` 权限。
- 仅图片：JPEG、PNG、WebP、GIF。
- 单文件不超过 10MB。
- 使用 `sharp` 归一化。

流程：

1. 读取 `formData` 中的 `file`。
2. 校验类型与大小。
3. 归一化图片。
4. 若存在 `attachmentStorage` 提供者，调用 `upload`。
5. 成功且 `url` 非空则使用返回结果。
6. 否则写入 `public/uploads/<yyyyMM>/`。
7. 创建 `Attachment` 记录，`storage` 标记来源。

插件侧注意：

- `delete` 不会被宿主调用，删除附件不会清理远端对象。
- 宿主记录的是返回的 `url`，不是 `id`；如果需要删除能力，应自行保存 `id` 映射。
- 远端 URL 必须可公开访问，或由插件提供代理。
- 上传接口不经过 `apiMiddleware`。

### 7.6 插件间隔离

实际隔离程度：

| 资源 | 隔离 |
| --- | --- |
| JSON 运行存储 | 按 slug 分文件，API 只暴露当前插件 |
| 配置存储 | 按 slug 分文件，插件只读 |
| SQLite | 按 slug 分文件，连接按 slug 缓存 |
| 主库 | 不隔离，所有插件共享 Prisma 客户端与全部模型 |
| 环境变量 | 不隔离 |
| 文件系统 | 不隔离 |
| 进程内全局 | 不隔离 |

因此：

- 不要假设其他插件不会读写主库。
- 不要把私有数据放在主库的通用表中而不加前缀。
- 需要严格隔离时使用独立 SQLite，并在表名与 slug 上保持唯一。
- 插件间没有正式通信 API；`emitEvent` 没有订阅端。

---

## 8. API 扩展

### 8.1 `customApi` 路由

路由文件：`app/api/plugin/[...path]/route.ts`。

请求：

```text
/api/plugin/<slug><path>
```

示例：

```ts
customApi: [
  { method: 'GET', path: '/status', auth: false, handler: async () => Response.json({ ok: true }) },
]
```

访问：

```text
GET /api/plugin/hello-rainynest/status
```

### 8.2 分发流程

1. 从路径参数取出第一段作为 slug，其余段拼成 `'/' + rest.join('/')`。
2. `bootPlugins()`。
3. 按加载顺序遍历启用插件。
4. 只检查 slug 匹配的插件的 `customApi` 数组。
5. 方法必须与导出的 HTTP 方法一致。
6. `path` 必须与剩余路径完全相等。
7. 若 `auth !== false`，调用 `auth()`，未登录返回 401。
8. 调用 `handler(req)`。
9. 返回 `Response`。
10. 未匹配返回 404。
11. handler 抛错返回 500。

注意：

- 每次请求都会直接调用 `bootPlugins()`，可能触发重复加载。
- `customApi` 请求不经过 `apiMiddleware`。
- 路由路径大小写敏感。
- `path` 必须有前导 `/`。
- 尾部斜杠、重复斜杠、URL 编码差异都会导致不匹配。
- 不支持 `[id]`、`[...slug]` 等动态段；需要自行解析尾部路径。
- 每次请求都可读取最新配置，但 `ctx.config` 仍是插件加载时的快照，配置保存会重置缓存。

### 8.3 鉴权与安全

- `auth: false`：公开接口。
- `auth: true` 或省略：要求登录。
- 没有角色/权限校验。
- 没有 CSRF token 校验。
- 没有速率限制。
- 没有请求体大小限制（由 Next 与反向代理决定）。
- 没有自动 CORS 配置。

建议：

- 所有写操作都要求 `auth: true`。
- 在 handler 内查询当前用户角色。
- 对修改类操作校验 `Origin` 或自定义头。
- 对公开接口做输入校验与限流。
- 不要回显内部错误堆栈。

### 8.4 `apiMiddleware` 链

宿主接入方式：

```ts
const blocked = await pluginApiGate(req);
if (blocked) return blocked;
```

`pluginApiGate`：

- 动态导入引擎。
- 调用 `runApiMiddlewares(req)`。
- 异常时返回 `null`，请求继续。

`runApiMiddlewares`：

1. 取所有中间件。
2. 过滤 `path` 前缀与 `methods`。
3. 无匹配返回 `null`。
4. 构造 `next` 链。
5. 执行首个中间件。
6. 返回值是 `Response` 则作为最终结果。
7. 返回值不是 `Response` 则自动进入下一环。
8. 链尾返回 204。
9. 最终 204 转为 `null`。

链式写法：

```ts
async handler(req, next) {
  const start = Date.now();
  const res = await next();
  console.log('elapsed', Date.now() - start);
  return res;
}
```

错误写法：

```ts
async handler(req, next) {
  await next();
  // 没有 return，宿主会再次调用 next，后面的中间件会执行两次
}
```

### 8.5 204 放行语义

- 204 被保留为“没有插件拦截”的内部信号。
- 中间件返回 204 不会阻止原接口。
- 需要返回空响应时使用 200 或 202。
- 需要禁止访问时使用 401、403、404、429。

### 8.6 异常处理

| 位置 | 异常结果 |
| --- | --- |
| `pluginApiGate` 导入引擎失败 | 放行 |
| 获取中间件列表失败 | 放行 |
| 某个中间件抛错 | 整条链中止，放行 |
| `next()` 下游抛错 | 传播到 `pluginApiGate`，放行 |
| `customApi` handler 抛错 | 500 |
| `customApi` 鉴权抛错 | 未捕获时由 Next 返回 500 |

因此 `apiMiddleware` 是 fail-open。不要把“必须阻止”的安全策略只放在这里。

### 8.7 已覆盖路由清单

`pluginApiGate(req)` 当前只在以下路由调用：

| 路由 | 方法 |
| --- | --- |
| `/api/categories` | `GET` |
| `/api/comments` | `GET`、`POST` |
| `/api/links` | `GET` |
| `/api/posts` | `GET`、`POST` |
| `/api/pages` | `GET` |
| `/api/tags` | `GET` |
| `/api/gallery` | `GET` |
| `/api/moments` | `GET`、`POST` |

未覆盖的常见路由：

- `/api/posts/[id]` 的 `GET`、`PUT`、`DELETE`
- `/api/pages/[id]`
- `/api/upload`
- `/api/search`
- `/api/analytics/pv`
- `/api/plugin/*`
- `/api/console/*`
- 认证相关路由

如果需要对未覆盖路由做前置处理，只能通过 `customApi` 另开入口，或修改宿主代码。

### 8.8 覆盖路由示例

```ts
apiMiddleware: [
  {
    path: '/api',
    methods: ['GET'],
    async handler(req, next) {
      const res = await next();
      res.headers.set('x-plugin', 'reading-stats');
      return res;
    },
  },
  {
    path: '/api/comments',
    methods: ['POST'],
    async handler(req, next) {
      const length = Number(req.headers.get('content-length') ?? 0);
      if (length > 256 * 1024) {
        return Response.json({ error: '请求体过大' }, { status: 413 });
      }
      return next();
    },
  },
],
```

### 8.9 特殊重写

`next.config.ts` 中有少量针对内置插件的硬编码重写，例如：

```text
/rss.xml  → /api/plugin/rss-feed/rss.xml
/atom.xml → /api/plugin/rss-feed/atom.xml
```

这不是通用能力。普通插件的 `customApi` 只能通过 `/api/plugin/<slug>/<path>` 访问。

### 8.10 API 调试清单

| 现象 | 检查 |
| --- | --- |
| 404 | slug 是否等于目录名；`path` 是否有前导 `/`；方法是否一致；插件是否启用 |
| 401 | `auth` 是否为 `true`；是否已登录 |
| 500 | handler 是否抛错；查看宿主日志 |
| 中间件不生效 | 路由是否在 8.7 清单；path 是否为前缀；方法是否匹配 |
| 响应头丢失 | 是否返回了 `next()` 的结果；NextResponse 头是否可写 |
| 请求体为空 | 是否已读取 `req.json()`；body 只能读一次 |

---

## 9. 后台 UI 扩展

### 9.1 插件管理页

入口：`/console/system/plugins`。

页面能力：

- 列出内置与上传插件。
- 显示名称、版本、作者、描述、来源、启用状态。
- 上传安装。
- 启用、停用、卸载。
- 配置表单。
- 插件详情 Tab。
- 插件安装 Tab。
- 插件列表字段与行操作。

接口：

| 接口 | 方法 | 权限 |
| --- | --- | --- |
| `/api/console/plugins` | `GET` | `plugin:view` |
| `/api/console/plugins/install` | `POST` | `plugin:install` |
| `/api/console/plugins/<slug>/activate` | `POST` | `plugin:activate` |
| `/api/console/plugins/<slug>/deactivate` | `POST` | `plugin:deactivate` |
| `/api/console/plugins/<slug>/config` | `PUT` | `plugin:config` |
| `/api/console/plugins/<slug>` | `DELETE` | `plugin:uninstall` |

### 9.2 菜单

来源：`customAdminRoutes`。

- 菜单项标题使用 `title`。
- 地址使用 `/console/plugin-ext/<slug>/<path>`。
- 分组规则见 6.14.1。
- 图标固定 Puzzle。
- `hideSidebar` 不生效。
- 无权限过滤。

### 9.3 列表字段

来源：`postListItemField`、`pageListItemField`、`pluginListItemField`。

渲染位置：

- 文章列表与页面列表的表格/卡片。
- 插件列表。

数据形态：

```ts
{
  ...row,
  _fields: {
    [fieldKey]: "字符串值"
  }
}
```

约束：

- 只能输出纯文本。
- 不能返回 HTML。
- 不能排序或筛选。
- 异步渲染串行执行，字段多时会增加列表响应时间。
- 字段异常会变成空字符串。

### 9.4 行操作

来源：8 个列表操作扩展点。

- 渲染为链接。
- 占位符按列表类型替换。
- 不支持 POST、确认框、批量操作。
- `variant` 与 `icon` 可能被忽略。
- 危险操作请在目标页面做二次确认。

### 9.5 详情 Tab

来源：`pluginDetailTab`。

- 返回项带 `pluginSlug`。
- 前端按当前插件过滤。
- 组件静态渲染。
- 无法读取当前插件对象作为 props；需要数据时自行查询。
- 适合展示说明、状态、诊断信息。

### 9.6 安装 Tab

来源：`pluginInstallTab`。

- 显示在插件安装区域。
- 所有插件的安装 Tab 都会出现。
- 适合提供安装说明、依赖检查、外部源入口。

### 9.7 仪表盘

来源：

- `dashboardWidget`
- `dashboardQuickAction`

接口：`GET /api/console/plugin-widgets`。

返回结构大致为：

```ts
{
  widgets: { slug, title, icon, colSpan, html }[],
  actions: { slug, label, icon, href }[]
}
```

约束：

- 组件静态渲染。
- 不能使用 React 状态、事件或 effect。
- 需要交互时使用链接或原生表单。
- 定义了 `permissions` 时按当前登录用户权限过滤；未定义视为公开。
- 卡片数据查询应尽量快，避免拖慢后台首页。

### 9.8 编辑器按钮

来源：`editorCreate`。

接口：`GET /api/plugin/editor-actions`。

前端：

- Milkdown 编辑器顶部工具栏。
- 只支持插入文本与包裹选中文本。
- `shortcut` 只作为提示。
- 不能执行自定义 JS。
- 当前类型与收集器不一致，需按数组写法才能生效，见 6.7.1。

### 9.9 自定义后台页面

来源：`customAdminRoutes`。

目录约定：

```text
scripts/plugins/reading-stats/
├── index.js
└── admin.js
```

`admin.tsx` 构建为 `admin.js`，路由通过 `() => import('./admin.js')` 加载。

页面能力：

- 服务端组件。
- 可使用宿主 Tailwind 类名。
- 可读取数据库、文件、环境变量。
- 可渲染原生表单与链接。
- 不能使用客户端 hook。
- 不能依赖 hydration 后的脚本。

适合：

- 复杂报表。
- 配置向导。
- 运维面板。
- 导入导出入口。

不适合：

- 实时交互。
- 富文本编辑器。
- 拖拽排序。

### 9.10 静态渲染限制详解

后台扩展组件与前台注入组件使用：

```ts
renderToStaticMarkup(await Comp({}))
```

这意味着：

| 能力 | 是否可用 |
| --- | --- |
| `async` 组件 | 可用，宿主会 `await` |
| 读取数据库 | 可用 |
| 读取文件 | 可用 |
| `useState` | 不可用 |
| `useEffect` | 不可用 |
| `onClick` | 不可用 |
| `<form action>` 原生提交 | 可用 |
| `<a href>` 跳转 | 可用 |
| CSS 类名 | 可用 |
| 内联样式 | 可用 |
| `<script>` 标签 | 通常不会执行 |
| 客户端组件引用 | 不可用 |

如果需要交互，正确路径是：

1. 后台页面放链接到 `customAdminRoutes` 页面。
2. 自定义页面用原生表单 POST 到 `customApi`。
3. `customApi` 完成操作后 303 重定向回页面。

### 9.11 权限实践

后台扩展点已按登录用户权限过滤。推荐模式：

1. 需要限制可见性时，在扩展点定义中填写 `permissions`，并确保对应权限已通过 `plugin.json.permissions` 或角色模板写入权限表。
2. 真正的数据操作仍在 `customApi` 内校验：`auth: true` 只保证登录，不保证具体权限。
3. 公开前台注入不按权限过滤，必须在组件或目标页面自行判断。

```ts
customAdminRoutes: [
  {
    path: '',
    title: '阅读统计',
    group: '工具',
    component: () => import('./admin.js'),
  },
],
customApi: [
  {
    method: 'POST',
    path: '/reset',
    auth: true,
    async handler(req) {
      const session = await auth();
      if (!session?.user?.id || session.user.role !== 'ADMIN') {
        return Response.json({ error: '无权限' }, { status: 403 });
      }
      ctx.pluginDb.exec('DELETE FROM reading_stats');
      return Response.json({ ok: true });
    },
  },
],
```

注意：

- `auth()` 需要在 handler 内动态导入或从宿主模块导入；插件打包时不要把它当外部依赖。
- 更稳妥的方式是查询 Prisma 中的用户与角色。
- 后台页面本身只校验登录，不校验权限。

---

## 10. 模板扩展

### 10.1 构建期注册表

生成脚本：`scripts/generate-theme-registry.js`。

触发：

- `predev`
- `prebuild`
- `prestart`（如脚本存在）

输出：`lib/theme/generated-templates.ts`。

扫描范围：

| 来源 | 路径 | 注册键 |
| --- | --- | --- |
| 主题系统模板 | `scripts/themes/<theme>/templates/<name>.tsx` | `<name>` |
| 主题覆盖插件模板 | `scripts/themes/<theme>/templates/plugins/<plugin>/<name>.tsx` | `plugins/<plugin>/<name>` |
| 插件自带模板 | `scripts/plugins/<slug>/templates/<name>.tsx` | `<name>` |

生成规则：

- 只扫描直接位于目录下的 `.tsx`，不递归（插件覆盖目录例外，按插件子目录一层）。
- 模板文件名必须匹配 `^[a-z][a-z0-9-]*\.tsx$`。
- 主题与插件目录名必须匹配 `^[a-zA-Z0-9._-]+$`。
- 跳过 `.bak-<timestamp>` 与 `.deleted-<timestamp>`。
- 每个模板先做 esbuild 语法预检，语法错误则跳过并警告。
- 使用 `import * as` 静态引入。
- 生成 `themeTemplateRegistry` 与 `pluginTemplateRegistry` 两个映射。
- 内容无变化时不重写文件。

### 10.2 解析顺序

主题系统页面：

```text
resolveSystemTemplate(name)
  → 构建期注册表命中？返回
  → 运行时编译 scripts/themes/<active>/templates/<name>.tsx
  → 都没有返回 null，页面回退内置模板
```

`post` 与 `post-detail` 互为兼容候选。

插件模板：

```ts
resolvePluginTemplate(pluginSlug, templateName)
```

顺序：

1. 主题覆盖：`resolveThemeTemplate('plugins/<slug>/<name>.tsx')`
   - 注册表命中直接返回。
   - 否则运行时编译。
   - 编译失败记录日志并继续。
2. 插件自带：`resolvePluginSourceTemplate(slug, name)`
   - 插件注册表命中直接返回。
   - 否则运行时编译 `scripts/plugins/<slug>/templates/<name>.tsx`。
3. 都没有返回 `null`。

安全校验：

- 插件 slug 与模板名必须匹配 `^[a-z0-9][a-z0-9-]*$`。
- 主题模板相对路径会做根目录越界检查。
- 不满足校验直接返回 `null`。

### 10.3 `providesTemplates` 的实际状态

`providesTemplates` 只是声明：

```ts
providesTemplates: ['stats-card'],
```

宿主 `getProvidedTemplates` 会把它合并为名称列表，但当前没有页面自动遍历并渲染这些模板。

模板真正被使用时，需要主题或宿主页面显式调用：

```ts
import { resolvePluginTemplate } from '@/lib/plugin/theme-integration';

const mod = await resolvePluginTemplate('reading-stats', 'stats-card');
const Comp = mod?.default as React.ComponentType<{ stats: Stats }> | undefined;
```

因此：

- 声明不会自动产生 UI。
- 主题作者必须知道模板名与 props。
- 模板的 props 契约由调用方定义，SPI 没有统一约束。
- 没有类型检查保证模板导出的 props 与调用方一致。

### 10.4 构建期与运行时

| 维度 | 构建期注册表 | 运行时兜底 |
| --- | --- | --- |
| 触发 | dev/build 前扫描 | 请求时按需编译 |
| `@/` 别名 | 支持 | 不支持 |
| `'use client'` | 支持 | 不支持 |
| 客户端 hook | 支持 | 不支持 |
| 服务端 JSX | 支持 | 支持 |
| 依赖 Next 组件 | 支持 | 可能失败 |
| 缓存 | Next 模块缓存 | `mtime` 文件缓存 |
| 新装模板 | 需重启 dev/build | 立即生效 |
| 语法错误 | 构建期跳过 | 请求时抛错并回退 |

运行时编译流程：

1. 读取 TSX。
2. `esbuild.transform`，`loader: tsx`、`jsx: automatic`、`format: cjs`、`target: node18`。
3. 写入 `db/cache/theme-templates/<name>.<mtime>.cjs`。
4. `require` 加载。
5. 删除该临时模块的 `require.cache`。
6. 按绝对路径与 mtime 缓存。

因此运行时模板不能写：

```tsx
'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
```

这些模板只能做服务端渲染。

### 10.5 可 import 范围

构建期注册表模板：

- `@/` 别名可用。
- 宿主 `components/`、`lib/` 可用。
- `lucide-react` 等宿主依赖可用。
- 客户端组件可用，但必须正确标注 `'use client'`。
- CSS 导入按 Next 规则处理。

运行时兜底模板：

- 相对路径 import 可用。
- Node 内置模块可用。
- 已在宿主 `node_modules` 中且能被解析的包可能可用。
- `@/` 不可用。
- 客户端指令无效。
- CSS 导入通常失败，建议内联样式。

插件入口 `index.js`：

- 由插件自身 esbuild 打包。
- 只有 externals 白名单中的包保留为外部依赖。
- 其他依赖被打进产物。
- `@/` 不会解析。
- 原生 `.node` 禁止。
- CSS 导入无 loader，会构建失败。

### 10.6 插件模板契约

`packages/types/theme.ts` 定义的是主题系统模板的 Props：

| 模板名 | Props 类型 |
| --- | --- |
| `layout` | `LayoutTemplateProps` |
| `home` | `HomeTemplateProps` |
| `post-list` | `PostListTemplateProps` |
| `post` / `post-detail` | `PostDetailTemplateProps` |
| `page` | `PageTemplateProps` |
| `archive` | `ArchiveTemplateProps` |
| `categories` | `CategoriesTemplateProps` |
| `category` | `CategoryTemplateProps` |
| `tags` | `TagsTemplateProps` |
| `tag` | `TagTemplateProps` |
| `search` | `SearchTemplateProps` |
| `moments` | `MomentsTemplateProps` |
| `moment` | `MomentTemplateProps` |
| `links` | `LinksTemplateProps` |
| `gallery` | `GalleryTemplateProps` |
| `photo` | `PhotoTemplateProps` |
| `error` | `ErrorTemplateProps` |

插件自带模板没有宿主定义的 Props 映射，调用方需要自行约定。

建议：

```ts
export interface StatsCardProps {
  total: number;
  minutes: number;
}

export default function StatsCard({ total, minutes }: StatsCardProps) {
  return (
    <div className="rounded border border-line p-4">
      <div className="text-sm text-fg-muted">阅读统计</div>
      <div className="text-2xl font-semibold">{total}</div>
      <div className="text-xs text-fg-muted">累计 {minutes} 分钟</div>
    </div>
  );
}
```

主题覆盖文件：

```text
scripts/themes/default/templates/plugins/reading-stats/stats-card.tsx
```

覆盖文件优先于插件自带模板。

### 10.7 示例：主题渲染插件模板

```tsx
// scripts/themes/default/templates/home.tsx
import { resolvePluginTemplate } from '@/lib/plugin/theme-integration';
import type { HomeTemplateProps } from '@/lib/theme/templates';

export default async function Home({ posts, total, slots }: HomeTemplateProps) {
  const mod = await resolvePluginTemplate('reading-stats', 'stats-card');
  const StatsCard = mod?.default as React.ComponentType<{ total: number; minutes: number }> | undefined;

  return (
    <div className="space-y-6">
      {StatsCard ? <StatsCard total={total} minutes={0} /> : null}
      {slots.posts}
    </div>
  );
}
```

注意：

- 这是异步服务端组件。
- `resolvePluginTemplate` 返回模块对象，需要取 `default`。
- 模板缺失时返回 `null`。
- 主题覆盖存在但编译失败时，会回退插件自带模板。

### 10.8 模板编译失败排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 注册表没有条目 | 文件名不以小写字母开头、扩展名不是 `.tsx`、语法错误 | 改名、修复语法、重启 dev/build |
| 构建通过但页面空白 | `default` 导出缺失 | 添加默认导出 |
| 新装模板 `@/` 报错 | 未重启，走运行时兜底 | 重启 dev 或重新 build |
| `useState` 报错 | 运行时兜底不支持客户端组件 | 重启或移除 hook |
| 覆盖模板不生效 | 主题未激活、键名不匹配 | 检查主题 slug 与 `templates/plugins/<plugin>/<name>.tsx` |
| 模板加载后旧内容 | mtime 缓存未变 | 修改文件或删除 `db/cache/theme-templates` |
| 运行时编译报错 | JSX 语法、CSS import、路径别名 | 改用相对导入与内联样式 |

---

## 11. 通知与邮件

### 11.1 接口

```ts
interface PluginNotifier {
  name: string;
  send: (message: PluginNotification) => Promise<{ ok: boolean; error?: string; messageId?: string }>;
}

interface PluginNotification {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  scene?: string;
}
```

宿主入口：`lib/mailer.ts` 的 `sendMail(to, opts)`。

### 11.2 场景值

类型注释定义：

| `scene` | 含义 |
| --- | --- |
| `comment-approve` | 评论通过通知 |
| `comment-pending` | 新评论待审核通知 |
| `email-code` | 邮箱验证码 |
| `password-reset` | 密码重置 |
| `test` | 测试邮件 |

当前仓库的内置封装 `mailScenes` 没有给 `sendMail` 传 `scene`，因此 notifier 收到的 `message.scene` 是 `undefined`。

插件应按以下策略处理：

1. 有 `scene` 时精确路由。
2. 没有 `scene` 时按 `subject` 前缀匹配。
3. 都不匹配时使用通用通道。

### 11.3 SMTP 回退

`sendMail` 流程：

1. 动态导入 `getPluginNotifier`。
2. 有 notifier 则调用 `send({ to, ...opts })`。
3. `ok === true` 时返回 `{ ok: true, messageId }`。
4. `ok === false` 时继续。
5. notifier 抛错时捕获并继续。
6. 没有 notifier 或 notifier 失败时，使用 nodemailer。
7. SMTP 配置来自 `SiteSetting`：
   - `smtpHost`
   - `smtpPort`，默认 587
   - `smtpUser`
   - `smtpPass`
   - `smtpFrom`
   - `email`
8. 没有 `smtpHost` 时抛错并返回 `{ ok: false }`。

关键点：

- 只尝试第一个 notifier。
- 第一个 notifier 失败不会尝试第二个。
- 回退 SMTP 不会记录 notifier 的失败原因。
- 返回值只有 `ok`、`messageId` 或 `error`，没有通道标识。

### 11.4 示例：按场景分流

```ts
notifier: {
  name: 'scene-router',
  async send(message) {
    const scene = message.scene ?? inferScene(message.subject);
    if (scene === 'comment-pending') {
      return postToWebhook('https://hook.example.com/comment', message);
    }
    if (scene === 'email-code') {
      return postToWebhook('https://hook.example.com/code', message);
    }
    return { ok: false, error: '不处理的场景' };
  },
},

function inferScene(subject: string) {
  if (subject.includes('待审核')) return 'comment-pending';
  if (subject.includes('验证码')) return 'email-code';
  return 'unknown';
}
```

### 11.5 邮件内容安全

- `html` 由宿主或插件拼接，可能包含用户输入。
- 评论内容、文章标题等需要 HTML 转义。
- notifier 会把完整邮件内容发往外部服务，注意隐私。
- 不要在日志中打印验证码、重置链接或收件人完整地址。
- 失败信息不要包含凭据。

---

## 12. 调试与测试

### 12.1 日志

插件日志前缀：

```text
[Plugin:<slug>]
```

使用：

```ts
ctx.logger.info('loaded', ctx.version);
ctx.logger.warn('config missing');
ctx.logger.error('failed', err);
```

宿主其他相关前缀：

| 前缀 | 来源 |
| --- | --- |
| `[Plugin]` | 扩展点执行与渲染错误 |
| `[plugin/api-gate]` | API 中间件失败 |
| `[Plugin-DB]` | 插件数据库关闭 |
| `[theme-registry]` | 模板注册表生成 |
| `[Theme]` | 主题模板覆盖失败 |
| `[Mailer]` | 邮件发送 |
| `[ext-installer]` | 安装器 |

建议日志包含：

- 插件 slug。
- 操作名。
- 关键参数（脱敏）。
- 错误对象。
- 耗时（必要时）。

### 12.2 常见错误

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| 插件列表有但功能全无 | 默认导出不是函数 | 检查 `export default` |
| 加载日志正常但扩展点不执行 | 扩展点键名拼错 | 对照 `ExtensionHandlers` |
| 入口不存在 | `entry` 与产物不匹配 | 检查 `index.js` |
| 插件未加载 | `isActive=false` | 后台启用 |
| 新装插件未加载 | 上传后默认停用 | 后台启用 |
| 手工复制目录未生效 | 目录名与 slug 不一致 | 保持同名 |
| 修改代码不生效 | `require` 缓存 | 重启或 dev 安装 |
| 重新启用仍是旧代码 | 启用不清 `require` 缓存 | 重启或 dev 安装 |
| 配置不更新 | 保存失败或缓存未重置 | 检查 PUT 响应；重启 |
| 上传被拒绝 | 文件名后缀不对 | 使用 `slug.zip.rainy-plugin` |
| 上传被拒绝 | `specVersion` 不是 `1.0` | 改为 `1.0` 或删除 |
| 上传被拒绝 | `requiresCore` 不满足当前核心 | 放宽版本范围或升级宿主 |
| 上传被拒绝 | 覆盖 `native: true` 的内置插件 | 换 slug，内置插件不允许替换 |
| 插件被跳过且日志有警告 | `requiresCore` 不满足当前核心 | 放宽版本范围或升级宿主 |
| 插件列表项带 `loadError` | `requiresCore` 不满足 | 同上 |
| 升级被拒绝 | 版本不大于旧版本 | 提升 `version` |
| 卸载返回 403 | 内置插件或 `native: true` 禁止卸载 | 只能停用 |
| 迁移失败 | SQL 语法错误、文件缺失 | 查看日志；修复后重新安装 |
| `SQLITE_BUSY` | 长事务或外部占用 | 减少事务、关闭其他连接 |
| JSON 数据丢失 | 文件损坏 | 检查文件；`get` 会回退 `{}` |
| 模板不生效 | 未重启注册表 | 重启 dev/build |
| 模板 `@/` 报错 | 运行时兜底 | 重启 |
| `use client` 无效 | 运行时兜底 | 重启 |
| 模板空白 | 缺少 `default` | 添加默认导出 |
| 后台页面 404 | 路径带前导 `/` | 去掉前导 `/` |
| 后台菜单不显示 | 插件未启用或路由数组缺失 | 检查启用状态 |
| 后台页面空白 | 组件抛错 | 查看服务端日志 |
| 列表字段空白 | `render` 抛错或返回 `null` | 修复 render |
| 行操作不显示 | `replyListItemOperation` 未接入 | 改用评论操作 |
| customApi 404 | 路径或方法不匹配 | 对照 8.2 |
| customApi 401 | `auth` 要求登录 | 登录或改 `auth: false` |
| 中间件不拦截 | 返回 204 或路由未覆盖 | 检查 8.5、8.7 |
| 邮件未走 notifier | notifier 返回 `ok:false` | 返回 `ok:true` |
| 邮件静默走 SMTP | notifier 抛错 | 查看日志并修复 |
| 仪表盘卡片不显示 | 组件渲染失败 | 查看 `[Plugin]` 日志 |

### 12.3 版本不匹配

| 场景 | 表现 | 处理 |
| --- | --- | --- |
| 类型包版本低于宿主 | 编译报缺字段 | 升级 `@rainynest/plugin-types` |
| `specVersion` 为旧版本号 | 上传被拒 | 改为 `1.0` |
| `requiresCore` 不满足 | 安装返回 400；已装插件加载时跳过并在列表带 `loadError` | 放宽版本范围或升级宿主 |
| 宿主升级后扩展点变化 | 类型报错或运行无效果 | 重新构建并对照文档 |
| 插件依赖新宿主 API | 运行时报 `undefined` | 做能力检测与降级 |

能力检测示例：

```ts
const handlers: ExtensionHandlers = {
  // ...
};
```

### 12.4 默认导出缺失

宿主逻辑：

```ts
const factory = typeof mod.default === 'function' ? mod.default : null;
const handlers = factory ? await factory(ctx) : {};
```

后果：

- 插件出现在列表。
- 加载日志正常。
- 没有任何扩展点生效。
- 不会报错。

排查：

```js
// index.js
console.log(typeof module.exports.default);
```

### 12.5 模板编译失败

检查顺序：

1. 文件名是否匹配 `^[a-z][a-z0-9-]*\.tsx$`。
2. 是否只有一个默认导出组件。
3. 是否使用了运行时兜底不支持的 `@/` 或 `'use client'`。
4. 是否导入了 CSS。
5. 是否有 JSX 语法错误。
6. 是否重启 dev/build。
7. 是否为主题覆盖路径拼错。
8. 是否被语法预检跳过。

### 12.6 联调流程

推荐：

1. 本地主项目启动。
2. `.env` 配置 `EXT_DEV_TOKEN`。
3. 插件目录执行 `npm run dev`。
4. 修改源码，观察 CLI 上传日志。
5. 打开前台/后台验证。
6. 修改模板后重启主项目，验证注册表行为。
7. 修改 `plugin.json` 后重新 dev 安装。
8. 最终 `npm run build` 与 `npm run pack`。
9. 在干净环境上传安装包验证。

### 12.7 测试清单

| 项 | 检查 |
| --- | --- |
| 启用 | 新装默认停用，启用后生效 |
| 停用 | 停用后扩展点全部消失 |
| 配置 | 修改后保存并刷新页面 |
| 默认配置 | 删除配置文件后重启恢复包内默认 |
| 数据 | 重启后 SQLite 数据仍在 |
| 迁移 | 新环境安装能建表 |
| 权限 | 未登录访问受保护接口返回 401 |
| 空数据 | 数据库为空时组件不崩 |
| 异常 | 外部服务不可用时页面仍可打开 |
| 卸载 | 保留/删除数据行为符合预期 |
| 模板 | 新装未重启与重启后行为 |
| 响应式 | 前台块在移动端不溢出 |

---

## 13. 完整实战：阅读统计插件

本示例实现一个包含 14 个扩展点的插件，覆盖生命周期、内容、前台 UI、API、后台 UI、模板声明。

### 13.1 功能设计

| 功能 | 扩展点 |
| --- | --- |
| 建表与初始化 | `onMount` |
| 保存文章时计算阅读时长 | `afterSavePost` |
| 删除文章时清理统计 | `beforeDeletePost` |
| 统计文章访问 | `onPageView` |
| 注入进度条样式 | `injectHead` |
| 注入页脚说明 | `injectFooter` |
| 文章末尾显示阅读提示 | `injectPostContent` |
| 侧栏热门文章 | `injectSidebarWidget` |
| 给文章 API 加响应头 | `apiMiddleware` |
| 提供热门列表 API | `customApi` |
| 仪表盘统计卡片 | `dashboardWidget` |
| 文章列表显示阅读时长 | `postListItemField` |
| 提供后台统计页面 | `customAdminRoutes` |
| 声明可覆盖模板 | `providesTemplates` |

### 13.2 目录结构

```text
reading-stats/
├── plugin.json
├── config.json
├── package.json
├── tsconfig.json
├── migrations/
│   └── 001_init.sql
└── src/
    ├── index.ts
    ├── admin.tsx
    └── templates/
        └── stats-card.tsx
```

### 13.3 `plugin.json`

```json
{
  "slug": "reading-stats",
  "name": "阅读统计",
  "version": "1.0.0",
  "description": "统计文章阅读时长、热门文章与访问量",
  "author": "RainyNest",
  "entry": "index.ts",
  "specVersion": "1.0",
  "requiresCore": ">=1.0.0",
  "native": false,
  "permissions": [
    { "name": "plugin:reading-stats:view", "displayName": "查看阅读统计", "group": "插件" }
  ],
  "roleTemplates": [
    {
      "name": "reading-stats-viewer",
      "displayName": "阅读统计查看者",
      "description": "可以查看阅读统计页面",
      "dependsOn": [],
      "permissions": ["plugin:reading-stats:view"]
    }
  ],
  "database": {
    "enabled": true,
    "migrations": [
      {
        "version": "001",
        "description": "初始化阅读统计表",
        "file": "migrations/001_init.sql"
      }
    ]
  },
  "configSchema": {
    "basic": {
      "label": "基础设置",
      "fields": {
        "enabled": { "type": "switch", "label": "启用统计", "default": true },
        "wordsPerMinute": {
          "type": "number",
          "label": "每分钟阅读字数",
          "default": 300,
          "min": 100,
          "max": 1000,
          "step": 50
        },
        "footerText": {
          "type": "text",
          "label": "页脚提示",
          "default": "阅读统计由 RainyNest 提供"
        },
        "showSidebar": { "type": "switch", "label": "显示侧栏热门文章", "default": true }
      }
    }
  }
}
```

### 13.4 `config.json`

```json
{
  "enabled": true,
  "wordsPerMinute": 300,
  "footerText": "阅读统计由 RainyNest 提供",
  "showSidebar": true
}
```

### 13.5 `migrations/001_init.sql`

```sql
CREATE TABLE IF NOT EXISTS reading_stats (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 1,
  views INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS page_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  session_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_page_views_path ON page_views(path);
```

### 13.6 `src/index.ts`

```ts
import React from 'react';
import type { ExtensionHandlers, PluginContext } from '@rainynest/plugin-types';

export default function createPlugin(ctx: PluginContext): ExtensionHandlers {
  const enabled = () => Boolean(ctx.config.enabled);
  const wordsPerMinute = () => {
    const n = Number(ctx.config.wordsPerMinute ?? 300);
    return Number.isFinite(n) && n > 0 ? n : 300;
  };

  function ensureTables() {
    ctx.pluginDb.exec(`
      CREATE TABLE IF NOT EXISTS reading_stats (
        slug TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        minutes INTEGER NOT NULL DEFAULT 1,
        views INTEGER NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_reading_stats_views ON reading_stats(views DESC);
      CREATE TABLE IF NOT EXISTS page_views (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        session_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_page_views_path ON page_views(path);
    `);
  }

  function topPosts(limit: number) {
    return ctx.pluginDb
      .prepare('SELECT slug, title, views, minutes FROM reading_stats ORDER BY views DESC LIMIT ?')
      .all(limit) as { slug: string; title: string; views: number; minutes: number }[];
  }

  return {
    // 1. 启动钩子
    onMount(mountCtx) {
      ensureTables();
      mountCtx.logger.info('reading-stats ready', {
        version: mountCtx.version,
        enabled: enabled(),
      });
    },

    // 2. 保存文章后写入统计
    async afterSavePost(post) {
      if (!enabled()) return;
      const words = Number(post.words ?? 0);
      const minutes = Math.max(1, Math.ceil(words / wordsPerMinute()));
      ctx.pluginDb
        .prepare(`
          INSERT INTO reading_stats (slug, title, minutes, views)
          VALUES (?, ?, ?, 0)
          ON CONFLICT(slug) DO UPDATE SET
            title = excluded.title,
            minutes = excluded.minutes,
            updated_at = CURRENT_TIMESTAMP
        `)
        .run(String(post.slug), String(post.title ?? ''), minutes);
    },

    // 3. 删除文章前清理
    async beforeDeletePost(postId) {
      const post = await ctx.db.post.findUnique({
        where: { id: postId },
        select: { slug: true },
      });
      if (post?.slug) {
        ctx.pluginDb.prepare('DELETE FROM reading_stats WHERE slug = ?').run(post.slug);
      }
    },

    // 4. 访问统计
    async onPageView({ path, sessionId }) {
      if (!enabled()) return;
      const match = /^\/blog\/([^/?#]+)/.exec(path);
      ctx.pluginDb
        .prepare('INSERT INTO page_views (path, session_id) VALUES (?, ?)')
        .run(path, sessionId ?? null);
      if (match) {
        ctx.pluginDb
          .prepare('UPDATE reading_stats SET views = views + 1 WHERE slug = ?')
          .run(decodeURIComponent(match[1]));
      }
    },

    // 5. 注入页头样式
    injectHead() {
      if (!enabled()) return [];
      return [
        `<style>
          .reading-stats-badge{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:#6b7280}
          .reading-stats-card{border:1px solid #e5e7eb;border-radius:8px;padding:12px}
        </style>`,
      ];
    },

    // 6. 注入页脚
    injectFooter() {
      const text = String(ctx.config.footerText ?? '');
      if (!text) return [];
      return [`<div class="py-6 text-center text-xs text-gray-500">${text}</div>`];
    },

    // 7. 文章文末块
    injectPostContent() {
      if (!enabled()) return [];
      return [
        function ReadingHint() {
          return React.createElement(
            'div',
            { className: 'reading-stats-card mt-8 text-sm text-gray-600' },
            '阅读时长按每分钟 ',
            wordsPerMinute(),
            ' 字估算。'
          );
        },
      ];
    },

    // 8. 侧栏热门文章
    injectSidebarWidget() {
      if (!enabled() || !ctx.config.showSidebar) return [];
      return [
        {
          title: '热门文章',
          order: 20,
          component: function TopPostsWidget() {
            const list = topPosts(5);
            if (list.length === 0) {
              return React.createElement('p', { className: 'text-sm text-gray-500' }, '暂无数据');
            }
            return React.createElement(
              'ul',
              { className: 'space-y-2 text-sm' },
              list.map((item) =>
                React.createElement(
                  'li',
                  { key: item.slug, className: 'flex items-center justify-between gap-2' },
                  React.createElement(
                    'a',
                    { href: `/blog/${item.slug}`, className: 'truncate hover:text-primary' },
                    item.title
                  ),
                  React.createElement(
                    'span',
                    { className: 'shrink-0 text-xs text-gray-400' },
                    `${item.views} 次`
                  )
                )
              )
            );
          },
        },
      ];
    },

    // 9. API 中间件
    apiMiddleware: [
      {
        path: '/api/posts',
        methods: ['GET'],
        async handler(_req, next) {
          const res = await next();
          res.headers.set('x-reading-stats', '1');
          return res;
        },
      },
    ],

    // 10. 自定义 API
    customApi: [
      {
        method: 'GET',
        path: '/top',
        auth: false,
        async handler(req) {
          const url = new URL(req.url);
          const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 8), 1), 20);
          return Response.json({ list: topPosts(limit) });
        },
      },
      {
        method: 'DELETE',
        path: '/reset',
        auth: true,
        async handler() {
          ctx.pluginDb.exec('DELETE FROM reading_stats; DELETE FROM page_views;');
          return Response.json({ ok: true });
        },
      },
    ],

    // 11. 仪表盘卡片
    dashboardWidget: [
      {
        title: '阅读统计',
        icon: 'book-open',
        colSpan: 2,
        component: function ReadingDashboardCard() {
          const row = ctx.pluginDb
            .prepare('SELECT COUNT(*) AS total, COALESCE(SUM(views),0) AS views, COALESCE(SUM(minutes),0) AS minutes FROM reading_stats')
            .get() as { total: number; views: number; minutes: number };
          return React.createElement(
            'div',
            { className: 'grid grid-cols-3 gap-4 text-center' },
            React.createElement('div', null, React.createElement('div', { className: 'text-2xl font-semibold' }, row.total), React.createElement('div', { className: 'text-xs text-gray-500' }, '文章')),
            React.createElement('div', null, React.createElement('div', { className: 'text-2xl font-semibold' }, row.views), React.createElement('div', { className: 'text-xs text-gray-500' }, '阅读')),
            React.createElement('div', null, React.createElement('div', { className: 'text-2xl font-semibold' }, row.minutes), React.createElement('div', { className: 'text-xs text-gray-500' }, '分钟'))
          );
        },
      },
    ],

    // 12. 文章列表字段
    postListItemField: [
      {
        key: 'reading_minutes',
        label: '阅读时长',
        render: (post) => {
          const row = ctx.pluginDb
            .prepare('SELECT minutes FROM reading_stats WHERE slug = ?')
            .get(String(post.slug)) as { minutes?: number } | undefined;
          return row?.minutes ? `${row.minutes} 分钟` : '-';
        },
      },
    ],

    // 13. 后台页面
    customAdminRoutes: [
      {
        path: '',
        title: '阅读统计',
        group: '工具',
        component: () => import('./admin.js'),
      },
    ],

    // 14. 模板声明
    providesTemplates: ['stats-card'],
  };
}
```

### 13.7 `src/admin.tsx`

```tsx
export default async function ReadingStatsAdmin() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold">阅读统计</h1>
        <p className="text-sm text-fg-muted">
          数据来自插件独立 SQLite，保存文章后自动更新。
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded border border-line p-4">
          <div className="text-sm font-medium">热门列表接口</div>
          <code className="mt-2 block text-xs text-fg-muted">
            GET /api/plugin/reading-stats/top?limit=8
          </code>
        </div>
        <div className="rounded border border-line p-4">
          <div className="text-sm font-medium">模板覆盖路径</div>
          <code className="mt-2 block text-xs text-fg-muted">
            scripts/themes/default/templates/plugins/reading-stats/stats-card.tsx
          </code>
        </div>
      </section>

      <form action="/api/plugin/reading-stats/reset" method="post">
        <button
          type="submit"
          className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-50 active:scale-95"
        >
          清空统计数据
        </button>
      </form>

      <a className="inline-block text-sm text-primary" href="/console/system/plugins">
        返回插件列表
      </a>
    </div>
  );
}
```

注意：

- 该表单使用 POST，而示例 `customApi` 声明的是 DELETE，浏览器原生表单无法发送 DELETE。实际项目中应增加一个 POST 路由，或改为 GET 并加二次确认。
- 后台页面是静态渲染，表单提交后会离开当前页。

### 13.8 `src/templates/stats-card.tsx`

```tsx
export interface StatsCardProps {
  total: number;
  views: number;
  minutes: number;
}

export default function StatsCard({ total, views, minutes }: StatsCardProps) {
  return (
    <div className="reading-stats-card">
      <div className="text-sm text-fg-muted">阅读统计</div>
      <div className="mt-2 grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-xl font-semibold">{total}</div>
          <div className="text-xs text-fg-muted">文章</div>
        </div>
        <div>
          <div className="text-xl font-semibold">{views}</div>
          <div className="text-xs text-fg-muted">阅读</div>
        </div>
        <div>
          <div className="text-xl font-semibold">{minutes}</div>
          <div className="text-xs text-fg-muted">分钟</div>
        </div>
      </div>
    </div>
  );
}
```

### 13.9 逐段说明

`onMount`：

- 使用 `CREATE TABLE IF NOT EXISTS`，因为 `bootPlugins` 可能重复调用。
- 与迁移文件重复是故意的，用于兜底手工安装。

`afterSavePost`：

- 用 `ON CONFLICT` 实现幂等 upsert。
- 阅读时长按配置计算，最少 1 分钟。
- 不阻塞保存失败。

`beforeDeletePost`：

- 先查 slug，再删统计。
- 查不到时静默跳过。

`onPageView`：

- 记录所有路径。
- 仅 `/blog/<slug>` 增加文章阅读数。
- 量很大时应改为批量写或异步队列。

`injectHead`：

- 只注入 `style`，会进入 `<head>`。
- 不使用用户输入。

`injectFooter`：

- 读取配置中的固定文案。
- 配置值直接拼接 HTML，生产环境应转义。

`injectPostContent`：

- 返回组件，宿主静态渲染后插入文章底部。
- 组件不依赖 props。

`injectSidebarWidget`：

- 同步查询插件库，避免异步组件类型问题。
- 按 `views` 排序。
- `order` 控制侧栏位置。

`apiMiddleware`：

- 只接 `/api/posts` 的 GET。
- 通过 `next()` 放行并追加响应头。
- 如果头不可写，应复制响应。

`customApi`：

- `/top` 公开，供主题或侧栏使用。
- `/reset` 要求登录，但未做角色校验，生产环境应补充。

`dashboardWidget`：

- 静态渲染。
- 查询三个聚合值。
- `colSpan: 2` 占两列。

`postListItemField`：

- 每行查询一次 SQLite，文章多时有 N+1 问题。
- 生产环境应一次查询后在内存映射。

`customAdminRoutes`：

- 路径为空，访问 `/console/plugin-ext/reading-stats`。
- 分组为“工具”。
- 动态导入 `admin.js`。

`providesTemplates`：

- 声明 `stats-card`。
- 需要主题显式解析才会显示。

### 13.10 构建与验证

```bash
npm install
npm run build
npm run pack
```

验证：

1. 后台上传 `reading-stats.zip.rainy-plugin`。
2. 启用插件。
3. 打开设置，确认四个配置项。
4. 新建或更新一篇文章。
5. 打开文章详情，确认文末块与页脚。
6. 刷新几次，确认侧栏热门文章的阅读数增加。
7. 打开后台仪表盘，确认卡片。
8. 打开文章列表，确认阅读时长字段。
9. 打开 `/console/plugin-ext/reading-stats`。
10. 请求 `/api/plugin/reading-stats/top`。
11. 检查 `/api/posts` 响应头 `x-reading-stats`。
12. 删除文章，确认统计被清理。
13. 停用插件，确认所有块消失。
14. 卸载并保留数据，重新安装后确认数据仍在。

---

## 14. 附录

### 14.1 扩展点速查表

| 序号 | 扩展点 | 形态 | 生效范围 | 宿主位置 |
| --- | --- | --- | --- | --- |
| 1 | `onMount` | 函数 | 加载 | `engine.ts` `bootPlugins` |
| 2 | `beforeSavePost` | 函数 | 文章创建/更新 | `app/api/posts/route.ts`、`[id]/route.ts` |
| 3 | `beforeCommentApprove` | 函数 | 评论创建 | `app/api/comments/route.ts` |
| 4 | `afterSavePost` | 函数 | 文章创建/更新 | 同上 |
| 5 | `beforeDeletePost` | 函数 | 文章删除 | `app/api/posts/[id]/route.ts` |
| 6 | `onGenerateMetadata` | 函数 | 文章页元数据 | `app/(site)/blog/[slug]/page.tsx` |
| 7 | `onRenderMarkdown` | 函数 | 正文渲染 | `lib/markdown/processor.ts` |
| 8 | `excerptGenerator` | 函数 | 保存文章 | 文章接口 |
| 9 | `injectHead` | 函数 | 全站 head | `components/layout/PluginHead.tsx` |
| 10 | `injectFooter` | 函数 | 全站页脚 | `app/(site)/layout.tsx` |
| 11 | `onPageView` | 函数 | 访问统计 | `app/api/analytics/pv/route.ts` |
| 12 | `searchProvider` | 对象 | 搜索 | `lib/search/default-provider.ts` |
| 13 | `apiMiddleware` | 数组 | 8 个核心 API | `lib/plugin/api-gate.ts` |
| 14 | `attachmentStorage` | 对象 | 图片上传 | `app/api/upload/route.ts` |
| 15 | `notifier` | 对象 | 邮件 | `lib/mailer.ts` |
| 16 | `providesTemplates` | 数组 | 模板声明 | `engine.ts` `getProvidedTemplates` |
| 17 | `injectSidebarWidget` | 函数 | 前台侧栏 | `components/layout/Sidebar.tsx` |
| 18 | `injectHeaderAction` | 函数/数组 | 前台顶栏 | `components/layout/Header.tsx` |
| 19 | `injectPostContent` | 函数 | 文章底部 | `app/(site)/blog/[slug]/page.tsx` |
| 20 | `injectSinglePageContent` | 函数 | 独立页面底部 | `app/(site)/pages/[slug]/page.tsx` |
| 21 | `injectCommentWidget` | 函数 | 评论区替换 | 文章详情页 |
| 22 | `injectCommentField` | 函数/数组 | 评论表单 | `CommentForm.tsx` |
| 23 | `dashboardWidget` | 数组 | 后台仪表盘 | `/api/console/plugin-widgets` |
| 24 | `dashboardQuickAction` | 数组 | 后台仪表盘 | 同上 |
| 25 | `postListItemOperation` | 数组 | 文章列表 | `/api/posts` |
| 26 | `pageListItemOperation` | 数组 | 页面列表 | `/api/pages` |
| 27 | `commentListItemOperation` | 数组 | 评论列表 | `/api/comments` |
| 28 | `replyListItemOperation` | 数组 | 回复列表（未渲染） | `/api/comments` |
| 29 | `pluginListItemOperation` | 数组 | 插件列表 | `/api/console/plugins` |
| 30 | `themeListItemOperation` | 数组 | 主题列表 | `/api/console/themes` |
| 31 | `attachmentListItemOperation` | 数组 | 附件列表 | `/api/console/attachments` |
| 32 | `backupListItemOperation` | 数组 | 备份列表 | `/api/console/backup` |
| 33 | `postListItemField` | 数组 | 文章列表 | `/api/posts` |
| 34 | `pageListItemField` | 数组 | 页面列表 | `/api/pages` |
| 35 | `pluginListItemField` | 数组 | 插件列表 | `/api/console/plugins` |
| 36 | `pluginDetailTab` | 数组 | 插件详情 | `/api/console/plugins` |
| 37 | `themeListTab` | 数组 | 主题列表 | `/api/console/themes` |
| 38 | `attachmentSelectorTab` | 数组 | 附件选择器 | `/api/console/attachments` |
| 39 | `pluginInstallTab` | 数组 | 插件安装 | `/api/console/plugins` |
| 40 | `backupTab` | 数组 | 备份页 | `/api/console/backup` |
| 41 | `userDetailTab` | 数组 | 用户详情 | `/api/console/users` |
| 42 | `editorCreate` | 函数/数组 | 编辑器 | `/api/plugin/editor-actions` |
| 43 | `commentEditorReplace` | 函数 | 评论区（已接入） | `ui.ts` |
| 44 | `commentListItemContentReplace` | 函数 | 评论列表（已接入） | `ui.ts` |
| 45 | `commentSubjectRef` | 函数/数组 | 评论来源 | `/api/comments` |
| 46 | `customAdminRoutes` | 数组 | 后台页面 | `app/console/plugin-ext` |
| 47 | `customFrontendRoutes` | 数组 | 前台页面 | `app/(site)/p/[...path]` |
| 48 | `customApi` | 数组 | 自定义 API | `app/api/plugin/[...path]` |

### 14.2 类型速查

```ts
import type {
  PluginContext,
  ExtensionHandlers,
  PluginMeta,
  PluginLogger,
  PluginDatabase,
  PluginJsonStore,
  HostPrismaClient,
  HostSiteSetting,
  SearchProvider,
  SearchResult,
  AttachmentStorageProvider,
  AttachmentUploadInput,
  AttachmentStorageResult,
  PluginNotifier,
  PluginNotification,
  ApiMiddlewareDef,
  CustomApiRouteDef,
  SidebarWidgetDef,
  HeaderActionDef,
  DashboardWidgetDef,
  QuickActionDef,
  ListItemOperationDef,
  ListItemFieldDef,
  TabDef,
  EditorActionDef,
  CommentFieldDef,
  CommentSubjectRefDef,
  AdminRouteDef,
  FrontendRouteDef,
  MetadataPatchInput,
  BeforeSavePostMeta,
} from '@rainynest/plugin-types';
```

| 类型 | 关键字段 |
| --- | --- |
| `PluginContext` | `db`、`analytics`、`pluginDb`、`pluginJson`、`slug`、`version`、`config`、`site`、`env`、`logger`、`emitEvent` |
| `PluginMeta` | `slug`、`name`、`version`、`entry`、`permissions`、`roleTemplates`、`database`、`configSchema`、`specVersion`、`requiresCore`、`native` |
| `SearchProvider` | `name`、`builtIn?`、`search` |
| `AttachmentStorageProvider` | `name`、`upload`、`delete?` |
| `PluginNotifier` | `name`、`send` |
| `CustomApiRouteDef` | `method`、`path`、`handler`、`auth` |
| `ApiMiddlewareDef` | `path?`、`methods?`、`handler` |
| `SidebarWidgetDef` | `title?`、`component`、`order?` |
| `HeaderActionDef` | `key`、`label`、`icon?`、`href?`、`order?`、`permissions?` |
| `DashboardWidgetDef` | `title`、`icon?`、`component`、`permissions?`、`colSpan?` |
| `QuickActionDef` | `label`、`icon?`、`href`、`permissions?` |
| `ListItemOperationDef` | `label`、`icon?`、`variant?`、`onClick?`、`permissions?` |
| `ListItemFieldDef` | `key`、`label`、`width?`、`sortable?`、`render` |
| `TabDef` | `key`、`label`、`icon?`、`permissions?`、`component` |
| `EditorActionDef` | `key`、`label`、`icon?`、`insert?`、`wrap?`、`shortcut?`、`permissions?` |
| `CommentFieldDef` | `key`、`label`、`type?`、`required?`、`placeholder?`、`options?`、`defaultValue?` |
| `CommentSubjectRefDef` | `key`、`label`、`href`、`icon?` |
| `AdminRouteDef` | `path`、`title`、`icon?`、`group?`、`hideSidebar?`、`component` |
| `FrontendRouteDef` | `path`、`title`、`component`、`ssr?` |

### 14.3 宿主调用位置速查

| 文件 | 函数/导出 | 相关扩展点 |
| --- | --- | --- |
| `lib/plugin/engine.ts` | `bootPlugins` | `onMount`、所有加载 |
| `lib/plugin/engine.ts` | `fireExtensionPoint` | 函数型扩展点 |
| `lib/plugin/engine.ts` | `collectPluginDefinitions` | 数组型扩展点 |
| `lib/plugin/engine.ts` | `getPluginSidebarWidgets` | `injectSidebarWidget` |
| `lib/plugin/engine.ts` | `getPluginSearchProvider` | `searchProvider` |
| `lib/plugin/engine.ts` | `getAttachmentStorageProvider` | `attachmentStorage` |
| `lib/plugin/engine.ts` | `getPluginNotifier` | `notifier` |
| `lib/plugin/engine.ts` | `getProvidedTemplates` | `providesTemplates` |
| `lib/plugin/engine.ts` | `getPluginFrontendRoutes` | `customFrontendRoutes` |
| `lib/plugin/engine.ts` | `runApiMiddlewares` | `apiMiddleware` |
| `lib/plugin/ui.ts` | `collectInjectFooter` | `injectFooter` |
| `lib/plugin/ui.ts` | `collectPostContentHtml` | `injectPostContent` |
| `lib/plugin/ui.ts` | `collectSinglePageContentHtml` | `injectSinglePageContent` |
| `lib/plugin/ui.ts` | `getCommentWidgetHtml` | `injectCommentWidget` |
| `lib/plugin/ui.ts` | `collectCommentFields` | `injectCommentField` |
| `lib/plugin/ui.ts` | `collectHeaderActions` | `injectHeaderAction` |
| `lib/plugin/ui.ts` | `collectDashboardWidgets` | `dashboardWidget` |
| `lib/plugin/ui.ts` | `collectQuickActions` | `dashboardQuickAction` |
| `lib/plugin/ui.ts` | `collectListOperations` | 8 个列表操作 |
| `lib/plugin/ui.ts` | `collectListFields` | 3 个列表字段 |
| `lib/plugin/ui.ts` | `collectTabs` | 6 个 Tab |
| `lib/plugin/ui.ts` | `collectEditorActions` | `editorCreate` |
| `lib/plugin/ui.ts` | `getCommentEditorHtml` | `commentEditorReplace` |
| `lib/plugin/ui.ts` | `getCommentContentRendererHtml` | `commentListItemContentReplace` |
| `lib/plugin/ui.ts` | `collectCommentSubjectRefs` | `commentSubjectRef` |
| `lib/plugin/admin.ts` | `getPluginNavItems` | `customAdminRoutes` |
| `lib/plugin/api-gate.ts` | `pluginApiGate` | `apiMiddleware` |
| `lib/mailer.ts` | `sendMail` | `notifier` |
| `lib/plugin/theme-integration.ts` | `resolvePluginTemplate` | 插件模板 |
| `lib/theme/templates.ts` | `resolveThemeTemplate` | 主题模板 |
| `lib/theme/templates.ts` | `resolvePluginSourceTemplate` | 插件模板 |
| `scripts/generate-theme-registry.js` | 生成脚本 | 模板注册表 |

### 14.4 已知限制与实现不一致

以下为阅读当前代码确认的问题，编写插件时需要规避：

1. ~~**`specVersion` 规则冲突**~~（已修复）
   - 脚手架、CLI 与示例统一生成 `"1.0"`。
   - CLI 缺省补 `1.0`，仅支持 `1.0`。
   - 上传安装器只接受 `"1.0"`。

2. ~~**`requiresCore` 未实现**~~（已修复）
   - 安装时校验，不满足返回 400。
   - 加载时校验，不满足跳过并打印插件名、要求版本、当前版本。
   - 插件列表带 `loadError`。

3. ~~**`native` 未使用**~~（已修复）
   - 后台上传包不能覆盖 `native: true` 的插件。
   - 卸载 `native: true` 的插件返回 403「内置插件不可卸载」。

4. ~~**`plugin.json.permissions` 未导入**~~（已修复）
   - 启动时 upsert 到 `Permission` 表。
   - 参与后台扩展点权限过滤。

5. **扩展点 `permissions` 仅后台生效**
   - 后台 Console 扩展点已按登录用户权限过滤。
   - 公开前台注入（`injectHeaderAction`、`injectCommentField` 等）仍不过滤，插件需自行鉴权。

6. ~~**四个函数型扩展点与数组收集器冲突**~~（已修复）
   - `injectHeaderAction`、`injectCommentField`、`editorCreate`、`commentSubjectRef` 现在函数返回数组与直接数组都支持。
   - `injectSidebarWidget`、`injectPostContent`、`injectSinglePageContent` 等组件型扩展点仍要求返回函数，由收集器调用后取数组。

7. **`replyListItemOperation` 未渲染**
   - `/api/comments` 返回 `replyOperations`。
   - 评论管理页未使用该字段。

8. ~~**评论编辑器替换未接入**~~（已修复）
   - 文章详情页调用 `getCommentEditorComponent` 并传入 `{ postId, fields }`。
   - 静态渲染，失败回退内置表单。

9. ~~**评论内容替换未接入**~~（已修复）
   - 文章详情页逐条渲染为 `contentHtml` 传给 `CommentList`。
   - 静态渲染，失败回退内置渲染。

10. **`providesTemplates` 无自动消费**
    - 只声明名称。
    - 没有页面自动遍历渲染。

11. **`customAdminRoutes.icon` 无效**
    - 导航固定使用 Puzzle 图标。

12. **`customAdminRoutes.hideSidebar` 无效**
    - 字段被解析，但布局未使用。

13. **`FrontendRouteDef.ssr` 无效**
    - 始终按服务端组件渲染。

14. **`SearchProvider.builtIn` 无效**
    - 宿主不使用。

15. **`AttachmentStorageProvider.delete` 不会被调用**
    - 删除附件不会清理远端对象。

16. **`ListItemOperationDef.variant` 多数页面未使用**
    - 统一渲染为文字链接。

17. **`ListItemFieldDef.width/sortable` 多数页面未使用**
    - 主要使用 `key`、`label`、`render`。

18. **`pluginJson` 类型注释路径错误**
    - 注释写 `<slug>.config.json`。
    - 实际是 `<slug>.run.json`。
    - 配置应使用 `ctx.config`。

19. **`bootPlugins` 无完成短路**
    - 直接调用会重复扫描与重新执行 `onMount`。
    - `ui.ts` 多个收集器与 `customApi` 分发会直接调用。
    - `onMount` 必须幂等。

20. **启用/停用不清 `require` 缓存**
    - `resetPluginCache` 只清扩展注册表。
    - 修改安装态 `index.js` 后需要重启或 dev 安装。

21. **dev 安装不写数据库记录**
    - 之前上传过且停用的 slug，dev 安装后仍停用。

22. **版本校验不完整**
    - 数据库无记录时，即使磁盘已有旧目录，也不做版本比较。

23. **安装器以内容识别类型**
    - 文件名后缀只用于外层校验。
    - 主题后缀包内放 `plugin.json` 会按插件安装。

24. **JSON 存储为浅合并**
    - 嵌套对象不会递归合并。

25. **迁移无 checksum、无 down**
    - 修改已应用迁移不会重新执行。
    - 失败后已执行 SQL 不回滚。

26. **`pluginDb` 类型不含事务**
    - 只声明 `prepare`、`exec`、`pragma`。

27. **模板注册表只扫描直接文件**
    - 不递归子目录。
    - 文件名必须以小写字母开头。

28. **运行时模板不支持 `@/` 与客户端指令**
    - 新装未重启时仅服务端 JSX。

29. **`customApi` 不支持 PATCH/OPTIONS**
    - 只有 GET、POST、PUT、DELETE。

30. **`customApi` 路径必须精确**
    - 无动态段、无尾斜杠容错。

31. **`apiMiddleware` fail-open**
    - 抛错即放行。

32. **`apiMiddleware` 覆盖范围有限**
    - 仅 8 个路由，见 8.7。

33. **204 不能用作拦截**
    - 被视为放行。

34. **`onRenderMarkdown` 后者覆盖前者**
    - 多个插件同时修改时只有最后一个字符串结果生效。

35. **`excerptGenerator` 与 `onGenerateMetadata` 只取第一个**
    - 后续插件不会合并。

36. **provider 无二级回退**
    - 第一个 `searchProvider` / `attachmentStorage` / `notifier` 失败后不会尝试第二个。
    - 邮件只回退 SMTP。

37. **插件加载顺序不稳定**
    - `readdirSync` 顺序未排序。
    - 不要依赖 provider 抢占顺序。

38. **后台扩展静态渲染**
    - 不能使用客户端 hook、事件与 effect。

39. **`customFrontendRoutes` 与 `admin.js` 共用**
    - 可能引入后台样式。

40. **安装包文件名要求固定后缀**
    - 即使安装器按内容识别，外层仍先校验文件名。

### 14.5 开发检查清单

- [ ] `plugin.json` 的 `slug` 与目录名一致。
- [ ] `slug` 只含小写字母、数字、连字符。
- [ ] `version` 已提升。
- [ ] `specVersion` 为 `1.0` 或省略。
- [ ] `entry` 指向存在的源码入口。
- [ ] 默认导出是工厂函数。
- [ ] `requiresCore` 能匹配目标宿主版本。
- [ ] 每个扩展点键名与 `ExtensionHandlers` 一致。
- [ ] 数组属性写成数组；函数型扩展点推荐写成函数返回数组（`injectHeaderAction`、`injectCommentField`、`editorCreate`、`commentSubjectRef` 也接受直接数组）。
- [ ] 组件型扩展点（`injectSidebarWidget`、`injectPostContent` 等）返回组件数组。
- [ ] 填了 `permissions` 时，后台扩展点会按登录用户权限过滤；前台公开注入需自行鉴权。
- [ ] `onMount` 幂等。
- [ ] SQLite 表使用 `IF NOT EXISTS`。
- [ ] 迁移文件存在且 SQL 可重复执行。
- [ ] 组件无 props 也能渲染。
- [ ] 后台组件不使用客户端 hook。
- [ ] HTML 注入已转义用户输入。
- [ ] `customApi` 路径以 `/` 开头。
- [ ] 写接口 `auth: true` 并自行鉴权。
- [ ] `apiMiddleware` 返回 `next()` 的结果。
- [ ] 拦截请求不使用 204。
- [ ] `customAdminRoutes.path` 不带前导 `/`。
- [ ] 动态导入指向实际存在的 `admin.js`。
- [ ] 模板文件名符合 `^[a-z][a-z0-9-]*\.tsx$`。
- [ ] 模板有默认导出。
- [ ] 新装模板后重启 dev/build。
- [ ] 卸载与保留数据行为已测试。
- [ ] 停止外部服务时页面不崩。
- [ ] 通过 `ext build` 与 `ext pack`。
- [ ] 在干净环境完成上传安装与启用验证。

---

文档结束。



# RainyNest 主题开发文档

本文面向主题作者，说明 RainyNest 主题包的结构、设置系统、样式体系、18 个系统模板的 Props 契约、混合编译机制、插件模板覆盖方式，并给出一个可以直接落地的完整主题示例。

本文以当前仓库代码为准：

- 模板契约：`packages/types/theme.ts`
- 模板解析与注册表：`lib/theme/templates.ts`
- 主题加载与配置合并：`lib/theme.ts`
- 插件模板覆盖：`lib/plugin/theme-integration.ts`
- 注册表生成：`scripts/generate-theme-registry.js`
- 主题静态资源：`app/themes/[slug]/[...path]/route.ts`
- 在线预览：`app/(site)/preview/page.tsx`、`app/api/console/themes/preview/route.ts`
- 安装器：`lib/ext-installer.ts`
- 设置表单：`components/admin/ConfigForm.tsx`
- 脚手架：`tools/create-rainynest-ext`、`tools/ext-cli`

---

## 目录

1. [概览](#1-概览)
2. [快速开始](#2-快速开始)
3. [主题包规范](#3-主题包规范)
4. [设置系统](#4-设置系统)
5. [样式体系](#5-样式体系)
6. [模板总览](#6-模板总览)
7. [模板详解与最小示例](#7-模板详解与最小示例)
8. [layout 模板](#8-layout-模板)
9. [混合编译](#9-混合编译)
10. [插件模板覆盖](#10-插件模板覆盖)
11. [完整实战：主题 mist](#11-完整实战主题-mist)
12. [FAQ 与已知限制](#12-faq-与已知限制)

---

## 1. 概览

### 1.1 RainyNest 主题能做什么

RainyNest 是 Next.js 15 App Router 博客/CMS。主题是一组安装态文件，放在：

```
scripts/themes/<slug>/
```

主题可以：

- 用 `theme.json` 声明元数据、预览图、能力声明和后台设置表单（`configSchema`）。
- 用 `theme.js` 把后台设置值映射为 CSS 变量，注入全站 `:root`。
- 用 `theme.css` 提供全局样式。
- 用 `templates/<name>.tsx` 覆盖 18 个系统模板，包括整体壳、首页、文章详情、归档、分类、标签、搜索、说说、友链、相册、404 等。
- 用 `templates/plugins/<pluginSlug>/<name>.tsx` 覆盖插件自带模板。
- 通过 `assets/` 放图片、字体等静态文件，URL 统一为 `/themes/<slug>/...`。
- 在构建期注册表模式下使用 `@/` 别名和 `'use client'` 客户端组件。

主题不能：

- 新增后台菜单、后台页面、API 路由或前台路由（这些由插件扩展点提供）。
- 改变宿主的数据查询、SEO 元数据生成、评论审核、搜索实现。
- 替换 Header、Sidebar、Footer 的内部结构；只能决定它们摆在哪里。
- 运行任意 PHP/FreeMarker 模板；模板就是 React TSX 组件。

### 1.2 与 Halo、WordPress 的差异

| 维度 | RainyNest | Halo | WordPress |
|---|---|---|---|
| 模板语言 | React TSX（服务端组件为主） | FreeMarker | PHP |
| 模板组织 | `templates/*.tsx`，按文件名覆盖 | 模板目录 + 模板继承 | 模板层级 + `get_template_part` |
| 主题壳层 | `layout.tsx` 接收 Header/Sidebar/Footer 节点后自由摆放 | 通常由模板片段组合 | `header.php` / `footer.php` |
| 设置表单 | `theme.json` 的 `configSchema` 自动生成 | 后台表单配置 | `customize_register` / 选项页 |
| 样式注入 | CSS 变量 + `theme.css` + 自定义 CSS | 主题 CSS + 变量 | `wp_enqueue_style` |
| 插件 UI 覆盖 | 主题可覆盖插件模板 | 主题可覆盖插件模板 | 模板可覆盖插件模板 |
| 安装单元 | `.gz.rainy-theme` / `.zip.rainy-theme` | `.zip` | `.zip` |
| 运行时 | Node.js 进程内同进程执行 | JVM 进程内 | PHP 进程内 |

关键差异：

1. 没有模板继承语法。复用一个布局时，请写普通 React 组件并在多个模板里 import；构建期注册表支持相对导入和 `@/` 别名，但运行时兜底不支持。
2. 没有“模板变量作用域”概念。所有数据都通过 Props 显式传入。
3. 主题不负责路由。路由由 `app/(site)` 下的页面决定，主题只决定页面内部怎么渲染。
4. 视觉定制优先走 CSS 变量，而不是在模板里硬编码颜色，这样后台换色可以即时生效。

### 1.3 信任模型

主题不是沙箱内容，安装主题等同于让管理员信任的代码进入宿主进程：

- `theme.js` 由宿主用 Node `require` 加载，可以执行任意服务端 JavaScript。
- 服务端模板组件可以 import `@/lib/prisma`、读取环境变量、访问文件系统。
- 客户端模板会进入浏览器包，能调用公开 API。
- 在线预览同样会在服务端执行目标主题的 `theme.js` 与 `home` 模板。
- Git 安装受站点设置 `allowThemeGitInstall` 控制，且只允许 `http(s)` 仓库地址。

宿主提供的安全边界主要针对“包”而不是“代码”：

- 仅管理员可上传、激活、卸载。
- 包体积上限 20MB。
- 解压时做 zip-slip 路径越界检查。
- 只允许白名单后缀。
- 安装失败自动回滚。
- 卸载时内置主题禁止删除，使用中的主题必须先切换。

因此不要安装来源不明的主题。主题作者也不应把密钥写进 `theme.js`、模板或 `assets/`。

---

## 2. 快速开始

### 2.1 生成主题工程

```bash
npm create rainynest-ext my-theme --theme
cd my-theme
npm install
```

脚手架会生成：

```
my-theme/
├── package.json
├── tsconfig.json
├── theme.json
├── theme.css
├── src/
│   └── theme.ts
├── templates/
│   └── home.tsx
└── README.md
```

`package.json` 里的脚本：

```json
{
  "scripts": {
    "dev": "ext dev . --site http://localhost:3000",
    "build": "ext build . -o dist",
    "pack": "ext build . -o dist && ext pack dist"
  }
}
```

### 2.2 目录结构

推荐按下面的结构组织源码：

```
my-theme/
├── theme.json                 # 清单与设置 schema
├── theme.css                  # 全局样式
├── src/
│   └── theme.ts               # 设置值 → CSS 变量
├── templates/
│   ├── layout.tsx             # 整体壳
│   ├── home.tsx               # 首页
│   ├── post-list.tsx          # 博客列表
│   ├── post.tsx               # 文章详情
│   ├── page.tsx               # 独立页面
│   ├── archive.tsx            # 归档
│   ├── categories.tsx         # 分类列表
│   ├── category.tsx           # 分类详情
│   ├── tags.tsx               # 标签列表
│   ├── tag.tsx                # 标签详情
│   ├── search.tsx             # 搜索
│   ├── moments.tsx            # 说说列表
│   ├── moment.tsx             # 说说详情
│   ├── links.tsx              # 友链
│   ├── gallery.tsx            # 相册列表
│   ├── photo.tsx              # 相册详情
│   ├── error.tsx              # 404
│   └── plugins/
│       └── <pluginSlug>/
│           └── <name>.tsx     # 覆盖插件模板
├── assets/                    # 图片、字体等
└── preview.png                # 后台预览图
```

`templates/` 下的文件是覆盖式契约：文件存在才覆盖，不存在自动回退宿主内置模板。

### 2.3 使用 `ext dev` 联调

1. 在主项目 `.env` 中配置：

```env
EXT_DEV_TOKEN=一段足够长的随机字符串
```

2. 启动主项目：

```bash
npm run dev
```

3. 在主题工程里启动联调：

```bash
npm run dev
# 等价于 ext dev . --site http://localhost:3000
```

`ext dev` 会：

- 校验 `theme.json`。
- 用 esbuild 编译 `src/theme.ts` 为 `theme.js`。
- 复制 `theme.json`、`theme.css`、`templates/`、`assets/`。
- 打包成 `.zip.rainy-theme`。
- 以 `x-ext-token` 请求头 POST 到 `/api/console/extensions/dev-install`。
- 监听源码变化，500ms 防抖后再次上传。

dev 安装模式会跳过版本校验与数据库 upsert，只落盘并清理主题缓存。因此：

- 第一次联调时建议先在后台启用一次该主题，或直接用预览地址。
- 新增 `templates/*.tsx` 后，宿主注册表不会自动重新生成；此时只走运行时 esbuild 兜底。
- 运行时兜底只支持服务端 JSX，不能使用 `@/` 和 `'use client'`。
- 需要完整能力时，重启主项目 `npm run dev`。

### 2.4 打包

```bash
npm run pack
```

默认主题输出 gz 包：

```
dist/my-theme.gz.rainy-theme
```

也可以显式指定格式：

```bash
ext pack dist --format zip
# dist/my-theme.zip.rainy-theme
```

打包时会跳过 `src/`、`node_modules/`、`dist/`，只收集白名单后缀文件。`theme.ts` 不会进包；进包的是编译后的 `theme.js`。

### 2.5 后台安装、激活、预览

1. 进入后台「系统 → 主题」。
2. 上传 `*.gz.rainy-theme` 或 `*.zip.rainy-theme`。
3. 安装完成后主题默认未激活；点「启用」激活。
4. 点「预览」调用：

```
GET /api/console/themes/preview?slug=my-theme
```

返回：

```json
{
  "ok": true,
  "slug": "my-theme",
  "name": "我的主题",
  "previewUrl": "/preview?theme=my-theme"
}
```

5. 前端打开 `/preview?theme=my-theme`。

预览接口的事实：

- 需要登录。
- 只接受 GET。
- 不写 cookie，避免整站因 cookie 退化为动态渲染。
- 没有 DELETE 方法。
- 预览页只会尝试渲染目标主题的 `home` 模板；其他页面仍使用当前激活主题。
- 目标主题的 `layout` 不会在预览页生效，预览页位于当前站点布局内部。
- 预览页会加载目标主题的 `theme.css`、动态 CSS 变量和 `customCss`。

### 2.6 手动安装

不走后台时，也可以直接把主题目录放到：

```
scripts/themes/<slug>/
```

至少需要 `theme.json`。重启 dev/build 后会进入注册表；未重启时只能运行时编译。

---

## 3. 主题包规范

### 3.1 包格式

支持的包名：

```
<slug>.gz.rainy-theme
<slug>.zip.rainy-theme
```

判定顺序是先插件后主题，再检查 `.zip` / `.gz`。主题包必须包含 `theme.json`；如果同时包含 `plugin.json`，安装器会按插件处理，因此不要在一个包里混放两种清单。

压缩包**根目录**必须直接包含 `theme.json`，不要再套一层主题目录：

```
theme.json
theme.css
theme.js
assets/...
templates/...
```

不能写成：

```
my-theme/
└── theme.json
```

安装器把压缩包解压到临时目录后，直接在临时目录根部查找 `theme.json` / `plugin.json`。如果清单在子目录里，会报“包根目录缺少 plugin.json / theme.json”。`ext pack` 默认把构建目录的内容放到压缩包根目录，因此不需要手动处理层级。

解压完成后，安装器复制内容到 `scripts/themes/<manifest.slug>/`。

### 3.2 安装态目录

```
scripts/themes/my-theme/
├── theme.json
├── theme.js
├── theme.css
├── preview.png
├── assets/
│   ├── cover.webp
│   └── fonts/
│       └── display.woff2
└── templates/
    ├── layout.tsx
    ├── home.tsx
    ├── post.tsx
    └── plugins/
        └── notice/
            └── notice-card.tsx
```

说明：

- `theme.json` 必需。
- `theme.js` 可选；缺失时 CSS 变量为空对象。
- `theme.css` 可选；缺失时 `/themes/<slug>/theme.css` 返回 404，浏览器忽略。
- `templates/` 可选；缺失时全部使用宿主内置模板。
- `assets/` 是约定目录，不是强制目录；但资源路由只返回 CSS、图片和字体类型，`.json`、`.js`、`.txt` 等即使能装进包也访问不到。
- `preview.png` 是约定名称，不强制。

### 3.3 `theme.json` 全字段

类型定义：

```ts
export interface ThemeMeta {
  slug: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  preview?: string;
  minRainyNestVersion?: string;
  supports: string[];
  configSchema: Record<string, ConfigGroup>;
}
```

| 字段 | 必填 | 类型 | 宿主行为 |
|---|---|---|---|
| `specVersion` | 建议 | string | 清单格式版本，与 SPI/类型包版本无关。安装器发现该字段时必须是 `"1.0"`；CLI 缺省补 `1.0` 且只支持 `1.0`。新主题请写 `"1.0"`。 |
| `slug` | 是 | string | 安装时必须是 `^[a-z0-9][a-z0-9-]*$`。安装目录也使用该值。手动放置时，资源路由和 `getThemeBySlug` 按目录名定位，但元数据里的 `slug` 仍是清单值；两者不一致会导致预览、激活和覆盖查找失败。 |
| `name` | 是 | string | 后台主题卡片和预览接口返回的名称。缺失时安装失败。 |
| `version` | 是 | string | 用于升级校验。数据库已有同 slug 主题时，新版本必须大于旧版本（`compareSemver` 比较主/次/补丁三段，忽略预发布后缀）。 |
| `description` | 否 | string | 后台展示描述。 |
| `author` | 否 | string | 后台展示作者。 |
| `preview` | 否 | string | 预览图。相对值会被规范化为 `/themes/<目录slug>/<相对值>`；绝对路径、`http(s)://`、`//` 开头的外链保持原样。 |
| `minRainyNestVersion` | 否 | string | 当前代码只保存不校验，不会阻止安装或激活。 |
| `supports` | 建议 | string[] | 当前没有能力开关语义，仅作声明和展示。脚手架默认值：`posts`、`pages`、`moments`、`gallery`、`links`。 |
| `configSchema` | 建议 | object | 后台设置表单与默认值合并依据。缺失时按空 schema 处理，主题没有可配置项。 |
| 其他字段 | 否 | any | 会保留在 JSON 中，但宿主不读取。 |

完整示例：

```json
{
  "specVersion": "1.0",
  "slug": "mist",
  "name": "雾屿",
  "version": "0.1.0",
  "description": "留白、细雨与低速阅读的博客主题",
  "author": "RainyNest",
  "preview": "preview.png",
  "minRainyNestVersion": ">=1.0.0",
  "supports": ["posts", "pages", "moments", "gallery", "links"],
  "configSchema": {
    "appearance": {
      "label": "外观",
      "description": "站点整体观感",
      "fields": {
        "accentColor": {
          "type": "color",
          "label": "强调色",
          "default": "#3b82f6",
          "help": "用于链接、按钮和焦点环"
        },
        "bgMode": {
          "type": "radio",
          "label": "底色模式",
          "default": "light",
          "options": [
            { "value": "light", "label": "浅色" },
            { "value": "dark", "label": "深色" }
          ]
        }
      }
    },
    "advanced": {
      "label": "高级",
      "fields": {
        "customCss": { "type": "textarea", "label": "自定义 CSS", "default": "" },
        "customJs": { "type": "textarea", "label": "自定义 JS", "default": "" }
      }
    }
  }
}
```

注意：

- `preview` 写 `"preview.png"` 会被规范化为 `/themes/mist/preview.png`。
- 写 `"/preview.png"` 不会被加上主题前缀，它指向站点根路径。
- 写 `"assets/cover.webp"` 会变成 `/themes/mist/assets/cover.webp`。
- 写 `"https://cdn.example.com/cover.webp"` 保持外链。
- 写 `"//cdn.example.com/cover.webp"` 保持协议相对外链。
- 目录名和 `slug` 不一致时，预览图前缀使用目录名，主题卡片和预览接口使用清单里的 `slug`，而磁盘加载、资源路由和模板覆盖按目录名查找；这种不一致会导致主题能出现在列表里但预览或激活失败，强烈建议保持一致。

### 3.4 `theme.js`

`theme.js` 是一个 CommonJS 模块，由宿主通过 Node `require` 加载。必须导出：

```js
function configToCssVariables(config) {
  return {
    '--color-primary': config.appearance.accentColor
  };
}

module.exports = { configToCssVariables };
```

要求：

- 必须是同步函数。
- 入参是**分组后的合并配置**，例如 `{ appearance: { accentColor: '#3b82f6' } }`。
- 返回 `Record<string, string>`。
- 键必须带 `--` 前缀才会成为有效 CSS 变量；宿主不会补前缀。
- 不要在模块顶层做重活；它会在主题缓存失效时被调用。
- 不要抛异常。`configToCssVariables` 抛错会导致主题加载整体失败，`getActiveTheme` 捕获后回退到无主题状态。
- 修改 `theme.js` 后需要重启宿主进程。Node 的 `require` 缓存按文件路径生效，清理主题缓存不会清理模块缓存。

TypeScript 源码示例：

```ts
interface ThemeConfig {
  appearance?: {
    accentColor?: string;
    bgMode?: 'light' | 'dark';
  };
  layout?: {
    radius?: 'none' | 'small' | 'medium' | 'large';
  };
}

export function configToCssVariables(config: ThemeConfig): Record<string, string> {
  const accent = config.appearance?.accentColor || '#3b82f6';
  const dark = config.appearance?.bgMode === 'dark';
  const radiusMap = {
    none: '0px',
    small: '4px',
    medium: '8px',
    large: '14px'
  };
  const radius = radiusMap[config.layout?.radius || 'medium'];

  return {
    '--color-primary': accent,
    '--color-primary-hover': dark ? '#93c5fd' : '#2563eb',
    '--color-bg': dark ? '#0b1220' : '#ffffff',
    '--color-bg-secondary': dark ? '#111a2b' : '#f6f8fb',
    '--color-fg': dark ? '#e5edf8' : '#0f172a',
    '--color-fg-muted': dark ? '#94a3b8' : '#64748b',
    '--color-border': dark ? '#22304a' : '#e2e8f0',
    '--radius-md': radius
  };
}
```

`ext build` 会用 esbuild 把 `src/theme.ts` 编译为 `theme.js`，格式为 CommonJS。

### 3.5 `theme.css`

`theme.css` 会以 `<link rel="stylesheet">` 的形式注入所有站点页面和预览页：

```
/themes/<slug>/theme.css
```

规则：

- 不要在这里写 `:root` 的可配置颜色，交给 `theme.js` 生成，避免被后台设置覆盖时出现两套值。
- 可以写 `:root` 的兜底值，动态变量注入在 `<link>` 之后，会覆盖兜底值。
- 不要重复引入 Tailwind 指令；宿主全局样式已经包含 Tailwind。
- 样式是全局的，没有自动 scoped 机制，请给自定义类加前缀，例如 `.mist-`。
- 资源引用使用绝对路径 `/themes/<slug>/assets/...`。
- 字体文件建议用 `@font-face` 指向 `/themes/<slug>/assets/fonts/...`。

```css
:root {
  --color-primary: #3b82f6;
  --color-bg: #ffffff;
  --color-fg: #0f172a;
  --radius-md: 8px;
}

.mist-shell {
  background: var(--color-bg);
  color: var(--color-fg);
}

.mist-hero {
  padding: clamp(2rem, 6vw, 5rem) 0;
  border-bottom: 1px solid var(--color-border);
}
```

### 3.6 `assets`

- 通过 `/themes/<slug>/<path>` 访问。
- 由 `app/themes/[slug]/[...path]/route.ts` 动态读取，不复制到 `public/`。
- 响应头：`Cache-Control: public, max-age=300`。
- 只做基础路径越界检查，不允许 `..` 跳出主题目录。
- 支持的内容类型仅限：`.css`、`.png`、`.jpg`、`.jpeg`、`.svg`、`.webp`、`.gif`、`.ico`、`.woff`、`.woff2`、`.ttf`、`.otf`。
- 其他后缀直接返回 404，不会以 `application/octet-stream` 下载。因此 `assets/data.json`、`assets/readme.txt`、`assets/theme.js` 这类路径无法通过该路由访问。
- 注意与安装白名单的差异：`.gif`、`.ico`、`.otf` 虽能由资源路由返回，但安装器白名单不包含它们，打包后会被丢弃。需要兼容时请转成 `.png`、`.webp` 或 `.woff2`。

### 3.7 `templates`

- 文件名必须是 `^[a-z][a-z0-9-]*\.tsx$`。
- 只扫描 `templates/` 第一层；`templates/foo/bar.tsx` 不会被识别为系统模板。
- 插件覆盖只识别 `templates/plugins/<pluginSlug>/<name>.tsx`，且 `<pluginSlug>`、`<name>` 必须是 `^[a-z][a-z0-9-]*$`。
- 每个模板文件必须有默认导出，导出可以是函数组件，也可以是带 `default` 的对象模块。
- 模板可以 import 其他文件；构建期注册表支持相对路径和 `@/` 别名，运行时兜底不支持。
- 服务端模板可以是 `async function`，Next.js 支持异步服务端组件。
- 客户端模板必须在文件顶部写 `'use client'`，并且只在注册表模式下可靠工作。

### 3.8 大小与后缀限制

安装器常量：

| 限制 | 值 |
|---|---|
| 单个包体积 | 20MB |
| 单个 zip 条目解压前体积 | 20MB（仅 zip 路径检查；gz 路径只受整包 20MB 限制） |
| 允许的后缀 | `.js` `.tsx` `.json` `.css` `.png` `.jpg` `.jpeg` `.svg` `.webp` `.sql` `.md` `.txt` `.woff` `.woff2` `.ttf` |
| 禁止的后缀 | `.ts` `.map` `.mjs` `.ico` `.gif` `.otf` `.exe` `.node` 等 |

因此：

- 源文件 `src/theme.ts` 不会进包，进包的是 `theme.js`。
- 不要把未编译的 TypeScript 模板直接放进主题包；安装器只接受 `.tsx`，不接受 `.ts`。
- 字体优先 `.woff2`。
- 图标优先 `.svg`。
- 图片优先 `.webp`。

### 3.9 zip-slip 与路径安全

ZIP 路径在写入前逐条检查：

```ts
const name = entry.entryName.replace(/\\/g, '/');
const target = path.resolve(destDir, name);
if (!target.startsWith(path.resolve(destDir) + path.sep)) {
  throw new Error(`非法路径: ${name}`);
}
```

同时检查后缀白名单和单条目体积。

GZ 路径先调用系统 `tar -xzf` 解压到临时目录，再递归遍历该目录：

```ts
const root = path.resolve(dest);
const walk = (dir: string) => {
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    if (!path.resolve(full).startsWith(root)) throw new Error(`非法路径: ${item}`);
    if (fs.statSync(full).isDirectory()) { walk(full); continue; }
    if (!ALLOWED.has(path.extname(item).toLowerCase())) throw new Error(`不允许的文件类型: ${item}`);
  }
};
```

说明：

- ZIP 路径检查使用 `dest + path.sep`，`../../etc/passwd` 这样的条目会被拒绝。
- GZ 路径依赖系统 `tar` 的默认安全行为，解压后再遍历检查路径前缀与后缀白名单。
- GZ 遍历使用 `startsWith(root)`，不是 `startsWith(root + sep)`；实际防护主要来自 `tar` 自身对绝对路径和 `..` 的处理。
- 主题作者不要构造带 `..` 的资源路径，否则安装可能失败。

主题静态资源路由也有边界检查：

```ts
const base = path.resolve(THEMES_DIR, slug);
const file = path.resolve(base, ...parts);
if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
  return new NextResponse('Not Found', { status: 404 });
}
```

此外 slug 必须匹配 `^[a-z0-9][a-z0-9-]*$`，否则返回 400。

### 3.10 安装、升级、回滚

安装器流程：

1. 校验文件名与体积。
2. 解压到临时目录。
3. 做路径安全检查。
4. 读取 `theme.json`，校验 `slug`、`name`、`version`、`specVersion`。
5. 如果数据库已有同 slug 主题，比较版本号；不允许降级或同版本覆盖。
6. 把旧目录重命名为 `.bak-<时间戳>`。
7. 把新目录移动到 `scripts/themes/<slug>`。
8. upsert 数据库记录，保留原有 `isActive` 与 `config`。
9. 清理主题缓存。
10. 任一步失败，删除新目录并恢复备份。

卸载：

- 内置主题不可卸载。
- 当前激活主题不可卸载。
- 卸载会删除目录和数据库记录。
- 删除失败时目录会改名为 `.deleted-<时间戳>`，下次启动由 `scripts/ensure-extensions.js` 清扫。

---

## 4. 设置系统

### 4.1 `configSchema` 结构

```ts
export interface ConfigField {
  type: string;
  label: string;
  default?: unknown;
  options?: (string | { value: string; label: string })[];
  min?: number;
  max?: number;
  step?: number;
  rows?: number;
  placeholder?: string;
  help?: string;
}

export interface ConfigGroup {
  label: string;
  description?: string;
  fields: Record<string, ConfigField>;
}

export type ConfigSchema = Record<string, ConfigGroup>;
```

示例：

```json
{
  "appearance": {
    "label": "外观",
    "description": "颜色与圆角",
    "fields": {
      "accentColor": {
        "type": "color",
        "label": "强调色",
        "default": "#3b82f6",
        "help": "作用于链接和按钮"
      },
      "radius": {
        "type": "range",
        "label": "圆角",
        "default": 8,
        "min": 0,
        "max": 24,
        "step": 1
      }
    }
  }
}
```

字段语义：

- `label` 是显示名，可省略；省略时回退到字段 key。
- `help` 会显示在控件下方。
- `ConfigGroup.description` 和 `ConfigField.description` 当前都不会被渲染。分组只显示 `label`，字段说明请使用 `help`。
- `default` 参与默认值合并。
- `options` 中字符串会被同时当作 value 和 label；对象形式使用 `value` 与 `label`。
- `language`、`image` 等未实现的类型不会特殊渲染，会落入文本输入分支。

### 4.2 字段类型：以后台 ConfigForm 实际分支为准

`ConfigForm` 的渲染分支顺序如下：

1. `switch` 或 `boolean`
2. `number`
3. `range` 或 `slider`
4. `select`
5. `radio`
6. `checkboxes` 或 `multiselect`
7. `textarea`
8. `color`
9. `date`、`time`、`datetime-local`
10. 其他所有类型 → `text` 输入；`url`、`email`、`password` 只是把 HTML input type 改为对应值。

#### 4.2.1 switch / boolean

```json
{
  "type": "switch",
  "label": "显示封面",
  "default": true,
  "help": "关闭后文章列表不显示封面图"
}
```

渲染为开关按钮。保存值为布尔。

`boolean` 是 `switch` 的别名，渲染完全相同。

#### 4.2.2 number

```json
{
  "type": "number",
  "label": "每页文章数",
  "default": 12,
  "min": 1,
  "max": 50,
  "step": 1
}
```

渲染为数字输入框。清空时值为空字符串，不会自动变成 0。

#### 4.2.3 range / slider

```json
{
  "type": "range",
  "label": "内容宽度",
  "default": 720,
  "min": 560,
  "max": 960,
  "step": 20
}
```

渲染为滑块，右侧显示当前数值。`slider` 是别名。

#### 4.2.4 select

```json
{
  "type": "select",
  "label": "侧边栏位置",
  "default": "right",
  "options": [
    { "value": "left", "label": "左侧" },
    { "value": "right", "label": "右侧" },
    { "value": "none", "label": "不显示" }
  ]
}
```

渲染为原生下拉框。

#### 4.2.5 radio

```json
{
  "type": "radio",
  "label": "底色模式",
  "default": "light",
  "options": [
    { "value": "light", "label": "浅色" },
    { "value": "dark", "label": "深色" }
  ]
}
```

渲染为胶囊按钮组，选中项高亮。适合 2 到 4 个互斥选项。

#### 4.2.6 checkboxes / multiselect

```json
{
  "type": "checkboxes",
  "label": "首页模块",
  "default": ["hero", "latest"],
  "options": [
    { "value": "hero", "label": "头图" },
    { "value": "latest", "label": "最新文章" },
    { "value": "moments", "label": "最近说说" }
  ]
}
```

渲染为可多选的胶囊按钮组，保存值为数组。`multiselect` 是渲染别名，但默认值补齐与历史值纠正只对 `checkboxes` 生效：

- `checkboxes` 没有 `default` 时，初始值为 `[]`。
- `multiselect` 没有 `default` 时，初始值为 `''`，首次点击后才变成数组。
- 用 `multiselect` 时务必显式写 `"default": []` 或具体的数组默认值，避免保存空字符串。

#### 4.2.7 textarea

```json
{
  "type": "textarea",
  "label": "自定义 CSS",
  "default": "",
  "rows": 8,
  "placeholder": ".mist-hero { letter-spacing: .02em; }"
}
```

渲染为多行文本框。`rows` 控制行数。

#### 4.2.8 color

```json
{
  "type": "color",
  "label": "强调色",
  "default": "#3b82f6"
}
```

渲染为颜色选择器加十六进制文本输入。值为空时颜色选择器回退到 `#3b82f6`。

#### 4.2.9 date / time / datetime-local

```json
{
  "type": "date",
  "label": "建站日期",
  "default": "2024-01-01"
}
```

分别渲染为浏览器原生日期、时间、日期时间控件。保存值为字符串。

#### 4.2.10 text / url / email / password / 未识别类型

```json
{
  "type": "url",
  "label": "备案查询地址",
  "default": "https://beian.miit.gov.cn/",
  "placeholder": "https://"
}
```

- `text`：普通文本输入。
- `url`：`input type="url"`。
- `email`：`input type="email"`。
- `password`：`input type="password"`。
- `image`、`markdown`、`code`、`json` 等未实现类型：全部按普通文本输入渲染。

这意味着一件事：**不要用 `type: "image"` 期望出现媒体库选择器。** 当前没有媒体选择控件，图片地址请用 `text` 或 `url` 字段。

### 4.3 默认值合并

宿主有两个不同的默认值处理阶段。

阶段一：读取主题配置时，`mergeWithDefault(schema, storedConfig)`：

```ts
for (const [groupKey, group] of Object.entries(schema || {})) {
  const storedGroup = storedConfig?.[groupKey] || {};
  const merged = {};
  for (const [fieldKey, field] of Object.entries(group.fields || {})) {
    merged[fieldKey] = storedGroup[fieldKey] !== undefined
      ? storedGroup[fieldKey]
      : field.default;
  }
  result[groupKey] = merged;
}
```

特点：

- 只保留 schema 中声明过的字段。
- 用户值只要不是 `undefined` 就保留，包括 `null`、`''`、`0`、`false`。
- 未知分组、未知字段会被丢弃。
- `storedConfig` 缺失时全部使用 `default`。

阶段二：后台表单初始化时，`buildDefaultConfig(schema, current)` 还会按类型兜底：

| 类型 | 缺省值 |
|---|---|
| `switch` / `boolean` | `false` |
| `checkboxes` | `[]` |
| `number` / `range` | `min ?? 0` |
| `slider` / `multiselect` / 其他 | `''` |

如果字段自身有 `default`，优先使用 `default`，即使是 `0` 或 `false`。`slider` 和 `multiselect` 不在类型兜底分支中，必须显式提供 `default`，否则可能得到空字符串。

另外，`buildDefaultConfig` 的输入是**展平后的配置**。它按 schema 遍历，但赋值时使用字段 key，而不是 `group.key` 路径。

### 4.4 保存链路

1. 后台打开 `/console/system/themes/<slug>/settings`。
2. 页面读取主题记录，调用 `mergeWithDefault(schema, theme.config)`。
3. 将分组配置展平为 `{ "appearance.accentColor": "#..." }` 供表单使用。
4. `buildDefaultConfig` 补齐缺失项。
5. 用户保存时，`groupConfig(schema, flat)` 按 schema 重组为分组对象。
6. 前端 `PUT /api/console/themes/<slug>/config`，请求体：

```json
{
  "config": {
    "appearance": {
      "accentColor": "#2563eb",
      "bgMode": "light"
    }
  }
}
```

7. 路由校验 `config` 必须是对象（数组也接受，但请勿使用）。
8. 路由 upsert 主题记录，写入 `config`。
9. 调用 `clearThemeCache()`。
10. `revalidatePath('/', 'layout')`。
11. 下一次请求重新读取主题，`theme.js` 重新计算 CSS 变量。

### 4.5 `customCss` 与 `customJs` 的约定

宿主只认一个固定位置：

```ts
theme.customCss = mergedConfig.advanced?.customCss;
theme.customJs = mergedConfig.advanced?.customJs;
```

因此要让自定义代码生效，`configSchema` 必须包含：

```json
{
  "advanced": {
    "label": "高级",
    "fields": {
      "customCss": { "type": "textarea", "label": "自定义 CSS", "default": "" },
      "customJs": { "type": "textarea", "label": "自定义 JS", "default": "" }
    }
  }
}
```

字段名必须精确为 `advanced.customCss`、`advanced.customJs`。放到其他分组不会注入。

### 4.6 设置值到 CSS 变量的完整示例

`theme.json`：

```json
{
  "configSchema": {
    "appearance": {
      "label": "外观",
      "fields": {
        "accentColor": { "type": "color", "label": "强调色", "default": "#3b82f6" },
        "bgMode": {
          "type": "radio",
          "label": "底色",
          "default": "light",
          "options": [
            { "value": "light", "label": "浅色" },
            { "value": "dark", "label": "深色" }
          ]
        }
      }
    },
    "layout": {
      "label": "布局",
      "fields": {
        "radius": {
          "type": "range",
          "label": "圆角",
          "default": 8,
          "min": 0,
          "max": 24,
          "step": 2
        }
      }
    }
  }
}
```

`src/theme.ts`：

```ts
export function configToCssVariables(config: any): Record<string, string> {
  const accent = config?.appearance?.accentColor || '#3b82f6';
  const dark = config?.appearance?.bgMode === 'dark';
  const radius = Number(config?.layout?.radius ?? 8);

  return {
    '--color-primary': accent,
    '--color-bg': dark ? '#0b1220' : '#ffffff',
    '--color-fg': dark ? '#e5edf8' : '#0f172a',
    '--radius-md': `${radius}px`
  };
}
```

保存后，页面 `<head>` 会出现：

```html
<style id="theme-dynamic-vars">:root{--color-primary:#2563eb;--color-bg:#0b1220;--color-fg:#e5edf8;--radius-md:10px;}</style>
```

### 4.7 设置系统常见问题

- 保存后没变化：检查 `theme.js` 是否存在、是否导出了 `configToCssVariables`、是否被 Node 缓存住。必要时重启宿主。
- 改了 schema 但后台还是旧字段：schema 来自磁盘上的 `theme.json`，重新安装或重启后再看。
- 字段保存后丢失：字段名不在 `configSchema` 中，`groupConfig` 会丢掉未知键。
- 自定义 CSS 不生效：检查是否放在 `advanced.customCss`。
- 字段说明不显示：用了 `description`，应改成 `help`。
- 图片字段只是文本框：当前没有媒体库控件。

---

## 5. 样式体系

### 5.1 注入位置与顺序

根布局 `app/layout.tsx` 的 `<head>` 中，主题相关注入顺序固定为：

```tsx
<link rel="stylesheet" href={`/themes/${theme?.slug || 'default'}/theme.css`} />
<style id="theme-dynamic-vars">{`:root { ... }`}</style>
{theme?.customCss && <style id="theme-custom-css">{theme.customCss}</style>}
{theme?.customJs && <script id="theme-custom-js" dangerouslySetInnerHTML={{ __html: theme.customJs }} />}
```

顺序含义：

1. `theme.css` 先加载，作为基础样式。
2. 动态 CSS 变量后注入，覆盖 `theme.css` 里的 `:root` 兜底值。
3. `customCss` 再后注入，可以覆盖主题自身样式。
4. `customJs` 最后注入，但它位于 `<head>`，不是 `</body>` 前。脚本会在 DOM 尚未完整解析时执行，操作 DOM 请监听 `DOMContentLoaded`。
5. 之后才是插件 `injectHead` 的内容。

注意：

- 没有激活主题时，仍然会请求 `/themes/default/theme.css`。
- `customJs` 是内联脚本，不是外部文件，不受 CSP `script-src` 的非内联限制时才会执行；如果站点配置了严格 CSP，需要自行放行。
- `customCss` 与 `customJs` 都来自管理员输入，宿主不做转义或沙箱处理。

### 5.2 CSS 变量命名

宿主不强制变量名，`theme.js` 返回什么就注入什么。但 Tailwind 只桥接了固定一组变量：

| CSS 变量 | Tailwind 类 | 默认值 |
|---|---|---|
| `--color-primary` | `text-primary`、`bg-primary`、`border-primary` | `#3b82f6` |
| `--color-primary-hover` | `bg-primary-hover`、`hover:bg-primary-hover` | `#2563eb` |
| `--color-bg` | `bg-bg` | `#ffffff` |
| `--color-bg-secondary` | `bg-bg-secondary` | `#f8fafc` |
| `--color-fg` | `text-fg` | `#0f172a` |
| `--color-fg-muted` | `text-fg-muted` | `#64748b` |
| `--color-border` | `border-line`、`divide-line` | `#e2e8f0` |
| `--radius-sm` | `rounded-sm` | `4px` |
| `--radius-md` | `rounded` | `8px` |
| `--radius-lg` | `rounded-lg` | `12px` |
| `--font-sans` | `font-sans` | `Inter, system-ui, ...` |
| `--font-mono` | `font-mono` | `JetBrains Mono, ui-monospace, ...` |

因此主题最少应输出版本：

```js
{
  '--color-primary': '#3b82f6',
  '--color-primary-hover': '#2563eb',
  '--color-bg': '#ffffff',
  '--color-bg-secondary': '#f8fafc',
  '--color-fg': '#0f172a',
  '--color-fg-muted': '#64748b',
  '--color-border': '#e2e8f0',
  '--radius-sm': '4px',
  '--radius-md': '8px',
  '--radius-lg': '12px'
}
```

其他任意变量（例如 `--mist-hero-height`）会原样注入，可以直接在 `theme.css` 和模板的 `style` 中使用。

默认主题还会输出 `--sidebar-position`，它只是主题自定义变量，宿主没有消费它；需要主题自己在布局里读取。

### 5.3 默认色板

宿主默认色板：

| 语义 | 浅色值 | 用途 |
|---|---|---|
| primary | `#3b82f6` | 链接、主按钮、焦点环 |
| primary-hover | `#2563eb` | 主按钮悬停 |
| bg | `#ffffff` | 页面底色 |
| bg-secondary | `#f8fafc` | 卡片、代码块、次级区域 |
| fg | `#0f172a` | 正文 |
| fg-muted | `#64748b` | 辅助文字 |
| border | `#e2e8f0` | 分割线、边框 |

标签、提示块等还使用了若干固定色：

- 成功/提示：`#10b981`
- 重要：`#8b5cf6`
- 警告：`#f59e0b`
- 危险：`#ef4444`

主题可以覆盖这些，但要注意对比度。

### 5.4 `theme.css` 的加载范围

- 所有 `app/(site)` 下的页面都会加载。
- 后台 `/console` 不加载主题 CSS。
- 预览页会额外加载目标主题的 `theme.css`。由于它在 `<body>` 中后出现，会覆盖根布局里当前激活主题的 CSS。
- 预览页还会注入 `theme-preview-vars`，覆盖激活主题的动态变量。
- 预览页不注入目标主题的 `customJs`，只注入 `customCss`。

### 5.5 动画类

宿主提供以下全局动画类，主题可直接使用：

| 类名 | 效果 |
|---|---|
| `anim-fade-in` | 淡入，0.4s |
| `anim-fade-in-up` | 上移淡入，0.5s |
| `anim-fade-in-down` | 下移淡入，0.4s |
| `anim-fade-out` | 淡出，0.3s |
| `anim-scale-in` | 缩放淡入，0.25s |
| `skeleton` | 骨架屏闪光 |
| `stagger` | 子元素交错上移淡入，最多 9 个延迟档 |

Tailwind 动画名：

- `animate-fade-in`
- `animate-fade-in-up`
- `animate-fade-in-down`
- `animate-fade-out`
- `animate-scale-in`
- `animate-slide-in-left`

缓动函数：

- `ease-smooth` 对应 `cubic-bezier(0.22, 1, 0.36, 1)`。

建议：

- 列表容器加 `stagger`，子项不需要自己写 delay。
- 卡片悬停使用 `transition-transform duration-200 hover:-translate-y-0.5`。
- 按钮使用 `active:scale-95` 提供按压反馈。
- 不要对所有元素滥用 `anim-*`，首屏进入动画控制在 0.5s 内。

### 5.6 断点

Tailwind 默认断点，未自定义：

| 名称 | 最小宽度 |
|---|---|
| `sm` | 640px |
| `md` | 768px |
| `lg` | 1024px |
| `xl` | 1280px |
| `2xl` | 1536px |

宿主布局的既有约定：

- Header 桌面导航在 `md` 以上显示，移动菜单按钮 `md:hidden`。
- 侧边栏 `hidden xl:flex`，即 1280px 以下不显示。
- 内容区常用 `max-w-5xl`。
- 文章列表常用 `grid-cols-1 md:grid-cols-2`。

主题布局如果要自定义侧边栏断点，需要覆盖宿主侧边栏的隐藏类，例如：

```css
@media (min-width: 1024px) {
  .mist-shell [data-site-sidebar] {
    display: flex;
  }
}
```

### 5.7 正文样式

宿主为 Markdown 渲染结果提供 `.markdown-body` 全局样式，包括标题、段落、列表、链接、行内代码、表格、分割线、KaTeX、Callout、双链、指令容器等。

文章与页面模板应把 `html` 放进：

```tsx
<article className="markdown-body anim-fade-in" dangerouslySetInnerHTML={{ __html: html }} />
```

不要重复实现 Markdown 样式；可以在 `theme.css` 中覆盖 `.markdown-body` 的局部细节。

### 5.8 样式层叠建议

1. 语义颜色只通过 CSS 变量使用，不写死十六进制。
2. 主题自己的类统一加前缀。
3. 不要用 `!important` 覆盖宿主布局的响应式类，优先调整结构。
4. 不要在 `theme.css` 里重置全局 `*` 的 `box-sizing`、`margin`、`padding`；Tailwind preflight 已处理。
5. 需要暗色模式时，用 `bgMode` 配置在 `theme.js` 中切换变量，或者在主题自己的客户端组件里切换根节点 `data-theme`，并让 `theme.css` 针对 `[data-theme='dark']` 覆盖变量。

---

## 6. 模板总览

### 6.1 18 个模板

| 序号 | 模板名 | 候选文件 | 前台路由 | 说明 |
|---|---|---|---|---|
| 1 | `layout` | `layout.tsx` | 所有 `app/(site)` 页面 | 整体壳，接收 Header/Sidebar/Footer |
| 2 | `home` | `home.tsx` | `/` | 首页 |
| 3 | `post-list` | `post-list.tsx` | `/blog` | 博客文章列表 |
| 4 | `post` | `post.tsx`、`post-detail.tsx` | `/blog/[slug]` | 文章详情 |
| 5 | `post-detail` | `post-detail.tsx`、`post.tsx` | `/blog/[slug]` | 文章详情别名，与 `post` 同契约 |
| 6 | `page` | `page.tsx` | `/pages/[slug]` | 独立页面 |
| 7 | `archive` | `archive.tsx` | `/archive` | 按年归档 |
| 8 | `categories` | `categories.tsx` | `/categories` | 分类列表 |
| 9 | `category` | `category.tsx` | `/categories/[slug]` | 分类详情 |
| 10 | `tags` | `tags.tsx` | `/tags` | 标签列表 |
| 11 | `tag` | `tag.tsx` | `/blog/tag/[name]` | 标签详情 |
| 12 | `search` | `search.tsx` | `/search` | 搜索结果 |
| 13 | `moments` | `moments.tsx` | `/moments` | 说说列表 |
| 14 | `moment` | `moment.tsx` | `/moments/[id]` | 说说详情 |
| 15 | `links` | `links.tsx` | `/links` | 友链 |
| 16 | `gallery` | `gallery.tsx` | `/gallery` | 相册列表 |
| 17 | `photo` | `photo.tsx` | `/gallery/[slug]` | 相册详情 |
| 18 | `error` | `error.tsx` | 全站 404 | 错误页 |

`/p/[...path]` 不是页面模板路由，而是插件自定义前台路由（`customFrontendRoutes`）。它不会使用 `page` 模板，也不属于主题的覆盖范围。

### 6.2 候选文件名与优先级

大多数模板只有一个候选文件。只有文章详情有两个：

- 解析 `post` 时：先 `post.tsx`，再 `post-detail.tsx`。
- 解析 `post-detail` 时：先 `post-detail.tsx`，再 `post.tsx`。

因此以下三种写法等效：

```
templates/post.tsx
templates/post-detail.tsx
templates/post.tsx + templates/post-detail.tsx
```

如果同时存在，`post` 路由使用 `post.tsx`；其他调用方解析 `post-detail` 时使用 `post-detail.tsx`。两者都只要求相同 Props。

### 6.3 回退规则

单个模板的解析顺序：

1. **构建期注册表**：查找 `themeTemplateRegistry[themeSlug][templateName]`，模块存在且有默认导出则使用。
2. **运行时编译**：检查 `scripts/themes/<slug>/templates/<候选文件>` 是否存在，存在则用 esbuild 编译并加载。
3. **宿主内置模板**：以上都没有，返回 `null`，页面渲染内置组件。

页面层再包一层捕获：

- 模板**解析或编译**抛错时，绝大多数页面会 `console.error` 后回退内置模板。
- `layout` 解析或编译抛错时回退默认站点布局。
- `error` 模板解析或编译抛错时回退内置 404 页。

不会发生的回退：

- 模板组件**渲染阶段**抛错不在这些 try/catch 内，会继续向上冒泡到 Next 错误边界，通常显示 500 或错误页。
- 主题模板内部某个子组件抛错，不会被页面级解析回退吞掉。
- 注册表里存在模块但默认导出不是组件时，解析阶段会报错并回退；客户端引用对象是例外，注册表会接受。

### 6.4 数据契约的公共类型

以下类型来自 `packages/types/theme.ts`，所有模板共享。

```ts
export interface TemplateSite {
  title: string;
  subtitle: string | null;
  description: string | null;
  logo: string | null;
  url: string | null;
  footerText: string | null;
  icp: string | null;
}

export interface TemplatePost {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  coverImage: string | null;
  views: number;
  createdAt: Date;
  publishedAt: Date | null;
  isTop?: boolean;
  category?: { name: string; slug: string } | null;
}

export interface TemplateMoment {
  id: string;
  content: string;
  images: string[];
  createdAt: Date;
  user: {
    displayName: string;
    avatar: string | null;
  };
}
```

`TemplatePost.category` 只有部分查询包含；首页、文章列表、分类详情、标签详情、搜索会带分类，归档和说说不会。

### 6.5 共用数据结构

分类：

```ts
{ id: string; name: string; slug: string; description: string | null; count: number }
```

标签：

```ts
{ id: string; name: string; slug: string; count: number }
```

分页信息：

```ts
{ page: number; totalPages: number; total: number }
```

评论、目录、内容块等交互区域由宿主以 ReactNode 形式通过 `slots` 传入，主题只需摆放。

### 6.6 文件不存在时的行为

- 只提供 `home.tsx`：其他页面全部使用内置模板，主题仍然生效，CSS 与设置变量仍然注入。
- 只提供 `layout.tsx`：所有页面套用新壳，但页面主体仍是内置模板。
- 提供拼错的文件名，例如 `Home.tsx`、`home.ts`、`post_detail.tsx`：不会被识别，静默回退。
- 提供 `templates/plugins/...` 但没提供系统模板：系统页面正常，插件覆盖在插件调用解析器时生效。

---

## 7. 模板详解与最小示例

### 7.0 编写约定

所有示例都以类型包为唯一依赖：

```tsx
import type { HomeTemplateProps } from '@rainynest/plugin-types';
```

每个文件必须默认导出组件：

```tsx
export default function HomeTemplate(props: HomeTemplateProps) {
  return null;
}
```

示例使用 `<a>` 而不是 `next/link`，避免额外依赖；在实际主题中可以使用 `next/link`，构建期注册表会正常解析。

### 7.1 layout

功能：整体壳，决定 Header、Sidebar、Footer 与页面内容如何排列。

Props：

| 字段 | 类型 | 说明 |
|---|---|---|
| `site` | `TemplateSite` | 站点信息，字段见 6.4 |
| `menus` | `TemplateMenuItem[]` | 导航菜单，`{ name, url }` |
| `header` | `ReactNode` | 宿主完整 Header 节点 |
| `sidebar` | `ReactNode` | 宿主完整 Sidebar 节点 |
| `footer` | `ReactNode` | 宿主完整 Footer 节点 |
| `footerNodes` | `ReactNode` | 插件注入的页脚节点 |
| `children` | `ReactNode` | 当前页面内容 |

slots：无。所有区域都是直接 Props。

数据来源：`app/(site)/layout.tsx` 读取站点设置、菜单，构造 Header/Sidebar/Footer，并把插件页脚节点合并进 `footerNodes`。

最小示例：

```tsx
import type { LayoutTemplateProps } from '@rainynest/plugin-types';

export default function LayoutTemplate({
  site,
  header,
  sidebar,
  footer,
  footerNodes,
  children,
}: LayoutTemplateProps) {
  return (
    <div className="mist-shell min-h-screen flex flex-col bg-bg text-fg">
      {header}
      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-10 px-4 py-10">
        <main className="min-w-0 flex-1 anim-fade-in">{children}</main>
        <aside className="hidden xl:block w-64 shrink-0">{sidebar}</aside>
      </div>
      <footer className="border-t border-line">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 space-y-4">
          {footerNodes}
          {footer}
        </div>
      </footer>
    </div>
  );
}
```

注意：`children` 必须渲染一次。`header`、`sidebar`、`footer` 是不可拆解的整体节点，详见第 8 节。

### 7.2 home

功能：首页。

Props：

| 字段 | 类型 | 说明 |
|---|---|---|
| `site` | `TemplateSite` | 站点信息 |
| `posts` | `TemplatePost[]` | 最新 8 篇已发布文章，含分类 |
| `total` | `number` | 已发布文章总数 |
| `slots.posts` | `ReactNode` | 宿主渲染的文章卡片网格或空状态 |

`TemplatePost` 完整字段见 6.4：`id`、`title`、`slug`、`summary`、`coverImage`、`views`、`createdAt`、`publishedAt`、`isTop?`、`category?`。

数据来源：`app/(site)/page.tsx`，`status: PUBLISHED`，`isTop desc`、`publishedAt desc`，`take: 8`，并统计总数。页面对 `slots.posts` 做了两种渲染：有文章时是两列卡片网格，无文章时是引导写文章的空状态。

最小示例：

```tsx
import type { HomeTemplateProps } from '@rainynest/plugin-types';

export default function HomeTemplate({ site, posts, total, slots }: HomeTemplateProps) {
  return (
    <div className="space-y-12">
      <section className="mist-hero text-center anim-fade-in-up">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">{site.title}</h1>
        {site.subtitle && <p className="mt-4 text-lg text-fg-muted">{site.subtitle}</p>}
        <p className="mt-2 text-sm text-fg-muted">共 {total} 篇文章</p>
      </section>

      <section>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-bold">最新文章</h2>
          <a href="/blog" className="text-sm text-primary hover:opacity-70">全部文章</a>
        </div>
        {slots.posts}
      </section>

      {posts.length === 0 && (
        <p className="text-center text-sm text-fg-muted">还没有文章</p>
      )}
    </div>
  );
}
```

### 7.3 post-list

功能：博客文章列表与分页。

Props：

| 字段 | 类型 | 说明 |
|---|---|---|
| `posts` | `TemplatePost[]` | 当前页文章，含分类 |
| `total` | `number` | 已发布文章总数 |
| `page` | `number` | 当前页码，从 1 开始 |
| `totalPages` | `number` | 总页数，至少为 1 |
| `slots.list` | `ReactNode` | 宿主文章列表或空状态 |
| `slots.pagination` | `ReactNode` | 宿主分页导航，只有多页时非空 |

`TemplatePost` 完整字段见 6.4。

数据来源：`app/(site)/blog/page.tsx`，每页 12 条，`isTop desc`、`publishedAt desc`，`skip/take` 分页。

最小示例：

```tsx
import type { PostListTemplateProps } from '@rainynest/plugin-types';

export default function PostListTemplate({
  posts,
  total,
  page,
  totalPages,
  slots,
}: PostListTemplateProps) {
  return (
    <div className="space-y-8">
      <header className="anim-fade-in-up">
        <h1 className="text-3xl font-bold">博客</h1>
        <p className="mt-2 text-sm text-fg-muted">
          共 {total} 篇 第 {page} / {totalPages} 页
        </p>
      </header>

      {posts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line p-12 text-center text-fg-muted">
          暂无文章
        </div>
      ) : (
        slots.list
      )}

      {slots.pagination}
    </div>
  );
}
```

### 7.4 post

功能：文章详情。

Props：

| 字段 | 类型 | 说明 |
|---|---|---|
| `post.slug` | `string` | 文章 slug |
| `post.title` | `string` | 标题 |
| `post.author` | `string` | 作者展示名 |
| `post.date` | `Date` | 发布时间，缺失时使用创建时间 |
| `post.views` | `number` | 浏览量 |
| `post.category` | `{ name: string; slug: string } \| null` | 分类 |
| `post.tags` | `{ name: string; slug: string }[]` | 标签 |
| `post.coverImage` | `string \| null` | 封面图 |
| `post.allowComment` | `boolean` | 是否允许评论 |
| `html` | `string` | Markdown 渲染后的 HTML |
| `commentsCount` | `number` | 顶层已审核评论数量 |
| `slots.tocMobile` | `ReactNode` | 移动端目录 |
| `slots.tocDesktop` | `ReactNode` | 桌面端目录 |
| `slots.comments` | `ReactNode` | 评论表单、评论列表或第三方评论 HTML |
| `slots.contentBlocks` | `ReactNode` | 插件文末追加块 |

数据来源：`app/(site)/blog/[slug]/page.tsx`。只渲染 `PUBLISHED` 文章，否则 404。`html` 由 `renderMarkdown` 生成，包含插件预处理、代码高亮、KaTeX、Callout 等。`commentsCount` 是顶层评论条数，不是包含回复的总数。评论关闭时 `slots.comments` 会渲染关闭提示。

最小示例：

```tsx
import type { PostDetailTemplateProps } from '@rainynest/plugin-types';

export default function PostTemplate({
  post,
  html,
  commentsCount,
  slots,
}: PostDetailTemplateProps) {
  return (
    <article className="mx-auto max-w-3xl">
      <header className="anim-fade-in-up">
        {post.category && (
          <a href={`/categories/${post.category.slug}`} className="text-sm text-primary">
            {post.category.name}
          </a>
        )}
        <h1 className="mt-2 text-3xl md:text-4xl font-bold tracking-tight">{post.title}</h1>
        <p className="mt-3 text-sm text-fg-muted">
          {post.author} · {post.date.toLocaleDateString('zh-CN')} · {post.views} 次阅读 · {commentsCount} 条评论
        </p>
      </header>

      {post.coverImage && (
        <img src={post.coverImage} alt={post.title} className="mt-6 w-full rounded-lg object-cover" />
      )}

      <div className="mt-6">{slots.tocMobile}</div>
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div>
          <div className="markdown-body anim-fade-in" dangerouslySetInnerHTML={{ __html: html }} />
          {slots.contentBlocks}
          <section className="mt-10">{slots.comments}</section>
        </div>
        <aside className="hidden lg:block">
          <div className="sticky top-20">{slots.tocDesktop}</div>
        </aside>
      </div>

      {post.tags.length > 0 && (
        <ul className="mt-8 flex flex-wrap gap-2">
          {post.tags.map((tag) => (
            <li key={tag.slug}>
              <a
                href={`/blog/tag/${encodeURIComponent(tag.name)}`}
                className="rounded-full border border-line px-3 py-1 text-xs text-fg-muted hover:border-primary hover:text-primary"
              >
                {tag.name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
```

### 7.5 post-detail

功能：文章详情别名，Props 与 7.4 完全相同。

Props：`post`、`html`、`commentsCount`、`slots.tocMobile`、`slots.tocDesktop`、`slots.comments`、`slots.contentBlocks`。

slots：与 7.4 完全相同，用途也相同。

数据来源：与 7.4 完全相同，来自 `app/(site)/blog/[slug]/page.tsx`。

解析顺序：

- 路由解析 `post`，优先 `post.tsx`，其次 `post-detail.tsx`。
- 如果有调用方显式解析 `post-detail`，优先 `post-detail.tsx`，其次 `post.tsx`。

最小示例（直接复用同一组件）：

```tsx
// templates/post-detail.tsx
export { default } from './post';
```

或者单独实现：

```tsx
import type { PostDetailTemplateProps } from '@rainynest/plugin-types';

export default function PostDetailTemplate({ post, html, slots }: PostDetailTemplateProps) {
  return (
    <article className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-bold">{post.title}</h1>
      <div className="markdown-body mt-6" dangerouslySetInnerHTML={{ __html: html }} />
      {slots.contentBlocks}
      {slots.comments}
    </article>
  );
}
```

注意：`export { default } from './post'` 依赖构建期注册表或运行时能够解析相对导入。运行时兜底是单文件 transform，不解决相对依赖，因此推荐只用其中一种文件名，避免别名转发。

### 7.6 page

功能：独立页面。

Props：

| 字段 | 类型 | 说明 |
|---|---|---|
| `page.title` | `string` | 页面标题 |
| `page.summary` | `string \| null` | 摘要 |
| `page.html` | `string` | Markdown 渲染后的正文 HTML |
| `page.sidebarHtml` | `string \| null` | 自定义侧边栏 Markdown 渲染结果 |
| `page.showSidebar` | `boolean` | 数据库里的“显示侧边栏”开关 |
| `slots.contentBlocks` | `ReactNode` | 插件文末追加块 |

数据来源：`app/(site)/pages/[slug]/page.tsx`。只渲染 `PUBLISHED` 页面，否则 404。`sidebarHtml` 来自页面的 `sidebarContent`，为空时为 `null`。

最小示例：

```tsx
import type { PageTemplateProps } from '@rainynest/plugin-types';

export default function PageTemplate({ page, slots }: PageTemplateProps) {
  return (
    <div className="mx-auto max-w-3xl">
      <header className="anim-fade-in-up">
        <h1 className="text-3xl font-bold">{page.title}</h1>
        {page.summary && <p className="mt-2 text-sm text-fg-muted">{page.summary}</p>}
        <hr className="mt-6 border-line" />
      </header>

      <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_240px]">
        <div>
          <div className="markdown-body" dangerouslySetInnerHTML={{ __html: page.html }} />
          {slots.contentBlocks}
        </div>
        {page.showSidebar && page.sidebarHtml && (
          <aside className="hidden xl:block">
            <div className="sticky top-20 rounded-xl border border-line bg-bg p-4 markdown-body">
              <div dangerouslySetInnerHTML={{ __html: page.sidebarHtml }} />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
```

重要限制：主题覆盖 `page` 后，默认分支里那段“隐藏全站侧边栏”的内联 `<style>` 不会自动执行。因为 `layout` 仍然渲染 `sidebar`，当 `page.showSidebar` 为 `false` 或存在自定义侧边栏时，主题需要自己输出：

```tsx
{(!page.showSidebar || page.sidebarHtml) && (
  <style>{'@media (min-width:1280px){[data-site-sidebar]{display:none!important}}'}</style>
)}
```

否则会出现双份侧边栏。

### 7.7 archive

功能：按年份归档。

Props：

| 字段 | 类型 | 说明 |
|---|---|---|
| `total` | `number` | 已发布文章总数 |
| `years` | `{ year: number; posts: { id: string; title: string; slug: string; date: Date }[] }[]` | 按年份倒序分组，组内按发布时间倒序 |

slots：无。

数据来源：`app/(site)/archive/page.tsx`。查询全部 `PUBLISHED` 文章，按 `publishedAt desc` 排序，在 JS 中用 `publishedAt || createdAt` 取年份并分组。

最小示例：

```tsx
import type { ArchiveTemplateProps } from '@rainynest/plugin-types';

export default function ArchiveTemplate({ total, years }: ArchiveTemplateProps) {
  return (
    <div className="mx-auto max-w-3xl">
      <header className="anim-fade-in-up">
        <h1 className="text-3xl font-bold">归档</h1>
        <p className="mt-2 text-sm text-fg-muted">共 {total} 篇文章</p>
      </header>

      {years.length === 0 ? (
        <p className="mt-10 text-center text-sm text-fg-muted">暂无文章</p>
      ) : (
        <div className="mt-8 space-y-10">
          {years.map((group) => (
            <section key={group.year} className="anim-fade-in-up">
              <h2 className="text-2xl font-bold">{group.year}</h2>
              <ul className="mt-4 space-y-2 border-l-2 border-line pl-4">
                {group.posts.map((post) => (
                  <li key={post.id}>
                    <a href={`/blog/${post.slug}`} className="group flex items-baseline gap-3">
                      <time className="shrink-0 text-xs text-fg-muted">
                        {post.date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })}
                      </time>
                      <span className="text-sm group-hover:text-primary">{post.title}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
```

### 7.8 categories

功能：分类列表。

Props：

| 字段 | 类型 | 说明 |
|---|---|---|
| `categories` | `{ id: string; name: string; slug: string; description: string \| null; count: number }[]` | 全部分类，按名称升序 |

slots：无。

数据来源：`app/(site)/categories/page.tsx`。查询全部分类并统计关联文章数。`count` 来自 Prisma `_count.posts`，统计关系表中的全部文章，不额外过滤发布状态。

最小示例：

```tsx
import type { CategoriesTemplateProps } from '@rainynest/plugin-types';

export default function CategoriesTemplate({ categories }: CategoriesTemplateProps) {
  return (
    <div>
      <header className="anim-fade-in-up">
        <h1 className="text-3xl font-bold">分类</h1>
        <p className="mt-2 text-sm text-fg-muted">共 {categories.length} 个分类</p>
      </header>

      {categories.length === 0 ? (
        <p className="mt-10 text-center text-sm text-fg-muted">还没有分类</p>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 stagger">
          {categories.map((category) => (
            <a
              key={category.id}
              href={`/categories/${category.slug}`}
              className="rounded-lg border border-line bg-bg p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold">{category.name}</span>
                <span className="rounded-full bg-bg-secondary px-2.5 py-0.5 text-xs text-fg-muted">
                  {category.count} 篇
                </span>
              </div>
              {category.description && (
                <p className="mt-2 text-sm text-fg-muted line-clamp-2">{category.description}</p>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
```

### 7.9 category

功能：分类详情与文章列表。

Props：

| 字段 | 类型 | 说明 |
|---|---|---|
| `category.name` | `string` | 分类名 |
| `category.slug` | `string` | 分类 slug |
| `category.description` | `string \| null` | 分类描述 |
| `posts` | `TemplatePost[]` | 该分类下全部已发布文章，含分类 |
| `slots.list` | `ReactNode` | 宿主文章网格或空状态 |

`TemplatePost` 完整字段见 6.4。

数据来源：`app/(site)/categories/[slug]/page.tsx`。按 slug 查分类，不存在则 404；文章条件为 `PUBLISHED` 且 `categoryId` 匹配，排序 `isTop desc`、`publishedAt desc`。

最小示例：

```tsx
import type { CategoryTemplateProps } from '@rainynest/plugin-types';

export default function CategoryTemplate({
  category,
  posts,
  slots,
}: CategoryTemplateProps) {
  return (
    <div>
      <header className="anim-fade-in-up">
        <a href="/categories" className="text-sm text-fg-muted hover:text-primary">全部分类</a>
        <h1 className="mt-3 text-3xl font-bold">{category.name}</h1>
        {category.description && (
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">{category.description}</p>
        )}
        <p className="mt-2 text-sm text-fg-muted">共 {posts.length} 篇文章</p>
      </header>

      <div className="mt-8">{slots.list}</div>
    </div>
  );
}
```

### 7.10 tags

功能：标签云。

Props：

| 字段 | 类型 | 说明 |
|---|---|---|
| `tags` | `{ id: string; name: string; slug: string; count: number }[]` | 全部标签，按名称升序 |

slots：无。

数据来源：`app/(site)/tags/page.tsx`。查询全部标签并统计关联文章数，`count` 来自 Prisma `_count.posts`。

最小示例：

```tsx
import type { TagsTemplateProps } from '@rainynest/plugin-types';

export default function TagsTemplate({ tags }: TagsTemplateProps) {
  const max = Math.max(1, ...tags.map((tag) => tag.count));

  return (
    <div>
      <header className="anim-fade-in-up">
        <h1 className="text-3xl font-bold">标签</h1>
        <p className="mt-2 text-sm text-fg-muted">共 {tags.length} 个标签</p>
      </header>

      {tags.length === 0 ? (
        <p className="mt-10 text-center text-sm text-fg-muted">还没有标签</p>
      ) : (
        <div className="mt-8 flex flex-wrap gap-3">
          {tags.map((tag) => {
            const ratio = max > 1 ? (tag.count - 1) / (max - 1) : 1;
            return (
              <a
                key={tag.id}
                href={`/blog/tag/${encodeURIComponent(tag.name)}`}
                className="rounded-full border border-line bg-bg px-3.5 py-1.5 transition-all duration-200 hover:border-primary hover:text-primary active:scale-95"
                style={{ fontSize: `${0.875 + ratio * 0.875}rem` }}
              >
                {tag.name} <span className="text-xs text-fg-muted">{tag.count}</span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

### 7.11 tag

功能：标签详情与文章列表。

Props：

| 字段 | 类型 | 说明 |
|---|---|---|
| `tag` | `{ name: string; slug: string } \| null` | 找到的标签；可能为 `null` |
| `posts` | `TemplatePost[]` | 该标签下全部已发布文章，含分类 |
| `slots.list` | `ReactNode` | 宿主文章网格或空状态 |

`TemplatePost` 完整字段见 6.4。

数据来源：`app/(site)/blog/tag/[name]/page.tsx`。用路由参数同时匹配 `name` 和 `slug`；找不到标签时不 404，`tag` 为 `null`，页面显示“标签不存在”。文章条件为 `PUBLISHED` 且关联该标签。

最小示例：

```tsx
import type { TagTemplateProps } from '@rainynest/plugin-types';

export default function TagTemplate({ tag, posts, slots }: TagTemplateProps) {
  return (
    <div>
      <header className="anim-fade-in-up">
        <a href="/tags" className="text-sm text-fg-muted hover:text-primary">全部标签</a>
        <h1 className="mt-3 text-3xl font-bold">{tag ? tag.name : '标签不存在'}</h1>
        <p className="mt-2 text-sm text-fg-muted">
          {tag ? `共 ${posts.length} 篇文章` : '没有找到这个标签'}
        </p>
      </header>

      <div className="mt-8">{slots.list}</div>
    </div>
  );
}
```

### 7.12 search

功能：搜索结果页。

Props：

| 字段 | 类型 | 说明 |
|---|---|---|
| `query` | `string` | 已 trim 的搜索词 |
| `results` | `{ id: string; title: string; slug: string; summary: string \| null; snippet: string }[]` | 搜索结果，最多 20 条 |
| `slots.form` | `ReactNode` | 搜索表单 |

数据来源：`app/(site)/search/page.tsx`，动态渲染。通过 `getSearchProvider()` 获取搜索引擎，默认是 FTS5，插件可以替换。`snippet` 是可能包含高亮标签的 HTML，渲染时需要用 `dangerouslySetInnerHTML`。

最小示例：

```tsx
import type { SearchTemplateProps } from '@rainynest/plugin-types';

export default function SearchTemplate({ query, results, slots }: SearchTemplateProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="anim-fade-in-up">
        <h1 className="text-3xl font-bold">搜索</h1>
        {slots.form}
      </header>

      {query && (
        <section className="space-y-4">
          <p className="text-sm text-fg-muted">
            {results.length > 0 ? `找到 ${results.length} 条结果` : '没有找到相关内容'}
          </p>
          <div className="space-y-3">
            {results.map((item) => (
              <a
                key={item.id}
                href={`/blog/${item.slug}`}
                className="block rounded-lg border border-line p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              >
                <h2 className="font-semibold">{item.title}</h2>
                <p
                  className="mt-2 text-sm text-fg-muted line-clamp-2"
                  dangerouslySetInnerHTML={{ __html: item.snippet || item.summary || '' }}
                />
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
```

### 7.13 moments

功能：说说时间流。

Props：

| 字段 | 类型 | 说明 |
|---|---|---|
| `moments` | `TemplateMoment[]` | 已发布说说，按创建时间倒序 |
| `slots.list` | `ReactNode` | 宿主时间轴列表或空状态 |

`TemplateMoment` 字段：`id`、`content`、`images: string[]`、`createdAt: Date`、`user: { displayName: string; avatar: string | null }`。

数据来源：`app/(site)/moments/page.tsx`。查询 `PUBLISHED` 说说，包含用户展示名和头像；`images` 从数据库 JSON 字符串解析，只保留非空字符串。

最小示例：

```tsx
import type { MomentsTemplateProps } from '@rainynest/plugin-types';

export default function MomentsTemplate({ moments, slots }: MomentsTemplateProps) {
  return (
    <div className="mx-auto max-w-2xl">
      <header className="anim-fade-in-up">
        <h1 className="text-3xl font-bold">说说</h1>
        <p className="mt-2 text-sm text-fg-muted">共 {moments.length} 条动态</p>
      </header>

      {moments.length === 0 ? (
        <p className="mt-10 text-center text-sm text-fg-muted">还没有说说</p>
      ) : (
        slots.list
      )}
    </div>
  );
}
```

### 7.14 moment

功能：说说详情，包含图片灯箱与上一篇/下一篇。

Props：

| 字段 | 类型 | 说明 |
|---|---|---|
| `moment.id` | `string` | 说说 ID |
| `moment.content` | `string` | 正文纯文本 |
| `moment.images` | `string[]` | 图片地址 |
| `moment.createdAt` | `Date` | 创建时间 |
| `moment.user.displayName` | `string` | 作者展示名 |
| `moment.user.avatar` | `string \| null` | 作者头像 |
| `prev` | `{ id: string; content: string } \| null` | 上一篇 |
| `next` | `{ id: string; content: string } \| null` | 下一篇 |
| `slots.lightbox` | `ReactNode` | 宿主图片灯箱，没有图片时为 `null` |

数据来源：`app/(site)/moments/[id]/page.tsx`。只渲染 `PUBLISHED` 说说，否则 404。上一篇取 `createdAt` 更早的最近一条，下一篇取更晚的最近一条。

最小示例：

```tsx
import type { MomentTemplateProps } from '@rainynest/plugin-types';

export default function MomentTemplate({ moment, prev, next, slots }: MomentTemplateProps) {
  return (
    <div className="mx-auto max-w-2xl">
      <a href="/moments" className="text-sm text-fg-muted hover:text-primary">返回说说列表</a>

      <article className="mt-4 rounded-lg border border-line bg-bg p-5 anim-fade-in-up">
        <div className="flex items-center gap-3">
          {moment.user.avatar ? (
            <img src={moment.user.avatar} alt={moment.user.displayName} className="h-10 w-10 rounded-full object-cover" />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-bg-secondary text-xs text-fg-muted">
              {moment.user.displayName.slice(0, 1)}
            </span>
          )}
          <div>
            <p className="text-sm font-semibold">{moment.user.displayName}</p>
            <time className="text-xs text-fg-muted" dateTime={moment.createdAt.toISOString()}>
              {moment.createdAt.toLocaleString('zh-CN')}
            </time>
          </div>
        </div>

        <p className="mt-4 whitespace-pre-wrap break-words text-[15px] leading-relaxed">
          {moment.content}
        </p>

        {slots.lightbox}
      </article>

      {(prev || next) && (
        <nav className="mt-6 grid gap-3 sm:grid-cols-2">
          {prev && (
            <a href={`/moments/${prev.id}`} className="rounded-lg border border-line p-4 text-sm hover:border-primary/40">
              上一篇 {prev.content}
            </a>
          )}
          {next && (
            <a href={`/moments/${next.id}`} className="rounded-lg border border-line p-4 text-right text-sm hover:border-primary/40">
              下一篇 {next.content}
            </a>
          )}
        </nav>
      )}
    </div>
  );
}
```

### 7.15 links

功能：友链墙。

Props：

| 字段 | 类型 | 说明 |
|---|---|---|
| `links` | `{ id: string; name: string; url: string; logo: string \| null; description: string \| null }[]` | 已发布友链，按 `order` 升序 |
| `slots.list` | `ReactNode` | 宿主友链网格或空状态 |

数据来源：`app/(site)/links/page.tsx`，条件 `status: PUBLISHED`，排序 `order asc`。

最小示例：

```tsx
import type { LinksTemplateProps } from '@rainynest/plugin-types';

export default function LinksTemplate({ links, slots }: LinksTemplateProps) {
  return (
    <div>
      <header className="anim-fade-in-up">
        <h1 className="text-3xl font-bold">友情链接</h1>
        <p className="mt-2 text-sm text-fg-muted">共 {links.length} 个站点</p>
      </header>

      {links.length === 0 ? (
        <p className="mt-10 text-center text-sm text-fg-muted">还没有友链</p>
      ) : (
        slots.list
      )}
    </div>
  );
}
```

如果需要自行渲染，而不是使用 `slots.list`：

```tsx
<ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 stagger">
  {links.map((link) => (
    <li key={link.id}>
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 rounded-lg border border-line bg-bg p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
      >
        {link.logo && <img src={link.logo} alt={link.name} className="h-10 w-10 rounded object-cover" />}
        <span className="min-w-0">
          <span className="block truncate font-semibold">{link.name}</span>
          {link.description && (
            <span className="mt-0.5 block truncate text-xs text-fg-muted">{link.description}</span>
          )}
        </span>
      </a>
    </li>
  ))}
</ul>
```

### 7.16 gallery

功能：相册列表。

Props：

| 字段 | 类型 | 说明 |
|---|---|---|
| `galleries` | `{ id: string; title: string; slug: string; description: string \| null; coverImage: string \| null; count: number }[]` | 已发布相册，按创建时间倒序 |
| `slots.list` | `ReactNode` | 宿主相册网格或空状态 |

slots：只有 `slots.list`。

数据来源：`app/(site)/gallery/page.tsx`，条件 `status: PUBLISHED`，排序 `createdAt desc`，`count` 来自 `_count.photos`。

最小示例：

```tsx
import type { GalleryTemplateProps } from '@rainynest/plugin-types';

export default function GalleryTemplate({ galleries, slots }: GalleryTemplateProps) {
  return (
    <div>
      <header className="anim-fade-in-up">
        <h1 className="text-3xl font-bold">相册</h1>
        <p className="mt-2 text-sm text-fg-muted">共 {galleries.length} 个相册</p>
      </header>

      {galleries.length === 0 ? (
        <p className="mt-10 text-center text-sm text-fg-muted">还没有相册</p>
      ) : (
        slots.list
      )}
    </div>
  );
}
```

自行渲染时可以使用：

```tsx
<div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 stagger">
  {galleries.map((gallery) => (
    <a
      key={gallery.id}
      href={`/gallery/${gallery.slug}`}
      className="group overflow-hidden rounded-lg border border-line bg-bg transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
    >
      {gallery.coverImage && (
        <img
          src={gallery.coverImage}
          alt={gallery.title}
          className="h-44 w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      )}
      <div className="p-4">
        <h2 className="font-semibold">{gallery.title}</h2>
        <p className="mt-1 text-xs text-fg-muted">{gallery.count} 张照片</p>
        {gallery.description && (
          <p className="mt-2 line-clamp-2 text-sm text-fg-muted">{gallery.description}</p>
        )}
      </div>
    </a>
  ))}
</div>
```

### 7.17 photo

功能：相册详情与照片墙。

Props：

| 字段 | 类型 | 说明 |
|---|---|---|
| `gallery.title` | `string` | 相册标题 |
| `gallery.description` | `string \| null` | 相册描述 |
| `photos` | `{ url: string; title: string \| null; width: number \| null; height: number \| null }[]` | 照片，按创建时间升序 |
| `slots.grid` | `ReactNode` | 宿主瀑布流照片墙，没有照片时为 `null` |

数据来源：`app/(site)/gallery/[slug]/page.tsx`。只渲染 `PUBLISHED` 相册，否则 404；照片按 `createdAt asc` 排序。

最小示例：

```tsx
import type { PhotoTemplateProps } from '@rainynest/plugin-types';

export default function PhotoTemplate({ gallery, photos, slots }: PhotoTemplateProps) {
  return (
    <div>
      <header className="anim-fade-in-up">
        <a href="/gallery" className="text-sm text-fg-muted hover:text-primary">返回相册</a>
        <h1 className="mt-3 text-3xl font-bold">{gallery.title}</h1>
        {gallery.description && (
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">{gallery.description}</p>
        )}
        <p className="mt-2 text-sm text-fg-muted">{photos.length} 张照片</p>
        <hr className="mt-6 border-line" />
      </header>

      {slots.grid ?? (
        <p className="mt-10 text-center text-sm text-fg-muted">相册里还没有照片</p>
      )}
    </div>
  );
}
```

### 7.18 error

功能：全站 404。

Props：

| 字段 | 类型 | 说明 |
|---|---|---|
| `status` | `number` | HTTP 状态，当前固定 404 |
| `title` | `string` | 标题，当前固定 `"404"` |
| `message` | `string` | 提示文案 |

slots：无。

数据来源：`app/not-found.tsx`，静态构造 `{ status: 404, title: '404', message: '页面被雨淋走了 找不到这个角落' }`。

最小示例：

```tsx
import type { ErrorTemplateProps } from '@rainynest/plugin-types';

export default function ErrorTemplate({ status, title, message }: ErrorTemplateProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 anim-fade-in">
      <p className="text-6xl font-bold tracking-tight anim-scale-in">{title}</p>
      <p className="text-sm text-fg-muted anim-fade-in-up">{message}</p>
      <p className="text-xs text-fg-muted">错误码 {status}</p>
      <a
        href="/"
        className="rounded bg-primary px-5 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-primary-hover active:scale-95"
      >
        回到首页
      </a>
    </div>
  );
}
```

---

## 8. layout 模板

### 8.1 宿主如何组装布局

`app/(site)/layout.tsx` 先准备以下节点：

```tsx
const header = <Header siteTitle={site.title} menus={menus} headerActions={headerActions} />;
const sidebar = <Sidebar />;
const footer = <Footer />;

const footerContent = (
  <>
    {footerNodes.map((node, i) =>
      typeof node === 'string' ? (
        <div key={i} dangerouslySetInnerHTML={{ __html: node }} />
      ) : (
        <div key={i}>{node}</div>
      ),
    )}
  </>
);
```

然后调用主题 layout：

```tsx
<Template
  site={templateSite}
  menus={menus}
  header={header}
  sidebar={sidebar}
  footer={footer}
  footerNodes={footerContent}
>
  {children}
</Template>
<MermaidRenderer />
```

默认布局是：

```tsx
<div className="flex flex-col min-h-screen">
  {header}
  <div className="flex-1 w-full max-w-7xl mx-auto px-4 py-8">
    <div className="flex gap-10">
      <main className="min-w-0 flex-1">{children}</main>
      {sidebar}
    </div>
  </div>
  {footer}
  {footerContent}
  <MermaidRenderer />
</div>
```

主题 layout 拿到的 `footerNodes` 已经是渲染好的 ReactNode，不是数组。`footer` 是完整 Footer 组件，内部已经包含站点页脚文案、社交链接和 ICP。

### 8.2 可以重排什么

- Header 放在顶部、侧边或底部。
- Sidebar 放左、放右、放在内容下方，或者不渲染。
- Footer 放在内容区内部或页面最底部。
- `footerNodes` 可以放在 Footer 之前、之后，或者独立成一条插件区。
- 给 `children` 包任意容器，例如阅读进度条、背景层、纸张纹理。
- 用 CSS Grid 做三栏、双栏、单栏。
- 用 `site.logo`、`site.subtitle`、`site.footerText` 增加额外的品牌区域。

示例：左侧栏布局。

```tsx
import type { LayoutTemplateProps } from '@rainynest/plugin-types';

export default function LayoutTemplate({
  header,
  sidebar,
  footer,
  footerNodes,
  children,
}: LayoutTemplateProps) {
  return (
    <div className="mist-shell min-h-screen">
      {header}
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-8 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="sticky top-20">{sidebar}</div>
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
      {footerNodes}
      {footer}
    </div>
  );
}
```

示例：上下结构，侧边栏放在内容下面。

```tsx
export default function LayoutTemplate({ header, sidebar, footer, footerNodes, children }: LayoutTemplateProps) {
  return (
    <div className="min-h-screen flex flex-col">
      {header}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">{children}</main>
      <div className="mx-auto w-full max-w-3xl px-4 pb-10">{sidebar}</div>
      {footerNodes}
      {footer}
    </div>
  );
}
```

### 8.3 不可替换的区域

以下内容不在 layout 的控制范围内：

- Header 内部的 Logo、桌面导航、搜索入口、用户菜单、移动端菜单按钮。
- Sidebar 内部的“最新文章”“标签云”和插件 widget。
- Footer 内部的版权、社交链接、ICP。
- 根布局注入的 `theme.css`、动态 CSS 变量、`customCss`、`customJs`。
- 根布局注入的插件 `injectHead`。
- 根布局注入的 `AnalyticsBeacon`。
- `MermaidRenderer`，它固定渲染在 layout 模板之后，不需要也不能通过 layout 放置。
- 页面的 Metadata、JSON-LD、路由级 SEO。
- 页面模板内部的数据查询与插槽组装。

可以隐藏，但不建议：

- 不渲染 `header` 会失去全站导航、搜索、登录入口和移动端菜单。
- 不渲染 `sidebar` 会让插件侧栏 widget 消失。
- 不渲染 `footer` 会失去备案号和社交链接，`footerNodes` 仍需单独处理。
- 重复渲染 `header`/`sidebar`/`footer` 会导致重复 DOM、重复请求和重复插件节点。

### 8.4 移动端菜单为什么仍然可用

Header 是客户端组件：

```tsx
'use client';

import { useState } from 'react';

export default function Header(...) {
  const [open, setOpen] = useState(false);
  ...
  <button onClick={() => setOpen(!open)} className="md:hidden ...">...</button>
  <MobileNav open={open} menus={menus} actions={actions} onClose={() => setOpen(false)} />
}
```

主题只是把 `header` 这个 ReactNode 放到某个位置，不会拆开它，也不会重新实例化它。Header 内部的 `useState`、路径高亮、移动菜单开关、`MobileNav` 的遮罩和关闭逻辑都保持原样。

注意事项：

- 不要把 `header` 包进 `overflow-hidden` 的短容器，移动菜单会被裁切。
- 不要给 `header` 的祖先加 `transform`，否则 Header 的 `sticky top-0` 可能失效。
- 不要用 CSS 强制隐藏 Header 的 `md:hidden` 按钮。
- 移动菜单的层级由 Header 自身的 `z-50` 控制，主题容器不要设置更低的 `z-index` 上下文。

### 8.5 主题切换的现状

当前宿主没有内置的明暗主题切换按钮。Header 只有：

- Logo
- 桌面导航
- 插件顶栏按钮
- 搜索入口
- 用户菜单
- 移动菜单按钮

根布局的 `viewport` 还固定为：

```ts
export const viewport = {
  colorScheme: 'light'
};
```

所以“主题切换仍可用”这个前提在当前代码里不成立：**没有可保留的宿主主题切换器**。

当前能做的暗色方案：

1. 在 `configSchema` 中提供 `bgMode` 单选，`theme.js` 根据它输出深色 CSS 变量。切换需要到后台保存，整站 SSR 后生效。
2. 主题自己实现一个客户端切换组件，读取 `localStorage`，在根节点设置 `data-theme="dark"`，并在 `theme.css` 中覆盖变量：

```tsx
'use client';

import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('mist-theme') === 'dark';
    setDark(saved);
    document.documentElement.dataset.theme = saved ? 'dark' : 'light';
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    localStorage.setItem('mist-theme', next ? 'dark' : 'light');
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
  }

  return (
    <button type="button" onClick={toggle} className="rounded border border-line px-2 py-1 text-xs">
      {dark ? '浅色' : '深色'}
    </button>
  );
}
```

```css
[data-theme='dark'] {
  --color-bg: #0b1220;
  --color-bg-secondary: #111a2b;
  --color-fg: #e5edf8;
  --color-fg-muted: #94a3b8;
  --color-border: #22304a;
}
```

3. 在 layout 里把切换组件放在 `header` 旁边。由于 `header` 是完整节点，无法把按钮插进 Header 内部；只能放在 Header 外部、用绝对定位覆盖，或接受它出现在 Header 下方。

这个客户端组件只有在构建期注册表模式下才能稳定工作，因为运行时兜底不会建立客户端边界。新增后必须重启 dev/build。

### 8.6 layout 常见问题

- 页面空白：没有渲染 `children`。
- 移动菜单被裁切：祖先有 `overflow-hidden`。
- Header 不吸顶：祖先有 `transform`、`filter`、`perspective`。
- 侧边栏在移动端占位：宿主 Sidebar 自带 `hidden xl:flex`，主题又用 `block` 覆盖了它；应保持隐藏策略。
- 页脚插件节点丢失：没有渲染 `footerNodes`。
- 主题切换按钮报 Hooks 错误：客户端组件走了运行时兜底，没有 `'use client'` 边界；重启以进入注册表。

---

## 9. 混合编译

### 9.1 两条编译路径

| 路径 | 触发条件 | 能力 | 限制 |
|---|---|---|---|
| 构建期注册表 | 模板在 `predev` / `prebuild` / `prestart` 时已存在于磁盘 | 正常 Next 模块，支持 `@/` 别名、相对导入、`'use client'`、客户端组件、Tailwind 类、类型检查 | 新增或删除模板后必须重启 dev 或重新 build |
| 运行时 esbuild | 模板未进入注册表，但文件存在 | 服务端 JSX | 单文件 transform，不支持 `@/`、相对依赖、客户端边界、CSS 导入 |

### 9.2 注册表生成时机

`package.json`：

```json
{
  "scripts": {
    "predev": "node scripts/ensure-extensions.js && node scripts/generate-theme-registry.js",
    "dev": "next dev",
    "prebuild": "node scripts/ensure-extensions.js && node scripts/generate-theme-registry.js",
    "build": "next build --turbopack",
    "prestart": "node scripts/ensure-extensions.js && node scripts/generate-theme-registry.js",
    "start": "next start",
    "theme:registry": "node scripts/generate-theme-registry.js"
  }
}
```

因此：

- `npm run dev` 启动前会扫描一次。
- `npm run build` 前会扫描一次。
- `npm run start` 前会扫描一次。
- 运行中的 dev 不会因为磁盘新增文件而自动重新生成。
- 可以手动执行 `npm run theme:registry`，但生成的模块仍需要 Next 重新编译，通常还要重启 dev。

### 9.3 注册表来源

扫描三类文件：

```
scripts/themes/<theme>/templates/<name>.tsx
scripts/themes/<theme>/templates/plugins/<plugin>/<name>.tsx
scripts/plugins/<plugin>/templates/<name>.tsx
```

规则：

- 主题系统模板只扫描 `templates/` 第一层。
- 主题插件覆盖只扫描 `templates/plugins/<plugin>/` 第一层。
- 插件自带模板只扫描 `templates/` 第一层。
- 文件名必须匹配 `^[a-z][a-z0-9-]*\.tsx$`。
- 主题目录名必须匹配 `^[a-zA-Z0-9._-]+$`，且不能是 `.bak-*`、`.deleted-*`。
- 每个文件先做 esbuild 语法预检，语法错误会打印警告并跳过，不会阻塞构建。
- 注册表按 slug 和模板名排序，保证生成结果稳定。

### 9.4 生成的注册表结构

生成文件：`lib/theme/generated-templates.ts`

示例：

```ts
// 此文件由 scripts/generate-theme-registry.js 自动生成，请勿手动修改。
import * as themeTpl0 from '../../scripts/themes/mist/templates/archive';
import * as themeTpl1 from '../../scripts/themes/mist/templates/home';
import * as themeTpl2 from '../../scripts/themes/mist/templates/layout';
import * as themeTpl3 from '../../scripts/themes/mist/templates/plugins/notice/notice-card';
import * as themeTpl4 from '../../scripts/themes/mist/templates/post';
import * as pluginTpl5 from '../../scripts/plugins/notice/templates/notice-card';

export const themeTemplateRegistry: Record<string, Record<string, unknown>> = {
  'mist': {
    'archive': themeTpl0,
    'home': themeTpl1,
    'layout': themeTpl2,
    'plugins/notice/notice-card': themeTpl3,
    'post': themeTpl4,
  },
};

export const pluginTemplateRegistry: Record<string, Record<string, unknown>> = {
  'notice': {
    'notice-card': pluginTpl5,
  },
};
```

要点：

- `import * as` 拿到的是模块命名空间对象，组件在 `.default` 上。
- 主题系统模板的 key 是文件名去掉 `.tsx`。
- 主题插件覆盖的 key 是 `plugins/<plugin>/<name>`。
- 插件自带模板的 key 只有 `<name>`，因为外层已经按插件 slug 分组。
- 路径是相对生成文件的位置计算的，所以 `lib/theme/generated-templates.ts` 指向 `../../scripts/...`。
- 这个文件不要手改，下次生成会覆盖。

### 9.5 `@/` 别名为什么能用

注册表文件本身位于 `lib/theme/`，在其中静态 import `../../scripts/themes/...`，Next 会把这些模板当作普通项目模块编译：

- TSX 走 SWC。
- `@/` 由 `tsconfig` 的 `paths` 解析。
- CSS 导入由 Next 处理。
- `'use client'` 由 React 服务端组件编译器识别，生成客户端引用。
- Tailwind 由内容扫描处理。

运行时兜底没有这些能力，因为 esbuild 只做单文件 transform，不执行 Next 的模块图分析。

### 9.6 `'use client'` 的条件

只有在构建期注册表中，`'use client'` 才会被识别。识别后：

- 服务端模块拿到的 `default` 是客户端引用对象，不是函数。
- `registryTemplate` 同时接受 `function` 和 `object`，因此可以正常渲染。
- 客户端组件可以安全使用 `useState`、`useEffect`、事件处理、`window`、`localStorage`。

运行时兜底中：

- `'use client'` 只是一个普通字符串字面量。
- 模块仍被 `require` 到服务端。
- Hooks 调用会失败，事件处理不会进入客户端包。
- 不要依赖运行时兜底加载客户端组件。

### 9.7 新增模板后的行为

场景一：主题已经安装，新增 `home.tsx`，重启 dev。

- 注册表包含 `home`。
- 首页使用新模板，支持 `@/` 与客户端组件。

场景二：主题已经安装，新增 `home.tsx`，不重启 dev。

- 注册表不包含 `home`。
- 首页先查注册表失败，再走运行时编译。
- 如果 `home.tsx` 只使用 React 和普通服务端 JSX，可以立即看到效果。
- 如果 import 了 `@/components/...`，运行时会报模块找不到，页面回退内置首页。
- 如果用了 `useState`，运行时报 Hooks 错误，页面回退内置首页。

场景三：后台上传新主题，不重启。

- 主题列表可见。
- 预览页可以走运行时编译渲染 `home`，不要求先激活。
- 激活后，系统页面也可以走运行时编译。
- 只要模板是自包含服务端 TSX，就能立即工作。
- 想要完整能力，需要重启。

### 9.8 Tailwind 扫描

`tailwind.config.ts` 的内容范围：

```ts
content: [
  './app/**/*.{ts,tsx}',
  './components/**/*.{ts,tsx}',
  './lib/**/*.{ts,tsx}',
  './scripts/themes/**/templates/**/*.{ts,tsx}',
]
```

结论：

- 主题模板中的 Tailwind 类会被扫描。
- 主题的 `templates/plugins/...` 也在 `scripts/themes/**/templates/**` 范围内，会被扫描。
- **插件自带模板 `scripts/plugins/**/templates/**` 不在扫描范围。** 插件模板如果使用 Tailwind 类，只有该类恰好也被宿主或其他主题模板使用时才会生成；否则样式缺失。插件模板应使用内联样式、`theme.css` 中的自定义类，或只使用宿主已用的类。
- 新装主题的模板类在开发模式下可能需要重启 dev 才能稳定生效；生产必须在 build 前安装并重启 build。

### 9.9 运行时兜底的具体限制

运行时编译使用：

```ts
esbuild.transform(source, {
  loader: 'tsx',
  jsx: 'automatic',
  format: 'cjs',
  target: 'node18',
});
```

因此：

- JSX 会自动注入 `react/jsx-runtime`，可以从宿主 `node_modules` 解析。
- 只处理当前文件，不做 bundle。
- 相对导入 `./foo` 不会被解析成 `./foo.tsx`。
- `@/` 不会被解析。
- CSS 导入不会被处理。
- 图片导入不会被处理。
- `import.meta` 不可用。
- 不能使用 `next/dynamic` 做客户端拆分。
- 不能使用需要客户端边界的库。
- 可以使用宿主已有的服务端 API，例如 `import { db } from '@/lib/prisma'` 不行，因为 `@/` 不解析；需要运行时兜底时，模板应尽量自包含，只依赖 Props。

运行时缓存：

- 编译产物写入 `db/cache/theme-templates/`。
- 文件名包含 mtime，文件变化会重新编译。
- 每次加载前会删除 `require.cache`，避免旧代码残留。
- 旧产物会被异步删除，避免缓存目录膨胀。
- 缓存只按绝对路径和 mtime，不按内容哈希。

### 9.10 常见编译错误与处理

| 现象 | 原因 | 处理 |
|---|---|---|
| 页面静默使用内置模板 | 文件名不匹配或模板不存在 | 检查 `templates/<name>.tsx` 与正则 |
| 控制台出现“缺少 default 导出组件” | 运行时模板没有默认导出 | 添加 `export default function ...` |
| `Cannot find module '@/...'` | 运行时兜底不解析别名 | 重启以进入注册表，或去掉 `@/` 依赖 |
| `Invalid hook call` / `useState is not a function` | 客户端组件走了运行时兜底 | 重启以进入注册表，并确认文件顶部有 `'use client'` |
| 样式类不生效 | Tailwind 未扫描或未重启 | 检查 content 范围，重启 dev/build |
| 模板语法错误但构建不失败 | 注册表生成时已跳过 | 查看 `[theme-registry]` 警告，修复语法 |
| 修改模板后页面仍旧 | Next 缓存或浏览器缓存 | 重启 dev，硬刷新；检查 mtime 缓存 |
| 修改 `theme.js` 后没变化 | Node require 缓存 | 重启宿主进程 |
| 预览页显示默认首页 | 预览只解析 `home`，且运行时编译失败 | 查看控制台 `[Theme] 预览 home 模板加载失败` |

### 9.11 调试注册表

```bash
npm run theme:registry
```

观察输出：

```
[theme-registry] ✓ 已注册主题模板 5 个、插件模板 1 个
```

然后检查 `lib/theme/generated-templates.ts`：

- 主题 slug 是否出现。
- 模板 key 是否正确。
- 相对 import 路径是否存在。
- 插件模板是否出现在 `pluginTemplateRegistry`。

如果注册表为空：

- 检查 `scripts/themes/<slug>/templates/` 是否存在。
- 检查文件名是否小写。
- 检查文件是否 `.tsx`。
- 检查主题目录是否被识别为残留目录。

---

## 10. 插件模板覆盖

### 10.1 能力范围

插件可以自带前台模板：

```
scripts/plugins/<pluginSlug>/templates/<name>.tsx
```

主题可以覆盖：

```
scripts/themes/<themeSlug>/templates/plugins/<pluginSlug>/<name>.tsx
```

宿主提供解析函数：

```ts
export async function resolvePluginTemplate(
  pluginSlug: string,
  templateName: string
): Promise<unknown | null>;
```

返回的是模块命名空间对象，组件在 `.default` 上。

### 10.2 优先级

```text
主题构建期注册表
  → 主题运行时编译
  → 插件构建期注册表
  → 插件运行时编译
  → null
```

逐步说明：

1. `resolvePluginTemplate` 先调用 `resolveThemeTemplate('plugins/<plugin>/<name>.tsx')`。
2. `resolveThemeTemplate` 先查 `themeTemplateRegistry[activeTheme.slug]['plugins/<plugin>/<name>']`。
3. 未命中则检查 `scripts/themes/<activeTheme>/templates/plugins/<plugin>/<name>.tsx` 并运行时编译。
4. 主题层抛错时打印 `[Theme] 插件模板覆盖加载失败，回退插件默认模板`，继续下一步。
5. 调用 `resolvePluginSourceTemplate(pluginSlug, templateName)`。
6. 先查 `pluginTemplateRegistry[pluginSlug][templateName]`。
7. 未命中则检查 `scripts/plugins/<pluginSlug>/templates/<name>.tsx` 并运行时编译。
8. 插件层抛错时打印 `[Plugin] 默认模板加载失败`。
9. 都没有返回 `null`。

名称安全：

```ts
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
```

`pluginSlug` 与 `templateName` 都必须匹配，否则直接返回 `null`，不会触碰文件系统。

### 10.3 当前代码的消费方式

必须明确一个事实：**宿主当前没有内置页面会自动渲染某个插件的具名模板。**

`resolvePluginTemplate` 是一个导出 API，但 `app/(site)` 下没有调用点。它需要由以下一方调用：

- 插件自己的前台路由组件或扩展点渲染逻辑。
- 主题的服务端模板。
- 站点的自定义代码。

因此只放一个 `templates/plugins/...` 文件，不会自动出现在任何页面。它只是“当有人解析这个插件模板时，优先返回主题覆盖版本”。

### 10.4 插件清单与模板声明

插件清单 `plugin.json`：

```json
{
  "specVersion": "1.0",
  "slug": "notice",
  "name": "通知卡片",
  "version": "0.1.0",
  "description": "在文章底部显示一条通知卡片",
  "author": "RainyNest",
  "entry": "index.js"
}
```

插件入口 `index.ts`：

```ts
import type { ExtensionHandlers, PluginContext } from '@rainynest/plugin-types';

export default function noticePlugin(_ctx: PluginContext): ExtensionHandlers {
  return {
    // 声明模板能力，供后台展示与插件发现使用；解析仍由 resolvePluginTemplate 完成
    providesTemplates: ['notice-card'],
  };
}
```

`providesTemplates` 是插件处理器上的元数据声明，当前不会自动注册路由或自动渲染。真正决定是否能加载的是 `templates/notice-card.tsx` 是否存在。

插件默认模板 `templates/notice-card.tsx`：

```tsx
import type { ReactNode } from 'react';

export interface NoticeCardProps {
  label?: string;
  children?: ReactNode;
}

export default function NoticeCard({ label, children }: NoticeCardProps) {
  return (
    <aside className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <p className="text-sm font-semibold">{label || '通知'}</p>
      <div className="mt-1 text-sm text-fg-muted">{children || '这是一条插件默认模板'}</div>
    </aside>
  );
}
```

### 10.5 主题覆盖示例

```
scripts/themes/mist/templates/plugins/notice/notice-card.tsx
```

```tsx
import type { ReactNode } from 'react';

interface NoticeCardProps {
  label?: string;
  children?: ReactNode;
}

export default function NoticeCardOverride({ label, children }: NoticeCardProps) {
  return (
    <aside className="mist-notice anim-fade-in">
      <span className="mist-notice-dot" aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold">{label || '来自主题的通知'}</p>
        <p className="mt-1 text-sm text-fg-muted">{children || '主题覆盖了插件默认模板'}</p>
      </div>
    </aside>
  );
}
```

注意：

- 覆盖组件必须与插件默认组件保持相同的 Props 契约，否则调用方传参会对不上。
- 不要跨插件目录 import 类型；把契约复制到主题自己的类型文件，或放到双方共享的纯类型包。
- 主题覆盖文件在注册表中 key 为 `plugins/notice/notice-card`。
- 主题覆盖可以使用 `@/` 与 `'use client'`，前提是重启后进入注册表。

### 10.6 在主题模板中调用解析器

主题模板进入构建期注册表后，可以 import 宿主 API：

```tsx
import type { ComponentType } from 'react';
import { resolvePluginTemplate } from '@/lib/plugin/theme-integration';
import type { PostDetailTemplateProps } from '@rainynest/plugin-types';

export default async function PostTemplate({ post, html, slots }: PostDetailTemplateProps) {
  const mod = await resolvePluginTemplate('notice', 'notice-card');
  const Notice = mod && typeof mod === 'object'
    ? (mod as { default?: ComponentType<{ label?: string }> }).default
    : null;

  return (
    <article>
      <h1>{post.title}</h1>
      <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
      {Notice ? <Notice label={post.title} /> : null}
      {slots.contentBlocks}
      {slots.comments}
    </article>
  );
}
```

要点：

- 这个模板依赖 `@/`，必须走注册表。
- `resolvePluginTemplate` 返回模块对象，不是组件本身。
- 主题覆盖存在时返回主题模块；不存在时返回插件模块；都没有返回 `null`。
- 解析失败已被内部捕获并记录日志，调用方拿到的通常是 `null` 或插件默认模块。
- 如果主题覆盖模块没有默认导出，注册表视为未命中，继续尝试运行时编译；运行时仍没有默认导出会抛错，并被捕获后回退插件默认模板。
- 无论哪条路径，最终都可能返回 `null`，调用方必须判空。

### 10.7 调试插件模板

1. 确认插件目录：

```
scripts/plugins/notice/
├── plugin.json
├── index.js
└── templates/
    └── notice-card.tsx
```

2. 确认主题覆盖目录：

```
scripts/themes/mist/templates/plugins/notice/notice-card.tsx
```

3. 执行注册表生成并检查：

```bash
npm run theme:registry
```

期望在 `pluginTemplateRegistry` 看到：

```ts
'notice': {
  'notice-card': pluginTplX
}
```

在 `themeTemplateRegistry['mist']` 看到：

```ts
'plugins/notice/notice-card': themeTplY
```

4. 重启 dev，避免运行时兜底。

5. 在调用方打印：

```ts
const mod = await resolvePluginTemplate('notice', 'notice-card');
console.log('plugin template module', mod);
```

6. 查看控制台日志：

- `[Theme] 插件模板覆盖加载失败，回退插件默认模板: notice/notice-card`
- `[Plugin] 默认模板加载失败: notice/notice-card`

7. 如果返回 `null`：

- 检查插件 slug 和模板名是否符合 `^[a-z0-9][a-z0-9-]*$`。
- 检查文件是否存在。
- 检查插件是否已安装到 `scripts/plugins/notice`。
- 检查主题是否已激活；`resolveThemeTemplate` 只查当前激活主题。

### 10.8 插件模板的 Tailwind 限制

再次强调：

- 主题覆盖模板位于 `scripts/themes/**/templates/**`，会被 Tailwind 扫描。
- 插件默认模板位于 `scripts/plugins/**`，不会被 Tailwind 扫描。
- 插件模板的类名要和主题覆盖保持一致时，优先把样式写进主题的 `theme.css`，或使用内联样式。
- 如果插件需要独立样式，建议随插件提供一份 CSS，并在插件激活时通过 `injectHead` 注入，而不是依赖 Tailwind 扫描。

---

## 11. 完整实战：主题 mist

这一节给出一个可以打包安装的完整主题，包含：

- `layout`
- `home`
- `post`
- `archive`
- 插件模板覆盖 `plugins/notice/notice-card`
- 配套插件 `notice` 的默认模板与入口

### 11.1 目录结构

主题工程：

```
mist/
├── package.json
├── theme.json
├── theme.css
├── preview.png
├── src/
│   └── theme.ts
└── templates/
    ├── layout.tsx
    ├── home.tsx
    ├── post.tsx
    ├── archive.tsx
    └── plugins/
        └── notice/
            └── notice-card.tsx
```

配套插件工程：

```
notice/
├── package.json
├── plugin.json
├── index.ts
└── templates/
    └── notice-card.tsx
```

安装后的宿主目录：

```
scripts/
├── themes/
│   └── mist/
│       ├── theme.json
│       ├── theme.js
│       ├── theme.css
│       ├── preview.png
│       └── templates/
│           ├── layout.tsx
│           ├── home.tsx
│           ├── post.tsx
│           ├── archive.tsx
│           └── plugins/
│               └── notice/
│                   └── notice-card.tsx
└── plugins/
    └── notice/
        ├── plugin.json
        ├── index.js
        └── templates/
            └── notice-card.tsx
```

### 11.2 `theme.json`

```json
{
  "specVersion": "1.0",
  "slug": "mist",
  "name": "雾屿",
  "version": "0.1.0",
  "description": "留白、细雨与低速阅读的博客主题",
  "author": "RainyNest",
  "preview": "preview.png",
  "minRainyNestVersion": ">=1.0.0",
  "supports": ["posts", "pages", "moments", "gallery", "links"],
  "configSchema": {
    "appearance": {
      "label": "外观",
      "description": "控制强调色与底色模式",
      "fields": {
        "accentColor": {
          "type": "color",
          "label": "强调色",
          "default": "#3b82f6",
          "help": "用于链接、按钮、焦点环"
        },
        "bgMode": {
          "type": "radio",
          "label": "底色模式",
          "default": "light",
          "options": [
            { "value": "light", "label": "浅色" },
            { "value": "dark", "label": "深色" }
          ],
          "help": "深色模式在保存后整站生效"
        }
      }
    },
    "layout": {
      "label": "布局",
      "description": "控制圆角与首页密度",
      "fields": {
        "radius": {
          "type": "range",
          "label": "圆角",
          "default": 10,
          "min": 0,
          "max": 24,
          "step": 2
        },
        "showCover": {
          "type": "switch",
          "label": "列表显示封面",
          "default": true
        },
        "homeDensity": {
          "type": "select",
          "label": "首页密度",
          "default": "comfortable",
          "options": [
            { "value": "compact", "label": "紧凑" },
            { "value": "comfortable", "label": "舒适" }
          ]
        }
      }
    },
    "advanced": {
      "label": "高级",
      "fields": {
        "customCss": {
          "type": "textarea",
          "label": "自定义 CSS",
          "default": "",
          "rows": 8,
          "placeholder": ".mist-hero { letter-spacing: .02em; }"
        },
        "customJs": {
          "type": "textarea",
          "label": "自定义 JS",
          "default": "",
          "rows": 6,
          "placeholder": "document.addEventListener('DOMContentLoaded', () => {})"
        }
      }
    }
  }
}
```

### 11.3 `src/theme.ts`

```ts
interface MistConfig {
  appearance?: {
    accentColor?: string;
    bgMode?: 'light' | 'dark';
  };
  layout?: {
    radius?: number;
    showCover?: boolean;
    homeDensity?: 'compact' | 'comfortable';
  };
}

function safeNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function configToCssVariables(config: MistConfig): Record<string, string> {
  const accent = config?.appearance?.accentColor || '#3b82f6';
  const dark = config?.appearance?.bgMode === 'dark';
  const radius = safeNumber(config?.layout?.radius, 10);
  const density = config?.layout?.homeDensity === 'compact' ? '0.75' : '1';

  return {
    '--color-primary': accent,
    '--color-primary-hover': dark ? '#93c5fd' : '#2563eb',
    '--color-bg': dark ? '#0b1220' : '#ffffff',
    '--color-bg-secondary': dark ? '#111a2b' : '#f6f8fb',
    '--color-fg': dark ? '#e5edf8' : '#0f172a',
    '--color-fg-muted': dark ? '#94a3b8' : '#64748b',
    '--color-border': dark ? '#22304a' : '#e2e8f0',
    '--radius-sm': `${Math.max(0, radius - 6)}px`,
    '--radius-md': `${radius}px`,
    '--radius-lg': `${radius + 6}px`,
    '--mist-home-scale': density
  };
}
```

### 11.4 `theme.css`

```css
:root {
  --color-primary: #3b82f6;
  --color-primary-hover: #2563eb;
  --color-bg: #ffffff;
  --color-bg-secondary: #f6f8fb;
  --color-fg: #0f172a;
  --color-fg-muted: #64748b;
  --color-border: #e2e8f0;
  --radius-sm: 4px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --mist-home-scale: 1;
}

.mist-shell {
  background: var(--color-bg);
  color: var(--color-fg);
  font-feature-settings: "kern" 1, "liga" 1;
}

.mist-hero {
  position: relative;
  padding: clamp(3rem, 9vw, 7rem) 1rem clamp(2.5rem, 7vw, 6rem);
  border-bottom: 1px solid var(--color-border);
  overflow: hidden;
}

.mist-hero::before {
  content: "";
  position: absolute;
  inset: -30% -10% auto;
  height: 70%;
  background:
    radial-gradient(40% 60% at 20% 40%, color-mix(in srgb, var(--color-primary) 18%, transparent), transparent 70%),
    radial-gradient(35% 50% at 80% 20%, color-mix(in srgb, var(--color-primary) 10%, transparent), transparent 70%);
  pointer-events: none;
}

.mist-hero-inner {
  position: relative;
  max-width: 48rem;
  margin: 0 auto;
  text-align: center;
}

.mist-title {
  font-size: clamp(2.25rem, 6vw, 4.5rem);
  line-height: 1.05;
  letter-spacing: -0.03em;
  font-weight: 800;
}

.mist-subtitle {
  margin-top: 1rem;
  color: var(--color-fg-muted);
  font-size: clamp(0.95rem, 2vw, 1.15rem);
}

.mist-stats {
  margin-top: 1.5rem;
  display: inline-flex;
  gap: 0.5rem;
  padding: 0.4rem 0.9rem;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  color: var(--color-fg-muted);
  font-size: 0.8rem;
}

.mist-section-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.mist-grid {
  display: grid;
  gap: calc(1.25rem * var(--mist-home-scale));
}

@media (min-width: 768px) {
  .mist-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.mist-card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-bg);
  transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.35s, box-shadow 0.35s;
}

.mist-card:hover {
  transform: translateY(-3px);
  border-color: color-mix(in srgb, var(--color-primary) 40%, var(--color-border));
  box-shadow: 0 18px 40px -24px color-mix(in srgb, var(--color-fg) 35%, transparent);
}

.mist-card-cover {
  aspect-ratio: 16 / 9;
  width: 100%;
  object-fit: cover;
  transition: transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}

.mist-card:hover .mist-card-cover {
  transform: scale(1.04);
}

.mist-card-fallback {
  aspect-ratio: 16 / 9;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 20%, transparent), transparent 60%),
    var(--color-bg-secondary);
}

.mist-card-body {
  padding: 1.15rem 1.25rem 1.35rem;
}

.mist-card-title {
  font-size: 1.05rem;
  font-weight: 700;
  line-height: 1.45;
}

.mist-card-summary {
  margin-top: 0.5rem;
  color: var(--color-fg-muted);
  font-size: 0.875rem;
  line-height: 1.7;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.mist-meta {
  margin-top: 0.9rem;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  color: var(--color-fg-muted);
  font-size: 0.75rem;
}

.mist-pill {
  border: 1px solid var(--color-border);
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
}

.mist-notice {
  display: flex;
  gap: 0.75rem;
  margin-top: 1.5rem;
  padding: 1rem 1.1rem;
  border: 1px solid color-mix(in srgb, var(--color-primary) 35%, var(--color-border));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-primary) 6%, var(--color-bg));
}

.mist-notice-dot {
  width: 0.5rem;
  height: 0.5rem;
  margin-top: 0.4rem;
  flex: none;
  border-radius: 999px;
  background: var(--color-primary);
}

.mist-prose {
  margin-top: 2rem;
}

.mist-toc-mobile {
  margin-top: 1.5rem;
}

@media (min-width: 1024px) {
  .mist-toc-mobile {
    display: none;
  }
}
```

### 11.5 `templates/layout.tsx`

```tsx
import type { LayoutTemplateProps } from '@rainynest/plugin-types';

export default function LayoutTemplate({
  header,
  sidebar,
  footer,
  footerNodes,
  children,
}: LayoutTemplateProps) {
  return (
    <div className="mist-shell min-h-screen flex flex-col">
      {header}

      <div className="mx-auto grid w-full max-w-7xl flex-1 gap-10 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_260px]">
        <main className="min-w-0">{children}</main>
        <aside className="hidden lg:block">
          <div className="sticky top-20">{sidebar}</div>
        </aside>
      </div>

      {footerNodes}
      {footer}
    </div>
  );
}
```

### 11.6 `templates/home.tsx`

```tsx
import type { HomeTemplateProps } from '@rainynest/plugin-types';

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

export default function HomeTemplate({ site, posts, total }: HomeTemplateProps) {
  return (
    <div>
      <section className="mist-hero anim-fade-in">
        <div className="mist-hero-inner">
          <h1 className="mist-title anim-fade-in-up">{site.title}</h1>
          {site.subtitle && (
            <p className="mist-subtitle anim-fade-in-up" style={{ animationDelay: '80ms' }}>
              {site.subtitle}
            </p>
          )}
          <p className="mist-stats anim-scale-in" style={{ animationDelay: '160ms' }}>
            <span>{total} 篇文章</span>
            {site.url && (
              <>
                <span aria-hidden="true">·</span>
                <span>{site.url.replace(/^https?:\/\//, '')}</span>
              </>
            )}
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 py-12">
        <div className="mist-section-title">
          <h2 className="text-xl font-bold tracking-tight">最新文章</h2>
          <a href="/blog" className="text-sm text-primary transition-opacity hover:opacity-70">
            全部文章
          </a>
        </div>

        {posts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line p-14 text-center text-sm text-fg-muted">
            还没有文章
          </div>
        ) : (
          <div className="mist-grid stagger">
            {posts.map((post) => (
              <a key={post.id} href={`/blog/${post.slug}`} className="mist-card group">
                {post.coverImage ? (
                  <img
                    src={post.coverImage}
                    alt={post.title}
                    className="mist-card-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="mist-card-fallback" aria-hidden="true" />
                )}

                <div className="mist-card-body">
                  <div className="flex items-center gap-2">
                    {post.isTop && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        置顶
                      </span>
                    )}
                    {post.category && (
                      <a
                        href={`/categories/${post.category.slug}`}
                        className="text-xs text-primary hover:opacity-70"
                      >
                        {post.category.name}
                      </a>
                    )}
                  </div>

                  <h3 className="mist-card-title mt-1.5 transition-colors group-hover:text-primary">
                    {post.title}
                  </h3>

                  {post.summary && <p className="mist-card-summary">{post.summary}</p>}

                  <div className="mist-meta">
                    <time dateTime={new Date(post.publishedAt || post.createdAt).toISOString()}>
                      {formatDate(post.publishedAt || post.createdAt)}
                    </time>
                    <span aria-hidden="true">·</span>
                    <span>{post.views} 次阅读</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
```

### 11.7 `templates/post.tsx`

```tsx
import type { ComponentType, ReactNode } from 'react';
import type { PostDetailTemplateProps } from '@rainynest/plugin-types';
import { resolvePluginTemplate } from '@/lib/plugin/theme-integration';

interface NoticeCardProps {
  label?: string;
  children?: ReactNode;
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

export default async function PostTemplate({
  post,
  html,
  commentsCount,
  slots,
}: PostDetailTemplateProps) {
  const mod = await resolvePluginTemplate('notice', 'notice-card');
  const Notice = mod && typeof mod === 'object'
    ? (mod as { default?: ComponentType<NoticeCardProps> }).default
    : null;

  return (
    <article className="mx-auto max-w-3xl">
      <header className="anim-fade-in-up">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {post.category && (
            <a href={`/categories/${post.category.slug}`} className="text-primary hover:opacity-70">
              {post.category.name}
            </a>
          )}
          <span className="text-fg-muted">/</span>
          <span className="text-fg-muted">{formatDate(post.date)}</span>
        </div>

        <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight md:text-4xl">
          {post.title}
        </h1>

        <div className="mist-meta mt-4">
          <span>{post.author}</span>
          <span aria-hidden="true">·</span>
          <span>{post.views} 次阅读</span>
          <span aria-hidden="true">·</span>
          <span>{commentsCount} 条评论</span>
        </div>
      </header>

      {post.coverImage && (
        <img
          src={post.coverImage}
          alt={post.title}
          className="mt-7 w-full rounded-xl object-cover anim-scale-in"
        />
      )}

      <div className="mist-toc-mobile">{slots.tocMobile}</div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="min-w-0">
          <div
            className="markdown-body mist-prose anim-fade-in"
            dangerouslySetInnerHTML={{ __html: html }}
          />

          {Notice && <Notice label={post.title} />}

          {slots.contentBlocks}

          <section className="mt-12 border-t border-line pt-8">{slots.comments}</section>
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-20">{slots.tocDesktop}</div>
        </aside>
      </div>

      {post.tags.length > 0 && (
        <ul className="mt-10 flex flex-wrap gap-2 border-t border-line pt-6">
          {post.tags.map((tag) => (
            <li key={tag.slug}>
              <a
                href={`/blog/tag/${encodeURIComponent(tag.name)}`}
                className="mist-pill text-xs text-fg-muted transition-colors hover:border-primary hover:text-primary"
              >
                {tag.name}
              </a>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
```

说明：

- 该模板是异步服务端组件。
- 依赖 `@/lib/plugin/theme-integration`，必须走构建期注册表。
- `Notice` 的优先级由 `resolvePluginTemplate` 决定。
- 如果插件未安装，`Notice` 为 `null`，页面正常渲染。
- 如果主题覆盖模板存在但没有默认导出，解析器会继续尝试运行时编译并回退插件默认模板；最终仍可能返回 `null`，因此必须判空。

### 11.8 `templates/archive.tsx`

```tsx
import type { ArchiveTemplateProps } from '@rainynest/plugin-types';

export default function ArchiveTemplate({ total, years }: ArchiveTemplateProps) {
  return (
    <div className="mx-auto max-w-3xl">
      <header className="anim-fade-in-up">
        <h1 className="text-3xl font-bold tracking-tight">归档</h1>
        <p className="mt-2 text-sm text-fg-muted">共 {total} 篇文章</p>
      </header>

      {years.length === 0 ? (
        <div className="mt-12 rounded-xl border border-dashed border-line p-14 text-center text-sm text-fg-muted">
          暂无文章
        </div>
      ) : (
        <div className="mt-10 space-y-12">
          {years.map((group) => (
            <section key={group.year}>
              <div className="flex items-baseline gap-3">
                <h2 className="text-2xl font-bold tracking-tight">{group.year}</h2>
                <span className="text-xs text-fg-muted">{group.posts.length} 篇</span>
              </div>

              <ul className="mt-5 space-y-1 border-l border-line">
                {group.posts.map((post) => (
                  <li key={post.id}>
                    <a
                      href={`/blog/${post.slug}`}
                      className="group -ml-px flex items-baseline gap-4 border-l border-transparent py-2 pl-4 transition-colors hover:border-primary"
                    >
                      <time className="w-14 shrink-0 text-xs tabular-nums text-fg-muted">
                        {new Date(post.date).toLocaleDateString('zh-CN', {
                          month: '2-digit',
                          day: '2-digit'
                        })}
                      </time>
                      <span className="text-sm transition-colors group-hover:text-primary">
                        {post.title}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
```

### 11.9 `templates/plugins/notice/notice-card.tsx`

```tsx
import type { ReactNode } from 'react';

interface NoticeCardProps {
  label?: string;
  children?: ReactNode;
}

export default function NoticeCardOverride({ label, children }: NoticeCardProps) {
  return (
    <aside className="mist-notice anim-fade-in-up">
      <span className="mist-notice-dot" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-semibold">
          {label ? `关于《${label}》的提醒` : '来自主题的提醒'}
        </p>
        <p className="mt-1 text-sm leading-relaxed text-fg-muted">
          {children || '这是主题覆盖后的通知卡片，优先级高于插件默认模板。'}
        </p>
      </div>
    </aside>
  );
}
```

### 11.10 配套插件 `plugin.json`

```json
{
  "specVersion": "1.0",
  "slug": "notice",
  "name": "通知卡片",
  "version": "0.1.0",
  "description": "提供可被主题覆盖的通知卡片模板",
  "author": "RainyNest",
  "entry": "index.js"
}
```

### 11.11 配套插件 `index.ts`

```ts
import type { ExtensionHandlers, PluginContext } from '@rainynest/plugin-types';

export default function noticePlugin(_ctx: PluginContext): ExtensionHandlers {
  return {
    providesTemplates: ['notice-card']
  };
}
```

### 11.12 配套插件默认模板 `templates/notice-card.tsx`

```tsx
import type { ReactNode } from 'react';

interface NoticeCardProps {
  label?: string;
  children?: ReactNode;
}

export default function NoticeCard({ label, children }: NoticeCardProps) {
  return (
    <aside
      style={{
        marginTop: '1.5rem',
        padding: '1rem 1.1rem',
        border: '1px solid #cbd5e1',
        borderRadius: '8px',
        background: '#f8fafc'
      }}
    >
      <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600 }}>
        {label || '通知'}
      </p>
      <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: '#64748b' }}>
        {children || '这是插件默认模板。安装并启用 mist 主题后，会被主题覆盖。'}
      </p>
    </aside>
  );
}
```

插件默认模板故意使用内联样式，避免 `scripts/plugins/**` 不在 Tailwind 扫描范围导致类名失效。

### 11.13 构建与安装顺序

1. 构建插件：

```bash
cd notice
npm install
npm run pack
# dist/notice.gz.rainy-plugin
```

2. 在后台安装插件，先不要启用也可以。

3. 构建主题：

```bash
cd mist
npm install
npm run pack
# dist/mist.gz.rainy-theme
```

4. 在后台安装主题并启用。

5. 重启宿主：

```bash
# 主项目
npm run dev
# 或生产
npm run build
npm run start
```

6. 执行注册表生成，确认两条模板都存在：

```bash
npm run theme:registry
```

检查 `lib/theme/generated-templates.ts`：

```ts
themeTemplateRegistry['mist']['post']
themeTemplateRegistry['mist']['plugins/notice/notice-card']
pluginTemplateRegistry['notice']['notice-card']
```

7. 打开首页、文章页、归档页：

- `/` 使用 `mist/templates/home.tsx`
- `/blog/<slug>` 使用 `mist/templates/post.tsx`，并在正文后显示主题覆盖的通知卡片
- `/archive` 使用 `mist/templates/archive.tsx`

8. 验证覆盖优先级：

- 删除主题里的 `templates/plugins/notice/notice-card.tsx`，重启。
- 文章页应显示插件的默认通知卡片。
- 恢复主题覆盖，重启。
- 文章页应显示 `mist-notice` 样式。

### 11.14 这个示例覆盖了什么

| 能力 | 文件 |
|---|---|
| 整体壳 | `templates/layout.tsx` |
| 首页 | `templates/home.tsx` |
| 文章详情 | `templates/post.tsx` |
| 归档 | `templates/archive.tsx` |
| 插件模板覆盖 | `templates/plugins/notice/notice-card.tsx` |
| 设置 schema | `theme.json` |
| 设置到 CSS 变量 | `src/theme.ts` |
| 全局样式 | `theme.css` |
| 插件默认模板 | `notice/templates/notice-card.tsx` |
| 插件模板声明 | `notice/index.ts` |

---

## 12. FAQ 与已知限制

### 12.1 模板没有生效，怎么排查

按顺序检查：

1. 文件名是否为 `templates/<模板名>.tsx`，全部小写，连字符风格。
2. 是否有 `export default`。
3. 是否重启了 `npm run dev` 或重新 `npm run build`。
4. `lib/theme/generated-templates.ts` 中是否有对应 key。
5. 控制台是否有 `[Theme]` 或 `[theme-registry]` 日志。
6. 模板是否抛错导致页面回退内置模板。
7. 是否把模板放进了子目录；系统模板只扫描第一层。
8. 是否把 `post.tsx` 写成了 `post_detail.tsx` 或 `Post.tsx`。
9. 主题是否已激活；系统模板只解析激活主题。
10. 生产环境是否在安装后重新 build。

### 12.2 一共有多少个模板

`ThemeTemplateMap` 中有 18 个 key：

```
layout, home, post-list, post, post-detail, page, archive,
categories, category, tags, tag, search, moments, moment,
links, gallery, photo, error
```

其中 `post` 和 `post-detail` 契约相同，`post-detail` 是兼容别名。实际文件可以只有 17 个，因为 `post` 解析会自动尝试 `post-detail.tsx`。

### 12.3 预览页为什么和正式页面不一样

当前预览实现：

- 只渲染目标主题的 `home` 模板。
- 不应用目标主题的 `layout`。
- 页面位于当前激活站点的 `app/(site)/layout.tsx` 内部。
- 会加载目标主题的 `theme.css`、动态变量和 `customCss`。
- 不加载目标主题的 `customJs`。
- 其他路由仍使用当前激活主题。

因此预览适合看首页视觉和 CSS 变量，不适合验证 layout、文章页、归档页或客户端交互。

### 12.4 预览接口为什么没有 DELETE

`app/api/console/themes/preview/route.ts` 只实现了 GET。预览不需要退出：

- 接口不写 cookie。
- 不修改数据库。
- 不修改激活主题。
- 预览状态完全由 URL 查询参数 `?theme=<slug>` 决定。

关闭预览页即可，没有服务端状态需要清理。

### 12.5 修改 `theme.js` 后没有生效

Node 的 `require` 按绝对路径缓存模块。`clearThemeCache()` 只清理 `getActiveTheme` 的内存缓存，不清理 `require.cache`。

处理：

- 重启宿主进程。
- 或在开发时改为每次读取并执行 `theme.js` 的文本，但这会带来安全与性能问题，不推荐。
- 重新安装同版本主题也会被版本校验拒绝，必须先提升版本并重启。

### 12.6 修改 `theme.css` 后没有生效

`app/themes/[slug]/[...path]/route.ts` 返回：

```
Cache-Control: public, max-age=300
```

浏览器可能缓存 5 分钟。处理：

- 硬刷新。
- 在 URL 后加版本参数，但宿主固定拼接 `/themes/<slug>/theme.css`，主题无法控制。
- 重新安装并提升版本后仍可能被浏览器缓存；开发时使用禁用缓存的 DevTools 选项。

### 12.7 `specVersion` 到底写什么

写 `"1.0"`。

原因：

- 安装器 `lib/ext-installer.ts` 要求：如果存在 `specVersion`，必须等于 `"1.0"`。
- CLI 校验器 `tools/ext-cli/lib/validate.js` 缺省补 `"1.0"`，且只支持 `"1.0"`。
- 脚手架模板与示例统一写 `"1.0"`。
- `specVersion` 是清单格式版本，不是 SPI 或 `@rainynest/plugin-types` 的版本。
- 也可以完全不写该字段，安装器允许缺失。

### 12.8 `supports` 和 `minRainyNestVersion` 有用吗

当前代码：

- `supports` 不被任何运行时逻辑读取，只是声明。
- `minRainyNestVersion` 不被校验，不会阻止安装或激活。
- 不要依赖它们实现兼容性保护。

### 12.9 为什么 `image` 字段是文本框

`ConfigForm` 没有媒体库分支。`type: "image"` 会落入默认 `text` 输入。当前支持的媒体选择能力不存在。

替代方案：

- 用 `text` 或 `url` 字段填写图片地址。
- 主题在渲染时做空值判断。
- 如果需要媒体库，需要先扩展宿主后台表单，而不是主题层能解决的。

### 12.10 字段说明为什么不显示

`ConfigField` 的说明字段是 `help`，不是 `description`。

```json
{
  "type": "text",
  "label": "标题",
  "help": "显示在控件下方"
}
```

`ConfigGroup` 上的 `description` 当前同样不会显示；分组只渲染 `label`。

### 12.11 `customJs` 在哪里执行

根布局把 `customJs` 作为内联 `<script>` 注入 `<head>`，不是 `</body>` 前。脚本执行时 DOM 可能尚未就绪。

建议：

```js
document.addEventListener('DOMContentLoaded', function () {
  // 操作 DOM
});
```

不要假设 `document.body` 已经存在。

### 12.12 主题能不能自带暗色切换

当前宿主没有暗色切换器，也没有 `ThemeProvider`。`viewport.colorScheme` 固定为 `light`。

可行方案：

- 后台 `bgMode` 配置，保存后 SSR 输出深色变量。
- 主题自带客户端切换组件，使用 `localStorage` 和 `data-theme`，需要构建期注册表。
- 主题自带切换组件无法插入 Header 内部，只能放在 Header 外部或覆盖层。

### 12.13 插件模板为什么没有显示

`resolvePluginTemplate` 当前没有任何内置页面调用点。仅提供文件不会自动渲染。

必须由主题模板、插件自定义前台逻辑或站点自定义代码显式调用：

```ts
const mod = await resolvePluginTemplate('notice', 'notice-card');
```

另外，解析器不检查插件是否在数据库中启用，只检查磁盘和注册表。即使插件未启用，只要模板文件存在，也会被返回。这是当前实现的一个行为特点，不要把它当作权限边界。

### 12.14 插件模板的 Tailwind 类不生效

`tailwind.config.ts` 只扫描：

```
./scripts/themes/**/templates/**/*.{ts,tsx}
```

不扫描：

```
./scripts/plugins/**/templates/**/*.{ts,tsx}
```

因此插件默认模板不要依赖新的 Tailwind 类。使用内联样式、插件自带 CSS，或只使用宿主已生成的类。

### 12.15 为什么 `.gif`、`.ico`、`.otf` 装不进去

资源路由能返回这些类型，但安装器白名单没有它们：

```
.js .tsx .json .css .png .jpg .jpeg .svg .webp .sql .md .txt .woff .woff2 .ttf
```

打包器 `tools/ext-cli/lib/pack.js` 使用同一份白名单，所以这些文件在打包阶段就会被丢弃。

替代：

- `.gif` 转 `.webp` 或 `.png`。
- `.ico` 转 `.png` 或 `.svg`。
- `.otf` 转 `.woff2`。

### 12.16 `post-detail.tsx` 转发 `post.tsx` 在运行时失效

运行时兜底只做单文件 transform，不解析相对导入。下面写法只在注册表模式有效：

```tsx
export { default } from './post';
```

如果希望未重启也能工作，把文章模板直接写在 `post.tsx`，不要使用 `post-detail.tsx` 转发。

### 12.17 独立页面出现双份侧边栏

主题覆盖 `page` 后，默认页面里的隐藏侧边栏内联样式不会执行。`layout` 仍然渲染宿主 Sidebar。

主题需要根据 `page.showSidebar` 和 `page.sidebarHtml` 自行输出隐藏规则：

```tsx
{(!page.showSidebar || page.sidebarHtml) && (
  <style>{'@media (min-width:1280px){[data-site-sidebar]{display:none!important}}'}</style>
)}
```

### 12.18 侧边栏标签链接可能 404

当前宿主 Sidebar 的标签云使用：

```
/tags/<slug>
```

但 `app/(site)` 只有：

```
/tags
/blog/tag/[name]
```

没有 `/tags/[slug]` 路由。主题自己的标签链接应统一使用：

```
/blog/tag/<encodeURIComponent(name)>
```

这是宿主侧边栏的既有问题，不是模板契约要求。

### 12.19 文章评论数为什么偏少

`commentsCount` 来自顶层评论查询的 `length`，不包含回复。它用于头部展示，不是全站评论总数。

### 12.20 预览图路径为什么变成 `/themes/...`

`normalizePreview` 的规则：

| `theme.json` 写法 | 结果 |
|---|---|
| `"preview.png"` | `/themes/<目录slug>/preview.png` |
| `"./preview.png"` | `/themes/<目录slug>/preview.png` |
| `"assets/cover.webp"` | `/themes/<目录slug>/assets/cover.webp` |
| `"/preview.png"` | `/preview.png` |
| `"https://cdn.example.com/a.png"` | 原样 |
| `"//cdn.example.com/a.png"` | 原样 |
| 空字符串 | 不处理 |

注意：以 `/` 开头会被视为站点绝对路径，不会加主题前缀。

### 12.21 目录名和 `slug` 不一致会怎样

- 安装器使用清单里的 `slug` 作为安装目录名，所以后台上传不会不一致。
- 手动放置时，扫描使用目录名作为 `dirSlug`，预览图前缀使用目录名。
- `ThemeMeta.slug` 仍来自 `theme.json`。
- 激活主题时数据库记录的 slug 可能来自后台列表逻辑，容易错位。

建议永远保持目录名、清单 `slug`、数据库 slug 三者一致。

### 12.22 配置保存后字段丢失

保存链路会按 `configSchema` 重组，只保留 schema 中声明的分组和字段。以下都会被丢弃：

- 未声明的字段。
- 拼错字段名。
- 未声明分组。
- 通过 `customJs` 动态写入的未知配置。

### 12.23 `configToCssVariables` 抛错会怎样

`loadThemeBySlugSync` 在 try 之外调用它：

```ts
const cssVars = configToVars(mergedConfig);
```

一旦抛错：

- `getActiveTheme` 捕获后返回 `null`。
- 整站回退无主题状态。
- `theme.css` 仍会尝试加载 `/themes/default/theme.css`。
- 主题配置页面可能仍能打开，但前台样式全丢。

因此函数必须防御性读取，不要假设分组一定存在。

### 12.24 主题 CSS 会不会影响后台

不会。主题 CSS 只在 `app/(site)` 根布局和预览页注入，`/console` 不受影响。

### 12.25 主题能不能新增页面或 API

不能。主题只覆盖系统模板，不参与路由注册。需要新页面时：

- 用插件扩展点。
- 或修改宿主 `app/` 路由（这已经超出主题范围）。

### 12.26 未重启安装的主题为什么只能用服务端 JSX

运行时路径使用 `esbuild.transform`，不是 `build`：

- 不解析 `@/`。
- 不解析相对模块。
- 不建立客户端边界。
- 不处理 CSS/图片导入。
- 只把单文件 TSX 转成 CommonJS。

因此可以写：

```tsx
export default function Home({ posts }: HomeTemplateProps) {
  return <div>{posts.map((post) => <a key={post.id}>{post.title}</a>)}</div>;
}
```

不能写：

```tsx
'use client';
import { useState } from 'react';
import { PostCard } from '@/components/post/PostCard';
```

### 12.27 `theme.css` 缺失会报错吗

不会。资源路由返回 404，浏览器忽略该样式表。主题仍然可以只依赖 CSS 变量和 Tailwind 类。

### 12.28 安装包里有 `plugin.json` 和 `theme.json` 会怎样

安装器优先看 `plugin.json`：

```ts
const kind = hasPluginJson ? 'plugin' : 'theme';
```

只要根目录有 `plugin.json`，包就会按插件安装，即使同时有 `theme.json`。不要把两种清单混在一个包里。

### 12.29 gz 打包依赖系统 `tar`

安装器解压 `.gz.rainy-theme` 时调用：

```bash
tar -xzf <tmp> -C <dest>
```

Windows 10 及以上自带 bsdtar。精简容器或缺少 `tar` 的环境应使用 `.zip.rainy-theme`。

### 12.30 `ext dev` 需要什么

- 主项目 `.env` 中的 `EXT_DEV_TOKEN`。
- 主项目已经启动并能访问 `/api/console/extensions/dev-install`。
- `--site` 指向正确地址。
- 打包产物文件名符合 `*.zip.rainy-theme` 或 `*.gz.rainy-theme`。

### 12.31 已知限制汇总

| 限制 | 说明 |
|---|---|
| 没有模板继承 | 用 React 组件复用，不要期待 FreeMarker 式继承 |
| 没有主题自定义路由 | 路由属于宿主和插件 |
| 没有媒体库字段 | `image` 类型退化为文本输入 |
| 没有宿主暗色切换 | 只有配置变量或主题自建客户端切换 |
| 预览只覆盖首页 | 不应用目标主题 layout，不预览其他页面 |
| 预览不写 cookie | 无法通过预览改变全站状态 |
| 预览无 DELETE | 只支持 GET |
| 插件模板不自动渲染 | 必须显式调用 `resolvePluginTemplate` |
| 插件模板不参与 Tailwind 扫描 | 使用内联样式或自带 CSS |
| 运行时兜底不支持 `@/` | 新装模板需重启获得完整能力 |
| 运行时兜底不支持客户端组件 | `'use client'` 需要注册表 |
| `theme.js` 有 Node 模块缓存 | 修改后需重启 |
| `theme.css` 缓存 5 分钟 | 浏览器可能短时间使用旧样式 |
| `supports` 无语义 | 仅声明 |
| `minRainyNestVersion` 不校验 | 仅保存 |
| `specVersion` 只支持 `1.0` | 安装器与 CLI 一致，旧值会被拒绝 |
| `requiresCore` 不适用于主题 | 主题清单没有该字段；版本要求只靠 `minRainyNestVersion`，且当前不校验 |
| 安装白名单不含 gif/ico/otf | 资源路由支持但装不进去 |
| 配置未知字段被丢弃 | 保存按 schema 重组 |
| `configToCssVariables` 抛错会丢主题 | 必须防御性读取 |
| 页面模板无法直接隐藏宿主侧边栏 | 需要自行输出 style |
| 插件解析不检查启用状态 | 只看磁盘和注册表 |
| 主题代码无沙箱 | 只安装可信主题 |

### 12.32 提交主题前的检查清单

- [ ] `theme.json` 的 `slug`、`name`、`version` 完整。
- [ ] `specVersion` 为 `"1.0"` 或不写。
- [ ] `preview` 能被 `normalizePreview` 正确解析。
- [ ] `configSchema` 每个字段都有 `label`。
- [ ] 说明文字使用 `help`，不是 `description`。
- [ ] `customCss`、`customJs` 位于 `advanced` 分组。
- [ ] `theme.js` 导出 `configToCssVariables`，且不会抛错。
- [ ] `theme.js` 输出至少包含语义颜色变量。
- [ ] `theme.css` 只使用主题前缀类名。
- [ ] `templates/` 文件名全部小写。
- [ ] 每个模板都有默认导出。
- [ ] `layout` 渲染了 `children` 和 `footerNodes`。
- [ ] 文章模板把 `html` 包在 `.markdown-body` 中。
- [ ] 模板中的标签链接使用 `/blog/tag/<name>`。
- [ ] 客户端组件只在注册表模式使用，并已重启验证。
- [ ] 插件覆盖模板与插件默认模板 Props 一致。
- [ ] 插件模板不依赖新增 Tailwind 类。
- [ ] 包内没有 `.ts` 源文件依赖。
- [ ] 包体积小于 20MB。
- [ ] 在干净环境安装、启用、重启、预览、卸载各验证一次。

### 12.33 18 个模板覆盖自检

| 模板 | 本文小节 | 是否给出 Props 表 | 是否给出最小示例 |
|---|---|---|---|
| `layout` | 7.1、8 | 是 | 是 |
| `home` | 7.2 | 是 | 是 |
| `post-list` | 7.3 | 是 | 是 |
| `post` | 7.4 | 是 | 是 |
| `post-detail` | 7.5 | 是 | 是 |
| `page` | 7.6 | 是 | 是 |
| `archive` | 7.7 | 是 | 是 |
| `categories` | 7.8 | 是 | 是 |
| `category` | 7.9 | 是 | 是 |
| `tags` | 7.10 | 是 | 是 |
| `tag` | 7.11 | 是 | 是 |
| `search` | 7.12 | 是 | 是 |
| `moments` | 7.13 | 是 | 是 |
| `moment` | 7.14 | 是 | 是 |
| `links` | 7.15 | 是 | 是 |
| `gallery` | 7.16 | 是 | 是 |
| `photo` | 7.17 | 是 | 是 |
| `error` | 7.18 | 是 | 是 |








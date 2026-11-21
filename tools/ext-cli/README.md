# @rainynest/ext

RainyNest 插件/主题开发 CLI。

## 快速开始

```bash
npm create rainynest-ext my-plugin   # 生成插件工程（推荐）
cd my-plugin && npm install
npm run dev                          # 联调热更新
npm run pack                         # 产出发布包
```

## 命令

| 命令 | 作用 |
|---|---|
| `ext new plugin\|theme <名称>` | 在当前目录生成模板工程 |
| `ext build <目录> -o dist` | esbuild 编译 → 安装态产物 |
| `ext build-all --src . --out ../scripts` | 全量编译多扩展目录 |
| `ext pack <目录> [--format zip\|gz]` | 打发布包（`.zip.rainy-plugin` / `.gz.rainy-theme`） |
| `ext dev <目录> --site <url>` | watch 编译 + 热更新（需 `EXT_DEV_TOKEN`） |

## 说明

- 类型定义请安装 `@rainynest/plugin-types`（主题模板类型见 `ThemeTemplateMap`）
- 插件/主题包上传到 RainyNest 后台「系统 → 插件 / 主题」即可安装
- 主题 `templates/**/*.tsx` 会原样进入发布包（打包白名单已包含 `.tsx`）；已安装主题由宿主构建期注册表编译，支持 `@/` 别名与 `'use client'`，新装未重启时运行时兜底

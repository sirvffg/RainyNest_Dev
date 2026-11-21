# 扩展开发套件发布指南

面向 RainyNest 扩展生态的三个 npm 包，发布到 npm 官方源。

| 包名 | 目录 | 作用 | 作用域 | 发布参数 |
|------|------|------|--------|---------|
| `@rainynest/plugin-types` | `packages/types` | 插件 / 主题 SPI 类型（纯类型包） | 有 | `--access public` |
| `@rainynest/ext` | `tools/ext-cli` | 开发 CLI：`new` / `build` / `pack` | 有 | `--access public` |
| `create-rainynest-ext` | `tools/create-rainynest-ext` | 脚手架：`npm create rainynest-ext` | 无 | 无需 `--access` |

发布认证配置：仓库根目录 `.npm-publish.npmrc`（内含 npmjs authToken，**不要提交到公开仓库**）。

---

## 一、发布前检查

```powershell
cd "d:\File\代码\网站源码\RainyNest_Dev"

# 1. 确认要发布的版本号（改完 package.json 再发）
(Get-Content "packages\types\package.json" -Raw | ConvertFrom-Json).version
(Get-Content "tools\ext-cli\package.json" -Raw | ConvertFrom-Json).version
(Get-Content "tools\create-rainynest-ext\package.json" -Raw | ConvertFrom-Json).version

# 2. 类型包需要先重新生成 index.d.ts（改了 index.ts 就必须跑）
cd "packages\types"
npm run build

# 3. 查看线上已有版本，避免重复发布
npm view @rainynest/plugin-types version --registry=https://registry.npmjs.org
npm view @rainynest/ext version --registry=https://registry.npmjs.org
npm view create-rainynest-ext version --registry=https://registry.npmjs.org
```

---

## 二、发布命令

> 用 **普通 PowerShell 窗口**（不要用受限的沙箱终端）。npm 11 会输出
> `Authenticate your account at: https://www.npmjs.com/auth/cli/...` 并等待输入，
> 此时**按回车**打开浏览器，在页面上确认授权即可（无需 6 位 OTP 验证码）。
> 按回车前命令会一直挂起，按了回车并完成浏览器确认后才会真正上传。

### 1. `@rainynest/plugin-types`（类型包）

```powershell
cd "d:\File\代码\网站源码\RainyNest_Dev\packages\types"
npm publish --access public --registry=`https://registry.npmjs.org` --userconfig "d:\File\代码\网站源码\RainyNest_Dev\.npm-publish.npmrc"
```

### 2. `@rainynest/ext`（CLI）

```powershell
cd "d:\File\代码\网站源码\RainyNest_Dev\tools\ext-cli"
npm publish --access public --registry=`https://registry.npmjs.org` --userconfig "d:\File\代码\网站源码\RainyNest_Dev\.npm-publish.npmrc"
```

### 3. `create-rainynest-ext`（脚手架，无作用域）

```powershell
cd "d:\File\代码\网站源码\RainyNest_Dev\tools\create-rainynest-ext"
npm publish --registry=`https://registry.npmjs.org` --userconfig "d:\File\代码\网站源码\RainyNest_Dev\.npm-publish.npmrc"
```

成功标志：终端最后一行输出 `+ @rainynest/plugin-types@x.y.z`（或对应包名+版本）。

---

## 三、发布后验证

```powershell
npm view @rainynest/plugin-types version --registry=https://registry.npmjs.org
npm view @rainynest/ext version --registry=https://registry.npmjs.org
npm view create-rainynest-ext version --registry=https://registry.npmjs.org
```

官方源 CDN 有几分钟缓存延迟，刚发完可能仍显示旧版本（npm 提示 `may take a few minutes`），稍等再查。

国内 `npmmirror` 镜像同步更慢，安装时如要立刻用新版可临时指定官方源：

```powershell
npm i -D @rainynest/plugin-types --registry=https://registry.npmjs.org
```

---

## 四、常见问题

| 报错 | 原因 | 处理 |
|------|------|------|
| `EOTP: This operation requires a one-time password` | 当前环境无法弹浏览器 / npm 版本低于 11 | 换普通 PowerShell（npm ≥ 11 走浏览器认证）；或在 https://www.npmjs.com/settings/~/tokens 生成 Automation Token 改写 `.npm-publish.npmrc` |
| `E403: You do not have permission to publish` | 登录账号不是 `@rainynest` org 成员 | 用有权限的账号重新生成 token 写入 `.npm-publish.npmrc` |
| `EPUBLISHCONFLICT` / `cannot publish over` | 该版本号已存在（npm 不允许覆盖） | 改 `package.json` 版本号后重发 |
| `command failed` 卡在 `Press ENTER to open in the browser...` | 还没按回车 | 按回车，完成浏览器授权 |
| 忘记加 `--access public` | 作用域包默认私有，会报权限不足 | 加上参数重发 |

---

## 五、版本号约定

- 纯类型新增 / 兼容性补充 → patch 或 minor（如 `0.2.0` → `0.3.0`）
- 破坏性变更（删字段、改签名）→ minor（0.x 阶段）并在 README 标注迁移说明
- 三个包版本互相独立，按各自改动分别递增

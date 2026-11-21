# RainyNest API 参考

本文档面向第三方开发者，描述 RainyNest（Next.js 15 App Router + NextAuth 5 + Prisma/SQLite）当前代码中实际存在的 HTTP API。所有路径、字段、状态码均以仓库源码为准；源码中不存在的接口不会出现在本文档中。

- 代码版本基线：`d:\File\代码\网站源码\RainyNest`
- 路由范围：`app/api/**/route.ts`，共 63 个路由文件、96 个导出的方法处理函数
- 数据存储：主库 `db/blog.db`（Prisma schema `prisma/schema.prisma`），统计库 `db/analytics.db`（`prisma-analytics/analytics.prisma`）
- 插件 API 中间件：`lib/plugin/api-gate.ts` → `lib/plugin/engine.ts` 的 `runApiMiddlewares`
- 鉴权辅助：`lib/api-auth.ts`（`requireSession` / `hasPermission` / `requirePermission`）
- 参数校验：`zod`

---

## 1. 通用约定

### 1.1 Base URL

所有接口均位于同一个 Next.js 应用下，Base URL 取决于部署地址（本地开发默认 `http://localhost:3000`）：

```
{BASE_URL}/api/...
```

示例：`http://localhost:3000/api/posts`。

### 1.2 请求与响应格式

| 项目 | 约定 |
| --- | --- |
| 字符集 | UTF-8 |
| 请求体 | `Content-Type: application/json`（上传接口为 `multipart/form-data`；NextAuth 的凭据回调为 `application/x-www-form-urlencoded`） |
| 响应体 | `application/json`（SSE 为 `text/event-stream`；备份下载为 `application/zip`；主题 Git 安装可能返回纯文本日志） |
| 字段命名 | camelCase，与 Prisma 模型字段一致 |
| 日期时间 | ISO 8601 字符串，UTC，例如 `2026-11-21T08:30:00.000Z` |
| 空值 | JSON `null` |
| 布尔值 | JSON `true` / `false`（注意：部分字段在数据库中以 `0/1` 存储，但 Prisma 序列化为布尔） |

### 1.3 分页

不同接口的分页参数与响应结构并不完全统一，真实情况如下：

| 接口 | 查询参数 | 响应结构 |
| --- | --- | --- |
| `GET /api/posts` | `keyword`、`status`（仅登录后生效）、`page`（默认 1）、`size`（默认 10，最大 100） | `{ list, total, operations, fields }` |
| `GET /api/comments`（传 `postId`） | 无分页 | `{ list, total }`（`total` 为返回的评论条数，含回复） |
| `GET /api/comments`（不传 `postId`） | `page`（默认 1）、`size`（默认 20，最大 100）、`status` | `{ list, total, operations, replyOperations }` |
| `GET /api/moments` | `page`（默认 1）、`size`（默认 20，最大 100）、`status`（仅登录后生效） | `{ list, total }` |
| `GET /api/console/users` | 无分页（全量） | `{ list, roles, tabs }` |
| `GET /api/console/attachments` | `page`（默认 1）、`size`（默认 24，最大 60）、`q` | `{ list, total, page, size, pages, tabs, operations }` |
| `GET /api/console/backup` | 无分页 | `{ backups, tabs, operations }` |
| `GET /api/gallery` | 无分页 | `{ list }` |
| `GET /api/links` | 无分页 | `{ list }` |
| `GET /api/tags`、`GET /api/categories`、`GET /api/menu` | 无分页 | `{ list }` |

说明：

- 列表接口中未声明分页的，均一次性返回全部匹配记录（例如分类、标签、菜单、友链、相册）。
- `GET /api/posts` 使用 `page` / `size` / `status` / `q` / `category` / `tag`，但响应字段名以该接口小节为准。

### 1.4 排序

| 接口 | 排序规则 |
| --- | --- |
| 文章列表 | `isTop desc`，其次 `createdAt desc` |
| 评论（公开，传 `postId`） | `createdAt asc`（组装两级树） |
| 评论（后台） | `createdAt desc` |
| 页面 | `order asc`，其次 `createdAt desc` |
| 说说 | `createdAt desc` |
| 相册 | `createdAt desc` |
| 友链 | `order asc`，其次 `createdAt desc` |
| 菜单 | `order asc` |
| 标签 | `name asc` |
| 分类 | `name asc` |
| 附件 | `createdAt desc` |
| 登录设备 | `lastActiveAt desc` |

### 1.5 幂等性

- `POST` 类接口在业务层做唯一性检查（例如注册检查用户名/邮箱、创建分类检查 `name`/`slug`），重复提交可能返回 `409`。
- 编辑类接口（`PUT`）为整体覆盖式更新，重复提交同一请求体结果一致。
- 上传接口每次调用都会新建一条 `Attachment` 记录，不幂等。
- 统计上报 `POST /api/analytics/pv` 使用 `uniqueKey` 去重（数据库唯一约束），同一 `uniqueKey` 重复上报会被忽略。

### 1.6 错误统一格式

自有 API（`app/api/**`）的错误响应统一为：

```json
{ "error": "错误说明" }
```

- 绝大多数 `400` 直接使用 zod 的 `issues[0].message` 作为 `error`。
- `401` 固定为 `{"error":"未登录"}`。
- `403` 权限不足固定为 `{"error":"没有执行此操作的权限"}`；业务性 403 使用各自的中文说明。
- 未捕获异常返回 Next.js 默认 `500`（部分接口显式返回 `{ "error": "..." }`）。

NextAuth 内置路由（`/api/auth/*`）使用 NextAuth 自身的错误格式（重定向或 `{ "url": "..." }`），不属于上述统一格式。

### 1.7 CSRF / 同源限制

- 自有 API 路由**没有** CSRF Token 校验逻辑（代码未实现）。
- 自有 API 路由**没有**显式 Origin/Referer 同源校验（代码未实现）。
- NextAuth 的 `POST /api/auth/*`（登录、登出）带回 NextAuth 内置的 CSRF Token 校验，需要先获取 `csrfToken`。
- 会话 Cookie 采用 NextAuth 默认的 `SameSite=Lax`，跨站 `POST` 默认不携带 Cookie。

### 1.8 限流

- 验证码发送：同一 `target` + `purpose` 60 秒内只能发送一次（`lib/verification.ts`，`SEND_INTERVAL_MS = 60_000`）；超限返回 `429`。
- 其他接口：代码中无全局限流或 IP 限流（代码未实现）。
- 登录失败锁定：仅在后台用户编辑中可设置 `lockedUntil`，凭据登录本身不累加 `loginFailCount`（代码未实现自动锁定）。

### 1.9 插件 API 网关

部分核心路由在业务逻辑之前调用 `pluginApiGate(req)`（`lib/plugin/api-gate.ts`）。插件通过 `apiMiddleware` 声明：

```ts
// @rainynest/plugin-types
interface ApiMiddlewareDef {
  path?: string;   // 路径前缀，如 '/api/posts'；留空匹配全部
  methods?: ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE')[];
  handler: (req: Request, next: () => Promise<Response>) => Response | void | Promise<Response | void>;
  critical?: boolean; // 0.3.3 起：安全策略中间件，自身失败时返回 503 拒绝请求
  timeout?: number;   // 0.3.3 起：单个中间件超时毫秒数，默认 10000
}
```

- 返回 `Response` 表示拦截；返回 `void` / 调用 `next()` 表示继续（`next()` 只能调用一次，重复调用按失败策略处理）。
- 普通中间件异常 / 超时：记录日志并继续链；`critical: true` 中间件失败：返回 503（0.3.3 起）。
- 网关引擎级异常仍返回 `null` 放行并记录日志，不阻断主流程。
- 当前被网关覆盖的接口已在各小节标注「插件网关」。

### 1.10 数据库与 Prisma 字段

响应中的对象大多直接是 Prisma 查询结果，因此会带出模型全部标量字段（包括 `createdAt`、`updatedAt` 等）。本文章节中的「成功响应」示例给出实际会返回的完整字段集合；对包含数组关联的接口，给出展开后的结构。

---

## 2. 认证

认证由 NextAuth 5（JWT 策略）+ 自建 `Session` 表（登录设备记录）共同组成。

### 2.1 账号与角色

- 注册用户默认获得 `viewer` 角色（`forbidConsole = true`）。
- 登录成功后，JWT 中缓存 `sub`（用户 id）、`username`、`roles`、`permissions`、`forbidConsole`、`sessionToken`。
- `permissions` 规则：角色名为 `administrator` 时直接为 `['*']`；否则为所有角色权限名的并集。
- 每次登录成功会向 `Session` 表写入一条设备记录，`sessionToken` 写入 JWT，用于「登录设备」接口标记当前设备。
- JWT 会话默认有效期 30 天（`session-store.ts` 的 `SESSION_TTL_MS` 为 30 天；NextAuth 未显式配置 `maxAge`）。

### 2.2 Session Cookie

| 环境 | Cookie 名称 |
| --- | --- |
| HTTP（本地开发） | `authjs.session-token` |
| HTTPS | `__Secure-authjs.session-token` |
| CSRF（HTTP） | `authjs.csrf-token` |
| CSRF（HTTPS） | `__Host-authjs.csrf-token` |

Cookie 名称由 NextAuth 5 默认值决定，项目中未自定义 `cookies` 配置。

### 2.3 注册

`POST /api/auth/register`

用途：创建本地账号，默认分配 `viewer` 角色。

鉴权：公开。

请求体：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `username` | string | 是 | 无 | 3–20 字符，仅 `a-zA-Z0-9_-` |
| `email` | string | 是 | 无 | 合法邮箱，最长 100 |
| `displayName` | string | 否 | `username` | trim 后 1–30 字符 |
| `password` | string | 是 | 无 | 6–72 字符 |

成功响应 `201`：

```json
{ "ok": true, "id": "clx0a1b2c0000abcd1234efgh", "username": "alice" }
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | 请求体不是合法 JSON，或 zod 校验失败（返回首条错误信息） |
| 409 | 用户名已被占用 / 邮箱已被注册 |
| 500 | `系统未初始化 请联系管理员`（缺少内置 `viewer` 角色，需执行 seed） |

说明：该接口**未读取** `SiteSetting.allowRegister`，也**不校验**邮箱验证码；关闭注册开关仅影响前端展示，不限制此接口（代码如此）。

```powershell
curl.exe -X POST "http://localhost:3000/api/auth/register" `
  -H "Content-Type: application/json" `
  -d '{\"username\":\"alice\",\"email\":\"alice@example.com\",\"displayName\":\"Alice\",\"password\":\"secret123\"}'
```

### 2.4 发送邮箱验证码（登录用）

`POST /api/auth/email-code`

用途：为「邮箱验证码登录」发送 6 位数字验证码，用途固定 `LOGIN`。

鉴权：公开。

请求体：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `email` | string | 是 | 无 | 合法邮箱，最长 100 |

成功响应 `200`：

```json
{ "ok": true, "expiresIn": 300 }
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | 参数校验失败（`邮箱格式不正确` 等） |
| 404 | `该邮箱尚未注册，请先注册账号` |
| 403 | `账号已被禁用，无法登录` / `账号已被锁定，请稍后再试` |
| 429 | `发送过于频繁，请 N 秒后再试` |
| 500 | SMTP 未配置或发送失败（`验证码邮件发送失败：...`） |

验证码规则：6 位数字、5 分钟有效、同一邮箱 60 秒发送间隔、校验成功后一次性消费（`usedAt`）。

```powershell
curl.exe -X POST "http://localhost:3000/api/auth/email-code" `
  -H "Content-Type: application/json" `
  -d '{\"email\":\"alice@example.com\"}'
```

### 2.5 登录（NextAuth Credentials）

登录由 NextAuth 内置路由处理，项目注册了两个 Credentials Provider：

| Provider id | 名称 | 字段 | 行为 |
| --- | --- | --- | --- |
| `credentials` | 默认（用户名/密码） | `username`、`password` | 支持用户名或邮箱；密码错误且启用 LDAP 时回退 LDAP |
| `email-code` | 邮箱验证码 | `email`、`code` | 仅登录已存在用户，验证码用途 `LOGIN` |

#### 时序（用户名/密码）

1. `GET /api/auth/csrf` 获取 `csrfToken`（同时下发 CSRF Cookie）。
2. `POST /api/auth/callback/credentials`，表单字段：`csrfToken`、`username`、`password`、`callbackUrl`；请求头建议带 `X-Auth-Return-Redirect: 1`。
3. 成功：写入会话 Cookie（`authjs.session-token`）。带 `X-Auth-Return-Redirect: 1` 时返回 `200 { "url": "<callbackUrl>" }`；未带该头时返回 `302 Location: <callbackUrl>`。
4. 失败：`302` 到 `/signin?error=CredentialsSignin&code=<CODE>`；使用 `signIn(..., { redirect: false })` 时返回 `{ "error": "CredentialsSignin", "code": "<CODE>", "status": 200, "ok": true, "url": null }`（HTTP 层仍是 200，`ok` 为 `true`，业务失败只能通过 `error` 判断）。

`code` 取值（`lib/auth.ts` 中的 `LoginError`）：

| code | 含义 |
| --- | --- |
| `ACCOUNT_DISABLED` | 用户 `status !== 'ENABLED'` |
| `ACCOUNT_LOCKED` | `lockedUntil` 晚于当前时间 |
| `LDAP_NOT_REGISTERED` | LDAP 认证通过但本地无对应账号 |
| `CODE_INVALID` | 邮箱验证码错误或已过期（`email-code` Provider） |

其他失败（用户名不存在、密码错误且未启用 LDAP）返回 `null`，表现为 NextAuth 默认 `CredentialsSignin`（无自定义 code）。

```powershell
# 1) 获取 CSRF
curl.exe -c cookies.txt "http://localhost:3000/api/auth/csrf"

# 2) 登录（把 <CSRF_TOKEN> 替换为上一步返回值）
curl.exe -b cookies.txt -c cookies.txt -X POST "http://localhost:3000/api/auth/callback/credentials" `
  -H "Content-Type: application/x-www-form-urlencoded" `
  -H "X-Auth-Return-Redirect: 1" `
  --data-urlencode "csrfToken=<CSRF_TOKEN>" `
  --data-urlencode "username=admin" `
  --data-urlencode "password=admin123" `
  --data-urlencode "callbackUrl=http://localhost:3000/console"
```

#### 时序（邮箱验证码）

1. `POST /api/auth/email-code` 发送验证码。
2. `GET /api/auth/csrf` 获取 `csrfToken`。
3. `POST /api/auth/callback/email-code`，表单字段：`csrfToken`、`email`、`code`、`callbackUrl`。
4. 成功写入会话 Cookie；失败跳转 `/signin?error=CredentialsSignin&code=CODE_INVALID`。

### 2.6 会话查询与登出

| 方法与路径 | 说明 |
| --- | --- |
| `GET /api/auth/session` | 返回当前会话；未登录返回 `null` |
| `POST /api/auth/session` | NextAuth 支持的会话刷新入口，返回结构同 GET |
| `GET /api/auth/providers` | 返回已启用的 Provider 列表（含动态 OAuth） |
| `GET /api/auth/csrf` | 返回 `{ "csrfToken": "..." }` |
| `POST /api/auth/signout` | 表单字段 `csrfToken`、`callbackUrl`；清除会话 Cookie |
| `GET /api/auth/signin` | 跳转自定义登录页 `/signin` |
| `GET /api/auth/error` | NextAuth 错误页 |

`GET /api/auth/session` 成功响应示例：

```json
{
  "user": {
    "name": "管理员",
    "email": "admin@rainynest.com",
    "id": "clx0a1b2c0000abcd1234efgh",
    "username": "admin",
    "roles": ["administrator"],
    "permissions": ["*"],
    "forbidConsole": false,
    "sessionToken": "3f0c9e2a-4b7d-4c1e-9a55-0d6f8b2c1a77"
  },
  "expires": "2026-12-21T08:30:00.000Z"
}
```

```powershell
curl.exe -b cookies.txt "http://localhost:3000/api/auth/session"

curl.exe -b cookies.txt -c cookies.txt -X POST "http://localhost:3000/api/auth/signout" `
  -H "Content-Type: application/x-www-form-urlencoded" `
  --data-urlencode "csrfToken=<CSRF_TOKEN>" `
  --data-urlencode "callbackUrl=http://localhost:3000/"
```

说明：仓库中**没有** `POST /api/auth/logout` 路由；仅 `lib/auth.ts` 导出了 `signOut` 函数供服务端调用。

### 2.7 找回 / 重置密码

#### 2.7.1 发送重置验证码

`POST /api/auth/forgot-password`

鉴权：公开。

请求体：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `email` | string | 是 | 无 | 合法邮箱，最长 100 |

成功响应 `200`：

```json
{ "ok": true, "expiresIn": 300 }
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | 参数校验失败（`邮箱格式不正确` 等） |
| 404 | `该邮箱尚未注册` |
| 403 | `账号已被禁用，请联系管理员` |
| 429 | `发送过于频繁，请 N 秒后再试` |
| 500 | `验证码邮件发送失败：...` / `验证码邮件发送失败，请检查 SMTP 配置` |

```powershell
curl.exe -X POST "http://localhost:3000/api/auth/forgot-password" `
  -H "Content-Type: application/json" `
  -d '{\"email\":\"alice@example.com\"}'
```

#### 2.7.2 重置密码

`POST /api/auth/reset-password`

鉴权：公开。

请求体：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `email` | string | 是 | 无 | 合法邮箱，最长 100 |
| `code` | string | 是 | 无 | 6 位数字（`/^\d{6}$/`） |
| `password` | string | 是 | 无 | 6–72 字符 |

成功响应 `200`：

```json
{ "ok": true }
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | 参数校验失败 / 验证码错误或已过期 |
| 404 | 该邮箱尚未注册 |
| 403 | 账号已被禁用 |

副作用：重置成功后 `loginFailCount = 0`、`lockedUntil = null`，并吊销该用户全部 `Session` 设备记录（不影响已签发的 JWT，JWT 仍可用至过期；代码未实现 JWT 版本号强制失效）。

```powershell
curl.exe -X POST "http://localhost:3000/api/auth/reset-password" `
  -H "Content-Type: application/json" `
  -d '{\"email\":\"alice@example.com\",\"code\":\"123456\",\"password\":\"newsecret123\"}'
```

### 2.8 OAuth 入口

Provider 是否启用取决于 `SiteSetting`，在每次请求时动态构建（`lib/auth.ts` 的 `buildProviders`）：

| Provider | 启用条件 | 入口 |
| --- | --- | --- |
| GitHub | `oauthGithubId` 与 `oauthGithubSecret` 均非空 | `GET /api/auth/signin/github` |
| Google | `oauthGoogleId` 与 `oauthGoogleSecret` 均非空 | `GET /api/auth/signin/google` |
| WeChat | `oauthWechatId` 与 `oauthWechatSecret` 均非空 | `GET /api/auth/signin/wechat` |

回调路径：`GET /api/auth/callback/{github|google|wechat}`。

限制（代码如此）：

- 只允许**已存在**的本地账号登录：
  - GitHub / Google 按邮箱匹配本地 `User.email`。
  - WeChat 按 `Identity` 表中 `provider = OAUTH2_WECHAT` 且 `identifier = openid` 匹配；不存在则拒绝。
- 账号还必须 `status === 'ENABLED'` 且未锁定。
- GitHub / Google 设置了 `allowDangerousEmailAccountLinking: true`。
- 仓库中**没有**创建 `Identity` 记录的 OAuth 注册流程（代码未实现 WeChat 绑定接口）。

```powershell
curl.exe -L "http://localhost:3000/api/auth/signin/github?callbackUrl=http://localhost:3000/console"
```

### 2.9 LDAP

LDAP 不是独立路由，而是凭据登录的分支：

1. 用户名不存在且 `enableLdap === true`：尝试 LDAP bind；成功但本地无账号 → `LDAP_NOT_REGISTERED`；LDAP 失败 → 登录失败（无 code）。
2. 本地用户存在但密码校验失败且 `enableLdap === true`：尝试 LDAP；成功则按用户名或 LDAP `mail` 匹配本地账号，找不到 → `LDAP_NOT_REGISTERED`；找到后再次校验账号状态。
3. LDAP 配置读取 `SiteSetting`：`ldapUrl`、`ldapBindDn`、`ldapBindPassword`、`ldapBaseDn`、`ldapUserFilter`（默认 `(uid={username})`）。
4. 依赖可选包 `ldapjs`；未安装时抛出「未安装 ldapjs，无法使用 LDAP 登录，请先安装依赖 ldapjs」，最终表现为登录失败。
5. 连接与搜索超时 8 秒。

---

## 3. 权限

### 3.1 角色模型

- RBAC 2.0：`User` — `UserRole` — `Role` — `RolePermission` — `Permission`。
- 内置角色（`prisma/seed.ts`）：

| 角色 name | 显示名 | `forbidConsole` | 说明 |
| --- | --- | --- | --- |
| `administrator` | 超级管理员 | false | 登录时直接获得 `permissions: ["*"]` |
| `editor` | 编辑 | false | 内容管理（文章/页面/分类/标签/说说/相册/友链/评论/菜单部分） |
| `author` | 作者 | false | 文章创建/更新、评论查看、图片上传 |
| `viewer` | 访客用户 | true | 注册默认角色，仅 `uc:login` |

- 超级管理员判定：JWT 中 `roles` 包含 `administrator`，或 `permissions` 包含 `*`。
- `forbidConsole` 为 `true` 的角色不能进入 `/console`。

### 3.2 权限键总表

以下是 `prisma/seed.ts` 中写入的 78 个权限键（按分组）：

| 分组 | 权限键 |
| --- | --- |
| 内容 | `post:list`、`post:get`、`post:create`、`post:update`、`post:delete`、`post:publish`、`post:unpublish` |
| 内容 | `page:list`、`page:get`、`page:create`、`page:update`、`page:delete` |
| 内容 | `category:list`、`category:get`、`category:create`、`category:update`、`category:delete` |
| 内容 | `tag:list`、`tag:get`、`tag:create`、`tag:update`、`tag:delete` |
| 内容 | `moment:list`、`moment:create`、`moment:update`、`moment:delete` |
| 内容 | `gallery:list`、`gallery:create`、`gallery:update`、`gallery:delete` |
| 内容 | `link:list`、`link:create`、`link:update`、`link:delete` |
| 内容 | `comment:list`、`comment:get`、`comment:approve`、`comment:reject`、`comment:delete` |
| 内容 | `photo:upload`、`photo:delete` |
| 内容 | `menu:list`、`menu:create`、`menu:update`、`menu:delete` |
| 用户 | `user:list`、`user:create`、`user:update`、`user:delete`、`user:reset-password`、`user:assign-role` |
| 用户 | `role:list`、`role:create`、`role:update`、`role:delete`、`role:assign-permission` |
| 系统 | `site:config`、`seo:config`、`smtp:config`、`menu:config`、`theme:activate` |
| 扩展 | `plugin:list`、`plugin:install`、`plugin:uninstall`、`plugin:activate`、`plugin:deactivate`、`plugin:config` |
| 扩展 | `theme:list`、`theme:install`、`theme:uninstall`、`theme:preview`、`theme:config` |
| 工具 | `analytics:view`、`analytics:export`、`backup:create`、`backup:restore` |
| 控制台 | `console:login`、`uc:login` |

注意：

- 代码中有多处检查 `console:access`（`GET /api/console/attachments`、`GET /api/console/plugin-nav`、`GET /api/console/plugin-widgets`），但该权限键**不在** seed 清单中。除超级管理员（`*`）外，任何自定义角色即使拥有全部已列权限也会得到 `403`。
- 代码中检查 `plugin:list`、`theme:list`、`analytics:view` 等键的位置见各接口小节；部分路由仅要求登录而不校验权限。

### 3.3 401 与 403 的判定位置

| 场景 | 判定位置 | 结果 |
| --- | --- | --- |
| 未登录访问需登录接口 | `requirePermission` / 路由内 `auth()` | `401 {"error":"未登录"}` |
| 已登录但缺权限 | `requirePermission` | `403 {"error":"没有执行此操作的权限"}` |
| 访问 `/console/*` 页面（非 API） | `middleware.ts` | 未登录重定向 `/signin?redirect=/console/...`；`forbidConsole` 或缺 `console:login` 重定向 `/` |
| 插件自定义 API 需要登录 | `app/api/plugin/[...path]/route.ts` | `401 {"error":"Unauthorized"}` |

`middleware.ts` 的 matcher 仅为 `['/console/:path*']`，因此**不覆盖** `/api/console/**`；API 层的权限完全依赖各路由自己调用 `requirePermission`。

### 3.4 登录态在路由中的获取方式

- 需要权限：`const check = await requirePermission('post:create'); if (check) return check;`
- 仅需登录：`const session = await requireSession(); if (!session?.user) return NextResponse.json({ error: '未登录' }, { status: 401 });`
- 公开但需区分登录态：直接 `await auth()`。

---

## 4. 公共内容接口

本章接口用于前台内容展示与作者撰写，多数同时服务后台编辑器。所有日期为 ISO 8601 UTC。

### 4.1 文章

#### 4.1.1 文章列表

`GET /api/posts`

用途：分页查询文章。未登录只能看到 `PUBLISHED`；登录后可用 `status` 过滤（包括 `DRAFT`、`SCHEDULED`）。

鉴权：公开（登录态决定可见范围）。

Query 参数：

| 参数 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `keyword` | string | 否 | 空 | 对 `title`、`content`、`summary` 做 `contains` 匹配 |
| `status` | string | 否 | `PUBLISHED`（未登录）/ 空（登录） | `DRAFT`、`PUBLISHED`、`SCHEDULED`、`ALL` |
| `page` | number | 否 | 1 | 最小 1 |
| `size` | number | 否 | 10 | 1–100 |

插件网关：是。响应可能被插件 `apiMiddleware` 拦截。

成功响应 `200`：

```json
{
  "list": [
    {
      "id": "clx0post0001abcd1234efgh",
      "authorId": "clx0user0001abcd1234efgh",
      "title": "RainyNest 安装成功",
      "slug": "rainynest-hello-world",
      "summary": "恭喜你成功部署 RainyNest 博客系统。",
      "content": "# RainyNest 安装成功\n\n恭喜你成功部署 **RainyNest** 博客系统。",
      "html": "<h1>RainyNest 安装成功</h1>",
      "coverImage": null,
      "status": "PUBLISHED",
      "isTop": false,
      "allowComment": true,
      "views": 0,
      "words": 120,
      "categoryId": "clx0cat0001abcd1234efgh",
      "createdAt": "2026-11-01T02:00:00.000Z",
      "updatedAt": "2026-11-01T02:00:00.000Z",
      "publishedAt": "2026-11-01T02:00:00.000Z",
      "category": {
        "id": "clx0cat0001abcd1234efgh",
        "name": "技术",
        "slug": "tech",
        "description": "技术文章"
      },
      "tags": [
        {
          "postId": "clx0post0001abcd1234efgh",
          "tagId": "clx0tag0001abcd1234efgh",
          "tag": { "id": "clx0tag0001abcd1234efgh", "name": "开箱", "slug": "hello" }
        }
      ],
      "author": {
        "id": "clx0user0001abcd1234efgh",
        "username": "admin",
        "displayName": "管理员",
        "avatar": null
      }
    }
  ],
  "total": 1,
  "operations": [],
  "fields": []
}
```

- 当插件注册了 `postListItemField` 时，`list` 中每一项会额外带有 `_fields` 字段（插件渲染结果），`fields` 为字段定义数组：`{ key, label, width?, sortable? }`。
- `operations` 为插件行操作：`{ slug, label, icon, variant, hrefTemplate }`。

错误：无业务错误码；插件拦截时返回插件自定义响应。

```powershell
curl.exe "http://localhost:3000/api/posts?page=1&size=10&keyword=RainyNest"
```

#### 4.1.2 创建文章

`POST /api/posts`

用途：创建文章，自动渲染 Markdown 到 `html`，自动 upsert 标签。

鉴权：登录 + `post:create`。

插件网关：是。

请求体：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `title` | string | 是 | 无 | 1–200 |
| `slug` | string | 是 | 无 | 1–200，全局唯一 |
| `summary` | string \| null | 否 | `null` | 最长 1000；为空时尝试插件摘要生成 |
| `content` | string | 是 | 无 | 至少 1 字符；`words` 取 `content.length` |
| `coverImage` | string \| null | 否 | `null` | 无格式校验 |
| `status` | string | 否 | `DRAFT` | `DRAFT` / `PUBLISHED` / `SCHEDULED` |
| `isTop` | boolean | 否 | `false` | 无 |
| `allowComment` | boolean | 否 | `true` | 无 |
| `categoryId` | string \| null | 否 | `null` | 不做存在性校验（外键失败会 500） |
| `tags` | string[] | 否 | `[]` | 标签名数组，自动创建不存在的标签 |

成功响应 `201`：返回创建的 `Post`（含 `tags.tag`、`category`，不含 `author`）：

```json
{
  "id": "clx0post0002abcd1234efgh",
  "authorId": "clx0user0001abcd1234efgh",
  "title": "新文章",
  "slug": "new-post",
  "summary": "摘要",
  "content": "正文",
  "html": "<p>正文</p>",
  "coverImage": null,
  "status": "DRAFT",
  "isTop": false,
  "allowComment": true,
  "views": 0,
  "words": 2,
  "categoryId": null,
  "createdAt": "2026-11-21T08:30:00.000Z",
  "updatedAt": "2026-11-21T08:30:00.000Z",
  "publishedAt": null,
  "tags": [],
  "category": null
}
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | 请求体不是合法 JSON / 参数校验失败 / Slug 已存在，请更换 |
| 401 | 未登录 |
| 403 | 没有执行此操作的权限（缺 `post:create`） |
| 500 | 创建文章失败 |

```powershell
curl.exe -X POST "http://localhost:3000/api/posts" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"title\":\"新文章\",\"slug\":\"new-post\",\"content\":\"正文\",\"status\":\"DRAFT\",\"tags\":[\"Next.js\"]}'
```

#### 4.1.3 文章详情

`GET /api/posts/{id}`

用途：按主键查询单篇文章。

鉴权：公开；未登录时非 `PUBLISHED` 文章返回 404。

Path 参数：

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 文章主键（cuid），不是 slug |

成功响应 `200`：返回单个 `Post`，包含 `tags.tag`、`category`、`author { id, username, displayName, avatar }`（字段同 4.1.1 列表项，去掉 `operations`/`fields`）。

错误：

| 状态码 | 含义 |
| --- | --- |
| 404 | 文章不存在（或未登录访问非已发布文章） |

```powershell
curl.exe "http://localhost:3000/api/posts/clx0post0001abcd1234efgh"
```

#### 4.1.4 更新文章

`PUT /api/posts/{id}`

用途：部分更新文章；`tags` 传数组时整体替换标签；`content` 变更时重算 `html` 与 `words`。

鉴权：登录 + `post:update`。

请求体（全部可选，至少传一个字段才有实际效果）：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `title` | string | 否 | 原值 | 1–200 |
| `slug` | string | 否 | 原值 | 1–200，唯一 |
| `summary` | string \| null | 否 | 原值 | 最长 1000 |
| `content` | string | 否 | 原值 | 至少 1 字符 |
| `coverImage` | string \| null | 否 | 原值 | 无 |
| `status` | string | 否 | 原值 | `DRAFT` / `PUBLISHED` / `SCHEDULED` |
| `isTop` | boolean | 否 | 原值 | 无 |
| `allowComment` | boolean | 否 | 原值 | 无 |
| `categoryId` | string \| null | 否 | 原值 | 无 |
| `tags` | string[] | 否 | 不修改 | 传入后整体替换 |

`publishedAt` 规则：`status` 变为 `PUBLISHED` 且原值为空时写入当前时间；从 `PUBLISHED` 变为其他状态时保留原发布时间；其他情况按原值。

成功响应 `200`：返回更新后的 `Post`（不含 `tags` / `category` 关联）：

```json
{
  "id": "clx0post0001abcd1234efgh",
  "authorId": "clx0user0001abcd1234efgh",
  "title": "RainyNest 安装成功（修订）",
  "slug": "rainynest-hello-world",
  "summary": "摘要",
  "content": "正文",
  "html": "<p>正文</p>",
  "coverImage": null,
  "status": "PUBLISHED",
  "isTop": false,
  "allowComment": true,
  "views": 0,
  "words": 2,
  "categoryId": null,
  "createdAt": "2026-11-01T02:00:00.000Z",
  "updatedAt": "2026-11-21T08:40:00.000Z",
  "publishedAt": "2026-11-01T02:00:00.000Z"
}
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | JSON 非法 / 参数校验失败 / Slug 已存在，请更换 |
| 401 | 未登录 |
| 403 | 缺少 `post:update` |
| 404 | 文章不存在 |
| 500 | 更新文章失败 |

```powershell
curl.exe -X PUT "http://localhost:3000/api/posts/clx0post0001abcd1234efgh" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"title\":\"新标题\",\"tags\":[\"Next.js\",\"Prisma\"]}'
```

#### 4.1.5 删除文章

`DELETE /api/posts/{id}`

用途：删除文章，`PostTag` 与评论由数据库级联删除。

鉴权：登录 + `post:delete`。

成功响应 `200`：

```json
{ "ok": true }
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 401 | 未登录 |
| 403 | 缺少 `post:delete` |
| 404 | 文章不存在 |

```powershell
curl.exe -X DELETE "http://localhost:3000/api/posts/clx0post0001abcd1234efgh" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

#### 4.1.6 Markdown 预览

`POST /api/posts/preview`

用途：把 Markdown 渲染为 HTML，供编辑器预览。

鉴权：登录即可（不校验任何权限）。

请求体：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `content` | string | 是 | 无 | 任意长度 |

成功响应 `200`：

```json
{ "html": "<h1>标题</h1>\n<p>正文</p>" }
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | 请求体不是合法 JSON / 参数校验失败 |
| 401 | 未登录 |
| 500 | 渲染失败 |

```powershell
curl.exe -X POST "http://localhost:3000/api/posts/preview" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"content\":\"# 标题\"}'
```

### 4.2 分类

#### 4.2.1 分类列表

`GET /api/categories`

用途：返回全部分类及文章数量。

鉴权：公开。

成功响应 `200`：

```json
{
  "list": [
    {
      "id": "clx0cat0001abcd1234efgh",
      "name": "技术",
      "slug": "tech",
      "description": "技术文章",
      "_count": { "posts": 3 }
    }
  ]
}
```

```powershell
curl.exe "http://localhost:3000/api/categories"
```

#### 4.2.2 创建分类

`POST /api/categories`

用途：创建分类。

鉴权：登录 + `category:create`。

插件网关：是。

请求体：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `name` | string | 是 | 无 | 1–100，唯一 |
| `slug` | string | 是 | 无 | 1–100，唯一 |
| `description` | string \| null | 否 | `null` | 最长 500 |

成功响应 `201`：

```json
{
  "id": "clx0cat0002abcd1234efgh",
  "name": "生活",
  "slug": "life",
  "description": null
}
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | JSON 非法 / 校验失败 / 名称或 Slug 已存在 |
| 401 | 未登录 |
| 403 | 缺少 `category:create` |
| 500 | 创建分类失败 |

```powershell
curl.exe -X POST "http://localhost:3000/api/categories" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"name\":\"生活\",\"slug\":\"life\"}'
```

#### 4.2.3 更新分类

`PUT /api/categories/{id}`

鉴权：登录 + `category:update`。

Path 参数：`id`（分类主键）。

请求体（可选）：`name`（1–100）、`slug`（1–100）、`description`（≤500 或 `null`）。

成功响应 `200`：

```json
{ "id": "clx0cat0001abcd1234efgh", "name": "技术分享", "slug": "tech", "description": "技术文章" }
```

错误：`400`（JSON/校验/名称或 Slug 已存在）、`401`、`403`、`404`（分类不存在）、`500`。

```powershell
curl.exe -X PUT "http://localhost:3000/api/categories/clx0cat0001abcd1234efgh" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"name\":\"技术分享\"}'
```

#### 4.2.4 删除分类

`DELETE /api/categories/{id}`

鉴权：登录 + `category:delete`。

成功响应 `200`：

```json
{ "ok": true }
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | 该分类下仍有 N 篇文章，无法删除 |
| 401 | 未登录 |
| 403 | 缺少 `category:delete` |
| 404 | 分类不存在 |

```powershell
curl.exe -X DELETE "http://localhost:3000/api/categories/clx0cat0001abcd1234efgh" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

### 4.3 标签

#### 4.3.1 标签列表

`GET /api/tags`

鉴权：公开。

成功响应 `200`：

```json
{
  "list": [
    {
      "id": "clx0tag0001abcd1234efgh",
      "name": "Next.js",
      "slug": "nextjs",
      "_count": { "posts": 2 }
    }
  ]
}
```

```powershell
curl.exe "http://localhost:3000/api/tags"
```

#### 4.3.2 创建标签

`POST /api/tags`

鉴权：登录 + `tag:create`。

插件网关：是。

请求体：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `name` | string | 是 | 无 | 1–100，唯一 |
| `slug` | string | 是 | 无 | 1–100，唯一 |

成功响应 `201`：

```json
{ "id": "clx0tag0002abcd1234efgh", "name": "Prisma", "slug": "prisma" }
```

错误：`400`（JSON/校验/名称或 Slug 已存在）、`401`、`403`、`500`。

```powershell
curl.exe -X POST "http://localhost:3000/api/tags" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"name\":\"Prisma\",\"slug\":\"prisma\"}'
```

#### 4.3.3 更新标签

`PUT /api/tags/{id}`

鉴权：登录 + `tag:update`。

请求体（可选）：`name`（1–100）、`slug`（1–100）。

成功响应 `200`：

```json
{ "id": "clx0tag0001abcd1234efgh", "name": "NextJS", "slug": "nextjs" }
```

错误：`400`、`401`、`403`、`404`（标签不存在）、`500`。

```powershell
curl.exe -X PUT "http://localhost:3000/api/tags/clx0tag0001abcd1234efgh" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"name\":\"NextJS\"}'
```

#### 4.3.4 删除标签

`DELETE /api/tags/{id}`

鉴权：登录 + `tag:delete`。

成功响应 `200`：

```json
{ "ok": true }
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | 该标签仍被 N 篇文章使用，无法删除 |
| 401 | 未登录 |
| 403 | 缺少 `tag:delete` |
| 404 | 标签不存在 |

```powershell
curl.exe -X DELETE "http://localhost:3000/api/tags/clx0tag0001abcd1234efgh" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

#### 4.3.5 合并标签

`POST /api/tags/merge`

用途：把来源标签的文章关联迁移到目标标签，然后删除来源标签。

鉴权：登录 + `tag:update`。

请求体：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `sourceId` | string | 是 | 无 | 来源标签主键 |
| `targetId` | string | 是 | 无 | 目标标签主键，不能与 `sourceId` 相同 |

成功响应 `200`：

```json
{ "ok": true, "moved": 2, "source": "NextJS", "target": "Next.js" }
```

`moved` 为迁移前来源标签的关联数量。

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | JSON 非法 / 缺少参数 / 来源标签与目标标签不能相同 |
| 401 | 未登录 |
| 403 | 缺少 `tag:update` |
| 404 | 来源标签不存在 / 目标标签不存在 |
| 500 | 合并失败 请稍后重试 |

```powershell
curl.exe -X POST "http://localhost:3000/api/tags/merge" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"sourceId\":\"clx0tag0001abcd1234efgh\",\"targetId\":\"clx0tag0002abcd1234efgh\"}'
```

### 4.4 独立页面

#### 4.4.1 页面列表

`GET /api/pages`

用途：返回页面列表。未登录只返回 `PUBLISHED`。

鉴权：公开（登录后返回全部并附带插件字段）。

成功响应 `200`：

```json
{
  "list": [
    {
      "id": "clx0page0001abcd1234efgh",
      "title": "关于",
      "slug": "about",
      "content": "本站介绍",
      "summary": null,
      "status": "PUBLISHED",
      "order": 0,
      "showSidebar": true,
      "sidebarContent": null,
      "createdAt": "2026-11-01T02:00:00.000Z",
      "updatedAt": "2026-11-01T02:00:00.000Z"
    }
  ],
  "fields": [],
  "operations": []
}
```

- 登录时 `fields` 为 `pageListItemField` 定义数组，列表项可带 `_fields`；`operations` 为 `pageListItemOperation`。

```powershell
curl.exe "http://localhost:3000/api/pages"
```

#### 4.4.2 创建页面

`POST /api/pages`

鉴权：登录 + `page:create`。

插件网关：是。

请求体：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `title` | string | 是 | 无 | 1–200 |
| `slug` | string | 是 | 无 | 1–200，唯一 |
| `content` | string | 是 | 无 | 至少 1 字符 |
| `summary` | string \| null | 否 | `null` | 最长 1000 |
| `status` | string | 否 | `PUBLISHED`（模型默认） | `DRAFT` / `PUBLISHED` |
| `order` | number | 否 | `0` | 整数 |
| `showSidebar` | boolean | 否 | `true` | 无 |
| `sidebarContent` | string \| null | 否 | `null` | 最长 5000 |

成功响应 `201`：返回完整 `Page` 对象（字段同上表，另含 `id`、`createdAt`、`updatedAt`）。

错误：`400`（JSON/校验/Slug 已存在，请更换）、`401`、`403`、`500`。

```powershell
curl.exe -X POST "http://localhost:3000/api/pages" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"title\":\"关于\",\"slug\":\"about\",\"content\":\"本站介绍\"}'
```

#### 4.4.3 页面详情

`GET /api/pages/{id}`

鉴权：公开。注意：该接口**不校验** `status`，未发布的页面也能被任何人按 id 读取（代码如此）。

成功响应 `200`：返回单个 `Page`（字段同 4.4.1）。

错误：`404`（页面不存在）。

```powershell
curl.exe "http://localhost:3000/api/pages/clx0page0001abcd1234efgh"
```

#### 4.4.4 更新页面

`PUT /api/pages/{id}`

鉴权：登录 + `page:update`。

请求体（可选）：`title`、`slug`、`content`、`summary`、`status`（`DRAFT`/`PUBLISHED`）、`order`、`showSidebar`、`sidebarContent`。

成功响应 `200`：返回更新后的 `Page`。

错误：`400`、`401`、`403`、`404`、`500`。

```powershell
curl.exe -X PUT "http://localhost:3000/api/pages/clx0page0001abcd1234efgh" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"title\":\"关于我们\"}'
```

#### 4.4.5 删除页面

`DELETE /api/pages/{id}`

鉴权：登录 + `page:delete`。

成功响应 `200`：

```json
{ "ok": true }
```

错误：`401`、`403`、`404`。

```powershell
curl.exe -X DELETE "http://localhost:3000/api/pages/clx0page0001abcd1234efgh" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

### 4.5 评论

#### 4.5.1 评论列表（公开 / 后台）

`GET /api/comments`

用途：分两种模式：

- 传 `postId`：公开返回该文章下 `APPROVED` 评论，组装两级树（回复只挂到顶层评论下）。
- 不传 `postId`：后台管理列表，需要登录，返回全部状态。

鉴权：公开（传 `postId`）；登录（不传 `postId`，不校验权限键）。

插件网关：是。

Query 参数：

| 参数 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `postId` | string | 否 | 空 | 传则进入公开模式 |
| `status` | string | 否 | 空 | 仅后台模式生效，`PENDING` / `APPROVED` / `REJECTED` / `ALL` |
| `page` | number | 否 | 1 | 仅后台模式 |
| `size` | number | 否 | 20 | 1–100，仅后台模式 |

成功响应 `200`（公开模式）：

```json
{
  "list": [
    {
      "id": "clx0cmt0001abcd1234efgh",
      "postId": "clx0post0001abcd1234efgh",
      "userId": "clx0user0002abcd1234efgh",
      "parentId": null,
      "content": "写得好",
      "status": "APPROVED",
      "ip": "127.0.0.1",
      "userAgent": "Mozilla/5.0",
      "extra": null,
      "createdAt": "2026-11-02T03:00:00.000Z",
      "user": {
        "id": "clx0user0002abcd1234efgh",
        "username": "alice",
        "displayName": "Alice",
        "avatar": null
      },
      "replies": [
        {
          "id": "clx0cmt0002abcd1234efgh",
          "postId": "clx0post0001abcd1234efgh",
          "userId": "clx0user0001abcd1234efgh",
          "parentId": "clx0cmt0001abcd1234efgh",
          "content": "谢谢",
          "status": "APPROVED",
          "ip": "127.0.0.1",
          "userAgent": "Mozilla/5.0",
          "extra": null,
          "createdAt": "2026-11-02T04:00:00.000Z",
          "user": {
            "id": "clx0user0001abcd1234efgh",
            "username": "admin",
            "displayName": "管理员",
            "avatar": null
          }
        }
      ]
    }
  ],
  "total": 2
}
```

成功响应 `200`（后台模式）：

```json
{
  "list": [
    {
      "id": "clx0cmt0003abcd1234efgh",
      "postId": "clx0post0001abcd1234efgh",
      "userId": "clx0user0002abcd1234efgh",
      "parentId": null,
      "content": "求审核",
      "status": "PENDING",
      "ip": "127.0.0.1",
      "userAgent": "Mozilla/5.0",
      "extra": null,
      "createdAt": "2026-11-03T03:00:00.000Z",
      "post": { "id": "clx0post0001abcd1234efgh", "title": "RainyNest 安装成功", "slug": "rainynest-hello-world" },
      "user": { "id": "clx0user0002abcd1234efgh", "username": "alice", "displayName": "Alice", "avatar": null },
      "parent": null
    }
  ],
  "total": 1,
  "operations": [],
  "replyOperations": []
}
```

- 插件提供 `commentSubjectRef` 时，后台列表项增加 `_subject: { key, label, href }`。
- 后台评论字段包含 `post`、`user`、`parent`（`parent` 为 `{ ...评论字段, user: { id, displayName } }` 或 `null`）。

错误：

| 状态码 | 含义 |
| --- | --- |
| 401 | 未登录（仅后台模式） |

```powershell
curl.exe "http://localhost:3000/api/comments?postId=clx0post0001abcd1234efgh"

curl.exe "http://localhost:3000/api/comments?page=1&size=20&status=PENDING" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

#### 4.5.2 发表评论

`POST /api/comments`

用途：登录用户发表评论或回复。初始状态由 `SiteSetting.commentModeration` 决定（开启则 `PENDING`，关闭则 `APPROVED`），插件 `beforeCommentApprove` 可覆盖。

鉴权：登录即可（不校验权限键）。

插件网关：是。

请求体：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `postId` | string | 是 | 无 | 必须存在 |
| `content` | string | 是 | 无 | 1–2000 |
| `parentId` | string \| null | 否 | `null` | 必须是同一文章下的评论 |
| `extra` | object（string→string） | 否 | `null` | 插件注入字段，序列化后存入 `extra` |

成功响应 `201`：

```json
{
  "id": "clx0cmt0004abcd1234efgh",
  "postId": "clx0post0001abcd1234efgh",
  "userId": "clx0user0002abcd1234efgh",
  "parentId": null,
  "content": "写得好",
  "status": "PENDING",
  "ip": "203.0.113.10",
  "userAgent": "Mozilla/5.0",
  "extra": "{\"website\":\"https://example.com\"}",
  "createdAt": "2026-11-21T08:50:00.000Z",
  "post": { "id": "clx0post0001abcd1234efgh", "title": "RainyNest 安装成功", "slug": "rainynest-hello-world" },
  "user": {
    "id": "clx0user0002abcd1234efgh",
    "username": "alice",
    "displayName": "Alice",
    "email": "alice@example.com"
  }
}
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | JSON 非法 / 校验失败 / 回复的评论不存在 |
| 401 | 请先登录后再评论 |
| 403 | 该文章已关闭评论 |
| 404 | 文章不存在 |

副作用：向管理员邮箱发送通知（`status=PENDING` 用待审核模板，否则发送新评论通知）；SMTP 未配置时静默跳过。

```powershell
curl.exe -X POST "http://localhost:3000/api/comments" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"postId\":\"clx0post0001abcd1234efgh\",\"content\":\"写得好\"}'
```

#### 4.5.3 审核评论

`PUT /api/comments/{id}`

用途：修改评论状态。

鉴权：登录，且拥有 `comment:approve` 或 `comment:reject` 之一。

请求体：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `status` | string | 是 | 无 | `PENDING` / `APPROVED` / `REJECTED` |

成功响应 `200`：返回更新后的评论（`Comment` 全部标量字段，无关联）。

```json
{
  "id": "clx0cmt0004abcd1234efgh",
  "postId": "clx0post0001abcd1234efgh",
  "userId": "clx0user0002abcd1234efgh",
  "parentId": null,
  "content": "写得好",
  "status": "APPROVED",
  "ip": "203.0.113.10",
  "userAgent": "Mozilla/5.0",
  "extra": null,
  "createdAt": "2026-11-21T08:50:00.000Z"
}
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | JSON 非法 / 状态值必须是 PENDING / APPROVED / REJECTED |
| 401 | 未登录 |
| 403 | 没有执行此操作的权限 |
| 404 | 评论不存在 |

副作用：首次从非 `APPROVED` 变为 `APPROVED` 时给评论作者发邮件（失败不影响结果）。

```powershell
curl.exe -X PUT "http://localhost:3000/api/comments/clx0cmt0004abcd1234efgh" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"status\":\"APPROVED\"}'
```

#### 4.5.4 删除评论

`DELETE /api/comments/{id}`

鉴权：登录 + `comment:delete`。

行为：先删除 `parentId = id` 的直接回复，再删除评论本身（仅两级，更深层级不会递归处理）。

成功响应 `200`：

```json
{ "ok": true }
```

错误：`401`、`403`、`404`。

```powershell
curl.exe -X DELETE "http://localhost:3000/api/comments/clx0cmt0004abcd1234efgh" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

### 4.6 相册

#### 4.6.1 相册列表

`GET /api/gallery`

鉴权：公开；未登录只返回 `PUBLISHED`。

成功响应 `200`：

```json
{
  "list": [
    {
      "id": "clx0gal0001abcd1234efgh",
      "title": "旅行",
      "slug": "travel",
      "description": null,
      "coverImage": null,
      "status": "PUBLISHED",
      "createdAt": "2026-11-04T03:00:00.000Z",
      "updatedAt": "2026-11-04T03:00:00.000Z",
      "photoCount": 3
    }
  ]
}
```

```powershell
curl.exe "http://localhost:3000/api/gallery"
```

#### 4.6.2 创建相册

`POST /api/gallery`

鉴权：登录 + `gallery:create`。

插件网关：是。

请求体：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `title` | string | 是 | 无 | 1–200 |
| `slug` | string | 是 | 无 | 1–200，唯一 |
| `description` | string \| null | 否 | `null` | 最长 1000 |
| `coverImage` | string \| null | 否 | `null` | 无 |
| `status` | string | 否 | `PUBLISHED` | `PUBLISHED` / `HIDDEN` |
| `photos` | array | 否 | `[]` | 每项 `{ url(必填), title?, width?, height? }` |

成功响应 `201`：返回 `Gallery` 含 `photos` 数组。

```json
{
  "id": "clx0gal0002abcd1234efgh",
  "title": "城市",
  "slug": "city",
  "description": null,
  "coverImage": null,
  "status": "PUBLISHED",
  "createdAt": "2026-11-21T09:00:00.000Z",
  "updatedAt": "2026-11-21T09:00:00.000Z",
  "photos": [
    {
      "id": "clx0pho0001abcd1234efgh",
      "galleryId": "clx0gal0002abcd1234efgh",
      "url": "/uploads/202611/city.jpg",
      "title": "夜景",
      "width": 1920,
      "height": 1080,
      "createdAt": "2026-11-21T09:00:00.000Z"
    }
  ]
}
```

错误：`400`（JSON/校验/Slug 已存在，请更换）、`401`、`403`、`500`。

```powershell
curl.exe -X POST "http://localhost:3000/api/gallery" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"title\":\"城市\",\"slug\":\"city\",\"photos\":[{\"url\":\"/uploads/202611/city.jpg\"}]}'
```

#### 4.6.3 相册详情

`GET /api/gallery/{id}`

鉴权：公开。注意：不校验 `status`，`HIDDEN` 相册也能按 id 读取（代码如此）。

成功响应 `200`：返回 `Gallery` 含 `photos`（按 `createdAt asc`）。

错误：`404`（相册不存在）。

```powershell
curl.exe "http://localhost:3000/api/gallery/clx0gal0001abcd1234efgh"
```

#### 4.6.4 更新相册

`PUT /api/gallery/{id}`

鉴权：登录 + `gallery:update`。

请求体（可选）：`title`、`slug`、`description`、`coverImage`、`status`（`PUBLISHED`/`HIDDEN`）、`photos`（传入则整体替换）。

成功响应 `200`：返回更新后的 `Gallery` **不含** `photos`（事务返回的是 update 结果）。

```json
{
  "id": "clx0gal0001abcd1234efgh",
  "title": "旅行 2026",
  "slug": "travel",
  "description": null,
  "coverImage": null,
  "status": "PUBLISHED",
  "createdAt": "2026-11-04T03:00:00.000Z",
  "updatedAt": "2026-11-21T09:10:00.000Z"
}
```

错误：`400`、`401`、`403`、`404`、`500`。

```powershell
curl.exe -X PUT "http://localhost:3000/api/gallery/clx0gal0001abcd1234efgh" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"title\":\"旅行 2026\"}'
```

#### 4.6.5 删除相册

`DELETE /api/gallery/{id}`

鉴权：登录 + `gallery:delete`。

成功响应 `200`：

```json
{ "ok": true }
```

错误：`401`、`403`、`404`。

```powershell
curl.exe -X DELETE "http://localhost:3000/api/gallery/clx0gal0001abcd1234efgh" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

### 4.7 友链

#### 4.7.1 友链列表

`GET /api/links`

鉴权：公开；未登录只返回 `PUBLISHED`。

成功响应 `200`：

```json
{
  "list": [
    {
      "id": "clx0lnk0001abcd1234efgh",
      "name": "Example",
      "url": "https://example.com",
      "logo": null,
      "description": "示例站点",
      "category": "工具",
      "order": 0,
      "status": "PUBLISHED",
      "createdAt": "2026-11-05T03:00:00.000Z"
    }
  ]
}
```

```powershell
curl.exe "http://localhost:3000/api/links"
```

#### 4.7.2 创建友链

`POST /api/links`

鉴权：登录 + `link:create`。

插件网关：是。

请求体：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `name` | string | 是 | 无 | 1–100 |
| `url` | string | 是 | 无 | 至少 1 字符，不校验 URL 格式 |
| `logo` | string \| null | 否 | `null` | 无 |
| `description` | string \| null | 否 | `null` | 最长 500 |
| `category` | string \| null | 否 | `null` | 最长 50 |
| `order` | number | 否 | `0` | 整数 |
| `status` | string | 否 | `PUBLISHED` | `PUBLISHED` / `HIDDEN` |

成功响应 `201`：返回完整 `Link` 对象。

错误：`400`、`401`、`403`。

```powershell
curl.exe -X POST "http://localhost:3000/api/links" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"name\":\"Example\",\"url\":\"https://example.com\"}'
```

#### 4.7.3 更新友链

`PUT /api/links/{id}`

鉴权：登录 + `link:update`。

请求体（可选）：`name`、`url`、`logo`、`description`、`category`、`order`、`status`。

成功响应 `200`：返回更新后的 `Link`。

错误：`400`、`401`、`403`、`404`（友链不存在）。

```powershell
curl.exe -X PUT "http://localhost:3000/api/links/clx0lnk0001abcd1234efgh" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"order\":1}'
```

#### 4.7.4 删除友链

`DELETE /api/links/{id}`

鉴权：登录 + `link:delete`。

成功响应 `200`：

```json
{ "ok": true }
```

错误：`401`、`403`、`404`。

```powershell
curl.exe -X DELETE "http://localhost:3000/api/links/clx0lnk0001abcd1234efgh" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

### 4.8 说说

#### 4.8.1 说说列表

`GET /api/moments`

鉴权：公开；未登录只返回 `PUBLISHED`；登录后可用 `status` 过滤。

插件网关：是。

Query 参数：

| 参数 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `status` | string | 否 | 空 | 仅登录后生效，`PUBLISHED` / `DRAFT` / `ALL` |
| `page` | number | 否 | 1 | 最小 1 |
| `size` | number | 否 | 20 | 1–100 |

成功响应 `200`：

```json
{
  "list": [
    {
      "id": "clx0mom0001abcd1234efgh",
      "userId": "clx0user0001abcd1234efgh",
      "content": "今天是个好日子",
      "images": "[\"/uploads/202611/a.jpg\"]",
      "status": "PUBLISHED",
      "createdAt": "2026-11-06T03:00:00.000Z",
      "updatedAt": "2026-11-06T03:00:00.000Z",
      "user": {
        "id": "clx0user0001abcd1234efgh",
        "username": "admin",
        "displayName": "管理员",
        "avatar": null
      }
    }
  ],
  "total": 1
}
```

注意：`images` 是 JSON **字符串**（模型字段为 `String?`），不是数组。

```powershell
curl.exe "http://localhost:3000/api/moments?page=1&size=20"
```

#### 4.8.2 发布说说

`POST /api/moments`

鉴权：登录 + `moment:create`。

插件网关：是。

请求体：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `content` | string | 是 | 无 | 1–5000 |
| `images` | string[] | 否 | `null` | 最多 9 项，序列化后存入 `images` |

成功响应 `201`：返回 `Moment` 含 `user`（`id/username/displayName/avatar`）。

错误：`400`、`401`、`403`。

```powershell
curl.exe -X POST "http://localhost:3000/api/moments" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"content\":\"今天是个好日子\",\"images\":[\"/uploads/202611/a.jpg\"]}'
```

#### 4.8.3 更新说说

`PUT /api/moments/{id}`

鉴权：登录 + `moment:update`。

请求体（可选）：`content`（1–5000）、`images`（≤9，空数组会写成 `null`）、`status`（`PUBLISHED` / `DRAFT`）。

成功响应 `200`：返回更新后的 `Moment` 含 `user`。

错误：`400`、`401`、`403`、`404`（说说不存在）。

```powershell
curl.exe -X PUT "http://localhost:3000/api/moments/clx0mom0001abcd1234efgh" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"status\":\"DRAFT\"}'
```

#### 4.8.4 删除说说

`DELETE /api/moments/{id}`

鉴权：登录 + `moment:delete`。

成功响应 `200`：

```json
{ "ok": true }
```

错误：`401`、`403`、`404`。

```powershell
curl.exe -X DELETE "http://localhost:3000/api/moments/clx0mom0001abcd1234efgh" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

### 4.9 菜单

#### 4.9.1 菜单列表

`GET /api/menu`

用途：返回顶级菜单，并把子菜单嵌入 `children`。

鉴权：公开。

成功响应 `200`：

```json
{
  "list": [
    {
      "id": "clx0men0001abcd1234efgh",
      "name": "博客",
      "url": "/blog",
      "icon": null,
      "order": 1,
      "parentId": null,
      "createdAt": "2026-11-01T02:00:00.000Z",
      "children": [
        {
          "id": "clx0men0002abcd1234efgh",
          "name": "归档",
          "url": "/archive",
          "icon": null,
          "order": 0,
          "parentId": "clx0men0001abcd1234efgh",
          "createdAt": "2026-11-01T02:00:00.000Z"
        }
      ]
    }
  ]
}
```

```powershell
curl.exe "http://localhost:3000/api/menu"
```

#### 4.9.2 创建菜单

`POST /api/menu`

鉴权：登录 + `menu:create`。

请求体：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `name` | string | 是 | 无 | 1–100 |
| `url` | string | 是 | 无 | 至少 1 字符 |
| `icon` | string \| null | 否 | `null` | 无 |
| `order` | number | 否 | `0` | 整数 |
| `parentId` | string \| null | 否 | `null` | 不校验父级是否存在 |

成功响应 `201`：返回 `Menu` 标量字段。

错误：`400`、`401`、`403`。

```powershell
curl.exe -X POST "http://localhost:3000/api/menu" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"name\":\"关于\",\"url\":\"/about\",\"order\":7}'
```

#### 4.9.3 更新菜单

`PUT /api/menu/{id}`

鉴权：登录 + `menu:update`。

请求体（可选）：`name`、`url`、`icon`、`order`、`parentId`。

约束：`parentId` 不能等于 `id`（仅拦截自身；把菜单挂到自己的子孙下未被拦截，代码未实现环路检测）。

成功响应 `200`：返回更新后的 `Menu`。

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | JSON 非法 / 校验失败 / 父级菜单不能是自身 |
| 401 | 未登录 |
| 403 | 缺少 `menu:update` |
| 404 | 菜单不存在 |

```powershell
curl.exe -X PUT "http://localhost:3000/api/menu/clx0men0001abcd1234efgh" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"order\":2}'
```

#### 4.9.4 删除菜单

`DELETE /api/menu/{id}`

鉴权：登录 + `menu:delete`。

行为：先删除 `parentId = id` 的子菜单，再删除自身。

成功响应 `200`：

```json
{ "ok": true }
```

错误：`401`、`403`、`404`。

```powershell
curl.exe -X DELETE "http://localhost:3000/api/menu/clx0men0001abcd1234efgh" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

---

## 5. 用户、角色与个人资料

### 5.1 用户列表

`GET /api/console/users`

用途：返回全部用户（无分页），并附带可分配角色列表与用户详情页插件 Tab。

鉴权：登录 + `user:list`。

成功响应 `200`：

```json
{
  "list": [
    {
      "id": "clx0user0001abcd1234efgh",
      "username": "admin",
      "displayName": "管理员",
      "email": "admin@rainynest.com",
      "avatar": null,
      "status": "ENABLED",
      "createdAt": "2026-10-01T02:00:00.000Z",
      "updatedAt": "2026-11-20T02:00:00.000Z",
      "lastLoginAt": "2026-11-20T02:00:00.000Z",
      "roles": [
        {
          "userId": "clx0user0001abcd1234efgh",
          "roleId": "clx0role0001abcd1234efgh",
          "role": { "id": "clx0role0001abcd1234efgh", "name": "administrator", "displayName": "超级管理员" }
        }
      ]
    }
  ],
  "roles": [
    { "id": "clx0role0001abcd1234efgh", "name": "administrator", "displayName": "超级管理员" }
  ],
  "tabs": []
}
```

字段白名单：`id`、`username`、`displayName`、`email`、`avatar`、`status`、`createdAt`、`updatedAt`、`lastLoginAt`、`roles`（仅 `userId`、`roleId`、`role`）。响应不再包含 `passwordHash`、`token`、`extra` 等敏感字段（已修复，原「返回 Prisma 全字段」问题见 9.2 第 2 条）。

错误：`401`、`403`。

```powershell
curl.exe "http://localhost:3000/api/console/users" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

### 5.2 创建用户

`POST /api/console/users`

鉴权：登录 + `user:create`。

请求体：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `username` | string | 是 | 无 | 2–50 |
| `displayName` | string | 是 | 无 | 1–100 |
| `email` | string | 是 | 无 | 合法邮箱 |
| `password` | string | 是 | 无 | 6–100，bcrypt cost 10 |
| `roleIds` | string[] | 否 | `[]` | 角色主键数组 |

成功响应 `201`：返回按 §5.1 白名单裁剪的用户对象（含 `roles.role`），不含 `passwordHash`。

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | JSON 非法 / 校验失败 / `用户名或邮箱已存在` |
| 401 | 未登录 |
| 403 | 缺少 `user:create` |
| 500 | 创建用户失败 |

```powershell
curl.exe -X POST "http://localhost:3000/api/console/users" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"username\":\"bob\",\"displayName\":\"Bob\",\"email\":\"bob@example.com\",\"password\":\"secret123\",\"roleIds\":[]}'
```

### 5.3 更新用户

`PUT /api/console/users/{id}`

用途：更新资料、状态、密码、角色。

鉴权：登录，且满足以下全部条件：

- 基础：`permissions` 含 `*` 或 `user:update`，否则 `403 没有执行此操作的权限`。
- 传 `password`：还需 `*` 或 `user:reset-password`，否则 `403 没有重置密码的权限`。
- 传 `roleIds`：还需 `*` 或 `user:assign-role`，否则 `403 没有分配角色的权限`。

请求体：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `displayName` | string | 否 | 原值 | 1–100 |
| `email` | string \| null | 否 | 原值 | 合法邮箱；`''` 或 `null` 视为不修改 |
| `status` | string | 否 | 原值 | `ENABLED` / `DISABLED` / `LOCKED` |
| `password` | string \| null | 否 | 不修改 | 6–100 |
| `roleIds` | string[] | 否 | 不修改 | 传入后整体替换角色 |

成功响应 `200`：返回更新后的用户对象（同 §5.1 白名单，含 `roles.role`，不含 `passwordHash`）。

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | JSON 非法 / 校验失败 / `邮箱已被其他用户使用` |
| 401 | 未登录 |
| 403 | 无 `user:update` / 无重置密码权限 / 无分配角色权限 |
| 404 | 用户不存在 |
| 500 | 更新用户失败 |

```powershell
curl.exe -X PUT "http://localhost:3000/api/console/users/clx0user0002abcd1234efgh" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"displayName\":\"Alice\",\"status\":\"ENABLED\",\"roleIds\":[\"clx0role0002abcd1234efgh\"]}'
```

### 5.4 删除用户

`DELETE /api/console/users/{id}`

鉴权：登录 + `user:delete`。

业务限制：

- 不能删除当前登录账号（`400 不能删除自己的账号`）。
- 不能删除最后一个管理员（`400 不能删除最后一个管理员账号`）。

成功响应 `200`：

```json
{ "ok": true }
```

错误：`400`（上述两种）、`401`、`403`、`404`，以及外键约束导致未捕获的 `500`（用户的文章/评论没有级联删除）。

```powershell
curl.exe -X DELETE "http://localhost:3000/api/console/users/clx0user0002abcd1234efgh" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

### 5.5 指定用户的登录设备

#### 5.5.1 查看设备

`GET /api/console/users/{id}/sessions`

鉴权：登录 + `user:list`。

成功响应 `200`：

```json
{
  "list": [
    {
      "id": "clx0ses0001abcd1234efgh",
      "userAgent": "Mozilla/5.0 ...",
      "ip": "127.0.0.1",
      "device": "Chrome · Windows",
      "lastActiveAt": "2026-11-21T08:00:00.000Z",
      "expiresAt": "2026-12-21T08:00:00.000Z",
      "createdAt": "2026-11-21T07:00:00.000Z",
      "current": false
    }
  ]
}
```

- 仅返回 `expiresAt > now` 的记录；`token` 字段在返回前被剔除。
- 该接口不传 `currentToken`，因此 `current` 恒为 `false`。

错误：`401`、`403`、`404`（用户不存在）。

```powershell
curl.exe "http://localhost:3000/api/console/users/clx0user0002abcd1234efgh/sessions" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

#### 5.5.2 下线设备

`DELETE /api/console/users/{id}/sessions`

鉴权：登录 + `user:update`。

参数（二选一）：

| 位置 | 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| JSON Body | `sessionId` | string | 否 | 会话主键 |
| Query | `sessionId` | string | 否 | 同上，Body 优先 |

不传 `sessionId` 时下线该用户全部设备。

成功响应 `200`：

```json
{ "ok": true, "revoked": 2 }
```

错误：`401`、`403`。

```powershell
curl.exe -X DELETE "http://localhost:3000/api/console/users/clx0user0002abcd1234efgh/sessions" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"sessionId\":\"clx0ses0001abcd1234efgh\"}'
```

### 5.6 角色列表

`GET /api/console/roles`

鉴权：登录 + `role:list`。

成功响应 `200`：

```json
{
  "list": [
    {
      "id": "clx0role0002abcd1234efgh",
      "name": "editor",
      "displayName": "编辑",
      "description": null,
      "builtIn": true,
      "forbidConsole": false,
      "createdAt": "2026-10-01T02:00:00.000Z",
      "updatedAt": "2026-10-01T02:00:00.000Z",
      "roleTemplateId": null,
      "permissions": [
        {
          "roleId": "clx0role0002abcd1234efgh",
          "permissionId": "clx0perm0031abcd1234efgh",
          "createdAt": "2026-10-01T02:00:00.000Z",
          "permission": {
            "id": "clx0perm0031abcd1234efgh",
            "name": "post:create",
            "displayName": "创建文章",
            "group": "内容",
            "description": null
          }
        }
      ],
      "_count": { "users": 2 }
    }
  ],
  "permissions": [
    {
      "id": "clx0perm0031abcd1234efgh",
      "name": "post:create",
      "displayName": "创建文章",
      "group": "内容",
      "description": null
    }
  ]
}
```

错误：`401`、`403`。

```powershell
curl.exe "http://localhost:3000/api/console/roles" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

### 5.7 创建角色

`POST /api/console/roles`

鉴权：登录 + `role:create`。

请求体：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `name` | string | 是 | 无 | 2–50，`^[a-zA-Z0-9_-]+$`，唯一 |
| `displayName` | string | 是 | 无 | trim 后 1–50 |
| `description` | string \| null | 否 | `null` | ≤200 |
| `permissionIds` | string[] | 否 | `[]` | 仅关联真实存在的权限 id |

成功响应 `201`：返回 `Role`（含 `permissions.permission`、`_count.users`）。

错误：`400`（JSON 非法/校验失败/`角色标识已存在`）、`401`、`403`、`500`。

```powershell
curl.exe -X POST "http://localhost:3000/api/console/roles" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"name\":\"reviewer\",\"displayName\":\"审核员\",\"description\":null,\"permissionIds\":[]}'
```

### 5.8 更新角色

`PUT /api/console/roles/{id}`

鉴权：登录 + `role:update`。

请求体（可选）：`name`、`displayName`、`description`、`permissionIds`。

内置角色限制：

- `builtIn` 为 `true` 时修改 `name` → `400 内置角色的标识不可修改`。
- `builtIn` 为 `true` 时传 `permissionIds` → `400 内置角色的权限不可修改`。

成功响应 `200`：返回更新后的 `Role`（含 `permissions.permission`、`_count.users`）。

错误：`400`、`401`、`403`、`404`（角色不存在）、`500`。

```powershell
curl.exe -X PUT "http://localhost:3000/api/console/roles/clx0role0003abcd1234efgh" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"displayName\":\"高级审核员\",\"permissionIds\":[\"clx0perm0001abcd1234efgh\"]}'
```

### 5.9 删除角色

`DELETE /api/console/roles/{id}`

鉴权：登录 + `role:delete`。

业务限制：内置角色不可删除；角色下仍有用户不可删除。

成功响应 `200`：

```json
{ "ok": true }
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | `内置角色不可删除` / `该角色下仍有用户，请先解除分配` |
| 401 | 未登录 |
| 403 | 缺少 `role:delete` |
| 404 | 角色不存在 |

```powershell
curl.exe -X DELETE "http://localhost:3000/api/console/roles/clx0role0003abcd1234efgh" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

### 5.10 我的资料

`GET /api/profile`

鉴权：登录。

成功响应 `200`：

```json
{
  "id": "clx0user0002abcd1234efgh",
  "username": "alice",
  "displayName": "Alice",
  "email": "alice@example.com",
  "bio": null,
  "avatar": null,
  "status": "ENABLED",
  "createdAt": "2026-10-01T02:00:00.000Z",
  "lastLoginAt": "2026-11-21T07:00:00.000Z",
  "roles": ["访客用户"]
}
```

- `roles` 已被映射为角色的 `displayName` 字符串数组。

错误：`401`、`404`（用户不存在或已禁用）。

```powershell
curl.exe "http://localhost:3000/api/profile" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

`PATCH /api/profile`

用途：更新自己的资料或修改密码。

鉴权：登录。

请求体：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `displayName` | string | 否 | 原值 | trim 后 1–30 |
| `email` | string \| null | 否 | 原值 | 合法邮箱；`''` 视为不修改 |
| `bio` | string \| null | 否 | 原值 | ≤200 |
| `avatar` | string \| null | 否 | 原值 | 必须是 URL；`''` 会写成 `null` |
| `currentPassword` | string | 改密码时是 | 无 | 无长度限制 |
| `newPassword` | string | 否 | 无 | 6–72；传入时必须提供正确的 `currentPassword` |

成功响应 `200`：

```json
{ "ok": true }
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | JSON 非法 / 校验失败 / `当前密码不正确` |
| 401 | 未登录 |
| 404 | 用户不存在或已禁用 |
| 409 | `邮箱已被其他账号使用` |

```powershell
curl.exe -X PATCH "http://localhost:3000/api/profile" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"displayName\":\"Alice Chen\",\"bio\":\"Hello\",\"currentPassword\":\"oldpass\",\"newPassword\":\"newpass123\"}'
```

### 5.11 我的登录设备

`GET /api/profile/sessions`

鉴权：登录。

成功响应 `200`：结构同 5.5.1，但会用 `session.user.sessionToken` 标记当前设备。

```json
{
  "list": [
    {
      "id": "clx0ses0002abcd1234efgh",
      "userAgent": "Mozilla/5.0 ...",
      "ip": "127.0.0.1",
      "device": "Chrome · Windows",
      "lastActiveAt": "2026-11-21T08:00:00.000Z",
      "expiresAt": "2026-12-21T08:00:00.000Z",
      "createdAt": "2026-11-21T07:00:00.000Z",
      "current": true
    }
  ]
}
```

错误：`401`。

```powershell
curl.exe "http://localhost:3000/api/profile/sessions" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

`DELETE /api/profile/sessions`

用途：下线设备。传 `sessionId` 下线单个设备；不传则下线除当前设备外的全部设备（内部把当前 `sessionToken` 作为例外传入）。

鉴权：登录。

参数：JSON Body `sessionId` 或 Query `sessionId`，Body 优先。

成功响应 `200`：

```json
{ "ok": true, "revoked": 1 }
```

错误：`401`、`404`（`设备不存在或已下线`，仅指定 `sessionId` 且删除 0 条时）。

```powershell
curl.exe -X DELETE "http://localhost:3000/api/profile/sessions" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"sessionId\":\"clx0ses0002abcd1234efgh\"}'
```

---

## 6. 后台管理接口

后台接口统一位于 `/api/console/**`，均需登录；权限要求见各小节。`middleware.ts` 只保护 `/console` 页面，不保护这些 API。

### 6.1 站点设置

#### 6.1.1 读取设置

`GET /api/console/settings`

鉴权：登录即可（不校验权限键）。

成功响应 `200`：返回 `SiteSetting` 全字段，但密钥字段统一脱敏为空串，并额外附带 `hasXxx` 布尔标记。

```json
{
  "id": "default",
  "title": "RainyNest",
  "subtitle": null,
  "description": "一个关于技术与生活的博客",
  "url": "http://localhost:3000",
  "logo": null,
  "favicon": null,
  "icp": null,
  "footerText": null,
  "keywords": null,
  "author": null,
  "googleVerification": null,
  "baiduVerification": null,
  "githubUrl": null,
  "twitterUrl": null,
  "email": null,
  "allowRegister": false,
  "commentModeration": true,
  "enableRss": true,
  "enableSitemap": true,
  "codeShowLineNumbers": true,
  "codeCollapsible": true,
  "codeCollapseThreshold": 15,
  "codeLanguageBadge": true,
  "enableCallouts": true,
  "enableMath": true,
  "enableWikiLink": false,
  "enableReadingTime": true,
  "enableEmailProtection": true,
  "enableSectionize": false,
  "codeTabGroup": true,
  "enableFigure": true,
  "enableMermaid": false,
  "enablePlantuml": false,
  "smtpHost": null,
  "smtpPort": null,
  "smtpUser": null,
  "smtpPass": "",
  "hasSmtpPass": false,
  "smtpFrom": null,
  "autoBackupCron": null,
  "autoBackupKeep": 7,
  "allowThemeGitInstall": true,
  "oauthGithubId": null,
  "oauthGithubSecret": "",
  "hasOauthGithubSecret": false,
  "oauthGoogleId": null,
  "oauthGoogleSecret": "",
  "hasOauthGoogleSecret": false,
  "oauthWechatId": null,
  "oauthWechatSecret": "",
  "hasOauthWechatSecret": false,
  "enableLdap": false,
  "ldapUrl": null,
  "ldapBindDn": null,
  "ldapBindPassword": "",
  "hasLdapBindPassword": false,
  "ldapBaseDn": null,
  "ldapUserFilter": null,
  "primaryColor": "#3b82f6",
  "ipSource": "auto",
  "ipCustomHeader": null,
  "createdAt": "2026-10-01T02:00:00.000Z",
  "updatedAt": "2026-11-21T08:00:00.000Z"
}
```

脱敏说明：`smtpPass`、`oauthGithubSecret`、`oauthGoogleSecret`、`oauthWechatSecret`、`ldapBindPassword` 在响应中固定为空串，是否已配置改由 `hasSmtpPass`、`hasOauthGithubSecret`、`hasOauthGoogleSecret`、`hasOauthWechatSecret`、`hasLdapBindPassword` 表示（已修复，原「原样返回密钥」问题见 9.2 第 3 条）。

错误：`401`。

```powershell
curl.exe "http://localhost:3000/api/console/settings" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

#### 6.1.2 保存设置

`PUT /api/console/settings`

鉴权：登录 + `site:config`。

请求体：以下字段全部可选；未传字段保持原值；未知字段被 zod `.strip()` 丢弃。

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `title` | string | ≤100 |
| `subtitle` | string \| null | ≤200 |
| `description` | string | ≤500 |
| `url` | string | ≤500 |
| `logo`、`favicon`、`icp`、`footerText` | string \| null | 无长度限制 |
| `keywords`、`author` | string \| null | 无长度限制 |
| `googleVerification`、`baiduVerification` | string \| null | 无长度限制 |
| `githubUrl`、`twitterUrl`、`email` | string \| null | 无长度限制 |
| `allowRegister`、`commentModeration` | boolean | 无 |
| `enableRss`、`enableSitemap` | boolean | 无 |
| `codeShowLineNumbers`、`codeCollapsible`、`codeLanguageBadge` | boolean | 无 |
| `codeCollapseThreshold` | number | 整数 0–200 |
| `enableCallouts`、`enableMath`、`enableWikiLink`、`enableReadingTime` | boolean | 无 |
| `enableEmailProtection`、`enableSectionize`、`codeTabGroup` | boolean | 无 |
| `enableFigure`、`enableMermaid`、`enablePlantuml` | boolean | 无 |
| `smtpHost`、`smtpUser`、`smtpPass`、`smtpFrom` | string \| null | 无 |
| `smtpPort` | number \| null | 整数 0–65535 |
| `primaryColor` | string \| null | 保存为 `#RRGGBB` 时同步写入当前激活主题的 `config.basic.primaryColor` |
| `ipSource` | string | `auto` / `x-forwarded-for` / `x-real-ip` / `cf-connecting-ip` / `direct` / `custom` |
| `ipCustomHeader` | string \| null | ≤100 |
| `autoBackupCron` | string \| null | ≤120（标准 5 段 cron 文本，仅存储） |
| `autoBackupKeep` | number | 整数 1–365 |
| `allowThemeGitInstall` | boolean | 无 |
| `oauthGithubId`、`oauthGithubSecret` | string \| null | 分别 ≤200 / ≤300 |
| `oauthGoogleId`、`oauthGoogleSecret` | string \| null | 分别 ≤200 / ≤300 |
| `oauthWechatId`、`oauthWechatSecret` | string \| null | 分别 ≤200 / ≤300 |
| `enableLdap` | boolean | 无 |
| `ldapUrl`、`ldapBindDn`、`ldapBindPassword`、`ldapBaseDn`、`ldapUserFilter` | string \| null | 分别 ≤300 |

密钥字段语义：`smtpPass`、`oauthGithubSecret`、`oauthGoogleSecret`、`oauthWechatSecret`、`ldapBindPassword` 传空串 `""` 或 `null` 表示「未修改」，宿主会保留数据库中的原值；只有传入非空字符串才会覆盖。这样前端可直接回传 GET 得到的脱敏空值。

成功响应 `200`：返回保存后的 `SiteSetting`，结构同 6.1.1（密钥字段同样脱敏为空串并带 `hasXxx`）。

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | 请求体不是合法 JSON / 参数校验失败 |
| 401 | 未登录 |
| 403 | 缺少 `site:config` |
| 500 | `保存站点设置失败` |

```powershell
curl.exe -X PUT "http://localhost:3000/api/console/settings" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"title\":\"我的博客\",\"allowRegister\":true,\"primaryColor\":\"#3b82f6\"}'
```

### 6.2 测试 SMTP

`POST /api/console/settings/test-smtp`

用途：使用数据库中已保存的 SMTP 配置（含真实密码）调用 `transporter.verify()`；不需要也不接受前端回传密码。

鉴权：登录 + `site:config`。

请求体：无。

成功响应 `200`：

```json
{ "ok": true, "message": "SMTP 连接成功" }
```

失败响应 `400`：

```json
{ "ok": false, "message": "connect ECONNREFUSED 127.0.0.1:465" }
```

错误：`401`、`403`（校验失败仍为 400，`message` 为底层错误信息）。

```powershell
curl.exe -X POST "http://localhost:3000/api/console/settings/test-smtp" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

### 6.3 概览统计

`GET /api/console/stats`

鉴权：登录即可。

成功响应 `200`：

```json
{
  "posts": 12,
  "publishedPosts": 10,
  "comments": 30,
  "pendingComments": 2,
  "views": 1200,
  "online": 3,
  "recentComments": [
    {
      "id": "clx0cmt0004abcd1234efgh",
      "postId": "clx0post0001abcd1234efgh",
      "userId": "clx0user0002abcd1234efgh",
      "parentId": null,
      "content": "写得好",
      "status": "APPROVED",
      "ip": "127.0.0.1",
      "userAgent": "Mozilla/5.0",
      "extra": null,
      "createdAt": "2026-11-21T08:50:00.000Z",
      "user": { "id": "clx0user0002abcd1234efgh", "username": "alice", "displayName": "Alice", "avatar": null },
      "post": { "id": "clx0post0001abcd1234efgh", "title": "RainyNest 安装成功", "slug": "rainynest-hello-world" }
    }
  ],
  "topPosts": [
    { "id": "clx0post0001abcd1234efgh", "title": "RainyNest 安装成功", "slug": "rainynest-hello-world", "views": 500 }
  ]
}
```

- `online` 为统计库中最近 5 分钟包含 `sessionId` 的去重访问数；统计库异常时为 `0`。

错误：`401`。

```powershell
curl.exe "http://localhost:3000/api/console/stats" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

### 6.4 详细统计

`GET /api/console/stats/detailed`

鉴权：登录即可。

成功响应 `200`：

```json
{
  "pvTrend": [
    { "date": "10-23", "pv": 12, "uv": 5 }
  ],
  "topPosts": [
    { "id": "clx0post0001abcd1234efgh", "title": "RainyNest 安装成功", "slug": "rainynest-hello-world", "views": 500 }
  ],
  "sources": [
    { "referer": "https://example.com", "count": 8 }
  ],
  "topPaths": [
    { "path": "/blog/rainynest-hello-world", "count": 120, "lastViewedAt": "2026-11-21T08:00:00.000Z" }
  ],
  "totalPvAllTime": 1500
}
```

- `pvTrend` 固定 30 项，日期格式 `MM-DD`，无数据补 0。
- `sources` 为近 30 天按 `referer` 分组前 5。
- `topPaths` 为全时段按路径分组前 20。

错误：`401`。

```powershell
curl.exe "http://localhost:3000/api/console/stats/detailed" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

### 6.5 缓存与维护

`POST /api/console/cache`

鉴权：登录即可（不校验权限键）。

请求体（两种模式二选一）：

| 字段 | 类型 | 必填 | 取值 | 说明 |
| --- | --- | --- | --- | --- |
| `action` | string | 否 | `views` / `fts` / `revalidate` / `all` | 维护动作 |
| `type` | string | 否 | `site` / `theme` / `all` | 旧版缓存清理 |

- `views`：把全部文章 `views` 置 0，`result.views` 为影响行数。
- `fts`：重建 SQLite FTS5 表 `post_fts` 及触发器，`result.fts = true`。
- `revalidate`：`revalidatePath('/', 'layout')`，`result.revalidate = true`。
- `all`：依次执行以上三项。
- `type`：清理站点设置缓存、主题缓存与插件缓存，并 revalidate 布局。

成功响应 `200`（action 模式）：

```json
{ "ok": true, "action": "views", "result": { "views": 12 } }
```

成功响应 `200`（type 模式）：

```json
{ "ok": true, "type": "theme" }
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | 请求体不是合法 JSON / `action 必须是 views / fts / revalidate / all；或 type 必须是 site / theme / all` / `缺少 action 或 type 参数` |
| 401 | 未登录 |
| 500 | 维护失败（`error` 为底层错误信息） |

```powershell
curl.exe -X POST "http://localhost:3000/api/console/cache" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"action\":\"all\"}'
```

### 6.6 附件库

#### 6.6.1 附件列表

`GET /api/console/attachments`

鉴权：登录 + `console:access`（该权限键未在 seed 中定义，实际仅超级管理员可用）。

Query 参数：

| 参数 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `page` | number | 否 | 1 | 最小 1 |
| `size` | number | 否 | 24 | 1–60 |
| `q` | string | 否 | 空 | 匹配 `name`、`url`、`mimeType` |

成功响应 `200`：

```json
{
  "list": [
    {
      "id": "clx0att0001abcd1234efgh",
      "name": "cover.jpg",
      "url": "/uploads/202611/abc123.jpg",
      "mimeType": "image/jpeg",
      "size": 204800,
      "storage": "local",
      "uploaderId": "clx0user0001abcd1234efgh",
      "createdAt": "2026-11-21T08:30:00.000Z",
      "uploader": { "displayName": "管理员", "username": "admin" }
    }
  ],
  "total": 1,
  "page": 1,
  "size": 24,
  "pages": 1,
  "tabs": [],
  "operations": []
}
```

- `uploader` 为 `null` 时表示由未登录/已删除用户上传。

错误：`401`、`403`、`500`（`读取附件库失败`）。

```powershell
curl.exe "http://localhost:3000/api/console/attachments?page=1&size=24&q=jpg" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

#### 6.6.2 删除附件

`DELETE /api/console/attachments?id={id}`

鉴权：登录 + `photo:delete`。

Query 参数：`id`（必填，附件主键）。

行为：删除数据库记录；若 `storage === 'local'` 且 `url` 以 `/uploads/` 开头，同步删除 `public` 下的物理文件（文件不存在时忽略）。

成功响应 `200`：

```json
{ "ok": true }
```

错误：`400`（`缺少 id`）、`401`、`403`、`404`（`附件不存在`）、`500`（`删除失败`）。

```powershell
curl.exe -X DELETE "http://localhost:3000/api/console/attachments?id=clx0att0001abcd1234efgh" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

### 6.7 备份与恢复

所有备份接口仅允许 `permissions` 含 `*` 的超级管理员；其他已登录用户返回 `403`。

#### 6.7.1 备份列表 / 下载

`GET /api/console/backup`

无 `name` 时返回列表；带 `name` 时返回 zip 流（不是 JSON）。

成功响应 `200`（列表）：

```json
{
  "backups": [
    {
      "name": "20261121-083000",
      "createdAt": "2026-11-21T08:30:00.000Z",
      "type": "manual",
      "size": 1048576,
      "files": ["blog.db", "analytics.db", "plugins-db/hello.db", "plugins-json"],
      "version": 1
    }
  ],
  "tabs": [],
  "operations": []
}
```

下载成功响应 `200`：

- `Content-Type: application/zip`
- `Content-Disposition: attachment; filename="rainynest-backup-<name>.zip"`
- Body 为 zip 二进制；包内包含 `blog.db`、`analytics.db`、`plugins-db/*.db`、`plugins-json/*`、`meta.json`。

错误：`401`、`403`（`只有管理员可以操作备份`）、`404`（下载失败，`error` 为底层信息）、`500`（`读取备份列表失败`）。

```powershell
curl.exe "http://localhost:3000/api/console/backup" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"

curl.exe -o backup.zip "http://localhost:3000/api/console/backup?name=20261121-083000" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

#### 6.7.2 创建备份

`POST /api/console/backup`

请求体（可选）：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `type` | string | 否 | `manual` | 传 `auto` 时类型为自动备份，并按 `autoBackupKeep` 清理旧自动备份 |

无请求体或非 JSON 时按 `manual` 处理，不报错。

成功响应 `200`：

```json
{
  "ok": true,
  "backup": {
    "name": "20261121-084500",
    "createdAt": "2026-11-21T08:45:00.000Z",
    "type": "manual",
    "size": 1048576,
    "files": ["blog.db", "analytics.db"],
    "version": 1
  }
}
```

错误：`401`、`403`、`500`（`备份创建失败`）。

```powershell
curl.exe -X POST "http://localhost:3000/api/console/backup" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"type\":\"manual\"}'
```

#### 6.7.3 删除备份

`DELETE /api/console/backup?name={name}`

Query 参数：`name`（必填，备份目录名）。

成功响应 `200`：

```json
{ "ok": true, "name": "20261121-084500" }
```

错误：`400`（`缺少 name 参数` / `删除备份失败`）、`401`、`403`。

```powershell
curl.exe -X DELETE "http://localhost:3000/api/console/backup?name=20261121-084500" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

#### 6.7.4 恢复备份

`POST /api/console/backup/restore`

鉴权：登录 + `permissions` 含 `*`。

请求：`multipart/form-data`，字段 `file`。

| 参数 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `file` | File | 是 | 最大 200MB；`.zip` 备份包或合法 SQLite `.db` |

行为：

- zip：读取 `blog.db` / `analytics.db` / `plugins-db/*.db` / `plugins-json/*`，校验 SQLite 文件头后覆盖。
- 单文件：按文件名是否含 `analytics` 决定覆盖 `analytics.db` 或 `blog.db`。
- 恢复前自动创建一份手动备份，返回其名称 `preBackup`。
- 恢复期间断开并重连 Prisma、关闭插件数据库连接。

成功响应 `200`：

```json
{
  "ok": true,
  "preBackup": "20261121-085000",
  "restored": ["blog.db", "analytics.db"],
  "restartRequired": true,
  "message": "数据库已恢复，建议重启服务以确保所有连接使用新库"
}
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | `请求体不是合法的 multipart 表单` / `缺少 file 字段` / 恢复失败（错误信息来自 lib） |
| 401 | 未登录 |
| 403 | `只有管理员可以恢复备份` |
| 413 | `备份文件超过 200MB 上限` |

```powershell
curl.exe -X POST "http://localhost:3000/api/console/backup/restore" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -F "file=@D:\backup\rainynest-backup-20261121-083000.zip"
```

### 6.8 插件管理

#### 6.8.1 插件列表

`GET /api/console/plugins`

鉴权：登录即可。

成功响应 `200`：

```json
{
  "list": [
    {
      "slug": "hello",
      "name": "Hello Plugin",
      "version": "1.0.0",
      "description": "示例插件",
      "author": "RainyNest",
      "specVersion": "1.0",
      "requiresCore": ">=1.0.0",
      "icon": "Puzzle",
      "id": "clx0plg0001abcd1234efgh",
      "isActive": true,
      "config": { "greeting": "hi" },
      "source": "builtin",
      "installedAt": "2026-11-01T02:00:00.000Z",
      "updatedAt": "2026-11-01T02:00:00.000Z"
    }
  ],
  "fields": [],
  "operations": [],
  "tabs": [],
  "installTabs": []
}
```

- `list` 由磁盘 `scripts/plugins/<slug>/plugin.json` 与数据库 `Plugin` 合并；数据库有记录但磁盘缺失时追加 `missing: true` 项，且 `config` 为 `null`。
- `plugin.json` 的字段（含 `requiresCore`、`native`）原样展开返回。当 `requiresCore` 不满足当前核心版本时，该项额外带 `loadError` 字符串，例如 `要求核心版本 >=2.0.0，当前核心版本 1.2.0`；满足时 `loadError` 为 `undefined`（JSON 中省略）。
- 有插件注册 `pluginListItemField` 时，列表项额外带 `_fields`。

错误：`401`。

```powershell
curl.exe "http://localhost:3000/api/console/plugins" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

#### 6.8.2 安装 / 升级插件

`POST /api/console/plugins/install`

鉴权：登录 + `plugin:install`。

请求：`multipart/form-data`，字段 `file`。

| 参数 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `file` | File | 是 | 文件名以 `.zip.rainy-plugin` 或 `.gz.rainy-plugin` 结尾；≤20MB |

成功响应 `200`：

```json
{ "ok": true, "kind": "plugin", "slug": "hello", "version": "1.1.0", "upgraded": true }
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | `请求体不是合法的 multipart 表单` / `缺少 file 字段` / 安装失败（包名、清单、`specVersion`、`requiresCore`、版本、文件类型、native 覆盖等校验错误） |
| 401 | 未登录 |
| 403 | 缺少 `plugin:install` |
| 413 | `包体积超过 20MB 上限` |

```powershell
curl.exe -X POST "http://localhost:3000/api/console/plugins/install" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -F "file=@D:\packages\hello.zip.rainy-plugin"
```

#### 6.8.3 卸载插件

`DELETE /api/console/plugins/{slug}?keepData=1`

鉴权：登录 + `plugin:uninstall`。

Query 参数：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `keepData` | string | 否 | 空 | 值为 `1` 时保留插件数据库与 JSON 数据 |

成功响应 `200`：

```json
{ "ok": true, "slug": "hello", "keepData": false }
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | `内置插件不允许卸载 如需关闭请使用停用`（数据库记录 `source=builtin` 且磁盘清单未标记 native 时的兜底） |
| 401 | 未登录 |
| 403 | 缺少 `plugin:uninstall`；或磁盘 `plugin.json` 标记 `native: true`，返回 `内置插件不可卸载` |
| 404 | `插件不存在` |
| 500 | 卸载失败（底层错误信息） |

```powershell
curl.exe -X DELETE "http://localhost:3000/api/console/plugins/hello?keepData=1" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

#### 6.8.4 启用插件

`POST /api/console/plugins/{slug}/activate`

鉴权：登录 + `plugin:activate`。

请求体：无。

成功响应 `200`：

```json
{ "ok": true, "slug": "hello", "isActive": true }
```

错误：`401`、`403`、`404`（`插件不存在或 plugin.json 缺失`）、`500`（`plugin.json 解析失败` 或 `启用插件失败`）。

```powershell
curl.exe -X POST "http://localhost:3000/api/console/plugins/hello/activate" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

#### 6.8.5 停用插件

`POST /api/console/plugins/{slug}/deactivate`

鉴权：登录 + `plugin:deactivate`。

成功响应 `200`：

```json
{ "ok": true, "slug": "hello", "isActive": false }
```

错误：`401`、`403`、`404`（`插件记录不存在`）、`500`（`禁用插件失败`）。

```powershell
curl.exe -X POST "http://localhost:3000/api/console/plugins/hello/deactivate" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

#### 6.8.6 保存插件配置

`PUT /api/console/plugins/{slug}/config`

鉴权：登录 + `plugin:config`。

请求体：

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `config` | object | 是 | 任意键值对象，整体替换 `db/plugins-json/<slug>.config.json` |

成功响应 `200`：

```json
{ "ok": true }
```

错误：`400`（JSON 非法 / `config 必须是对象`）、`401`、`403`、`500`（`保存插件配置失败`）。

```powershell
curl.exe -X PUT "http://localhost:3000/api/console/plugins/hello/config" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"config\":{\"greeting\":\"hello\"}}'
```

#### 6.8.7 开发模式本地安装（dev-install）

`POST /api/console/extensions/dev-install`

用途：供 `ext dev` 热更新使用，只落盘并热重载，跳过版本校验与数据库记录（`installFromBuffer(..., { dev: true })`）。

鉴权：满足其一即可：

- 请求头 `x-ext-token` 与环境变量 `EXT_DEV_TOKEN` 完全一致；
- 登录且拥有 `plugin:install` 或 `*`。

注意：不满足时统一返回 `401`（不是 403）。

请求：`multipart/form-data`，字段 `file`，支持 `*.zip.rainy-plugin`、`*.gz.rainy-plugin`、`*.zip.rainy-theme`、`*.gz.rainy-theme`；≤20MB。

成功响应 `200`：

```json
{ "ok": true, "kind": "plugin", "slug": "hello", "version": "1.1.0" }
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | `请求体不是合法的 multipart 表单` / `缺少 file 字段` / 安装失败（包校验错误） |
| 401 | `未授权（需要管理员 session 或 x-ext-token）` |
| 413 | `包体积超过 20MB 上限` |

```powershell
curl.exe -X POST "http://localhost:3000/api/console/extensions/dev-install" `
  -H "x-ext-token: <EXT_DEV_TOKEN>" `
  -F "file=@D:\packages\hello.zip.rainy-plugin"
```

### 6.9 主题管理

#### 6.9.1 主题列表

`GET /api/console/themes`

鉴权：登录即可。

成功响应 `200`：

```json
{
  "list": [
    {
      "slug": "default",
      "name": "默认主题",
      "version": "1.0.0",
      "description": "RainyNest 默认主题",
      "author": "RainyNest",
      "preview": "/themes/default/preview.png",
      "minRainyNestVersion": "1.0.0",
      "supports": ["dark-mode"],
      "configSchema": {},
      "isActive": true,
      "config": { "basic": { "primaryColor": "#3b82f6" } },
      "source": "builtin",
      "installedAt": null,
      "updatedAt": null,
      "templates": ["hello/card"],
      "settingsHref": "/console/system/themes/default/settings"
    }
  ],
  "tabs": [],
  "operations": []
}
```

- 磁盘主题的 `config` 取自数据库记录，未保存过配置时为 `null`；`source` 无数据库记录时默认为 `builtin`。

- 数据库有记录但磁盘缺失时追加 `missing: true` 项，`supports: []`、`configSchema: {}`、`templates: []`、`settingsHref: null`。

错误：`401`。

```powershell
curl.exe "http://localhost:3000/api/console/themes" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

#### 6.9.2 上传安装主题

`POST /api/console/themes/install`

鉴权：登录 + `theme:install`。

请求：`multipart/form-data`，字段 `file`，文件名需以 `.zip.rainy-theme` 或 `.gz.rainy-theme` 结尾，≤20MB。

成功响应 `200`：

```json
{ "ok": true, "kind": "theme", "slug": "aurora", "version": "1.0.0", "upgraded": false }
```

错误：`400`（`请求体不是合法的 multipart 表单` / `缺少 file 字段` / 安装失败）、`401`、`403`、`413`（`包体积超过 20MB 上限`）。

```powershell
curl.exe -X POST "http://localhost:3000/api/console/themes/install" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -F "file=@D:\packages\aurora.zip.rainy-theme"
```

#### 6.9.3 Git 安装主题

`POST /api/console/themes/git-install`

鉴权：登录 + `theme:install`；且 `SiteSetting.allowThemeGitInstall === true`。

请求体：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `repoUrl` | string | 是 | 无 | 1–500，仅 `http:` / `https:` |
| `ref` | string | 否 | 空 | ≤200，`[A-Za-z0-9._][A-Za-z0-9._/-]*` |

行为：优先 `git clone --depth 1 --branch <ref>`（60 秒超时）；GitHub / Gitee 克隆失败时回退下载 tar.gz（上限 50MB）。

成功响应 `200`：

```json
{
  "ok": true,
  "slug": "aurora",
  "name": "Aurora",
  "version": "1.0.0",
  "upgraded": false,
  "method": "git"
}
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | JSON 非法 / repoUrl 或 ref 非法 / 协议不支持 / 安装失败（未找到 theme.json、清单错误、slug 非法等） |
| 401 | 未登录 |
| 403 | 缺少 `theme:install` / `站点已关闭 Git 安装主题` |

```powershell
curl.exe -X POST "http://localhost:3000/api/console/themes/git-install" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"repoUrl\":\"https://github.com/user/rainynest-theme-aurora\",\"ref\":\"main\"}'
```

#### 6.9.4 主题预览地址

`GET /api/console/themes/preview?slug={slug}`

鉴权：登录即可。

成功响应 `200`：

```json
{ "ok": true, "slug": "aurora", "name": "Aurora", "previewUrl": "/preview?theme=aurora" }
```

错误：`400`（`缺少 slug 参数`）、`401`、`404`（`主题不存在或 theme.json 缺失`）。

```powershell
curl.exe "http://localhost:3000/api/console/themes/preview?slug=aurora" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

#### 6.9.5 卸载主题

`DELETE /api/console/themes/{slug}`

鉴权：登录 + `theme:uninstall`。

成功响应 `200`：

```json
{ "ok": true, "slug": "aurora" }
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | `内置主题不允许卸载` / `该主题正在使用中 请先切换到其他主题` |
| 401 | 未登录 |
| 403 | 缺少 `theme:uninstall` |
| 404 | `主题不存在` |
| 500 | 卸载失败（底层错误信息） |

```powershell
curl.exe -X DELETE "http://localhost:3000/api/console/themes/aurora" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

#### 6.9.6 激活主题

`POST /api/console/themes/{slug}/activate`

鉴权：登录 + `theme:activate`。

成功响应 `200`：

```json
{ "ok": true, "slug": "aurora" }
```

错误：`401`、`403`、`404`（`主题不存在或 theme.json 缺失`）、`500`（`激活主题失败`）。

```powershell
curl.exe -X POST "http://localhost:3000/api/console/themes/aurora/activate" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

#### 6.9.7 保存主题配置

`PUT /api/console/themes/{slug}/config`

鉴权：登录 + `theme:config`。

请求体：

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `config` | object | 是 | 序列化后存入 `Theme.config` |

成功响应 `200`：

```json
{ "ok": true }
```

错误：`400`（JSON 非法 / `config 必须是对象`）、`401`、`403`、`404`（`主题不存在或 theme.json 缺失`）、`500`（`保存主题配置失败`）。

```powershell
curl.exe -X PUT "http://localhost:3000/api/console/themes/aurora/config" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"config\":{\"basic\":{\"primaryColor\":\"#3b82f6\"}}}'
```

### 6.10 后台插件 UI 扩展

#### 6.10.1 侧栏插件菜单

`GET /api/console/plugin-nav`

鉴权：登录 + `console:access`。

成功响应 `200`：

```json
{
  "items": [
    {
      "slug": "hello",
      "pluginName": "Hello Plugin",
      "path": "reports",
      "title": "报表",
      "href": "/console/plugin-ext/hello/reports",
      "group": "工具"
    }
  ]
}
```

- 插件系统未就绪或异常时返回 `{ "items": [] }`（仍为 200）。
- `group` 可能缺省。

错误：`401`、`403`。

```powershell
curl.exe "http://localhost:3000/api/console/plugin-nav" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

#### 6.10.2 仪表盘小部件

`GET /api/console/plugin-widgets`

鉴权：登录 + `console:access`。

成功响应 `200`：

```json
{
  "widgets": [
    {
      "slug": "hello",
      "title": "站点概览",
      "icon": "Activity",
      "colSpan": 2,
      "html": "<div>...</div>"
    }
  ],
  "quickActions": [
    {
      "label": "新建文章",
      "icon": "Plus",
      "href": "/console/posts/new"
    }
  ]
}
```

- `widgets[].colSpan` 默认 1；`html` 为服务端渲染后的字符串。
- 异常时返回 `{ "widgets": [], "quickActions": [] }`。
- `quickActions` 直接使用插件 `dashboardQuickAction` 的声明字段：`label`、`icon`、`href`、`permissions`（可选），**不附带** `slug`。

错误：`401`、`403`。

```powershell
curl.exe "http://localhost:3000/api/console/plugin-widgets" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

### 6.11 富文本编辑器插件动作

`GET /api/plugin/editor-actions`

鉴权：登录即可。

成功响应 `200`：

```json
{
  "list": [
    {
      "pluginSlug": "hello",
      "key": "signature",
      "label": "插入签名",
      "icon": "PenLine",
      "insert": "\n\n---\n\n作者签名",
      "shortcut": "mod+shift+s"
    }
  ]
}
```

- 每项为插件 `editorCreate` 定义加上 `pluginSlug`；字段集合为 `key`、`label`、`icon?`、`insert?`、`wrap?`、`shortcut?`、`permissions?`。
- 插件系统异常时返回 `{ "list": [] }`。

错误：`401`。

```powershell
curl.exe "http://localhost:3000/api/plugin/editor-actions" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

### 6.12 文件上传

`POST /api/upload`

用途：上传图片到插件存储或本地 `public/uploads/{yyyyMM}/`，并写入附件库。

鉴权：登录 + `photo:upload`。

请求：`multipart/form-data`，字段 `file`。

| 参数 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `file` | File | 是 | ≤10MB；MIME 必须是 `image/jpeg`、`image/png`、`image/gif`、`image/webp`、`image/svg+xml` |

存储：

1. 若插件通过 `attachmentStorage` 提供 provider，调用 `provider.upload({ filename, mimeType, size, buffer })`，成功时 `storage` 为 provider 名称。
2. 否则写本地：`public/uploads/{YYYYMM}/{base36时间戳+随机串}.{ext}`，`url` 为 `/uploads/{YYYYMM}/{filename}`，`storage` 为 `local`。
3. 上传前会用 `normalizeImage` 做 EXIF 方向校正（sharp 不可用时原样返回）。

成功响应 `201`：

```json
{ "url": "/uploads/202611/abc123.jpg", "storage": "local" }
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | `请求必须是 multipart/form-data` / `缺少 file 字段` / `文件超过 10MB 上限` / `仅支持 jpg / png / gif / webp / svg 图片` |
| 401 | 未登录 |
| 403 | 缺少 `photo:upload` |

```powershell
curl.exe -X POST "http://localhost:3000/api/upload" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -F "file=@D:\images\cover.jpg"
```

---

## 7. 运维接口

### 7.1 定时发布

`GET /api/cron/publish`

用途：把所有 `status = SCHEDULED` 且 `publishedAt <= now` 的文章改为 `PUBLISHED`。

鉴权：

- 环境变量 `CRON_SECRET` 已设置：必须携带 `Authorization: Bearer <CRON_SECRET>`，否则 `401 {"error":"Unauthorized"}`。
- `CRON_SECRET` 未设置：**不校验**任何凭据，任何调用者都可触发（代码如此）。

成功响应 `200`：

```json
{ "success": true, "published": 2 }
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 401 | `Unauthorized`（仅当配置了 `CRON_SECRET` 且请求头不匹配） |
| 500 | `{ "success": false, "error": "..." }` |

```powershell
curl.exe "http://localhost:3000/api/cron/publish" `
  -H "Authorization: Bearer <CRON_SECRET>"
```

### 7.2 统计聚合

`GET /api/cron/analytics`

用途：把统计库中未聚合的分钟级 PV 聚合到小时级并清理原始数据（`runMinuteAggregation`）。

鉴权：同 7.1（`CRON_SECRET` 可选）。

成功响应 `200`：

```json
{ "success": true }
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 401 | `Unauthorized` |
| 500 | `{ "success": false, "error": "..." }` |

```powershell
curl.exe "http://localhost:3000/api/cron/analytics" `
  -H "Authorization: Bearer <CRON_SECRET>"
```

### 7.3 PV 上报

`POST /api/analytics/pv`

用途：页面访问上报。写入进程内队列后立即返回，不等待数据库。

鉴权：公开。

请求体：

| 字段 | 类型 | 必填 | 默认值 | 约束 |
| --- | --- | --- | --- | --- |
| `path` | string | 是 | 无 | 长度 1–500 |
| `postSlug` | string | 否 | `null` | 无 |
| `sessionId` | string | 否 | `''` | 用于在线人数与 UV 去重 |
| `referer` | string | 否 | `''` | 来源页 |
| `ua` | string | 否 | `''` | 请求头无 `user-agent` 时使用 |

成功响应 `200`：

```json
{ "ok": true }
```

错误：

| 状态码 | 含义 |
| --- | --- |
| 400 | `{ "ok": false }`（JSON 非法或 `path` 缺失/超长） |

IP 解析规则由 `SiteSetting.ipSource` 决定：`auto`（按 `cf-connecting-ip` → `x-client-ip` → `x-forwarded-for` → `x-real-ip` 顺序）、`x-forwarded-for`、`x-real-ip`、`cf-connecting-ip`、`direct`（固定 `127.0.0.1`）、`custom`（读取 `ipCustomHeader`）。无法解析时统一为 `127.0.0.1`。

副作用：异步触发插件 `onPageView` 扩展点。

```powershell
curl.exe -X POST "http://localhost:3000/api/analytics/pv" `
  -H "Content-Type: application/json" `
  -d '{\"path\":\"/blog/rainynest-hello-world\",\"postSlug\":\"rainynest-hello-world\",\"sessionId\":\"8f3c2a\",\"referer\":\"https://example.com\"}'
```

### 7.4 在线人数（SSE）

`GET /api/analytics/online`

用途：以 Server-Sent Events 推送最近 5 分钟去重会话数。

鉴权：登录。

请求头（浏览器自动）：`Accept: text/event-stream`。

响应头：

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

事件序列：

```
retry: 5000

data: {"online":3}

data: {"online":4}

: heartbeat

: timeout
```

| 帧 | 含义 |
| --- | --- |
| `retry: 5000` | 首帧，重连间隔 5 秒 |
| `data: {"online":n}` | 当前在线数，每 5 秒推送一次 |
| `: heartbeat` | 统计库查询失败时的注释心跳，保持连接 |
| `: timeout` | 单连接达到 30 分钟，服务端主动关闭，客户端自动重连 |

该接口没有命名事件（`event:` 字段），客户端监听 `message` 即可。

错误：`401 {"error":"未登录"}`。

```powershell
curl.exe -N "http://localhost:3000/api/analytics/online" `
  -H "Accept: text/event-stream" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>"
```

---

## 8. 插件 API

### 8.1 插件自定义接口分发

`{GET|POST|PUT|DELETE} /api/plugin/{slug}/{customPath...}`

用途：把请求分发给已启用插件的 `customApi` 定义。

鉴权：由插件定义中的 `auth` 字段决定：

- `auth: true`：必须登录，否则 `401 {"error":"Unauthorized"}`。
- `auth: false`：公开。

路由匹配规则：

1. 第一段为插件 `slug`，其余段拼接为 `subPath`（以 `/` 开头）。
2. 在 `plugin.handlers.customApi` 中按 `method` 与 `path` 精确匹配；`path` 的前导 `/` 可有可无。
3. 未找到插件或接口 → `404 {"error":"Not found"}`。

支持方法：`GET`、`POST`、`PUT`、`DELETE`（`PATCH` 未导出，访问会得到 Next.js 405）。

成功响应：完全由插件 `handler(req)` 决定，框架不包装。

错误：

| 状态码 | 含义 |
| --- | --- |
| 401 | `Unauthorized`（`auth: true` 且未登录） |
| 404 | `Not found`（slug 为空、插件不存在、无 customApi、方法/路径不匹配） |
| 500 | `Internal error`（插件 handler 抛错，错误仅记录到服务端日志） |

```powershell
curl.exe "http://localhost:3000/api/plugin/hello/stats"

curl.exe -X POST "http://localhost:3000/api/plugin/hello/echo" `
  -H "Content-Type: application/json" `
  -H "Cookie: authjs.session-token=<SESSION_COOKIE>" `
  -d '{\"message\":\"hi\"}'
```

### 8.2 插件 API 中间件覆盖范围

核心路由只要在文件内调用了 `pluginApiGate(req)`，就会先执行插件的 `apiMiddleware`。当前覆盖情况（其余路由**不执行**插件 API 中间件）：

| 路由 | 方法 |
| --- | --- |
| `/api/posts` | `GET`、`POST` |
| `/api/comments` | `GET`、`POST` |
| `/api/categories` | `POST` |
| `/api/tags` | `POST` |
| `/api/pages` | `POST` |
| `/api/gallery` | `POST` |
| `/api/links` | `POST` |
| `/api/moments` | `GET`、`POST` |

插件声明（`@rainynest/plugin-types`）：

```ts
export interface ApiMiddlewareDef {
  path?: string;   // 路径前缀，如 /api/posts；留空表示全部 API
  methods?: ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE')[];
  handler: (req: Request, next: () => Promise<Response>) => Response | void | Promise<Response | void>;
  critical?: boolean; // 0.3.3 起：安全策略中间件，失败返回 503
  timeout?: number;   // 0.3.3 起：超时毫秒数，默认 10000
}
```

`handler` 返回 `Response` 即拦截；返回 `void` 或调用 `next()` 继续执行原逻辑（`next()` 单次调用受控，重复调用不会导致后续中间件重复执行）。普通中间件内部抛错 / 超时只记日志并继续链；`critical: true` 中间件失败返回 503 拒绝请求（0.3.3 起）。

### 8.3 插件编辑器动作

见 6.11 `GET /api/plugin/editor-actions`。

---

## 9. 附录

### 9.1 完整接口总表

说明：共 63 个路由文件、99 个方法入口（含 NextAuth 内置的 `GET`/`POST` 与插件分发器的 4 个方法）。

#### 认证

| Method | Path | 鉴权 | 权限键 | 说明 | 源文件 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/auth/[...nextauth]` | 公开 | - | NextAuth 内置（session/csrf/providers/signin/signout/callback） | `app/api/auth/[...nextauth]/route.ts` |
| POST | `/api/auth/[...nextauth]` | 公开 | - | NextAuth 内置（登录、登出回调） | `app/api/auth/[...nextauth]/route.ts` |
| POST | `/api/auth/register` | 公开 | - | 注册账号 | `app/api/auth/register/route.ts` |
| POST | `/api/auth/email-code` | 公开 | - | 发送登录邮箱验证码 | `app/api/auth/email-code/route.ts` |
| POST | `/api/auth/forgot-password` | 公开 | - | 发送重置密码验证码 | `app/api/auth/forgot-password/route.ts` |
| POST | `/api/auth/reset-password` | 公开 | - | 重置密码 | `app/api/auth/reset-password/route.ts` |

#### 公共内容

| Method | Path | 鉴权 | 权限键 | 说明 | 源文件 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/posts` | 公开 | - | 文章列表 | `app/api/posts/route.ts` |
| POST | `/api/posts` | 登录 | `post:create` | 创建文章 | `app/api/posts/route.ts` |
| GET | `/api/posts/{id}` | 公开 | - | 文章详情 | `app/api/posts/[id]/route.ts` |
| PUT | `/api/posts/{id}` | 登录 | `post:update` | 更新文章 | `app/api/posts/[id]/route.ts` |
| DELETE | `/api/posts/{id}` | 登录 | `post:delete` | 删除文章 | `app/api/posts/[id]/route.ts` |
| POST | `/api/posts/preview` | 登录 | - | Markdown 预览 | `app/api/posts/preview/route.ts` |
| GET | `/api/categories` | 公开 | - | 分类列表 | `app/api/categories/route.ts` |
| POST | `/api/categories` | 登录 | `category:create` | 创建分类 | `app/api/categories/route.ts` |
| PUT | `/api/categories/{id}` | 登录 | `category:update` | 更新分类 | `app/api/categories/[id]/route.ts` |
| DELETE | `/api/categories/{id}` | 登录 | `category:delete` | 删除分类 | `app/api/categories/[id]/route.ts` |
| GET | `/api/tags` | 公开 | - | 标签列表 | `app/api/tags/route.ts` |
| POST | `/api/tags` | 登录 | `tag:create` | 创建标签 | `app/api/tags/route.ts` |
| PUT | `/api/tags/{id}` | 登录 | `tag:update` | 更新标签 | `app/api/tags/[id]/route.ts` |
| DELETE | `/api/tags/{id}` | 登录 | `tag:delete` | 删除标签 | `app/api/tags/[id]/route.ts` |
| POST | `/api/tags/merge` | 登录 | `tag:update` | 合并标签 | `app/api/tags/merge/route.ts` |
| GET | `/api/pages` | 公开 | - | 页面列表 | `app/api/pages/route.ts` |
| POST | `/api/pages` | 登录 | `page:create` | 创建页面 | `app/api/pages/route.ts` |
| GET | `/api/pages/{id}` | 公开 | - | 页面详情 | `app/api/pages/[id]/route.ts` |
| PUT | `/api/pages/{id}` | 登录 | `page:update` | 更新页面 | `app/api/pages/[id]/route.ts` |
| DELETE | `/api/pages/{id}` | 登录 | `page:delete` | 删除页面 | `app/api/pages/[id]/route.ts` |
| GET | `/api/comments` | 公开/登录 | - | 评论列表（公开树 / 后台列表） | `app/api/comments/route.ts` |
| POST | `/api/comments` | 登录 | - | 发表评论 | `app/api/comments/route.ts` |
| PUT | `/api/comments/{id}` | 登录 | `comment:approve` 或 `comment:reject` | 审核评论 | `app/api/comments/[id]/route.ts` |
| DELETE | `/api/comments/{id}` | 登录 | `comment:delete` | 删除评论 | `app/api/comments/[id]/route.ts` |
| GET | `/api/gallery` | 公开 | - | 相册列表 | `app/api/gallery/route.ts` |
| POST | `/api/gallery` | 登录 | `gallery:create` | 创建相册 | `app/api/gallery/route.ts` |
| GET | `/api/gallery/{id}` | 公开 | - | 相册详情 | `app/api/gallery/[id]/route.ts` |
| PUT | `/api/gallery/{id}` | 登录 | `gallery:update` | 更新相册 | `app/api/gallery/[id]/route.ts` |
| DELETE | `/api/gallery/{id}` | 登录 | `gallery:delete` | 删除相册 | `app/api/gallery/[id]/route.ts` |
| GET | `/api/links` | 公开 | - | 友链列表 | `app/api/links/route.ts` |
| POST | `/api/links` | 登录 | `link:create` | 创建友链 | `app/api/links/route.ts` |
| PUT | `/api/links/{id}` | 登录 | `link:update` | 更新友链 | `app/api/links/[id]/route.ts` |
| DELETE | `/api/links/{id}` | 登录 | `link:delete` | 删除友链 | `app/api/links/[id]/route.ts` |
| GET | `/api/moments` | 公开/登录 | - | 说说列表 | `app/api/moments/route.ts` |
| POST | `/api/moments` | 登录 | `moment:create` | 发布说说 | `app/api/moments/route.ts` |
| PUT | `/api/moments/{id}` | 登录 | `moment:update` | 更新说说 | `app/api/moments/[id]/route.ts` |
| DELETE | `/api/moments/{id}` | 登录 | `moment:delete` | 删除说说 | `app/api/moments/[id]/route.ts` |
| GET | `/api/menu` | 公开 | - | 菜单树 | `app/api/menu/route.ts` |
| POST | `/api/menu` | 登录 | `menu:create` | 创建菜单 | `app/api/menu/route.ts` |
| PUT | `/api/menu/{id}` | 登录 | `menu:update` | 更新菜单 | `app/api/menu/[id]/route.ts` |
| DELETE | `/api/menu/{id}` | 登录 | `menu:delete` | 删除菜单 | `app/api/menu/[id]/route.ts` |

#### 后台与个人资料

| Method | Path | 鉴权 | 权限键 | 说明 | 源文件 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/console/attachments` | 登录 | `console:access` | 附件列表 | `app/api/console/attachments/route.ts` |
| DELETE | `/api/console/attachments` | 登录 | `photo:delete` | 删除附件 | `app/api/console/attachments/route.ts` |
| GET | `/api/console/backup` | 登录 | `*` | 备份列表 / 下载 | `app/api/console/backup/route.ts` |
| POST | `/api/console/backup` | 登录 | `*` | 创建备份 | `app/api/console/backup/route.ts` |
| DELETE | `/api/console/backup` | 登录 | `*` | 删除备份 | `app/api/console/backup/route.ts` |
| POST | `/api/console/backup/restore` | 登录 | `*` | 恢复备份 | `app/api/console/backup/restore/route.ts` |
| POST | `/api/console/cache` | 登录 | - | 缓存/维护操作 | `app/api/console/cache/route.ts` |
| POST | `/api/console/extensions/dev-install` | 登录或 `x-ext-token` | `plugin:install` 或 `*` | 开发模式扩展安装 | `app/api/console/extensions/dev-install/route.ts` |
| GET | `/api/console/plugin-nav` | 登录 | `console:access` | 插件后台导航 | `app/api/console/plugin-nav/route.ts` |
| GET | `/api/console/plugin-widgets` | 登录 | `console:access` | 仪表盘插件组件 | `app/api/console/plugin-widgets/route.ts` |
| GET | `/api/console/plugins` | 登录 | - | 插件列表 | `app/api/console/plugins/route.ts` |
| POST | `/api/console/plugins/install` | 登录 | `plugin:install` | 安装/升级插件 | `app/api/console/plugins/install/route.ts` |
| DELETE | `/api/console/plugins/{slug}` | 登录 | `plugin:uninstall` | 卸载插件 | `app/api/console/plugins/[slug]/route.ts` |
| POST | `/api/console/plugins/{slug}/activate` | 登录 | `plugin:activate` | 启用插件 | `app/api/console/plugins/[slug]/activate/route.ts` |
| POST | `/api/console/plugins/{slug}/deactivate` | 登录 | `plugin:deactivate` | 停用插件 | `app/api/console/plugins/[slug]/deactivate/route.ts` |
| PUT | `/api/console/plugins/{slug}/config` | 登录 | `plugin:config` | 保存插件配置 | `app/api/console/plugins/[slug]/config/route.ts` |
| GET | `/api/console/roles` | 登录 | `role:list` | 角色列表 | `app/api/console/roles/route.ts` |
| POST | `/api/console/roles` | 登录 | `role:create` | 创建角色 | `app/api/console/roles/route.ts` |
| PUT | `/api/console/roles/{id}` | 登录 | `role:update` | 更新角色 | `app/api/console/roles/[id]/route.ts` |
| DELETE | `/api/console/roles/{id}` | 登录 | `role:delete` | 删除角色 | `app/api/console/roles/[id]/route.ts` |
| GET | `/api/console/settings` | 登录 | - | 读取站点设置 | `app/api/console/settings/route.ts` |
| PUT | `/api/console/settings` | 登录 | `site:config` | 保存站点设置 | `app/api/console/settings/route.ts` |
| POST | `/api/console/settings/test-smtp` | 登录 | `site:config` | 测试 SMTP | `app/api/console/settings/test-smtp/route.ts` |
| GET | `/api/console/stats` | 登录 | - | 概览统计 | `app/api/console/stats/route.ts` |
| GET | `/api/console/stats/detailed` | 登录 | - | 详细统计 | `app/api/console/stats/detailed/route.ts` |
| GET | `/api/console/themes` | 登录 | - | 主题列表 | `app/api/console/themes/route.ts` |
| POST | `/api/console/themes/install` | 登录 | `theme:install` | 上传安装主题 | `app/api/console/themes/install/route.ts` |
| POST | `/api/console/themes/git-install` | 登录 | `theme:install` | Git 安装主题 | `app/api/console/themes/git-install/route.ts` |
| GET | `/api/console/themes/preview` | 登录 | - | 主题预览地址 | `app/api/console/themes/preview/route.ts` |
| DELETE | `/api/console/themes/{slug}` | 登录 | `theme:uninstall` | 卸载主题 | `app/api/console/themes/[slug]/route.ts` |
| POST | `/api/console/themes/{slug}/activate` | 登录 | `theme:activate` | 激活主题 | `app/api/console/themes/[slug]/activate/route.ts` |
| PUT | `/api/console/themes/{slug}/config` | 登录 | `theme:config` | 保存主题配置 | `app/api/console/themes/[slug]/config/route.ts` |
| GET | `/api/console/users` | 登录 | `user:list` | 用户列表 | `app/api/console/users/route.ts` |
| POST | `/api/console/users` | 登录 | `user:create` | 创建用户 | `app/api/console/users/route.ts` |
| PUT | `/api/console/users/{id}` | 登录 | `user:update`（密码/角色另有要求） | 更新用户 | `app/api/console/users/[id]/route.ts` |
| DELETE | `/api/console/users/{id}` | 登录 | `user:delete` | 删除用户 | `app/api/console/users/[id]/route.ts` |
| GET | `/api/console/users/{id}/sessions` | 登录 | `user:list` | 用户登录设备 | `app/api/console/users/[id]/sessions/route.ts` |
| DELETE | `/api/console/users/{id}/sessions` | 登录 | `user:update` | 下线用户设备 | `app/api/console/users/[id]/sessions/route.ts` |
| GET | `/api/profile` | 登录 | - | 我的资料 | `app/api/profile/route.ts` |
| PATCH | `/api/profile` | 登录 | - | 更新资料/密码 | `app/api/profile/route.ts` |
| GET | `/api/profile/sessions` | 登录 | - | 我的登录设备 | `app/api/profile/sessions/route.ts` |
| DELETE | `/api/profile/sessions` | 登录 | - | 下线我的设备 | `app/api/profile/sessions/route.ts` |
| POST | `/api/upload` | 登录 | `photo:upload` | 上传图片 | `app/api/upload/route.ts` |

#### 运维与插件

| Method | Path | 鉴权 | 权限键 | 说明 | 源文件 |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/analytics/online` | 登录 | - | SSE 在线人数 | `app/api/analytics/online/route.ts` |
| POST | `/api/analytics/pv` | 公开 | - | PV 上报 | `app/api/analytics/pv/route.ts` |
| GET | `/api/cron/analytics` | `CRON_SECRET`（可选） | - | 统计聚合 | `app/api/cron/analytics/route.ts` |
| GET | `/api/cron/publish` | `CRON_SECRET`（可选） | - | 定时发布 | `app/api/cron/publish/route.ts` |
| GET | `/api/plugin/{slug}/{path...}` | 插件定义 `auth` | - | 插件自定义 API | `app/api/plugin/[...path]/route.ts` |
| POST | `/api/plugin/{slug}/{path...}` | 插件定义 `auth` | - | 插件自定义 API | `app/api/plugin/[...path]/route.ts` |
| PUT | `/api/plugin/{slug}/{path...}` | 插件定义 `auth` | - | 插件自定义 API | `app/api/plugin/[...path]/route.ts` |
| DELETE | `/api/plugin/{slug}/{path...}` | 插件定义 `auth` | - | 插件自定义 API | `app/api/plugin/[...path]/route.ts` |
| GET | `/api/plugin/editor-actions` | 登录 | - | 插件编辑器动作 | `app/api/plugin/editor-actions/route.ts` |

### 9.2 已知限制与注意事项

1. **`console:access` 权限键未定义**：`/api/console/attachments`、`/api/console/plugin-nav`、`/api/console/plugin-widgets` 检查该键，但 `prisma/seed.ts` 未写入，导致除超级管理员外的角色一律 `403`。
2. ~~**用户接口泄露密码哈希**~~（已修复）：`GET /api/console/users`、`POST /api/console/users`、`PUT /api/console/users/{id}` 已改用白名单 `select`，响应只含 `id`、`username`、`displayName`、`email`、`avatar`、`status`、`createdAt`、`updatedAt`、`lastLoginAt` 与 `roles` 摘要，不再返回 `passwordHash`、`token`、`extra`。
3. ~~**设置接口泄露密钥**~~（已修复）：`GET /api/console/settings` 仍只要求登录，但 `smtpPass`、`ldapBindPassword`、`oauthGithubSecret`、`oauthGoogleSecret`、`oauthWechatSecret` 已脱敏为空串，仅返回 `hasXxx` 表示是否已配置；`PUT` 传空串或 `null` 保留原值。
4. **未发布内容可被读取**：`GET /api/pages/{id}`、`GET /api/gallery/{id}` 不校验 `status`，知道主键即可读取草稿/隐藏内容。
5. **无 CSRF 与同源校验**：所有自有 API 均未实现 CSRF Token 与 Origin/Referer 校验，安全边界完全依赖 Cookie 的 `SameSite=Lax`。
6. **无限流**：除验证码 60 秒发送间隔外，登录、评论、上传、PV 上报均无速率限制。
7. **middleware 不覆盖 API**：`middleware.ts` matcher 仅为 `/console/:path*`，`/api/**` 的鉴权全部由路由自身完成。
8. **注册不校验开关与验证码**：`POST /api/auth/register` 不读取 `SiteSetting.allowRegister`，也不要求邮箱验证码。
9. **无独立登出接口**：仓库中不存在 `POST /api/auth/logout`；登出走 NextAuth 的 `/api/auth/signout`。
10. **OAuth 不自动建号**：仅允许已存在的本地账号；没有 WeChat `Identity` 绑定接口，也没有 OAuth 注册引导流程。
11. **会话吊销不使 JWT 失效**：重置密码或下线设备只删除 `Session` 记录，已签发的 JWT 仍可使用至 30 天过期。
12. **删除用户可能 500**：`User` 与 `Post`、`Comment` 等的外键未全部声明级联删除，删除有内容的用户会触发未捕获的数据库错误。
13. **评论删除仅两级**：`DELETE /api/comments/{id}` 只删除直接回复，多级回复可能成为孤儿记录。
14. **菜单环路未拦截**：`PUT /api/menu/{id}` 仅阻止 `parentId === id`，未检测把菜单挂到自身子孙下。
15. **Cron 默认无鉴权**：未设置 `CRON_SECRET` 时，`/api/cron/*` 对任何调用者开放。
16. **插件网关覆盖有限**：仅 8 个路由（10 个方法）执行 `apiMiddleware`，其余接口不会被插件拦截。
17. **插件 API 不支持 PATCH**：`/api/plugin/[...path]` 只导出 `GET/POST/PUT/DELETE`。
18. **LDAP 依赖可选包**：未安装 `ldapjs` 时 LDAP 登录失败，错误只体现在服务端日志/登录失败结果中。
19. **部分后台接口只要求登录**：`/api/console/settings`（GET）、`/api/console/cache`、`/api/console/stats`、`/api/console/stats/detailed`、`/api/console/plugins`（GET）、`/api/console/themes`（GET）、`/api/console/themes/preview`、`/api/console/plugin/editor-actions` 未校验对应权限键（如 `analytics:view`、`theme:preview`、`plugin:list`）。
20. **备份权限写死**：备份相关接口不使用 `backup:create` / `backup:restore` 权限键，而是要求 `permissions` 包含 `*`。
21. **文章列表返回全文**：`GET /api/posts` 的列表项包含完整 `content` 与 `html`，大文章列表响应体积较大。
22. **用户列表无分页**：`GET /api/console/users` 一次性返回全部用户。
23. **NextAuth 错误格式不同**：`/api/auth/*` 的错误由 NextAuth 生成（重定向或 `{"url": ...}`），不遵循 `{"error": ...}` 约定。

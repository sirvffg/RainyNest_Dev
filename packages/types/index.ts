// packages/types/index.ts — RainyNest 插件 SPI 类型（@rainynest/plugin-types）
// 本文件是扩展开发的唯一类型来源，随 packages/ 独立分发，不依赖主项目路径别名
// 宿主注入的客户端用结构化类型描述（避免与宿主 Prisma 生成类型的双份实例冲突）；
// 插件内如需精确模型类型，可自行安装 @prisma/client 并用泛型断言
import type { ComponentType, ReactNode } from 'react';

// ═══════════════ 宿主注入的结构化类型 ═══════════════

// Prisma 客户端（主库/访问库共用）：模型名按属性访问，返回 any
export interface HostPrismaClient {
  [model: string]: any;
  $queryRaw(...args: unknown[]): Promise<unknown>;
  $executeRaw(...args: unknown[]): Promise<number>;
  $disconnect(): Promise<void>;
}

// 站点设置（结构化，字段以主库 SiteSetting 为准）
export interface HostSiteSetting {
  [key: string]: any;
  id: string;
  title: string;
  description: string;
  keywords: string;
}

// 插件独立 SQLite 库
export interface PluginDbStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface PluginDatabase {
  prepare(sql: string): PluginDbStatement;
  exec(sql: string): unknown;
  pragma(source: string, options?: unknown): unknown;
}

// 插件 JSON 配置存储（db/plugins-json/<slug>.config.json，轻量数据替代 SQLite）
export interface PluginJsonStore {
  /** 读取整个配置；文件不存在或解析失败时返回 {} */
  get(): Promise<Record<string, any>>;
  /** 合并写入（浅合并 patch），返回合并后的完整配置 */
  set(patch: Record<string, any>): Promise<Record<string, any>>;
  /** 整体覆盖写入 */
  replace(data: Record<string, any>): Promise<void>;
}

// ═══════════════ 插件上下文 ═══════════════

export interface PluginLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface PluginContext {
  db: HostPrismaClient;                   // 主库
  analytics: HostPrismaClient;            // 访问库
  pluginDb: PluginDatabase;               // 插件独立 SQLite 库
  pluginJson: PluginJsonStore;            // 插件 JSON 配置存储（轻量数据）
  slug: string;
  version: string;
  config: Record<string, any>;
  site: HostSiteSetting;
  env: Record<string, string | undefined>;
  logger: PluginLogger;
  emitEvent: (name: string, data: unknown) => void;
}

// ═══════════════ 服务端扩展点 ═══════════════

export interface BeforeSavePostMeta {
  patch?: Record<string, any>;
}

export interface MetadataPatchInput {
  metadata: Record<string, any>;
  post: Record<string, any> | null;
}

export interface CustomApiRouteDef {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  handler: (req: Request) => Promise<Response>;
  auth: boolean;
}

export interface SearchProvider {
  name: string;
  builtIn?: boolean;
  search: (query: string, options?: { limit?: number; offset?: number }) => Promise<SearchResult[]>;
}

export interface SearchResult {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  snippet: string;
  score: number;
}

// ═══════════════ 主题端 / 后台 UI 扩展点 ═══════════════

export interface SidebarWidgetDef {
  title?: string;
  component: ComponentType | (() => Promise<{ default: ComponentType }>);
  order?: number;
}

export interface DashboardWidgetDef {
  title: string;
  icon?: string;
  component: ComponentType | (() => Promise<{ default: ComponentType }>);
  permissions?: string[];
  colSpan?: number;
}

export interface ListItemOperationDef {
  label: string;
  icon?: string;
  variant?: 'default' | 'ghost' | 'outline';
  // 降级为链接型：作为 href 模板使用，支持 {id} {slug} 占位符
  onClick?: string;
  permissions?: string[];
}

export interface AdminRouteDef {
  path: string;
  title: string;
  icon?: string;
  group?: string;
  hideSidebar?: boolean;
  component: () => Promise<{ default: ComponentType }>;
}

export interface FrontendRouteDef {
  path: string;
  title: string;
  component: () => Promise<{ default: ComponentType }>;
  ssr?: boolean;
}

// ── API 过滤器：所有 /api 请求前置中间件（对应 Halo AdditionalWebFilter）──
export interface ApiMiddlewareDef {
  /** 匹配的路径前缀，如 /api/posts；留空表示全部 API */
  path?: string;
  /** 限定方法；缺省为全部 */
  methods?: ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE')[];
  /** 返回 Response 表示拦截；返回 void / next() 继续 */
  handler: (req: Request, next: () => Promise<Response>) => Response | void | Promise<Response | void>;
}

// ── 附件存储：可替换默认本地磁盘存储（七牛 / OSS / S3 等）──
export interface AttachmentUploadInput {
  filename: string;
  mimeType: string;
  size: number;
  buffer: Uint8Array;
}

export interface AttachmentStorageResult {
  url: string;
  id?: string;
  name?: string;
  size?: number;
  meta?: Record<string, unknown>;
}

export interface AttachmentStorageProvider {
  name: string;
  upload: (input: AttachmentUploadInput) => Promise<AttachmentStorageResult>;
  delete?: (urlOrId: string) => Promise<boolean>;
}

// ── 通知器：替换/增强默认邮件发送 ──
export interface PluginNotification {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  /** 业务场景：comment-approve / comment-pending / email-code / password-reset / test */
  scene?: string;
}

export interface PluginNotifier {
  name: string;
  send: (message: PluginNotification) => Promise<{ ok: boolean; error?: string; messageId?: string }>;
}

// ── 主题端：顶栏按钮 / 独立页面底部 / 评论表单字段 ──
export interface HeaderActionDef {
  key: string;
  label: string;
  icon?: string;
  href?: string;
  order?: number;
  permissions?: string[];
}

export type CommentFieldType = 'text' | 'textarea' | 'email' | 'url' | 'number' | 'select';

export interface CommentFieldDef {
  key: string;
  label: string;
  type?: CommentFieldType;
  required?: boolean;
  placeholder?: string;
  options?: { label: string; value: string }[];
  defaultValue?: string;
}

// ── 后台：快捷操作 / 列表字段 / Tab / 编辑器 ──
export interface QuickActionDef {
  label: string;
  icon?: string;
  href: string;
  permissions?: string[];
}

export interface ListItemFieldDef {
  key: string;
  label: string;
  width?: number;
  sortable?: boolean;
  /** 返回单元格纯文本；null 表示该行不显示 */
  render: (item: Record<string, any>) => string | number | null | Promise<string | number | null>;
}

export interface TabDef {
  key: string;
  label: string;
  icon?: string;
  permissions?: string[];
  component: ComponentType | (() => Promise<{ default: ComponentType }>);
}

export interface EditorActionDef {
  key: string;
  label: string;
  icon?: string;
  /** 插入的文本模板，支持 {selection} 占位当前选中内容 */
  insert?: string;
  /** 包裹选中内容的前后缀，如 ['**', '**'] */
  wrap?: [string, string];
  shortcut?: string;
  permissions?: string[];
}

export interface CommentSubjectRefDef {
  key: string;
  label: string;
  href: (item: Record<string, any>) => string;
  icon?: string;
}

// ═══════════════ 扩展点汇总 ═══════════════

export interface ExtensionHandlers {
  // 服务端
  onMount?: (ctx: PluginContext) => void | Promise<void>;
  beforeSavePost?: (post: Record<string, any>, meta: BeforeSavePostMeta) => void | Promise<void>;
  // 评论审核扩展点：返回新状态（PENDING/APPROVED/REJECTED）或 void（用默认状态）
  beforeCommentApprove?: (comment: {
    postId: string;
    userId: string;
    content: string;
    parentId?: string | null;
    ip?: string;
    userAgent?: string;
  }) => 'PENDING' | 'APPROVED' | 'REJECTED' | void | Promise<'PENDING' | 'APPROVED' | 'REJECTED' | void>;
  afterSavePost?: (post: Record<string, any>) => void | Promise<void>;
  beforeDeletePost?: (postId: string) => void | Promise<void>;
  onGenerateMetadata?: (input: MetadataPatchInput) => Record<string, unknown> | Promise<Record<string, unknown>>;
  onRenderMarkdown?: (content: string) => string | Promise<string>;
  excerptGenerator?: (content: string, length: number) => string | Promise<string>;
  injectHead?: () => (string | ReactNode)[] | Promise<(string | ReactNode)[]>;
  injectFooter?: () => (string | ReactNode)[] | Promise<(string | ReactNode)[]>;
  onPageView?: (data: { path: string; ip: string; sessionId?: string }) => void | Promise<void>;
  searchProvider?: SearchProvider;
  apiMiddleware?: ApiMiddlewareDef[];
  attachmentStorage?: AttachmentStorageProvider;
  notifier?: PluginNotifier;

  // 主题端
  /** 声明插件自带、可被主题覆盖的模板名（对应 templates/<name>.tsx） */
  providesTemplates?: string[];
  injectSidebarWidget?: () => SidebarWidgetDef[];
  injectHeaderAction?: () => HeaderActionDef[];
  injectPostContent?: () => ComponentType[];
  injectSinglePageContent?: () => ComponentType[];
  injectCommentWidget?: () => ComponentType | null;
  injectCommentField?: () => CommentFieldDef[];

  // 后台 Console UI
  dashboardWidget?: DashboardWidgetDef[];
  dashboardQuickAction?: QuickActionDef[];
  postListItemOperation?: ListItemOperationDef[];
  pageListItemOperation?: ListItemOperationDef[];
  commentListItemOperation?: ListItemOperationDef[];
  replyListItemOperation?: ListItemOperationDef[];
  pluginListItemOperation?: ListItemOperationDef[];
  themeListItemOperation?: ListItemOperationDef[];
  attachmentListItemOperation?: ListItemOperationDef[];
  backupListItemOperation?: ListItemOperationDef[];
  postListItemField?: ListItemFieldDef[];
  pageListItemField?: ListItemFieldDef[];
  pluginListItemField?: ListItemFieldDef[];
  pluginDetailTab?: TabDef[];
  themeListTab?: TabDef[];
  attachmentSelectorTab?: TabDef[];
  pluginInstallTab?: TabDef[];
  backupTab?: TabDef[];
  userDetailTab?: TabDef[];
  editorCreate?: () => EditorActionDef[];
  commentEditorReplace?: () => ComponentType | null;
  commentListItemContentReplace?: () => ComponentType | null;
  commentSubjectRef?: () => CommentSubjectRefDef[];
  customAdminRoutes?: AdminRouteDef[];
  customFrontendRoutes?: FrontendRouteDef[];

  // 自定义 REST API
  customApi?: CustomApiRouteDef[];
}

export interface LoadedPlugin {
  slug: string;
  meta: PluginMeta;
  handlers: ExtensionHandlers;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface PluginMeta {
  slug: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  entry?: string;
  permissions?: { name: string; displayName: string; group: string }[];
  roleTemplates?: {
    name: string;
    displayName: string;
    description?: string;
    dependsOn?: string[];
    permissions: string[];
  }[];
  database?: {
    enabled?: boolean;
    migrations?: { version: string; description?: string; file: string }[];
  };
  configSchema?: Record<string, unknown>;
  /** 清单（manifest）格式版本，当前固定 "1.0"；与插件 SPI / 类型包版本无关 */
  specVersion?: string;
  /** 要求的最低核心版本 */
  requiresCore?: string;
  /** 是否为原生（内置）插件 */
  native?: boolean;
}

// ═══════════════ 主题模板契约（v0.3.2 起独立模块） ═══════════════
//
// 完整模板名、Props 映射见 ./theme.ts（ThemeTemplateMap）。
// 已安装主题由宿主构建期注册表编译，支持 `@/` 别名与 `'use client'`。
export type * from './theme';

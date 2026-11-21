import type { ComponentType, ReactNode } from 'react';
export interface HostPrismaClient {
    [model: string]: any;
    $queryRaw(...args: unknown[]): Promise<unknown>;
    $executeRaw(...args: unknown[]): Promise<number>;
    $disconnect(): Promise<void>;
}
export interface HostSiteSetting {
    [key: string]: any;
    id: string;
    title: string;
    description: string;
    keywords: string;
}
export interface PluginDbStatement {
    run(...params: unknown[]): {
        changes: number;
        lastInsertRowid: number | bigint;
    };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
}
export interface PluginDatabase {
    prepare(sql: string): PluginDbStatement;
    exec(sql: string): unknown;
    pragma(source: string, options?: unknown): unknown;
}
export interface PluginJsonStore {
    /** 读取整个配置；文件不存在或解析失败时返回 {} */
    get(): Promise<Record<string, any>>;
    /** 合并写入（浅合并 patch），返回合并后的完整配置 */
    set(patch: Record<string, any>): Promise<Record<string, any>>;
    /** 整体覆盖写入 */
    replace(data: Record<string, any>): Promise<void>;
}
export interface PluginLogger {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
}
/** 宿主事件总线订阅接口；事件名用命名空间风格，如 'post.created'，插件自身事件建议加 <slug>. 前缀 */
export interface PluginEventBus {
    /** 订阅事件；返回取消订阅函数 */
    on: (name: string, handler: (data: unknown) => void) => () => void;
    /** 一次性订阅：触发一次后自动移除 */
    once: (name: string, handler: (data: unknown) => void) => () => void;
    /** 取消订阅；省略 handler 时移除本插件对该事件的全部监听 */
    off: (name: string, handler?: (data: unknown) => void) => void;
}
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
    /** 订阅宿主/其他插件事件（0.3.3 起支持）；插件卸载/重载时监听器自动清理 */
    events: PluginEventBus;
}
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
    search: (query: string, options?: {
        limit?: number;
        offset?: number;
    }) => Promise<SearchResult[]>;
}
export interface SearchResult {
    id: string;
    title: string;
    slug: string;
    summary: string | null;
    snippet: string;
    score: number;
}
export interface SidebarWidgetDef {
    title?: string;
    component: ComponentType | (() => Promise<{
        default: ComponentType;
    }>);
    order?: number;
}
export interface DashboardWidgetDef {
    title: string;
    icon?: string;
    component: ComponentType | (() => Promise<{
        default: ComponentType;
    }>);
    permissions?: string[];
    colSpan?: number;
}
export interface ListItemOperationDef {
    label: string;
    icon?: string;
    variant?: 'default' | 'ghost' | 'outline';
    onClick?: string;
    permissions?: string[];
}
export interface AdminRouteDef {
    path: string;
    title: string;
    icon?: string;
    group?: string;
    hideSidebar?: boolean;
    component: () => Promise<{
        default: ComponentType;
    }>;
}
export interface FrontendRouteDef {
    path: string;
    title: string;
    component: () => Promise<{
        default: ComponentType;
    }>;
    ssr?: boolean;
}
export interface ApiMiddlewareDef {
    /** 匹配的路径前缀，如 /api/posts；留空表示全部 API */
    path?: string;
    /** 限定方法；缺省为全部 */
    methods?: ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE')[];
    /** 返回 Response 表示拦截；返回 void / next() 继续（next() 只能调用一次） */
    handler: (req: Request, next: () => Promise<Response>) => Response | void | Promise<Response | void>;
    /**
     * 安全策略标记（0.3.3 起支持）：critical 中间件自身抛错/超时/重复调用 next() 时
     * 宿主返回 503 拒绝请求（默认拒绝）；普通中间件失败仅记录日志并放行
     */
    critical?: boolean;
    /** 单个中间件超时毫秒数（0.3.3 起支持）；缺省 10000 */
    timeout?: number;
}
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
    send: (message: PluginNotification) => Promise<{
        ok: boolean;
        error?: string;
        messageId?: string;
    }>;
}
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
    options?: {
        label: string;
        value: string;
    }[];
    defaultValue?: string;
}
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
    component: ComponentType | (() => Promise<{
        default: ComponentType;
    }>);
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
export interface ExtensionHandlers {
    onMount?: (ctx: PluginContext) => void | Promise<void>;
    beforeSavePost?: (post: Record<string, any>, meta: BeforeSavePostMeta) => void | Promise<void>;
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
    onPageView?: (data: {
        path: string;
        ip: string;
        sessionId?: string;
    }) => void | Promise<void>;
    searchProvider?: SearchProvider;
    apiMiddleware?: ApiMiddlewareDef[];
    attachmentStorage?: AttachmentStorageProvider;
    notifier?: PluginNotifier;
    /** 声明插件自带、可被主题覆盖的模板名（对应 templates/<name>.tsx） */
    providesTemplates?: string[];
    injectSidebarWidget?: () => SidebarWidgetDef[];
    injectHeaderAction?: () => HeaderActionDef[];
    injectPostContent?: () => ComponentType[];
    injectSinglePageContent?: () => ComponentType[];
    injectCommentWidget?: () => ComponentType | null;
    injectCommentField?: () => CommentFieldDef[];
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
    permissions?: {
        name: string;
        displayName: string;
        group: string;
    }[];
    roleTemplates?: {
        name: string;
        displayName: string;
        description?: string;
        dependsOn?: string[];
        permissions: string[];
    }[];
    database?: {
        enabled?: boolean;
        migrations?: {
            version: string;
            description?: string;
            file: string;
        }[];
    };
    configSchema?: Record<string, unknown>;
    /** 清单（manifest）格式版本，当前固定 "1.0"；与插件 SPI / 类型包版本无关 */
    specVersion?: string;
    /** 要求的最低核心版本 */
    requiresCore?: string;
    /** 是否为原生（内置）插件 */
    native?: boolean;
}
export type * from './theme';

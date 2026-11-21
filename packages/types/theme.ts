// packages/types/theme.ts — RainyNest 主题模板类型契约
// 与宿主 lib/theme/templates.ts 保持同步；主题模板可按模板名实现对应 Props。
// 混合编译模式下，构建期注册表内的模板支持 `@/` 别名与 `'use client'`。
import type { ComponentType, ReactNode } from 'react';

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

export interface TemplateMenuItem {
  name: string;
  url: string;
}

export interface TemplateMoment {
  id: string;
  content: string;
  images: string[];
  createdAt: Date;
  user: { displayName: string; avatar: string | null };
}

/** 整体壳：负责 Header/Sidebar/Footer 的摆放，children 是页面内容 */
export interface LayoutTemplateProps {
  site: TemplateSite;
  menus: TemplateMenuItem[];
  header: ReactNode;
  sidebar: ReactNode;
  footer: ReactNode;
  footerNodes: ReactNode;
  children: ReactNode;
}

export interface HomeTemplateProps {
  site: TemplateSite;
  posts: TemplatePost[];
  total: number;
  slots: { posts: ReactNode };
}

export interface PostListTemplateProps {
  posts: TemplatePost[];
  total: number;
  page: number;
  totalPages: number;
  slots: { list: ReactNode; pagination: ReactNode };
}

export interface PostDetailTemplateProps {
  post: {
    slug: string;
    title: string;
    /** 作者展示名 */
    author: string;
    /** 发布时间（无则用创建时间） */
    date: Date;
    /** 浏览量 */
    views: number;
    category: { name: string; slug: string } | null;
    tags: { name: string; slug: string }[];
    coverImage: string | null;
    allowComment: boolean;
  };
  html: string;
  commentsCount: number;
  slots: {
    tocMobile: ReactNode;
    tocDesktop: ReactNode;
    comments: ReactNode;
    contentBlocks: ReactNode;
  };
}

export interface PageTemplateProps {
  page: {
    title: string;
    summary: string | null;
    html: string;
    sidebarHtml: string | null;
    showSidebar: boolean;
  };
  slots: { contentBlocks: ReactNode };
}

export interface ArchiveTemplateProps {
  total: number;
  years: { year: number; posts: { id: string; title: string; slug: string; date: Date }[] }[];
}

export interface CategoriesTemplateProps {
  categories: { id: string; name: string; slug: string; description: string | null; count: number }[];
}

export interface CategoryTemplateProps {
  category: { name: string; slug: string; description: string | null };
  posts: TemplatePost[];
  slots: { list: ReactNode };
}

export interface TagsTemplateProps {
  tags: { id: string; name: string; slug: string; count: number }[];
}

export interface TagTemplateProps {
  tag: { name: string; slug: string } | null;
  posts: TemplatePost[];
  slots: { list: ReactNode };
}

export interface SearchTemplateProps {
  query: string;
  results: { id: string; title: string; slug: string; summary: string | null; snippet: string }[];
  slots: { form: ReactNode };
}

export interface MomentsTemplateProps {
  moments: TemplateMoment[];
  slots: { list: ReactNode };
}

export interface MomentTemplateProps {
  moment: TemplateMoment;
  prev: { id: string; content: string } | null;
  next: { id: string; content: string } | null;
  slots: { lightbox: ReactNode };
}

export interface LinksTemplateProps {
  links: { id: string; name: string; url: string; logo: string | null; description: string | null }[];
  slots: { list: ReactNode };
}

export interface GalleryTemplateProps {
  galleries: {
    id: string;
    title: string;
    slug: string;
    description: string | null;
    coverImage: string | null;
    count: number;
  }[];
  slots: { list: ReactNode };
}

export interface PhotoTemplateProps {
  gallery: { title: string; description: string | null };
  photos: { url: string; title: string | null; width: number | null; height: number | null }[];
  slots: { grid: ReactNode };
}

export interface ErrorTemplateProps {
  status: number;
  title: string;
  message: string;
}

/** 模板名 → Props 映射，主题作者可据此实现对应模板 */
export interface ThemeTemplateMap {
  layout: LayoutTemplateProps;
  home: HomeTemplateProps;
  'post-list': PostListTemplateProps;
  post: PostDetailTemplateProps;
  'post-detail': PostDetailTemplateProps;
  page: PageTemplateProps;
  archive: ArchiveTemplateProps;
  categories: CategoriesTemplateProps;
  category: CategoryTemplateProps;
  tags: TagsTemplateProps;
  tag: TagTemplateProps;
  search: SearchTemplateProps;
  moments: MomentsTemplateProps;
  moment: MomentTemplateProps;
  links: LinksTemplateProps;
  gallery: GalleryTemplateProps;
  photo: PhotoTemplateProps;
  error: ErrorTemplateProps;
}

export type ThemeTemplateName = keyof ThemeTemplateMap;

/** 旧名兼容：文章详情模板组件 */
export type PostDetailTemplate = ComponentType<PostDetailTemplateProps>;
/** 旧名兼容：系统模板名 */
export type SystemTemplateName = ThemeTemplateName;
/** 旧名兼容：文章详情模板中的文章数据 */
export type SystemTemplatePost = PostDetailTemplateProps['post'];

/** 单个主题模板组件类型 */
export type ThemeTemplateComponent<Name extends ThemeTemplateName> = ComponentType<ThemeTemplateMap[Name]>;

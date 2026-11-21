// vendor/themes/default/theme.ts — 配置值 → CSS 变量映射
export interface ThemeConfig {
  basic: {
    primaryColor: string;
    bgMode: 'light' | 'dark' | 'auto';
    radiusStyle: 'sharp' | 'rounded' | 'pill';
    fontFamily: string;
  };
  layout: {
    sidebarPosition: 'left' | 'right' | 'none';
    postListStyle: 'card' | 'list' | 'masonry';
    pageSize: number;
    showToc: boolean;
  };
  header: {
    showSearch: boolean;
    showAvatar: boolean;
    logoUrl?: string;
  };
  advanced: {
    customCss?: string;
    customJs?: string;
  };
}

const radiusMap: Record<string, { sm: string; md: string; lg: string }> = {
  sharp: { sm: '0px', md: '0px', lg: '0px' },
  rounded: { sm: '4px', md: '8px', lg: '12px' },
  pill: { sm: '12px', md: '20px', lg: '28px' },
};

// 颜色调色板（根据 primaryColor 生成 hover 衍生色）
function shadeHex(hex: string, amount: number): string {
  const m = hex.replace('#', '');
  if (m.length !== 6) return hex;
  const num = parseInt(m, 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp((num >> 16) + amount);
  const g = clamp(((num >> 8) & 0xff) + amount);
  const b = clamp((num & 0xff) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function getFontStack(key: string): string {
  const fonts: Record<string, string> = {
    inter: "'Inter', system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif",
    'noto-sc': "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    serif: "'Source Serif 4', Georgia, 'Songti SC', 'SimSun', serif",
    mono: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
  };
  return fonts[key] || fonts.inter;
}

// ⭐ 核心函数：配置值 → CSS 变量
export function configToCssVariables(config: ThemeConfig): Record<string, string> {
  const radius = radiusMap[config.basic.radiusStyle] || radiusMap.rounded;
  const primary = config.basic.primaryColor || '#3b82f6';

  const vars: Record<string, string> = {
    '--color-primary': primary,
    '--color-primary-hover': shadeHex(primary, -32),
    '--radius-sm': radius.sm,
    '--radius-md': radius.md,
    '--radius-lg': radius.lg,
    '--font-sans': getFontStack(config.basic.fontFamily),
    '--sidebar-position': config.layout.sidebarPosition,
  };

  // 深色模式变量
  if (config.basic.bgMode === 'dark') {
    vars['--color-bg'] = '#0f172a';
    vars['--color-bg-secondary'] = '#1e293b';
    vars['--color-fg'] = '#f1f5f9';
    vars['--color-fg-muted'] = '#94a3b8';
    vars['--color-border'] = '#334155';
  } else {
    vars['--color-bg'] = '#ffffff';
    vars['--color-bg-secondary'] = '#f8fafc';
    vars['--color-fg'] = '#0f172a';
    vars['--color-fg-muted'] = '#64748b';
    vars['--color-border'] = '#e2e8f0';
  }

  return vars;
}

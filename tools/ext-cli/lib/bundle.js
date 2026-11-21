// tools/ext-cli/lib/bundle.js — esbuild 编译：插件 index.ts/admin.tsx、主题 theme.ts
// bundle: true → 依赖全打进产物（自包含）；react/next/@prisma/client 由宿主提供
const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

// 宿主提供的运行时模块，禁止打进包里
const EXTERNALS = ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'next', 'next/*', '@prisma/client', '@rainynest/plugin-types', 'better-sqlite3'];

const BASE = {
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  bundle: true,
  // 统一 automatic：index.ts 动态 import('./admin.js') 会按 TS 规则解析到 admin.tsx，
  // classic JSX 在无 React 导入的产物里运行时会报 React is not defined
  jsx: 'automatic',
  minify: process.env.EXT_MINIFY === '1',
  sourcemap: false,
  logLevel: 'silent',
};

const STATIC_FILES = [
  'plugin.json', 'config.json', 'theme.json', 'theme.css', 'preview.png', 'preview.jpg',
  'README.md', 'LICENSE',
];

// 编译单个扩展源码目录 → 安装态产物目录（index.js 与 admin.js 同目录，import('./admin.js') 才能解析）
function buildOne(srcDir, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const built = [];

  const compile = (entry, outfile) => {
    if (!fs.existsSync(entry)) return;
    esbuild.buildSync({
      entryPoints: [entry],
      outfile,
      external: EXTERNALS,
      ...BASE,
    });
    built.push(path.basename(outfile));
  };

  const pick = (name) => {
    // 兼容根目录与 src/ 两种源码布局
    for (const p of [path.join(srcDir, name), path.join(srcDir, 'src', name)]) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  };

  // 插件入口
  const entry = pick('index.ts') || pick('index.js');
  if (entry) {
    compile(entry, path.join(outDir, 'index.js'));
    if (!fs.existsSync(path.join(outDir, 'index.js'))) {
      fs.copyFileSync(entry, path.join(outDir, 'index.js'));
      built.push('index.js');
    }
  }

  // 后台页面
  const admin = pick('admin.tsx');
  if (admin) compile(admin, path.join(outDir, 'admin.js'));

  // 主题配置映射
  const theme = pick('theme.ts');
  if (theme) compile(theme, path.join(outDir, 'theme.js'));

  // 静态资源原样复制
  for (const name of STATIC_FILES) {
    const src = path.join(srcDir, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, name));
  }
  copyDir(path.join(srcDir, 'assets'), path.join(outDir, 'assets'));
  copyDir(path.join(srcDir, 'migrations'), path.join(outDir, 'migrations'));
  copyDir(path.join(srcDir, 'templates'), path.join(outDir, 'templates'));

  return built;
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    const s = path.join(src, item);
    if (fs.statSync(s).isDirectory()) copyDir(s, path.join(dest, item));
    else fs.copyFileSync(s, path.join(dest, item));
  }
}

module.exports = { buildOne, EXTERNALS };

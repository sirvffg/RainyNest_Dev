// tools/ext-cli/lib/pack.js — 打包为发布产物
// 命名规则：{slug}.zip.rainy-plugin / {slug}.gz.rainy-theme（格式标记在类型后缀之前）
const AdmZip = require('adm-zip');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const KIND_EXT = { plugin: 'rainy-plugin', theme: 'rainy-theme' };

// 与主项目 dev-install 白名单一致：发布包只装产物，不装源码
const ALLOWED = new Set(['.js', '.tsx', '.json', '.css', '.png', '.jpg', '.jpeg', '.svg', '.webp', '.sql', '.md', '.txt', '.woff', '.woff2', '.ttf']);
const SKIP_DIRS = new Set(['src', 'node_modules', 'dist']);

function collectFiles(dir, base = dir) {
  const out = [];
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    if (fs.statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(item)) continue;
      out.push(...collectFiles(full, base));
    } else if (ALLOWED.has(path.extname(item).toLowerCase())) {
      out.push(path.relative(base, full));
    }
  }
  return out;
}

// dir: 安装态产物目录；kind: plugin|theme；format: zip|gz；outDir: 产物输出目录
function pack(dir, kind, format, outDir) {
  const slug = require('./validate').validateManifest(dir).manifest?.slug;
  if (!slug) throw new Error('打包失败：清单无效或缺少 slug');

  const name = `${slug}.${format}.${KIND_EXT[kind]}`;
  const outFile = path.join(outDir, name);
  fs.mkdirSync(outDir, { recursive: true });

  if (format === 'zip') {
    const zip = new AdmZip();
    // 包内条目不带顶层目录，解压即清单所在目录
    for (const rel of collectFiles(dir)) {
      zip.addLocalFile(path.join(dir, rel), path.dirname(rel) === '.' ? '' : path.dirname(rel));
    }
    zip.writeZip(outFile);
  } else {
    // gz = tar.gz，用系统 tar（Windows 10+ 自带 bsdtar）；先收集白名单文件避免打包源码
    const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ext-pack-'));
    try {
      for (const rel of collectFiles(dir)) {
        const target = path.join(tmp, rel);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(dir, rel), target);
      }
      execFileSync('tar', ['-czf', outFile, '-C', tmp, '.'], { stdio: 'pipe' });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  return outFile;
}

module.exports = { pack, KIND_EXT };

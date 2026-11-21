// tools/ext-cli/lib/validate.js — 清单校验（specVersion 统一为 manifest 格式版本 1.0）
const fs = require('node:fs');
const path = require('node:path');

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
// specVersion 是清单（manifest）格式版本，与插件 SPI / 类型包版本无关；当前只支持 1.0
const SPEC_VERSION = '1.0';
const SUPPORTED_SPEC_VERSIONS = ['1.0'];

// 校验清单，返回 { kind: 'plugin'|'theme', manifest, errors, warnings }
function validateManifest(dir) {
  const errors = [];
  const warnings = [];

  const pluginPath = path.join(dir, 'plugin.json');
  const themePath = path.join(dir, 'theme.json');
  let kind = null;
  let manifest = null;

  if (fs.existsSync(pluginPath)) {
    kind = 'plugin';
    manifest = readJson(pluginPath, errors);
  } else if (fs.existsSync(themePath)) {
    kind = 'theme';
    manifest = readJson(themePath, errors);
  } else {
    return { kind: null, manifest: null, errors: ['缺少 plugin.json 或 theme.json'], warnings };
  }
  if (!manifest) return { kind, manifest: null, errors, warnings };

  const entryName = kind === 'plugin' ? 'plugin.json' : 'theme.json';

  // 必填字段
  for (const field of ['slug', 'name', 'version']) {
    if (!manifest[field]) errors.push(`${entryName}: 缺少必填字段 ${field}`);
  }
  if (manifest.slug && !SLUG_RE.test(manifest.slug)) {
    errors.push(`${entryName}: slug 只允许小写字母/数字/连字符（${manifest.slug}）`);
  }

  // specVersion
  if (!manifest.specVersion) {
    warnings.push(`${entryName}: 缺少 specVersion，按 ${SPEC_VERSION} 处理`);
    manifest.specVersion = SPEC_VERSION;
  } else if (!SUPPORTED_SPEC_VERSIONS.includes(manifest.specVersion)) {
    errors.push(
      `${entryName}: 不支持的 specVersion ${manifest.specVersion}（宿主支持 ${SUPPORTED_SPEC_VERSIONS.join(' / ')}）`
    );
  }

  // 入口文件存在性（校验源码目录或产物目录都行）
  if (kind === 'plugin') {
    const entry = manifest.entry || 'index.ts';
    const inRoot = (n) => fs.existsSync(path.join(dir, n)) || fs.existsSync(path.join(dir, 'src', n));
    if (!inRoot(entry) && !inRoot(entry.replace(/\.tsx?$/, '.js'))) errors.push(`插件入口不存在: ${entry}`);
  } else {
    const hasThemeJs = fs.existsSync(path.join(dir, 'theme.js')) || fs.existsSync(path.join(dir, 'theme.ts'));
    if (!hasThemeJs && manifest.configSchema && Object.keys(manifest.configSchema).length > 0) {
      warnings.push('theme.js/theme.ts 不存在，配置映射将不生效');
    }
  }

  return { kind, manifest, errors, warnings };
}

// 产物目录安全扫描：禁止原生模块
function scanArtifacts(dir) {
  const errors = [];
  walk(dir, (file) => {
    if (file.endsWith('.node')) errors.push(`产物包含原生模块: ${path.relative(dir, file)}`);
  });
  return errors;
}

function walk(dir, fn) {
  if (!fs.existsSync(dir)) return;
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    if (fs.statSync(full).isDirectory()) walk(full, fn);
    else fn(full);
  }
}

function readJson(file, errors) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    errors.push(`${path.basename(file)} 解析失败: ${err.message}`);
    return null;
  }
}

module.exports = { validateManifest, scanArtifacts, SPEC_VERSION, SUPPORTED_SPEC_VERSIONS, SLUG_RE };

#!/usr/bin/env node
// tools/ext-cli/bin/ext.js — RainyNest 扩展 CLI
// 用法：
//   ext new plugin <name>              生成插件模板工程
//   ext new theme <name>               生成主题模板工程
//   ext build <srcDir> [-o outDir]     编译单个扩展为安装态产物
//   ext build-all --src packages --out scripts   批量编译（内置包迁移用）
//   ext pack <builtDir> [--format zip|gz] [-o dist]   打包发布产物 *.zip.rainy-plugin 等
//   ext dev <srcDir> [--site url]      watch + 热更新上传（管理 token）
const fs = require('node:fs');
const path = require('node:path');

const { buildOne } = require('../lib/bundle');
const { validateManifest, scanArtifacts } = require('../lib/validate');
const { pack } = require('../lib/pack');

function fail(msg) {
  console.error('[ext] ✗ ' + msg);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    } else if (a === '-o') {
      args.out = argv[++i];
    } else {
      args._.push(a);
    }
  }
  return args;
}

// ─── ext new ───
function cmdNew(args) {
  const kind = args._[1]; // plugin | theme
  const name = args._[2];
  if (!['plugin', 'theme'].includes(kind)) fail('用法: ext new plugin|theme <名称>');
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) fail('名称只允许小写字母/数字/连字符');

  const tplDir = path.join(__dirname, '..', 'templates', kind);
  const dest = path.join(process.cwd(), name);
  if (fs.existsSync(dest)) fail(`目录已存在: ${dest}`);

  fs.mkdirSync(dest, { recursive: true });
  copyTpl(tplDir, dest, name);
  console.log(`[ext] ✓ 已生成${kind === 'plugin' ? '插件' : '主题'}模板: ${dest}`);
  console.log('  下一步: 修改清单与 src/ 源码 → ext build ' + name + ' -o dist');
}

function copyTpl(src, dest, name) {
  for (const item of fs.readdirSync(src)) {
    const s = path.join(src, item);
    const d = path.join(dest, item);
    if (fs.statSync(s).isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyTpl(s, d, name); continue; }
    let content = fs.readFileSync(s, 'utf-8').replace(/__SLUG__/g, name);
    fs.writeFileSync(d, content);
  }
}

// ─── ext build ───
function cmdBuild(args) {
  const srcDir = path.resolve(args._[1] || '.');
  const outDir = path.resolve(args.out || path.join(process.cwd(), 'dist'));
  const check = validateManifest(srcDir);
  if (check.errors.length) fail(check.errors.join('; '));
  for (const w of check.warnings) console.warn('[ext] ! ' + w);

  const built = buildOne(srcDir, outDir);
  const artifactErrors = scanArtifacts(outDir);
  if (artifactErrors.length) fail(artifactErrors.join('; '));

  console.log(`[ext] ✓ ${check.kind}「${check.manifest.slug}」→ ${outDir}  [${built.join(', ')}]`);
}

// ─── ext build-all ───
function cmdBuildAll(args) {
  const srcRoot = path.resolve(args.src || 'packages');
  const outRoot = path.resolve(args.out || 'scripts');
  if (!fs.existsSync(srcRoot)) fail(`源码目录不存在: ${srcRoot}`);

  let total = 0;
  for (const kind of ['plugins', 'themes']) {
    const srcDir = path.join(srcRoot, kind);
    if (!fs.existsSync(srcDir)) continue;
    for (const slug of fs.readdirSync(srcDir)) {
      const dir = path.join(srcDir, slug);
      if (!fs.statSync(dir).isDirectory()) continue;
      const check = validateManifest(dir);
      if (check.errors.length) { console.error(`[ext] ✗ ${slug}: ${check.errors.join('; ')}`); continue; }
      const built = buildOne(dir, path.join(outRoot, kind, slug));
      const errs = scanArtifacts(path.join(outRoot, kind, slug));
      if (errs.length) { console.error(`[ext] ✗ ${slug}: ${errs.join('; ')}`); continue; }
      console.log(`[ext] ✓ ${kind}/${slug}  [${built.join(', ') || '静态复制'}]`);
      total++;
    }
  }
  console.log(`[ext] ✓ 共 ${total} 个扩展已编译到 ${outRoot}`);
}

// ─── ext pack ───
function cmdPack(args) {
  const dir = path.resolve(args._[1] || '.');
  const check = validateManifest(dir);
  if (check.errors.length) fail(check.errors.join('; '));
  // 默认格式：插件 zip、主题 gz（用户决策），--format 可覆盖
  const format = args.format ? (args.format === 'gz' ? 'gz' : 'zip') : (check.kind === 'theme' ? 'gz' : 'zip');
  const outDir = path.resolve(args.out || path.join(process.cwd(), 'dist'));
  const file = pack(dir, check.kind, format, outDir);
  console.log(`[ext] ✓ ${path.basename(file)}  (${(fs.statSync(file).size / 1024).toFixed(1)} KB)`);
}

// ─── ext dev ───
async function cmdDev(args) {
  const srcDir = path.resolve(args._[1] || '.');
  const site = args.site || process.env.EXT_SITE || 'http://localhost:3000';
  let token = args.token || process.env.EXT_DEV_TOKEN;
  // 未显式给 token 时，尝试从主项目 .env 读取（向上找两级）
  if (!token) {
    for (const dir of [process.cwd(), path.dirname(process.cwd())]) {
      const envFile = path.join(dir, '.env');
      if (!fs.existsSync(envFile)) continue;
      const m = fs.readFileSync(envFile, 'utf-8').match(/^EXT_DEV_TOKEN\s*=\s*"?([^"\r\n]+)"?/m);
      if (m) { token = m[1].trim(); break; }
    }
  }
  if (!token) fail('缺少管理 token：--token 或环境变量 EXT_DEV_TOKEN（见主项目 .env）');

  const check = validateManifest(srcDir);
  if (check.errors.length) fail(check.errors.join('; '));
  const slug = check.manifest.slug;
  console.log(`[ext] dev 模式: ${slug} → ${site}`);

  let timer = null;
  const upload = async (reason) => {
    const tmp = path.join(process.cwd(), '.ext-dev');
    const check2 = validateManifest(srcDir);
    if (check2.errors.length) { console.error(`[ext] ✗ 编译失败: ${check2.errors.join('; ')}`); return; }
    buildOne(srcDir, tmp);
    const file = pack(tmp, check2.kind, 'zip', tmp);
    try {
      const form = new FormData();
      form.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
      const res = await fetch(`${site}/api/console/extensions/dev-install`, {
        method: 'POST',
        headers: { 'x-ext-token': token },
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) console.log(`[ext] ✓ 已热更新 ${slug}（${reason}）`);
      else console.error(`[ext] ✗ 上传失败 ${res.status}: ${JSON.stringify(body)}`);
    } catch (err) {
      console.error(`[ext] ✗ 无法连接站点: ${err.message}`);
    }
  };

  await upload('首次构建');
  console.log('[ext] 监听源码变更中… Ctrl+C 退出');
  fs.watch(srcDir, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => upload('源码变更'), 500);
  });
  // 保持进程
  setInterval(() => {}, 1 << 30);
}

// ─── main ───
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  try {
    if (cmd === 'new') return cmdNew(args);
    if (cmd === 'build') return cmdBuild(args);
    if (cmd === 'build-all') return cmdBuildAll(args);
    if (cmd === 'pack') return cmdPack(args);
    if (cmd === 'dev') return await cmdDev(args);
    console.log(`RainyNest 扩展 CLI

用法:
  ext new plugin|theme <名称>            生成模板工程
  ext build <srcDir> [-o dist]           编译为安装态产物
  ext build-all --src packages --out scripts   批量编译
  ext pack <builtDir> [--format zip|gz]  打包发布产物
  ext dev <srcDir> [--site url]          watch 热更新`);
  } catch (err) {
    fail(err.message);
  }
}
main();

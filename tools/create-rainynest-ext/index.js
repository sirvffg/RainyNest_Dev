#!/usr/bin/env node
// create-rainynest-ext — RainyNest 扩展脚手架
// 用法：
//   npm create rainynest-ext my-plugin          （生成插件工程）
//   npm create rainynest-ext my-theme --theme   （生成主题工程）
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const themeFlag = args.includes('--theme');
const positional = args.find((a) => !a.startsWith('-'));
const kind = themeFlag ? 'theme' : 'plugin';
const name = positional || (themeFlag ? 'my-theme' : 'my-plugin');

if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error(`[create] 无效名称 "${name}"：只允许小写字母/数字/连字符`);
  process.exit(1);
}

const dest = path.join(process.cwd(), name);
if (fs.existsSync(dest)) {
  console.error(`[create] 目录已存在: ${dest}`);
  process.exit(1);
}

const tplDir = path.join(__dirname, 'templates', kind);

function copyTpl(src, d) {
  fs.mkdirSync(d, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    const s = path.join(src, item);
    const t = path.join(d, item);
    if (fs.statSync(s).isDirectory()) {
      copyTpl(s, t);
      continue;
    }
    const content = fs.readFileSync(s, 'utf-8').replace(/__SLUG__/g, name);
    fs.writeFileSync(t, content);
  }
}

copyTpl(tplDir, dest);

console.log(`[create] ✓ 已生成${kind === 'plugin' ? '插件' : '主题'}工程: ${dest}`);
console.log('  下一步:');
console.log(`    cd ${name}`);
console.log('    npm install');
console.log('    npm run dev   # 联调热更新（需要 RainyNest 站点的 EXT_DEV_TOKEN）');
console.log('    npm run pack  # 产出发布包，到后台「系统 → 插件/主题」上传安装');

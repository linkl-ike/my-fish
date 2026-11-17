#!/usr/bin/env node
/**
 * 生成 format-1 插件市场索引（DSH「插件 → 发现 → 索引源」可直接添加）。
 *
 * 用法（在仓库根目录）：
 *   # GitHub 仓库（git 来源，需要已 git init/commit）
 *   node market/build-index.mjs --owner <GITHUB_OWNER> --repo my-fish
 *
 *   # Gitee 仓库（git 来源；不需要能访问 GitHub）
 *   node market/build-index.mjs --owner <GITEE_OWNER> --repo my-fish --platform gitee
 *
 *   # 已发布 npm 包（npm 来源；不需要 git）
 *   node market/build-index.mjs --owner <OWNER> --repo my-fish --npm
 *
 * 输出：
 *   market/index.json
 *   market/icons/my-fish-180.png（从 assets/icon-180.png 复制）
 *
 * 托管方式：
 *   - GitHub Pages: https://<owner>.github.io/<repo>/market/index.json
 *   - npm + unpkg:  https://unpkg.com/<package>@<version>/market/index.json
 *   - Gitee raw:    https://gitee.com/<owner>/<repo>/raw/main/market/index.json
 */
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const owner = arg('owner');
const repo = arg('repo', 'my-fish');
const platform = arg('platform', 'github'); // github | gitee
const useNpm = args.includes('--npm');
const out = join(root, 'market', 'index.json');
const iconOut = join(root, 'market', 'icons', 'my-fish-180.png');

if (!owner) {
  console.error('缺少 --owner <你的用户名>');
  process.exit(1);
}
if (!['github', 'gitee'].includes(platform)) {
  console.error('--platform 只支持 github / gitee');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const readLocale = (f) => {
  try { return JSON.parse(readFileSync(join(root, 'locale', f), 'utf8')).meta ?? {}; } catch { return {}; }
};
const en = readLocale('en.json');
const zh = readLocale('zh-CN.json');
const description = { en: en.description || pkg.description || '', zh: zh.description || '' };

if (!existsSync(join(root, 'assets', 'icon-180.png'))) {
  console.error('缺少 assets/icon-180.png（市场图标需要位图）');
  process.exit(1);
}
mkdirSync(dirname(iconOut), { recursive: true });
copyFileSync(join(root, 'assets', 'icon-180.png'), iconOut);

let source;
let publishTimestamp;
if (useNpm) {
  source = { type: 'npm' };
  publishTimestamp = Math.floor(Date.now() / 1000);
} else {
  let commit = '';
  try { commit = execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf8' }).trim(); } catch { /* ignore */ }
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    console.error('找不到 git commit：请先在仓库目录 git init && git add -A && git commit，或用 --npm。');
    process.exit(1);
  }
  publishTimestamp = Number(execSync('git log -1 --format=%ct', { cwd: root, encoding: 'utf8' }).trim()) || Math.floor(Date.now() / 1000);
  const host = platform === 'gitee' ? 'https://gitee.com' : 'https://github.com';
  source = { type: 'git', url: `${host}/${owner}/${repo}`, commit };
}

const enginesDsh = String(pkg.engines?.dsh ?? '>=0.2.1');
const homepage = pkg.homepage && !pkg.homepage.includes('OWNER') ? pkg.homepage : `${source.url || `https://github.com/${owner}/${repo}`}`;

const index = {
  format: 1,
  title: { en: 'my fish', zh: 'my fish' },
  description: { en: 'A fish companion plugin for DeepSeek Harness.', zh: 'DSH 的养鱼插件。' },
  metadata: {
    categories: {
      fun: { title: { en: 'Fun', zh: '娱乐' } },
      identity: { title: { en: 'Identity & Communication', zh: '身份与通信' } },
      memory: { title: { en: 'Memory', zh: '记忆' } },
    },
    labels: { companion: { title: { en: 'Companion', zh: '虚拟陪伴' } } },
    sortKeys: { github_stars: { title: { en: 'GitHub stars', zh: 'GitHub star' }, order: 'desc' } },
  },
  plugins: [
    {
      name: pkg.name,
      title: { en: en.title || 'my fish', zh: zh.title || 'my fish' },
      description,
      icon: 'icons/my-fish-180.png',
      author: pkg.author || owner,
      homepage,
      repository: { url: source.type === 'git' ? source.url : `https://github.com/${owner}/${repo}` },
      metadata: { category: 'fun', labels: ['companion'], keywords: pkg.keywords ?? [], sortKeys: { github_stars: null } },
      'dist-tags': { latest: pkg.version },
      versions: [{ version: pkg.version, publishTimestamp, source, engines: { dsh: enginesDsh } }],
    },
  ],
};

writeFileSync(out, JSON.stringify(index, null, 2) + '\n', 'utf8');
console.log('生成：', out);
console.log('图标：', iconOut);
if (source.type === 'npm') {
  console.log(`来源：npm ${pkg.name}@${pkg.version}`);
  console.log('发布 npm 后可用的索引地址：');
  console.log(`  https://unpkg.com/${pkg.name}@${pkg.version}/market/index.json`);
} else {
  console.log(`来源：git ${source.url}@${source.commit.slice(0, 12)}`);
  if (platform === 'gitee') {
    console.log('把 market/ 推到 Gitee 后，索引地址（DSH 发现页 → 索引源）：');
    console.log(`  https://gitee.com/${owner}/${repo}/raw/main/market/index.json`);
  } else {
    console.log('GitHub Pages 索引地址：');
    console.log(`  https://${owner}.github.io/${repo}/market/index.json`);
  }
}

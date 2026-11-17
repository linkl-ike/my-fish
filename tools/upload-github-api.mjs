#!/usr/bin/env node
/**
 * Upload this repository to GitHub through api.github.com (works when github.com:443 is blocked).
 *
 * Requirements:
 *   - A GitHub Personal Access Token with `repo` scope in env GITHUB_TOKEN
 *     (create it on any device/network that can open GitHub; never commit it).
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx node tools/upload-github-api.mjs --owner <user> --repo my-fish
 *   GITHUB_TOKEN=ghp_xxx node tools/upload-github-api.mjs --owner <user> --repo my-fish --private
 *
 * What it does:
 *   1. creates the repo if missing (public by default)
 *   2. uploads every file in this directory (except .git/node_modules/archives) via Git Data API
 *   3. commits to the default branch (main)
 *   4. adds the `dsh-plugin` GitHub topic
 */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const args = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const owner = arg('owner');
const repo = arg('repo');
const isPrivate = args.includes('--private');
const branch = arg('branch', 'main');

if (!token) { console.error('缺少环境变量 GITHUB_TOKEN（PAT，需要有 repo 权限）'); process.exit(1); }
if (!owner || !repo) { console.error('用法: node tools/upload-github-api.mjs --owner <user> --repo <repo>'); process.exit(1); }

const root = process.cwd();
const API = 'https://api.github.com';
const headers = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'my-fish-uploader',
  'content-type': 'application/json',
};

async function api(method, path, body) {
  const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  if (!res.ok && res.status !== 404) {
    console.error(`HTTP ${res.status} ${method} ${path}\n${text.slice(0, 800)}`);
    throw new Error('GitHub API error');
  }
  return { status: res.status, json };
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'data', 'backups', 'dist', '.ignored']);
const SKIP_EXT = ['.tgz', '.zip', '.db', '.db-wal', '.db-shm', '.log'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      walk(abs, out);
    } else {
      if (SKIP_EXT.some((e) => name.endsWith(e))) continue;
      out.push(abs);
    }
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1) 确保仓库存在
  let repoResp = await api('GET', `/repos/${owner}/${repo}`);
  if (repoResp.status === 404) {
    console.log(`创建仓库 ${owner}/${repo} ...`);
    repoResp = await api('POST', '/user/repos', {
      name: repo,
      description: 'my fish - a fish companion plugin for DeepSeek Harness',
      private: isPrivate,
      has_issues: true,
      has_wiki: false,
    });
    if (!repoResp.json) throw new Error('创建仓库失败');
  }
  console.log('仓库:', repoResp.json.html_url);

  // 2) 上传文件（Git Data API）
  const files = walk(root);
  console.log(`文件数: ${files.length}`);
  const tree = [];
  let i = 0;
  for (const file of files) {
    const rel = relative(root, file).replace(/\\/g, '/');
    const content = readFileSync(file);
    const blob = await api('POST', `/repos/${owner}/${repo}/git/blobs`, {
      content: content.toString('base64'),
      encoding: 'base64',
    });
    tree.push({ path: rel, mode: '100644', type: 'blob', sha: blob.json.sha });
    i += 1;
    if (i % 25 === 0) console.log(`  已上传 ${i}/${files.length}`);
    await sleep(50);
  }

  // 3) 当前分支状态
  const refResp = await api('GET', `/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  let commitResp;
  if (refResp.status === 404) {
    const treeResp = await api('POST', `/repos/${owner}/${repo}/git/trees`, { tree });
    commitResp = await api('POST', `/repos/${owner}/${repo}/git/commits`, {
      message: `my fish ${JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version}`,
      tree: treeResp.json.sha,
    });
    await api('POST', `/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: commitResp.json.sha });
    await api('PATCH', `/repos/${owner}/${repo}`, { default_branch: branch });
  } else {
    const parent = refResp.json.object.sha;
    const treeResp = await api('POST', `/repos/${owner}/${repo}/git/trees`, { tree, base_tree: undefined });
    commitResp = await api('POST', `/repos/${owner}/${repo}/git/commits`, {
      message: 'update my fish',
      tree: treeResp.json.sha,
      parents: [parent],
    });
    await api('PATCH', `/repos/${owner}/${repo}/git/refs/heads/${branch}`, { sha: commitResp.json.sha, force: true });
  }
  console.log('commit:', commitResp.json.sha);

  // 4) topic
  try {
    await api('PUT', `/repos/${owner}/${repo}/topics`, { names: ['dsh-plugin', 'dsh', 'fish', 'persona', 'companion'] });
    console.log('topics: 已加 dsh-plugin');
  } catch { console.log('topics: 添加失败（可手动在仓库页加）'); }

  console.log('完成:', `https://github.com/${owner}/${repo}`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });

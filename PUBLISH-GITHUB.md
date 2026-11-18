# 发布到 GitHub 并进入 DSH 插件市场

> ⚠️ **如果 github.com 打不开（国内网络常见）**：先看 [PUBLISH-ALTERNATIVES.md](PUBLISH-ALTERNATIVES.md)。
> 里面实测了 ssh.github.com:443、api.github.com、Gitee、npm+unpkg 等可用通路，
> 并给出了**完全不需要 GitHub 也能先上 DSH 发现页**的两条路线。

DSH 没有官方中心市场：**插件市场（dshmarket）的目录来自社区精选仓库 [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)**（`data/plugins/*.yml` → `plugins.json`）；DSH 自带的「发现」页则使用 **format-1 索引 JSON**（用户手动添加索引源）。两条路都用得上，下面按顺序做。

## 0. 先准备好本机配置

把仓库里的 `OWNER` 全部替换成你的 GitHub 用户名（至少三处）：

- `package.json` 的 `repository.url` / `homepage` / `bugs.url`
- `market/awesome-entry.yml` 的 `url` / `name` / `icon`（可选 `tarball`）
- `README.md` / `INSTALL.md` 里的安装命令

## 1. 建仓库并推送

```sh
cd my-fish
git init -b main
git add -A
git commit -m "my fish 1.0.7"
git remote add origin https://github.com/<OWNER>/my-fish.git
git push -u origin main
```

仓库要求（CI 会查）：

- 公开仓库
- 根目录 `package.json` 声明 `dsh.bundle`（本仓库已有：`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`）
- 仓库创建满 **1 天** 后才能提交收录
- 给仓库加 **`dsh-plugin`** topic（GitHub 仓库页 → About → Topics）

## 2. 装出来的效果（不需要市场也能装）

```sh
dsh plugin --profile <profile> add git+https://github.com/<OWNER>/my-fish.git#<commit>
```

或把 `npm pack` 生成的 `my-fish-1.0.7.tgz` 上传到 GitHub Release，然后：

```sh
dsh plugin --profile <profile> add https://github.com/<OWNER>/my-fish/releases/download/v1.0.7/my-fish-1.0.7.tgz
```

## 3. （可选）发布到 npm

市场里的下载量、版本号来自 npm；不发布不影响收录。

```sh
# 先确认名字没被占（npm 包名必须唯一；被占了就改 package.json name，
# 同时改 cordis.patch.yml 的 id/name 和 profile 依赖名）
npm view my-fish version
npm login
npm publish --access public
```

要求：已发布包的 `repository` 字段必须指回收录的那个 GitHub 仓库（本仓库已配置）。

## 4. 提交到 awesome-dsh-plugin（进 dshmarket / 官方目录）

1. Fork [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
2. 把 `market/awesome-entry.yml` 复制成 `data/plugins/<OWNER>__my-fish.yml`，改成你的仓库地址
3. 提 PR（一个 PR 最多 3 条；描述必须和实际功能一致；`description.en` 含 `: ` 时用引号）
4. 合并后网站自动重建，`dshmarket` 下次打开就能搜到、一键安装（通常一天内）

条目文件里可以做/不要做的事：

- `category`: 本插件用 **`fun`**（虚拟陪伴/娱乐）；如果维护者觉得更适合 `identity`（身份与通信，因为有 QQ/B站/抖音）或 `memory`，他们会在评审时改，不会因此打回
- `icon`: 必须是 **GitHub 托管的位图**（本仓库 `assets/icon-180.png`，PNG 180×180），SVG 会被拒
- `tarball`（可选）：GitHub Release 预构建 tgz 地址
- 不要手写 `npm:` 字段（会被校验拒绝；npm 映射自动从 registry 采集）

## 5. （可选）自己的 format-1 索引源

想让用户不必等收录、直接在你的索引里看到插件：

```sh
node market/build-index.mjs --owner <OWNER> --repo my-fish
# 生成 market/index.json + market/icons/my-fish-180.png
```

把 `market/` 目录发布到 GitHub Pages（或任意 https 静态站），用户打开
**插件 → 发现 → 索引源（Index sources）→ 添加索引源**，填：

```
https://<OWNER>.github.io/my-fish/market/index.json
```

> 需要先启用实验性插件「自定义插件索引 / Custom plugin indexes」。

`build-index.mjs` 会读取当前 git commit 生成 git 来源的索引；每次发版后重新生成并推送即可。

## 6. 检查清单

- [ ] `git status` 里没有 `*.db` / `data/` / 备份 / 日志（`.gitignore` 已挡住）
- [ ] `package.json` 的 `engines.dsh` 与实测 DSH 版本兼容
- [ ] 如需商店截图：用你自己的环境截图后放到 `assets/` 并在 `screenshots.json` 声明（仓库默认不含截图，避免带出个人数据）
- [ ] `docs/DETAIL.md` 是单图详情页，图片在 `docs/preview.svg`
- [ ] 标签 `v1.0.7` 推动后 GitHub Actions 自动生成 `my-fish-1.0.7.tgz` 并附加到 Release（`.github/workflows/release.yml`）

# 网络受限时怎么发布 my fish

> 实测时间：2026-11-18 01:xx（这台机器，无需代理）
> `github.com:443` **不通**；但下面这些是通的：`api.github.com`、`raw.githubusercontent.com`、`codeload.github.com`、**`ssh.github.com:443`（能完成 SSH 握手）**、`gitee.com`（含 git 推拉）、`registry.npmjs.org`、`unpkg.com`、`ghproxy.net`。
> 结论：**GitHub 网页被墙，但 GitHub API / SSH-443 / 各种镜像可用；不依赖 GitHub 也能先"上架"DSH 发现页。**

DSH 的"插件市场"其实有两层：

| 入口 | 数据来源 | 没有 GitHub 能不能上 |
|---|---|---|
| **插件 → 发现（Discover）→ 索引源** | 任意 https 的 format-1 索引 JSON | ✅ 能（Gitee raw / npm + unpkg 都行） |
| **插件 → 插件市场（dshmarket）** | 社区精选目录 `awesome-dsh-plugin`（GitHub 仓库 PR） | ❌ 必须 GitHub 仓库被收录 |

所以先选路线：

---

## 路线 A（推荐，今天就能用）：Gitee 仓库 + Gitee 索引

不需要 GitHub，Gitee 网页和 git 都通。

1. 解压 `my-fish-1.0.4-github-repo.zip`，在目录里：

   ```bash
   git init -b main
   git add -A
   git commit -m "my fish 1.0.4"
   ```

2. 打开 https://gitee.com 新建仓库 `my-fish`（公开），然后：

   ```bash
   git remote add gitee https://gitee.com/<你的Gitee用户名>/my-fish.git
   git push -u gitee main
   ```

3. 生成 Gitee 版索引（把 git 来源写成 gitee）：

   ```bash
   node market/build-index.mjs --owner <你的Gitee用户名> --repo my-fish --platform gitee
   git add -A && git commit -m "market index" && git push
   ```

4. 在收件人机器上：**插件 → 发现 → 索引源** 添加

   ```
   https://gitee.com/<你的Gitee用户名>/my-fish/raw/main/market/index.json
   ```

   （首次需要先启用实验性插件「自定义插件索引 / Custom plugin indexes」。）

5. 直接安装也可以：

   ```bash
   dsh plugin --profile <profile> add git+https://gitee.com/<你的Gitee用户名>/my-fish.git#<commit>
   ```

> 限制：dshmarket 可视市场不会收录 Gitee 仓库；但 DSH 自带「发现」页能搜索/安装，这已经算"插件市场识别"。

---

## 路线 B：发布到 npm + unpkg 索引（也不需要 GitHub）

npm registry 通，unpkg 也通；npm 网站 `npmjs.com` 用浏览器一般能开（curl 403 是反爬，不代表浏览器不行）。

1. 登录并发布（先确认 `my-fish` 包名没被占；占了就改 `package.json` 的 `name`，同时改 `cordis.patch.yml` 的 id/name 和 profile 依赖名）：

   ```bash
   npm login
   npm publish --access public
   ```

2. 生成 npm 版索引（不需要 git commit）：

   ```bash
   node market/build-index.mjs --owner <你的名字> --repo my-fish --npm
   git add market/index.json market/icons && git commit -m "npm market index" && git push
   ```

3. 用户添加索引源：

   ```
   https://unpkg.com/my-fish@1.0.4/market/index.json
   ```

4. 直接安装：

   ```bash
   dsh plugin --profile <profile> add my-fish@1.0.4
   ```

> 说明：`package.json` 的 `files` 已包含 `market`，发布后 unpkg 能直接取到索引和图标。

---

## 路线 C：要进官方 dshmarket 目录（必须 GitHub，网络解决后做）

官方目录只收 GitHub 仓库，所以最终还是要传到 GitHub。github.com 网页不通，但以下三条实测可行：

### C-1. SSH over 443（最推荐）

`ssh.github.com:443` 实测能握手，只是缺 SSH key。

1. 运行本仓库脚本（生成 key + 写 SSH 配置）：

   ```powershell
   powershell -ExecutionPolicy Bypass -File tools/setup-github-ssh.ps1
   ```

2. 把脚本打印的公钥加到 GitHub：**用能访问 GitHub 的设备/网络**（手机热点、公司网络、朋友的电脑、或临时 VPN）打开
   https://github.com/settings/keys → New SSH key → 粘贴公钥。
   若你有 PAT token，也可以在任意能跑命令的机器上：

   ```bash
   curl -X POST -H "Authorization: token $GITHUB_TOKEN" \
     -H "Accept: application/vnd.github+json" \
     https://api.github.com/user/keys \
     -d "{\"title\":\"my-fish\",\"key\":\"$(cat ~/.ssh/my-fish_github.pub)\"}"
   ```

3. 验证并推送：

   ```bash
   ssh -T git@github.com        # 应显示 "Hi <你>! You've successfully authenticated"
   git remote add origin git@github.com:<你的GitHub用户名>/my-fish.git
   git branch -M main
   git push -u origin main
   ```

### C-2. 用 GitHub API 上传（api.github.com 实测可用）

有 PAT 的话，不需要 github.com 网页：

```bash
export GITHUB_TOKEN=ghp_xxx        # PAT，需 repo 权限
node tools/upload-github-api.mjs --owner <你的GitHub用户名> --repo my-fish
```

脚本会：创建仓库（若不存在）→ 用 Git Data API 逐个上传文件（含 `.github`、`market`、`assets`）→ 给仓库加 `dsh-plugin` topic。
之后收录 PR 也可以用 API 提（或等能访问网页时再提）。

### C-3. 代理 / 加速器（让网页可用）

选项（任选其一）：

- **Watt Toolkit（原 Steam++）**：自带"GitHub 加速"，装好后浏览器/系统代理都能开 github.com（国内最常用）
- **FastGithub / dev-sidecar**：本地 DNS/HTTPS 代理，专门修 GitHub 访问
- **任意 Clash / V2Ray 订阅**：开启系统代理即可
- **手机热点**：部分运营商移动网络可直连 GitHub
- **ghproxy.net**（实测 200）：只能读 raw/release/archive，**不能 push**，可用来下载仓库压缩包

### C-4. 有 GitHub 后，把 Gitee 同步过去

```bash
git remote add origin git@github.com:<GitHub用户名>/my-fish.git
git push -u origin main
```

然后按 `PUBLISH-GITHUB.md` 第 4 步向 `awesome-dsh-plugin` 提收录 PR（仓库满 1 天后）。

---

## 一页结论

- **今天就能上架（DSH 发现页）**：Gitee 仓库 + `--platform gitee` 索引，或 npm + unpkg 索引。
- **官方 dshmarket 目录**：必须 GitHub，等你能用 SSH-443/API/代理时再传；代码先放 Gitee 不会白做，一条 `git remote` 就能同步。
- 所有路径都不影响插件本身：`git`/`npm` 只是分发方式，装到 `~/.dsh/plugins/my-fish` 后照常运行。

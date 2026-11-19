# my fish

一个 DeepSeek Harness（DSH）插件：**鱼的引擎 + 一体化面板**装在同一个 bundle 里，profile 里只装这一个插件。

- **引擎**：`fish/`（本地维护的 fish-core 副本，MIT）——人格、按人长期记忆、QQ / B站 / 抖音私信、语音、日记、周记、备份
- **面板**：11 个标签页——总览 / 通道 / 语音 / B站·抖音 / 联系 / 记忆 / 人物 / 心情 / 人格 / 模型·用量 / 表情·黑话 / 检索 / 世界书 / 日志·备份 / 动态·整理 / 存储·存档 / 归档浏览 / 服务·归档
- **服务/归档** 页里有版本信息：插件版本、鱼引擎版本、面板接口、数据目录

## 前置环境

完整清单见 **[PREREQUISITES.md](PREREQUISITES.md)**，速记：

- 必需：**DeepSeek Harness 桌面版 ≥ 0.2.1**（自带 Node 24，无需另装）、DSH 里已配置可用的聊天模型；
- **QQ**：需要 **SnowLuma**（OneBot 11 网关）+ QQ 号（面板「通道 → 登录 / 连接」可一键打开 SnowLuma 控制台扫码）；
- **B站**：无需额外软件，面板内扫码登录；
- **抖音**：需要 Edge / Chrome，面板一键打开专用登录窗口；
- 可选：语音桥（TTS/STT）、ffmpeg（视频抽帧）、SurfCore 旧数据归档、GitHub 网络（仅自动更新用）。

一键自检（Windows PowerShell）：

```powershell
powershell -ExecutionPolicy Bypass -File tools/check-env.ps1
```

## 安装

### 从 GitHub 直接安装（DSH CLI）

```sh
dsh plugin --profile <你的 profile> add git+https://github.com/linkl-ike/my-fish.git#<commit>
```

也可以下载 Release 里的 `my-fish-1.3.2.tgz`；每个 Release 还附带 `my-fish-<版本>-env-and-guide.zip`（环境清单 + 安装指南 + 一键自检脚本），Release 说明里直接写了环境要求和安装步骤：

```sh
dsh plugin --profile <你的 profile> add https://github.com/linkl-ike/my-fish/releases/download/v1.3.2/my-fish-1.3.2.tgz
```

### 服务 / 归档 → 更新日志

每次版本更新都会在面板的 **服务 / 归档** 里写一条简单易懂的更新日志，不用去翻 GitHub。

### 在 DSH「发现」里添加索引源

**插件 → 发现 → 索引源（Index sources）→ 添加**：

```
https://linkl-ike.github.io/my-fish/market/index.json
```

（需要先启用实验性插件「自定义插件索引 / Custom plugin indexes」。）

### 本地目录安装

见 [INSTALL.md](INSTALL.md)（把本目录放进 `~/.dsh/plugins/my-fish`，profile 依赖写 `my-fish: link:...`，重启 DSH）。

## 数据位置（升级/重装都不动）

- 记忆库：`~/.dsh/fish-soul/soul.db`
- 聊天归档：`~/.dsh/fish-soul/chat-archive.db`
- 人格卡：`~/.dsh/fish-soul/persona.json`
- 配置：`~/.dsh/fish-soul-config.json`

插件本身不包含任何用户数据；换机器时把上述目录/文件复制过去即可。

## 依赖的外部服务（可选，缺了对应功能降级）

| 服务 | 用途 | 默认位置 |
|---|---|---|
| SnowLuma | QQ 收发（HTTP 3000 / WS 3001） | `%USERPROFILE%\SnowLuma` |
| 鱼语音桥 | TTS 合成（8766） | `%USERPROFILE%\fish-tts-shim` |
| SurfCore 数据目录 | 面板归档浏览 / 迁移（只读） | `%USERPROFILE%\.dsh\surfcore` |

路径可在 `cordis.patch.yml` 的 `my-fish` 行 `config:` 覆盖，或设环境变量
`FUSION_SNOWLUMA_DIR`、`FUSION_SHIM_DIR`、`FUSION_PATCHES_DIR`。

## 接口

- 面板 Host：`/api/plugins/my-fish/state`、`/archive`、`/service`、`/migrate`
- 鱼引擎：`/api/plugins/fish-soul/*`（引擎内部契约）

## 目录

```
index.js / client.js / cordis.patch.yml / locale / icon.svg
fish/                  鱼的引擎（fish-core 副本）
docs/DETAIL.md         插件详情页（单图）
docs/DESIGN.md         设计 / 接口 / 验收记录
docs/preview.svg       详情页配图
assets/                图标（180px PNG）
market/                插件市场收录材料（awesome 条目 / format-1 索引生成器）
screenshots.json       市场截图声明
INSTALL.md / PUBLISH-GITHUB.md / LICENSE / THIRD-PARTY-NOTICES.md
```

## 版本

- 插件：**1.3.2**
- 内嵌引擎：fish-core 0.18.5-local.14

## 发布到插件市场

网络打不开 GitHub？先看 [PUBLISH-ALTERNATIVES.md](PUBLISH-ALTERNATIVES.md)（Gitee / npm+unpkg / SSH-443 / API 上传）。

见 [PUBLISH-GITHUB.md](PUBLISH-GITHUB.md)：
1. 推到 GitHub（加 `dsh-plugin` topic）
2. 可选：发 npm / GitHub Release tarball
3. 向 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提收录 PR（`market/awesome-entry.yml` 已备好模板）
4. 或者用 `market/build-index.mjs` 生成自己的 format-1 索引，用户把它加进 **插件 → 发现 → 索引源**

## 许可

本插件 MIT。内嵌 fish-core 来自 [dsh-fish-soul](https://github.com/Britneycode/dsh-fish-soul)（MIT），见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。


## 登录 QQ / B站 / 抖音

面板 → **通道 → 登录 / 连接**（最上面一张卡）：

- **QQ**：点「打开 SnowLuma 扫码登录」→ 浏览器打开本机 SnowLuma 控制台（默认 http://127.0.0.1:5099），在里面扫码登录 QQ；登完回面板把 QQ 通道「启用」打开。
- **B站**：点「B站扫码登录」→ 面板里直接显示二维码，用 B站 App 扫码；「刷新 B站 扫码状态」查看结果。
- **抖音**：点「打开抖音登录窗口」→ 弹出鱼专用浏览器（独立 profile，不影响你平时用的浏览器），在里面登录抖音；「显示抖音窗口」可随时把窗口叫回来。

> QQ 依赖本机安装并运行 SnowLuma（OneBot 11 网关）；B站/抖音不需要。
> 登录一次后会记住，之后由鱼自己轮询收消息。


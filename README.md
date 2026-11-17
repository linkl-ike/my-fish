# my fish

一个 DeepSeek Harness（DSH）插件：**鱼的引擎 + 一体化面板**装在同一个 bundle 里，profile 里只装这一个插件。

- **引擎**：`fish/`（本地维护的 fish-core 副本，MIT）——人格、按人长期记忆、QQ / B站 / 抖音私信、语音、日记、周记、备份
- **面板**：17 个标签页——总览 / 通道 / 语音 / B站·抖音 / 联系 / 记忆 / 人物 / 人格 / 模型·用量 / 表情·黑话 / 检索 / 世界书 / 日志·备份 / 动态·整理 / 存储·存档 / 归档浏览 / 服务·归档
- **服务/归档** 页里有版本信息：插件版本、鱼引擎版本、面板接口、数据目录

## 安装

### 从 GitHub 直接安装（DSH CLI）

```sh
dsh plugin --profile <你的 profile> add git+https://github.com/<OWNER>/my-fish.git#<commit>
```

也可以下载 Release 里的 `my-fish-1.0.0.tgz`：

```sh
dsh plugin --profile <你的 profile> add https://github.com/<OWNER>/my-fish/releases/download/v1.0.0/my-fish-1.0.0.tgz
```

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

- 插件：**1.0.0**
- 内嵌引擎：fish-core 0.18.5-local.2

## 发布到插件市场

网络打不开 GitHub？先看 [PUBLISH-ALTERNATIVES.md](PUBLISH-ALTERNATIVES.md)（Gitee / npm+unpkg / SSH-443 / API 上传）。

见 [PUBLISH-GITHUB.md](PUBLISH-GITHUB.md)：
1. 推到 GitHub（加 `dsh-plugin` topic）
2. 可选：发 npm / GitHub Release tarball
3. 向 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提收录 PR（`market/awesome-entry.yml` 已备好模板）
4. 或者用 `market/build-index.mjs` 生成自己的 format-1 索引，用户把它加进 **插件 → 发现 → 索引源**

## 许可

本插件 MIT。内嵌 fish-core 来自 [dsh-fish-soul](https://github.com/Britneycode/dsh-fish-soul)（MIT），见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

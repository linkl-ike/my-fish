# my fish 前置环境

> 适用版本：my fish 1.0.4（fish 引擎 0.18.5-local.3）  
> 一句话：**DSH 是必需品；QQ 聊天需要 SnowLuma；B站/抖音只需要浏览器；其余都是可选增强。**

---

## 1. 快速结论

| 想用的能力 | 必须准备 |
|---|---|
| 插件本身跑起来（面板 / 记忆 / 人格 / 日记 / 备份） | DeepSeek Harness 桌面版 ≥ 0.2.1 |
| **QQ** 聊天 | SnowLuma（OneBot 11 网关）+ 一个 QQ 号 |
| **B站** 私信 / 刷视频 | 无额外软件；能登录 B站 的账号 + 网络 |
| **抖音** 私信 / 刷视频 | Edge 或 Chrome 浏览器 + 抖音账号 + 网络 |
| 语音（听说） | 一个 OpenAI 兼容的 TTS/STT 服务；本机语音桥（可选） |
| B站 / 抖音 视频抽帧看画面 | ffmpeg（可选） |
| 旧 SurfCore 数据归档 / 迁移 | SurfCore 数据目录（可选） |
| 自动检测更新 | 能访问 GitHub（可选；不影响聊天） |

---

## 2. 硬性要求

| 项 | 要求 | 说明 |
|---|---|---|
| 系统 | **Windows 10 / 11 x64**（推荐） | 面板里的「启动 SnowLuma / 打开 SnowLuma 登录页 / 打开数据目录 / 启动语音桥」是 Windows 实现；macOS / Linux 可以跑引擎和 B站/抖音，但这些服务按钮需要手动启动对应组件 |
| DeepSeek Harness | **≥ 0.2.1**（本插件 `engines.dsh`；实际验证到 0.2.2-rc.3） | 必须用桌面版（Web GUI 由 DSH 注入） |
| Node.js | **≥ 22.5.0** | DSH 自带 Node 24.x，**无需另装**；插件使用内置 `node:sqlite` |
| 磁盘 | 插件约 1 MB（含引擎解压后约 4 MB）；数据另算 | 记忆 / 备份 / 抖音浏览器 profile 会持续增长，建议预留 ≥ 1 GB |
| 内存 | 4 GB+ 可用 | DSH + 鱼引擎 + 浏览器同时开时建议 8 GB+ |
| 模型 | DSH 里已配置**可用的聊天模型** | 鱼的对话/整理/日记都走宿主模型；没配模型时面板能开，但不会聊天 |
| 网络 | B站：`bilibili.com`；抖音：`douyin.com`；可选 GitHub | 国内网络直连 GitHub 通常需要代理或 GitHub 加速工具（只影响自动更新和从 GitHub 安装） |

插件安装后在 DSH profile 里只占一个 bundle：`my-fish`。

---

## 3. 分平台前置

### 3.1 QQ —— SnowLuma（必须）

QQ 不是插件自己登录的，而是通过 **SnowLuma**（OneBot 11 网关）连 QQ：

1. 安装并运行 SnowLuma（本项目验证版本：`@snowluma/runtime 2.4.2`）。
2. 默认目录：`~/SnowLuma`（Windows 即 `C:\Users\<你>\SnowLuma`）。
   - 换目录时用环境变量 `FUSION_SNOWLUMA_DIR`，或插件 `cordis.patch.yml` 里 `config.snowlumaDir` 覆盖。
3. SnowLuma 启动后：
   - 控制台 WebUI：默认 `http://127.0.0.1:5099`（`config/runtime.json` 的 `webuiPort` 可改）
   - OneBot 正向 WS：`ws://127.0.0.1:3001`（`config/onebot_<QQ号>.json`）
4. **QQ 扫码在 SnowLuma 控制台里**，不在鱼的面板里。
   面板操作：**通道 → 登录 / 连接 → 「打开 SnowLuma 扫码登录」**，浏览器会打开 SnowLuma 控制台，扫码登录 QQ。
5. 登录后回面板把 QQ 通道「启用」打开；插件会自动读取 SnowLuma 的 WS accessToken。

> 不需要 SnowLuma 的话，QQ 通道保持关闭即可，B站/抖音/记忆/日记照常工作。

### 3.2 B站 —— 无需额外软件

- 只需要：B站 账号（用 B站 App 扫码）+ 能访问 `bilibili.com` 的网络。
- 面板：**通道 → 登录 / 连接 → 「B站扫码登录」**，二维码直接显示在面板里；扫码成功后「刷新 B站 扫码状态」确认。
- 登录凭据保存在 `$DSH_HOME/fish-soul/bili-auth.json`（仅本机，0600 权限）。
- B站「刷视频 / 抽帧」需要 ffmpeg（可选）。

### 3.3 抖音 —— 需要 Edge 或 Chrome

- 支持 Edge / Chrome / Brave / Vivaldi / Chromium 等（自动检测，也可在面板/配置里指定 `douyin.browser.customPath`）。
- 面板：**通道 → 登录 / 连接 → 「打开抖音登录窗口」**，会启动**鱼专用浏览器**（独立 profile，不影响你平时的浏览器），在弹出的窗口里登录抖音。
- 抖音登录态保存在 `$DSH_HOME/fish-soul/douyin-browser/<浏览器>/`。
- 打开浏览器时会监听本机调试端口（默认 `127.0.0.1:47890`）。
- 抽帧看画面需要 ffmpeg（可选）。

---

## 4. 可选增强

| 组件 | 用途 | 默认位置 / 配置 | 没有会怎样 |
|---|---|---|---|
| **语音桥 (`fish-tts-shim`)** | QQ 语音收发 / 面板试听 | `~/fish-tts-shim`，环境变量 `FUSION_SHIM_DIR` 或 `config.shimDir`；监听 `127.0.0.1:8766` | 纯文字聊天不受影响；语音页会显示离线 |
| **TTS / STT 服务** | 真正发声 / 转写 | 面板「语音」页填 OpenAI 兼容地址与 Key | 不能发/听语音 |
| **Embedding 服务** | 记忆语义检索（更好召回） | 面板「检索」页填 baseURL / model / Key | 退化为关键词检索，功能可用 |
| **ffmpeg** | B站/抖音视频抽帧 | 任意位置加入 PATH | 只看标题/简介/字幕，不抽画面 |
| **SurfCore 旧数据** | 归档浏览 + 旧记忆迁移 | `$DSH_HOME/surfcore`，或 `config.surfcoreData` / `surfcoreRoot` | 「归档浏览」「SurfCore 归档」为空；迁移功能不可用 |
| **语音/记忆补丁目录** | 可选的本地补丁脚本 | `~/fish-soul-patches`，`config.patches` | 不影响核心功能 |

---

## 5. 端口一览（全部只监听本机）

| 端口 | 归属 | 必需性 |
|---|---|---|
| `3001` | SnowLuma OneBot 正向 WS | QQ 聊天必需 |
| `3000` | SnowLuma HTTP API（可选） | 可选 |
| `5099` | SnowLuma WebUI（扫码/控制台） | QQ 登录需要 |
| `8766` | 语音桥 | 语音需要 |
| `47890` | 抖音专用浏览器调试端口（打开时） | 抖音需要 |
| 随机端口 | DSH Web GUI（`127.0.0.1`） | 必需 |

> 端口被占用时：SnowLuma 改 `config/runtime.json` 的 `webuiPort`；语音桥改启动脚本；抖音 host 端口可在配置里调整。

---

## 6. 数据目录

| 目录 | 内容 | 是否可删 |
|---|---|---|
| `$DSH_HOME`（默认 `~/.dsh`） | DSH 本体数据 | 否 |
| `$DSH_HOME/fish-soul/` | `soul.db`（记忆）、`persona.json`、`bili-auth.json`、`douyin-browser/`、`workspace/`、`backups/` | **删了鱼就没了**，先备份 |
| `$DSH_HOME/fish-soul-config.json` | 鱼设置（通道、语音、行为等） | 删了恢复默认 |
| `~/SnowLuma/` | SnowLuma 本体与 QQ 登录态 | 否 |
| `~/fish-tts-shim/` | 语音桥 | 可删（失去语音） |
| `~/fish-soul-patches/` | 可选补丁 | 可删 |
| `SurfCore 目录` | 旧版数据（只读归档） | 迁移完可自行处理 |

> 插件包本身**不含**任何记忆、人格、Cookie、账号信息；`soul.db`、`persona.json`、`bili-auth.json`、`douyin-browser/` 全部只在本机。

---

## 7. 安装 / 验证步骤

1. 安装 DSH 桌面版，创建/选一个 profile。
2. 安装插件（任选其一）：
   ```bash
   dsh plugin --profile <profile> add https://github.com/linkl-ike/my-fish/releases/download/v1.0.4/my-fish-1.0.4.tgz
   # 或从仓库安装
   dsh plugin --profile <profile> add git+https://github.com/linkl-ike/my-fish.git
   ```
3. 重启 DSH（或按提示刷新）。
4. 打开面板 → **服务 / 归档 → 面板自测**：应全部通过（插件→Host→鱼引擎）。
5. **通道 → 登录 / 连接**：按需登录 QQ（SnowLuma）/ B站 / 抖音，然后打开对应通道「启用」。
6. 服务 / 归档 → **面板自测** 再跑一遍，确认「鱼 · 通道状态」为开。
7. 发一条 QQ / B站 / 抖音 消息测试；鱼的回复走 DSH 已配置模型。

### 一键环境自检

仓库自带 `tools/check-env.ps1`（Windows PowerShell 5.1+）：

```powershell
powershell -ExecutionPolicy Bypass -File tools/check-env.ps1
```

会检查：DSH / Node / SnowLuma 目录与 WebUI/WS 端口 / 浏览器 / ffmpeg / 数据目录 / 网络，并输出 PASS / WARN / FAIL 表格。

---

## 8. 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 点「打开 SnowLuma 扫码登录」没有反应 | SnowLuma 没装/路径不对/WebUI 端口不是 5099。检查 `~/SnowLuma` 或配 `FUSION_SNOWLUMA_DIR`，先点「启动 SnowLuma」等几秒再点 |
| QQ 扫码后鱼还是「已启用，等待连接」 | SnowLuma 里确认 QQ 已登录；WS 端口 3001 未被占用；token 不匹配时重启 SnowLuma 让插件重新读取 |
| B站 二维码不显示 | 检查插件引擎是否加载（总览「引擎」应为内置/独立）；网络能否访问 bilibili.com；重新点一次扫码登录 |
| B站 扫码成功但鱼还是没反应 | 通道「B站」的「启用」没开；或扫码时用了已过期的二维码 |
| 抖音窗口不弹出 | 没装 Edge/Chrome，或浏览器路径变了；面板「显示抖音窗口」；检查 47890 是否被占用 |
| 抖音登录了但收不到私信 | 通道「抖音」未启用；或机器人浏览器窗口被关掉（重新打开登录窗口） |
| 自动检测更新失败 | 本机访问不了 GitHub；不影响使用，需要更新时手动从 Release 下载 |
| 面板白屏 / 版本不显示 | 插件没加载完或前端模块冲突；重启 DSH，检查插件页 my-fish 是否为 active |
| 内存/磁盘占用大 | 清理 `fish-soul/backups/` 旧备份；抖音浏览器 profile 会缓存数据，可在面板里清 |

---

## 9. 版本兼容（已验证组合）

| 组件 | 验证版本 |
|---|---|
| my fish | 1.0.4 |
| fish 引擎 | 0.18.5-local.3 |
| DeepSeek Harness | 0.2.2-rc.3 |
| Node（DSH 内置） | 24.21.0 |
| SnowLuma | 2.4.2 |
| B站登录 | 面板扫码（无需版本） |
| Edge | 157.x（抖音/登录页） |
| ffmpeg | 8.1.x（可选） |
| Windows | 11 x64（10 x64 应可用） |

---

## 10. 安全与隐私

- 插件包不含任何用户数据；所有记忆、人格、Cookie、日志只存本机。
- 面板/插件接口只监听本机；B站/抖音/QQ 的登录态不会上传到任何第三方。
- B站 登录凭据文件权限 0600；抖音使用独立浏览器 profile，与你日常浏览器隔离。
- 自动更新只读取 GitHub Releases 的公开版本信息，不执行下载的代码。

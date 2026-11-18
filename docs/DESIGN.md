# 融合面板（v2.0.1）——鱼 + SurfCore 的一体化调节台

一个 DSH 插件 bundle：左侧栏「融合」/ 设置页「融合 · 鱼」。
v1.2：「联系」支持所有人——主人在三边联系卡里改，其他人在「其他人 · 三边联系」里逐个填 QQ / 抖音 / B站 并保存；已经分开的两个人会被合并（记忆/互动/印象都搬过去，不丢），留空=解绑。fish-core 新增 /contacts/persons 与 /contacts/link。

## 六个标签页

| 标签 | 能做什么 |
|---|---|
| **总览** | 自检横幅（双引擎/SnowLuma/语音桥/通道）、鱼本体、服务状态、SurfCore 归档摘要 |
| **通道** | QQ 启用/主人 QQ/白名单；抖音 启用/自动回复/主人 uid/回复所有人；B站 启用/自动回复/主人 UID；上网查；**抖音浏览器控制**（启动/关闭/显示/截图/自检/立即刷/发图文/回评论）；**B站扫码登录/Cookie 登录/退出/立即刷/发动态/回评论** |
| **语音** | 总开关、说话策略、音色 ID、额度、试听；**听语音 STT**（保存收到的/模型/端点/清理收到的语音） |
| **B站 / 抖音** | B站：自动刷/每天条数/每次几个/点赞/收藏/分享/发评论/弹幕/搜关键词刷 + 自动发动态/每天动态/回评论/每小时评论；抖音：窗口模式/自动刷/每天条数/每次几个/点赞/收藏/分享/分享私信/截图看画面 + 自动发图文/回评论/带 emoji；主动开口窗口；回复行为开关 |
| **记忆** | 概览 + **关键词/类型/人筛选搜索**、结果列表（勾选）、**批量删除**、**新增一条记忆**（内容/类型/归属）；数据走鱼自己的 `/inspector/*` 接口 |
| **联系** | 主人三边联系（QQ / 抖音 / B站 = 同一人，可编辑）；**其他人逐个三边联系**（填号保存即合并，留空=解绑）；B站↔QQ 自动对应表；合并会搬运记忆/待办/互动/印象，不丢数据 |
| **人物** | 选人看画像：称呼/关系阶段/好感/互动次数/心情/印象字段/最近片段；可改称呼、关系阶段（锁住或改回自动）、立刻整理一次印象 |\n| **检索** | 向量检索端点/模型/API Key、测试连接、索引覆盖率、重建索引 |\n| **动态 / 整理** | 立刻整理记忆、写周记、自动周记开关、动态（为什么回/没回）、暂停的聊天恢复、首次引导清单 |\n| **人格** | 当前人格卡信息、模板切换（可撤销）、自动成长开关 |\n| **模型 / 用量** | 每个功能用哪个模型、用量与单价概览；**按聊天选模型**（私聊/群聊默认、清理单聊覆盖） |\n| **表情 / 黑话** | 收藏开关/上限、收藏列表（**改标签/改名/删除**）、补标签；黑话开关、每个会话学到的说法（**现在学一次/加词条**） |\n| **日志 / 备份** | 运行日志（可清空）、版本/检查更新/一键更新、立即备份、标记「下次启动恢复」 |
| **世界书** | 命中规则（扫描深度/预算/最多命中）、外部世界书列表（开关/删除）、粘贴导入、测试命中 |
| **存储 / 存档** | 数据库自动存档/立刻存档/恢复/删除；聊天记录存档开关与各会话清空；**导入旧聊天**（QQ txt / SillyTavern jsonl / JSON：粘贴或选文件 → 预览 → 勾「我」→ 开始导入 → 进度/取消） |\n| **归档浏览** | SurfCore 记忆卡 / B站记忆 / B站日记 / 观看历史，支持关键词筛选（只读） |\n| **服务 / 归档** | 启动/重启 SnowLuma、启动语音桥、暂停/恢复看门狗、打开数据目录；SurfCore → 鱼 记忆迁移「预览/执行」并显示结果 |

## 可配置项（v0.3）

在 profile 的 `cordis.patch.yml` 里给本插件那一行加 `config`（不填用默认值/环境变量）：

```yaml
- insert:
    - id: my-fish
      name: 'my-fish'
      config:
        snowlumaDir: 'D:\SnowLuma'          # SnowLuma 安装目录（含 start-hidden.vbs）
        shimDir: 'D:\fish-tts-shim'         # 火山语音桥目录（含 start-hidden.vbs）
        fishHome: 'C:\Users\you\.dsh'       # 鱼的 $DSH_HOME（默认 DSH_HOME 或 ~/.dsh）
        surfcoreData: 'C:\Users\you\.dsh\surfcore'
        surfcoreRoot: 'D:\surfcore'         # 不填则从 surfcore/config.json 的 qqbotRoot 读
        patches: 'C:\Users\you\fish-soul-patches'
```

对应环境变量（config 优先）：`FUSION_SNOWLUMA_DIR`、`FUSION_SHIM_DIR`、`FUSION_PATCHES_DIR`；`fishHome` 默认跟随 `DSH_HOME`。

## 架构

```
my-fish (host index.js, apply(ctx, config))
  ├─ GET  /api/plugins/my-fish/state   只读汇总（文件 + 只读 SQLite + 端口探测）
  ├─ POST /api/plugins/my-fish/service 本地服务控制（白名单动作，路径来自 config）
  └─ POST /api/plugins/my-fish/migrate SurfCore→鱼 记忆迁移（端口从请求 Host 头推断）
my-fish (client client.js)
  └─ 同源直连 /api/plugins/fish-soul/*     通道/语音/上网/主动/记忆搜索删除新增 都走鱼自己的接口
```

**边界**：Host 半不写鱼的数据库、不改配置；所有"调节"都通过 fish-soul 自己的 HTTP 接口（它自己校验 sameOrigin 并落盘）。服务控制只允许固定白名单动作，不做任意命令执行。

## 数据/路径

| 项 | 默认 |
|---|---|
| 鱼的数据库（只读打开） | `$DSH_HOME/fish-soul/soul.db` |
| 鱼的配置 | `$DSH_HOME/fish-soul-config.json` |
| SurfCore 归档 | `$DSH_HOME/surfcore`（记忆卡/B站记忆/日记/观看历史） |
| SnowLuma | `C:\Users\<用户>\SnowLuma`（config 里 `snowlumaDir`） |
| 语音桥 | `C:\Users\<用户>\fish-tts-shim`（config 里 `shimDir`） |

迁移会读取上述 SurfCore 文件并调用鱼的 `/import/memories`，**幂等**：重复条目自动跳过。

## 装 / 升级 / 卸载

- 安装：`plugin_manager install_bundle` 指向本目录（已在 desktop profile 里）
- **Host 半（index.js）改动需要重启 DSH**；Client 半（client.js）改动刷新页面即可
- 升级后如 bundle 未出现：检查 `package.json` 是否为无 BOM 的 UTF-8（PowerShell `Set-Content -Encoding UTF8` 会写 BOM，导致 DSH 解析失败并跳过整个 bundle）
- 卸载：profile 里移除 `my-fish` 依赖即可；不会动鱼与 SurfCore 的任何数据

## 已知限制

- 服务控制依赖 Windows 的 `wscript.exe` + 目录里的 `start-hidden.vbs`；非 Windows 环境这些按钮不适用。
- 记忆删除是鱼的软删除（可恢复）；新增/编辑直接走鱼的记忆接口。
- 面板只读状态 + 通过鱼接口调节，不直接写鱼数据库。

## 未搬入清单（建议留在鱼自带页）

| 项 | 原因 |
|---|---|
| 会话迁移到新工作区（/sessions/workspace、/sessions/migrate） | 会重建全部会话，误点风险高 |
| 周记素材来源（/memory/weekly/sources） | 仅当有周记时存在，属调试信息 |
| 麦麦数据库导入（/import/maibot-extras/*） | 小众迁移场景，需要本地库路径 |
| 抖音浏览器底层点击 / 重扫（/douyin/click、/douyin/browser/rescan） | 坐标级调试操作 |

这些只在排查或一次性迁移时用；融合面板保持日常可操作的边界。

## 验收记录（v1.0）

脚本 `scripts/verify-live.mjs <port>`：PASS 10 / WARN 1（抖音浏览器未启动，属预期）。
面板「服务 / 归档 → 面板自测」全绿：Host /state、归档路由 108/13/1/25、通道、鱼自检、记忆 216 条、语音、chatModels 已加载。
归档浏览 UI 实测：记忆卡（108）/ B站记忆（13）/ B站日记（1）/ 观看历史（25）四类可切换、可筛选。
按聊天选模型实测：设私聊默认 deepseek-account/deepseek-flash → 状态读回一致 → 清除后恢复 null/空覆盖。
写路径往返实测：行为开关、立即备份、立刻存档、世界书导入→开关→删除、表情图片导入→删除、旧聊天预览（qq-txt）。

## 已知上游 bug 与补丁

### 抖音「一键自检」误报「抖音 没跑」

- 现象：抖音浏览器/私信轮询实际在运行时（`/channels/state` 里 `douyin.channel.running=true`、`douyin.host.state=running`、`lastPollAt` 持续更新），fish 自带 `/diagnose` 仍报「抖音 没跑」。
- 根因：`lib/routes.js` 的 `/diagnose` 用 `douyinSt?.state === "running"` 判断，但 `deps.douyin.status()`（DouyinChannel）只返回 `{ running: true }`，`state` 在 `DouyinHost.status()` 里。属于 fish-soul 0.18.5 的上游 bug。
- 面板侧：`client.js` 的 `fixChannelDiagnose()` 用 `/channels/state` 实时数据修正这一项，并在详情后标注「（自检项已按实时通道状态修正）」；面板自测另加「抖音 · 运行细节」行。
- 上游修复：`C:\Users\<用户>\fish-soul-patches\fix-douyin-diagnose.cjs`（幂等，自动备份 `routes.js.bak-douyin-diag`）。已应用；**重启 DSH 后** fish 自带设置页的自检也会正确显示。fish-soul 升级后需重新执行一次。

## 鱼的代码归属（2026-11-17 起）

鱼本体已切换为**本地维护版** `C:\Users\<用户>\dsh-plugins\fish-core`（0.18.5-local.1，MIT，来自 dsh-fish-soul 0.18.5）。
不再跟 npm 上游自动更新；数据目录与 HTTP 接口不变。维护/回滚说明见该目录下 `LOCAL-FORK.md`。

## 联系（跨平台身份合并）

- 入口：左侧「融合」→ **联系** 标签。
- 主人：以 QQ 号为主键，配 `douyin.masterUid`（`douyin:<uid>`）和 `bili.masterUid`，三者在 person 表里同属 canonical_id `master`。保存走 `/channels/qq-config`、`/channels/douyin-config`、`/channels/bili-config`。
- 其它人：B站身份通过 `bili.links`（`B站UID=QQ号`）并进其 QQ 人物；抖音按会话 uid 认人（不按昵称），主要覆盖主人/白名单。
- 已联系的人共用同一份记忆/好感/印象/关系阶段；面板的「联系状态」会显示每个人绑定了几/几个平台、共多少条记忆。

## 已知问题修复

### 中文输入法只能输入一个字（v1.2.2 已修，微软拼音实测通过）

- 现象：用中文输入法打字时，第一个拼音字母就被上屏（例如打 nihao 只得到 g），只能 Ctrl+V 粘贴。
- 根因：**受控输入框**在 IME 组字期间每次 input 都触发 setState → React 重渲染把半成品 value 回写 DOM → 组字被打断、只剩第一字。仅监听 composition 事件在 Electron + 微软拼音下仍会被打断。
- 修复：输入框改为**非受控**（DOM 是事实来源）：`Text` / `Area` 用 defaultValue + onInput（isComposing 时跳过），外部值只在元素失焦时同步进 DOM。面板里所有单行输入与多行文本域都走这两个组件。
- 验证：用微软拼音（zh-CN 键盘布局 0x08040804）在「记忆 → 搜内容」里输入 `nihao` → 输入框完整显示拼音组字 `ge'ge`，空格上屏得到「你好」，随后清空。修复前后行为对比明确。

### 输入只能一个一个敲 / 输入法组字被打断（v1.2.3，真正根因）

- 现象：中文输入法只能上屏第一个字母；数字输入只能进一位，之后要重新点输入框。
- 真正根因：所有 tab 组件（Overview / MemoryTab / LogsTab…）都定义在 Panel 函数内部，每次 Panel 渲染都会产生**新的组件函数身份**；`h(MemoryTab)` 在 React 看来是「换了一个组件类型」→ 每次 setState 都会**卸载并重建整个 tab 子树**，输入框 DOM 被替换 ⇒ 焦点丢失、输入法组字被打断。中文能出第一个字是因为组字期间没触发 setState；数字是直接输入，第一次 onChange 就触发重渲染。
- 修复：内容区改成直接调用 `MemoryTab()` 等（返回的元素类型都是模块级稳定组件：Card/Row/Text…），不再把 tab 函数当 React 组件类型传给 `h()`；同时输入框（Text/Area/Num）保持非受控（DOM 自己持有输入内容，外部值只在失焦时同步）。
- 验证（真机，微软拼音 zh-CN 布局 0x08040804，UIA SetFocus + 物理按键）：
  - 中文：记忆→搜内容输入 `nihao` → 组字 `ge'ge` → 空格上屏「你好」✅
  - 数字：日志/备份→保留份数 输入 `12` → 输入框显示 `12`、焦点仍在（修复前只进 `1`、焦点丢失）✅；测试后已把保留份数恢复为 7。

## v2.0：鱼引擎并入（单插件）

- **安装形态**：profile 只安装 `my-fish` 一个 bundle；原来单独的 `dsh-fish-soul` 插件已移除（依赖、bundles、node_modules junction 全部清掉）。
- **代码形态**：fish-core 源码内置在 `my-fish/fish/`（从 `C:\Users\<用户>\dsh-plugins\fish-core` 同步，不含 test/.git）。
- **启动链路**：`index.js` 的 `apply()` 先动态 `import(new URL("./fish/lib/index.js", import.meta.url))`，再 `ctx.plugin(fishModule)` 把鱼作为子插件装起来；鱼的 `inject`（webServer/tools/systemPrompt/llm/agents/workspaceRegistry）由 cordis 在子插件上下文里等待就绪。
- **失败隔离**：动态 import 与 `ctx.plugin` 都在 try/catch 里；鱼起不来时融合面板照常启动，`GET /api/plugins/my-fish/state` 的 `engine.embedded=false` + `engine.error` 给出原因，总览页「引擎」一行也会显示。
- **数据位置不变**：`~/.dsh/fish-soul/`（soul.db / chat-archive.db / persona.json / backups）与 `~/.dsh/fish-soul-config.json`。
- **界面**：鱼的侧边栏「鱼」不再加载；所有功能由融合面板的标签页驱动（接口仍是 `/api/plugins/fish-soul/*`）。
- **改鱼代码**：改 `fish-core` → robocopy 同步到 `my-fish/fish/` → 重启 DSH；详见 `fish/MERGED-INTO-FUSION.md`。
- **回滚**：`C:\Users\<用户>\dsh-backup-20261118-0034\merge-op-20261118\回滚.bat`（恢复两插件形态并重建 junction），重启 DSH。

### v2.0 重启后验收（2026-11-18 00:5x）

- 运行态插件总数 234，`include:fish-soul` 已消失；只剩 `include:my-fish` 一个养鱼插件。
- `GET /api/plugins/my-fish/state` → `engine: {embedded:true,error:""}`；总览「引擎」= 内置（fish-core，随本插件启动）。
- 鱼自检 7/7：版本 v0.18.5-local.3 · 通道 QQ 已连 / B站 已登录 / 抖音 在跑 · 记忆 216 条。
- verify-live 11 PASS；API 全量回归 37 PASS；17 个标签页逐页打开无报错。
- 侧边栏「鱼」入口已随独立插件一起消失，只剩「融合」。
- 已知小项：Host `/state` 的 `fish.version` 仍为空（旧逻辑只从 profile node_modules 找 fish 包）；面板已用 `/update/state` 的 `current` 兜底，显示正常，下次重启无需处理。

### 显示名：my fish（v2.0.2）

- 用户可见名统一改为 **my fish**：侧边栏入口、面板标题、设置页 section、插件页卡片标题（locale en/zh 的 meta.title）。
- 内部标识不变：包名仍是 `my-fish`，插件 id/slot id、HTTP 路由（`/api/plugins/my-fish/*`、`/api/plugins/fish-soul/*`）、数据目录也都保持不变（改名只影响展示，不影响兼容性）。

### 全面改名为 my fish（v1.0.4）

- 插件目录：`C:\Users\<用户>\dsh-plugins\my-fish`；npm 包名 `my-fish`；bundle 行 id/name `my-fish`；profile 依赖与 bundles 同步。
- Host API 前缀改为 `/api/plugins/my-fish/*`；客户端 PLUGIN_ID、slot id 改为 `my-fish`。
- 鱼的接口前缀仍为 `/api/plugins/fish-soul/*`，数据目录仍为 `~/.dsh/fish-soul/`（内部契约与数据安全考虑，未改）。
- 验证脚本同步改为 my-fish 路径/接口；改名后运行态验收：引擎 embedded=true、鱼自检 7/7、记忆 216、verify-live 11 PASS、API 37 PASS、17 标签页无报错。
- 备份与回滚：`C:\Users\<用户>\dsh-backup-rename-20261118-0100\`（含 `回滚.bat`、改名前的插件目录、profile 快照、鱼数据热备份）。

### 1.0.5 打磨（2026-11-18 深夜）

- Host `/state`：`fish.version` 改为读内嵌引擎版本（之前从 profile 的 node_modules 找已不存在的 `dsh-fish-soul`，恒为空）；`bili.loggedIn` 改为读 `bili-auth.json` 判断（之前硬编码 false）。
- 检查更新：三条线路（GitHub API / releases 302 / atom）都连不上时，`error` 改为「连不上 GitHub（当前网络受限）：可以开加速器后再试，或到 GitHub Releases 页手动下载。」，技术细节留在新增的 `errors` 数组里。
- 总览页「服务」卡片新增「抖音收件箱」：显示未确认私信 / 遗漏提示数量，提醒去「通道 → 抖音」处理。
- 版本 1.0.4 → 1.0.5；README / INSTALL / PREREQUISITES / 发布文档 / market 索引同步。

### 1.0.6 抖音未确认私信「重试发送」（2026-11-18 深夜）

- 「通道 → 抖音」新增未确认私信列表：每条显示原文和失败原因，提供「重试发送」「忽略」；按钮区新增「重试全部未确认」。
- 实现只动面板：复用鱼已有的 `POST /douyin/inbox-resolve`（`action: retry` 把消息从 unknown 放回 pending，下一轮轮询重新处理并回复）。
- 诚实告知：重试是「重新处理并重新生成回复」，不是重放旧文本；如果原回复其实已经发出去了，重试会造成重复，列表标题里写明「重试 = 重新处理并回复」。
- 实测：2 条「回复没发出去（发送失败）」→ 点「重试全部未确认」→ 队列 pending=2 → 约 16 秒后 pending=0，两条都变 done，回复成功发出，未确认计数清零。

### 1.0.7 Release 附带环境与指南（2026-11-18 深夜）

- `.github/workflows/release.yml` 新步骤：打 tag 时用 `scripts/make-release-notes.mjs` 自动生成 Release 正文（本版更新日志 + 环境要求速查 + 安装/升级步骤 + 附件说明），并额外打包 `my-fish-<版本>-env-and-guide.zip`（PREREQUISITES.md / INSTALL.md / README.md / THIRD-PARTY-NOTICES.md / LICENSE / tools/check-env.ps1）。
- 目的：从插件市场或 Release 页面来的人，不用翻仓库就能看到「需要什么环境、怎么装、装完怎么验」。
- 实测：v1.0.7 的 Release 自动产出 2 个资产（`my-fish-1.0.7.tgz` + `my-fish-1.0.7-env-and-guide.zip`），正文为自动生成的中文说明。

### 1.1.0 心情：PAD 情绪场（2026-11-19 凌晨）

- 融合 dsh-emotion-memory（MIT）的思路，重写成规则驱动、零模型调用的引擎模块 `fish/lib/emotion.js`：PAD 三维（快乐 / 唤醒 / 掌控，-1..1）+ 14 个情绪通道 + 派生情绪（心疼 / 吃醋 / 委屈 / 思念…）+ 精力（0-100）。
- 接入 `buildContextBlock`：先用本轮最后一位说话人的话更新心情，再把 `[你现在的心情]` 一行注入瞬态块；平静且精力正常时不注入（不占上下文）。只影响语气，不改事实、记忆与人格。
- 路由：`GET /emotion/state`、`POST /emotion/reset`；状态存 soul.db 的 kv（`emotion.field.v1`）。
- 面板新增「心情」标签页（第 18 个）：整体心情 / 派生情绪 / 精力 / PAD 进度条 / 情绪通道 / 最近影响心情的事 / 重置为平静。
- 验证：`scripts/verify-emotion.mjs` ALL PASS；离线 Host / Client 验证通过；重启后在线验收。
- 引擎版本 0.18.5-local.3 → 0.18.5-local.4。

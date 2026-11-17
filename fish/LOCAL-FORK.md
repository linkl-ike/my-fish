# fish-core（鱼的本地维护版）

- **来源**：dsh-fish-soul 0.18.5（MIT，作者 Britneycode）的完整拷贝
- **位置**：`<你的插件目录>\fish-core`
- **加载方式**：DSH profile 依赖 `dsh-fish-soul: link:<你的插件目录>/fish-core`，`node_modules\dsh-fish-soul` 是指向本目录的 Junction（目录联接）
- **数据目录不变**：`~/.dsh/fish-soul/`（soul.db、persona.json、抖音 cookie、聊天存档…），配置在 `~/.dsh/fish-soul-config.json`；切换代码不动数据
- **路由不变**：`/api/plugins/fish-soul/*`（融合面板 my-fish 继续用同一套接口）

## 这意味着什么

以后鱼的行为、提示词、通道逻辑、记忆策略，全部由我们自己改这个目录里的代码；**不再跟 npm 上的 dsh-fish-soul 更新**。
上游以后修 bug / 加功能，想拿再手动合并（见文末），不拿也完全能跑。

## 已经合入我们自己的补丁（原 fish-soul-patches 目录里的脚本）

1. `bili-self-memory-context`：私聊里聊到 B站/抖音/视频时，会带上她自己最近刷到的视频（lib/index.js）
2. `douyin-media-dedupe`：抖音消息 ID 相对时间去重，修「只发一次图片却收到好几次」（lib/channels/vendor/douyin-bridge/douyin-dm.mjs、lib/channels/douyin.js）
3. `fix-douyin-diagnose`：修自带自检把「抖音在跑」误报成「抖音没跑」（lib/routes.js）

原脚本仍保留在 `<你的补丁目录>`，仅作记录；本目录代码里已经生效，**不需要再对 fish-core 跑补丁脚本**。

## 日常怎么“自己更新”（改代码）

1. 改代码 → 重启 DSH（Host 半插件改动必须重启；只改前端页面 JS 不需要）
2. 改完先在命令行做语法检查：`node --check <文件>.mjs`（ESM 文件复制成 .mjs 再 check）
3. 版本号在本文件同级的 `package.json` 里手动改（例如 0.18.5-local.2），方便排查
4. 数据/记忆不会因为改代码丢失；改坏了用 `~/.dsh/fish-soul/backups/soul-*.db` 或面板「日志/备份 → 恢复到它」回滚

## 自带更新器

- 已关闭自动检查（`/update/config autoCheck=false`）
- 由于是 `link:` 安装，自带「一键更新」会被宿主拒绝（不会覆盖本地目录）；这就是我们想要的行为
- 想看上游有没有新版本可以手动去 GitHub releases 看，再决定是否合并

## 回滚到 npm 版（万一）

1. profile `package.json`：`"dsh-fish-soul": "0.18.5"`
2. 删掉 `node_modules\dsh-fish-soul` 这个 Junction，把 `node_modules\dsh-fish-soul.npm-backup-0.18.5` 改回 `dsh-fish-soul`
3. 重启 DSH

## 手动合并上游（可选）

```
# 上游仓库：https://github.com/Britneycode/dsh-fish-soul
# 拿新版 tar 或 git clone 后，对比 lib/ 下改过的文件再合并；重点看：
#   lib/index.js（上下文注入补丁）
#   lib/routes.js（自检补丁）
#   lib/channels/vendor/douyin-bridge/douyin-dm.mjs + lib/channels/douyin.js（抖音去重补丁）
```

## 本地新增功能：联系（0.18.5-local.2）

- `lib/routes-contacts.js`：`GET /contacts/persons`、`POST /contacts/link`。
- `lib/db.js` 的 `linkPersonIdentities()`：显式把 QQ / 抖音 / B站 身份挂到同一个人；
  身份被另一个人占着时会把那行并进来（记忆、待办、互动次数、印象/心情/水位都搬过去），
  解绑只清身份、不动记忆。
- 融合面板「融合 → 联系」页对主人和所有人都提供了三边编辑入口。
- 自动认人逻辑没改：新消息到来时仍按 masterUid / bili.links / 会话 uid 找已有身份，
  所以手动联系之后，三个平台的新消息都会归到同一个人。

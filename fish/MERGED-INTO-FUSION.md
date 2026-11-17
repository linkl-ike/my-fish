# 鱼引擎已并入融合面板（v2.0）

从 2026-11-18 起，`my-fish` 是**唯一的养鱼插件**：

- 面板 Host 端（`../index.js`）启动时动态 import `./lib/index.js`，并通过 `ctx.plugin()` 把鱼引擎作为子插件装起来。
- profile 里不再安装 `dsh-fish-soul`；`node_modules/dsh-fish-soul` 已删除。
- 鱼的侧边栏界面（原来的「鱼」）不再加载；所有功能走融合面板。
- 数据与配置位置不变：
  - 记忆库 `~/.dsh/fish-soul/soul.db`
  - 聊天归档 `~/.dsh/fish-soul/chat-archive.db`
  - 配置 `~/.dsh/fish-soul-config.json`
  - 人格卡 `~/.dsh/fish-soul/persona.json`

## 改鱼代码的流程

1. 权威源码仓库保留在 `<你的插件目录>\fish-core`（git）。
2. 修改后同步到本目录：

   ```powershell
   robocopy "<你的插件目录>\fish-core" "<你的插件目录>\my-fish\fish" /E /XD test .git node_modules /XF *.bak *.bak-*
   ```

3. 重启 DSH（改的是 Host 端代码，不能只刷新页面）。
4. 融合面板 → 日志/备份 → 一键自检；或看 总览 的「引擎」一行。

## 回滚

`<你的备份目录>\merge-op-20261118\回滚.bat`：
恢复 my-fish 旧版文件 + profile 里恢复 `dsh-fish-soul` 依赖/bundle + 重建 junction，然后重启 DSH。

# my fish 安装说明

适用：DeepSeek Harness 桌面版 / `dsh web`（0.2.1+）。

## 方式 A：插件市场 / 发现页

收录后：**插件 → 插件市场 → 搜 “my fish” → 安装**；或 **插件 → 发现 → 索引源** 添加作者的 format-1 索引（见 [PUBLISH-GITHUB.md](PUBLISH-GITHUB.md)）。

## 方式 B：GitHub 安装（无需市场）

```sh
# 固定 commit（推荐，稳定）
dsh plugin --profile <profile> add git+https://github.com/<OWNER>/my-fish.git#<commit>

# 或 GitHub Release 的预构建 tarball
dsh plugin --profile <profile> add https://github.com/<OWNER>/my-fish/releases/download/v1.0.0/my-fish-1.0.0.tgz
```

装完重启 DSH（或按 dsh 提示刷新）。

## 方式 C：本地目录安装

1. 把 `my-fish` 整个目录放到：

   ```
   C:\Users\<你>\.dsh\plugins\my-fish
   ```

2. 编辑 `C:\Users\<你>\.dsh\profiles\desktop\package.json`：
   - `dependencies` 增加：`"my-fish": "link:C:/Users/<你>/.dsh/plugins/my-fish"`
   - `dsh.profile.bundles` 末尾加 `"my-fish"`

3. 建 node_modules 链接（管理员 PowerShell/cmd）：

   ```
   mklink /J "C:\Users\<你>\.dsh\profiles\desktop\node_modules\my-fish" "C:\Users\<你>\.dsh\plugins\my-fish"
   ```

4. 重启 DSH。

## 验证

左侧出现 **my fish** → 打开：
- 总览：引擎 = 内置（fish-core），记忆 N 条
- 服务 / 归档 → 版本信息：my fish 版本 **1.0.0**、鱼引擎版本 **0.18.5-local.2**
- 日志 / 备份 → 一键自检：全绿

## 依赖的外部服务（可选）

| 服务 | 用途 | 默认位置 / 端口 |
|---|---|---|
| SnowLuma | QQ 收发 | `C:\Users\<你>\SnowLuma`，3000/3001 |
| 鱼语音桥 | TTS | `C:\Users\<你>\fish-tts-shim`，8766 |
| SurfCore 数据目录 | 归档浏览 / 迁移（只读） | `C:\Users\<你>\.dsh\surfcore`（可选） |

路径可在 `cordis.patch.yml` 的 `my-fish` 行 `config:` 覆盖，或设环境变量
`FUSION_SNOWLUMA_DIR`、`FUSION_SHIM_DIR`、`FUSION_PATCHES_DIR`。

## 数据目录

首次启动自动创建 `~/.dsh/fish-soul/`；升级/重装插件不会动这里。

## 卸载

profile 的 `dependencies` 与 `bundles` 删掉 `my-fish`，删除 node_modules 里的 `my-fish` 链接，重启。记忆数据在 `~/.dsh/fish-soul/`，不随插件删除。

## 升级

覆盖插件目录（或市场一键更新）→ 重启 DSH；改鱼引擎代码见 `fish/MERGED-INTO-FUSION.md`。

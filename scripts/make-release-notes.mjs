// 生成 GitHub Release 说明（中文）：本版更新日志 + 环境要求 + 安装/升级步骤 + 附件说明。
// 用法：node scripts/make-release-notes.mjs > release-notes.md
// GitHub Actions 的 release.yml 在打 tag 时调用它，作为 Release 正文。
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const readJson = (file) => JSON.parse(readFileSync(new URL(file, root), 'utf8'));

const pkg = readJson('package.json');
const changelog = readJson('changelog.json');
const fishPkg = readJson('fish/package.json');

const version = String(pkg.version ?? '');
const tag = `v${version}`;
const engineVersion = String(fishPkg.version ?? '');
const entry = Array.isArray(changelog) ? changelog.find((x) => x && x.version === version) : null;
const dshRange = String(pkg.engines?.dsh ?? '>=0.2.1');

const lines = [];
lines.push(`# my fish ${version}`);
lines.push('');
lines.push('一个 DeepSeek Harness（DSH）插件：**鱼的引擎 + 一体化面板**装在同一个 bundle 里，profile 里只装这一个插件。');
lines.push('人格、按人长期记忆、QQ / B站 / 抖音 私信、语音、日记与备份，都由面板统一调节。');
lines.push('');
lines.push('## 这一版改了什么');
lines.push('');
if (entry && Array.isArray(entry.items) && entry.items.length > 0) {
  for (const item of entry.items) lines.push(`- ${item}`);
} else {
  lines.push('- 本次发布没有单独的更新说明，详见仓库提交记录。');
}
lines.push('');
lines.push('## 环境要求');
lines.push('');
lines.push('| 想用的能力 | 需要准备 |');
lines.push('|---|---|');
lines.push(`| 插件跑起来（面板 / 记忆 / 人格 / 日记 / 备份） | DeepSeek Harness 桌面版 \`${dshRange}\`，且已在 DSH 里配置可用的聊天模型 |`);
lines.push('| **QQ** 聊天 | SnowLuma（OneBot 11 网关）+ 一个 QQ 号；默认目录 `%USERPROFILE%\\SnowLuma` |');
lines.push('| **B站** 私信 / 刷视频 | 无需额外软件，面板内扫码登录 |');
lines.push('| **抖音** 私信 / 刷视频 | Edge 或 Chrome 浏览器 + 抖音账号 |');
lines.push('| 语音（可选） | 一个 OpenAI 兼容的 TTS/STT 服务；可选本机语音桥（8766） |');
lines.push('| 视频抽帧（可选） | ffmpeg 加入 PATH |');
lines.push('');
lines.push('> 完整清单（端口、目录、覆盖方式、常见问题）见附件 **PREREQUISITES.md**，也在 `my-fish-' + version + '-env-and-guide.zip` 里。');
lines.push('> 不想装 SnowLuma / 抖音也行：对应通道关掉，B站、记忆、人格、日记照常工作。');
lines.push('');
lines.push('## 安装 / 升级');
lines.push('');
lines.push('**方式 A：直接装这个 Release 的预构建包**');
lines.push('');
lines.push('```sh');
lines.push(`dsh plugin --profile <你的 profile> add https://github.com/linkl-ike/my-fish/releases/download/${tag}/my-fish-${version}.tgz`);
lines.push('```');
lines.push('');
lines.push('**方式 B：从仓库装最新 main**');
lines.push('');
lines.push('```sh');
lines.push('dsh plugin --profile <你的 profile> add git+https://github.com/linkl-ike/my-fish.git');
lines.push('```');
lines.push('');
lines.push('装完之后：重启 DSH（或按提示刷新页面）→ 侧边栏出现 **my fish** →');
lines.push('「总览」看自检横幅 →「通道 → 登录 / 连接」登录 QQ / B站 / 抖音 →「服务 / 归档」看版本与更新日志。');
lines.push('');
lines.push('## 一键环境自检（Windows，可选）');
lines.push('');
lines.push('解压 `my-fish-' + version + '-env-and-guide.zip`，在里面运行：');
lines.push('');
lines.push('```powershell');
lines.push('powershell -ExecutionPolicy Bypass -File tools/check-env.ps1');
lines.push('```');
lines.push('');
lines.push('它会只读检查系统 / DSH / Node / SnowLuma / 浏览器 / 语音桥 / ffmpeg / 数据目录等 20 项，输出 PASS / WARN / FAIL。');
lines.push('');
lines.push('## 附件说明');
lines.push('');
lines.push('| 文件 | 内容 |');
lines.push('|---|---|');
lines.push(`| \`my-fish-${version}.tgz\` | 插件本体（npm 包，\`dsh plugin add\` 用） |`);
lines.push(`| \`my-fish-${version}-env-and-guide.zip\` | 环境清单 \`PREREQUISITES.md\` + 安装指南 \`INSTALL.md\` + 一键自检 \`tools/check-env.ps1\` + \`README.md\` |`);
lines.push('');
lines.push('## 版本');
lines.push('');
lines.push(`- 插件 ${version} · 鱼引擎 ${engineVersion} · DSH ${dshRange}`);
lines.push(`- 数据位置：\`~/.dsh/fish-soul/\`（记忆 / 聊天归档 / 人格），升级与重装都不会动；插件包本身不含任何用户数据。`);
lines.push('');

process.stdout.write(lines.join('\n'));

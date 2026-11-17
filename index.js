/**
 * my-fish —— 融合面板：状态 + 调节 + 服务控制（v0.2）
 *
 * Host 半职责：
 *   1. GET  /api/plugins/my-fish/state    只读汇总（鱼 / SurfCore 归档 / 服务 / 记忆）
 *   2. POST /api/plugins/my-fish/service  本地服务控制（SnowLuma / 语音桥 / 看门狗 / 打开目录）
 *   3. POST /api/plugins/my-fish/migrate  SurfCore → 鱼 的记忆迁移（预览 / 执行）
 *
 * 一切"调节"仍然走 fish-soul 自己的接口（浏览器同源直连 /api/plugins/fish-soul/*），
 * Host 半只做浏览器做不到的事：读文件、读只读 SQLite、探端口、起服务。
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import https from 'node:https';
import { execFile, spawn } from 'node:child_process';

export const inject = ['webServer'];

const API_PREFIX = '/api/plugins/my-fish';

/**
 * 可配置路径（v0.3）：默认值只为这台机器服务，别的机器/目录布局请通过
 * cordis.patch.yml 里这一行的 config 覆盖，或设对应环境变量。
 *
 *   config:
 *     snowlumaDir: 'D:\\SnowLuma'
 *     shimDir: '/path/to/fish-tts-shim'
 *     fishHome: '/path/to/.dsh'      # 鱼的 $DSH_HOME（默认取 DSH_HOME 或 ~/.dsh）
 *     surfcoreData: '/path/to/.dsh/surfcore'
 *     surfcoreRoot: '/path/to/surfcore'   # 不填则从 surfcore 的 config.json 里读 qqbotRoot
 *     patches: '/path/to/fish-soul-patches'
 */
const DEFAULT_PATHS = {
  snowlumaDir: process.env.FUSION_SNOWLUMA_DIR || join(homedir(), 'SnowLuma'),
  shimDir: process.env.FUSION_SHIM_DIR || join(homedir(), 'fish-tts-shim'),
  patches: process.env.FUSION_PATCHES_DIR || join(homedir(), 'fish-soul-patches'),
};

function readJsonVersion(file) {
  try { return String(JSON.parse(readFileSync(file, 'utf8')).version ?? ""); } catch { return ""; }
}
function readOwnVersion() {
  return readJsonVersion(new URL('./package.json', import.meta.url));
}
function readEngineVersion() {
  return readJsonVersion(new URL('./fish/package.json', import.meta.url));
}

const UPDATE_TTL = 10 * 60 * 1000;
let UPDATE_CACHE = { at: 0, data: null };

function versionTuple(v) {
  const m = String(v ?? '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareVersions(a, b) {
  const x = versionTuple(a);
  const y = versionTuple(b);
  if (x === null || y === null) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  }
  return 0;
}

function isCertError(error) {
  const message = String(error?.code || error?.message || error);
  return /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS|DEPTH_ZERO|ISSUER|wrong version number/i.test(message);
}

/** 发一个 HTTPS 请求，返回 { status, headers, body }（不抛 4xx/5xx，便于降级）。 */
function httpsFetchRaw(url, { insecure = false, timeoutMs = 6000, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      headers: { 'user-agent': 'my-fish-update-check', accept: 'application/vnd.github+json, text/html, application/atom+xml' },
      timeout: timeoutMs,
      rejectUnauthorized: !insecure,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { if (body.length < 400000) body += chunk; });
      res.on('end', () => resolve({ status: Number(res.statusCode ?? 0), headers: res.headers, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

/** 先正常校验证书；证书类错误时降级重试一次（本地反代会替换 GitHub 证书）。 */
async function httpsFetch(url, options = {}) {
  try {
    return await httpsFetchRaw(url, options);
  } catch (error) {
    if (isCertError(error)) return httpsFetchRaw(url, { ...options, insecure: true });
    throw error;
  }
}

function tagFromLocation(location) {
  const m = String(location ?? '').match(/\/releases\/tag\/(v\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i);
  return m ? m[1] : '';
}

function tagFromAtom(body) {
  const entries = String(body ?? '').match(/<entry>[\s\S]*?<\/entry>/g) || [];
  const first = entries[0] ?? '';
  const m = first.match(/\/releases\/tag\/(v\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i);
  return m ? m[1] : '';
}

/**
 * 更新检查：读 GitHub 最新 Release，和本插件 package.json 版本比较。
 *
 * 顺序：GitHub API → releases/latest 的 302 Location → releases.atom。
 * 未登录的 GitHub API 有 IP 级限流（403），所以必须带后两条兜底。
 * 结果缓存 10 分钟；点「检查更新」或刷新页面才重新请求。
 */
async function checkUpdate(force = false) {
  const current = readOwnVersion();
  if (!force && UPDATE_CACHE.data !== null && Date.now() - UPDATE_CACHE.at < UPDATE_TTL) {
    return { ...UPDATE_CACHE.data, cached: true };
  }

  const repo = 'https://github.com/linkl-ike/my-fish';
  let latest = '';
  let tag = '';
  let link = '';
  let notes = '';
  let publishedAt = null;
  let source = '';
  const errors = [];

  // 1) GitHub API
  try {
    const res = await httpsFetch(`https://api.github.com/repos/linkl-ike/my-fish/releases/latest`);
    if (res.status === 200) {
      const release = JSON.parse(res.body);
      tag = String(release.tag_name ?? '');
      latest = tag.replace(/^v/i, '');
      link = String(release.html_url ?? '');
      notes = String(release.body ?? '').slice(0, 1200);
      publishedAt = release.published_at ?? null;
      source = 'github-api';
    } else {
      errors.push(`api HTTP ${res.status}`);
    }
  } catch (error) {
    errors.push(`api ${String(error?.code || error?.message || error)}`);
  }

  // 2) releases/latest 的 302 跳转（没有 API 限流）
  if (latest === '') {
    try {
      const res = await httpsFetch(`${repo}/releases/latest`, { timeoutMs: 8000, method: 'GET' });
      const loc = res.headers?.location ?? '';
      const found = tagFromLocation(loc) || tagFromLocation(res.body);
      if (found !== '') {
        tag = found;
        latest = tag.replace(/^v/i, '');
        link = `${repo}/releases/tag/${tag}`;
        source = 'github-redirect';
      } else {
        errors.push(`redirect HTTP ${res.status}`);
      }
    } catch (error) {
      errors.push(`redirect ${String(error?.code || error?.message || error)}`);
    }
  }

  // 3) releases.atom
  if (latest === '') {
    try {
      const res = await httpsFetch(`${repo}/releases.atom`, { timeoutMs: 8000 });
      const found = tagFromAtom(res.body);
      if (res.status === 200 && found !== '') {
        tag = found;
        latest = tag.replace(/^v/i, '');
        link = `${repo}/releases/tag/${tag}`;
        source = 'github-atom';
      } else {
        errors.push(`atom HTTP ${res.status}`);
      }
    } catch (error) {
      errors.push(`atom ${String(error?.code || error?.message || error)}`);
    }
  }

  const hasUpdate = latest !== '' && compareVersions(latest, current) > 0;
  const data = {
    ok: true,
    current,
    latest,
    tag,
    hasUpdate,
    url: link,
    notes,
    publishedAt,
    checkedAt: Date.now(),
    source,
    error: latest === '' ? errors.join('；').slice(0, 240) : '',
  };
  UPDATE_CACHE = { at: Date.now(), data };
  return data;
}

function dshHome() {
  const v = process.env.DSH_HOME;
  return v && String(v).trim() !== '' ? String(v).trim() : join(homedir(), '.dsh');
}

function pathOr(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

/** 解析这一行插件 config → 实际使用的路径表。 */
function resolvePaths(config = {}) {
  const home = pathOr(config.fishHome, dshHome());
  return {
    fishHome: home,
    snowlumaDir: pathOr(config.snowlumaDir, DEFAULT_PATHS.snowlumaDir),
    shimDir: pathOr(config.shimDir, DEFAULT_PATHS.shimDir),
    surfcoreData: pathOr(config.surfcoreData, join(home, 'surfcore')),
    surfcoreRoot: pathOr(config.surfcoreRoot, ''),
    patches: pathOr(config.patches, DEFAULT_PATHS.patches),
  };
}

/** apply() 里按当前插件 config 覆盖；请求处理只读这里。 */
let PATHS = resolvePaths({});

/** v2.0：鱼引擎（fish-core）已经内置在 ./fish，这里记录它有没有装起来。 */
let ENGINE_STATUS = { embedded: false, loading: true, error: "", path: "./fish/lib/index.js" };

function readJson(file) {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readText(file) {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8') : '';
  } catch {
    return '';
  }
}

function mtime(file) {
  try {
    return existsSync(file) ? statSync(file).mtimeMs : 0;
  } catch {
    return 0;
  }
}

function portOpen(port, timeoutMs = 400) {
  return new Promise((resolve) => {
    let done = false;
    const socket = net.connect({ host: '127.0.0.1', port });
    const finish = (ok) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(ok);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
}

// node:sqlite 在 Node 22.5+ 才带；缺失时整份面板降级为文件统计。
let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = null;
}

/** 只看不做：打开 SQLite 读几个统计，然后关掉。 */
function withDb(fn) {
  if (DatabaseSync === null) return null;
  const file = join(PATHS.fishHome, 'fish-soul', 'soul.db');
  if (!existsSync(file)) return null;
  let db = null;
  try {
    db = new DatabaseSync(file);
    return fn(db);
  } catch (error) {
    return { error: String(error instanceof Error ? error.message : error) };
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

function findFishVersion() {
  const profiles = join(PATHS.fishHome, 'profiles');
  try {
    for (const name of readdirSync(profiles)) {
      const pkg = readJson(join(profiles, name, 'node_modules', 'dsh-fish-soul', 'package.json'));
      if (pkg?.version) return String(pkg.version);
    }
  } catch { /* ignore */ }
  return '';
}

function findSurfCharacterDir() {
  const root = join(PATHS.surfcoreData, 'characters');
  try {
    for (const name of readdirSync(root)) {
      const dir = join(root, name);
      if (existsSync(join(dir, 'memory', 'memory-card.json'))) return dir;
    }
  } catch { /* ignore */ }
  return '';
}

function collectFish() {
  const home = PATHS.fishHome;
  const cfg = readJson(join(home, 'fish-soul-config.json')) ?? {};
  const persona = readJson(join(home, 'fish-soul', 'persona.json')) ?? {};
  const out = {
    version: findFishVersion(),
    personaName: String(persona.name ?? persona?.data?.name ?? ''),
    qq: { enabled: cfg.qq?.enabled === true, privateAllow: (cfg.qq?.privateAllowList ?? []).length, groups: (cfg.qq?.groupAllowList ?? []).length },
    douyin: { enabled: cfg.douyin?.enabled === true, autoReply: cfg.douyin?.autoReply === true, masterUid: String(cfg.douyin?.masterUid ?? '') },
    bili: { enabled: cfg.bili?.enabled === true, loggedIn: false },
    voice: {
      enabled: cfg.voice?.enabled === true,
      provider: String(cfg.voice?.ttsProvider ?? ''),
      voiceId: String(cfg.voice?.ttsVoice ?? ''),
      speak: String(cfg.voice?.speak ?? ''),
    },
    web: { enabled: cfg.tools?.web?.enabled === true, provider: String(cfg.tools?.web?.provider ?? '') },
    chatModels: cfg.chatModels ?? null,
    db: null,
  };
  out.db = withDb((db) => {
    const byChannel = db.prepare(`SELECT channel, status, COUNT(*) AS n FROM memory GROUP BY channel, status ORDER BY channel`).all();
    const personas = db.prepare(`SELECT canonical_id, qq_uin, douyin_uid, display_name, relation_stage FROM person ORDER BY canonical_id`).all();
    const total = db.prepare(`SELECT COUNT(*) AS n FROM memory WHERE status = 'active'`).get();
    const latest = db.prepare(`SELECT MAX(created_at) AS at FROM memory`).get();
    const selfBili = db.prepare(`SELECT COUNT(*) AS n FROM memory WHERE owner_id = 'self' AND channel = 'bili' AND status = 'active'`).get();
    const recentBili = db.prepare(`SELECT content FROM memory WHERE channel = 'bili' AND status = 'active' ORDER BY id DESC LIMIT 3`).all();
    const recent = db.prepare(`SELECT id, owner_id, channel, kind, content, created_at FROM memory WHERE status = 'active' ORDER BY id DESC LIMIT 20`).all();
    const sessions = db.prepare(`SELECT channel, channel_id, title, status FROM chat_session ORDER BY id DESC LIMIT 5`).all();
    return {
      total: Number(total?.n ?? 0),
      latestAt: Number(latest?.at ?? 0),
      selfBili: Number(selfBili?.n ?? 0),
      byChannel: byChannel.map((r) => ({ channel: String(r.channel), status: String(r.status), n: Number(r.n) })),
      personas: personas.map((r) => ({
        id: String(r.canonical_id),
        qq: r.qq_uin == null ? '' : String(r.qq_uin),
        douyin: r.douyin_uid == null ? '' : String(r.douyin_uid),
        name: String(r.display_name ?? ''),
        stage: String(r.relation_stage ?? ''),
      })),
      recentBili: recentBili.map((r) => String(r.content ?? '').slice(0, 90)),
      recent: recent.map((r) => ({
        id: Number(r.id),
        owner: String(r.owner_id ?? ''),
        channel: String(r.channel ?? ''),
        kind: String(r.kind ?? ''),
        content: String(r.content ?? '').slice(0, 140),
        at: Number(r.created_at ?? 0),
      })),
      sessions: sessions.map((r) => ({ channel: String(r.channel), id: String(r.channel_id), title: String(r.title ?? ''), status: String(r.status ?? '') })),
    };
  });
  return out;
}

function collectSurfCore() {
  const stateCfg = readJson(join(PATHS.surfcoreData, 'config.json')) ?? {};
  const qqbotRoot = PATHS.surfcoreRoot || String(stateCfg.qqbotRoot ?? '');
  const repoCfg = qqbotRoot ? (readJson(join(qqbotRoot, 'config.json')) ?? {}) : {};
  const charDir = findSurfCharacterDir();
  const out = {
    installed: charDir !== '',
    qqbotRoot,
    version: qqbotRoot ? String(readJson(join(qqbotRoot, 'package.json'))?.version ?? '') : '',
    platforms: stateCfg.platforms?.start ?? null,
    bridgeQqClient: repoCfg.bridge?.qqClient !== false,
    archive: null,
  };
  if (!charDir) return out;
  const cardFile = join(charDir, 'memory', 'memory-card.json');
  const card = readJson(cardFile) ?? {};
  const records = Array.isArray(card.records) ? card.records : [];
  const scope = { qq: 0, bili: 0, other: 0 };
  let latest = '';
  for (const r of records) {
    const s = String(r.scope ?? 'other');
    if (s === 'qq') scope.qq += 1;
    else if (s === 'bili') scope.bili += 1;
    else scope.other += 1;
    const at = String(r.createdAt ?? '');
    if (at > latest) latest = at;
  }
  const biliMem = readJson(join(charDir, 'bili', 'bili-memory.json')) ?? {};
  const watchLines = readText(join(charDir, 'bili', 'watch-history.jsonl')).split('\n').filter(Boolean);
  let watchLatest = '';
  for (const line of watchLines) {
    try { const w = JSON.parse(line); if (String(w.at ?? '') > watchLatest) watchLatest = String(w.at ?? ''); } catch { /* ignore */ }
  }
  const diary = readText(join(charDir, 'bili', 'whale-diary.md'));
  const diaryHeads = [...diary.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
  out.archive = {
    cardRecords: records.length,
    cardByScope: scope,
    cardLatest: latest,
    cardUpdatedAt: mtime(cardFile),
    biliMemoryEntries: Array.isArray(biliMem.entries) ? biliMem.entries.length : 0,
    biliMemoryUpdatedAt: mtime(join(charDir, 'bili', 'bili-memory.json')),
    watchCount: watchLines.length,
    watchLatest,
    diarySections: diaryHeads.length,
    diaryLast: diaryHeads.slice(-2).reverse(),
    lastActiveAt: Math.max(
      mtime(join(charDir, 'memory', 'memory-inbox.jsonl')),
      mtime(join(charDir, 'bili', 'whale-log.jsonl')),
      mtime(join(charDir, 'memory', 'memory-card.json')),
    ),
    charDir,
  };
  return out;
}

async function collectServices() {
  const [snowHttp, snowWs, surfConsole, tts] = await Promise.all([
    portOpen(3000), portOpen(3001), portOpen(3100), portOpen(8766),
  ]);
  let ttsHealth = null;
  if (tts) {
    try {
      const res = await fetch('http://127.0.0.1:8766/health', { signal: AbortSignal.timeout(900) });
      ttsHealth = await res.json().catch(() => null);
    } catch { ttsHealth = null; }
  }
  const home = PATHS.fishHome;
  return {
    snowluma: { http: snowHttp, ws: snowWs },
    surfcoreConsole: { up: surfConsole, expectedDown: true },
    voiceBridge: { up: tts, health: ttsHealth },
    watchdogPaused: existsSync(join(PATHS.snowlumaDir, 'watchdog.pause')),
  };
}

async function collect() {
  const fish = collectFish();
  const surfcore = collectSurfCore();
  const services = await collectServices();
  const warnings = [];
  if (!ENGINE_STATUS.embedded && ENGINE_STATUS.loading !== true) warnings.push('鱼引擎没有内嵌加载成功：' + (ENGINE_STATUS.error || '未知错误'));
  if (services.surfcoreConsole.up) warnings.push('双引擎风险：SurfCore 桥接(3100) 又在运行，会跟鱼抢 QQ');
  if (!services.snowluma.http || !services.snowluma.ws) warnings.push('SnowLuma 3000/3001 没在监听，鱼连不上 QQ');
  if (!services.voiceBridge.up) warnings.push('语音桥 8766 没在跑，她发不了语音');
  if (fish?.qq?.enabled !== true) warnings.push('鱼的 QQ 通道是关的');
  return {
    ok: true,
    at: Date.now(),
    version: readOwnVersion(),
    engineVersion: readEngineVersion(),
    engine: ENGINE_STATUS,
    fish,
    surfcore,
    services,
    paths: {
      fishDb: join(PATHS.fishHome, 'fish-soul', 'soul.db'),
      fishConfig: join(PATHS.fishHome, 'fish-soul-config.json'),
      fishHome: PATHS.fishHome,
      surfcoreData: PATHS.surfcoreData,
      surfcoreRoot: surfcore.qqbotRoot,
      snowlumaDir: PATHS.snowlumaDir,
      shimDir: PATHS.shimDir,
      patches: PATHS.patches,
    },
    warnings,
  };
}

// ── 本地服务控制 ──────────────────────────────────────────────────────────

function execFileP(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 30000, ...options }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error && typeof error.code === 'number' ? error.code : error ? -1 : 0,
        stdout: String(stdout ?? '').slice(0, 4000),
        stderr: String(stderr ?? '').slice(0, 2000),
      });
    });
  });
}

function spawnDetached(file, args) {
  try {
    const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return { ok: true, pid: child.pid ?? 0 };
  } catch (error) {
    return { ok: false, error: String(error instanceof Error ? error.message : error) };
  }
}

function snowlumaWebuiInfo() {
  const runtime = readJson(join(PATHS.snowlumaDir, 'config', 'runtime.json')) ?? {};
  const port = Number(runtime.webuiPort) > 0 ? Number(runtime.webuiPort) : 5099;
  return { port, url: `http://127.0.0.1:${port}/` };
}

const SERVICE_ACTIONS = {
  'start-snowluma': () => spawnDetached('wscript.exe', [join(PATHS.snowlumaDir, 'start-hidden.vbs')]),
  'open-snowluma': async () => {
    const info = snowlumaWebuiInfo();
    if (!existsSync(PATHS.snowlumaDir)) return { ok: false, error: '找不到 SnowLuma 目录：' + PATHS.snowlumaDir };
    const reachable = await portOpen(info.port, 600);
    if (!reachable) {
      spawnDetached('wscript.exe', [join(PATHS.snowlumaDir, 'start-hidden.vbs')]);
      for (let i = 0; i < 24; i += 1) {
        await new Promise((r) => setTimeout(r, 500));
        if (await portOpen(info.port, 300)) break;
      }
    }
    spawnDetached('cmd.exe', ['/c', 'start', '', info.url]);
    return { ok: true, url: info.url, started: !reachable };
  },
  'restart-snowluma': async () => {
    const kill = await execFileP('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*SnowLuma*index.mjs*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"]);
    const started = spawnDetached('wscript.exe', [join(PATHS.snowlumaDir, 'start-hidden.vbs')]);
    return { ok: killedOrStarted(kill, started), kill, start: started };
  },
  'start-voice-shim': () => spawnDetached('wscript.exe', [join(PATHS.shimDir, 'start-hidden.vbs')]),
  'watchdog-pause': () => { writeFileSync(join(PATHS.snowlumaDir, 'watchdog.pause'), '', 'utf8'); return { ok: true }; },
  'watchdog-resume': () => { try { rmSync(join(PATHS.snowlumaDir, 'watchdog.pause'), { force: true }); } catch { /* ignore */ } return { ok: true }; },
  'open-surfcore-data': () => spawnDetached('explorer.exe', [PATHS.surfcoreData]),
  'open-logs': () => spawnDetached('explorer.exe', [PATHS.snowlumaDir]),
};

function killedOrStarted(kill, started) {
  // 进程可能本来就不在（powershell 返回非 0 是正常的），以"启动请求成功"为准
  return started?.ok === true || kill?.ok === true;
}

// ── SurfCore → 鱼 记忆迁移（Host 内直接读文件 + 调鱼的导入接口）───────────

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) : t; };

function buildMigrationItems() {
  const charDir = findSurfCharacterDir();
  const items = [];
  const stats = { memoryCard: 0, biliMemory: 0, brief: 0, diary: 0, watch: 0 };
  if (!charDir) return { items, stats, error: '找不到 SurfCore 角色目录' };

  const card = readJson(join(charDir, 'memory', 'memory-card.json')) ?? {};
  for (const r of card.records ?? []) {
    const text = String(r.text ?? '').trim() || String(r.title ?? '').trim();
    if (text === '') continue;
    const scope = String(r.scope ?? 'qq');
    const isBili = scope === 'bili';
    const kindMap = { firstMeet: 'fact', owner: 'fact', event: 'event', promise: 'fact' };
    items.push({
      content: clip(text, 300),
      kind: kindMap[String(r.kind)] ?? 'fact',
      ownerId: isBili ? 'self' : 'user:master',
      channel: isBili ? 'bili' : 'qq',
      channelId: String(r.conversationKey ?? ''),
      createdAt: r.createdAt,
      importance: Math.max(1, Math.min(5, Math.round((Number(r.importance) || 30) / 20))),
      emotion: Math.max(-2, Math.min(2, Math.round(Number(r.emotional) || 0))),
    });
    stats.memoryCard += 1;
  }

  const seenBvid = new Set();
  const bm = readJson(join(charDir, 'bili', 'bili-memory.json')) ?? {};
  for (const e of bm.entries ?? []) {
    const title = clip(e.title, 80);
    const body = clip(e.text || e.reason || e.quote, 200);
    const content = e.type === 'video'
      ? `我在B站看过${title ? `《${title}》` : '一个视频'}：${body || '（没有写感想）'}`
      : body;
    if (!content) continue;
    if (e.bvid) seenBvid.add(String(e.bvid));
    items.push({
      content: clip(content, 300),
      kind: e.type === 'thought' ? 'feeling' : 'event',
      ownerId: 'self',
      channel: 'bili',
      channelId: e.id ? `bili:${e.id}` : 'bili:memory',
      createdAt: e.at || (e.date ? `${e.date}T12:00:00.000Z` : undefined),
      importance: e.type === 'video' ? (Number(e.score) >= 15 ? 3 : 2) : 2,
      emotion: e.favorite ? 1 : 0,
    });
    stats.biliMemory += 1;
  }

  const brief = readText(join(charDir, 'bili', 'bili-memory-brief.md'));
  if (brief.trim() !== '') {
    items.push({
      content: clip(`我的B站身份与口味（来自我自己的B站记忆）：${brief}`, 900),
      kind: 'fact', ownerId: 'self', channel: 'bili', channelId: 'bili:identity', importance: 4, emotion: 0,
    });
    stats.brief = 1;
  }

  const diary = readText(join(charDir, 'bili', 'whale-diary.md'));
  for (const part of diary.split(/^## /m).slice(1)) {
    const lines = part.split('\n');
    const head = lines[0].trim();
    const body = clip(lines.slice(1).join(' '), 700);
    if (!body) continue;
    items.push({
      content: clip(`B站日记（${head}）：${body}`, 800),
      kind: 'event', ownerId: 'self', channel: 'bili',
      channelId: `bili:diary:${clip(head, 30)}`, importance: 3, emotion: 0,
    });
    stats.diary += 1;
  }

  for (const line of readText(join(charDir, 'bili', 'watch-history.jsonl')).split('\n').filter(Boolean)) {
    let w; try { w = JSON.parse(line); } catch { continue; }
    if (!w.title) continue;
    if (w.bvid && seenBvid.has(String(w.bvid))) continue;
    items.push({
      content: clip(`我在B站看过《${clip(w.title, 70)}》${w.up ? `（UP：${clip(w.up, 30)}）` : ''}`, 160),
      kind: 'event', ownerId: 'self', channel: 'bili',
      channelId: w.bvid ? `bili:video:${w.bvid}` : 'bili:watch',
      createdAt: w.at, importance: 2, emotion: 0,
    });
    stats.watch += 1;
  }

  return { items, stats };
}

async function runMigration(port, dryRun) {
  const { items, stats, error } = buildMigrationItems();
  if (error) return { ok: false, error };
  if (items.length === 0) return { ok: true, stats, total: 0, inserted: 0, duplicates: 0, dryRun };
  const base = `http://127.0.0.1:${port}`;
  const res = await fetch(`${base}/api/plugins/fish-soul/import/memories`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ items, dryRun }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let report = null;
  try { report = JSON.parse(text); } catch { /* keep raw */ }
  if (!res.ok || report?.ok !== true) return { ok: false, status: res.status, error: report?.error || text.slice(0, 300), stats };
  return { ok: true, stats, ...report, dryRun };
}

// ── SurfCore 归档浏览（只读）────────────────────────────────────────────
function archiveData() {
  const charDir = findSurfCharacterDir();
  if (!charDir) return null;
  const card = readJson(join(charDir, 'memory', 'memory-card.json')) ?? {};
  const records = Array.isArray(card.records) ? card.records : [];
  const bm = readJson(join(charDir, 'bili', 'bili-memory.json')) ?? {};
  const biliEntries = Array.isArray(bm.entries) ? bm.entries : [];
  const watch = readText(join(charDir, 'bili', 'watch-history.jsonl')).split('\n').filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter((x) => x && typeof x === 'object');
  const diaryText = readText(join(charDir, 'bili', 'whale-diary.md'));
  const diarySections = [];
  for (const chunk of diaryText.split(/^## /m).slice(1)) {
    const lines = chunk.split('\n');
    const title = String(lines[0] ?? '').trim();
    const body = lines.slice(1).join('\n').trim();
    if (title !== '' || body !== '') diarySections.push({ title, body });
  }
  return { records, biliEntries, watch, diarySections };
}

function readArchive(kind, q = '') {
  const data = archiveData();
  if (data === null) return { ok: false, error: '找不到 SurfCore 角色目录' };
  const counts = {
    cards: data.records.length,
    bili: data.biliEntries.length,
    diary: data.diarySections.length,
    watch: data.watch.length,
  };
  const needle = q.trim().toLowerCase();
  const hit = (s) => needle === '' || String(s ?? '').toLowerCase().includes(needle);
  let items = [];
  if (kind === 'cards') {
    items = data.records
      .map((r) => ({
        at: r.createdAt, scope: r.scope, source: r.source, kind: r.kind,
        title: String(r.title ?? ''), text: String(r.text ?? ''),
        importance: r.importance, emotional: r.emotional, key: r.conversationKey,
      }))
      .filter((r) => hit(r.title) || hit(r.text));
  } else if (kind === 'bili') {
    items = data.biliEntries
      .map((e) => ({
        type: e.type, date: e.date, at: e.at, title: String(e.title ?? ''),
        text: String(e.text ?? e.reason ?? ''), score: e.score, favorite: e.favorite, bvid: e.bvid,
      }))
      .filter((e) => hit(e.title) || hit(e.text));
  } else if (kind === 'diary') {
    items = data.diarySections
      .map((s) => ({ title: s.title, body: s.body }))
      .filter((s) => hit(s.title) || hit(s.body));
  } else if (kind === 'watch') {
    items = data.watch
      .map((w) => ({ at: w.at, title: String(w.title ?? ''), up: String(w.up ?? ''), bvid: w.bvid, duration: w.duration, score: w.score, favorite: w.favorite }))
      .filter((w) => hit(w.title) || hit(w.up));
  } else {
    return { ok: false, error: `未知归档类型：${kind}` };
  }
  return { ok: true, counts, items };
}

// ── HTTP ────────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1024 * 1024) { req.destroy(); resolve(''); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(''));
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function apply(ctx, config = {}) {
  // 每次激活都按这一行的 config 重新解析路径（cordis.patch.yml 里可覆盖）。
  PATHS = resolvePaths(config ?? {});

  const handler = async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const path = url.pathname.replace(API_PREFIX, '') || '/';

      if (req.method === 'GET' && (path === '/' || path === '/state')) {
        sendJson(res, 200, await collect());
        return;
      }

      if (req.method === 'GET' && path === '/update') {
        const force = url.searchParams.get('refresh') === '1';
        sendJson(res, 200, await checkUpdate(force));
        return;
      }

      if (req.method === 'GET' && path === '/archive') {
        const kind = String(url.searchParams.get('kind') ?? 'cards');
        const q = String(url.searchParams.get('q') ?? '');
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50));
        const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0) || 0);
        const r = readArchive(kind, q);
        if (!r.ok) { sendJson(res, 200, r); return; }
        sendJson(res, 200, { ok: true, kind, total: r.items.length, offset, limit, counts: r.counts, items: r.items.slice(offset, offset + limit) });
        return;
      }

      if (req.method === 'POST' && path === '/service') {
        const body = JSON.parse((await readBody(req)) || '{}');
        const action = String(body.action ?? '');
        const fn = SERVICE_ACTIONS[action];
        if (!fn) { sendJson(res, 200, { ok: false, error: `未知操作：${action || '(空)'}` }); return; }
        const result = await fn();
        sendJson(res, 200, { ok: result?.ok === true, action, detail: result ?? null });
        return;
      }

      if (req.method === 'POST' && path === '/migrate') {
        const body = JSON.parse((await readBody(req)) || '{}');
        // 端口优先从请求的 Host 头推断（页面在 dsh-app:// 里，location.port 是空的），
        // 推断不出来才用调用方传的 port。
        const hostPort = Number(String(req.headers?.host ?? '').split(':').pop());
        const port = Number.isInteger(hostPort) && hostPort > 0 ? hostPort : Number(body.port);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          sendJson(res, 200, { ok: false, error: 'port 不合法' });
          return;
        }
        const result = await runMigration(port, body.dryRun === true);
        sendJson(res, 200, result);
        return;
      }

      sendJson(res, 404, { ok: false, error: 'not found' });
    } catch (error) {
      sendJson(res, 200, { ok: false, error: String(error instanceof Error ? error.message : error) });
    }
  };
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler }),
    'my-fish: api',
  );

  // ── v2.0：鱼引擎（fish-core）作为子插件装进本插件 ────────────────────────
  // 路由先同步挂好（面板接口立即可用），鱼再异步启动；import/ctx.plugin 都包在
  // try/catch 里，鱼起不来时面板照常工作，/state 的 engine.error 给出原因。
  void (async () => {
    try {
      const fishEntry = new URL(ENGINE_STATUS.path, import.meta.url).href;
      const fishPlugin = await import(fishEntry);
      ctx.plugin(fishPlugin);
      ENGINE_STATUS = { embedded: true, loading: false, error: "", path: ENGINE_STATUS.path };
      ctx.logger?.info?.('[my-fish] 鱼引擎已内嵌加载（fish-core 随本插件启动）');
    } catch (error) {
      ENGINE_STATUS = {
        embedded: false,
        loading: false,
        error: String(error instanceof Error ? (error.stack ?? error.message) : error),
        path: ENGINE_STATUS.path,
      };
      ctx.logger?.error?.('[my-fish] 鱼引擎加载失败：' + ENGINE_STATUS.error);
    }
  })();
}

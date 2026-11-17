// 离线验证 my-fish v0.3 的 Host 半：/state、/service、/migrate（dryRun）、config 路径覆盖。
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const mod = await import(new URL('../index.js', import.meta.url).href);
const PORT = Number(process.env.FISH_PORT || 55536);

let registered = null;
const ctx = {
  effect: (fn) => { const d = fn(); return () => d?.(); },
  webServer: { register: (opts) => { registered = opts; return () => {}; } },
  plugin: () => {},
  logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} },
};
mod.apply(ctx, {});
console.log('route:', registered?.path);

function call(method, path, body) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.url = `/api/plugins/my-fish${path}`;
    req.method = method;
    req.headers = { host: `127.0.0.1:${PORT}` };
    req.destroy = () => {};
    const res = {
      statusCode: 0,
      body: '',
      writeHead(code) { this.statusCode = code; },
      end(b) { this.body = String(b ?? ''); resolve({ status: this.statusCode, text: this.body }); },
    };
    registered.handler(req, res).catch((e) => resolve({ status: 0, text: String(e) }));
    if (method === 'POST') setImmediate(() => {
      if (body !== undefined) req.emit('data', Buffer.from(JSON.stringify(body)));
      req.emit('end');
    });
  });
}

const parse = (r) => { try { return JSON.parse(r.text); } catch { return { raw: r.text.slice(0, 200) }; } };

const state = parse(await call('GET', '/state'));
console.log('state ok:', state.ok, '| warnings:', (state.warnings || []).length);
console.log('paths:', JSON.stringify(state.paths));
console.log('services:', JSON.stringify({ snow: state.services.snowluma, voice: state.services.voiceBridge.up, paused: state.services.watchdogPaused, surf: state.services.surfcoreConsole.up }));
console.log('recent memories:', state.fish?.db?.recent?.length, '| sessions:', state.fish?.db?.sessions?.length);

const bad = parse(await call('POST', '/service', { action: 'nope' }));
console.log('unknown service ->', JSON.stringify(bad));

const pause = parse(await call('POST', '/service', { action: 'watchdog-pause' }));
const pausedFile = join(homedir(), 'SnowLuma', 'watchdog.pause');
console.log('pause ->', pause.ok, '| file exists:', existsSync(pausedFile));
const resume = parse(await call('POST', '/service', { action: 'watchdog-resume' }));
console.log('resume ->', resume.ok, '| file exists:', existsSync(pausedFile));

const mig = parse(await call('POST', '/migrate', { dryRun: true }));
console.log('migrate dryRun（Host 头推端口）->', JSON.stringify({ ok: mig.ok, total: mig.total, inserted: mig.inserted, duplicates: mig.duplicates, stats: mig.stats, error: mig.error }));

// config 覆盖测试：换一个明显不同的 snowlumaDir，看 /state.paths 是否跟着变
mod.apply(ctx, { snowlumaDir: 'D:/fake-snowluma', patches: 'D:/fake-patches', fishHome: join(homedir(), '.dsh') });
const state2 = parse(await call('GET', '/state'));
console.log('config override paths:', JSON.stringify({ snowlumaDir: state2.paths?.snowlumaDir, patches: state2.paths?.patches, fishHome: state2.paths?.fishHome }));
console.log('override respected:', state2.paths?.snowlumaDir === 'D:/fake-snowluma' && state2.paths?.patches === 'D:/fake-patches');

// 归档浏览
for (const kind of ['cards', 'bili', 'diary', 'watch']) {
  const a = parse(await call('GET', `/archive?kind=${kind}&limit=5`));
  console.log(`archive ${kind}:`, JSON.stringify({ ok: a.ok, total: a.total, got: (a.items || []).length, counts: a.counts }));
}
const aq = parse(await call('GET', '/archive?kind=cards&q=%E5%9C%A8%E5%90%97&limit=5'));
console.log('archive cards q=在吗:', JSON.stringify({ ok: aq.ok, total: aq.total }));
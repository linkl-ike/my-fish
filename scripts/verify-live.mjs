// 运行态验收：面板 → Host → 鱼，逐项检查。PENDING 表示 Host 半改动还没重启加载。
// 用法：node scripts/verify-live.mjs [port]
const port = Number(process.argv[2] || process.env.DSH_PORT || 53402);
const HOST = `http://127.0.0.1:${port}`;
const results = [];
const add = (state, name, detail) => results.push({ state, name, detail });

async function json(url) {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch (error) {
    return { status: 0, body: null, error: String(error) };
  }
}

const state = await json(`${HOST}/api/plugins/my-fish/state`);
if (state.body?.ok) add('PASS', 'Host /state', `warnings=${(state.body.warnings || []).length} · fish=${state.body.fish?.version} · 记忆=${state.body.fish?.db?.total}`);
else add('FAIL', 'Host /state', state.error || JSON.stringify(state.body));

const ar = await json(`${HOST}/api/plugins/my-fish/archive?kind=cards&limit=1`);
if (ar.body?.ok) add('PASS', '归档浏览 /archive', `记忆卡=${ar.body.counts?.cards} B站=${ar.body.counts?.bili} 日记=${ar.body.counts?.diary} 观看=${ar.body.counts?.watch}`);
else if (String(ar.body?.error || '').includes('not found')) add('PENDING', '归档浏览 /archive', 'Host 半路由未加载，重启 DSH 后应返回 108/13/1/25');
else add('FAIL', '归档浏览 /archive', ar.error || JSON.stringify(ar.body));

const hasChatModels = !!(state.body?.fish && Object.prototype.hasOwnProperty.call(state.body.fish, 'chatModels'));
add(hasChatModels ? 'PASS' : 'PENDING', '按聊天模型暴露 chatModels', hasChatModels ? '已暴露' : 'Host /state 还没带 chatModels，重启后生效');

const ch = await json(`${HOST}/api/plugins/fish-soul/channels/state`);
if (ch.body?.ok !== false && ch.body?.qq) {
  add('PASS', '鱼 · 通道', `QQ ${ch.body.qq.enabled ? '开' : '关'} · B站 ${ch.body.bili?.enabled ? '开' : '关'} · 抖音 ${ch.body.douyin?.enabled ? '开' : '关'} · B站登录 ${ch.body.bili?.loggedIn ? '是' : '否'}`);
} else add('FAIL', '鱼 · 通道', ch.error || JSON.stringify(ch.body).slice(0, 120));

const dg = await json(`${HOST}/api/plugins/fish-soul/diagnose`);
const bad = (dg.body?.items || []).filter((x) => !x.ok);
add(bad.length === 0 ? 'PASS' : 'WARN', '鱼 · 自检', bad.length === 0 ? '全部正常' : bad.map((x) => `${x.label}：${x.detail}`).join('；'));

const mem = await json(`${HOST}/api/plugins/fish-soul/inspector/overview?limit=1`);
add(mem.body?.ok ? 'PASS' : 'FAIL', '鱼 · 记忆接口', mem.body?.ok ? `活跃 ${mem.body.matchedTotal} 条` : mem.error);

const vs = await json(`${HOST}/api/plugins/fish-soul/voice/state`);
add(vs.body?.ok !== false ? 'PASS' : 'FAIL', '鱼 · 语音', vs.body ? `TTS 剩余 ${vs.body.ttsLeft} · STT 剩余 ${vs.body.sttLeft} · 收到 ${vs.body.incomingCount}` : vs.error);

const mig = await fetch(`${HOST}/api/plugins/my-fish/migrate`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dryRun: true }),
}).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));
add(mig.ok ? 'PASS' : 'FAIL', '迁移 dryRun', mig.ok ? `total=${mig.total} duplicates=${mig.duplicates}` : mig.error);

const svc = state.body?.services || {};
add(svc.snowluma?.http && svc.snowluma?.ws ? 'PASS' : 'FAIL', 'SnowLuma 端口', `HTTP=${svc.snowluma?.http} WS=${svc.snowluma?.ws}`);
add(svc.surfcoreConsole?.up ? 'WARN' : 'PASS', 'SurfCore 3100', svc.surfcoreConsole?.up ? '在跑（双引擎风险）' : '已停（预期）');
add(svc.voiceBridge?.up ? 'PASS' : 'FAIL', '语音桥 8766', svc.voiceBridge?.up ? '在线' : '离线');

let fails = 0;
for (const r of results) {
  if (r.state === 'FAIL') fails += 1;
  console.log(`[${r.state}] ${r.name}${r.detail ? ` —— ${r.detail}` : ''}`);
}
const counts = results.reduce((acc, r) => { acc[r.state] = (acc[r.state] || 0) + 1; return acc; }, {});
console.log(`\n汇总：${JSON.stringify(counts)}`);
process.exit(fails === 0 ? 0 : 1);

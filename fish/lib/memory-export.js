/**
 * memory-export.js —— 记忆库的「本地完整保存」：Markdown 导出 / 导入 / 定时快照。
 *
 * 记忆全在 SQLite 里，但 SQLite 不是人读的。这里把记忆导出成一份 Markdown：
 * 按人分组、按时间、带类型和来源，直接丢到本机数据目录（~/.dsh/fish-soul/exports/），
 * 随时能用编辑器打开、备份、搬家；也能把同一格式导回来（只认自己导出的结构，防误导）。
 *
 * 自动快照：每小时检查一次，距上次快照 >= 20 小时就写一份到 exports/auto/，只留最近 keep 份。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fishSoulDir, getKv, setKv } from './db.js';
import { insertMemory, nearDuplicateSync } from './soul-memory.js';

const TZ = 8 * 3600_000;
const KIND_LABEL_LOCAL = { fact: '事实', event: '事件', feeling: '感受', episode: '聊过', diary: '日记', weekly: '周记' };
const KIND_BY_LABEL = { 事实: 'fact', 事件: 'event', 感受: 'feeling', 聊过: 'episode', 日记: 'diary', 周记: 'weekly' };
const AUTO_KEEP_DEFAULT = 7;
const AUTO_MIN_GAP_MS = 20 * 3600_000;
const LAST_AUTO_KEY = 'memory.markdown.lastAuto';

const pad = (n) => String(n).padStart(2, '0');
const stamp = (ms) => { const t = new Date(ms + TZ); return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}-${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}${String(t.getUTCMilliseconds()).padStart(3, '0')}`; };
const localIso = (ms) => { const t = new Date(ms + TZ); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`; };

export function exportsDir() { return join(fishSoulDir(), 'exports'); }
export function autoDir() { return join(exportsDir(), 'auto'); }
const ensureDir = (d) => { if (!existsSync(d)) mkdirSync(d, { recursive: true }); return d; };

const ownerNames = (db) => {
	const rows = db.prepare('SELECT canonical_id, display_name FROM person WHERE deleted_at IS NULL').all();
	const m = new Map();
	for (const r of rows) m.set(`user:${r.canonical_id}`, r.display_name);
	m.set('self', '她自己');
	return m;
};

/** 导出 Markdown 文本（ownerId 可选：只导某个人）。 */
export function buildMarkdown({ db, now, ownerId = null }) {
	const names = ownerNames(db);
	const where = ["character_id = 'feiyu'"];
	const params = [];
	if (ownerId !== null) { where.push('owner_id = ?'); params.push(ownerId); }
	const rows = db.prepare(`SELECT * FROM memory WHERE ${where.join(' AND ')} ORDER BY owner_id, created_at`).all(...params);
	const active = rows.filter((r) => r.status === 'active');
	const archived = rows.filter((r) => r.status !== 'active');
	const who = (id) => names.get(String(id)) ?? String(id).replace(/^user:/, '');
	const lines = [];
	lines.push('# my fish 记忆库');
	lines.push('');
	lines.push(`> 导出时间：${localIso(now)}（本地时间）`);
	lines.push(`> 共 ${rows.length} 条：活跃 ${active.length} 条、归档 ${archived.length} 条；涉及 ${new Set(active.map((r) => r.owner_id)).size} 个人`);
	lines.push('');
	const groups = new Map();
	for (const r of active) {
		const k = String(r.owner_id ?? 'unknown');
		if (!groups.has(k)) groups.set(k, []);
		groups.get(k).push(r);
	}
	for (const [oid, list] of groups) {
		lines.push(`## ${who(oid)}`);
		lines.push('');
		for (const r of list) {
			const kind = KIND_LABEL_LOCAL[r.kind] ?? r.kind ?? '事实';
			const date = localIso(Number(r.created_at) || now).slice(0, 10);
			const extra = [`重要度 ${r.importance ?? 1}`];
			if (r.channel) extra.push(`来源 ${r.channel}`);
			if (Number(r.recall_count) > 0) extra.push(`想起 ${r.recall_count} 次`);
			lines.push(`- [${kind} · ${date}] ${String(r.content ?? '').replace(/\s+/g, ' ')}（${extra.join(' · ')}）`);
		}
		lines.push('');
	}
	if (archived.length > 0) {
		lines.push('## 已归档 / 被修改');
		lines.push('');
		for (const r of archived) lines.push(`- [${r.status ?? 'archived'}${r.kind ? ` · ${KIND_LABEL_LOCAL[r.kind] ?? r.kind}` : ''}] ${String(r.content ?? '').replace(/\s+/g, ' ')}`);
		lines.push('');
	}
	return lines.join('\n');
}

/** 写一份 Markdown 到本地（默认 exports/；auto=true 写 exports/auto/）。 */
export function writeMarkdown({ db, now, ownerId = null, auto = false }) {
	const dir = ensureDir(auto ? autoDir() : exportsDir());
	const text = buildMarkdown({ db, now, ownerId });
	const name = `my-fish-memories-${stamp(now)}.md`;
	const path = join(dir, name);
	writeFileSync(path, text, 'utf8');
	return { path, name, dir, bytes: Buffer.byteLength(text, 'utf8') };
}

/** 列出导出文件（新→旧）。 */
export function listMarkdown({ auto = false } = {}) {
	const dir = auto ? autoDir() : exportsDir();
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((f) => f.endsWith('.md'))
		.map((f) => { const st = statSync(join(dir, f)); return { name: f, bytes: st.size, at: st.mtimeMs }; })
		.sort((a, b) => b.at - a.at);
}

/** 只留最近 keep 份自动快照。 */
export function pruneAuto(keep = AUTO_KEEP_DEFAULT) {
	const files = listMarkdown({ auto: true });
	for (const f of files.slice(Math.max(1, keep))) {
		try { unlinkSync(join(autoDir(), f.name)); } catch { /* 删不掉就留着 */ }
	}
	return files.length;
}

/**
 * 从导出的 Markdown 文本导回记忆。只认本插件导出的结构：
 *  `## 人名` 分组 + `- [类型 · 日期] 内容（…）` 行；其它内容忽略。
 * ownerId 参数：找不到对应人时兜底用谁（面板里选「归属」）。
 */
export function importMarkdown({ db, worker, text, now, ownerId = null }) {
	const names = ownerNames(db);
	const byName = new Map();
	for (const [id, name] of names) byName.set(name, id);
	let current = null;
	const added = [];
	const skipped = [];
	const errors = [];
	for (const rawLine of String(text ?? '').split(/\r?\n/)) {
		const line = rawLine.trimEnd();
		const h = line.match(/^##\s+(.+)$/);
		if (h !== null) {
			const name = h[1].trim();
			const hit = byName.get(name);
			current = hit ?? null;
			if (current === null && name !== '已归档 / 被修改') errors.push(`找不到这个人：${name}（会用兜底归属）`);
			continue;
		}
		if (current === null) continue;
		const m = line.match(/^-\s*\[([^\]]+)\]\s+(.+?)(?:（[^）]*）)?\s*$/);
		if (m === null) continue;
		const content = String(m[2]).trim();
		if (content === '') continue;
		const kindLabel = String(m[1]).split('·')[0].trim();
		const kind = KIND_BY_LABEL[kindLabel] ?? 'fact';
		const dup = db.prepare("SELECT id FROM memory WHERE character_id = 'feiyu' AND owner_id = ? AND content = ? AND status = 'active' LIMIT 1").get(current, content)
			?? nearDuplicateSync(db, current, content);
		if (dup !== undefined && dup !== null) { skipped.push(content.slice(0, 30)); continue; }
		try {
			insertMemory(db, worker ?? null, { ownerId: current, channel: 'import', kind, content, importance: 1, evidence: 'Markdown 导入' }, now);
			added.push(content.slice(0, 30));
		} catch (error) { errors.push(`${content.slice(0, 20)}：${error instanceof Error ? error.message : error}`); }
	}
	return { added: added.length, skipped: skipped.length, errors: errors.slice(0, 20), addedList: added };
}

/** 定时自动快照（每小时检查，>= 20 小时写一份，留 keep 份）。返回 stop 函数。 */
export function startAutoSnapshot({ db, clock, getConfig, log = () => {} }) {
	const check = () => {
		try {
			const cfg = getConfig()?.memory?.export ?? {};
			if (cfg.auto === false) return;
			const last = Number(getKv(db, LAST_AUTO_KEY, 0)) || 0;
			if (Date.now() - last < AUTO_MIN_GAP_MS) return;
			const r = writeMarkdown({ db, now: clock.now(), auto: true });
			setKv(db, LAST_AUTO_KEY, Date.now());
			pruneAuto(Math.max(1, Math.min(60, Math.floor(Number(cfg.keep ?? AUTO_KEEP_DEFAULT)) || AUTO_KEEP_DEFAULT)));
			log('info', `[fish-soul] 记忆 Markdown 自动快照：${r.name}（${r.bytes} bytes）`);
		} catch (error) {
			log('warn', `[fish-soul] 记忆 Markdown 自动快照失败：${error instanceof Error ? error.message : error}`);
		}
	};
	const timer = setInterval(check, 3600_000);
	timer.unref?.();
	const first = setTimeout(check, 2 * 60_000);
	first.unref?.();
	return () => { clearInterval(timer); clearTimeout(first); };
}

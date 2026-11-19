/**
 * memory-tools.js —— 给鱼主动「阅读记忆」的查询层：记忆搜索 / 按时间浏览 / 统计 / 读单条。
 *
 * 和另外两条记忆通道分工：
 *  - buildContextBlock：每轮自动召回（她不用动手，模型直接看到）；
 *  - recall 工具：按当前对话 / 当前说话人再查一次；
 *  - 这里：鱼可以按人名翻全库、按时间往回翻、看统计、读某一条的完整内容。
 *
 * 全部本地 SQLite，只读；search 命中后会 reinforce（和 recall 一样，想起来一次算一次）。
 * 权限由调用方（工具层）限制：非主人只能翻自己的。
 */
import { relTime, KIND_LABEL } from './soul-memory.js';

/** owner_id（'user:xxx' / 'self' / 'user:master'）→ 显示名。 */
export function ownerLabel(db, ownerId) {
	const raw = String(ownerId ?? '');
	if (raw === 'self') return '她自己';
	const row = db.prepare('SELECT display_name FROM person WHERE canonical_id = ?').get(raw.replace(/^user:/, ''));
	return row?.display_name ?? raw.replace(/^user:/, '');
}

/**
 * 把工具参数里的 owner 解释成 owner_id。
 * 参数空 = 当前说话人；all / 全部 = 全库（ownerId=null）；其余按显示名 / 别名查。
 */
export function resolveOwner(db, sessionOwnerId, arg) {
	const raw = String(arg ?? '').trim();
	if (raw === '') return { ownerId: sessionOwnerId, all: false };
	if (/^(all|everyone|全部|所有人|全库)$/i.test(raw)) return { ownerId: null, all: true };
	if (/^(self|她自己|鱼自己)$/i.test(raw)) return { ownerId: 'self', all: false };
	if (/^user:/.test(raw)) return { ownerId: raw, all: false };
	const exact = db.prepare('SELECT canonical_id FROM person WHERE display_name = ? AND deleted_at IS NULL LIMIT 1').get(raw);
	if (exact !== undefined) return { ownerId: `user:${exact.canonical_id}`, all: false };
	const fuzzy = db.prepare('SELECT canonical_id FROM person WHERE (display_name LIKE ? OR aliases LIKE ?) AND deleted_at IS NULL LIMIT 1').get(`%${raw}%`, `%${raw}%`);
	if (fuzzy !== undefined) return { ownerId: `user:${fuzzy.canonical_id}`, all: false };
	return { ownerId: sessionOwnerId, all: false };
}

/** 一行记忆给鱼看的样子。 */
export function formatMemoryLine(db, m, now) {
	const kind = KIND_LABEL[m.kind] ?? m.kind ?? '事实';
	const who = ownerLabel(db, m.owner_id);
	return `#${m.id} [${kind}·${who}·${relTime(m.created_at, now)}] ${String(m.content ?? '').slice(0, 200)}`;
}

/** 关键词搜索（全库或某个人）。返回 { rows, total }。 */
export function searchMemories(db, { ownerId = null, query = '', limit = 8 }) {
	const q = String(query ?? '').trim();
	if (q === '') return { rows: [], total: 0 };
	const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
	const where = ["character_id = 'feiyu'", "status = 'active'", "(content LIKE ? ESCAPE '\\' OR keywords LIKE ? ESCAPE '\\')"];
	const params = [like, like];
	if (ownerId !== null) { where.push('owner_id = ?'); params.push(ownerId); }
	const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM memory WHERE ${where.join(' AND ')}`).get(...params).n ?? 0);
	const rows = db.prepare(`SELECT * FROM memory WHERE ${where.join(' AND ')} ORDER BY importance DESC, updated_at DESC LIMIT ?`).all(...params, Math.max(1, Math.min(50, Number(limit) || 8)));
	return { rows, total };
}

/** 按时间倒序浏览（全库或某个人）。before = 只往前翻（created_at < before）。 */
export function browseMemories(db, { ownerId = null, limit = 10, before = null }) {
	const where = ["character_id = 'feiyu'", "status = 'active'"];
	const params = [];
	if (ownerId !== null) { where.push('owner_id = ?'); params.push(ownerId); }
	if (Number.isFinite(Number(before)) && Number(before) > 0) { where.push('created_at < ?'); params.push(Number(before)); }
	return db.prepare(`SELECT * FROM memory WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`).all(...params, Math.max(1, Math.min(50, Number(limit) || 10)));
}

/** 全库统计。 */
export function memoryStats(db, { now }) {
	const one = (sql, ...p) => db.prepare(sql).get(...p) ?? {};
	const total = Number(one("SELECT COUNT(*) AS n FROM memory WHERE character_id = 'feiyu' AND status = 'active'").n ?? 0);
	const archived = Number(one("SELECT COUNT(*) AS n FROM memory WHERE character_id = 'feiyu' AND status <> 'active'").n ?? 0);
	const kinds = db.prepare("SELECT kind, COUNT(*) AS n FROM memory WHERE character_id = 'feiyu' AND status = 'active' GROUP BY kind ORDER BY n DESC").all();
	const persons = db.prepare("SELECT owner_id, COUNT(*) AS n FROM memory WHERE character_id = 'feiyu' AND status = 'active' GROUP BY owner_id ORDER BY n DESC LIMIT 8").all();
	const recent7 = Number(one("SELECT COUNT(*) AS n FROM memory WHERE character_id = 'feiyu' AND status = 'active' AND created_at >= ?", now - 7 * 86_400_000).n ?? 0);
	const topRecall = db.prepare("SELECT id, content, recall_count FROM memory WHERE character_id = 'feiyu' AND status = 'active' AND recall_count > 0 ORDER BY recall_count DESC LIMIT 5").all();
	return { total, archived, kinds, persons, recent7, topRecall };
}

/** 读单条（含来源 evidence / 回忆次数）。 */
export function readMemory(db, { id }) {
	const row = db.prepare('SELECT * FROM memory WHERE id = ?').get(Number(id));
	if (row === undefined) return null;
	return { row, who: ownerLabel(db, row.owner_id) };
}

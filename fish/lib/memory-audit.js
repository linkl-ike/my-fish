/**
 * memory-audit.js —— 记忆体检：找出「重复 / 近似重复 / 该清的旧记忆」，并支持一键整理。
 *
 * 参考 dsh-plastic-memory 的「记忆体检」思路，但只做保守、可解释的规则：
 *  - 完全重复：同一个人、内容一模一样的两条以上（导入 / 两边都记过时会出现）；
 *  - 近似重复：同一个人、bigram Jaccard >= 0.85（「小明喜欢喝冰美式」vs「小明爱喝冰美式」）；
 *  - 该清的旧记忆：importance <= 2、从没被想起过、超过 90 天没更新（长期不用的寒暄类）；
 *  - 找不到主人：owner_id 不在 person 表里（人物被删了，记忆还留着——只提示，不自动删）。
 *
 * 整理只做「归档」（status='archived' + valid_to），不物理删除；主人在面板里可以自己恢复。
 */
import { KIND_LABEL } from './soul-memory.js';

const DAY_MS = 86_400_000;
const NEAR_THRESHOLD = 0.8;
const NEAR_MAX_ROWS = 800;
const STALE_DAYS = 90;

const bigrams = (text) => {
	const s = String(text ?? '').replace(/\s+/g, '');
	const set = new Set();
	for (let i = 0; i < s.length - 1; i += 1) set.add(s.slice(i, i + 2));
	return set;
};
const jaccard = (a, b) => {
	if (a.size === 0 || b.size === 0) return 0;
	let inter = 0;
	for (const x of a) if (b.has(x)) inter += 1;
	return inter / (a.size + b.size - inter);
};

const nameOf = (db, ownerId) => {
	const raw = String(ownerId ?? '');
	if (raw === 'self') return '她自己';
	const row = db.prepare('SELECT display_name FROM person WHERE canonical_id = ?').get(raw.replace(/^user:/, ''));
	return row?.display_name ?? raw.replace(/^user:/, '');
};
const brief = (text, n = 50) => String(text ?? '').replace(/\s+/g, ' ').slice(0, n);

/** 体检。返回 { summary, items }。items 按类型分组，数量有上限，避免面板卡死。 */
export function auditMemories({ db, clock }) {
	const now = clock.now();
	const all = db.prepare("SELECT * FROM memory WHERE character_id = 'feiyu' AND status = 'active' ORDER BY owner_id, created_at DESC").all();
	const groups = new Map();
	for (const m of all) {
		const k = String(m.owner_id ?? '');
		if (!groups.has(k)) groups.set(k, []);
		groups.get(k).push(m);
	}

	// 1) 完全重复
	const exact = [];
	for (const [ownerId, list] of groups) {
		const byContent = new Map();
		for (const m of list) {
			const c = String(m.content ?? '').trim();
			if (c === '') continue;
			if (!byContent.has(c)) byContent.set(c, []);
			byContent.get(c).push(m);
		}
		for (const [content, ms] of byContent) {
			if (ms.length < 2) continue;
			exact.push({ ownerId, name: nameOf(db, ownerId), ids: ms.map((x) => x.id), preview: brief(content), count: ms.length });
		}
	}

	// 2) 近似重复（同人、最近 800 条内两两比较）
	const near = [];
	const seenPair = new Set();
	for (const [ownerId, list] of groups) {
		const rows = list.slice(0, NEAR_MAX_ROWS);
		const grams = rows.map((m) => ({ m, g: bigrams(m.content) }));
		for (let i = 0; i < grams.length; i += 1) {
			for (let j = i + 1; j < grams.length; j += 1) {
				const a = grams[i]; const b = grams[j];
				if (String(a.m.content).trim() === String(b.m.content).trim()) continue; // 完全重复另算
				const sim = jaccard(a.g, b.g);
				if (sim < NEAR_THRESHOLD) continue;
				const key = a.m.id < b.m.id ? `${a.m.id}-${b.m.id}` : `${b.m.id}-${a.m.id}`;
				if (seenPair.has(key)) continue;
				seenPair.add(key);
				near.push({ ownerId, name: nameOf(db, ownerId), ids: [a.m.id, b.m.id], preview: brief(a.m.content), previewB: brief(b.m.content), sim: Number(sim.toFixed(2)) });
			}
		}
	}

	// 3) 该清的旧记忆
	const stale = all.filter((m) => Number(m.importance ?? 1) <= 2 && Number(m.recall_count ?? 0) === 0 && now - Number(m.created_at ?? now) >= STALE_DAYS * DAY_MS)
		.map((m) => ({ id: m.id, ownerId: m.owner_id, name: nameOf(db, m.owner_id), kind: m.kind, preview: brief(m.content), ageDays: Math.floor((now - m.created_at) / DAY_MS) }));

	// 4) 找不到主人的记忆
	const persons = new Set(db.prepare('SELECT canonical_id FROM person WHERE deleted_at IS NULL').all().map((r) => `user:${r.canonical_id}`));
	persons.add('self');
	const orphan = all.filter((m) => !persons.has(String(m.owner_id ?? ''))).map((m) => ({ id: m.id, ownerId: m.owner_id, preview: brief(m.content) }));

	return {
		summary: {
			total: all.length,
			exact: exact.length,
			near: near.length,
			stale: stale.length,
			orphan: orphan.length
		},
		items: {
			exact: exact.slice(0, 30),
			near: near.slice(0, 30),
			stale: stale.slice(0, 30),
			orphan: orphan.slice(0, 20)
		}
	};
}

/** 一键整理：把重复 / 近似重复 / 过时记忆归档（保留每组 importance 最高、最常用的一条）。 */
export function applyAudit({ db, now, kinds = ['exact', 'near', 'stale'] }) {
	const report = auditMemories({ db, clock: { now: () => now } });
	const archive = (ids, why) => {
		let n = 0;
		const st = db.prepare("UPDATE memory SET status = 'archived', valid_to = ?, updated_at = ? WHERE id = ? AND status = 'active'");
		const delVec = db.prepare('DELETE FROM vec WHERE memory_id = ?');
		for (const id of ids) {
			const r = st.run(now, now, id);
			if (r.changes > 0) { n += 1; try { delVec.run(id); } catch { /* 向量表可能不存在 */ } }
		}
		return n;
	};
	const keep = (ids) => {
		// 每组里留 importance 最高、其次最近更新的一条
		const rows = db.prepare(`SELECT id, importance, updated_at FROM memory WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY importance DESC, updated_at DESC`).all(...ids);
		return rows.length > 0 ? rows[0].id : null;
	};
	let archived = 0;
	const done = {};
	if (kinds.includes('exact')) {
		const ids = new Set();
		for (const g of report.items.exact) { const k = keep(g.ids); for (const id of g.ids) if (id !== k) ids.add(id); }
		archived += archive([...ids], '重复');
		done.exact = ids.size;
	}
	if (kinds.includes('near')) {
		const ids = new Set();
		for (const g of report.items.near) { const k = keep(g.ids); for (const id of g.ids) if (id !== k) ids.add(id); }
		archived += archive([...ids], '近似重复');
		done.near = ids.size;
	}
	if (kinds.includes('stale')) {
		archived += archive(report.items.stale.map((x) => x.id), '过时');
		done.stale = report.items.stale.length;
	}
	return { ok: true, archived, done };
}

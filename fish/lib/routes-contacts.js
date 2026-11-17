/**
 * routes-contacts.js —— 「联系」：显式把 QQ / 抖音 / B站 身份挂到同一个人身上。
 *
 *  - GET  /contacts/persons  列出所有人物 + 三个平台身份 + 记忆条数
 *  - POST /contacts/link     { ownerId, qqUin?, douyinUid?, biliUid? } 挂身份（null/'' = 解绑）
 *
 * 认人本身仍由自动流程（masterUid / bili.links / 会话 uid）负责；这里的接口给主人一个
 * 显式的“把这两个身份合成同一个人”的入口，用于把已经分开的人物合并。
 */
import { linkPersonIdentities } from './db.js';

const PERSON_COLUMNS = 'canonical_id, qq_uin, douyin_uid, bili_uid, display_name, relation_stage, interaction_count, first_seen_at, last_seen_at';

function listPersons(db) {
	const persons = db.prepare(`SELECT ${PERSON_COLUMNS} FROM person WHERE deleted_at IS NULL ORDER BY canonical_id = 'master' DESC, interaction_count DESC`).all();
	const counts = db.prepare("SELECT owner_id, COUNT(*) AS n FROM memory WHERE status = 'active' AND valid_to IS NULL GROUP BY owner_id").all();
	const map = new Map(counts.map((r) => [r.owner_id, r.n]));
	return persons.map((p) => ({
		ownerId: `user:${p.canonical_id}`,
		canonicalId: p.canonical_id,
		displayName: p.display_name,
		relationStage: p.relation_stage,
		qqUin: p.qq_uin ?? '',
		douyinUid: p.douyin_uid ?? '',
		biliUid: p.bili_uid ?? '',
		interactionCount: p.interaction_count ?? 0,
		memoryCount: map.get(`user:${p.canonical_id}`) ?? 0,
		isMaster: p.canonical_id === 'master',
	}));
}

export async function handleContactsRoute({ method, path, req, send, readBody, sameOrigin, deps }) {
	if (!path.startsWith('/contacts/')) return false;
	const { db, clock } = deps;
	const guard = () => {
		if (!sameOrigin(req)) { send(403, { ok: false, error: 'forbidden' }); return false; }
		return true;
	};
	if (method === 'GET' && path === '/contacts/persons') {
		send(200, { ok: true, persons: listPersons(db) });
		return true;
	}
	if (method === 'POST' && path === '/contacts/link') {
		if (!guard()) return true;
		let body;
		try { body = JSON.parse((await readBody(req)) || '{}'); } catch { send(200, { ok: false, error: 'body 不是 JSON' }); return true; }
		const ownerId = String(body.ownerId ?? '');
		if (ownerId === '') { send(200, { ok: false, error: '缺 ownerId' }); return true; }
		const r = linkPersonIdentities(db, {
			ownerId,
			qqUin: body.qqUin === undefined ? undefined : body.qqUin,
			douyinUid: body.douyinUid === undefined ? undefined : body.douyinUid,
			biliUid: body.biliUid === undefined ? undefined : body.biliUid,
			nowMs: typeof clock?.now === 'function' ? clock.now() : Date.now(),
		});
		if (r.ok) send(200, { ok: true, person: r.person, changes: r.changes, merged: r.merged, persons: listPersons(db) });
		else send(200, r);
		return true;
	}
	return false;
}

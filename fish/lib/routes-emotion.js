/**
 * routes-emotion.js —— 心情（PAD 情绪场）的只读快照 + 重置。
 *
 *   GET  /emotion/state   面板「心情」页用的快照（PAD、精力、派生情绪、最近事件）
 *   POST /emotion/reset   回到刚起床的平静状态（面板按钮）
 *
 * 情绪只影响语气：这里不改记忆、不改人格，写操作只有「重置」这一个。
 */
export async function handleEmotionRoute({ method, path, req, send, sameOrigin, deps }) {
	if (!path.startsWith('/emotion/')) return false;
	const { emotion } = deps;
	if (!emotion) {
		send(200, { ok: false, error: '心情模块没加载' });
		return true;
	}
	if (method === 'GET' && path === '/emotion/state') {
		send(200, emotion.snapshot());
		return true;
	}
	if (method === 'POST' && path === '/emotion/reset') {
		if (!sameOrigin(req)) { send(403, { ok: false, error: 'forbidden' }); return true; }
		send(200, emotion.reset());
		return true;
	}
	return false;
}

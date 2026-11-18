/**
 * emotion.js —— PAD 情绪场（v1.1 融合进来的能力）。
 *
 * 思路来自 dsh-emotion-memory（MIT）：三维连续场 + 通道 + 派生情绪 + 精力。
 * 这里改成**规则驱动、零模型调用、只作用于鱼自己的会话**，并且只影响语气：
 * 不改事实、不改记忆、不改人格。
 *
 *   p / a / d ∈ [-1, 1]  快乐（pleasure）/ 唤醒（arousal）/ 掌控（dominance）
 *   energy   ∈ [0, 100]  精力：聊多了掉，放久了回，跨夜按睡了一觉算
 *   channels 14 个离散强度，用来合成「心疼 / 吃醋 / 想念…」这类说法
 *
 * 状态存在 soul.db 的 kv 里（单条 JSON），面板「心情」页读快照、可重置。
 * 设计上没有副作用：面板看、模型看、重启都在，不影响任何已有记忆表。
 */
import { getKv, setKv } from './db.js';

const KV_KEY = 'emotion.field.v1';
const BASELINE = { p: 0.10, a: 0.00, d: 0.00 };
/** 每 5 分钟向基线回落一次（哭完会缓过来，不会一直贴死在满格）。 */
const RELAX_MS = 5 * 60_000;
const RELAX = { p: 0.15, a: 0.35, d: 0.20 };
const ENERGY = { init: 80, perHour: 3, sleepRecover: 45, perTurn: 2 };
const CHANNELS = ['joy', 'calm', 'sad', 'fear', 'angry', 'tired', 'excited', 'affection', 'caring', 'jealous', 'guilty', 'proud', 'lonely', 'annoyed'];
const CHANNEL_LABEL = {
	joy: '开心', calm: '安心', sad: '难过', fear: '担心', angry: '生气', tired: '疲惫',
	excited: '兴奋', affection: '喜欢', caring: '心疼', jealous: '吃醋', guilty: '愧疚',
	proud: '被夸', lonely: '想念', annoyed: '烦躁'
};

/**
 * 规则词表：命中就给 PAD 增量 + 对应通道强度。
 * 权重 / 增量都刻意压小：一句好听的话不会让她瞬间「满格开心」，要连着聊才起得来。
 */
const RULES = [
	{ re: /(喜欢你|爱你|好想你|想你啦|想你了|抱抱|贴贴|亲亲|么么)/, tag: 'affection', label: '示好', dp: 0.22, da: 0.08, dd: 0.02, ch: { affection: 0.5, joy: 0.25 } },
	{ re: /(真棒|好棒|厉害|好看|可爱|聪明|贴心|最好了|真乖|你真好)/, tag: 'praise', label: '夸她', dp: 0.18, da: 0.05, dd: 0.10, ch: { proud: 0.45, joy: 0.30 } },
	{ re: /(哈哈|笑死|好好笑|太逗|乐死|绷不住|笑不活)/, tag: 'laugh', label: '被逗笑', dp: 0.14, da: 0.12, dd: 0.05, ch: { joy: 0.40, excited: 0.35 } },
	{ re: /(晚安|早安|睡啦|去睡|我睡了|起床了)/, tag: 'calm', label: '道晚安', dp: 0.06, da: -0.10, dd: 0.02, ch: { calm: 0.35 } },
	{ re: /(对不起|抱歉|我错了|是我的错|别生气)/, tag: 'guilty', label: '道歉', dp: 0.05, da: 0.04, dd: 0.03, ch: { guilty: 0.40 } },
	{ re: /(谢谢|谢谢你|感谢|辛苦了)/, tag: 'thank', label: '道谢', dp: 0.12, da: 0.03, dd: 0.06, ch: { joy: 0.30, calm: 0.25 } },
	{ re: /(滚|闭嘴|烦死|笨|蠢|废物|讨厌你|骂你|不理你)/, tag: 'scold', label: '被凶', dp: -0.20, da: 0.12, dd: -0.12, ch: { angry: 0.35, sad: 0.40 } },
	{ re: /(别烦|别管|少管|不用你|别问了)/, tag: 'annoy', label: '被嫌烦', dp: -0.10, da: 0.10, dd: -0.05, ch: { annoyed: 0.40 } },
	{ re: /(生病|发烧|难受|疼|不舒服|去医院|住院|出事|受伤|感冒)/, tag: 'sick', label: '对方不舒服', dp: -0.12, da: 0.16, dd: -0.12, ch: { caring: 0.50, fear: 0.35, sad: 0.30 } },
	{ re: /(怎么办|来不及|赶不上|糟了|急死|完蛋)/, tag: 'urgent', label: '对方着急', dp: -0.06, da: 0.18, dd: -0.06, ch: { fear: 0.30, caring: 0.20 } },
	{ re: /(再见|走了|不聊了|下线|拜拜|分手|以后不)/, tag: 'leave', label: '告别', dp: -0.15, da: 0.03, dd: -0.08, ch: { lonely: 0.45, sad: 0.30 } },
	{ re: /(别人|其他女生|其他男生|她|他).{0,8}(约|见面|送我|聊天|吃饭)/, tag: 'jealous', label: '说到别人', dp: -0.05, da: 0.12, dd: -0.02, ch: { jealous: 0.50 } },
	{ re: /(累|困|熬夜|加班|没睡好|失眠)/, tag: 'tired', label: '对方累了', dp: -0.04, da: -0.12, dd: 0.00, ch: { tired: 0.40 } },
	{ re: /(你还好吗|你没事吧|你怎么样|照顾好自己|你开心吗|你累不累)/, tag: 'care', label: '被关心', dp: 0.16, da: 0.05, dd: 0.03, ch: { affection: 0.45, joy: 0.20 } }
];

/** 派生情绪：由通道强度 + PAD 条件合成，一次最多给三个。 */
const DERIVED = [
	{ key: '心疼', test: (s) => (s.channels.caring ?? 0) > 0.35 && (s.p < 0.25 || (s.channels.sad ?? 0) > 0.30) },
	{ key: '吃醋', test: (s) => (s.channels.jealous ?? 0) > 0.30 },
	{ key: '沮丧', test: (s) => s.p < -0.25 && s.a < -0.10 },
	{ key: '委屈', test: (s) => (s.channels.sad ?? 0) > 0.35 && s.d < -0.15 },
	{ key: '感动', test: (s) => (s.channels.joy ?? 0) > 0.45 && (s.channels.affection ?? 0) > 0.40 },
	{ key: '愧疚', test: (s) => (s.channels.guilty ?? 0) > 0.30 },
	{ key: '释然', test: (s) => (s.channels.calm ?? 0) > 0.40 && s.p > 0.20 },
	{ key: '思念', test: (s) => (s.channels.lonely ?? 0) > 0.30 },
	{ key: '烦躁', test: (s) => (s.channels.annoyed ?? 0) > 0.35 && s.energy < 55 },
	{ key: '开心', test: (s) => s.p > 0.40 },
	{ key: '低落', test: (s) => s.p < -0.30 }
];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (v) => Math.round(v * 100) / 100;

function defaultState(at) {
	return {
		p: BASELINE.p, a: BASELINE.a, d: BASELINE.d,
		energy: ENERGY.init,
		channels: {},
		at, updatedAt: at,
		recent: [],
		lastEvalAt: 0, lastEvalText: ''
	};
}

function normalizeState(raw, at) {
	if (raw === null || typeof raw !== 'object') return defaultState(at);
	const out = defaultState(at);
	out.p = clamp(Number(raw.p ?? BASELINE.p) || 0, -1, 1);
	out.a = clamp(Number(raw.a ?? BASELINE.a) || 0, -1, 1);
	out.d = clamp(Number(raw.d ?? BASELINE.d) || 0, -1, 1);
	out.energy = clamp(Number(raw.energy ?? ENERGY.init) || ENERGY.init, 0, 100);
	out.at = Number(raw.at) > 0 ? Number(raw.at) : at;
	out.updatedAt = Number(raw.updatedAt) > 0 ? Number(raw.updatedAt) : at;
	out.channels = {};
	for (const c of CHANNELS) out.channels[c] = clamp(Number(raw.channels?.[c] ?? 0) || 0, 0, 1);
	out.recent = Array.isArray(raw.recent) ? raw.recent.filter((x) => x && typeof x === 'object').slice(0, 30) : [];
	out.lastEvalAt = Number(raw.lastEvalAt) || 0;
	out.lastEvalText = String(raw.lastEvalText ?? '');
	return out;
}

function moodLabel(s) {
	if (s.p < -0.35) return '有点低落';
	if (s.p > 0.45) return '挺开心';
	if (s.a > 0.45) return '有点兴奋';
	if (s.energy < 35) return '有点乏';
	if (s.p > 0.20) return '还不错';
	return '平静';
}

function energyText(s) {
	if (s.energy >= 70) return '挺有精神';
	if (s.energy >= 40) return '精力一般';
	return '有点乏';
}

/**
 * @param {object} deps
 * @param {object} deps.db      soul.db
 * @param {{ now: () => number }} deps.clock  虚拟钟（和鱼的其他模块一致）
 */
export function createEmotionField({ db, clock, log }) {
	const now = () => (typeof clock?.now === 'function' ? clock.now() : Date.now());
	let state = defaultState(now());
	try { state = normalizeState(getKv(db, KV_KEY, null), now()); } catch { state = defaultState(now()); }
	let lastSavedAt = 0;

	function save(force = false) {
		const at = now();
		// 写库节流：30 秒内反复按时间结算时不重复落盘（重启最多丢几十秒的弛豫，无所谓）
		if (!force && at - lastSavedAt < 30_000) return;
		lastSavedAt = at;
		state.updatedAt = at;
		try { setKv(db, KV_KEY, state); } catch (error) { log?.('warn', `[fish-soul] 心情落盘失败：${String(error instanceof Error ? error.message : error)}`); }
	}

	/** 按真实时间结算：PAD 向基线回落、通道淡出、精力掉/回。 */
	function tick(at = now()) {
		const last = Number(state.at) > 0 ? Number(state.at) : at;
		const dt = at - last;
		if (!(dt > 30_000)) return;
		const steps = dt / RELAX_MS;
		if (steps > 0.2) {
			const k = Math.min(1, steps);
			state.p += (BASELINE.p - state.p) * RELAX.p * k;
			state.a += (BASELINE.a - state.a) * RELAX.a * k;
			state.d += (BASELINE.d - state.d) * RELAX.d * k;
			const decay = Math.min(1, 0.30 * k);
			for (const c of CHANNELS) state.channels[c] = clamp((state.channels[c] ?? 0) * (1 - decay), 0, 1);
		}
		const hours = dt / 3_600_000;
		let dE = -ENERGY.perHour * Math.min(hours, 12);
		// 一次跨过 6 小时：按睡了一觉算（跨夜回来精神回一点，别一直掉到 0）
		if (dt >= 6 * 3_600_000) dE += ENERGY.sleepRecover;
		state.energy = clamp(state.energy + dE, 0, 100);
		state.at = at;
		save();
	}

	/**
	 * 用本轮收到的话更新心情。只认字面线索，不调模型、不阻塞聊天。
	 * @param {string} text 本轮对方说的话
	 * @param {{ weight?: number, source?: string }} [opts] weight：主人 1.2 / 其他人 1.0 / 群聊非点名 0.7
	 * @returns {string[]|null} 命中的标签
	 */
	function evaluate(text, { weight = 1, source = '' } = {}) {
		const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
		if (raw === '') return null;
		const at = now();
		tick(at);
		// 同一条消息 12 秒内不重复评估：同一轮上下文可能被组装不止一次
		if (raw === state.lastEvalText && at - state.lastEvalAt < 12_000) return null;
		const w = clamp(Number(weight) || 1, 0.5, 1.5);
		const hits = [];
		for (const rule of RULES) {
			try { if (rule.re.test(raw)) hits.push(rule); } catch { /* 单条词表问题不影响整体 */ }
		}
		state.lastEvalText = raw;
		state.lastEvalAt = at;
		if (hits.length === 0) { save(); return null; }
		let dp = 0, da = 0, dd = 0;
		for (const rule of hits) {
			dp += rule.dp; da += rule.da; dd += rule.dd;
			for (const [key, value] of Object.entries(rule.ch ?? {})) {
				if (!CHANNELS.includes(key)) continue;
				state.channels[key] = clamp((state.channels[key] ?? 0) + value * w, 0, 1);
			}
			state.recent.unshift({
				at, tag: rule.tag, label: rule.label, source: String(source ?? '').slice(0, 24),
				delta: { p: round2(rule.dp * w), a: round2(rule.da * w), d: round2(rule.dd * w) }
			});
		}
		state.p = clamp(state.p + dp * w, -1, 1);
		state.a = clamp(state.a + da * w, -1, 1);
		state.d = clamp(state.d + dd * w, -1, 1);
		state.energy = clamp(state.energy - ENERGY.perTurn, 0, 100);
		state.recent = state.recent.slice(0, 30);
		save();
		return hits.map((rule) => rule.tag);
	}

	function derivedList() {
		const view = { ...state, channels: state.channels };
		const out = [];
		for (const d of DERIVED) {
			try { if (d.test(view)) out.push(d.key); } catch { /* ignore */ }
			if (out.length >= 3) break;
		}
		return out;
	}

	/**
	 * 每轮注入的一句话。没有情绪起伏且精力正常时返回空串（不占上下文）。
	 */
	function promptLine(at = now()) {
		tick(at);
		const label = moodLabel(state);
		const derived = derivedList();
		const eText = energyText(state);
		if (label === '平静' && derived.length === 0 && state.energy >= 40) return '';
		const bits = [label];
		if (derived.length > 0) bits.push(`夹着点${derived.join('、')}`);
		return `[你现在的心情] 整体${bits.join('，')}；${eText}。顺着这个底色说话，语气自然带出来就行，别直接说"我现在心情怎样"，也别让它改事实或编故事。`;
	}

	function snapshot(at = now()) {
		tick(at);
		const pad = { p: round2(state.p), a: round2(state.a), d: round2(state.d) };
		return {
			ok: true,
			pad,
			percent: {
				p: Math.round((pad.p + 1) * 50),
				a: Math.round((pad.a + 1) * 50),
				d: Math.round((pad.d + 1) * 50)
			},
			energy: Math.round(state.energy),
			label: moodLabel(state),
			derived: derivedList(),
			channels: CHANNELS
				.map((key) => ({ key, label: CHANNEL_LABEL[key] ?? key, value: round2(state.channels[key] ?? 0) }))
				.filter((x) => x.value > 0.05)
				.sort((x, y) => y.value - x.value),
			recent: state.recent.slice(0, 10),
			updatedAt: state.updatedAt
		};
	}

	/** 面板「重置」：回到刚起床的平静状态。 */
	function reset(at = now()) {
		state = defaultState(at);
		save(true);
		return snapshot(at);
	}

	return { evaluate, tick, promptLine, snapshot, reset, save, get state() { return state; } };
}

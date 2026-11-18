// 离线验证：心情（PAD 情绪场）的规则评估、回落与注入。
// 用法：node scripts/verify-emotion.mjs
import { DatabaseSync } from 'node:sqlite';
import { createEmotionField } from '../fish/lib/emotion.js';

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

let t = Date.UTC(2026, 10, 19, 0, 0, 0);
const clock = { now: () => t };
const emotion = createEmotionField({ db, clock });

const fail = [];
const ok = (cond, name, detail = '') => {
	if (cond) { console.log(`[PASS] ${name}${detail ? ` —— ${detail}` : ''}`); return; }
	fail.push(name);
	console.log(`[FAIL] ${name}${detail ? ` —— ${detail}` : ''}`);
};
const snap = () => emotion.snapshot();

// 1) 初始平静
const s0 = snap();
ok(Math.abs(s0.pad.p - 0.10) < 0.01 && s0.energy === 80, '初始状态', `p=${s0.pad.p} energy=${s0.energy}`);

// 2) 示好 → 快乐上升、喜欢通道点亮、派生「开心」
const hit1 = emotion.evaluate('好想你呀，抱抱，今天真棒', { weight: 1.2 });
const s1 = snap();
ok(Array.isArray(hit1) && hit1.includes('affection'), '识别「示好」', JSON.stringify(hit1));
ok(s1.pad.p > s0.pad.p + 0.1, '示好后快乐上升', `p ${s0.pad.p} -> ${s1.pad.p}`);
ok(s1.energy === 78, '每轮扣两点精力（两句话）', `energy=${s1.energy}`);
ok(s1.channels.some((c) => c.key === 'affection'), '喜欢通道点亮');
ok(s1.derived.includes('开心') || s1.derived.length > 0, '派生情绪出现', JSON.stringify(s1.derived));

// 3) 被凶 → 快乐下降、难过/生气通道
const hit2 = emotion.evaluate('滚，你真烦，别管我', { weight: 1 });
const s2 = snap();
ok(Array.isArray(hit2) && (hit2.includes('scold') || hit2.includes('annoy')), '识别「被凶」', JSON.stringify(hit2));
ok(s2.pad.p < s1.pad.p - 0.2, '被凶后快乐下降', `p ${s1.pad.p} -> ${s2.pad.p}`);
ok(s2.channels.some((c) => c.key === 'sad' || c.key === 'angry'), '难过/生气通道点亮');

// 4) 同一句话 12 秒内不重复评估
const dup = emotion.evaluate('滚，你真烦，别管我', { weight: 1 });
ok(dup === null, '短时间去重', JSON.stringify(dup));

// 5) 三小时不聊 → 向基线回落、精力下降
const beforeP = snap().pad.p;
t += 3 * 3600_000;
const s3 = snap();
ok(Math.abs(s3.pad.p - 0.10) < Math.abs(beforeP - 0.10), '向基线回落', `p ${beforeP} -> ${s3.pad.p}`);
ok(s3.energy < 79, '精力随时间下降', `energy=${s3.energy}`);

// 6) 跨夜 8 小时 → 精力恢复
t += 8 * 3600_000;
const s4 = snap();
ok(s4.energy > s3.energy, '跨夜恢复精力', `${s3.energy} -> ${s4.energy}`);

// 7) 平静且精力正常时不注入
emotion.reset();
const quiet = emotion.promptLine();
ok(quiet === '', '平静时不占上下文', JSON.stringify(quiet));

// 8) 有情绪时注入一句人话
emotion.evaluate('喜欢你', { weight: 1.2 });
const line = emotion.promptLine();
ok(line.includes('[你现在的心情]'), '有情绪时注入', line.slice(0, 60));

// 9) 重置
const r = emotion.reset();
ok(Math.abs(r.pad.p - 0.10) < 0.01 && r.energy === 80 && r.derived.length === 0, '重置回平静', JSON.stringify({ p: r.pad.p, energy: r.energy }));

// 10) 快照结构给面板用
const s5 = snap();
ok(s5.percent && typeof s5.percent.p === 'number' && Array.isArray(s5.channels) && Array.isArray(s5.recent), '快照结构完整');

console.log(`\n汇总：${fail.length === 0 ? 'ALL PASS' : `FAIL ${fail.length}: ${fail.join('、')}`}`);
process.exit(fail.length === 0 ? 0 : 1);

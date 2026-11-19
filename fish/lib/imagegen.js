/**
 * imagegen.js —— ComfyUI 画图：把她的想法变成一张图（本地生成，不起别的服务）。
 *
 * 实测环境（2026-11-19）：Comfy Desktop + Qwen-Image 2.1（int8 量化，12GB 显存）。
 * 文生图工作流：UNETLoader(qwen_image_2.1) → ModelSamplingAuraFlow(shift) → KSampler(euler/simple)
 *        + CLIPLoader(qwen3vl_8b, type=qwen_image —— 注意 pe_i2i 是编辑专用，不能用于文生图)
 *        + 正/负提示词 + EmptySD3LatentImage + VAEDecode。
 *
 * 加了三件事：
 *  - 作画前把 Comfy Desktop 窗口藏起来（hideWindow，默认开）；
 *  - 画完先让模型审查（review，默认开）：画面正常/主体完整/大体符合描述，PASS 才留下；
 *  - 审查通过后可以发到主人 QQ 私聊（sendToMaster，由 index.js 注入发送函数）。
 *
 * 所有图存在本机 ~/.dsh/fish-soul/gallery/，索引在 kv；生成过程不联网（只连本机 ComfyUI）。
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fishSoulDir, getKv, setKv } from './db.js';
import { insertMemory } from './soul-memory.js';

const DEFAULT_NEG = '低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，过度光滑，画面具有AI感。构图混乱。文字模糊，扭曲';
const GALLERY_KV = 'imagegen.gallery';
const GALLERY_MAX = 120;
const DAY_MS = 86_400_000;
const MAX_TRIES = 2;

const pad = (n) => String(n).padStart(2, '0');
const stamp = (ms) => { const t = new Date(ms + 8 * 3600_000); return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}-${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}${pad(t.getUTCSeconds())}${String(t.getUTCMilliseconds()).padStart(3, '0')}`; };

export function galleryDir() { return join(fishSoulDir(), 'gallery'); }

export class ImageGen {
	/**
	 * @param {object} deps
	 * @param {object} deps.db
	 * @param {object} deps.clock
	 * @param {() => object} deps.getConfig 返回当前配置（读 imagegen）
	 * @param {(prompt: string, opts?: object) => Promise<string|null>} [deps.callLlm] 审查用
	 * @param {(bytes: Buffer, caption: string) => Promise<boolean>} [deps.sendToMaster] 审查通过后发给主人（index.js 注入）
	 * @param {(level: string, msg: string) => void} [deps.log]
	 * @param {typeof fetch} [deps.fetchImpl]
	 */
	constructor({ db, clock, getConfig, callLlm = null, sendToMaster = null, log = () => {}, fetchImpl }) {
		this.db = db; this.clock = clock; this.getConfig = getConfig; this.callLlm = callLlm; this.sendToMaster = sendToMaster; this.log = log;
		this.fetch = fetchImpl ?? ((...a) => fetch(...a));
		this.lastPing = { at: 0, ok: false, info: null };
	}

	cfg() {
		const c = this.getConfig()?.imagegen ?? {};
		const num = (v, def, lo, hi) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : def);
		return {
			enabled: c.enabled === true,
			baseURL: String(c.baseURL ?? 'http://127.0.0.1:8188').replace(/\/+$/, ''),
			unet: String(c.unet ?? 'qwen_image_2.1_int8_convrot.safetensors'),
			clip: String(c.clip ?? 'qwen3vl_8b_int8_convrot.safetensors'),
			clipType: String(c.clipType ?? 'qwen_image'),
			vae: String(c.vae ?? 'qwen_image_2.1_vae_bf16.safetensors'),
			positivePrefix: String(c.positivePrefix ?? ''),
			negative: String(c.negative ?? DEFAULT_NEG),
			width: Math.round(num(c.width, 1024, 256, 2048) / 32) * 32,
			height: Math.round(num(c.height, 1024, 256, 2048) / 32) * 32,
			steps: Math.round(num(c.steps, 40, 4, 80)),
			cfg: num(c.cfg, 4, 1, 20),
			shift: num(c.shift, 3.1, 0.5, 10),
			styles: Array.isArray(c.styles) ? c.styles.map((x) => String(x).trim()).filter(Boolean).slice(0, 8) : [],
			review: c.review !== false,
			sendToMaster: c.sendToMaster === true,
			hideWindow: c.hideWindow !== false,
			promptMin: Math.round(num(c.promptMin, 500, 100, 5000)),
			autoPaint: c.autoPaint !== false,
			autoPerDay: Math.round(num(c.autoPerDay, 1, 0, 6)),
			maxPromptChars: Math.round(num(c.maxPromptChars, 1200, 100, 3000))
		};
	}

	/** 本机 ComfyUI 是否在线（带 30 秒缓存）。 */
	async ping(force = false) {
		const cfg = this.cfg();
		if (!force && Date.now() - this.lastPing.at < 30_000) return this.lastPing;
		try {
			const res = await this.fetch(`${cfg.baseURL}/system_stats`, { signal: AbortSignal.timeout(5000) });
			const j = await res.json();
			this.lastPing = { at: Date.now(), ok: true, info: { version: j?.system?.comfyui_version ?? '', device: j?.devices?.[0]?.name ?? '' } };
		} catch {
			this.lastPing = { at: Date.now(), ok: false, info: null };
		}
		return this.lastPing;
	}

	/** 把 Comfy Desktop 窗口藏起来（不关进程，画完她还要用）。失败无感。 */
	async hideComfyWindow() {
		const cmd = [
			"Add-Type -Namespace MF -Name U -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);'",
			"Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match 'Comfy' -and $_.MainWindowHandle -ne 0 } | ForEach-Object { [MF.U]::ShowWindow($_.MainWindowHandle, 0) | Out-Null }"
		].join('; ');
		try {
			await new Promise((resolve) => {
				execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { timeout: 8000, windowsHide: true }, () => resolve());
			});
			return true;
		} catch {
			return false;
		}
	}

	workflow({ prompt, width, height, steps, seed, prefix }) {
		const c = this.cfg();
		return {
			'1': { class_type: 'UNETLoader', inputs: { unet_name: c.unet, weight_dtype: 'default' } },
			'2': { class_type: 'CLIPLoader', inputs: { clip_name: c.clip, type: c.clipType } },
			'3': { class_type: 'VAELoader', inputs: { vae_name: c.vae } },
			'4': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: c.shift } },
			'5': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: `${c.positivePrefix}${prompt}` } },
			'6': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: c.negative } },
			'7': { class_type: 'EmptySD3LatentImage', inputs: { width, height, batch_size: 1 } },
			'8': { class_type: 'KSampler', inputs: { model: ['4', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['7', 0], seed, steps, cfg: c.cfg, sampler_name: 'euler', scheduler: 'simple', denoise: 1 } },
			'9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 0] } },
			'10': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: prefix } }
		};
	}

	/** 生成一张图，返回 { ok, bytes, filename, width, height }；失败返回 { ok:false, error }。 */
	async generate({ prompt, width, height, steps, seed } = {}) {
		const cfg = this.cfg();
		const text = String(prompt ?? '').trim().slice(0, cfg.maxPromptChars);
		if (text === '') return { ok: false, error: '提示词为空' };
		const w = width ?? cfg.width; const h = height ?? cfg.height;
		const st = steps ?? cfg.steps;
		const sd = Number.isFinite(Number(seed)) ? Number(seed) : Math.floor(Math.random() * 1000000000);
		const prefix = `fish-${stamp(Date.now())}`;
		try {
			const res = await this.fetch(`${cfg.baseURL}/prompt`, {
				method: 'POST', headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ prompt: this.workflow({ prompt: text, width: w, height: h, steps: st, seed: sd, prefix }), client_id: 'my-fish' }),
				signal: AbortSignal.timeout(15000)
			});
			const j = await res.json();
			if (j?.error) return { ok: false, error: `ComfyUI 拒绝：${JSON.stringify(j.error).slice(0, 200)}` };
			const id = j?.prompt_id;
			if (!id) return { ok: false, error: 'ComfyUI 没返回 prompt_id' };
			const deadline = Date.now() + 240_000;
			while (Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 2500));
				const hres = await this.fetch(`${cfg.baseURL}/history/${id}`, { signal: AbortSignal.timeout(10000) });
				const hist = await hres.json();
				const item = hist?.[id];
				if (!item) continue;
				const stStr = item?.status?.status_str;
				if (stStr === 'error') return { ok: false, error: `ComfyUI 执行出错：${JSON.stringify(item?.status?.messages ?? '').slice(0, 300)}` };
				if (stStr !== 'success') continue;
				const out = item.outputs ?? {};
				for (const k of Object.keys(out)) {
					const img = (out[k]?.images ?? [])[0];
					if (!img?.filename) continue;
					const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? '', type: img.type ?? 'output' });
					const ires = await this.fetch(`${cfg.baseURL}/view?${q.toString()}`, { signal: AbortSignal.timeout(30000) });
					if (!ires.ok) return { ok: false, error: `下载图片失败：HTTP ${ires.status}` };
					const bytes = Buffer.from(await ires.arrayBuffer());
					return { ok: true, bytes, filename: img.filename, width: w, height: h, seed: sd };
				}
				return { ok: false, error: 'ComfyUI 跑完了但没有输出图片' };
			}
			return { ok: false, error: '等待 ComfyUI 超时（240 秒）' };
		} catch (error) {
			return { ok: false, error: `连不上 ComfyUI：${error instanceof Error ? error.message : error}` };
		}
	}

	/** 画完审查：画面是否正常（噪声/乱码/主体变形/完全跑题）。没有视觉模型时放行。 */
	async reviewImage({ bytes, prompt }) {
		if (typeof this.callLlm !== 'function' || bytes.length === 0) return { pass: true, reason: 'no-reviewer' };
		try {
			const raw = await this.callLlm(
				`这是一张 AI 生成的图，画面描述是：「${String(prompt).slice(0, 600)}」。` +
				'检查画面是否正常：1) 不是噪声 / 纯色 / 乱码图；2) 主体完整、没有严重变形或糊成一团；3) 大体符合描述。' +
				'只回答 PASS 或 FAIL：一句原因（不超过 30 字）。',
				{ maxTokens: 80, images: [{ data: bytes.toString('base64'), mediaType: 'image/png' }] }
			);
			const t = String(raw ?? '').trim();
			if (/^FAIL/i.test(t)) return { pass: false, reason: t.replace(/^FAIL[:：]?\s*/i, '').slice(0, 60) };
			return { pass: true, reason: t.slice(0, 60) };
		} catch {
			return { pass: true, reason: '审查没跑成，放行' };
		}
	}

	/**
	 * 作画完整流程：藏窗口 → 生成 → 审查（不过重试一次）→ 存画册 + 记记忆 →（可选）发主人。
	 * 返回 { ok, file, bytes, prompt, width, height, reviews } 或 { ok:false, error }。
	 */
	async paint({ prompt, width, height, steps, remember = true, note = '', sendToMaster } = {}) {
		const cfg = this.cfg();
		if (!cfg.enabled) return { ok: false, error: '画图功能没开（面板「画册」里打开）' };
		const base = String(prompt ?? '').trim().slice(0, cfg.maxPromptChars);
		if (base === '') return { ok: false, error: '提示词为空' };
		const styleText = cfg.styles.length > 0 ? `\n风格：${cfg.styles.join('、')}。` : '';
		const fullPrompt = base + styleText;
		if (cfg.hideWindow) await this.hideComfyWindow();
		const reviews = [];
		let gen = null;
		for (let i = 0; i < MAX_TRIES; i += 1) {
			gen = await this.generate({ prompt: fullPrompt, width, height, steps });
			if (!gen.ok) return { ...gen, reviews };
			if (!cfg.review) { reviews.push({ pass: true, reason: skiptext() }); break; }
			const rv = await this.reviewImage({ bytes: gen.bytes, prompt: fullPrompt });
			reviews.push(rv);
			if (rv.pass) break;
			this.log('warn', `[fish-soul] 画完审查没通过（第 ${i + 1} 次）：${rv.reason}`);
			gen = null;
		}
		if (gen === null) return { ok: false, error: `审查没通过：${reviews.map((x) => x.reason).filter(Boolean).join(' / ') || '画面不正常'}`, reviews };
		const dir = galleryDir();
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		const file = `fish-${stamp(Date.now())}.png`;
		try { writeFileSync(join(dir, file), gen.bytes); } catch (error) { return { ok: false, error: `存图失败：${error instanceof Error ? error.message : error}` }; }
		const list = Array.isArray(getKv(this.db, GALLERY_KV, [])) ? getKv(this.db, GALLERY_KV, []) : [];
		list.unshift({ file, prompt: fullPrompt.slice(0, 600), at: this.clock.now(), width: gen.width, height: gen.height, note: String(note ?? '').slice(0, 120), reviewed: cfg.review });
		while (list.length > GALLERY_MAX) { const old = list.pop(); try { unlinkSync(join(dir, old.file)); } catch { /* 文件没了就算了 */ } }
		try { setKv(this.db, GALLERY_KV, list); } catch { /* 索引写失败不影响图 */ }
		if (remember) {
			try {
				insertMemory(this.db, null, {
					ownerId: 'self', channel: 'imagegen', kind: 'event', importance: 1,
					content: `我今天画了一张图：${String(base).slice(0, 80)}${note ? `（${note}）` : ''}`,
					evidence: '自己用 Qwen-Image 画的'
				}, this.clock.now());
			} catch { /* 记不下来不影响出图 */ }
		}
		let sent = false;
		const wantSend = typeof sendToMaster === 'boolean' ? sendToMaster : cfg.sendToMaster;
		if (wantSend && typeof this.sendToMaster === 'function') {
			try { sent = (await this.sendToMaster(gen.bytes, `画好了：${String(base).slice(0, 120)}\n${styleText ? `（风格：${cfg.styles.join('、')}）` : ''}`)) === true; } catch { sent = false; }
		}
		return { ok: true, file, bytes: gen.bytes.length, width: gen.width, height: gen.height, prompt: fullPrompt.slice(0, 600), reviews, sent };
	}

	/** 画册列表（新→旧）。 */
	gallery() {
		const list = getKv(this.db, GALLERY_KV, []);
		return (Array.isArray(list) ? list : []).filter((x) => x && typeof x.file === 'string');
	}

	/** 今天已经画了几张（自主画图限额用）。 */
	paintedToday() {
		const now = this.clock.now();
		const dayStart = now - (now % DAY_MS);
		return this.gallery().filter((x) => Number(x.at) >= dayStart).length;
	}

	/** 读一张画（面板显示 / 发图用）。 */
	read(file) {
		const safe = String(file ?? '').replace(/[^A-Za-z0-9._-]/g, '');
		if (!/^fish-[\w.-]+\.png$/.test(safe)) return null;
		const p = join(galleryDir(), safe);
		try { return { bytes: readFileSync(p), path: p }; } catch { return null; }
	}
}

function skiptext() { return '审查已关'; }

/**
 * my-fish —— 客户端半 v0.3：状态 + 调节 + 服务控制 + 记忆搜索/删除/新增
 *
 * 数据：
 *   - /api/plugins/my-fish/state      Host 汇总（SurfCore 归档 / 服务 / 记忆列表）
 *   - /api/plugins/fish-soul/*             鱼自己的接口（同源直连）：通道 / 语音 / 上网 / 主动 / 导回记忆
 *
 * 提供的调节：QQ/抖音/B站/上网 通道开关与关键参数、语音开关与音色试听、B站/抖音行为、主动窗口、
 * 服务启停（SnowLuma / 语音桥 / 看门狗）、SurfCore → 鱼 记忆迁移（预览/执行）。
 */
window.__ModuleLoader__.load({
  id: "my-fish",
  factory: (require) => {
    const React = require("react");
    const h = React.createElement;
    const API = "/api/plugins/my-fish";
    const FISH = "/api/plugins/fish-soul";
    const PLUGIN_ID = "my-fish";

    const fmtTime = (ms) => {
      if (!ms) return "—";
      try { return new Date(Number(ms)).toLocaleString("zh-CN", { hour12: false }); } catch { return String(ms); }
    };
    const fmtIso = (s) => {
      if (!s) return "—";
      const t = Date.parse(String(s));
      return Number.isFinite(t) ? fmtTime(t) : String(s);
    };

    async function getJson(url, options) {
      try {
        const res = await fetch(url, { headers: { accept: "application/json" }, ...(options || {}) });
        const data = await res.json().catch(() => null);
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        return data;
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    }
    async function postJson(url, body) {
      return getJson(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
    }

    // 鱼自带 /diagnose 的「通道连接」项有一个已知误报：它用 douyinSt?.state 判断抖音，
    // 但 deps.douyin.status()（DouyinChannel）只返回 { running }，state 在 douyinHost.status() 里，
    // 所以抖音真正在轮询时也永远显示「抖音 没跑」。
    // 面板按 /channels/state 的实时数据修正这一项，其余项保持 fish 原样。
    function fixChannelDiagnose(items, ch) {
      if (!Array.isArray(items) || !ch) return items;
      const qq = ch.qq || {};
      const bili = ch.bili || {};
      const dy = ch.douyin || {};
      const qqOn = qq.enabled === true;
      const biliOn = bili.enabled === true;
      const dyOn = dy.enabled === true;
      const qqOk = !qqOn || qq.connected === true;
      const biliOk = !biliOn || bili.loggedIn === true;
      const dyRunning = dy.channel?.running === true || dy.host?.state === "running";
      const ok = qqOk && biliOk && (!dyOn || dyRunning);
      const detail = [
        qqOn ? (qq.connected === true ? "QQ 已连" : "QQ 没连上") : "QQ 没开",
        biliOn ? (bili.loggedIn === true ? "B站 已登录" : "B站 没登录") : "B站 没开",
        dyOn ? (dyRunning ? "抖音 在跑" : "抖音 没跑") : "抖音 没开",
      ].join(" · ");
      return items.map((it) => {
        if (!it || it.key !== "channels") return it;
        const sameOk = it.ok === ok;
        const sameDetail = String(it.detail || "") === detail;
        if (sameOk && sameDetail) return it;
        return { ...it, ok, detail: `${detail}（按实时通道状态修正）` };
      });
    }

    // ── 基础控件（自绘，跟随宿主主题色） ────────────────────────────
    const styles = {
      page: { padding: "18px 20px", height: "100%", overflow: "auto", boxSizing: "border-box", fontSize: 13, lineHeight: 1.55 },
      tabs: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14, borderBottom: "1px solid rgba(128,128,128,0.22)", paddingBottom: 8 },
      tab: (active) => ({
        font: "inherit", fontSize: 13, padding: "4px 12px", borderRadius: 7, cursor: "pointer",
        border: `1px solid ${active ? "rgba(80,140,255,0.65)" : "rgba(128,128,128,0.28)"}`,
        background: active ? "rgba(80,140,255,0.12)" : "transparent", color: "inherit",
      }),
      grid: { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" },
      card: { border: "1px solid rgba(128,128,128,0.22)", borderRadius: 10, padding: "12px 14px", flex: "1 1 340px", minWidth: 280 },
      title: { margin: "0 0 8px", fontSize: 13, fontWeight: 600 },
      row: { display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid rgba(128,128,128,0.14)" },
      label: { color: "inherit", opacity: 0.72, fontSize: 12, minWidth: 96 },
      control: { flex: "1 1 auto", display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" },
      input: { font: "inherit", fontSize: 13, padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(128,128,128,0.4)", background: "transparent", color: "inherit", minWidth: 120 },
      num: { width: 64 },
      btn: (primary) => ({
        font: "inherit", fontSize: 12, padding: "3px 12px", borderRadius: 7, cursor: "pointer",
        border: `1px solid ${primary ? "rgba(80,140,255,0.7)" : "rgba(128,128,128,0.4)"}`,
        background: primary ? "rgba(80,140,255,0.15)" : "transparent", color: "inherit",
      }),
      hint: { opacity: 0.6, fontSize: 12, marginTop: 6 },
      dot: (ok) => ({ display: "inline-block", width: 8, height: 8, borderRadius: 999, marginRight: 6, background: ok ? "#2f9e6a" : "#d9534f" }),
      mono: { fontFamily: "ui-monospace,Consolas,monospace", fontSize: 12, opacity: 0.9 },
      toast: { position: "fixed", right: 22, bottom: 22, zIndex: 50, padding: "8px 14px", borderRadius: 9, border: "1px solid rgba(128,128,128,0.4)", background: "rgba(30,30,30,0.92)", color: "#fff", fontSize: 12 },
    };

    const Switch = ({ checked, onChange, disabled }) => h("button", {
      type: "button", role: "switch", "aria-checked": checked === true, disabled,
      onClick: () => onChange(!(checked === true)),
      style: {
        width: 38, height: 20, borderRadius: 999, border: "1px solid rgba(128,128,128,0.45)", cursor: "pointer",
        background: checked === true ? "rgba(47,158,106,0.75)" : "rgba(128,128,128,0.25)", position: "relative", padding: 0,
      },
    }, h("span", {
      style: {
        position: "absolute", top: 1, left: checked === true ? 19 : 2, width: 16, height: 16, borderRadius: 999,
        background: "#fff", transition: "left .12s",
      },
    }));

    // 输入法安全：用「非受控输入框」——React 不在打字/组字期间回写 DOM 的 value。
    // 受控写法即使监听 composition 事件，在 Electron + 微软拼音下仍可能被打断组字，
    // 表现就是「打一个字母就被上屏、只能一个字一个字敲 / 粘贴」。
    // 非受控后 DOM 是唯一事实来源；外部值（切人 / 保存后清空）只在元素没聚焦时同步进去。
    const useExternalSync = (ref, value) => {
      React.useEffect(() => {
        const el = ref.current;
        if (el === null) return;
        const v = value ?? "";
        if (document.activeElement !== el && el.value !== v) el.value = v;
      }, [value]);
    };
    const Text = ({ value, onChange, placeholder, style }) => {
      const ref = React.useRef(null);
      useExternalSync(ref, value);
      return h("input", {
        ref,
        type: "text",
        defaultValue: value ?? "",
        placeholder: placeholder || "",
        style: { ...styles.input, ...(style || {}) },
        onInput: (e) => {
          const n = e.nativeEvent;
          if (n && n.isComposing) return;
          onChange(e.target.value);
        },
        onCompositionEnd: (e) => onChange(e.target.value),
      });
    };
    const Area = ({ value, onChange, placeholder, style }) => {
      const ref = React.useRef(null);
      useExternalSync(ref, value);
      return h("textarea", {
        ref,
        defaultValue: value ?? "",
        placeholder: placeholder || "",
        style: { ...styles.input, ...(style || {}) },
        onInput: (e) => {
          const n = e.nativeEvent;
          if (n && n.isComposing) return;
          onChange(e.target.value);
        },
        onCompositionEnd: (e) => onChange(e.target.value),
      });
    };
    // 数字输入同样用非受控：受控 + 中文输入法下数字键也会被打断，只能一个一个敲。
    const Num = ({ value, onChange, min, max }) => {
      const ref = React.useRef(null);
      const text = (v) => (Number.isFinite(Number(v)) ? String(Number(v)) : "");
      React.useEffect(() => {
        const el = ref.current;
        if (el === null) return;
        const v = text(value);
        if (document.activeElement !== el && el.value !== v) el.value = v;
      }, [value]);
      const commit = (raw) => {
        if (raw === "") { onChange(0); return; }
        const n = Number(raw);
        if (Number.isFinite(n)) onChange(n);
      };
      return h("input", {
        ref,
        type: "number",
        defaultValue: text(value),
        min: min ?? 0,
        max: max ?? 9999,
        style: { ...styles.input, ...styles.num },
        onInput: (e) => {
          const n = e.nativeEvent;
          if (n && n.isComposing) return;
          commit(e.target.value);
        },
        onCompositionEnd: (e) => commit(e.target.value),
      });
    };
    const Select = ({ value, onChange, options }) => h("select", {
      value: value ?? "", style: styles.input, onChange: (e) => onChange(e.target.value),
    }, (options || []).map(([v, label]) => h("option", { key: v, value: v }, label)));
    const Row = ({ label, children }) => h("div", { style: styles.row }, h("span", { style: styles.label }, label), h("div", { style: styles.control }, children));
    const Card = ({ title, children, flex }) => h("section", { style: { ...styles.card, ...(flex ? { flex } : {}) } }, h("h3", { style: styles.title }, title), children);

    const Status = ({ ok, children }) => h("span", null, h("span", { style: styles.dot(ok) }), children);

    // ── 主组件 ───────────────────────────────────────────────────────
    function Panel() {
      const [tab, setTab] = React.useState("overview");
      const [host, setHost] = React.useState(null);
      const [channels, setChannels] = React.useState(null);
      const [voice, setVoice] = React.useState(null);
      const [models, setModels] = React.useState(null);
      const [life, setLife] = React.useState(null);
      const [error, setError] = React.useState("");
      const [toast, setToast] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [migrateOut, setMigrateOut] = React.useState("");
      const [voiceText, setVoiceText] = React.useState("你好呀，我是你的鱼，今天也要开心哦。");

      // ── 记忆页（v0.3：可搜索 / 删除 / 新增）──
      const [memData, setMemData] = React.useState(null);
      const [memQuery, setMemQuery] = React.useState("");
      const [memKind, setMemKind] = React.useState("");
      const [memOwner, setMemOwner] = React.useState("");
      const [memSel, setMemSel] = React.useState({});
      const [memBusy, setMemBusy] = React.useState(false);
      const [addContent, setAddContent] = React.useState("");
      const [addKind, setAddKind] = React.useState("fact");
      const [addOwner, setAddOwner] = React.useState("user:master");

      const notify = (text) => {
        setToast(text);
        window.clearTimeout(notify._t);
        notify._t = window.setTimeout(() => setToast(null), 3500);
      };

      const load = React.useCallback(async () => {
        setBusy(true);
        const [h1, c1, v1, m1, l1, p1, st1, sl1, dg1, bk1, up1, rt1, ac1, wk1, ob1, wv1, stg1, ca1, bh1] = await Promise.all([
          getJson(`${API}/state`),
          getJson(`${FISH}/channels/state`),
          getJson(`${FISH}/voice/state`),
          getJson(`${FISH}/models/state`),
          getJson(`${FISH}/life/state`),
          getJson(`${FISH}/persona/state`),
          getJson(`${FISH}/stickers/state`),
          getJson(`${FISH}/slang/state`),
          getJson(`${FISH}/diag-log`),
          getJson(`${FISH}/backup/state`),
          getJson(`${FISH}/update/state`),
          getJson(`${FISH}/retrieval/state`),
          getJson(`${FISH}/activity`),
          getJson(`${FISH}/memory/weekly/state`),
          getJson(`${FISH}/onboarding/state`),
          getJson(`${FISH}/worldinfo/state`),
          getJson(`${FISH}/storage/state`),
          getJson(`${FISH}/chat-archive/state`),
          getJson(`${FISH}/behavior/state`),
        ]);
        if (h1 && h1.ok) setHost(h1); else setError((h1 && h1.error) || "读取融合状态失败");
        if (c1 && c1.ok !== false) setChannels(c1);
        if (v1 && v1.ok !== false) setVoice(v1);
        if (m1 && m1.ok !== false) setModels(m1);
        if (l1 && l1.ok !== false) setLife(l1);
        if (p1 && p1.ok !== false) setPersonaS(p1);
        if (st1 && st1.ok !== false) setStickersS(st1);
        if (sl1 && sl1.ok !== false) setSlangS(sl1);
        if (dg1 && dg1.ok !== false) setDiagS(dg1);
        if (bk1 && bk1.ok !== false) setBackupS(bk1);
        if (up1 && up1.ok !== false) setUpdateS(up1);
        if (rt1 && rt1.ok !== false) setRetrievalS(rt1);
        if (ac1 && ac1.ok !== false) setActivityS(ac1);
        if (wk1 && wk1.ok !== false) setWeeklyS(wk1);
        if (ob1 && ob1.ok !== false) setOnboardingS(ob1);
        if (wv1 && wv1.ok !== false) setWorldS(wv1);
        if (stg1 && stg1.ok !== false) setStorageS(stg1);
        if (ca1 && ca1.ok !== false) setChatArchS(ca1);
        if (bh1 && bh1.ok !== false) setBehaviorS(bh1);
        const [dg2, so2] = await Promise.all([
          getJson(`${FISH}/diagnose`),
          getJson(`${FISH}/inspector/self-outdated?limit=50`),
        ]);
        if (dg2 && dg2.ok !== false) setDiagItems(fixChannelDiagnose(dg2.items || [], c1));
        if (so2 && so2.ok !== false) setOutdatedS(so2);
        const ms2 = await getJson(`${FISH}/memory/state`);
        if (ms2 && ms2.ok !== false) setMemStateS(ms2);
        setBusy(false);
      }, []);

      React.useEffect(() => {
        let active = true;
        const run = () => { if (active) void load(); };
        run();
        const timer = window.setInterval(run, 30000);
        return () => { active = false; window.clearInterval(timer); };
      }, [load]);

      // 记忆页：第一次切到该标签时拉一次。必须放在所有早返回之前（Hooks 规则）。
      const loadMemRef = React.useRef(null);
      React.useEffect(() => {
        if (tab === "memory" && memData === null) void loadMemRef.current?.();
      }, [tab]);

      // ── v0.4 新页面的数据（人格/表情/黑话/日志/备份/归档浏览）──
      const [personaS, setPersonaS] = React.useState(null);
      const [stickersS, setStickersS] = React.useState(null);
      const [slangS, setSlangS] = React.useState(null);
      const [diagS, setDiagS] = React.useState(null);
      const [backupS, setBackupS] = React.useState(null);
      const [updateS, setUpdateS] = React.useState(null);
      const [archiveKind, setArchiveKind] = React.useState("cards");
      const [archiveQ, setArchiveQ] = React.useState("");
      const [archiveS, setArchiveS] = React.useState(null);
      const [archiveBusy, setArchiveBusy] = React.useState(false);
      const [archiveErr, setArchiveErr] = React.useState("");
      const loadArchiveRef = React.useRef(null);
      React.useEffect(() => {
        if (tab === "archive" && archiveS === null) void loadArchiveRef.current?.();
      }, [tab]);

      // ── v0.5：人物 / 检索 / 动态整理 ──
      const [personOwner, setPersonOwner] = React.useState("");
      const [personD, setPersonD] = React.useState(null);
      const [personName, setPersonName] = React.useState("");
      const [personBusy, setPersonBusy] = React.useState(false);
      const loadPersonRef = React.useRef(null);
      React.useEffect(() => {
        if (tab === "person" && memData === null) void loadMemRef.current?.();
        if (tab === "person" && personOwner !== "" && personD === null) void loadPersonRef.current?.(personOwner);
      }, [tab, personOwner]);

      const [retrievalS, setRetrievalS] = React.useState(null);
      const [retBase, setRetBase] = React.useState(null);
      const [retModel, setRetModel] = React.useState(null);
      const [retKey, setRetKey] = React.useState("");
      React.useEffect(() => {
        if (retrievalS && retBase === null) {
          setRetBase(retrievalS.config?.baseURL || "");
          setRetModel(retrievalS.config?.model || "");
        }
      }, [retrievalS]);

      const [activityS, setActivityS] = React.useState(null);
      const [weeklyS, setWeeklyS] = React.useState(null);
      const [onboardingS, setOnboardingS] = React.useState(null);

      // ── v0.6：抖音/B站控制、世界书、存储存档、行为 ──
      const [behaviorS, setBehaviorS] = React.useState(null);
      const [dqShot, setDqShot] = React.useState(null);
      const [dqCheck, setDqCheck] = React.useState(null);
      const [dqUin, setDqUin] = React.useState(null);
      const [biliQr, setBiliQr] = React.useState(null);
      const [biliPoll, setBiliPoll] = React.useState(null);
      const [cookieText, setCookieText] = React.useState("");
      const [worldS, setWorldS] = React.useState(null);
      const [worldText, setWorldText] = React.useState("");
      const [storageS, setStorageS] = React.useState(null);
      const [chatArchS, setChatArchS] = React.useState(null);
      const [archChannel, setArchChannel] = React.useState("");
      const [archMsgs, setArchMsgs] = React.useState(null);

      // ── v1.1：联系（跨平台身份合并：QQ / 抖音 / B站 的我 = 同一个人）──
      const [contacts, setContacts] = React.useState(null);
      const [contactBusy, setContactBusy] = React.useState(false);
      const [contactIds, setContactIds] = React.useState({ qq: "", douyin: "", bili: "" });
      const [contactDraft, setContactDraft] = React.useState({});
      const [contactLinks, setContactLinks] = React.useState("");
      const [contactMsg, setContactMsg] = React.useState("");
      const loadContactsRef = React.useRef(null);
      React.useEffect(() => {
        if (tab === "contact" && contacts === null) void loadContactsRef.current?.();
      }, [tab]);
      const [storQ, setStorQ] = React.useState("");
      const [storRes, setStorRes] = React.useState(null);

      // ── v0.7：诊断 / 人格卡导入 / 群备注 / 失效记忆 ──
      const [diagItems, setDiagItems] = React.useState(null);
      const [cardText, setCardText] = React.useState("");
      const [groupNo, setGroupNo] = React.useState("");
      const [groupNote, setGroupNote] = React.useState("");
      const [outdatedS, setOutdatedS] = React.useState(null);
      const [sttBase, setSttBase] = React.useState("");
      const [sttModel, setSttModel] = React.useState("");

      // ── v0.8：导入旧聊天 / 记忆批量操作 ──
      const [importText, setImportText] = React.useState("");
      const [importPreview, setImportPreview] = React.useState(null);
      const [importSelf, setImportSelf] = React.useState({});
      const [importJob, setImportJob] = React.useState(null);
      const [bulkAction, setBulkAction] = React.useState("importance");
      const [bulkValue, setBulkValue] = React.useState("3");
      const [bulkResult, setBulkResult] = React.useState(null);
      const [memStateS, setMemStateS] = React.useState(null);
      const [selfTest, setSelfTest] = React.useState(null);

      const saveChannel = async (kind, body, msg) => {
        setBusy(true);
        const res = await postJson(`${FISH}/channels/${kind}-config`, body);
        setBusy(false);
        notify(res && res.ok ? `${msg}已保存` : `保存失败：${(res && res.error) || "未知错误"}`);
        void load();
      };

      if (!host) return h("div", { style: styles.page }, error ? `加载失败：${error}` : "加载中…");

      const fish = host.fish || {};
      const db = fish.db && !fish.db.error ? fish.db : null;
      const qq = channels?.qq || {};
      const douyin = channels?.douyin || {};
      const bili = channels?.bili || {};
      const svc = host.services || {};
      const sc = host.surfcore || {};
      const warnings = Array.isArray(host.warnings) ? host.warnings : [];
      const web = models?.web || {};
      const voiceCfg = voice || {};
      const proactive = life?.proactiveConfig || {};

      const TabBtn = (id, label) => h("button", { key: id, type: "button", style: styles.tab(tab === id), onClick: () => setTab(id) }, label);

      const Header = () => h("div", { style: { display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 10 } },
        h("h2", { style: { margin: 0, fontSize: 17, fontWeight: 650 } }, "my fish"),
        h("span", { style: { opacity: 0.6, fontSize: 12 } }, warnings.length > 0 ? `${warnings.length} 项待处理` : "自检通过"),
        h("span", { style: { marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" } },
          h("span", { style: { opacity: 0.6, fontSize: 12 } }, `更新 ${new Date(host.at).toLocaleTimeString("zh-CN", { hour12: false })}`),
          h("button", { type: "button", style: styles.btn(false), onClick: () => load(), disabled: busy }, busy ? "…" : "刷新")));

      const WarningBar = () => (warnings.length > 0
        ? h("div", { role: "status", style: { border: "1px solid rgba(217,83,79,0.5)", borderRadius: 10, padding: "9px 12px", marginBottom: 12, background: "rgba(217,83,79,0.08)" } },
          h("strong", null, "需要注意"),
          h("ul", { style: { margin: "6px 0 0 18px", padding: 0 } }, warnings.map((w, i) => h("li", { key: i }, w))))
        : h("div", { role: "status", style: { border: "1px solid rgba(47,158,106,0.45)", borderRadius: 10, padding: "9px 12px", marginBottom: 12, background: "rgba(47,158,106,0.08)" } },
          "自检通过：单一引擎在跑，SnowLuma 与语音桥都在线。"));

      // 总览
      const Overview = () => h("div", null,
        WarningBar(),
        h("div", { style: styles.grid },
          h(Card, { title: "鱼 · 本体" },
            h(Row, { label: "版本" }, h("span", null, fish.version || updateS?.current || "—")),
            h(Row, { label: "引擎" }, h("span", null, host?.engine?.embedded
              ? "内置（fish-core，随本插件启动）"
              : host?.engine?.loading
                ? "启动中…"
                : host?.engine
                  ? `未加载：${String(host.engine.error || "未知").slice(0, 120)}`
                  : "读取中…")),
            h(Row, { label: "人格" }, h("span", null, fish.personaName || "—")),
            h(Row, { label: "记忆总数" }, h("span", null, db ? `${db.total} 条` : "—")),
            h(Row, { label: "渠道分布" }, h("span", { style: styles.mono }, db ? ["qq", "qq-private", "bili", "bili-private", "douyin", "douyin-private"].map((c) => `${c}:${(db.byChannel || []).filter((r) => r.channel === c && r.status === "active").reduce((s, r) => s + r.n, 0)}`).join("  ") : "—")),
            h(Row, { label: "人物" }, h("span", null, (db?.personas || []).map((p) => `${p.name || p.id}${p.qq ? "·QQ" : ""}${p.douyin ? "·抖音" : ""}`).join("，") || "—"))),
          h(Card, { title: "服务" },
            h(Row, { label: "SnowLuma" }, h(Status, { ok: svc.snowluma?.http && svc.snowluma?.ws }, `HTTP ${svc.snowluma?.http ? "✓" : "✕"} / WS ${svc.snowluma?.ws ? "✓" : "✕"}`)),
            h(Row, { label: "语音桥 8766" }, h(Status, { ok: svc.voiceBridge?.up }, svc.voiceBridge?.up ? `在线${svc.voiceBridge?.health?.speaker ? ` · ${svc.voiceBridge.health.speaker}` : ""}` : "离线")),
            h(Row, { label: "SurfCore 3100" }, h(Status, { ok: !svc.surfcoreConsole?.up }, svc.surfcoreConsole?.up ? "在跑（应停）" : "已停（预期）")),
            h(Row, { label: "看门狗" }, h("span", null, svc.watchdogPaused ? "已暂停" : "运行中（每 2 分钟）"))),
          h(Card, { title: "SurfCore 归档" },
            h(Row, { label: "版本" }, h("span", null, sc.version || "—")),
            h(Row, { label: "记忆卡" }, h("span", null, sc.archive ? `${sc.archive.cardRecords} 条（QQ ${sc.archive.cardByScope.qq} / B站 ${sc.archive.cardByScope.bili}）` : "—")),
            h(Row, { label: "B站记忆库" }, h("span", null, sc.archive ? `${sc.archive.biliMemoryEntries} 条` : "—")),
            h(Row, { label: "观看历史" }, h("span", null, sc.archive ? `${sc.archive.watchCount} 条` : "—")),
            h(Row, { label: "B站日记" }, h("span", null, sc.archive ? `${sc.archive.diarySections} 篇` : "—")),
            h(Row, { label: "最近活动" }, h("span", null, sc.archive?.lastActiveAt ? fmtTime(sc.archive.lastActiveAt) : "—")),
            h(Row, { label: "bridge 收QQ" }, h(Status, { ok: !sc.bridgeQqClient }, sc.bridgeQqClient ? "开（有双引擎风险）" : "关（QQ 只归鱼）")))),
      );

      // 通道调节
      const ChannelTab = () => {
        const act = async (path, body, okMsg, keep) => {
          setBusy(true);
          const r = await postJson(`${FISH}${path}`, body || {});
          setBusy(false);
          if (!keep) notify(r && r.ok ? (okMsg || "完成") : `${okMsg || "操作"}失败：${(r && r.error) || ""}`);
          return r;
        };
        return h("div", { style: styles.grid },
        h(Card, { title: "QQ" },
          h(Row, { label: "启用" }, h(Switch, { checked: qq.enabled === true, onChange: (v) => saveChannel("qq", { enabled: v, wsUrl: qq.wsUrl || "ws://127.0.0.1:3001" }, "QQ") })),
          h(Row, { label: "主人 QQ" }, h(Text, { value: qq.masterQqUin || "", onChange: (v) => setChannels({ ...channels, qq: { ...qq, masterQqUin: v } }) })),
          h(Row, { label: "私聊白名单" }, h(Text, { value: (qq.privateAllowList || []).join(","), placeholder: "逗号分隔", onChange: (v) => setChannels({ ...channels, qq: { ...qq, privateAllowList: v.split(",").map((x) => x.trim()).filter(Boolean) } }) })),
          h(Row, { label: "群白名单" }, h(Text, { value: (qq.groupAllowList || []).join(","), placeholder: "逗号分隔", onChange: (v) => setChannels({ ...channels, qq: { ...qq, groupAllowList: v.split(",").map((x) => x.trim()).filter(Boolean) } }) })),
          h(Row, { label: "群备注" }, h(Text, { value: groupNo, onChange: setGroupNo, placeholder: "群号", style: { minWidth: 90, maxWidth: 130 } }), h(Text, { value: groupNote, onChange: setGroupNote, placeholder: "这个群是干嘛的（她怎么理解）" })),
          h("div", { style: { marginTop: 6, textAlign: "right" } },
            h("button", { type: "button", style: styles.btn(false), disabled: busy || groupNo.trim() === "", onClick: async () => {
              const r = await postJson(`${FISH}/groups/note`, { groupId: groupNo.trim(), note: groupNote });
              notify(r && r.ok ? "群备注已保存" : `保存失败：${(r && r.error) || ""}`);
            } }, "保存群备注")),
          h("div", { style: { marginTop: 8, textAlign: "right" } },
            h("button", { type: "button", style: styles.btn(true), disabled: busy, onClick: () => saveChannel("qq", {
              enabled: qq.enabled === true, wsUrl: qq.wsUrl || "ws://127.0.0.1:3001",
              masterQqUin: qq.masterQqUin || "", privateAllowList: qq.privateAllowList || [], groupAllowList: qq.groupAllowList || [],
            }, "QQ") }, "保存 QQ"))),
        h(Card, { title: "抖音" },
          h(Row, { label: "启用" }, h(Switch, { checked: douyin.enabled === true, onChange: (v) => saveChannel("douyin", { enabled: v, window: douyin.host?.window || douyin.window || "background" }, "抖音") })),
          h(Row, { label: "自动回复" }, h(Switch, { checked: douyin.autoReply === true, onChange: (v) => saveChannel("douyin", { autoReply: v }, "抖音") })),
          h(Row, { label: "主人 uid" }, h(Text, { value: douyin.masterUid || "", placeholder: "douyin:数字uid", onChange: (v) => setChannels({ ...channels, douyin: { ...douyin, masterUid: v } }) })),
          h(Row, { label: "回复所有人" }, h(Switch, { checked: douyin.replyAll === true, onChange: (v) => saveChannel("douyin", { replyAll: v }, "抖音") })),
          h("div", { style: { marginTop: 8, textAlign: "right" } },
            h("button", { type: "button", style: styles.btn(true), disabled: busy, onClick: () => saveChannel("douyin", {
              enabled: douyin.enabled === true, autoReply: douyin.autoReply === true,
              masterUid: douyin.masterUid || "", replyAll: douyin.replyAll === true,
              window: douyin.host?.window || "background",
            }, "抖音") }, "保存抖音"))),
        h(Card, { title: "B站" },
          h(Row, { label: "启用" }, h(Switch, { checked: bili.enabled === true, onChange: (v) => saveChannel("bili", { enabled: v }, "B站") })),
          h(Row, { label: "自动回复" }, h(Switch, { checked: bili.autoReply === true, onChange: (v) => saveChannel("bili", { autoReply: v }, "B站") })),
          h(Row, { label: "主人 UID" }, h(Text, { value: bili.masterUid || "", onChange: (v) => setChannels({ ...channels, bili: { ...bili, masterUid: v } }) })),
          h("div", { style: { marginTop: 8, textAlign: "right" } },
            h("button", { type: "button", style: styles.btn(true), disabled: busy, onClick: () => saveChannel("bili", { enabled: bili.enabled === true, autoReply: bili.autoReply === true, masterUid: bili.masterUid || "" }, "B站") }, "保存 B站"))),
        h(Card, { title: "上网查" },
          h(Row, { label: "启用" }, h(Switch, { checked: web.enabled === true, onChange: (v) => postJson(`${FISH}/models/config`, { web: { enabled: v } }).then(load) })),
          h(Row, { label: "服务" }, h(Select, { value: web.provider || "host", options: [["host", "DSH 自带"], ["bocha", "博查"], ["tavily", "Tavily"], ["brave", "Brave"], ["searxng", "SearXNG"]], onChange: (v) => postJson(`${FISH}/models/config`, { web: { provider: v } }).then(load) })),
          h(Row, { label: "每天上限" }, h(Num, { value: web.perDay ?? 20, min: 0, max: 500, onChange: (v) => postJson(`${FISH}/models/config`, { web: { perDay: v } }).then(load) })),
          h(Row, { label: "测一下" }, h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: async () => {
            setBusy(true);
            const r = await postJson(`${FISH}/web/test`, {});
            setBusy(false);
            notify(r && r.ok ? `搜索可用：${(r.results || []).length} 条结果` : `测试失败：${(r && r.error) || ""}`);
          } }, "用当前服务搜一次")),
          h("div", { style: styles.hint }, `今日已用 ${web.usedToday ?? 0} 次 · 选 "DSH 自带" 时在聊天里用宿主的 web_search`)),
        h(Card, { title: "抖音 · 浏览器控制" },
          h("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" } },
            h("button", { type: "button", style: styles.btn(true), disabled: busy, onClick: () => act("/douyin/browser/start", {}, "抖音浏览器已启动") }, "启动浏览器"),
            h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: () => act("/douyin/browser/close", {}, "已关闭") }, "关闭浏览器"),
            h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: () => act("/douyin/window", { show: true }, "已显示窗口") }, "显示窗口"),
            h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: async () => { const r = await act("/douyin/screenshot", {}, "已截图", true); if (r && r.ok && r.image) { setDqShot(r.image); notify(`截图 ${r.width}×${r.height}${typeof r.loggedIn === "boolean" ? (r.loggedIn ? " · 已登录" : " · 未登录") : ""}`); } else notify(`截图失败：${(r && r.error) || ""}`); } }, "截图看看"),
            h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: async () => { const r = await act("/douyin/self-check", {}, "", true); if (r && r.ok) { setDqCheck(r.report); notify("自检完成"); } else notify(`自检失败：${(r && r.error) || ""}`); } }, "自检"),
            h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: () => act("/douyin/browse-now", {}, "已开始刷一轮") }, "立即刷一轮"),
            h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: () => act("/douyin/post-now", {}, "已发一条图文") }, "发一条图文"),
            h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: () => act("/douyin/comments-now", {}, "已回一轮评论") }, "回评论"),
            h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: async () => {
              const r = await postJson(`${FISH}/douyin/inbox-dismiss-all`, {});
              notify(r && r.ok ? `已忽略 ${r.dismissed ?? 0} 条未确认` : `失败：${(r && r.error) || ""}`);
            } }, "忽略未确认私信"),
            h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: async () => {
              const r = await postJson(`${FISH}/douyin/inbox-gap-ack`, {});
              notify(r && r.ok ? "遗漏提示已标为已知悉" : `失败：${(r && r.error) || ""}`);
            } }, "遗漏提示已知悉"),
            h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: async () => {
              const r = await postJson(`${FISH}/douyin/uin-candidates`, {});
              if (r && r.ok) { setDqUin(r.candidates || []); notify(`抖音账号候选：${(r.candidates || []).length} 个`); }
              else notify(`查候选失败：${(r && r.error) || ""}`);
            } }, "查抖音账号候选")),
          dqUin && dqUin.length > 0 ? h("div", { style: { marginTop: 8, maxHeight: 160, overflow: "auto" } },
            dqUin.map((c) => h("div", { key: c.name, style: { display: "flex", gap: 8, alignItems: "center", padding: "3px 0", borderTop: "1px solid rgba(128,128,128,0.1)", fontSize: 12 } },
              h("span", { style: { flex: "1 1 auto" } }, `${c.name}${c.uid ? `（${c.uid}）` : ""}`),
              h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: async () => {
                const r = await postJson(`${FISH}/douyin/uin-confirm`, { name: c.name });
                notify(r && r.ok ? `已确认 ${c.name}` : `确认失败：${(r && r.error) || ""}`);
                setDqUin(null);
                void load();
              } }, "确认"),
              h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: async () => {
                const r = await postJson(`${FISH}/douyin/uin-dismiss`, { name: c.name });
                notify(r && r.ok ? `已忽略 ${c.name}` : `忽略失败：${(r && r.error) || ""}`);
                setDqUin((prev) => (prev || []).filter((x) => x.name !== c.name));
              } }, "忽略")))) : null,
          dqShot ? h("img", { src: dqShot, alt: "抖音截图", style: { maxWidth: "100%", marginTop: 8, borderRadius: 8 } }) : null,
          dqCheck ? h("pre", { style: { ...styles.mono, whiteSpace: "pre-wrap", maxHeight: 180, overflow: "auto", marginTop: 8 } }, JSON.stringify(dqCheck, null, 1)) : null,
          h("div", { style: styles.hint }, "浏览器要先把「抖音 → 启用」打开；截图/自检会显示在上面。")),
        h(Card, { title: "B站 · 登录 / 控制" },
          h("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" } },
            h("button", { type: "button", style: styles.btn(true), disabled: busy, onClick: async () => { const r = await act("/bili/qr/start", {}, "", true); if (r && r.ok && r.svg) { setBiliQr(r.svg); setBiliPoll(null); notify(`二维码已生成，${r.expiresInSec || 120} 秒内有效`); } else notify(`生成二维码失败：${(r && r.error) || ""}`); } }, "扫码登录"),
            h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: async () => { const r = await act("/bili/qr/poll", {}, "", true); if (r && r.ok) { setBiliPoll(r); notify(`扫码状态：${r.status}${r.message ? ` · ${r.message}` : ""}`); } else notify(`查询失败：${(r && r.error) || ""}`); } }, "刷新扫码状态"),
            h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: () => act("/bili/browse-now", {}, "已开始刷一轮") }, "立即刷一轮"),
            h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: () => act("/bili/post-now", {}, "已发一条动态") }, "发一条动态"),
            h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: () => act("/bili/comments-now", {}, "已回评论") }, "回评论"),
            h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: () => { if (!window.confirm("确定退出 B站登录？")) return; void act("/bili/logout", {}, "已退出登录"); } }, "退出登录")),
          biliQr ? h("div", { style: { marginTop: 8, background: "#fff", padding: 8, borderRadius: 8, display: "inline-block" }, dangerouslySetInnerHTML: { __html: biliQr } }) : null,
          biliPoll ? h("div", { style: styles.hint }, `扫码状态：${biliPoll.status || ""}${biliPoll.message ? ` · ${biliPoll.message}` : ""}`) : null,
          h(Row, { label: "Cookie 登录" }, h(Text, { value: cookieText, onChange: setCookieText, placeholder: "SESSDATA=…（从浏览器复制）" })),
          h("div", { style: { textAlign: "right", marginTop: 6 } },
            h("button", { type: "button", style: styles.btn(false), disabled: busy || cookieText.trim() === "", onClick: async () => { const r = await act("/bili/cookie", { cookie: cookieText }, "Cookie 登录成功"); if (r && r.ok) { setCookieText(""); void load(); } } }, "用 Cookie 登录")),
          h("div", { style: styles.hint }, "扫码登录会把 B站账号接给鱼的 B站通道；登录状态可以看上面的状态提示。")),
      );
      };

      // 语音
      const playBase64 = (b64) => {
        try {
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
          const isWav = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
          const blob = new Blob([bytes], { type: isWav ? "audio/wav" : "audio/mpeg" });
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.onended = () => URL.revokeObjectURL(url);
          void audio.play();
        } catch (e) { notify(`播放失败：${String(e)}`); }
      };
      const VoiceTab = () => h("div", { style: styles.grid },
        h(Card, { title: "语音（说）" },
          h(Row, { label: "启用" }, h(Switch, { checked: voiceCfg.enabled === true, onChange: (v) => postJson(`${FISH}/voice/config`, { enabled: v }).then(load) })),
          h(Row, { label: "说话策略" }, h(Select, { value: voiceCfg.speak || "sometimes", options: [["never", "从不"], ["mirror", "对方发语音才回"], ["sometimes", "偶尔主动发"]], onChange: (v) => postJson(`${FISH}/voice/config`, { speak: v }).then(load) })),
          h(Row, { label: "音色 ID" }, h(Text, { value: voiceCfg.ttsVoice || "", placeholder: "S_xxx", onChange: (v) => setVoice({ ...voice, ttsVoice: v }) })),
          h(Row, { label: "服务商" }, h("span", { style: styles.mono }, voiceCfg.ttsProvider || "—")),
          h(Row, { label: "今日剩余" }, h("span", null, `${voiceCfg.ttsLeft ?? "?"} 次`)),
          h("div", { style: { marginTop: 8, textAlign: "right" } },
            h("button", { type: "button", style: styles.btn(true), disabled: busy, onClick: async () => { setBusy(true); const r = await postJson(`${FISH}/voice/config`, { enabled: voiceCfg.enabled === true, speak: voiceCfg.speak || "sometimes", ttsVoice: voiceCfg.ttsVoice || "" }); setBusy(false); notify(r?.ok ? "语音配置已保存" : `保存失败：${r?.error || ""}`); load(); } }, "保存语音"))),
        h(Card, { title: "试听（走火山复刻）" },
          h("div", { style: { display: "flex", gap: 8, marginBottom: 8 } }, h(Text, { value: voiceText, onChange: setVoiceText, style: { width: "100%" } })),
          h("div", { style: { textAlign: "right" } },
            h("button", { type: "button", style: styles.btn(true), disabled: busy, onClick: async () => {
              setBusy(true);
              const r = await postJson(`${FISH}/voice/test`, { text: voiceText });
              setBusy(false);
              if (r && r.ok && r.base64) { playBase64(r.base64); notify("正在播放试听"); }
              else notify(`试听失败：${(r && r.error) || "没有音频"}`);
            } }, "生成并播放")),
          h("div", { style: styles.hint }, "单次最多 60 字；会消耗一次每日语音额度。")),
        h(Card, { title: "听语音（STT）/ 收到的语音" },
          h(Row, { label: "保存收到的" }, h(Switch, { checked: voice.saveIncoming === true, onChange: (v) => postJson(`${FISH}/voice/config`, { saveIncoming: v }).then((r) => { notify(r && r.ok ? "已保存" : "保存失败"); void load(); }) })),
          h(Row, { label: "STT 模型" }, h(Text, { value: sttModel, onChange: setSttModel, placeholder: voice.sttModel || "FunAudioLLM/SenseVoiceSmall" })),
          h(Row, { label: "STT 端点" }, h(Text, { value: sttBase, onChange: setSttBase, placeholder: "留空 = 跟 TTS 同一个端点" })),
          h(Row, { label: "收到语音" }, h("span", null, `${voice.incomingCount ?? 0} 个 · 今日剩余 ${voice.sttLeft ?? "?"} 次`)),
          h("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8, flexWrap: "wrap" } },
            h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: async () => {
              setBusy(true);
              const r = await postJson(`${FISH}/voice/clear-incoming`, {});
              setBusy(false);
              notify(r && r.ok ? `已清理 ${r.removed ?? 0} 个语音文件` : `清理失败：${(r && r.error) || ""}`);
              void load();
            } }, "清理收到的语音"),
            h("button", { type: "button", style: styles.btn(true), disabled: busy, onClick: async () => {
              setBusy(true);
              const body = {};
              if (sttModel.trim() !== "") body.sttModel = sttModel.trim();
              if (sttBase.trim() !== "") body.sttBaseURL = sttBase.trim();
              const r = await postJson(`${FISH}/voice/config`, body);
              setBusy(false);
              notify(r && r.ok ? "STT 配置已保存" : `保存失败：${(r && r.error) || ""}`);
              void load();
            } }, "保存 STT 配置"))),
      );

      // B站 / 抖音 行为
      const BehaviorTab = () => {
        const biliBrowse = bili.browse || {};
        const dyBrowse = douyin.browse || {};
        const biliPost = bili.post || {};
        const biliComments = bili.comments || {};
        const dyPost = douyin.post || {};
        const dyComments = douyin.comments || {};
        const biliPatch = (browse) => saveChannel("bili", { enabled: bili.enabled === true, browse }, "B站浏览");
        const dyPatch = (browse) => saveChannel("douyin", { browse }, "抖音浏览");
        return h("div", { style: styles.grid },
          h(Card, { title: "B站 · 刷视频 / 互动" },
            h(Row, { label: "自动刷视频" }, h(Switch, { checked: biliBrowse.enabled === true, onChange: (v) => biliPatch({ enabled: v }) })),
            h(Row, { label: "每天条数" }, h(Num, { value: biliBrowse.perDay ?? 3, min: 0, max: 12, onChange: (v) => biliPatch({ perDay: v }) })),
            h(Row, { label: "每次看几个" }, h(Num, { value: biliBrowse.videosPerSession ?? 3, min: 1, max: 6, onChange: (v) => biliPatch({ videosPerSession: v }) })),
            h(Row, { label: "点赞" }, h(Switch, { checked: biliBrowse.like === true, onChange: (v) => biliPatch({ like: v }) })),
            h(Row, { label: "收藏" }, h(Switch, { checked: biliBrowse.favorite === true, onChange: (v) => biliPatch({ favorite: v }) })),
            h(Row, { label: "分享" }, h(Switch, { checked: biliBrowse.share !== false, onChange: (v) => biliPatch({ share: v }) })),
            h(Row, { label: "发评论" }, h(Switch, { checked: biliBrowse.comment === true, onChange: (v) => biliPatch({ comment: v }) })),
            h(Row, { label: "弹幕" }, h(Switch, { checked: biliBrowse.danmaku !== false, onChange: (v) => biliPatch({ danmaku: v }) })),
            h(Row, { label: "搜关键词刷" }, h(Switch, { checked: biliBrowse.search === true, onChange: (v) => biliPatch({ search: v }) })),
            h("div", { style: { marginTop: 8, borderTop: "1px solid rgba(128,128,128,0.14)", paddingTop: 6 } },
              h(Row, { label: "自动发动态" }, h(Switch, { checked: biliPost.enabled === true, onChange: (v) => postJson(`${FISH}/channels/bili-config`, { post: { enabled: v } }).then((r) => { notify(r && r.ok ? "已保存" : `保存失败：${(r && r.error) || ""}`); void load(); }) })),
              h(Row, { label: "每天动态" }, h(Num, { value: biliPost.perDay ?? 1, min: 0, max: 5, onChange: (v) => postJson(`${FISH}/channels/bili-config`, { post: { perDay: v } }).then(load) })),
              h(Row, { label: "回评论" }, h(Switch, { checked: biliComments.enabled === true, onChange: (v) => postJson(`${FISH}/channels/bili-config`, { comments: { enabled: v } }).then((r) => { notify(r && r.ok ? "已保存" : `保存失败：${(r && r.error) || ""}`); void load(); }) })),
              h(Row, { label: "每小时评论" }, h(Num, { value: biliComments.perHour ?? 6, min: 0, max: 20, onChange: (v) => postJson(`${FISH}/channels/bili-config`, { comments: { perHour: v } }).then(load) })))),
          h(Card, { title: "抖音 · 刷视频 / 互动" },
            h(Row, { label: "窗口模式" }, h(Select, { value: douyin.host?.window || douyin.window || "background", options: [["background", "后台（挪出屏幕）"], ["visible", "可见"]], onChange: (v) => saveChannel("douyin", { window: v }, "抖音窗口") })),
            h(Row, { label: "自动刷视频" }, h(Switch, { checked: dyBrowse.enabled === true, onChange: (v) => dyPatch({ enabled: v }) })),
            h(Row, { label: "每天条数" }, h(Num, { value: dyBrowse.perDay ?? 3, min: 0, max: 12, onChange: (v) => dyPatch({ perDay: v }) })),
            h(Row, { label: "每次看几个" }, h(Num, { value: dyBrowse.videosPerSession ?? 6, min: 1, max: 18, onChange: (v) => dyPatch({ videosPerSession: v }) })),
            h(Row, { label: "点赞" }, h(Switch, { checked: dyBrowse.like === true, onChange: (v) => dyPatch({ like: v }) })),
            h(Row, { label: "收藏" }, h(Switch, { checked: dyBrowse.collect === true, onChange: (v) => dyPatch({ collect: v }) })),
            h(Row, { label: "分享" }, h(Switch, { checked: dyBrowse.share === true, onChange: (v) => dyPatch({ share: v }) })),
            h(Row, { label: "分享到私信" }, h(Switch, { checked: dyBrowse.shareInDm === true, onChange: (v) => dyPatch({ shareInDm: v }) })),
            h(Row, { label: "截图看画面" }, h(Switch, { checked: dyBrowse.frames === true, onChange: (v) => dyPatch({ frames: v }) })),
            h("div", { style: { marginTop: 8, borderTop: "1px solid rgba(128,128,128,0.14)", paddingTop: 6 } },
              h(Row, { label: "自动发图文" }, h(Switch, { checked: dyPost.enabled === true, onChange: (v) => postJson(`${FISH}/channels/douyin-config`, { post: { enabled: v } }).then((r) => { notify(r && r.ok ? "已保存" : `保存失败：${(r && r.error) || ""}`); void load(); }) })),
              h(Row, { label: "每天图文" }, h(Num, { value: dyPost.perDay ?? 1, min: 0, max: 5, onChange: (v) => postJson(`${FISH}/channels/douyin-config`, { post: { perDay: v } }).then(load) })),
              h(Row, { label: "回评论" }, h(Switch, { checked: dyComments.enabled === true, onChange: (v) => postJson(`${FISH}/channels/douyin-config`, { comments: { enabled: v } }).then((r) => { notify(r && r.ok ? "已保存" : `保存失败：${(r && r.error) || ""}`); void load(); }) })),
              h(Row, { label: "每小时评论" }, h(Num, { value: dyComments.perHour ?? 4, min: 0, max: 20, onChange: (v) => postJson(`${FISH}/channels/douyin-config`, { comments: { perHour: v } }).then(load) })),
              h(Row, { label: "带 emoji" }, h(Switch, { checked: dyComments.emoji === true, onChange: (v) => postJson(`${FISH}/channels/douyin-config`, { comments: { emoji: v } }).then(load) })))),
          h(Card, { title: "最近看过（只读）" },
            h("div", { style: { fontSize: 12, opacity: 0.7 } }, `B站 ${(bili.recent || []).length} 条 · 抖音 ${(douyin.recent || []).length} 条`),
            h("div", { style: { maxHeight: 240, overflow: "auto", marginTop: 6 } },
              (bili.recent || []).slice(0, 6).map((r, i) => h("div", { key: `b${i}`, style: { padding: "3px 0", borderTop: "1px solid rgba(128,128,128,0.1)", fontSize: 12 } },
                h("div", null, `[B站] ${r.title || ""}${r.owner ? ` · ${r.owner}` : ""}${r.liked ? " ❤" : ""}${r.favorited ? " ⭐" : ""}${r.skipped ? "（跳过）" : ""}`),
                r.impression ? h("div", { style: { opacity: 0.65 } }, String(r.impression).slice(0, 90)) : null)),
              (douyin.recent || []).slice(0, 6).map((r, i) => h("div", { key: `d${i}`, style: { padding: "3px 0", borderTop: "1px solid rgba(128,128,128,0.1)", fontSize: 12 } },
                h("div", null, `[抖音] ${r.title || ""}${r.author ? ` · ${r.author}` : ""}${r.liked ? " ❤" : ""}${r.skipped ? "（跳过）" : ""}`),
                r.impression ? h("div", { style: { opacity: 0.65 } }, String(r.impression).slice(0, 90)) : null)))),
          h(Card, { title: "主动开口（早安窗口）" },
            h(Row, { label: "启用" }, h(Switch, { checked: proactive.enabled !== false, onChange: (v) => postJson(`${FISH}/life/proactive-config`, { enabled: v }).then(load) })),
            h(Row, { label: "每天最多" }, h(Num, { value: proactive.dailyMaxCount ?? 10, min: 0, max: 50, onChange: (v) => postJson(`${FISH}/life/proactive-config`, { dailyMaxCount: v }).then(load) })),
            h(Row, { label: "活跃开始" }, h(Num, { value: (proactive.activeHours || [7, 24])[0] ?? 7, min: 0, max: 23, onChange: (v) => postJson(`${FISH}/life/proactive-config`, { activeHours: [v, 24] }).then(load) })),
            h("div", { style: styles.hint }, `当前窗口 ${(proactive.activeHours || []).join(" - ")} 点；早上 7 点后她自己可能来开口（其中包含原来的早安）。`)),
          h(Card, { title: "回复行为 / 主动性" },
            h(Row, { label: "心情影响语气" }, h(Switch, { checked: behaviorS?.config?.moodAffects !== false, onChange: (v) => postJson(`${FISH}/behavior/config`, { moodAffects: v }).then((r) => { notify(r && r.ok ? "已保存" : "保存失败"); void load(); }) })),
            h(Row, { label: "长句拆条" }, h(Switch, { checked: behaviorS?.config?.outFilter?.enabled !== false, onChange: (v) => postJson(`${FISH}/behavior/config`, { outFilter: { enabled: v } }).then((r) => { notify(r && r.ok ? "已保存" : "保存失败"); void load(); }) })),
            h(Row, { label: "合并转发长文" }, h(Switch, { checked: behaviorS?.config?.forward?.enabled !== false, onChange: (v) => postJson(`${FISH}/behavior/config`, { forward: { enabled: v } }).then((r) => { notify(r && r.ok ? "已保存" : "保存失败"); void load(); }) })),
            h(Row, { label: "群里热聊插话" }, h(Switch, { checked: behaviorS?.config?.heat?.enabled !== false, onChange: (v) => postJson(`${FISH}/behavior/config`, { heat: { enabled: v } }).then((r) => { notify(r && r.ok ? "已保存" : "保存失败"); void load(); }) })),
            h(Row, { label: "拍一拍回应" }, h(Switch, { checked: behaviorS?.config?.interactions?.pokeBack !== false, onChange: (v) => postJson(`${FISH}/behavior/config`, { interactions: { pokeBack: v } }).then((r) => { notify(r && r.ok ? "已保存" : "保存失败"); void load(); }) })),
            h(Row, { label: "打字中提示" }, h(Switch, { checked: behaviorS?.config?.interactions?.typing !== false, onChange: (v) => postJson(`${FISH}/behavior/config`, { interactions: { typing: v } }).then((r) => { notify(r && r.ok ? "已保存" : "保存失败"); void load(); }) })),
            h(Row, { label: "每轮判断心情" }, h(Switch, { checked: behaviorS?.config?.turnMood?.enabled !== false, onChange: (v) => postJson(`${FISH}/behavior/config`, { turnMood: { enabled: v } }).then((r) => { notify(r && r.ok ? "已保存" : "保存失败"); void load(); }) })),
            h("div", { style: styles.hint }, "这些都对应鱼自带「行为/互动」里的开关；改完即时生效。")),
        );
      };

            // 记忆（v0.3：搜索 / 删除 / 新增；数据走鱼的 /inspector/* 接口）
      const ownerNameOf = (ownerId) => {
        const hit = (memData?.persons || []).find((p) => p.ownerId === ownerId);
        return hit ? hit.displayName : ownerId;
      };
      const loadMem = async () => {
        setMemBusy(true);
        try {
          const qs = new URLSearchParams({ limit: "100" });
          if (memQuery.trim() !== "") qs.set("q", memQuery.trim());
          if (memKind !== "") qs.set("kind", memKind);
          if (memOwner !== "") qs.set("ownerId", memOwner);
          const r = await getJson(`${FISH}/inspector/overview?${qs.toString()}`);
          if (r && r.ok) { setMemData(r); setMemSel({}); }
          else notify(`读取记忆失败：${(r && r.error) || ""}`);
        } finally { setMemBusy(false); }
      };
      loadMemRef.current = loadMem;
      const toggleSel = (id) => setMemSel((prev) => {
        const next = { ...prev };
        if (next[id]) delete next[id]; else next[id] = true;
        return next;
      });
      const selectedIds = Object.keys(memSel).map(Number);
      const deleteSelected = async () => {
        if (selectedIds.length === 0) { notify("先勾选要删的记忆"); return; }
        setMemBusy(true);
        const r = await postJson(`${FISH}/inspector/forget`, { ids: selectedIds });
        setMemBusy(false);
        notify(r && r.ok ? `已删除 ${r.deleted ?? selectedIds.length} 条` : `删除失败：${(r && r.error) || ""}`);
        void loadMem();
      };
      const addMemory = async () => {
        const content = addContent.trim();
        if (content === "") { notify("先写点内容"); return; }
        setMemBusy(true);
        const r = await postJson(`${FISH}/inspector/memory-add`, { ownerId: addOwner, kind: addKind, content });
        setMemBusy(false);
        if (r && r.ok) { setAddContent(""); notify("已新增一条记忆"); void loadMem(); }
        else notify(`新增失败：${(r && r.error) || ""}`);
      };
      const memRows = memData?.memories || [];
      const exportMemories = async () => {
        try {
          const res = await fetch(`${FISH}/export/memories`, { headers: { accept: "application/json" } });
          const text = await res.text();
          const blob = new Blob([text], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `fish-memories-${new Date().toISOString().slice(0, 10)}.json`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 3000);
          notify("已导出记忆 JSON");
        } catch (e) { notify(`导出失败：${String(e)}`); }
      };
      const editMemory = async (m) => {
        const v = window.prompt("改这条记忆的内容（旧的会留档）", m.content);
        if (v === null || v.trim() === "") return;
        setMemBusy(true);
        const r = await postJson(`${FISH}/inspector/memory-edit`, { id: m.id, content: v });
        setMemBusy(false);
        notify(r && r.ok ? "已保存（旧的留档）" : `保存失败：${(r && r.error) || ""}`);
        void loadMem();
      };
      const lockMemory = async (m) => {
        const r = await postJson(`${FISH}/inspector/importance-lock`, { id: m.id, locked: m.importanceLocked !== true });
        notify(r && r.ok ? (m.importanceLocked ? "已解锁重要度" : "已锁定重要度") : `失败：${(r && r.error) || ""}`);
        void loadMem();
      };
      const restoreMemory = async (id) => {
        const r = await postJson(`${FISH}/inspector/memory-restore`, { id });
        notify(r && r.ok ? `已恢复 #${id}` : `恢复失败：${(r && r.error) || ""}`);
        void load();
      };
      const runBulk = async (dryRun) => {
        const filter = {};
        if (memOwner !== "") filter.ownerId = memOwner;
        if (memKind !== "") filter.kind = memKind;
        if (memQuery.trim() !== "") filter.q = memQuery.trim();
        let value = bulkValue;
        if (bulkAction === "importance" || bulkAction === "emotion") value = Number(bulkValue);
        if (!dryRun && bulkAction === "forget") {
          if (!window.confirm(`删除匹配的记忆？`)) return;
        }
        setMemBusy(true);
        const r = await postJson(`${FISH}/inspector/bulk`, { filter, action: bulkAction, value, dryRun });
        setMemBusy(false);
        if (r && r.ok) {
          setBulkResult({ ...r, dryRun });
          notify(dryRun ? `匹配 ${r.matched} 条` : `已改动 ${r.changed} 条`);
          if (!dryRun) { void load(); void loadMem(); }
        } else { setBulkResult({ error: (r && r.error) || "批量失败" }); notify(`批量失败：${(r && r.error) || ""}`); }
      };
      const MemoryTab = () => h("div", null,
        h("div", { style: styles.grid },
          h(Card, { title: "记忆概览" },
            h(Row, { label: "活跃记忆" }, h("span", null, db ? `${db.total} 条` : "—")),
            h(Row, { label: "最近一条" }, h("span", null, db?.latestAt ? fmtTime(db.latestAt) : "—")),
            h(Row, { label: "B站相关" }, h("span", null, db ? `${db.selfBili} 条` : "—")),
            h(Row, { label: "筛选结果" }, h("span", null, memData ? `${memData.matchedTotal ?? memRows.length} 条` : "—")),
            h("div", { style: { marginTop: 8, textAlign: "right" } },
              h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: exportMemories }, "导出全部记忆（JSON）"))),
          h(Card, { title: "新增一条记忆" },
            h(Row, { label: "内容" }, h(Text, { value: addContent, onChange: setAddContent, placeholder: "她该记住的事（≤500 字）" })),
            h(Row, { label: "类型" }, h(Select, { value: addKind, options: [["fact", "事实"], ["event", "事件"], ["feeling", "感受"], ["episode", "聊过的事"]], onChange: setAddKind })),
            h(Row, { label: "归属" }, h(Select, { value: addOwner, options: [["user:master", "主人"], ...(memData?.persons || []).filter((p) => p.ownerId !== "user:master").map((p) => [p.ownerId, p.displayName])], onChange: setAddOwner })),
            h("div", { style: { marginTop: 8, textAlign: "right" } },
              h("button", { type: "button", style: styles.btn(true), disabled: memBusy, onClick: addMemory }, "写入记忆")))),
        h("div", { style: { display: "flex", gap: 8, alignItems: "center", margin: "12px 0 8px", flexWrap: "wrap" } },
          h(Text, { value: memQuery, onChange: setMemQuery, placeholder: "搜内容…", style: { minWidth: 220 } }),
          h(Select, { value: memKind, options: [["", "全部类型"], ["fact", "事实"], ["event", "事件"], ["feeling", "感受"], ["episode", "聊过的事"], ["diary", "日记"]], onChange: setMemKind }),
          h(Select, { value: memOwner, options: [["", "全部人"], ...(memData?.persons || []).map((p) => [p.ownerId, p.displayName])], onChange: setMemOwner }),
          h("button", { type: "button", style: styles.btn(true), disabled: memBusy, onClick: () => loadMem() }, memBusy ? "查询中…" : "搜索"),
          h("button", { type: "button", style: styles.btn(false), disabled: memBusy || selectedIds.length === 0, onClick: deleteSelected }, `删除选中（${selectedIds.length}）`)),
        h("div", { style: { border: "1px solid rgba(128,128,128,0.22)", borderRadius: 10, padding: "6px 12px", maxHeight: 380, overflow: "auto" } },
          memData === null ? h("div", { style: { opacity: 0.6, padding: 8 } }, "加载中…")
            : memRows.length === 0 ? h("div", { style: { opacity: 0.6, padding: 8 } }, "没有匹配的记忆")
            : memRows.map((m) => h("div", { key: m.id, style: { display: "flex", gap: 10, padding: "6px 0", borderTop: "1px solid rgba(128,128,128,0.12)", alignItems: "flex-start" } },
              h("input", { type: "checkbox", checked: memSel[m.id] === true, onChange: () => toggleSel(m.id), style: { marginTop: 4 } }),
              h("div", { style: { flex: "1 1 auto", minWidth: 0 } },
                h("div", { style: { opacity: 0.55, fontSize: 11 } }, `#${m.id} · ${ownerNameOf(m.ownerId)} · ${m.channel} · ${m.kind} · 重要度 ${m.importance}${m.importanceLocked ? "🔒" : ""} · ${fmtTime(m.createdAt)}`),
                h("div", { style: { wordBreak: "break-word" } }, m.content),
                h("div", { style: { display: "flex", gap: 6, marginTop: 4 } },
                  h("button", { type: "button", style: styles.btn(false), disabled: memBusy, onClick: () => editMemory(m) }, "编辑"),
                  h("button", { type: "button", style: styles.btn(false), disabled: memBusy, onClick: () => lockMemory(m) }, m.importanceLocked ? "解锁重要度" : "锁重要度")))))),
        outdatedS && (outdatedS.total || 0) > 0 ? h(Card, { title: `失效 / 被改的记忆（${outdatedS.total}）` },
          h("div", { style: { maxHeight: 180, overflow: "auto" } },
            (outdatedS.items || []).map((m) => h("div", { key: m.id, style: { display: "flex", gap: 8, alignItems: "center", padding: "3px 0", borderTop: "1px solid rgba(128,128,128,0.1)" } },
              h("span", { style: { flex: "1 1 auto", fontSize: 12 } }, `#${m.id} · ${m.status || ""} · ${String(m.content || "").slice(0, 80)}`),
              h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: () => restoreMemory(m.id) }, "恢复"))))) : null,
        h(Card, { title: "按筛选批量操作" },
          h("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" } },
            h(Select, { value: bulkAction, options: [["importance", "改重要度"], ["emotion", "改情绪"], ["kind", "改类型"], ["visibility", "改可见性"], ["forget", "删除"], ["restore", "恢复"]], onChange: setBulkAction }),
            bulkAction === "kind" ? h(Select, { value: bulkValue, options: [["fact", "事实"], ["event", "事件"], ["feeling", "感受"], ["episode", "聊过的事"]], onChange: setBulkValue })
              : (bulkAction === "forget" || bulkAction === "restore") ? null : h(Text, { value: bulkValue, onChange: setBulkValue, placeholder: "值（重要度 1-5 / 情绪 -2..2 / 可见性 normal|private）", style: { minWidth: 200 } })),
          h("div", { style: styles.hint }, `作用范围＝当前筛选：${memOwner || "全部人"} / ${memKind || "全部类型"} / ${memQuery.trim() ? `“${memQuery.trim()}”` : "无关键词"}（安全起见至少要有一个筛选条件）`),
          h("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 } },
            h("button", { type: "button", style: styles.btn(false), disabled: memBusy, onClick: () => runBulk(true) }, "预览影响条数"),
            h("button", { type: "button", style: styles.btn(true), disabled: memBusy, onClick: () => runBulk(false) }, "应用")),
          bulkResult ? h("div", { style: { ...styles.mono, fontSize: 12, marginTop: 6 } },
            bulkResult.error ? `❌ ${bulkResult.error}` : `匹配 ${bulkResult.matched} 条，改动 ${bulkResult.changed} 条${bulkResult.dryRun ? "（预览）" : ""}`) : null),
        h(Card, { title: "记忆自动化" },
          h(Row, { label: "自动整理" }, h(Switch, { checked: memStateS?.autoExtract !== false, onChange: (v) => postJson(`${FISH}/memory/config`, { autoExtract: v }).then((r) => { notify(r && r.ok ? "已保存" : "保存失败"); void load(); }) })),
          h(Row, { label: "空闲分钟" }, h(Num, { value: memStateS?.idleMinutes ?? 10, min: 1, max: 240, onChange: (v) => postJson(`${FISH}/memory/config`, { idleMinutes: v }).then(load) })),
          h(Row, { label: "每次最多行" }, h(Num, { value: memStateS?.maxLines ?? 40, min: 10, max: 80, onChange: (v) => postJson(`${FISH}/memory/config`, { maxLines: v }).then(load) })),
          h(Row, { label: "复盘聊天" }, h(Switch, { checked: memStateS?.transcriptReview === true, onChange: (v) => postJson(`${FISH}/memory/config`, { transcriptReview: v }).then((r) => { notify(r && r.ok ? "已保存" : "保存失败"); void load(); }) })),
          h(Row, { label: "复盘行数" }, h(Num, { value: memStateS?.transcriptMaxLines ?? 40, min: 10, max: 200, onChange: (v) => postJson(`${FISH}/memory/config`, { transcriptMaxLines: v }).then(load) })),
          h("div", { style: styles.hint }, `当前状态：${memStateS?.running ? "正在整理" : "空闲"} · 待整理 ${memStateS?.pending ?? 0} 条`)),
        h("div", { style: styles.hint }, "编辑会保留旧版本可恢复；删除是软删除；新增会立刻进入她的记忆库。"));

      // ── 人格 ──────────────────────────────────────────────────────
      const PersonaTab = () => {
        const cur = personaS?.current || {};
        const templates = personaS?.templates || [];
        const growth = personaS?.growth || {};
        const doPersona = async (path, body, msg) => {
          setBusy(true);
          const r = await postJson(`${FISH}${path}`, body);
          setBusy(false);
          notify(r && r.ok ? msg : `失败：${(r && r.error) || ""}`);
          void load();
        };
        return h("div", { style: styles.grid },
          h(Card, { title: "当前人格" },
            h(Row, { label: "名字" }, h("span", null, cur.name || "—")),
            h(Row, { label: "来源" }, h("span", { style: styles.mono }, cur.source || "—")),
            h(Row, { label: "字数" }, h("span", null, `${cur.chars ?? 0} 字`)),
            h(Row, { label: "锚点" }, h("span", null, cur.anchor || "—")),
            h(Row, { label: "模板" }, h("span", null, cur.template || "自定义")),
            h(Row, { label: "世界书条目" }, h("span", null, `${cur.loreCount ?? 0} 条`)),
            h("div", { style: { display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" } },
              h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: () => doPersona("/persona/undo", {}, "已撤销到上一个人格") }, "撤销上一次更换"))),
          h(Card, { title: "换模板 / 成长" },
            h(Row, { label: "模板" }, h(Select, {
              value: "",
              options: [["", "选一个模板…"], ...templates.map((t) => [t.id, `${t.title}${t.tagline ? ` · ${t.tagline}` : ""}`])],
              onChange: (v) => {
                if (v === "") return;
                const t = templates.find((x) => x.id === v);
                if (!window.confirm(`换成模板「${(t && t.title) || v}」？当前人格卡会被替换（可撤销）。`)) return;
                void doPersona("/persona/apply", { templateId: v, fresh: false }, "人格已更换");
              },
            })),
            h(Row, { label: "自动成长" }, h(Switch, {
              checked: growth.config?.enabled === true,
              onChange: (v) => doPersona("/persona/growth", { enabled: v }, "成长开关已保存"),
            })),
            h(Row, { label: "成长记录" }, h("span", null, `${(growth.items || []).length} 条`)),
            h("div", { style: styles.hint }, "模板来自插件内置；更细的人格编辑可导入自己的角色卡。")),
          h(Card, { title: "导入角色卡" },
            h(Area, { value: cardText, placeholder: "粘贴角色卡 JSON（chara_card_v2 / V2 卡）", onChange: (e) => setCardText(e.target.value),
              style: { ...styles.input, width: "100%", minHeight: 110, boxSizing: "border-box", fontFamily: "inherit" } }),
            h("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8, flexWrap: "wrap" } },
              h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: () => doPersona("/persona/fresh", { enabled: !(personaS?.freshDefault === true) }, "已保存") }, personaS?.freshDefault === true ? "正在聊的也马上换：开" : "正在聊的也马上换：关"),
              h("button", { type: "button", style: styles.btn(true), disabled: busy || cardText.trim() === "", onClick: async () => {
                let card = null;
                try { card = JSON.parse(cardText); } catch (e) { notify(`JSON 解析失败：${e.message}`); return; }
                if (!window.confirm("用这张角色卡替换当前人格？可撤销。")) return;
                setBusy(true);
                const r = await postJson(`${FISH}/persona/apply`, { card, fresh: true });
                setBusy(false);
                notify(r && r.ok ? "角色卡已导入" : `导入失败：${(r && r.error) || ""}`);
                if (r && r.ok) setCardText("");
                void load();
              } }, "导入并启用"))));
      };

      // ── 模型 / 用量 ────────────────────────────────────────────────
      const ModelsTab = () => {
        const providers = models?.providers || [];
        const features = models?.features || [];
        const options = [["", "跟 DSH 默认"], ...providers.flatMap((p) => (p.models || []).map((m) => [`${p.id}|${m.id}`, `${p.name || p.id} / ${m.name || m.id}`]))];
        const usage = models?.usage7 ?? models?.usage30 ?? null;
        const chatModels = host.fish?.chatModels ?? null;
        const selVal = (s) => (s && s.provider && s.model ? `${s.provider}|${s.model}` : "");
        const parseSel = (v) => { const [provider, model] = v.split("|"); return { provider, model }; };
        const saveChatModels = (patch) => postJson(`${FISH}/chat-models/config`, patch).then((r) => {
          notify(r && r.ok ? "已保存" : `保存失败：${(r && r.error) || ""}`);
          void load();
        });
        return h("div", { style: styles.grid },
          h(Card, { title: "按功能选模型" },
            features.map((f) => {
              const val = f.selection ? `${f.selection.provider}|${f.selection.model}` : "";
              const cur = f.resolved ? `${f.resolved.provider}/${f.resolved.model}` : "—";
              return h(Row, { key: f.id, label: f.label || f.id },
                h("span", { style: { ...styles.mono, marginRight: 6, opacity: 0.65 } }, cur),
                h(Select, {
                  value: val,
                  options,
                  onChange: (v) => {
                    const [provider, model] = v.split("|");
                    const modelsPatch = { [f.id]: v === "" ? null : { provider, model } };
                    void postJson(`${FISH}/models/config`, { models: modelsPatch }).then((r) => {
                      notify(r && r.ok ? `${f.label || f.id} 已保存` : `保存失败：${(r && r.error) || ""}`);
                      void load();
                    });
                  },
                }));
            })),
          h(Card, { title: "用量 / 花费" },
            h(Row, { label: "7 天用量" }, h("span", { style: { ...styles.mono, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, usage ? JSON.stringify(usage).slice(0, 120) : "—")),
            h(Row, { label: "单价配置" }, h("span", { style: styles.mono, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, JSON.stringify(models?.prices || {}).slice(0, 120))),
            h(Row, { label: "最近错误" }, h("span", null, models?.lastError || "无")),
            h("div", { style: styles.hint }, "单价、详细花费在鱼自带「模型 → 用量与价格」里填；这里直接切每个功能用的模型。")),
          h(Card, { title: "按聊天选模型" },
            host.fish && Object.prototype.hasOwnProperty.call(host.fish, "chatModels") ? h("div", null,
              h(Row, { label: "私聊默认" }, h(Select, { value: selVal(chatModels?.private), options, onChange: (v) => saveChatModels({ private: v === "" ? null : parseSel(v) }) })),
              h(Row, { label: "群聊默认" }, h(Select, { value: selVal(chatModels?.group), options, onChange: (v) => saveChatModels({ group: v === "" ? null : parseSel(v) }) })),
              h("div", { style: { maxHeight: 160, overflow: "auto", marginTop: 4 } },
                (chatModels?.overrides || []).map((o) => h("div", { key: o.channelId, style: { display: "flex", gap: 8, alignItems: "center", padding: "3px 0", borderTop: "1px solid rgba(128,128,128,0.1)" } },
                  h("span", { style: { ...styles.mono, flex: "1 1 auto", fontSize: 12 } }, `${o.channelId} → ${o.selection ? `${o.selection.provider}/${o.selection.model}` : "默认"}`),
                  h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: () => saveChatModels({ channelId: o.channelId, selection: null }) }, "清除"))))
            ) : h("div", { style: styles.hint }, "（重启 DSH 后会显示当前按聊天配置）"),
            h("div", { style: styles.hint }, "这里设私聊/群聊默认模型，并清理单聊覆盖。")));
      };

      // ── 表情 / 黑话 ────────────────────────────────────────────────
      const StickersTab = () => {
        const cfg = stickersS?.config || {};
        const items = stickersS?.items || [];
        const ws = stickersS?.workspacePath || "";
        const stickerAct = async (path, body, msg, needWs) => {
          if (needWs && ws === "") { notify("QQ 工作区还没准备好（先连一次 QQ）"); return null; }
          setBusy(true);
          const r = await postJson(`${FISH}${path}`, { workspacePath: ws, ...(body || {}) });
          setBusy(false);
          notify(r && r.ok ? msg : `失败：${(r && r.error) || ""}`);
          void load();
          return r;
        };
        return h("div", { style: styles.grid },
          h(Card, { title: "表情包" },
            h(Row, { label: "自动收藏" }, h(Switch, { checked: cfg.collect === true, onChange: (v) => postJson(`${FISH}/stickers/config`, { collect: v }).then(load) })),
            h(Row, { label: "每天上限" }, h(Num, { value: cfg.perDay ?? 10, min: 0, max: 100, onChange: (v) => postJson(`${FISH}/stickers/config`, { perDay: v }).then(load) })),
            h(Row, { label: "已收藏" }, h("span", null, `${items.length} 个`)),
            h("div", { style: { maxHeight: 300, overflow: "auto", marginTop: 6 } },
              items.map((it) => h("div", { key: it.file, style: { padding: "4px 0", borderTop: "1px solid rgba(128,128,128,0.12)" } },
                h("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
                  h("img", {
                    src: `${FISH}/stickers/file?file=${encodeURIComponent(it.file)}&ws=${encodeURIComponent(ws)}`,
                    alt: "", style: { width: 30, height: 30, objectFit: "contain", borderRadius: 4, background: "rgba(128,128,128,0.12)" },
                    onError: (e) => { e.target.style.display = "none"; },
                  }),
                  h("span", { style: { ...styles.mono, flex: "1 1 auto" } }, `${it.file} ${it.exists === false ? "（文件丢失）" : ""}`),
                  h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: () => { const v = window.prompt("改标签（逗号分隔）", (it.tags || []).join(",")); if (v !== null) void stickerAct("/stickers/tags", { file: it.file, tags: v }, "标签已保存", true); } }, "改标签"),
                  h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: () => { const v = window.prompt("改成什么文件名", it.file); if (v !== null && v.trim() !== "") void stickerAct("/stickers/rename", { file: it.file, name: v.trim() }, "已改名", true); } }, "改名"),
                  h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: () => { if (!window.confirm(`删除表情「${it.file}」？`)) return; void stickerAct("/stickers/delete", { file: it.file }, "已删除", true); } }, "删除")),
                h("div", { style: { opacity: 0.65, fontSize: 12 } }, (it.tags || []).join(" / ") || "（没标签）")))),
            h("div", { style: { marginTop: 8, textAlign: "right" } },
              h("button", { type: "button", style: styles.btn(true), disabled: busy, onClick: async () => {
                setBusy(true);
                const r = await postJson(`${FISH}/stickers/backfill`, {});
                setBusy(false);
                notify(r && r.ok ? `补标签完成（${r.tagged ?? "?"} 个）` : `补标签失败：${(r && r.error) || ""}`);
                void load();
              } }, "给没标签的表情补标签")),
            h(Row, { label: "导入图片" }, h("input", {
              type: "file", accept: "image/*", style: { ...styles.input, fontSize: 12 },
              onChange: async (e) => {
                const f = e.target.files && e.target.files[0];
                if (!f) return;
                try {
                  const buf = await f.arrayBuffer();
                  const res = await fetch(`${FISH}/stickers/import`, { method: "POST", headers: { "content-type": f.type || "image/png" }, body: buf });
                  const j = await res.json().catch(() => null);
                  notify(j && j.ok ? `已导入 ${f.name}` : `导入失败：${(j && j.error) || res.status}`);
                } catch (err) { notify(`导入失败：${String(err)}`); }
                e.target.value = "";
                void load();
              },
            }))),
          h(Card, { title: "群里的说法（黑话）" },
            h(Row, { label: "启用" }, h(Switch, { checked: slangS?.config?.enabled !== false, onChange: (v) => postJson(`${FISH}/slang/config`, { enabled: v }).then(load) })),
            h(Row, { label: "表达习惯" }, h(Switch, { checked: slangS?.config?.expressions !== false, onChange: (v) => postJson(`${FISH}/slang/config`, { expressions: v }).then(load) })),
            h(Row, { label: "私聊也学" }, h(Switch, { checked: slangS?.config?.privateChats !== false, onChange: (v) => postJson(`${FISH}/slang/config`, { privateChats: v }).then(load) })),
            h("div", { style: { maxHeight: 320, overflow: "auto", marginTop: 6 } },
              (slangS?.groups || []).map((g) => h("div", { key: g.channelId, style: { padding: "6px 0", borderTop: "1px solid rgba(128,128,128,0.12)" } },
                h("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
                  h("span", { style: { fontWeight: 600, flex: "1 1 auto" } }, g.title || g.channelId),
                  h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: async () => {
                    setBusy(true);
                    const r = await postJson(`${FISH}/slang/learn`, { channelId: g.channelId });
                    setBusy(false);
                    notify(r && r.ok ? `学完：新增 ${r.added ?? 0} 个词` : `学习失败：${(r && r.error) || ""}`);
                    void load();
                  } }, "现在学一次"),
                  h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: async () => {
                    const term = window.prompt("要加的词 / 说法");
                    if (term === null || term.trim() === "") return;
                    const meaning = window.prompt("它的意思", "");
                    if (meaning === null) return;
                    const r = await postJson(`${FISH}/slang/edit`, { channelId: g.channelId, add: { term: term.trim(), meaning } });
                    notify(r && r.ok ? "已加词条" : `加词条失败：${(r && r.error) || ""}`);
                    void load();
                  } }, "加词条")),
                g.style ? h("div", { style: { opacity: 0.7, fontSize: 12 } }, `风格：${g.style}`) : null,
                (g.terms || []).slice(0, 8).map((t) => h("div", { key: t.term, style: { ...styles.mono, marginLeft: 10 } }, `· ${t.term} — ${t.meaning}`)))))),
        );
      };

      // ── 日志 / 备份 / 更新 ────────────────────────────────────────
      const LogsTab = () => {
        const entries = diagS?.entries || [];
        const bk = backupS || {};
        const up = updateS || {};
        const isLocal = up.local === true || String(up.current || "").includes("-local");
        return h("div", { style: styles.grid },
          h(Card, { title: "一键自检" },
            h(Row, { label: "结果" }, h("span", null, diagItems === null ? "未检查" : (diagItems.every((x) => x.ok) ? "全部正常" : `${diagItems.filter((x) => !x.ok).length} 项异常`))),
            h("div", { style: { maxHeight: 240, overflow: "auto", marginTop: 4 } },
              (diagItems || []).map((it) => h("div", { key: it.key, style: { padding: "3px 0", borderTop: "1px solid rgba(128,128,128,0.1)", fontSize: 12 } },
                h("div", null, `${it.ok ? "✅" : "❌"} ${it.label}：${it.detail || ""}`),
                it.hint ? h("div", { style: { opacity: 0.55, fontSize: 11 } }, it.hint) : null))),
            h("div", { style: { textAlign: "right", marginTop: 8 } },
              h("button", { type: "button", style: styles.btn(true), disabled: busy, onClick: async () => {
                setBusy(true);
                const r = await getJson(`${FISH}/diagnose`);
                setBusy(false);
                if (r && r.ok !== false) { setDiagItems(r.items || []); notify("自检完成"); }
                else notify(`自检失败：${(r && r.error) || ""}`);
              } }, "重新自检"))),
          h(Card, { title: "运行日志" },
            h(Row, { label: "条数" }, h("span", null, `${entries.length} 条`)),
            h("div", { style: { maxHeight: 260, overflow: "auto", marginTop: 6 } },
              entries.slice(0, 60).map((e, i) => h("div", { key: i, style: { padding: "3px 0", borderTop: "1px solid rgba(128,128,128,0.1)" } },
                h("div", { style: { fontSize: 12 } }, `${e.level || "info"} · ${e.label || e.key} ×${e.count || 1} · ${fmtTime(e.at)}`)))),
            h("div", { style: { marginTop: 8, textAlign: "right" } },
              h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: () => postJson(`${FISH}/diag-log/clear`, {}).then(load) }, "清空日志"))),
          h(Card, { title: "版本 / 更新" },
            h(Row, { label: "当前版本" }, h("span", null, up.current || fish.version || "—")),
            h(Row, { label: "最新版本" }, h("span", null, isLocal ? "—（本地维护）" : (up.latest || "—"))),
            h(Row, { label: "有更新" }, h("span", null, isLocal ? "不跟上游（fish-core）" : (up.hasUpdate ? "有" : "无"))),
            h(Row, { label: "上次检查" }, h("span", null, isLocal ? "不检查" : (up.checkedAt ? fmtTime(up.checkedAt) : "—"))),
            isLocal ? h(Row, { label: "维护方式" }, h("span", null, "改代码 → git commit → 重启 DSH")) : null,
            up.error ? h(Row, { label: "检查错误" }, h("span", null, up.error)) : null,
            !isLocal && up.notesUrl ? h(Row, { label: "发布页" }, h("span", { style: styles.mono }, up.notesUrl)) : null,
            isLocal ? h("div", { style: styles.hint }, "鱼是本地维护版（fish-core）：不再从 npm 更新，改完代码重启 DSH 即可。")
              : h("div", { style: { marginTop: 8, textAlign: "right" } },
                h("button", { type: "button", style: styles.btn(true), disabled: busy, onClick: async () => {
                  setBusy(true);
                  const r = await postJson(`${FISH}/update/check`, {});
                  setBusy(false);
                  notify(r && r.ok ? (r.hasUpdate ? `发现新版本 ${r.latest}` : "已是最新") : `检查失败：${(r && r.error) || ""}`);
                  void load();
                } }, "检查更新"),
                up.hasUpdate && up.canApply ? h("button", { type: "button", style: styles.btn(true), disabled: busy, onClick: async () => {
                  if (!window.confirm(`更新到 ${up.latest}？更新后可能需要重启 DSH。`)) return;
                  setBusy(true);
                  const r = await postJson(`${FISH}/update/apply`, {});
                  setBusy(false);
                  notify(r && r.ok ? "更新已开始/完成" : `更新失败：${(r && r.error) || ""}`);
                  void load();
                } }, "一键更新") : null)),
          h(Card, { title: "备份 / 恢复" },
            h(Row, { label: "自动备份" }, h(Switch, { checked: bk.auto !== false, onChange: async (v) => {
              const r = await postJson(`${FISH}/backup/config`, { auto: v, keep: bk.keep ?? 7 });
              notify(r && r.ok ? "已保存" : "保存失败");
              void load();
            } })),
            h(Row, { label: "保留份数" }, h(Num, { value: bk.keep ?? 7, min: 1, max: 60, onChange: async (v) => {
              const r = await postJson(`${FISH}/backup/config`, { auto: bk.auto !== false, keep: v });
              notify(r && r.ok ? "已保存" : "保存失败");
              void load();
            } })),
            h(Row, { label: "上次备份" }, h("span", null, bk.lastAt ? fmtTime(bk.lastAt) : "—")),
            h(Row, { label: "备份文件" }, h("span", null, `${(bk.list || []).length} 个`)),
            h("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8, flexWrap: "wrap" } },
              h("button", { type: "button", style: styles.btn(true), disabled: busy, onClick: async () => {
                setBusy(true);
                const r = await postJson(`${FISH}/backup/now`, {});
                setBusy(false);
                notify(r && r.ok ? "已备份" : `备份失败：${(r && r.error) || ""}`);
                void load();
              } }, "立即备份")),
            h("div", { style: { maxHeight: 160, overflow: "auto", marginTop: 6 } },
              (bk.list || []).slice(0, 8).map((b) => h("div", { key: b.file, style: { display: "flex", gap: 8, alignItems: "center", padding: "3px 0", borderTop: "1px solid rgba(128,128,128,0.1)" } },
                h("span", { style: { ...styles.mono, flex: "1 1 auto" } }, `${b.file}（${Math.round((b.size || 0) / 1024)} KB）`),
                h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: async () => {
                  if (!window.confirm(`把 ${b.file} 标记为「下次启动恢复」？当前库会先另存。`)) return;
                  const r = await postJson(`${FISH}/backup/restore`, { file: b.file });
                  notify(r && r.ok ? "已标记，重启 DSH 生效" : `操作失败：${(r && r.error) || ""}`);
                  void load();
                } }, "恢复到它")))),
            h("div", { style: styles.hint }, "恢复在下次 DSH 启动时执行；当前库会先自动另存。")));
      };

      // ── SurfCore 归档浏览 ────────────────────────────────────────
      const loadArchive = async () => {
        setArchiveBusy(true);
        try {
          const qs = new URLSearchParams({ kind: archiveKind, limit: "120" });
          if (archiveQ.trim() !== "") qs.set("q", archiveQ.trim());
          const r = await getJson(`${API}/archive?${qs.toString()}`);
          if (r && r.ok) { setArchiveS(r); setArchiveErr(""); }
          else { setArchiveErr(String((r && r.error) || "读归档失败")); notify(`读归档失败：${(r && r.error) || ""}`); }
        } finally { setArchiveBusy(false); }
      };
      loadArchiveRef.current = loadArchive;
      const ArchiveTab = () => {
        const kinds = [["cards", "记忆卡"], ["bili", "B站记忆"], ["diary", "B站日记"], ["watch", "观看历史"]];
        const counts = archiveS?.counts || {};
        const items = archiveS?.items || [];
        return h("div", null,
          h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, alignItems: "center" } },
            kinds.map(([k, label]) => h("button", {
              key: k, type: "button",
              style: styles.tab(archiveKind === k),
              onClick: () => { setArchiveKind(k); setArchiveS(null); window.setTimeout(() => loadArchiveRef.current?.(), 0); },
            }, `${label}${counts[k] != null ? `（${counts[k]}）` : ""}`)),
            h(Text, { value: archiveQ, onChange: setArchiveQ, placeholder: "筛关键词…", style: { minWidth: 180 } }),
            h("button", { type: "button", style: styles.btn(true), disabled: archiveBusy, onClick: () => loadArchive() }, archiveBusy ? "查询中…" : "筛选")),
          archiveErr ? h("div", { style: { border: "1px solid rgba(255,170,80,0.5)", borderRadius: 8, padding: "8px 10px", marginBottom: 8, fontSize: 12 } },
            h("div", null, `归档路由还没加载（${archiveErr}）：需要重启一次 DSH 才能逐条浏览。`),
            host.surfcore?.archive ? h("div", { style: { marginTop: 4 } },
              `已能从状态里读到：记忆卡 ${host.surfcore.archive.cardRecords} 条 · B站记忆 ${host.surfcore.archive.biliMemoryEntries} 条 · B站日记 ${host.surfcore.archive.diarySections} 篇 · 观看历史 ${host.surfcore.archive.watchCount} 条`) : null,
            h("div", { style: { marginTop: 6 } },
              h("button", { type: "button", style: styles.btn(false), onClick: () => postJson(`${API}/service`, { action: "open-surfcore-data" }) }, "打开 SurfCore 数据目录"))) : null,
          h("div", { style: { border: "1px solid rgba(128,128,128,0.22)", borderRadius: 10, padding: "6px 12px", maxHeight: 460, overflow: "auto" } },
            items.length === 0 ? h("div", { style: { opacity: 0.6, padding: 8 } }, archiveBusy ? "加载中…" : "没有记录")
              : items.map((it, i) => {
                if (archiveKind === "cards") {
                  return h("div", { key: i, style: { padding: "6px 0", borderTop: "1px solid rgba(128,128,128,0.12)" } },
                    h("div", { style: { opacity: 0.55, fontSize: 11 } }, `${fmtTime(Date.parse(it.at))} · ${it.scope || ""} · ${it.source || ""} · ${it.kind || ""} · 重要度 ${it.importance ?? "?"}`),
                    h("div", { style: { fontWeight: 600 } }, it.title || ""),
                    it.text && it.text !== it.title ? h("div", { style: { opacity: 0.85 } }, it.text) : null);
                }
                if (archiveKind === "bili") {
                  return h("div", { key: i, style: { padding: "6px 0", borderTop: "1px solid rgba(128,128,128,0.12)" } },
                    h("div", { style: { opacity: 0.55, fontSize: 11 } }, `${it.date || fmtTime(Date.parse(it.at))} · ${it.type}${it.score != null ? ` · ${it.score} 分` : ""}${it.favorite ? " · 收藏" : ""}`),
                    h("div", { style: { fontWeight: 600 } }, it.title || ""),
                    h("div", { style: { opacity: 0.85 } }, it.text || ""));
                }
                if (archiveKind === "diary") {
                  return h("div", { key: i, style: { padding: "8px 0", borderTop: "1px solid rgba(128,128,128,0.12)" } },
                    h("div", { style: { fontWeight: 600, marginBottom: 4 } }, it.title || ""),
                    h("div", { style: { whiteSpace: "pre-wrap", opacity: 0.88, fontSize: 12 } }, it.body || ""));
                }
                return h("div", { key: i, style: { padding: "5px 0", borderTop: "1px solid rgba(128,128,128,0.12)" } },
                  h("div", { style: { fontSize: 12 } }, `${fmtTime(Date.parse(it.at))} · ${it.up || ""}${it.favorite ? " · 收藏" : ""}`),
                  h("div", null, it.title || ""));
              })),
          h("div", { style: styles.hint }, "只读浏览 SurfCore 归档（记忆卡 / B站记忆 / 日记 / 观看历史）；不会改动任何文件。"));
      };

      // ── 人物 ──────────────────────────────────────────────────────
      const loadPerson = async (ownerId) => {
        if (!ownerId) return;
        setPersonBusy(true);
        const r = await getJson(`${FISH}/inspector/person?ownerId=${encodeURIComponent(ownerId)}`);
        setPersonBusy(false);
        if (r && r.ok) { setPersonD(r); setPersonName(r.person?.displayName || ""); }
        else notify(`读人物失败：${(r && r.error) || ""}`);
      };
      loadPersonRef.current = loadPerson;
      const savePerson = async (patch, msg) => {
        setPersonBusy(true);
        const r = await postJson(`${FISH}/inspector/person`, { ownerId: personOwner, ...patch });
        setPersonBusy(false);
        notify(r && r.ok ? msg : `保存失败：${(r && r.error) || ""}`);
        void loadPerson(personOwner);
      };
      const STAGE_OPTS = [["stranger", "陌生人"], ["acquaintance", "认识"], ["friend", "朋友"], ["close", "很熟"]];
      const PersonTab = () => {
        // 「鱼自身 (self)」不是 person 表里的人，/inspector/person 查不到它，只在记忆里当归属。
        const persons = (memData?.persons || []).filter((x) => String(x.ownerId || "").startsWith("user:"));
        const p = personD?.person || null;
        const mood = personD?.mood || null;
        const fieldDefs = personD?.fieldDefs || [];
        const fields = personD?.profileFields || {};
        const locked = personD?.lockedFields || [];
        const episodes = personD?.episodes || [];
        return h("div", { style: styles.grid },
          h(Card, { title: "选人" },
            h(Row, { label: "人物" }, h(Select, {
              value: personOwner,
              options: [["", "选一个人…"], ...persons.map((x) => [x.ownerId, `${x.displayName || x.canonicalId}（${x.memoryCount ?? 0} 条记忆）`])],
              onChange: (v) => { setPersonOwner(v); setPersonD(null); },
            })),
            p ? h("div", { style: { marginTop: 8 } },
              h(Row, { label: "关系" }, h("span", null, (STAGE_OPTS.find(([k]) => k === p.relationStage) || [p.relationStage, p.relationStage])[1])),
              h(Row, { label: "好感" }, h("span", null, `${p.affinity ?? "—"}`)),
              h(Row, { label: "互动次数" }, h("span", null, `${p.interactionCount ?? 0} 次`)),
              h(Row, { label: "最近见到" }, h("span", null, p.lastSeenAt ? fmtTime(p.lastSeenAt) : "—")),
              h(Row, { label: "阶段锁定" }, h("span", null, p.stageLocked ? "已锁定（手动）" : "自动"))) : null),
          h(Card, { title: "改称呼 / 关系" },
            p ? h("div", null,
              h(Row, { label: "称呼" }, h(Text, { value: personName, onChange: setPersonName, placeholder: "怎么称呼 TA" })),
              h("div", { style: { textAlign: "right", marginTop: 8 } },
                h("button", { type: "button", style: styles.btn(true), disabled: personBusy, onClick: () => savePerson({ displayName: personName.trim() }, "称呼已保存") }, "保存称呼")),
              h(Row, { label: "关系阶段" }, h(Select, { value: p.relationStage || "stranger", options: STAGE_OPTS, onChange: (v) => savePerson({ relationStage: v }, "关系阶段已设置") })),
              p.stageLocked ? h("div", { style: { marginTop: 8, textAlign: "right" } },
                h("button", { type: "button", style: styles.btn(false), disabled: personBusy, onClick: () => savePerson({ stageLocked: false }, "已改回自动") }, "改回自动升降")) : null,
              h("div", { style: { marginTop: 10, textAlign: "right" } },
                h("button", { type: "button", style: styles.btn(false), disabled: personBusy, onClick: async () => {
                  if (!window.confirm(`删除「${p.displayName || p.ownerId}」这个人？（主人和自己不能删）`)) return;
                  if (!window.confirm("再确认一次：人物关系会被标记删除，TA 的记忆进回收站（可恢复）。")) return;
                  const r = await postJson(`${FISH}/inspector/person/delete`, { ownerId: p.ownerId });
                  notify(r && r.ok ? "已删除" : `删除失败：${(r && r.error) || ""}`);
                  setPersonOwner("");
                  setPersonD(null);
                  void load();
                } }, "删除这个人"))) : null,
            h("div", { style: styles.hint }, "手动改阶段会锁住，之后好感只涨跌、不自动升降。")),
          h(Card, { title: "她的印象 / 心情" },
            mood ? h(Row, { label: "当前心情" }, h("span", null, `${mood.label || ""}（${mood.level ?? "?"}）${mood.reason ? ` · ${mood.reason}` : ""}`)) : h(Row, { label: "当前心情" }, h("span", null, "—")),
            (fieldDefs || []).length > 0 ? h("div", { style: { marginTop: 4 } },
              fieldDefs.map((f) => h("div", { key: f.id, style: { padding: "3px 0", borderTop: "1px solid rgba(128,128,128,0.1)" } },
                h("span", { style: { opacity: 0.6, fontSize: 12 } }, `${f.label}：`),
                h("span", null, fields[f.id] || "—"),
                locked.includes(f.id) ? h("span", { style: { opacity: 0.5, fontSize: 11 } }, "（已锁定）") : null))) : null,
            h("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 } },
              h("button", { type: "button", style: styles.btn(true), disabled: personBusy || !p, onClick: async () => {
                setPersonBusy(true);
                const r = await postJson(`${FISH}/inspector/dream`, { ownerId: personOwner });
                setPersonBusy(false);
                notify(r && r.ok ? "已整理一次印象" : `整理失败：${(r && r.error) || ""}`);
                void loadPerson(personOwner);
              } }, "现在整理一次印象")),
            h("div", { style: { maxHeight: 200, overflow: "auto", marginTop: 8 } },
              episodes.slice(0, 10).map((e) => h("div", { key: e.id, style: { padding: "3px 0", borderTop: "1px solid rgba(128,128,128,0.1)", fontSize: 12 } },
                `${fmtTime(e.at)} · ${e.channelId || ""} · ${e.content}`)))));
      };

      // ── 检索 ──────────────────────────────────────────────────────
      const RetrievalTab = () => {
        const cfg = retrievalS?.config || {};
        const cov = retrievalS?.coverage || {};
        return h("div", { style: styles.grid },
          h(Card, { title: "向量检索" },
            h(Row, { label: "启用" }, h(Switch, { checked: cfg.enabled !== false, onChange: (v) => postJson(`${FISH}/retrieval/config`, { enabled: v }).then((r) => { notify(r && r.ok ? "已保存" : "保存失败"); void load(); }) })),
            h(Row, { label: "端点" }, h(Text, { value: retBase ?? "", onChange: setRetBase, placeholder: "https://…/v1" })),
            h(Row, { label: "模型" }, h(Text, { value: retModel ?? "", onChange: setRetModel, placeholder: "embedding 模型名" })),
            h(Row, { label: "API Key" }, h(Text, { value: retKey, onChange: setRetKey, placeholder: cfg.hasApiKey ? `已保存 ${cfg.apiKeyMasked || "•••"}（留空不改）` : "sk-…" })),
            h("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10, flexWrap: "wrap" } },
              h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: async () => {
                setBusy(true);
                const r = await postJson(`${FISH}/retrieval/probe`, { baseURL: retBase, model: retModel, ...(retKey !== "" ? { apiKey: retKey } : {}) });
                setBusy(false);
                notify(r && r.ok ? `连接成功${r.dim ? `（${r.dim} 维）` : ""}` : `测试失败：${(r && r.error) || ""}`);
              } }, "测试连接"),
              h("button", { type: "button", style: styles.btn(true), disabled: busy, onClick: async () => {
                setBusy(true);
                const r = await postJson(`${FISH}/retrieval/config`, { baseURL: retBase, model: retModel, ...(retKey !== "" ? { apiKey: retKey } : {}) });
                setBusy(false);
                notify(r && r.ok ? "检索配置已保存" : `保存失败：${(r && r.error) || ""}`);
                setRetKey("");
                void load();
              } }, "保存配置")),
            h("div", { style: styles.hint }, "向量检索能让她更准地想起以前的事；不配也能用关键词召回。")),
          h(Card, { title: "索引状态" },
            h(Row, { label: "已向量化" }, h("span", null, `${cov.vectorizedCount ?? 0} / ${cov.totalActiveCount ?? 0}`)),
            h(Row, { label: "待补" }, h("span", null, `${cov.unvectorizedNewCount ?? 0} 条`)),
            h(Row, { label: "实时队列" }, h("span", null, `${cov.realtimeQueueLength ?? 0}`)),
            h(Row, { label: "限速" }, h("span", null, `${cov.rateLimitPerMin ?? "—"}/分钟`)),
            h(Row, { label: "融合方式" }, h("span", null, `${cfg.fusionMethod || "rrf"} · topK ${cfg.topK ?? 5} · 预算 ${cfg.tokenBudget ?? 1200}`)),
            h("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 } },
              h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: async () => {
                if (!window.confirm("重建向量索引？数据多时会跑一会儿。")) return;
                const r = await postJson(`${FISH}/retrieval/rebuild`, {});
                notify(r && r.ok ? "已开始重建" : `重建失败：${(r && r.error) || ""}`);
                void load();
              } }, "重建索引"))));
      };

      // ── 动态 / 整理 / 引导 ────────────────────────────────────────
      const DynamicsTab = () => {
        const decisions = activityS?.decisions || [];
        const dreams = activityS?.dreamLog || [];
        const paused = activityS?.paused || [];
        const weekly = weeklyS || {};
        const ob = onboardingS || {};
        const steps = ob.steps || [];
        return h("div", { style: styles.grid },
          h(Card, { title: "记忆整理" },
            h(Row, { label: "整理记忆" }, h("button", { type: "button", style: styles.btn(true), disabled: busy, onClick: async () => {
              setBusy(true);
              const r = await postJson(`${FISH}/memory/digest-now`, {});
              setBusy(false);
              notify(r && r.ok ? "已开始整理" : `失败：${(r && r.error) || ""}`);
            } }, "现在整理一次")),
            h(Row, { label: "周记" }, h("span", null, `自动 ${weekly.enabled === false ? "关" : "开"} · ${weekly.running ? "正在写" : "空闲"} · 最近 ${weekly.last ? fmtTime(weekly.last) : "—"}`)),
            h(Row, { label: "自动周记" }, h(Switch, { checked: weekly.enabled !== false, onChange: (v) => postJson(`${FISH}/memory/weekly/config`, { enabled: v }).then(load) })),
            h("div", { style: { textAlign: "right", marginTop: 8 } },
              h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: async () => {
                setBusy(true);
                const r = await postJson(`${FISH}/memory/weekly/run`, {});
                setBusy(false);
                notify(r && r.ok ? "已开始写周记" : `失败：${(r && r.error) || ""}`);
                void load();
              } }, "现在写一篇周记"))),
          h(Card, { title: "日记" },
            h(Row, { label: "现在写" }, h("button", { type: "button", style: styles.btn(true), disabled: busy, onClick: async () => {
              setBusy(true);
              const r = await postJson(`${FISH}/diary/write-now`, {});
              setBusy(false);
              if (r && r.ok && r.entry) { const e = r.entry; notify(`日记写好了：${String(e.title || e.text || "").slice(0, 40)}`); }
              else notify(`没写成：${(r && r.error) || ""}`);
              void load();
            } }, "写一篇日记")),
            h("div", { style: styles.hint }, "写日记会消耗模型额度；写好的内容进她的记忆与 B站归档。")),
          h(Card, { title: "动态（为什么回 / 没回）" },
            decisions.length === 0 ? h("div", { style: { opacity: 0.6, padding: 6 } }, "还没有动态记录")
              : h("div", { style: { maxHeight: 200, overflow: "auto" } }, decisions.slice(0, 15).map((d, i) => h("div", { key: i, style: { padding: "4px 0", borderTop: "1px solid rgba(128,128,128,0.1)", fontSize: 12 } },
                `${fmtTime(d.at)} · ${d.channelId || d.ownerId || ""} · ${d.kind || d.action || ""} · ${d.reason || d.summary || ""}`))),
            h(Row, { label: "Dream 记录" }, h("span", null, `${dreams.length} 条`)),
            h(Row, { label: "暂停的聊天" }, h("span", null, `${paused.length} 个`)),
            paused.length > 0 ? h("div", null, paused.map((s) => h("div", { key: s.channelId, style: { display: "flex", gap: 8, alignItems: "center", padding: "3px 0", borderTop: "1px solid rgba(128,128,128,0.1)" } },
              h("span", { style: { flex: "1 1 auto" } }, `${s.title || s.channelId}`),
              h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: async () => {
                const r = await postJson(`${FISH}/sessions/pause`, { channelId: s.channelId, minutes: -1 });
                notify(r && r.ok ? `已恢复 ${s.title || s.channelId}` : `恢复失败：${(r && r.error) || ""}`);
                void load();
              } }, "恢复回复")))) : null),
          h(Card, { title: "首次引导 / 配置检查" },
            h(Row, { label: "引导" }, h("span", null, ob.dismissed ? "已隐藏" : ob.done ? "已完成" : "进行中")),
            h("div", { style: { maxHeight: 180, overflow: "auto" } }, steps.map((s) => h("div", { key: s.id, style: { padding: "2px 0", fontSize: 12 } },
              `${s.done ? "✅" : "⬜"} ${s.title}${s.optional ? "（可选）" : ""}`))),
            ob.dismissed ? null : h("div", { style: { textAlign: "right", marginTop: 8 } },
              h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: async () => {
                const r = await postJson(`${FISH}/onboarding/dismiss`, {});
                notify(r && r.ok ? "已隐藏引导" : "操作失败");
                void load();
              } }, "不再显示引导"))));
      };

      // ── 世界书 ────────────────────────────────────────────────────
      const WorldTab = () => {
        const cfg = worldS?.config || {};
        const books = worldS?.books || [];
        const worldCfgAct = (body) => postJson(`${FISH}/worldinfo/config`, body).then((r) => { notify(r && r.ok ? "已保存" : "保存失败"); void load(); });
        return h("div", { style: styles.grid },
          h(Card, { title: "命中规则" },
            h(Row, { label: "人格卡条目" }, h("span", null, `${worldS?.cardEntries ?? 0} 条`)),
            h(Row, { label: "扫描深度" }, h(Num, { value: cfg.scanDepth ?? 4, min: 1, max: 20, onChange: (v) => worldCfgAct({ scanDepth: v }) })),
            h(Row, { label: "预算字数" }, h(Num, { value: cfg.budgetChars ?? 1200, min: 100, max: 8000, onChange: (v) => worldCfgAct({ budgetChars: v }) })),
            h(Row, { label: "最多命中" }, h(Num, { value: cfg.maxEntries ?? 6, min: 1, max: 50, onChange: (v) => worldCfgAct({ maxEntries: v }) }))),
          h(Card, { title: `外部世界书（${books.length} 本）` },
            books.length === 0 ? h("div", { style: { opacity: 0.6, padding: 6 } }, "还没有导入世界书")
              : h("div", { style: { maxHeight: 220, overflow: "auto" } }, books.map((b) => h("div", { key: b.id, style: { display: "flex", gap: 8, alignItems: "center", padding: "4px 0", borderTop: "1px solid rgba(128,128,128,0.12)" } },
                h("span", { style: { flex: "1 1 auto" } }, `${b.name}（${(b.entries || []).length} 条）${b.enabled ? "" : " · 已关"}`),
                h(Switch, { checked: b.enabled === true, onChange: (v) => postJson(`${FISH}/worldinfo/toggle`, { id: b.id, enabled: v }).then((r) => { notify(r && r.ok ? "已切换" : "切换失败"); void load(); }) }),
                h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: async () => {
                  if (!window.confirm(`删除世界书「${b.name}」？`)) return;
                  const r = await postJson(`${FISH}/worldinfo/delete`, { id: b.id });
                  notify(r && r.ok ? "已删除" : `失败：${(r && r.error) || ""}`);
                  void load();
                } }, "删除")))),
            h(Area, { value: worldText, placeholder: "粘贴世界书内容（JSON / YAML / 文本）", onChange: (e) => setWorldText(e.target.value),
              style: { ...styles.input, width: "100%", minHeight: 80, marginTop: 10, fontFamily: "inherit", boxSizing: "border-box" } }),
            h("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 } },
              h("button", { type: "button", style: styles.btn(false), disabled: busy || worldText.trim() === "", onClick: async () => {
                const lines = window.prompt("输入几条聊天里的话（每行一条）");
                if (lines === null) return;
                const r = await postJson(`${FISH}/worldinfo/test`, { text: lines });
                notify(r && r.ok ? `命中 ${(r.hits || []).length} 条` : `测试失败：${(r && r.error) || ""}`);
              } }, "测试命中"),
              h("button", { type: "button", style: styles.btn(true), disabled: busy || worldText.trim() === "", onClick: async () => {
                setBusy(true);
                const r = await postJson(`${FISH}/worldinfo/import`, { text: worldText, fileName: "panel-import" });
                setBusy(false);
                notify(r && r.ok ? `已导入《${r.imported?.name || "世界书"}》（${r.imported?.entries ?? 0} 条）` : `导入失败：${(r && r.error) || ""}`);
                if (r && r.ok) setWorldText("");
                void load();
              } }, "导入"))));
      };

      // ── 存储 / 存档 ────────────────────────────────────────────────
      const StorageTab = () => {
        const st = storageS || {};
        const ca = chatArchS || {};
        const gb = (n) => `${Math.round(((n || 0) / 1024 / 1024 / 1024) * 10) / 10} GB`;
        const loadJob = async () => {
          const r = await getJson(`${FISH}/import/history/state`);
          if (r && r.ok) setImportJob(r.job);
        };
        const doPreview = async () => {
          setBusy(true);
          const r = await postJson(`${FISH}/import/history/preview`, { text: importText, fileName: "panel-paste.txt", dbPath: "" });
          setBusy(false);
          if (r && r.ok) {
            setImportPreview(r);
            const self = {};
            for (const s of r.speakers || []) if (s.self) self[s.key] = true;
            setImportSelf(self);
            notify(`识别到 ${r.chatCount} 个聊天 / ${r.messageCount} 条消息`);
          } else notify(`预览失败：${(r && r.error) || ""}`);
        };
        const doStart = async () => {
          if (!importPreview) return;
          const selfKeys = Object.keys(importSelf).filter((k) => importSelf[k] === true);
          if (!window.confirm(`开始导入 ${importPreview.messageCount} 条消息（预计 ${importPreview.estimate?.calls ?? "?"} 次模型调用）？`)) return;
          setBusy(true);
          const r = await postJson(`${FISH}/import/history/start`, {
            previewId: importPreview.previewId,
            selfKeys,
            mapping: {},
            maxCalls: importPreview.estimate?.calls,
          });
          setBusy(false);
          if (r && r.ok) { setImportPreview(null); setImportText(""); setImportJob(r.job); notify("导入已开始，可在下面看进度"); void loadJob(); }
          else notify(`开始失败：${(r && r.error) || ""}`);
        };
        return h("div", { style: styles.grid },
          h(Card, { title: "数据库存档" },
            h(Row, { label: "自动存档" }, h(Switch, { checked: st.auto !== false, onChange: async (v) => {
              const r = await postJson(`${FISH}/storage/config`, { auto: v });
              notify(r && r.ok ? "已保存" : `保存失败：${(r && r.error) || ""}`);
              void load();
            } })),
            h(Row, { label: "数据库大小" }, h("span", null, `${Math.round((st.databaseBytes || 0) / 1024)} KB`)),
            h(Row, { label: "剩余空间" }, h("span", null, gb(st.freeBytes))),
            st.warning ? h(Row, { label: "警告" }, h("span", null, "磁盘空间紧张")) : null,
            h("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 } },
              h("button", { type: "button", style: styles.btn(true), disabled: busy, onClick: async () => {
                setBusy(true);
                const r = await postJson(`${FISH}/storage/snapshot`, {});
                setBusy(false);
                notify(r && r.ok ? "已存档" : `失败：${(r && r.error) || ""}`);
                void load();
              } }, "立刻存档")),
            h("div", { style: { maxHeight: 200, overflow: "auto", marginTop: 6 } },
              (st.files || []).length === 0 ? h("div", { style: { opacity: 0.6, padding: 6 } }, "还没有存档")
                : (st.files || []).map((f) => h("div", { key: f.file, style: { display: "flex", gap: 8, alignItems: "center", padding: "3px 0", borderTop: "1px solid rgba(128,128,128,0.1)" } },
                  h("span", { style: { ...styles.mono, flex: "1 1 auto" } }, `${f.file}（${Math.round((f.size || 0) / 1024)} KB）`),
                  h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: async () => {
                    if (!window.confirm(`把 ${f.file} 标记为「下次启动恢复」？`)) return;
                    const r = await postJson(`${FISH}/storage/restore`, { file: f.file });
                    notify(r && r.ok ? "已标记，重启 DSH 生效" : `失败：${(r && r.error) || ""}`);
                  } }, "恢复"),
                  h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: async () => {
                    if (!window.confirm(`删除存档 ${f.file}？`)) return;
                    const r = await postJson(`${FISH}/storage/delete`, { file: f.file });
                    notify(r && r.ok ? "已删除" : `失败：${(r && r.error) || ""}`);
                    void load();
                  } }, "删除")))),
            h("div", { style: styles.hint }, "数据库存档是 Soul 库的自动快照；恢复在下次 DSH 启动时执行。")),
          h(Card, { title: "聊天记录存档" },
            h(Row, { label: "启用" }, h(Switch, { checked: ca.enabled === true, onChange: (v) => postJson(`${FISH}/chat-archive/config`, { enabled: v, channels: ca.channels || [], days: ca.days || 30 }).then((r) => { notify(r && r.ok ? "已保存" : `保存失败：${(r && r.error) || ""}`); void load(); }) })),
            h(Row, { label: "保留天数" }, h(Num, { value: ca.days ?? 30, min: 1, max: 3650, onChange: (v) => postJson(`${FISH}/chat-archive/config`, { enabled: ca.enabled === true, channels: ca.channels || [], days: v }).then((r) => { notify(r && r.ok ? "已保存" : `保存失败：${(r && r.error) || ""}`); void load(); }) })),
            h(Row, { label: "已存消息" }, h("span", null, `${ca.count ?? 0} 条`)),
            h("div", { style: { maxHeight: 240, overflow: "auto", marginTop: 6 } },
              (ca.stored || []).map((s) => h("div", { key: s.channel, style: { display: "flex", gap: 8, alignItems: "center", padding: "3px 0", borderTop: "1px solid rgba(128,128,128,0.1)" } },
                h("span", { style: { flex: "1 1 auto" } }, `${s.channel}（${s.count} 条）`),
                h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: async () => {
                  setArchChannel(s.channel);
                  setArchMsgs(null);
                  const r = await getJson(`${FISH}/chat-archive/list?channel=${encodeURIComponent(s.channel)}&limit=60`);
                  if (r && r.ok) setArchMsgs(r.items || []); else notify(`读存档失败：${(r && r.error) || ""}`);
                } }, "查看"),
                h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: async () => {
                  if (!window.confirm(`清空 ${s.channel} 的聊天存档？`)) return;
                  const r = await postJson(`${FISH}/chat-archive/delete`, { channel: s.channel });
                  notify(r && r.ok ? "已清空" : `失败：${(r && r.error) || ""}`);
                  void load();
                } }, "清空")))),
            archMsgs ? h("div", { style: { marginTop: 8, borderTop: "1px solid rgba(128,128,128,0.2)", paddingTop: 6, maxHeight: 260, overflow: "auto" } },
              h("div", { style: { fontSize: 12, opacity: 0.7, marginBottom: 4 } }, `存档原文：${archChannel}`),
              (archMsgs || []).map((m) => h("div", { key: m.id, style: { padding: "2px 0", fontSize: 12 } },
                h("span", { style: { opacity: 0.55 } }, `${fmtTime(m.at)} ${m.who || ""}${m.self ? "（自己）" : ""}：`),
                h("span", null, String(m.content || "").slice(0, 200))))) : null,
            h("div", { style: styles.hint }, "聊天存档用于让她「记得以前聊过什么」的原文检索；可查看原文或按会话清理。")),
          h(Card, { title: "存档内容搜索（只读）" },
            h("div", { style: { display: "flex", gap: 8, alignItems: "center" } },
              h(Text, { value: storQ, onChange: setStorQ, placeholder: "在记忆/存档里搜内容…", style: { flex: "1 1 auto" } }),
              h("button", { type: "button", style: styles.btn(true), disabled: busy || storQ.trim() === "", onClick: async () => {
                setBusy(true);
                const r = await getJson(`${FISH}/storage/search?q=${encodeURIComponent(storQ.trim())}&limit=20`);
                setBusy(false);
                if (r && r.ok) { setStorRes(r.items || []); notify(`找到 ${(r.items || []).length} 条`); }
                else notify(`搜索失败：${(r && r.error) || ""}`);
              } }, "搜索")),
            storRes ? h("div", { style: { maxHeight: 220, overflow: "auto", marginTop: 6 } },
              storRes.length === 0 ? h("div", { style: { opacity: 0.6, padding: 6 } }, "没有匹配")
                : storRes.map((m) => h("div", { key: `${m.id}-${m.createdAt}`, style: { padding: "3px 0", borderTop: "1px solid rgba(128,128,128,0.1)", fontSize: 12 } },
                  h("div", { style: { opacity: 0.55 } }, `#${m.id} · ${m.ownerId || ""} · ${m.kind || ""} · ${m.visibility || ""} · ${fmtTime(m.createdAt)}`),
                  h("div", null, String(m.content || "").slice(0, 160))))) : null,
            h("div", { style: styles.hint }, "在记忆库里按关键词搜（只读，不会改任何东西）。")),
          h(Card, { title: "导入旧聊天（让她认识老朋友）" },
            h(Area, { value: importText, placeholder: "粘贴 QQ 导出的聊天记录 txt / SillyTavern jsonl / 消息 JSON；也可以选文件", onChange: (e) => setImportText(e.target.value),
              style: { ...styles.input, width: "100%", minHeight: 90, boxSizing: "border-box", fontFamily: "inherit" } }),
            h("div", { style: { display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" } },
              h("input", { type: "file", accept: ".txt,.json,.jsonl", style: { ...styles.input, fontSize: 12 }, onChange: async (e) => {
                const f = e.target.files && e.target.files[0];
                if (!f) return;
                try { setImportText(await f.text()); notify(`已读入 ${f.name}`); } catch (err) { notify(`读文件失败：${String(err)}`); }
                e.target.value = "";
              } }),
              h("button", { type: "button", style: styles.btn(true), disabled: busy || importText.trim() === "", onClick: doPreview }, "预览")),
            importPreview ? h("div", { style: { marginTop: 8 } },
              h("div", { style: { ...styles.mono, fontSize: 12 } }, `${importPreview.format} · ${importPreview.chatCount} 个聊天 · ${importPreview.messageCount} 条消息 · 预计 ${importPreview.estimate?.calls ?? "?"} 次模型调用`),
              h("div", { style: { marginTop: 4, fontSize: 12 } }, "谁算「我」（她自己的发言）："),
              h("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 } },
                (importPreview.speakers || []).map((s) => h("label", { key: s.key, style: { display: "flex", gap: 4, alignItems: "center", fontSize: 12 } },
                  h("input", { type: "checkbox", checked: importSelf[s.key] === true, onChange: () => setImportSelf((prev) => ({ ...prev, [s.key]: !(prev[s.key] === true) })) }),
                  `${s.name}${s.qq ? `(${s.qq})` : ""} ×${s.count}`))),
              (importPreview.warnings || []).length > 0 ? h("div", { style: styles.hint }, (importPreview.warnings || []).join("；")) : null,
              h("div", { style: { textAlign: "right", marginTop: 6 } },
                h("button", { type: "button", style: styles.btn(true), disabled: busy, onClick: doStart }, "开始导入"))) : null,
            h("div", { style: { marginTop: 10 } },
              h(Row, { label: "导入进度" }, h("span", null, importJob ? `${importJob.status || ""} · ${importJob.processed ?? 0}/${importJob.total ?? "?"}` : "没有进行中的导入")),
              importJob && importJob.errors && importJob.errors.length > 0 ? h("div", { style: { ...styles.mono, fontSize: 11, maxHeight: 80, overflow: "auto" } }, (importJob.errors || []).slice(0, 5).join("\n")) : null,
              h("div", { style: { display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6, flexWrap: "wrap" } },
                h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: () => loadJob() }, "刷新进度"),
                h("button", { type: "button", style: styles.btn(false), disabled: busy || !importJob, onClick: async () => {
                  if (!window.confirm("取消正在进行的导入？")) return;
                  const r = await postJson(`${FISH}/import/history/cancel`, {});
                  notify(r && r.ok ? "已取消" : "取消失败");
                  void loadJob();
                } }, "取消导入"),
                h("button", { type: "button", style: styles.btn(false), disabled: busy || !importJob || importJob.status === "running", onClick: async () => {
                  const r = await postJson(`${FISH}/import/history/resume`, { id: importJob?.id || "" });
                  notify(r && r.ok ? "已继续导入" : `继续失败：${(r && r.error) || ""}`);
                  void loadJob();
                } }, "继续上次导入"),
                h("button", { type: "button", style: styles.btn(false), disabled: busy || !importJob, onClick: async () => {
                  if (!window.confirm("放弃这份导入记录？")) return;
                  const r = await postJson(`${FISH}/import/history/discard`, { id: importJob?.id || "" });
                  notify(r && r.ok ? "已放弃" : `失败：${(r && r.error) || ""}`);
                  setImportJob(null);
                } }, "放弃这份导入"))),
            h("div", { style: styles.hint }, "支持 QQ 导出 txt、SillyTavern jsonl、消息/记忆 JSON。导入会消耗模型额度；同一份文件重复导入会提示。")));
      };

      // ── 联系（跨平台身份合并）────────────────────────────────────
      const loadContacts = async () => {
        setContactBusy(true);
        try {
          let list = null;
          const r = await getJson(`${FISH}/contacts/persons`);
          if (r && r.ok && Array.isArray(r.persons)) {
            list = r.persons;
          } else {
            // 兼容旧版（没有 /contacts/persons）：回退到 overview + person 详情
            const ov = await getJson(`${FISH}/inspector/overview?limit=1`);
            const persons = ((ov && ov.persons) || []).filter((x) => String(x.ownerId || "").startsWith("user:"));
            list = [];
            for (const x of persons) {
              const d = await getJson(`${FISH}/inspector/person?ownerId=${encodeURIComponent(x.ownerId)}`);
              const p = d && d.ok ? d.person : null;
              list.push({
                ownerId: x.ownerId, canonicalId: x.canonicalId, displayName: p?.displayName || x.displayName,
                relationStage: p?.relationStage || x.relationStage, qqUin: p?.qqUin || "",
                douyinUid: p?.douyinName || "", biliUid: p?.biliUid || "", memoryCount: x.memoryCount ?? 0,
                isMaster: x.canonicalId === "master",
              });
            }
          }
          setContacts(list);
          const drafts = {};
          for (const x of list) {
            drafts[x.ownerId] = { qq: x.qqUin || "", douyin: x.douyinUid || "", bili: x.biliUid || "" };
          }
          setContactDraft(drafts);
          const m = list.find((x) => x.canonicalId === "master") || null;
          setContactIds({
            qq: m?.qqUin || channels?.masterQqUin || "",
            douyin: m?.douyinUid || channels?.douyin?.masterUid || "",
            bili: m?.biliUid || channels?.bili?.masterUid || "",
          });
          setContactLinks(((channels?.bili?.links) || []).join("\n"));
        } finally { setContactBusy(false); }
      };
      loadContactsRef.current = loadContacts;
      const saveContactIds = async () => {
        setContactBusy(true);
        const jobs = [];
        if (contactIds.qq.trim() !== "") jobs.push(postJson(`${FISH}/channels/qq-config`, { masterQqUin: contactIds.qq.trim() }));
        if (contactIds.douyin.trim() !== "") jobs.push(postJson(`${FISH}/channels/douyin-config`, { masterUid: contactIds.douyin.trim() }));
        if (contactIds.bili.trim() !== "") jobs.push(postJson(`${FISH}/channels/bili-config`, { masterUid: contactIds.bili.trim() }));
        const results = await Promise.all(jobs);
        setContactBusy(false);
        const bad = results.filter((r) => !(r && r.ok));
        const msg = bad.length === 0
          ? "已保存：QQ / 抖音 / B站 的你现在关联在同一个「主人」身份上"
          : `有 ${bad.length} 项没保存成功：${bad.map((b) => (b && b.error) || "未知错误").join("；")}`;
        setContactMsg(msg);
        notify(bad.length === 0 ? "联系已保存" : "部分保存失败");
        void load();
        void loadContacts();
      };
      const saveContactLinks = async () => {
        const lines = contactLinks.split(/\r?\n/).map((x) => x.trim()).filter((x) => x !== "");
        setContactBusy(true);
        const r = await postJson(`${FISH}/channels/bili-config`, { links: lines });
        setContactBusy(false);
        const msg = r && r.ok ? `已保存 ${lines.length} 条 B站 ↔ QQ 对应` : `保存失败：${(r && r.error) || ""}`;
        setContactMsg(msg);
        notify(r && r.ok ? "B站对应表已保存" : "保存失败");
        void load();
        void loadContacts();
      };
      const savePersonLink = async (x) => {
        const d = contactDraft[x.ownerId] || { qq: "", douyin: "", bili: "" };
        const cur = contacts || [];
        const old = cur.find((y) => y.ownerId === x.ownerId) || {};
        const clearing = [];
        if (String(old.qqUin || "") !== "" && d.qq.trim() === "") clearing.push("QQ");
        if (String(old.douyinUid || "") !== "" && d.douyin.trim() === "") clearing.push("抖音");
        if (String(old.biliUid || "") !== "" && d.bili.trim() === "") clearing.push("B站");
        if (clearing.length > 0 && !window.confirm(`要解绑 ${x.displayName || x.canonicalId} 的 ${clearing.join("、")} 吗？记忆不会丢，只是不再按这个平台认人。`)) return;
        setContactBusy(true);
        const r = await postJson(`${FISH}/contacts/link`, {
          ownerId: x.ownerId,
          qqUin: d.qq.trim(),
          douyinUid: d.douyin.trim(),
          biliUid: d.bili.trim(),
        });
        setContactBusy(false);
        if (r && r.ok) {
          const merged = Array.isArray(r.merged) && r.merged.length > 0 ? `；已把 ${r.merged.join("、")} 并进这个人` : "";
          setContactMsg(`已保存 ${x.displayName || x.canonicalId} 的联系${merged}`);
          notify("联系已保存");
        } else {
          setContactMsg(`保存失败：${(r && r.error) || ""}`);
          notify(`保存失败：${(r && r.error) || ""}`);
        }
        void load();
        void loadContacts();
      };
      const ContactTab = () => {
        const people = contacts || [];
        const master = people.find((x) => x.canonicalId === "master") || null;
        const chips = (x) => {
          const v = x || {};
          return [
            { k: "QQ", v: v.qqUin ? String(v.qqUin) : "", ok: Boolean(v.qqUin) },
            { k: "抖音", v: v.douyinUid ? String(v.douyinUid).replace(/^douyin:/, "") : "", ok: Boolean(v.douyinUid) },
            { k: "B站", v: v.biliUid ? String(v.biliUid) : "", ok: Boolean(v.biliUid) },
          ];
        };
        const chipView = (list) => h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
          list.map((c) => h("span", {
            key: c.k,
            style: {
              fontSize: 11, padding: "1px 7px", borderRadius: 999,
              border: `1px solid ${c.ok ? "rgba(47,158,106,0.5)" : "rgba(128,128,128,0.28)"}`,
              background: c.ok ? "rgba(47,158,106,0.12)" : "transparent",
              opacity: c.ok ? 1 : 0.55,
            },
          }, `${c.k} ${c.ok ? c.v : "未联系"}`)));
        const boundCount = (x) => chips(x).filter((c) => c.ok).length;
        const others = people.filter((x) => x.canonicalId !== "master");
        return h("div", { style: styles.grid },
          h(Card, { title: "主人 · 三边联系" },
            h(Row, { label: "状态" }, h("span", null, master
              ? `${boundCount(master)}/3 个平台已联系 · 共 ${master.memoryCount ?? 0} 条记忆 · 关系 ${master.relationStage || "—"}`
              : "正在读取…")),
            h(Row, { label: "当前身份" }, chipView(chips(master))),
            h(Row, { label: "QQ 号" }, h(Text, { value: contactIds.qq, onChange: (v) => setContactIds({ ...contactIds, qq: v }), placeholder: "主人的 QQ 号" })),
            h(Row, { label: "抖音身份" }, h(Text, { value: contactIds.douyin, onChange: (v) => setContactIds({ ...contactIds, douyin: v }), placeholder: "douyin:<数字uid>" })),
            h(Row, { label: "B站 UID" }, h(Text, { value: contactIds.bili, onChange: (v) => setContactIds({ ...contactIds, bili: v }), placeholder: "主人的 B站 UID" })),
            h("div", { style: { textAlign: "right", marginTop: 8 } },
              h("button", { type: "button", style: styles.btn(true), disabled: contactBusy, onClick: saveContactIds }, "保存联系")),
            contactMsg ? h("div", { style: styles.hint }, contactMsg) : h("div", { style: styles.hint }, "这三个值就是「你在三个平台上是同一个人」的锚点；保存后她会把三边都记成 master。")),
          h(Card, { title: `其他人 · 三边联系（${others.length} 人）` },
            others.length === 0
              ? h("div", { style: { opacity: 0.65, padding: 6, fontSize: 12 } }, "还没有其他人：等朋友在 QQ / B站 / 抖音 给她发过消息后，这里会出现他们，然后就能把三边联系成同一个人。")
              : h("div", null, others.map((x) => {
                const d = contactDraft[x.ownerId] || { qq: "", douyin: "", bili: "" };
                const n = boundCount(x);
                return h("div", { key: x.ownerId, style: { padding: "8px 0", borderTop: "1px solid rgba(128,128,128,0.12)" } },
                  h("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 } },
                    h("span", { style: { fontWeight: 600 } }, x.displayName || x.canonicalId),
                    h("span", { style: { opacity: 0.55, fontSize: 11 } }, `${n >= 2 ? "已联系为同一个人" : n === 1 ? "仅一个平台" : "未联系"} · ${x.memoryCount ?? 0} 条记忆 · ${x.relationStage || "—"}`)),
                  h("div", { style: { marginBottom: 4 } }, chipView(chips(x))),
                  h(Row, { label: "QQ" }, h(Text, { value: d.qq, onChange: (v) => setContactDraft({ ...contactDraft, [x.ownerId]: { ...d, qq: v } }), placeholder: "QQ 号（留空=不绑）" })),
                  h(Row, { label: "抖音" }, h(Text, { value: d.douyin, onChange: (v) => setContactDraft({ ...contactDraft, [x.ownerId]: { ...d, douyin: v } }), placeholder: "数字 uid（留空=不绑）" })),
                  h(Row, { label: "B站" }, h(Text, { value: d.bili, onChange: (v) => setContactDraft({ ...contactDraft, [x.ownerId]: { ...d, bili: v } }), placeholder: "B站 UID（留空=不绑）" })),
                  h("div", { style: { textAlign: "right" } },
                    h("button", { type: "button", style: styles.btn(true), disabled: contactBusy, onClick: () => savePersonLink(x) }, "保存联系")));
              }))),
          h(Card, { title: "B站 ↔ QQ 自动对应表（可选）" },
            h("div", { style: styles.hint }, "一行一条：B站UID=QQ号。适合「人还没在 QQ 出现过」时先建好对应；已有的人直接在上面填更快。"),
            h(Area, {
              value: contactLinks,
              onChange: (e) => setContactLinks(e.target.value),
              placeholder: "123456789=100000001",
              style: { ...styles.input, width: "100%", minHeight: 70, marginTop: 8, boxSizing: "border-box", fontFamily: "inherit" },
            }),
            h("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 } },
              h("button", { type: "button", style: styles.btn(true), disabled: contactBusy, onClick: saveContactLinks }, "保存对应表"))),
          h(Card, { title: "「联系」是怎么认人的" },
            h("div", { style: { fontSize: 12, lineHeight: 1.7 } },
              "· 主人：以 QQ 号为主键，加上抖音身份（douyin:<uid>）和 B站 UID —— 三个都在配置里，就是同一个人（master）。",
              h("br"),
              "· 其它人在上面直接填三个平台的号：已经分开的两个人会被合并（记忆、互动次数、印象、心情都搬过去，不丢），之后新消息也按这三个身份认到同一个人。",
              h("br"),
              "· 留空并保存 = 解绑那个平台（只清身份，不动记忆）；抖音只能填数字 uid（昵称会改，不可靠）。",
              h("br"),
              "· 已联系的人：记忆、好感、印象、关系阶段共用同一份，不会出现「B站的你」和「QQ的你」两个人物。")));
      };

      // 服务 / 归档
      const runSelfTest = async () => {
        setBusy(true);
        const rows = [];
        const push = (name, ok, detail) => rows.push({ name, ok: ok === true, detail: String(detail ?? "") });
        const st = await getJson(`${API}/state`);
        push("Host /state", !!(st && st.ok), st && st.ok ? `warnings ${(st.warnings || []).length}` : (st && st.error));
        const ar = await getJson(`${API}/archive?kind=cards&limit=1`);
        push("归档路由 /archive", !!(ar && ar.ok), ar && ar.ok ? `记忆卡 ${ar.counts?.cards} / B站 ${ar.counts?.bili} / 日记 ${ar.counts?.diary} / 观看 ${ar.counts?.watch}` : `未加载：${(ar && ar.error) || ""}（重启 DSH 后可用）`);
        const ch = await getJson(`${FISH}/channels/state`);
        const dyRunning = ch && ch.douyin && (ch.douyin.channel?.running === true || ch.douyin.host?.state === "running");
        push("鱼 · 通道状态", !!(ch && ch.ok !== false), ch && ch.qq ? `QQ ${ch.qq.enabled ? "开" : "关"}${ch.qq.connected ? "（已连）" : ""} · B站 ${ch.bili?.enabled ? "开" : "关"}${ch.bili?.loggedIn ? "（已登录）" : ""} · 抖音 ${ch.douyin?.enabled ? "开" : "关"}${dyRunning ? "（轮询中）" : "（没跑）"}` : "");
        push("抖音 · 运行细节", !!dyRunning, ch && ch.douyin ? `channel.running=${ch.douyin.channel?.running === true} · host.state=${ch.douyin.host?.state ?? "?"} · 登录=${ch.douyin.host?.loggedIn === true ? "是" : "否"}${ch.douyin.channel?.lastPollAt ? ` · 最近轮询 ${fmtTime(ch.douyin.channel.lastPollAt)}` : ""}` : "没拿到抖音状态");
        const dg = await getJson(`${FISH}/diagnose`);
        const fixedDiag = fixChannelDiagnose((dg && dg.items) || [], ch && ch.ok !== false ? ch : null);
        const bad = fixedDiag.filter((x) => !x.ok);
        push("鱼 · 一键自检", !!(dg && dg.ok !== false), bad.length === 0 ? "全部正常" : `${bad.length} 项：${bad.map((x) => x.label).join("、")}`);
        const mem = await getJson(`${FISH}/inspector/overview?limit=1`);
        push("鱼 · 记忆接口", !!(mem && mem.ok), mem && mem.ok ? `活跃 ${mem.matchedTotal} 条` : (mem && mem.error));
        const vs = await getJson(`${FISH}/voice/state`);
        push("鱼 · 语音", !!(vs && vs.ok !== false), vs ? `TTS 剩余 ${vs.ttsLeft} 次 · STT 剩余 ${vs.sttLeft} 次` : "");
        push("按聊天模型暴露", !!(st && st.fish && Object.prototype.hasOwnProperty.call(st.fish, "chatModels")), st && st.fish && Object.prototype.hasOwnProperty.call(st.fish, "chatModels") ? "已加载" : "未加载（重启 DSH 后可用）");
        setSelfTest(rows);
        setBusy(false);
        notify(`自测完成：${rows.filter((r) => r.ok).length}/${rows.length} 通过`);
      };
      const doService = async (action, label) => {
        setBusy(true);
        const r = await postJson(`${API}/service`, { action });
        setBusy(false);
        notify(r && r.ok ? `${label}：已下发` : `${label}失败：${(r && r.error) || ""}`);
        window.setTimeout(load, 2500);
      };
      const ServiceTab = () => h("div", null,
        h("div", { style: styles.grid },
          h(Card, { title: "面板自测" },
            h("div", { style: { textAlign: "right" } },
              h("button", { type: "button", style: styles.btn(true), disabled: busy, onClick: runSelfTest }, busy ? "自测中…" : "跑一遍自测")),
            selfTest ? h("div", { style: { marginTop: 6 } },
              selfTest.map((r) => h("div", { key: r.name, style: { padding: "3px 0", borderTop: "1px solid rgba(128,128,128,0.1)", fontSize: 12 } },
                `${r.ok ? "✅" : "❌"} ${r.name}：${r.detail}`)))
              : h("div", { style: styles.hint }, "检查 面板 → Host → 鱼 每一层接口是否通；欢迎重启后点一次做验收。")),
          h(Card, { title: "本地服务" },
            h(Row, { label: "SnowLuma" }, h(Status, { ok: svc.snowluma?.http && svc.snowluma?.ws }, `${svc.snowluma?.http ? "HTTP✓" : "HTTP✕"} / ${svc.snowluma?.ws ? "WS✓" : "WS✕"}`)),
            h(Row, { label: "语音桥" }, h(Status, { ok: svc.voiceBridge?.up }, svc.voiceBridge?.up ? "在线" : "离线")),
            h(Row, { label: "看门狗" }, h("span", null, svc.watchdogPaused ? "已暂停" : "运行中")),
            h("div", { style: { display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", justifyContent: "flex-end" } },
              h("button", { type: "button", style: styles.btn(true), disabled: busy, onClick: () => doService("start-snowluma", "启动 SnowLuma") }, "启动 SnowLuma"),
              h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: () => doService("restart-snowluma", "重启 SnowLuma") }, "重启 SnowLuma"),
              h("button", { type: "button", style: styles.btn(true), disabled: busy, onClick: () => doService("start-voice-shim", "启动语音桥") }, "启动语音桥"),
              h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: () => doService(svc.watchdogPaused ? "watchdog-resume" : "watchdog-pause", "切换看门狗") }, svc.watchdogPaused ? "恢复看门狗" : "暂停看门狗"))),
          h(Card, { title: "版本信息" },
            h(Row, { label: "my fish 版本" }, h("span", null, host?.version || "—")),
            h(Row, { label: "鱼引擎版本" }, h("span", null, host?.engineVersion || "—")),
            h(Row, { label: "面板接口" }, h("span", { style: styles.mono }, "/api/plugins/my-fish")),
            h(Row, { label: "数据目录" }, h("span", { style: styles.mono }, host?.paths?.fishHome || "—")),
            h("div", { style: styles.hint }, "版本号来自插件 package.json；发布到 GitHub / 插件市场后按 tag 升级。")),
          h(Card, { title: "SurfCore 归档" },
            h(Row, { label: "记忆卡" }, h("span", null, sc.archive ? `${sc.archive.cardRecords} 条（QQ ${sc.archive.cardByScope?.qq ?? 0} / B站 ${sc.archive.cardByScope?.bili ?? 0}）` : "—")),
            h(Row, { label: "B站记忆库" }, h("span", null, sc.archive ? `${sc.archive.biliMemoryEntries} 条` : "—")),
            h(Row, { label: "观看历史" }, h("span", null, sc.archive ? `${sc.archive.watchCount} 条` : "—")),
            h(Row, { label: "B站日记" }, h("span", null, sc.archive ? `${sc.archive.diarySections} 篇${sc.archive.diaryLast?.length ? ` · ${sc.archive.diaryLast[0]}` : ""}` : "—")),
            h(Row, { label: "最近活动" }, h("span", null, sc.archive?.lastActiveAt ? fmtTime(sc.archive.lastActiveAt) : "—")),
            h(Row, { label: "数据目录" }, h("span", { style: styles.mono }, host.paths?.surfcoreData || "—")),
            h("div", { style: { display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", justifyContent: "flex-end" } },
              h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: () => doService("open-surfcore-data", "打开数据目录") }, "打开数据目录"),
              h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: () => doService("open-logs", "打开 SnowLuma 目录") }, "打开 SnowLuma 目录"))),
          h(Card, { title: "SurfCore → 鱼 记忆迁移" },
            h("div", { style: styles.hint }, "把 SurfCore 的记忆卡 / B站记忆 / 日记 / 观看历史再导入鱼（重复的会自动跳过）。"),
            h("div", { style: { display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" } },
              h("button", { type: "button", style: styles.btn(false), disabled: busy, onClick: async () => {
                setBusy(true); const r = await postJson(`${API}/migrate`, { dryRun: true }); setBusy(false);
                setMigrateOut(JSON.stringify(r, null, 2)); notify(r?.ok ? `预览：将新增 ${r.inserted} 条` : `预览失败：${r?.error || ""}`);
              } }, "预览"),
              h("button", { type: "button", style: styles.btn(true), disabled: busy, onClick: async () => {
                setBusy(true); const r = await postJson(`${API}/migrate`, { dryRun: false }); setBusy(false);
                setMigrateOut(JSON.stringify(r, null, 2)); notify(r?.ok ? `迁移完成：新增 ${r.inserted}，重复 ${r.duplicates}` : `迁移失败：${r?.error || ""}`);
                load();
              } }, "执行迁移")),
            migrateOut ? h("pre", { style: { ...styles.mono, whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto", marginTop: 8 } }, migrateOut) : null)),
      );

      // 路由
      const content = tab === "overview" ? Overview()
        : tab === "channels" ? ChannelTab()
        : tab === "voice" ? VoiceTab()
        : tab === "behavior" ? BehaviorTab()
        : tab === "contact" ? ContactTab()
        : tab === "memory" ? MemoryTab()
        : tab === "person" ? PersonTab()
        : tab === "persona" ? PersonaTab()
        : tab === "models" ? ModelsTab()
        : tab === "stickers" ? StickersTab()
        : tab === "retrieval" ? RetrievalTab()
        : tab === "logs" ? LogsTab()
        : tab === "dynamics" ? DynamicsTab()
        : tab === "world" ? WorldTab()
        : tab === "storage" ? StorageTab()
        : tab === "archive" ? ArchiveTab()
        : ServiceTab();

      return h("div", { style: styles.page, className: "fp2-root" },
        Header(),
        h("div", { style: styles.tabs },
          TabBtn("overview", "总览"), TabBtn("channels", "通道"), TabBtn("voice", "语音"),
          TabBtn("behavior", "B站 / 抖音"), TabBtn("contact", "联系"), TabBtn("memory", "记忆"), TabBtn("person", "人物"),
          TabBtn("persona", "人格"), TabBtn("models", "模型 / 用量"), TabBtn("stickers", "表情 / 黑话"),
          TabBtn("retrieval", "检索"), TabBtn("world", "世界书"), TabBtn("logs", "日志 / 备份"),
          TabBtn("dynamics", "动态 / 整理"), TabBtn("storage", "存储 / 存档"),
          TabBtn("archive", "归档浏览"), TabBtn("service", "服务 / 归档")),
        content,
        toast ? h("div", { role: "status", style: styles.toast }, toast) : null);
    }

    function PanelIcon({ size = 16 } = {}) {
      return h("svg", {
        width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
        strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
      },
        h("path", { d: "M4 7h16M4 12h10M4 17h13" }),
        h("circle", { cx: 19, cy: 17, r: 3 }));
    }

    function FullPage() {
      return h("div", { style: { height: "100%", boxSizing: "border-box" } }, h(Panel));
    }

    const inject = ["slots"];

    function apply(ctx) {
      ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section", id: "my-fish", order: 70, label: () => "my fish",
      }, Panel)), `${PLUGIN_ID}: settings`);

      ctx.effect(() => ctx.slots.inject("main", function* () {
        yield ctx.slots.register({ name: "main", key: PLUGIN_ID }, FullPage);
        yield ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
          name: "sidebar.panellist", id: PLUGIN_ID, order: 3, label: () => "my fish",
        }, PanelIcon));
        yield () => {
          const layout = typeof ctx.get === "function" ? ctx.get("layout") : null;
          if (layout && layout.panelInfo && layout.panelInfo.getSnapshot && layout.panelInfo.getSnapshot().activePanelId === PLUGIN_ID) {
            layout.selectPanel(null);
          }
        };
      }), `${PLUGIN_ID}: main panel`);
    }

    return { inject, apply };
  },
});

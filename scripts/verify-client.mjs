// 离线验证 my-fish 的 Client 半：用假 ModuleLoader + 假 React 跑一遍 factory/apply，
// 确认注册了哪些 slot（不改宿主、不需要浏览器）。
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const code = readFileSync(new URL('../client.js', import.meta.url), 'utf8');

const registrations = [];
const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  Fragment: 'Fragment',
};

let loaded = null;
globalThis.window = {
  __ModuleLoader__: {
    load: (entry) => { loaded = entry; },
  },
};

// 执行 client.js（不是 ESM，用 Function 包一层）
const fn = new Function('window', code);
fn(globalThis.window);
console.log('loader id:', loaded?.id);

const fakeRequire = (name) => {
  if (name === 'react') return fakeReact;
  throw new Error(`unexpected require: ${name}`);
};
const mod = loaded.factory(fakeRequire);
console.log('exports:', Object.keys(mod), '| inject:', mod.inject);

const ctx = {
  effect: (fn) => { const d = fn(); return () => d?.(); },
  get: () => null,
  slots: {
    inject: (owner, cb) => {
      const out = [];
      const it = cb();
      // main 用 generator，其余是函数
      if (it && typeof it.next === 'function') {
        for (let step = it.next(); !step.done; step = it.next()) out.push(step.value);
      } else {
        out.push(it);
      }
      return () => {};
    },
    register: (decl, comp) => {
      registrations.push({ name: decl?.name, id: decl?.id, key: decl?.key, label: typeof decl?.label === 'function' ? decl.label() : decl?.label, hasComponent: typeof comp === 'function' });
      return () => {};
    },
  },
};

mod.apply(ctx);
console.log('registrations:');
for (const r of registrations) console.log(' ', JSON.stringify(r));
const names = registrations.map((r) => r.name);
for (const need of ['settings.section', 'main', 'sidebar.panellist']) {
  if (!names.includes(need)) { console.error('MISSING slot:', need); process.exit(2); }
}
console.log('client half OK');

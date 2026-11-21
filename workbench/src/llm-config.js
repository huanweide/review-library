// 模型配置前端（2026-11-21）。
//
// 背景：以前分析、生成考点大全、生成考纲各弹一次框，每次都要重新粘一遍密钥。
// 用户原话：「就用环境变量的硅基流动（可保存住，可找模型，可设置）保存了使用」。
//
// 判据：
//   1) 密钥不经过前端——读状态只拿到掩码（sk-…qkoj）。前端能做的只有「设置/切换」。
//   2) 三处入口（设置页 / 分析对话框 / 生成文档对话框）共用本文件的同一套控件，
//      不各写一份表单——三份表单必然漂移成三种行为。
//   3) 已配置时**默认零表单**：点「开始」直接跑。要让用户看见表单，只有在真的缺配置时。
//   4) 找模型是按钮不是默认动作：/models 是一次网络请求，不该在打开界面时偷偷发。

import host from './host.js';
import { el, btn, field, input } from './ui.js';

const LEGACY = 'wb-llm'; // 旧版把 baseURL/model 存在 localStorage，仅作一次性预填

let cache = null;

/** 读配置（带进程内缓存；force=true 强制重读） */
export async function loadSettings(force) {
  if (cache && !force) return cache;
  const s = await host.settings();
  cache = s || { ok: false, error: '读不到配置' };
  return cache;
}

/** 保存配置；返回新的公开状态（仍不含密钥原文） */
export async function saveSettings(patch) {
  const s = await host.settings(patch || {});
  if (s && s.ok !== false) {
    cache = s;
    try { localStorage.removeItem(LEGACY); } catch (e) { /* 忽略 */ }
  }
  return s;
}

export async function findModels(override) {
  return host.models(override || {});
}

export async function testConnection(cfg) {
  return host.testSettings(cfg || {});
}

/** 旧版残留的地址/模型，只用于预填输入框，不会被当成「已配置」 */
function legacyPrefill() {
  try { return JSON.parse(localStorage.getItem(LEGACY) || '{}') || {}; } catch (e) { return {}; }
}

const SOURCE_LABEL = { file: '配置文件', env: '环境变量', input: '本次输入', none: '还没有' };

/** 一行人话，说清「现在能不能直接跑、密钥从哪来」 */
export function describeKeyState(s) {
  if (!s || s.ok === false) {
    return { text: '读不到配置：' + ((s && s.error) || '服务未连接'), kind: 'bad', ready: false };
  }
  if (!s.hasKey) {
    return { text: '还没有密钥：填一次即可，之后不用再填', kind: 'bad', ready: false };
  }
  const from = SOURCE_LABEL[s.keySource] || s.keySource;
  const model = s.model ? '，模型 ' + s.model : '，但还没有选模型';
  return { text: '已就绪 ' + s.keyHint + '（来自' + from + '）' + model, kind: 'good', ready: !!s.model };
}

/**
 * 配置控件组。返回 { node, read, refresh, find }。
 * read() 的 apiKey 为空字符串 = 「沿用已保存的」，不是「清空」——与后端 save 的语义一致。
 */
export function credentialFields(initial, opts) {
  const o = opts || {};
  const s = initial || {};
  const legacy = legacyPrefill();
  const base = input({ placeholder: 'https://api.siliconflow.cn/v1', value: s.baseURL || legacy.baseURL || '' });
  const key = input({
    type: 'password',
    autocomplete: 'off', // 浏览器别来提示「保存密码」：这是 API 密钥，不是登录密码
    placeholder: s.hasKey ? '已保存 ' + s.keyHint + '，留空即沿用' : 'sk-… 填一次就记住',
  });
  const model = input({ placeholder: 'deepseek-ai/DeepSeek-V4.1-Flash', value: s.model || legacy.model || '' });
  const vision = input({ placeholder: '可选：Qwen/Qwen3-VL-32B-Instruct（填了才会真看图配题）', value: s.visionModel || legacy.visionModel || '' });

  const chatSel = el('select', { class: 'input llm-sel hidden' });
  const visionSel = el('select', { class: 'input llm-sel hidden' });
  chatSel.addEventListener('change', () => { if (chatSel.value) model.value = chatSel.value; });
  visionSel.addEventListener('change', () => { if (visionSel.value) vision.value = visionSel.value; });

  const state = el('div', { class: 'llm-state ' + describeKeyState(s).kind, text: describeKeyState(s).text });

  const findBtn = btn('找模型', async () => {
    findBtn.disabled = true;
    const keep = state.textContent;
    state.className = 'llm-state';
    state.textContent = '正在向 ' + (base.value.trim() || '默认地址') + ' 要模型清单…';
    const r = await findModels({ baseURL: base.value.trim(), apiKey: key.value.trim() });
    findBtn.disabled = false;
    if (!r || r.ok === false) {
      state.className = 'llm-state bad';
      state.textContent = '找模型失败：' + ((r && r.error) || '未知原因') + '（也可以直接在上面手填模型名）';
      return;
    }
    const chat = (r.models || []).filter((m) => m.kind === 'chat');
    const vis = (r.models || []).filter((m) => m.kind === 'vision');
    const fill = (sel, list) => {
      sel.innerHTML = '';
      sel.appendChild(el('option', { value: '', text: '选一个填入上方（共 ' + list.length + ' 个）' }));
      list.forEach((m) => sel.appendChild(el('option', { value: m.id, text: m.id })));
      sel.classList.toggle('hidden', !list.length);
    };
    fill(chatSel, chat);
    fill(visionSel, vis);
    state.className = 'llm-state good';
    state.textContent = '共 ' + r.count + ' 个模型：' + chat.length + ' 个可对话，' + vis.length + ' 个可看图'
      + (r.keySource === 'none' ? '（没带密钥，可能不全）' : '');
    if (o.onFound) o.onFound(r);
    void keep;
  });

  const node = el('div', { class: 'llm-cfg' }, [
    field('API 地址', el('div', { class: 'llm-row' }, [base]), '硅基流动默认 https://api.siliconflow.cn/v1'),
    field('密钥', key, '住在服务端：环境变量 SILICONFLOW_API_KEY 或本机 library/settings.json，前端只拿到掩码'),
    field('对话模型', el('div', { class: 'llm-row' }, [model, findBtn]), '点「找模型」列出账号里全部可用模型'),
    chatSel,
    field('视觉模型（可选）', vision, '填了才会先读懂图再决定哪题配哪图；不填按图注配对'),
    visionSel,
    state,
  ]);

  return {
    node,
    read() {
      return {
        baseURL: base.value.trim(),
        model: model.value.trim(),
        visionModel: vision.value.trim(),
        apiKey: key.value.trim(), // 空 = 沿用
      };
    },
    setHint(text, kind) {
      state.className = 'llm-state ' + (kind || '');
      state.textContent = text;
    },
    find() { findBtn.click(); },
  };
}

/**
 * 通用配置对话框（Promise 版）。resolve(cfg) 表示用户确认并已保存；resolve(null) 表示取消。
 * cfg 里带 apiKey 时是「本次输入的」，不含时交给服务端补。
 */
export function credentialDialog(opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    loadSettings().then((s) => {
      const fields = credentialFields(s);
      const mask = el('div', { class: 'bs-mask' });
      // 取消按钮显式 type=button：默认 submit 会在 mask.remove() 之后仍触发一次提交，
      // 控制台留下 "Form submission canceled because the form is not connected" 噪声。
      const cancelBtn = btn('取消', () => { mask.remove(); resolve(null); }, 'ghost');
      cancelBtn.type = 'button';
      const dlg = el('form', { class: 'bs-dialog bs-dialog-wide' }, [
        el('h3', { text: o.title || '模型配置' }),
        el('p', { class: 'bs-sub', text: o.sub || '地址、模型与密钥存在本机服务里，保存一次以后不用再填。' }),
        fields.node,
        el('div', { class: 'bs-dialog-acts' }, [
          cancelBtn,
          btn(o.confirmLabel || '保存并使用', async () => {
            const r = fields.read();
            if (!r.model) { fields.setHint('还要选一个对话模型（点「找模型」或手填）', 'bad'); return; }
            if (!r.apiKey && !s.hasKey) { fields.setHint('还没有密钥：填一个 sk- 开头的密钥', 'bad'); return; }
            fields.setHint('正在保存…', '');
            const saved = await saveSettings({ baseURL: r.baseURL, model: r.model, visionModel: r.visionModel, apiKey: r.apiKey || undefined, deepDive: typeof o.deepDive === 'boolean' ? o.deepDive : undefined });
            if (!saved || saved.ok === false) {
              fields.setHint('保存失败：' + ((saved && saved.error) || '未知原因'), 'bad');
              return;
            }
            mask.remove();
            resolve(Object.assign({ baseURL: saved.baseURL, model: saved.model, visionModel: saved.visionModel || '' }, r.apiKey ? { apiKey: r.apiKey } : {}));
          }, 'primary'),
        ]),
      ]);
      mask.appendChild(dlg);
      document.body.appendChild(mask);
      mask.addEventListener('click', (e) => { if (e.target === mask) { mask.remove(); resolve(null); } });
      dlg.addEventListener('submit', (e) => e.preventDefault());
    });
  });
}

/**
 * 「能不能直接跑」——三处入口都先问这一句。
 * 已配置就返回 { ok:true }，调用方连弹窗都不该出现；缺配置才返回 settings 供调用方决定怎么问。
 */
export async function readiness() {
  const s = await loadSettings();
  const d = describeKeyState(s);
  return { ok: d.ready, settings: s, describe: d };
}

export default {
  loadSettings, saveSettings, findModels, testConnection, credentialFields,
  credentialDialog, readiness, describeKeyState,
};

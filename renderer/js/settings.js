'use strict';
// 全局设置：引擎 / API 连接 / 出题参数。
// 凭据分层（阶段零锚点 28/30）：
//   - apiKey 只进 sessionStorage，关标签页即失效，绝不进 localStorage、绝不写文件；
//   - 其余非敏感配置进 localStorage，下次打开还在；
//   - 任何日志、错误、截图都不出现密钥明文。
// 环境变量兜底（辅助测试）：RL_API_BASE / RL_API_KEY / RL_API_MODEL，仅在界面未填时使用（界面 > 环境变量）。
(function () {
  const CFG_KEY = 'rl-settings-v1';
  const KEY_KEY = 'rl-api-key';
  const DEFAULTS = { engine: 'local', baseURL: '', model: '', pointCount: 5, questionCount: 8, prompt: '', dedupeThreshold: 0.82 };

  // 服务商预设：选了就自动填地址与一个默认模型，并提示哪些模型带视觉能力（M3 看图）。
  const PROVIDERS = {
    custom: { base: '', model: '' },
    siliconflow: {
      base: 'https://api.siliconflow.cn/v1',
      model: 'deepseek-ai/DeepSeek-V4.1-Flash',
      note: '硅基流动：文本用 deepseek-ai/DeepSeek-V4.1-Flash；看图(能力 API)用 Qwen/Qwen3-VL-8B-Instruct(便宜) 或 Qwen/Qwen3-VL-32B-Instruct(质量)。'
    },
    deepseek: {
      base: 'https://api.deepseek.com',
      model: 'deepseek-flash',
      note: 'DeepSeek 官方：deepseek-flash 原生多模态(自带视觉能力)，可直接做 M3 看图；纯文本用 deepseek-v4-pro。注意地址不带 /v1。'
    }
  };

  // 已知支持图片输入的模型（命中即标 ✅ 能力 API）。其余以命名启发式兜底：含 vl / vision / omni 视为支持。
  const KNOWN_VISION = [
    'deepseek-flash', 'deepseek-v4-flash-vision-exp',
    'deepseek-ai/deepseek-v4.1-flash', 'deepseek-ai/deepseek-v4-flash',
    'qwen/qwen3-vl-8b-instruct', 'qwen/qwen3-vl-32b-instruct', 'qwen/qwen3-omni-30b-a3b-instruct',
    'deepseek-ai/deepseek-vl2', 'deepseek-ai/deepseek-vl', 'deepseek-ai/deepseek-ocr',
    'zai-org/glm-4.5v', 'glm-4.5v', 'qwen2.5-vl'
  ];
  function isVisionModel(m) {
    if (!m) return false;
    const s = String(m).toLowerCase().trim();
    if (!s) return false;
    if (KNOWN_VISION.some(v => s === v || s.endsWith('/' + v))) return true;
    return /vl|vision|omni/.test(s);
  }

  function loadCfg() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); }
    catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function getKey() { try { return sessionStorage.getItem(KEY_KEY) || ''; } catch (e) { return ''; } }
  function setKey(v) { try { v ? sessionStorage.setItem(KEY_KEY, v) : sessionStorage.removeItem(KEY_KEY); } catch (e) {} }
  function saveCfg(c) { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) {} }
  // 合并环境变量兜底：界面没填的字段才用环境变量的值（界面优先）。
  function cfg() {
    const c = loadCfg(); const e = Settings._env || {};
    return {
      baseURL: c.baseURL || e.baseURL || '',
      model: c.model || e.model || '',
      apiKey: getKey() || e.apiKey || ''
    };
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const $ = id => document.getElementById(id);
  const listeners = [];

  function updateVisionFlag() {
    const el = $('set-vision-flag'); if (!el) return;
    const m = ($('set-model').value || '').trim();
    if (!m) { el.textContent = ''; el.className = 'set-vision-flag'; return; }
    if (isVisionModel(m)) { el.textContent = '✅ 该模型支持看图（M3 多模态能力 API），分析时会读取资料内嵌图'; el.className = 'set-vision-flag ok'; }
    else { el.textContent = '⚠️ 该模型不支持看图，M3 会自动降级为纯文本（题目照常出，只是不引用图）'; el.className = 'set-vision-flag warn'; }
  }

  function providerOf(base) {
    const b = (base || '').trim().toLowerCase();
    if (b === PROVIDERS.siliconflow.base) return 'siliconflow';
    if (b === PROVIDERS.deepseek.base) return 'deepseek';
    return 'custom';
  }

  function syncFields(c) {
    const radios = document.querySelectorAll('input[name="set-engine"]');
    radios.forEach(r => { r.checked = (r.value === c.engine); });
    $('llm-fields').classList.toggle('hidden', c.engine !== 'llm');
    $('set-base').value = c.baseURL || '';
    $('set-model').value = c.model || '';
    $('set-points').value = c.pointCount;
    $('set-qcount').value = c.questionCount;
    $('set-dedupe').value = c.dedupeThreshold;
    $('set-prompt').value = c.prompt || '';
    // 密钥不回填到输入框（密码框）；若环境变量提供了密钥且界面为空，仅给占位提示，不显示明文。
    const envKey = (Settings._env && Settings._env.apiKey) || '';
    $('set-key').value = '';
    $('set-key').placeholder = (envKey && !getKey()) ? '（环境变量已提供密钥，留空即用）' : 'sk-…';
    // 服务商预设反显
    const sel = $('set-provider');
    if (sel) sel.value = providerOf(c.baseURL);
    updateVisionFlag();
    // 环境变量兜底提示
    const env = Settings._env || {};
    const envNote = $('set-env-note');
    if (envNote) {
      const parts = [];
      if (env.baseURL && !c.baseURL) parts.push('API 地址');
      if (env.model && !c.model) parts.push('模型名');
      if (env.apiKey && !getKey()) parts.push('密钥');
      envNote.textContent = parts.length ? ('（以下项来自环境变量：' + parts.join('、') + '，界面优先；已填则覆盖）') : '';
      envNote.style.display = parts.length ? '' : 'none';
    }
    $('set-engine-now').textContent = c.engine === 'llm'
      ? (getKey() || envKey ? '当前：云端引擎 · 密钥已就绪' : '当前：云端引擎 · 尚未填密钥，分析会失败')
      : '当前：本地引擎 · 完全离线，不发送任何资料';
    $('set-engine-now').className = 'set-status' + (c.engine === 'llm' && !(getKey() || envKey) ? ' warn' : '');
    updateBadge();
  }

  function updateBadge() {
    const c = loadCfg();
    const el = $('engine-badge');
    if (!el) return;
    el.textContent = c.engine === 'llm' ? '云端引擎' : '本地引擎';
    el.className = 'engine-badge ' + (c.engine === 'llm' ? 'cloud' : 'local');
  }

  function readForm() {
    const engine = (document.querySelector('input[name="set-engine"]:checked') || {}).value || 'local';
    return {
      engine,
      baseURL: $('set-base').value.trim(),
      model: $('set-model').value.trim(),
      pointCount: Math.max(3, Math.min(12, Number($('set-points').value) || 5)),
      questionCount: Math.max(2, Math.min(30, Number($('set-qcount').value) || 8)),
      dedupeThreshold: Math.max(0.6, Math.min(0.99, Number($('set-dedupe').value) || 0.82)),
      prompt: $('set-prompt').value.trim()
    };
  }

  function notify() { listeners.forEach(f => { try { f(loadCfg()); } catch (e) {} }); }

  // 检查更新状态回显（Electron 打包版由 main 进程推送；HTTP 模式无此能力，静默忽略）。
  function renderUpdateStatus(p) {
    const el = $('update-status'); if (!el || !p) return;
    const map = {
      checking: '正在检查更新…',
      uptodate: '已是最新版本',
      available: '发现新版本 ' + (p.version || '') + '，可更新',
      downloading: '正在下载更新… ' + (p.percent || 0) + '%',
      downloaded: '更新已下载，点「安装并重启」生效',
      error: '更新检查失败：' + (p.message || '')
    };
    el.textContent = map[p.state] || (p.state || '');
    el.className = 'set-test-result ' + (p.state === 'error' ? 'err' : (p.state === 'downloaded' || p.state === 'available' ? 'ok' : ''));
    const btn = $('set-install-update');
    if (btn) btn.style.display = (p.state === 'downloaded') ? '' : 'none';
  }

  const Settings = {
    load: loadCfg, cfg, getKey, setKey, saveCfg, updateBadge, _env: null,
    onChange(f) { listeners.push(f); },
    async init() {
      // 环境变量兜底：仅在 Electron 主进程侧读取，经 preload 桥接而来；HTTP/无主进程模式安全降级。
      try {
        if (API && API.app && API.app.env) {
          const e = await API.app.env();
          if (e && (e.baseURL || e.apiKey || e.model)) Settings._env = e;
        }
      } catch (e) { /* 取不到环境变量不影响使用 */ }
      document.querySelectorAll('input[name="set-engine"]').forEach(r => {
        r.onchange = () => { const c = loadCfg(); c.engine = r.value; saveCfg(c); syncFields(c); notify(); };
      });
      $('set-save').onclick = () => {
        const c = readForm(); saveCfg(c); setKey($('set-key').value.trim()); syncFields(c); notify();
        $('set-save-result').textContent = '已保存' + ((getKey() || (Settings._env && Settings._env.apiKey)) ? '（密钥仅在本标签页/环境变量有效）' : '');
        $('set-save-result').className = 'set-test-result ok';
      };
      $('set-clear-key').onclick = () => {
        setKey(''); $('set-key').value = ''; syncFields(loadCfg()); notify();
        $('set-test-result').textContent = '密钥已清空'; $('set-test-result').className = 'set-test-result';
      };
      $('set-test').onclick = async () => {
        const c = readForm(); const c2 = { baseURL: c.baseURL, model: c.model, apiKey: $('set-key').value.trim() || (Settings._env && Settings._env.apiKey) || '' };
        const out = $('set-test-result');
        out.textContent = '正在连接…'; out.className = 'set-test-result';
        try {
          const r = await API.llm.test(c2);
          out.textContent = r.ok ? ('连接成功' + (r.models && r.models.length ? '，可用模型 ' + r.models.length + ' 个' : '')) : ('失败：' + (r.error || '未知原因'));
          out.className = 'set-test-result ' + (r.ok ? 'ok' : 'err');
        } catch (e) { out.textContent = '失败：' + e.message; out.className = 'set-test-result err'; }
      };
      // 服务商预设：切换即填地址+默认模型（显式选预设＝明确要换服务商，直接覆盖），并给视觉能力提示。
      const sel = $('set-provider');
      if (sel) sel.onchange = () => {
        const p = PROVIDERS[sel.value] || PROVIDERS.custom;
        if (p.base) $('set-base').value = p.base;
        if (p.model) $('set-model').value = p.model;
        const note = $('set-provider-note');
        if (note) { note.textContent = p.note || ''; note.style.display = p.note ? '' : 'none'; }
        updateVisionFlag();
      };
      const note = $('set-provider-note');
      if (note && PROVIDERS[providerOf($('set-base').value)].note) { note.textContent = PROVIDERS[providerOf($('set-base').value)].note; }
      $('set-model').addEventListener('input', updateVisionFlag);
      // 检查更新（仅 Electron 打包版有效）
      const cu = $('set-check-update');
      if (cu) cu.onclick = async () => {
        const out = $('update-status');
        out.textContent = '正在检查…'; out.className = 'set-test-result';
        try { const r = await API.app.checkUpdate(); if (!r || !r.ok) out.textContent = (r && r.error) || '无法检查更新（开发模式/非 Electron）'; }
        catch (e) { out.textContent = e.message; }
      };
      if (API && API.app && API.app.onUpdateStatus) API.app.onUpdateStatus(renderUpdateStatus);
      const inst = $('set-install-update');
      if (inst) inst.onclick = async () => { try { await API.app.installUpdate(); } catch (e) {} };
      // 创建桌面快捷方式（仅 Electron 打包版有效）
      const sc = $('set-make-shortcut');
      if (sc) sc.onclick = async () => {
        const out = $('shortcut-status');
        try { const r = await API.app.createShortcut(); out.textContent = r && r.ok ? ('已创建桌面快捷方式：' + (r.path || '')) : ('失败：' + ((r && r.error) || '未知')); out.className = 'set-test-result ' + (r && r.ok ? 'ok' : 'err'); }
        catch (e) { out.textContent = e.message; out.className = 'set-test-result err'; }
      };
      syncFields(loadCfg());
    }
  };
  window.Settings = Settings;
})();

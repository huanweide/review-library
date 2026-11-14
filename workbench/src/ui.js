// 轻量 DOM 工具（workbench）：不引框架、零外链，保持项目「离线优先」约束。
// 只做 DOM 构造，不含业务逻辑。

export function el(tag, attrs, children) {
  const n = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach(k => {
    const v = attrs[k];
    if (v == null || v === false) return;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : String(v));
  });
  (Array.isArray(children) ? children : children != null ? [children] : []).forEach(c => {
    if (c == null || c === false) return;
    n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  });
  return n;
}

export const h = el;

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

export function card(title, body, opts) {
  const o = opts || {};
  return el('section', { class: 'card' + (o.class ? ' ' + o.class : '') }, [
    el('div', { class: 'card-head' }, [
      el('h3', { text: title }),
      o.action ? el('button', { class: 'btn ghost sm', onclick: o.action.fn, text: o.action.label }) : null,
    ]),
    el('div', { class: 'card-body' }, body),
  ]);
}

export function kv(rows) {
  return el('div', { class: 'kv' }, rows.map(([k, v]) =>
    el('div', { class: 'kv-row' }, [el('span', { class: 'kv-k', text: k }), el('span', { class: 'kv-v', text: String(v) })])));
}

export function badge(text, kind) {
  return el('span', { class: 'badge' + (kind ? ' ' + kind : ''), text });
}

export function empty(text, hint) {
  return el('div', { class: 'empty' }, [
    el('div', { class: 'empty-icon', text: '◇' }),
    el('div', { class: 'empty-title', text }),
    hint ? el('div', { class: 'empty-hint', text: hint }) : null,
  ]);
}

export function loading(text) {
  return el('div', { class: 'loading' }, [el('span', { class: 'spin' }), el('span', { text: text || '加载中…' })]);
}

export function errorBox(msg, retry) {
  return el('div', { class: 'errorbox' }, [
    el('div', { class: 'errorbox-title', text: '出错了' }),
    el('div', { class: 'errorbox-msg', text: String(msg || '') }),
    retry ? el('button', { class: 'btn', onclick: retry, text: '重试' }) : null,
  ]);
}

export function btn(label, fn, kind) {
  return el('button', { class: 'btn' + (kind ? ' ' + kind : ''), onclick: fn, text: label });
}

export function field(label, input, hint) {
  return el('label', { class: 'field' }, [
    el('span', { class: 'field-label', text: label }), input,
    hint ? el('span', { class: 'field-hint', text: hint }) : null,
  ]);
}

export function input(attrs) {
  return el('input', Object.assign({ class: 'input', type: 'text' }, attrs || {}));
}

export default { el, h, clear, card, kv, badge, empty, loading, errorBox, btn, field, input };

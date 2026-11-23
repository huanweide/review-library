/**
 * 就地资料阅读器（2026-11-23 需求6）：点左栏资料 → 浮层预览 PDF/图片/文档 + 就地改名。
 * 数据接口复用现成的 /api/app/file（host.rawFileUrl），不新造 action。
 * 渲染用浏览器原生能力，零新依赖；不支持的类型诚实给「下载查看」，不假装能读。
 */
import { el, btn } from './ui.js';
import host from './host.js';
import { toast } from './state.js';

const IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
const TEXT_EXT = ['txt', 'md'];

function extOf(name) { return String(name || '').split('.').pop().toLowerCase(); }

/** 渲染文件主体，返回 DOM 节点。 */
function bodyFor(file, url, onNeedDownload) {
  const ext = extOf(file.name);
  if (IMG_EXT.includes(ext)) {
    const wrap = el('div', { class: 'rd-imgwrap' });
    const img = el('img', { class: 'rd-img', src: url, alt: file.name });
    img.addEventListener('click', () => {
      const box = el('div', { class: 'rd-lightbox' }, [el('img', { src: url, alt: file.name })]);
      box.addEventListener('click', () => box.remove());
      document.body.appendChild(box);
    });
    wrap.appendChild(img);
    return wrap;
  }
  if (ext === 'pdf') return el('iframe', { class: 'rd-frame', src: url, title: file.name });
  if (TEXT_EXT.includes(ext)) {
    const pre = el('pre', { class: 'rd-text', text: '正在读取文本…' });
    fetch(url).then((r) => r.text()).then((t) => { pre.textContent = t.slice(0, 500000); })
      .catch(() => { pre.textContent = '文本读取失败，请下载查看。'; });
    return pre;
  }
  // docx/xlsx/pptx：浏览器原生多半支持预览；给 iframe + 明确的「下载查看」兜底按钮。
  const wrap = el('div', { class: 'rd-fallback' }, [
    el('p', { class: 'rd-fallback-t', text: '「' + ext.toUpperCase() + '」浏览器可能无法直接预览' }),
    el('p', { class: 'rd-fallback-h', text: '若下方空白，点这里下载后用本机 Office / WPS 打开。原文件未做任何修改。' }),
    btn('下载原文件', () => onNeedDownload(), 'ghost sm'),
  ]);
  const frame = el('iframe', { class: 'rd-frame', src: url, title: file.name });
  wrap.insertBefore(frame, wrap.firstChild);
  return wrap;
}

/**
 * 打开阅读器浮层。
 * @param bookId 书 id
 * @param file 资料记录（含 id/name/size/ext）
 * @param onChange 改名成功后的回调（父级刷新列表用）
 */
export function openReader(bookId, file, onChange) {
  document.querySelector('.rd-mask')?.remove();
  const url = host.rawFileUrl(bookId, file.id);
  if (!url) { toast('当前宿主不支持就地预览', 'bad'); return; }
  let name = String(file.name || '未命名');

  const titleInput = el('input', { class: 'rd-title-input', value: name, title: '在此改文件名，回车保存' });
  const saveBtn = btn('改名', async () => {
    const nm = titleInput.value.trim();
    if (!nm) return toast('名字不能为空', 'bad');
    if (nm === name) return toast('名字没变', 'info');
    const r = await host.action('mark', { bookId, fileId: file.id, name: nm });
    if (!r || r.ok === false) return toast((r && r.error) || '改名失败', 'bad');
    name = nm;
    file.name = nm;
    toast('已改名（只改显示名，不动磁盘文件）', 'ok');
    try { onChange && onChange(nm); } catch (e) { /* 回调失败不影响改名本身 */ }
  }, 'ghost sm');
  titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveBtn.click(); });

  const download = () => {
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  };

  const body = bodyFor(file, url, download);
  const mask = el('div', { class: 'rd-mask' }, [
    el('div', { class: 'rd-panel' }, [
      el('div', { class: 'rd-head' }, [
        el('span', { class: 'rd-badge', text: extOf(name).toUpperCase() || 'FILE' }),
        titleInput,
        saveBtn,
        btn('下载', download, 'ghost sm'),
        el('span', { class: 'rd-spacer' }),
        el('button', { class: 'rd-x', text: '×', title: '关闭', onclick: () => mask.remove() }),
      ]),
      el('div', { class: 'rd-sub', text: '原字节预览 · 未重编码 · 改名只影响书名，不影响原文与引用' }),
      body,
    ]),
  ]);
  mask.addEventListener('click', (e) => { if (e.target === mask) mask.remove(); });
  const onKey = (e) => { if (e.key === 'Escape' && document.body.contains(mask)) { mask.remove(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(mask);
  titleInput.focus(); titleInput.select();
  return mask;
}

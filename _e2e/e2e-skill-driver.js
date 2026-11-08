'use strict';
// review-analysis skill 离线驱动测试（无需浏览器，纯 Node）。
// 验证：driver.js 读 fixture library/ → 一轮轮驱动本地引擎 → 产出 圆满格式（report.md + mindmap.full.json）。
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../lib/store');

const ROOT = path.join(__dirname, '..');
const DRIVER = path.join(ROOT, 'skills', 'review-analysis', 'driver.js');

let pass = 0, fail = 0; const fails = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (extra ? ('  [' + extra + ']') : '')); }
}

const fx = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-driver-'));
const out = path.join(fx, 'out');

// 1) 构造 fixture 书（含一份带章节标题的资料，触发大纲抽取）
const s = Store(fx);
const b = s.createBook({ title: '材料科学基础', exam: '2026 期末', subject: '材料科学与工程', coverColor: '#3a7afe', note: '' });
const txt = `第一章 晶体结构
晶体是由原子、离子或分子在三维空间中作周期性规则排列所构成的固体。常见的金属晶体结构包括面心立方（FCC）、体心立方（BCC）和密排六方（HCP）三种典型堆积方式。
晶向与晶面是描述晶体取向的基本语言，米勒指数用于将晶面与晶向系统化标记。

第二章 二元相图
相图用来表示合金在不同温度与成分下的平衡相组成，是材料设计与热处理工艺选择的依据。
共晶反应是指液相在恒温下同时析出两种不同固相的转变过程，常见于 Pb-Sn 等低熔点合金体系。

第三章 晶体缺陷
真实晶体并非完美，点缺陷包括空位与间隙原子，它们的浓度随温度升高呈指数增长。
位错是一种线缺陷，刃型位错与螺型位错的滑移行为决定了金属的塑性变形能力。`;
s.addMaterials(b.id, 1, [{ name: '提纲.md', data: Buffer.from(txt).toString('base64'), extractedText: txt }], { prompt: '', tags: ['核心'] });
check('fixture 建书成功', !!(s.getBook(b.id) || {}).book);

// 2) 跑 driver（同项目理解：--project 指向 fixture；libDir 经回退解析到项目 lib/）
try {
  execFileSync('node', [DRIVER, '--project', fx, '--library', fx, '--out', out], { cwd: ROOT, stdio: 'pipe' });
} catch (e) {
  console.log('driver 运行异常：', e.stdout && e.stdout.toString(), e.stderr && e.stderr.toString());
  fail++; fails.push('driver 运行');
}

// 3) 断言 圆满格式产物
const mdPath = path.join(out, 'report.md');
const mmPath = path.join(out, 'mindmap.full.json');
check('report.md 已生成', fs.existsSync(mdPath));
if (fs.existsSync(mdPath)) {
  const md = fs.readFileSync(mdPath, 'utf8');
  check('report.md 非空且含书目表', md.length > 200 && md.includes('材料科学基础'), 'len=' + md.length);
  check('report.md 含「全展开大纲」', md.includes('考纲大纲') || md.includes('大纲'));
}
check('mindmap.full.json 已生成', fs.existsSync(mmPath));
if (fs.existsSync(mmPath)) {
  const mm = JSON.parse(fs.readFileSync(mmPath, 'utf8'));
  check('nodes > 0', mm.nodes.length > 0, 'n=' + mm.nodes.length);
  check('edges > 0', mm.edges.length > 0, 'e=' + mm.edges.length);
  check('fullExpanded === true', mm.fullExpanded === true);
  check('含 center 节点', mm.nodes.some(n => n.kind === 'center'));
  check('含 point 节点', mm.nodes.some(n => n.kind === 'point'));
  check('状态文件已记盘（同项目理解）', fs.existsSync(path.join(fx, 'REVIEW_ANALYSIS_STATE.json')));
}

console.log('\ne2e-skill-driver 结果：' + pass + ' 通过 / ' + fail + ' 失败');
fs.rmSync(fx, { recursive: true, force: true });
process.exit(fail ? 1 : 0);

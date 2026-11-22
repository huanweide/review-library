'use strict';
// 图片型书的图 id 提示词判别（2026-11-22）。
//
// 真 bug：book=理论力学，528 张页图全在磁盘、语料带（图id=xxx）、白名单也收了 528 个，
// 但 14 道题 imageIds 全空。根因是 buildMessages 的「原图清单」只看 vision 描述；
// 只转录未描述时，提示词明确叫模型「必须填 []」，与白名单口径相反。
// 本测试全部走真实调用，不 grep 源码。
//
// 用法：node test/analyze-imageid-prompt.test.js
const path = require('path');
const A = require(path.resolve(__dirname, '..', 'core', 'analyze.js'));

let pass = 0, fail = 0;
const ok = (cond, msg, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.error('  ✗ ' + msg + (extra ? '  [' + extra + ']' : '')); }
};

const withId = '【文件：视觉转录·1绪论.pdf】\n【页1】（图id=abc123）二力平衡公理：两力大小相等、方向相反、作用在同一直线上。\n';
const msgs = A.buildMessages('理论力学', withId, [], []);
const sys = (msgs.find(m => m.role === 'system') || {}).content || '';

ok(!/必须填 \[\]/.test(sys), 'P1 语料带图 id 时，提示词不再强制模型填 []');
ok(/图id=abc123/.test(sys) || /真实原图可用/.test(sys), 'P2 语料内图 id 被写进可用清单', sys.slice(-320));
ok(/如图|图中|示意图/.test(sys) && /必须填/.test(sys), 'P3 明确要求「如图题必须填图 id」');

// 反向守卫：确实没有图时仍要禁止编 id，别为了修上面把防线拆了。
const noImg = A.buildMessages('纯文字书', '【文件：讲义.txt】\n【块1】只有文字，没有任何图。', [], []);
const sys2 = (noImg.find(m => m.role === 'system') || {}).content || '';
ok(/必须填 \[\]/.test(sys2), 'P4 真无图时依旧要求 imageIds=[]（防编造）');

// vision 描述书：原清单不能丢。
const withVision = A.buildMessages('有描述的书', withId, [], ['【图N｜id=desc9】一张桁架受力图']);
const sys3 = (withVision.find(m => m.role === 'system') || {}).content || '';
ok(/id=desc9/.test(sys3), 'P5 既有 vision 描述仍进清单（不回退老书）');
ok(A.collectImageIds(withId).join(',') === 'abc123', 'P6 collectImageIds 只认（图id=…）标准写法');

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);

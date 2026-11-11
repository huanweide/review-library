'use strict';
// 今日复习 v2 判别测试：透明排程预览 + 大量刷题（fill）补满。
// 锁死两条不变量：① 每张卡带 next（四档下次间隔），② 到期不足时从 questionIndex 补满成连续会话。
// 用法：node test/review-v2.test.js
const srs = require('../lib/srs');
const review = require('../lib/review');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (extra ? ' [' + extra + ']' : ''))); };

// ---- 纯函数：previewNext 必须给出 1..4 四档的 dueAt，且 重来 <= 会了 <= 太简单 ----
(function previewNextTests() {
  const now = 1700000000000;
  const nx = srs.previewNext(null, now);
  ok('previewNext 返回 4 档', Array.isArray(nx) && nx.length === 4, 'len=' + (nx && nx.length));
  ok('每档带 label 与 dueAt', nx.every(x => x.label && typeof x.dueAt === 'number'), JSON.stringify(nx.map(x => x.label)));
  ok('重来最早、太简单最晚（重来<=会了<=太简单）',
    nx[0].dueAt <= nx[2].dueAt && nx[2].dueAt <= nx[3].dueAt,
    nx.map(x => x.dueAt).join(','));
  ok('太简单下次间隔 > 0', nx[3].dueAt > now, 'dueAt=' + nx[3].dueAt);
  // 有 srs 状态时，会了本次的 dueAt 应晚于无状态时（记忆已稳定）
  const nx2 = srs.previewNext({ stability: 5, difficulty: 3, lapses: 0 }, now);
  ok('有稳定期时「会了」排期更靠后', nx2[2].dueAt > nx[2].dueAt,
    nx2[2].dueAt + ' > ' + nx[2].dueAt);
})();

// ---- 队列：到期卡优先 + 填充补满 ----
(function queueTests() {
  const now = Date.now();
  const fakeStore = {
    listBooks: () => [{ id: 'b1', title: '书一' }, { id: 'b2', title: '书二' }],
    getMistakes: (id) => id === 'b1'
      ? [{ pointId: 'p_due', title: '到期知识点', srs: { dueAt: now - 1000 }, lapseCount: 3, box: 1 }]
      : [],
    getAnalysis: (id) => id === 'b1' ? ({
      questionIndex: [{
        type: '选择题',
        items: [
          { pointId: 'p_drill1', title: '加练点一', questions: [{ id: 'q1', stem: '加练点一的题干？', answer: '加练点一的答案' }] },
          { pointId: 'p_drill2', title: '加练点二', questions: [{ id: 'q2', stem: '加练点二的题干？', answer: '加练点二的答案' }] }
        ]
      }]
    }) : null
  };

  const onlyDue = review.queueAcrossBooks(fakeStore, now, { limit: 80, fill: 0 });
  ok('fill=0 只排到期卡', onlyDue.length === 1 && onlyDue[0].tag === 'due', 'len=' + onlyDue.length + ' tag=' + (onlyDue[0] && onlyDue[0].tag));
  ok('到期卡带 next 四档预览', onlyDue[0].next && onlyDue[0].next.length === 4, JSON.stringify(onlyDue[0] && onlyDue[0].next && onlyDue[0].next.length));

  const filled = review.queueAcrossBooks(fakeStore, now, { limit: 80, fill: 80 });
  ok('填充后队列变大（大量刷题）', filled.length === 3, 'len=' + filled.length);
  ok('到期卡排在最前', filled[0].tag === 'due', 'first=' + filled[0].tag);
  ok('填充卡 tag=drill 且带 next', filled.slice(1).every(c => c.tag === 'drill' && c.next && c.next.length === 4),
    filled.slice(1).map(c => c.tag).join(','));
  ok('drill 卡用真实题干/答案（非占位）', filled[1].prompt.indexOf('加练点一') >= 0 && filled[1].answer === '加练点一的答案',
    filled[1].prompt + ' | ' + filled[1].answer);
  // 不重复：due 的 p_due 不应再出现在 drill
  const ids = filled.map(c => c.bookId + '|' + c.pointId);
  ok('无重复卡（去重）', new Set(ids).size === ids.length, ids.join(','));
})();

console.log('\n今日复习 v2 判别测试：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);

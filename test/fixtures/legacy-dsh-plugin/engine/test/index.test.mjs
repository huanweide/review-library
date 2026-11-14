import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { name, inject, apply } from '../../index.js';

const LIB = 'C:/Users/Administrator/Desktop/agent program/复习资料图书馆/library';
const OUT = 'C:/Users/Administrator/Desktop/rlbuild/plugins/dsh-review-analysis/_test-out';

test('plugin 元数据正确（name / inject / apply）', () => {
  assert.equal(name, 'dsh-review-analysis');
  assert.deepEqual(inject, ['tools']);
  assert.equal(typeof apply, 'function');
});

test('apply 注册 review_analysis 工具，execute 跑通真实资料库', async () => {
  let def = null;
  const ctx = {
    effect(fn) { fn(); },
    tools: {
      register(d) { def = d; return () => {}; },
    },
  };
  apply(ctx);
  assert.ok(def, '工具定义应被注册');
  assert.equal(def.name, 'review_analysis');
  assert.equal(typeof def.execute, 'function');

  fs.rmSync(OUT, { recursive: true, force: true });
  const res = await def.execute({ library: LIB, out: OUT });
  assert.equal(res.ok, true, '分析应成功：' + (res.excerpt || ''));
  assert.ok(res.bookCount >= 1, '至少分析一本书');
  assert.ok(res.nodeCount > 0, '应产出节点');
  assert.ok(res.edgeCount > 0, '应产出边');
  assert.ok(fs.existsSync(res.report), 'report.md 应落盘');
  assert.ok(fs.existsSync(res.mindmap), 'mindmap.full.json 应落盘');

  // output.render 应产出文本块
  const blocks = def.output.render({}, res);
  assert.ok(Array.isArray(blocks) && blocks.length > 0);
  assert.equal(blocks[0].type, 'text');
  assert.ok(typeof blocks[0].text === 'string' && blocks[0].text.length > 0);

  fs.rmSync(OUT, { recursive: true, force: true });
});

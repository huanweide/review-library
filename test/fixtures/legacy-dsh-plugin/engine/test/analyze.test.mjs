import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { analyze } from '../analyze.js';

const LIB = 'C:/Users/Administrator/Desktop/agent program/复习资料图书馆/library';
const OUT = 'C:/Users/Administrator/Desktop/rlbuild/plugins/dsh-review-analysis/_engine-out';

test('analyze 对真实资料库产出 report.md / mindmap.full.json / book-reports.json', () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  const r = analyze({ library: LIB, out: OUT });
  assert.equal(r.ok, true);
  assert.equal(r.bookCount, 2, '应分析 2 本书');
  assert.ok(r.nodeCount > 0, '应产出节点');
  assert.ok(r.edgeCount > 0, '应产出边');
  assert.ok(Array.isArray(r.books) && r.books.length === 2);

  assert.ok(fs.existsSync(path.join(OUT, 'report.md')), 'report.md 存在');
  assert.ok(fs.existsSync(path.join(OUT, 'mindmap.full.json')), 'mindmap.full.json 存在');
  assert.ok(fs.existsSync(path.join(OUT, 'book-reports.json')), 'book-reports.json 存在');

  // 全展开 JSON 结构校验
  const mm = JSON.parse(fs.readFileSync(path.join(OUT, 'mindmap.full.json'), 'utf8'));
  assert.ok(Array.isArray(mm.nodes) && mm.nodes.length === r.nodeCount);
  assert.ok(Array.isArray(mm.edges) && mm.edges.length === r.edgeCount);
  assert.ok(mm.nodes.some((n) => n.kind === 'center'), '应有中心节点');

  fs.rmSync(OUT, { recursive: true, force: true });
});

test('analyze 指定单本书只分析该书', () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  const r = analyze({ library: LIB, out: OUT, book: '工程材料' });
  assert.equal(r.bookCount, 1);
  assert.equal(r.books[0].title, '工程材料');
  fs.rmSync(OUT, { recursive: true, force: true });
});

// dsh-review-analysis —— DeepSeek Harness（Cordis 引擎）插件入口。
//
// 注册一个离线工具 review_analysis：读取复习资料库，生成考纲大纲、规则版
// 思维导图（全展开）与 Markdown 总报告。全程纯本地、零外部依赖、不联网。
//
// 关于依赖：本插件刻意不 import '@deepseek-ai/dsh-tools'（在 local-plugins
// 安装路径下该依赖无法解析），而是直接构造 Cordis 的 ToolDefinition 对象，
// 通过 ctx.tools.register 注册——与官方示例 dsh-think-zh 一样保持自包含。
// 引擎本体在 ./engine（CommonJS，零依赖），本文件用 createRequire 桥接，
// 因为本包是 type:module（Cordis 插件入口要求 ESM export const apply）。

import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { analyze } = require('./engine/analyze.js');

export const name = 'dsh-review-analysis';
// 只需 tools 服务即可注册工具。
export const inject = ['tools'];

// 直接构造 ToolDefinition（ctx.tools.register 接受原始定义对象，无需 defineTool 包装）。
const reviewAnalysisTool = {
  name: 'review_analysis',
  description:
    '离线分析复习资料库：读取资料库目录，为每本书生成考纲大纲、规则版思维导图（全展开节点与边）与 Markdown 总报告。' +
    '纯本地运行、零外部依赖、不联网、不调用模型。' +
    '参数 library 为资料库根目录（含各书子目录，每本含 book.json 与 materials.json）；' +
    'out 为输出目录（缺省为 <library>/../review-analysis-out），报告写入 report.md、思维导图写入 mindmap.full.json。',
  parameters: {
    type: 'object',
    properties: {
      library: {
        type: 'string',
        description: '复习资料库根目录的绝对路径（包含各本书子目录，每本含 book.json 与 materials.json）',
      },
      out: {
        type: 'string',
        description: '输出目录（报告与思维导图写入处）；缺省为 <library>/../review-analysis-out',
      },
      book: {
        type: 'string',
        description: '只分析指定书名或 book id；缺省分析全部书目',
      },
    },
    required: ['library'],
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ok: { type: 'boolean' },
        out: { type: 'string' },
        bookCount: { type: 'integer' },
        nodeCount: { type: 'integer' },
        edgeCount: { type: 'integer' },
        report: { type: 'string' },
        mindmap: { type: 'string' },
        books: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              materials: { type: 'integer' },
              maps: { type: 'integer' },
            },
            required: ['id', 'title', 'materials', 'maps'],
          },
        },
        excerpt: { type: 'string' },
      },
      required: ['ok', 'out', 'bookCount', 'nodeCount', 'edgeCount'],
    },
    render: (_args, value) => [{
      type: 'text',
      text:
        `✅ 复习分析完成：分析 ${value.bookCount} 本，思维导图节点 ${value.nodeCount} / 边 ${value.edgeCount}（全展开）。\n` +
        `报告：${value.report || ''}\n` +
        `思维导图：${value.mindmap || ''}\n` +
        `书目：${(value.books || []).map((b) => `《${b.title}》(${b.materials}份资料,${b.maps}张图)`).join('；')}\n\n` +
        `--- 报告节选 ---\n${value.excerpt || ''}`,
    }],
  },
  async execute(args) {
    try {
      const out = args.out
        ? path.resolve(args.out)
        : path.resolve(path.resolve(args.library), '..', 'review-analysis-out');
      const result = analyze({
        library: path.resolve(args.library),
        out,
        book: args.book || undefined,
        rounds: 999,
      });
      result.report = path.join(out, 'report.md');
      result.mindmap = path.join(out, 'mindmap.full.json');
      return result;
    } catch (e) {
      return {
        ok: false,
        out: '',
        bookCount: 0,
        nodeCount: 0,
        edgeCount: 0,
        excerpt: '分析失败：' + (e && e.message ? e.message : String(e)),
      };
    }
  },
};

export function apply(ctx) {
  ctx.effect(() => ctx.tools.register(reviewAnalysisTool), 'dsh-review-analysis: review_analysis tool');
}

/**
 * books/index.js —— 天道书院 · 书架索引（静态，先于应用脚本加载）
 * 新增一本书的标准流程（不再手写 book-data.js）：
 *   1. 在书馆跑 LLM 分析得到 analysis.json；
 *   2. node tools/build_book.js <analysis.json> <id> <书名> [科目] [files.json] [documents.json]
 *   3. 在这里加一条书目。
 * 书目录约定：
 *   books/<id>/
 *     book-data.js   → window.BOOKS['<id>'] = 统一 bookData（由构建器生成，勿手改）
 *     files.json     → 书馆文件清单（focus/note 语义重点）
 *     refs/          → 参考资料原文件（点开即读）
 */
window.BOOK_INDEX = [
  {
    id: 'ds-demo',
    title: '数据结构 · 示例全书',
    subject: '期末考试',
    coverColor: '#2f6f4f',
    accent: '#e8b04b',
    desc: '书馆真实分析产物 · 统一格式 · 原文核验 · 零反馈自测'
  }
];

/**
 * mock-llm.js —— 本地 mock OpenAI-compatible 服务（仅用于自测演示，非生产）
 * 启动：node tools/mock-llm.js 8401
 * 零依赖、零凭据、零调试输出。
 */
'use strict';
const http = require('http');
const port = Number(process.argv[2] || 8401);
const out = s => process.stdout.write(String(s) + '\n');

function analysis() {
  return {
    outline: { title: '测试书', children: [{
      title: '第三章 树与二叉树', children: [{
        title: '3.1 二叉树遍历', children: [
          { title: '中序遍历', desc: '左根右顺序访问结点', questionTypes: ['简答题'], children: [] },
          { title: '先序遍历', desc: '根左右顺序访问结点', questionTypes: ['简答题'], children: [] }
        ]
      }]
    }] },
    questionIndex: [{ type: '简答题', items: [{
      title: '概念辨析', path: ['第三章 树与二叉树', '3.1 二叉树遍历', '中序遍历'],
      questions: [{
        stem: '简述二叉树中序遍历的访问顺序。', options: [],
        answer: '先左子树，再根结点，最后右子树，即左根右。',
        solution: ['第1步：中序的"中"指根在中间访问', '第2步：故顺序为左子树→根→右子树。'],
        rationale: '中序遍历按左根右递归访问。先序是根左右，后序是左右根，三者区别在根的位置。',
        pitfalls: '把中序与先序的根左右记混。', difficulty: '基础',
        pointPath: ['第三章 树与二叉树', '3.1 二叉树遍历', '中序遍历'],
        source: { file: '新增-树与二叉树.txt', page: 1, anchor: '【块1】', quote: '中序遍历按照左子树、根结点、右子树的顺序访问' }
      }]
    }] }],
    summary: '新增树与二叉树的遍历知识'
  };
}
http.createServer((req, res) => {
  let d = ''; req.on('data', c => d += c);
  req.on('end', () => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
    }
    // 返回体同时含 analyze 需要的 outline/questionIndex 与考纲需要的 sections，
    // 这样两种调用方各自 extractJson 后都能拿到自己要的字段，不依赖 system 分流判断。
    const syl = { sections: [{
      rank: 1, chapter: '第三章 树与二叉树', why: '遍历是树结构的核心考点，必考',
      points: [
        { title: '中序遍历', must: '按左子树、根结点、右子树的顺序递归访问，即左根右', formulas: [], importance: '高',
          question: { stem: '写出中序遍历的访问顺序。', answer: '左根右', steps: ['先递归左子树', '再访问根结点', '最后递归右子树'] },
          quote: '中序遍历按左、根、右的顺序访问结点', source: '示例讲义.txt' },
        { title: '图的存储', must: '邻接矩阵 O(n²) 适合稠密图；邻接表 O(n+e) 适合稀疏图', formulas: ['邻接矩阵 O(n²)', '邻接表 O(n+e)'], importance: '高',
          question: { stem: '稀疏图该用哪种存储？', answer: '邻接表', steps: ['比较空间复杂度', '稀疏图边数少', '邻接表更省'] },
          quote: '邻接表用链表为每个顶点存储邻接点', source: '新增-图结构.txt' }
      ]
    }] };
    const reply = Object.assign(analysis(), syl);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(reply) } }] }));
  });
}).listen(port, '127.0.0.1', () => out('mock LLM on http://127.0.0.1:' + port + '/v1'));

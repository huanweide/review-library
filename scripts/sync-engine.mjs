// 引擎单一真源同步脚本。
//
// 规则（详见仓库顶层 README「版本与索引」）：
//   - 离线分析引擎的唯一真源 = plugins/dsh-review-analysis/engine/
//       · lib/ 下 6 个零依赖核心模块（store/srs/insight/syllabus/mindmap/llm）
//       · analyze.js（权威编排器 + 报告渲染，DSH 与插件/专家版共用）
//   - 其余形态（WorkBuddy 插件、专家版、已安装的 DSH 本地插件）一律从这里同步，
//     禁止手工改被同步的文件，防止版本漂移。
//   - 9 个辅助模块（analytics/backup/cloze/env-config/graph/media/review/search/study）
//     不参与离线分析，各自维护，不在此同步范围内。
//   - DSH 专属的 index.js（工具注册壳）不跨形态共享，保持各形态独立。
//
// 用法（在仓库根目录执行）：node scripts/sync-engine.mjs

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const HOME = process.env.USERPROFILE || process.env.HOME || '';

const CORE_LIB = ['store', 'srs', 'insight', 'syllabus', 'mindmap', 'llm'];
const SRC_LIB = path.join(ROOT, 'plugins', 'dsh-review-analysis', 'engine', 'lib');
const SRC_ANALYZE = path.join(ROOT, 'plugins', 'dsh-review-analysis', 'engine', 'analyze.js');
const SRC_DRIVER = path.join(ROOT, 'plugins', 'review-analysis', 'bin', 'driver.js');

// 各同步目标：files 描述「源相对路径 -> 目标相对路径」
const targets = [
  {
    label: '仓库·WorkBuddy 插件源码',
    dir: path.join(ROOT, 'plugins', 'review-analysis'),
    required: true,
    files: [
      ...CORE_LIB.map((m) => ['lib/' + m + '.js', 'lib/' + m + '.js']),
      ['analyze.js', 'analyze.js'],
      ['bin/driver.js', 'bin/driver.js'],
    ],
  },
  {
    label: '本机·专家版(marketplace)',
    dir: path.join(HOME, '.workbuddy', 'plugins', 'marketplaces', 'my-experts', 'plugins', 'review-analysis'),
    required: false,
    files: [
      ...CORE_LIB.map((m) => ['lib/' + m + '.js', 'lib/' + m + '.js']),
      ['analyze.js', 'analyze.js'],
      ['bin/driver.js', 'bin/driver.js'],
    ],
  },
  {
    label: '本机·DSH 本地插件',
    dir: path.join(HOME, '.dsh', 'local-plugins', 'dsh-review-analysis'),
    required: false,
    files: [
      ...CORE_LIB.map((m) => ['lib/' + m + '.js', 'engine/lib/' + m + '.js']),
      ['analyze.js', 'engine/analyze.js'],
    ],
  },
];

// 源文件 -> 实际磁盘位置
const srcMap = {
  'lib/store.js': path.join(SRC_LIB, 'store.js'),
  'lib/srs.js': path.join(SRC_LIB, 'srs.js'),
  'lib/insight.js': path.join(SRC_LIB, 'insight.js'),
  'lib/syllabus.js': path.join(SRC_LIB, 'syllabus.js'),
  'lib/mindmap.js': path.join(SRC_LIB, 'mindmap.js'),
  'lib/llm.js': path.join(SRC_LIB, 'llm.js'),
  'analyze.js': SRC_ANALYZE,
  'bin/driver.js': SRC_DRIVER,
};

let ok = 0;
let skipped = 0;

for (const t of targets) {
  if (!fs.existsSync(t.dir)) {
    if (t.required) {
      console.error('[sync-engine] 缺失必需目标目录：' + t.dir);
      process.exit(1);
    }
    console.log('[sync-engine] 跳过（不存在）：' + t.label + ' -> ' + t.dir);
    skipped++;
    continue;
  }
  for (const [srcRel, dstRel] of t.files) {
    const from = srcMap[srcRel];
    const to = path.join(t.dir, dstRel);
    if (!from || !fs.existsSync(from)) {
      console.error('[sync-engine] 真源缺失：' + srcRel);
      process.exit(1);
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    ok++;
  }
  console.log('[sync-engine] ✅ ' + t.label + '：同步 ' + t.files.length + ' 个文件');
}

console.log('[sync-engine] 完成：同步 ' + ok + ' 次，跳过 ' + skipped + ' 个不存在目标。');
console.log('[sync-engine] 提示：改了引擎(lib/analyze)后重跑本脚本；改了 DSH 专属 index.js 后手动同步 DSH 本地插件目录。');

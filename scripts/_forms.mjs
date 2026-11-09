// 形态 wrapper 清单（sync-engine.mjs 与 check-forms.mjs 共用，避免两处列表各漂各的）。
// 唯一核心 = 仓库根 core/；这里列的只是「要同步到已安装位置」的 wrapper 文件，
// 旧 engine/、analyze.js、lib/ 副本一律不在此列（已废弃，不参与运行）。
import path from 'node:path';

export const ROOT = process.cwd();
export const HOME = process.env.USERPROFILE || process.env.HOME || '';

export const FORMS = [
  {
    label: 'DSH 插件',
    src: path.join(ROOT, 'plugins', 'dsh-review-analysis'),
    dst: path.join(HOME, '.dsh', 'local-plugins', 'dsh-review-analysis'),
    files: [
      'index.js', 'client.js', 'cordis.patch.yml', 'package.json', 'README.md', 'icon.svg',
      'locale/zh.json', 'locale/en.json',
    ],
  },
  {
    label: 'WorkBuddy 专家',
    src: path.join(ROOT, 'plugins', 'review-analysis'),
    dst: path.join(HOME, '.workbuddy', 'plugins', 'marketplaces', 'my-experts', 'plugins', 'review-analysis'),
    files: [
      '.codebuddy-plugin/plugin.json', 'agents/review-analysis.md', 'bin/driver.js', 'README.md',
    ],
  },
];

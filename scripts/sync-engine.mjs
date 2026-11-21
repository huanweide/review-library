// 形态 wrapper 同步脚本（2026-11-08 职责重写）。
//
// 旧职责（已废弃）：把 DSH 插件 engine 下的 lib 模块复制到各形态 —— 那是「每加一个形态多一份引擎」，必然漂移。
// 新职责：唯一核心 = 仓库根 core/；DSH / 专家 wrapper 在运行时通过 projectRoot / --project 引用它，**不复制引擎**。
//         本脚本只把源码 wrapper 文件同步到本机已安装位置（不重启宿主应用、不点 GUI）。
// 规则见 plugins/README.md；漂移检测见 check-forms.mjs。
//
// 用法（仓库根目录）：node scripts/sync-engine.mjs   （或 npm run forms:sync）
import fs from 'node:fs';
import path from 'node:path';
import { FORMS, ROOT } from './_forms.mjs';

let ok = 0, skipped = 0;
for (const form of FORMS) {
  if (!fs.existsSync(form.dst)) {
    console.log('[forms] 跳过（未安装）：' + form.label + ' -> ' + form.dst);
    skipped++;
    continue;
  }
  for (const rel of form.files) {
    const from = path.join(form.src, rel);
    const to = path.join(form.dst, rel);
    if (!fs.existsSync(from)) {
      console.error('[forms] ✗ 源码缺失：' + form.label + ' / ' + rel);
      process.exitCode = 1;
      continue;
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const a = fs.readFileSync(from);
    const b = fs.existsSync(to) ? fs.readFileSync(to) : null;
    if (b && a.equals(b)) { console.log('  已一致：' + form.label + ' / ' + rel); }
    else { fs.writeFileSync(to, a); console.log('  已同步：' + form.label + ' / ' + rel); ok++; }
  }
}
// DSH 安装戳记：cordis.patch.yml 发布到 GitHub 后不能写死作者本机路径，
// 所以在同步到「本机已安装位置」时额外写一份 project-root.json（在 ~/.dsh 下，不入库）。
// 插件的 resolveProjectRoot() 会读它，既保持仓库可移植，也不破坏现有安装。
const dsh = FORMS.find((f) => f.label === 'DSH 插件' && fs.existsSync(f.dst));
if (dsh) {
  const stamp = path.join(dsh.dst, 'project-root.json');
  const text = JSON.stringify({ projectRoot: path.resolve(ROOT), generatedBy: 'npm run forms:sync' }, null, 2) + '\n';
  if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== text) {
    fs.writeFileSync(stamp, text);
    console.log('  已写入安装戳记：' + stamp);
    ok++;
  }
}
console.log('[forms] 完成：更新 ' + ok + ' 个文件，跳过 ' + skipped + ' 个未安装形态');

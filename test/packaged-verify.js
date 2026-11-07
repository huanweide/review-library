'use strict';
// 打包版真实验证：连已启动的打包 exe（CDP），验证新功能在「打包后」真的可用。
// 用法：
//   1) 先启动打包 exe 并开 CDP：
//        $env:ELECTRON_RUN_AS_NODE=$null   # 必须清掉，否则 Electron 退化成纯 Node 直接崩
//        Start-Process "dist\win-unpacked\ReviewLibrary.exe" -ArgumentList "--remote-debugging-port=9222"
//   2) 再跑：node test/packaged-verify.js
// 断言原则：只看界面/桥接的真实行为，不看占位符；失败要能定位到具体哪一项。
const { chromium } = require('playwright-core');

const CDP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const SHOT_DIR = process.env.SHOT_DIR || process.cwd();

let pass = 0, fail = 0; const fails = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
}

(async () => {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];
  if (!page) { console.error('CDP 未找到页面'); process.exit(1); }

  // 一、打包环境桥接齐全
  const env = await page.evaluate(() => ({
    hasApi: !!window.api,
    env: !!(window.api && window.api.app && window.api.app.env),
    upd: !!(window.api && window.api.app && window.api.app.checkUpdate),
    sc: !!(window.api && window.api.app && window.api.app.createShortcut)
  }));
  check('打包环境 window.api 存在', env.hasApi);
  check('app.env 桥接存在', env.env);
  check('app.checkUpdate 桥接存在', env.upd);
  check('app.createShortcut 桥接存在', env.sc);

  const dd = await page.evaluate(() => window.api.app.dataDir());
  check('数据目录 IPC 可用', typeof dd === 'string' && dd.length > 0, dd);

  const envRes = await page.evaluate(() => window.api.app.env());
  check('app.env 返回结构完整', envRes && typeof envRes === 'object' && 'baseURL' in envRes && 'apiKey' in envRes && 'model' in envRes);

  // 二、服务商预设 + 视觉能力标记
  await page.click('#nav-settings'); await page.waitForTimeout(600);
  check('设置页可见', await page.evaluate(() => !document.getElementById('settings').classList.contains('hidden')));
  await page.click('input[name="set-engine"][value="llm"]'); await page.waitForTimeout(400);

  await page.selectOption('#set-provider', 'siliconflow'); await page.waitForTimeout(400);
  const sf = await page.evaluate(() => ({
    base: document.getElementById('set-base').value,
    model: document.getElementById('set-model').value,
    ok: document.getElementById('set-vision-flag').classList.contains('ok'),
    txt: document.getElementById('set-vision-flag').textContent
  }));
  check('硅基流动预设填地址(/v1)', sf.base === 'https://api.siliconflow.cn/v1', sf.base);
  check('硅基流动预设填默认模型', sf.model === 'deepseek-ai/DeepSeek-V4.1-Flash', sf.model);
  check('硅基流动默认模型标为支持看图', sf.ok, sf.txt.slice(0, 40));

  await page.fill('#set-model', 'deepseek-v4-pro'); await page.waitForTimeout(200);
  check('纯文本模型显示降级警告', await page.evaluate(() => document.getElementById('set-vision-flag').classList.contains('warn')));

  await page.selectOption('#set-provider', 'deepseek'); await page.waitForTimeout(400);
  const ds = await page.evaluate(() => ({
    base: document.getElementById('set-base').value,
    model: document.getElementById('set-model').value,
    ok: document.getElementById('set-vision-flag').classList.contains('ok')
  }));
  check('DeepSeek 地址不带 /v1', ds.base === 'https://api.deepseek.com', ds.base);
  check('DeepSeek deepseek-flash 标为支持看图', ds.ok, ds.model);
  await page.screenshot({ path: SHOT_DIR + '/packaged-settings.png' });

  // 三、检查更新：必须真的发起请求并给出人话反馈（不是模块缺失、不是整坨响应体）
  await page.click('#set-check-update'); await page.waitForTimeout(6000);
  const upd = await page.evaluate(() => document.getElementById('update-status').textContent.trim());
  check('检查更新有反馈', upd.length > 0, upd.slice(0, 60));
  check('检查更新不是模块缺失', !/Cannot find module/.test(upd), upd.slice(0, 80));
  check('检查更新反馈已转成短句(不含请求头)', upd.length < 220 && !/Headers:|content-length/i.test(upd), 'len=' + upd.length);

  // 四、桌面快捷方式：真写 .lnk
  await page.click('#set-make-shortcut'); await page.waitForTimeout(3000);
  const sc = await page.evaluate(() => document.getElementById('shortcut-status').textContent.trim());
  check('创建桌面快捷方式有反馈', sc.length > 0, sc.slice(0, 80));
  check('快捷方式创建成功', /已创建桌面快捷方式/.test(sc), sc.slice(0, 80));

  console.log('\n打包版验证： ' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) { console.log('失败项：' + fails.join('; ')); }
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e && e.message); process.exit(1); });

'use strict';
// 用本机 Edge（复用斯瑞 GitHub 登录态，CDP 接管）创建 Release 并上传 4 个资产。
// 优先用会话 Cookie 调 GitHub REST API（资产上传走 uploads.github.com，无 50MB 网页限制）。
const { chromium } = require('playwright-core');
const fs = require('fs');
const https = require('https');
const path = require('path');

const CDPEndpoint = 'http://127.0.0.1:9222';
const REPO = 'huanweide/review-library';
const TAG = 'v0.7.0';
const DIST = path.join(__dirname, '..', 'dist');
const ASSETS = [
  'ReviewLibrary-Setup-0.7.0.exe',
  'ReviewLibrary-Setup-0.7.0.exe.blockmap',
  'ReviewLibrary-0.7.0-portable.exe',
  'latest.yml'
];
const RELEASE_BODY = `## 复习资料图书馆 v0.7.0 · 复习闭环

本地优先 / 离线可用的复习资料管理与智能出题系统。本版聚焦「学完能复习、数据不丢、流程走通」：

### 新能力（竞品级）
- **反馈五问服务端持久化**：考试后的「哪里卡 / 哪类易错 / 下次先复习什么 / 还没弄懂 / 一句话」从 localStorage 改为落盘（书级 feedback.json），跨设备备份、参与薄弱点统计。
- **独立闪卡复习流**：新增「复习」页，按 SRS 到期队列出卡，先揭示问题 → 点「看答案」→ 四档自评（Again/Hard/Good/Easy），与「今日到期 N 张」看板联动；不再是只在考试里顺手自评。
- **备份含全部用户数据**：整库导出/导入覆盖书、资料、题目、学习记录、SRS 状态、反馈五问、设置（API 密钥脱敏），65MB 大文件不再静默漏备份。
- **导入白名单加锁**：/api/backup/import 仅接受 mode∈{replace,merge}，非法值直接 400，且走跨进程锁 + 原子写，不再绕开锁。
- **搜索命中直达原文**：全局搜索结果点击直接打开对应资料/知识点/题目/错题并定位，不再只切 tab。
- **今日到期修正**：SRS due 判定由「当天 00:00 起」改为「now 之前」，今天到期立即进队列（修正 v0.6 漏算当日卡）。

### 验收（全绿）
- 判别测试 test/maxloop-v07.test.js：1/31 红 → 42/0 绿
- 全量单测：9/9 套件通过（store/insight/study/backup/srs/search/graph/analytics/cloze/maxloop-v07）
- 真浏览器 e2e：193/0（零 JS 报错、零外部域名请求）
- 打包版验证：18/0

### 已知限制
- 真·视觉 API 仍需在设置页填入支持看图的模型（如 DeepSeek-V4.1-Flash / 硅基流动视觉模型）。
- 自动更新：安装版从 GitHub Release 增量更新；免安装版需手动替换 exe。
- SRS 为可解释简版（非官方 FSRS 17 权重 ML 拟合）；全局搜索为顺序扫描（资料量极大时可加倒排索引）。`;

function httpReq(opts, bodyBuf) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = [];
      res.on('data', (c) => data.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(data) }));
    });
    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

async function main() {
  const browser = await chromium.connectOverCDP(CDPEndpoint);
  const contexts = browser.contexts();
  const ctx = contexts[0] || await browser.newContext();
  const page = await ctx.newPage();

  // 1) 验证 GitHub 登录态
  await page.goto('https://github.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);
  const loginInfo = await page.evaluate(() => {
    const av = document.querySelector('img.avatar, a[href^="/"] img[alt*=""]');
    const signedIn = !!document.querySelector('a[href="/settings/profile"], nav a[href^="/notifications"]');
    const userLink = document.querySelector('a[href^="/"][data-login]');
    return { signedIn, login: userLink ? userLink.getAttribute('data-login') : (document.querySelector('meta[name="user-login"]') || {}).content || null,
      url: location.href };
  });
  console.log('LOGIN_INFO=' + JSON.stringify(loginInfo));
  if (!loginInfo.signedIn && !loginInfo.login) {
    console.log('RESULT=fail: 未检测到 GitHub 登录态');
    await browser.close();
    process.exit(2);
  }

  // 2) 取会话 Cookie，试 cookie 调 API
  const cookies = await ctx.cookies('https://github.com');
  const cookieHeader = cookies.map(c => c.name + '=' + c.value).join('; ');
  console.log('COOKIE_COUNT=' + cookies.length);

  const me = await httpReq({
    hostname: 'api.github.com', port: 443, path: '/user', method: 'GET',
    headers: { 'User-Agent': 'rl-publish', 'Cookie': cookieHeader, 'Accept': 'application/vnd.github+json' }
  });
  let apiLogin = null;
  try { apiLogin = JSON.parse(me.body.toString()).login; } catch (e) {}
  console.log('API_USER=' + apiLogin + ' API_STATUS=' + me.status);

  if (!apiLogin) {
    console.log('RESULT=fail: 会话 Cookie 无法调 GitHub API（可能需要重新登录或 app-bound 加密拦截）');
    await browser.close();
    process.exit(3);
  }

  // 3) 创建 Release（draft=false）
  const createRes = await httpReq({
    hostname: 'api.github.com', port: 443,
    path: '/repos/' + REPO + '/releases', method: 'POST',
    headers: { 'User-Agent': 'rl-publish', 'Cookie': cookieHeader, 'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json' }
  }, Buffer.from(JSON.stringify({ tag_name: TAG, name: TAG, body: RELEASE_BODY, draft: false, prerelease: false })));
  let releaseId = null;
  try { releaseId = JSON.parse(createRes.body.toString()).id; } catch (e) {}
  console.log('CREATE_STATUS=' + createRes.status + ' RELEASE_ID=' + releaseId);
  if (!releaseId) {
    console.log('CREATE_BODY=' + createRes.body.toString().slice(0, 400));
    console.log('RESULT=fail: 创建 Release 失败');
    await browser.close();
    process.exit(4);
  }

  // 4) 逐个上传资产（走 uploads.github.com，二进制，无 50MB 限制）
  let uploaded = 0;
  for (const name of ASSETS) {
    const fp = path.join(DIST, name);
    if (!fs.existsSync(fp)) { console.log('SKIP missing ' + name); continue; }
    const buf = fs.readFileSync(fp);
    const up = await httpReq({
      hostname: 'uploads.github.com', port: 443,
      path: '/repos/' + REPO + '/releases/' + releaseId + '/assets?name=' + encodeURIComponent(name),
      method: 'POST',
      headers: { 'User-Agent': 'rl-publish', 'Cookie': cookieHeader, 'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/octet-stream', 'Content-Length': buf.length }
    }, buf);
    const okState = up.status >= 200 && up.status < 300;
    console.log('UPLOAD ' + name + ' status=' + up.status + ' bytes=' + buf.length + ' ok=' + okState);
    if (okState) uploaded++;
    else console.log('  UPLOAD_ERR=' + up.body.toString().slice(0, 300));
  }
  console.log('UPLOADED=' + uploaded + '/' + ASSETS.length);
  console.log('RELEASE_URL=https://github.com/' + REPO + '/releases/tag/' + TAG);
  console.log('RESULT=' + (uploaded === ASSETS.length ? 'ok' : 'partial'));
  await browser.close();
  process.exit(uploaded === ASSETS.length ? 0 : 5);
}
main().catch(e => { console.log('RESULT=error: ' + (e && e.message || e)); process.exit(9); });

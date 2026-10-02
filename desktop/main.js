/* ═══════════════════════════════════════════════════════════════
 * main.js — 수평을 맞춰라! 윈도우 키오스크 (Electron)
 *
 * 실행 흐름 (인터넷이 불안정한 전시장을 전제로 설계)
 *  1. 이전에 받아 둔 새 버전(content_new)이 있으면 먼저 적용
 *  2. 게임을 즉시 전체화면으로 시작 (업데이트를 기다리지 않음)
 *  3. 뒤에서 조용히 업데이트 확인: GitHub 브랜치 최신 커밋 SHA ↔ 로컬 버전
 *     - 다르면 브랜치 zip 을 내려받아 content_new 에 준비(스테이징)
 *     - 준비가 끝나면 시작 화면에 머무는 순간 바꿔치기 + 새로고침
 *       (플레이 중이면 방해하지 않고 기다렸다가, 끝내 못 하면 다음 실행 때 적용)
 *     - 오프라인이거나 실패하면 10분마다 재시도
 *
 * 종료: 화면 오른쪽 위 모서리를 5번 연속 터치, 또는 Ctrl+Alt+Q
 * 단축키: Ctrl+Alt+U 지금 업데이트 확인
 * ═══════════════════════════════════════════════════════════════ */
'use strict';

const { app, BrowserWindow, protocol, net, powerSaveBlocker, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const U = require('./updater');
const DEFAULT_CHANNEL = require('./channel.json');

const CHECK_TIMEOUT = 8000;        // 버전 신호 대기(ms)
const DOWNLOAD_TIMEOUT = 600000;   // 다운로드 전체 상한(ms) — 느린 회선 허용
const STALL_TIMEOUT = 20000;       // 이 시간 동안 1바이트도 안 오면 포기(ms)
const RETRY_INTERVAL = 10 * 60000; // 실패 시 재시도 간격(ms)
const APPLY_POLL = 15000;          // 준비된 버전을 적용할 틈(시작 화면) 확인 간격(ms)

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
}]);

if (!app.requestSingleInstanceLock()) app.quit();

const userData = app.getPath('userData');
const contentDir = path.join(userData, 'content');
const stagedDir = path.join(userData, 'content_new');   // 다운로드 완료된 새 버전
const tmpDir = path.join(userData, 'content_tmp');      // 다운로드 중
const bundledDir = app.isPackaged
  ? path.join(process.resourcesPath, 'content')
  : path.join(__dirname, 'content');
const logFile = path.join(userData, 'kiosk.log');

let splash = null;
let win = null;
let updating = false;
let applyTimer = null;
let retryTimer = null;

function log(msg) {
  const line = '[' + new Date().toISOString() + '] ' + msg + '\n';
  try { fs.appendFileSync(logFile, line); } catch (e) { /* 무시 */ }
  console.log(line.trim());
}

/* ── 설정 (userData/settings.json): { "autoStart": true } ──
 * 전시·교실용이므로 기본값은 "로그인 시 자동 실행". 파일이 없으면 기본값으로 만들어 둔다. */
const DEFAULT_SETTINGS = { autoStart: true };
function loadSettings() {
  const file = path.join(userData, 'settings.json');
  try {
    return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) {
    try {
      fs.mkdirSync(userData, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(DEFAULT_SETTINGS, null, 2));
    } catch (e2) { /* 무시 */ }
    return Object.assign({}, DEFAULT_SETTINGS);
  }
}

/* ── 스플래시 (게임 창이 뜰 때까지 잠깐) ── */
function showSplash() {
  splash = new BrowserWindow({
    width: 480, height: 320, frame: false, resizable: false, center: true,
    alwaysOnTop: true, show: false, backgroundColor: '#bfe6ff',
    webPreferences: { contextIsolation: true, sandbox: true }
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  splash.once('ready-to-show', function () { if (splash) splash.show(); });
}

function closeSplash() {
  if (splash && !splash.isDestroyed()) splash.close();
  splash = null;
}

/* ── 네트워크 (Electron net → 시스템 프록시 설정을 따른다) ── */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error(label + ' 시간 초과')); }, ms);
    })
  ]);
}

async function fetchJson(url, ms) {
  const res = await withTimeout(net.fetch(url, {
    headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'balance-scale-kiosk' }
  }), ms, url);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  return res.json();
}

/* 전체 상한과 "멈춤" 상한을 함께 두어, 끊긴 회선에서 무한정 기다리지 않는다 */
async function downloadBuffer(url, onProgress) {
  const res = await withTimeout(net.fetch(url, { headers: { 'User-Agent': 'balance-scale-kiosk' } }), CHECK_TIMEOUT, url);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > DOWNLOAD_TIMEOUT) { reader.cancel().catch(function () {}); throw new Error('다운로드 전체 시간 초과'); }
    const step = await withTimeout(reader.read(), STALL_TIMEOUT, '다운로드 멈춤')
      .catch(function (e) { reader.cancel().catch(function () {}); throw e; });
    if (step.done) break;
    chunks.push(Buffer.from(step.value));
    received += step.value.length;
    onProgress(received, total);
  }
  return Buffer.concat(chunks);
}

/* ── 업데이트 ── */
async function resolveChannel() {
  // Pages 에 올라간 channel.json 이 있으면 우선 (브랜치 변경을 재설치 없이 반영)
  try {
    const remote = await fetchJson(DEFAULT_CHANNEL.pagesUrl + '/desktop/channel.json?t=' + Date.now(), CHECK_TIMEOUT);
    if (remote && remote.repo && remote.branch) return Object.assign({}, DEFAULT_CHANNEL, remote);
  } catch (e) { log('원격 채널 정보 없음, 내장값 사용: ' + e.message); }
  return DEFAULT_CHANNEL;
}

function stagedVersion() {
  if (!fs.existsSync(path.join(stagedDir, 'index.html'))) return '';
  return U.readVersion(stagedDir);
}

/* 준비된 새 버전이 있으면 지금 적용. 창이 떠 있으면 새로고침까지. */
function applyStaged(reason) {
  const sha = stagedVersion();
  if (!sha) return false;
  try {
    U.swapContent(contentDir, stagedDir);
    log('새 버전 적용(' + reason + '): ' + sha);
    if (win && !win.isDestroyed()) win.webContents.reload();
    return true;
  } catch (e) {
    log('새 버전 적용 실패: ' + e.message);
    return false;
  }
}

/* 게임이 시작 화면(플레이 중 아님)에 있을 때만 적용 */
async function tryApplyWhenIdle() {
  if (!stagedVersion()) { if (applyTimer) { clearInterval(applyTimer); applyTimer = null; } return; }
  if (!win || win.isDestroyed()) return;
  let idle = false;
  try {
    idle = await win.webContents.executeJavaScript(
      '(window.GameDebug && window.GameDebug.state && window.GameDebug.state.screen) === "start"', true);
  } catch (e) { idle = false; }
  if (idle) { applyStaged('시작 화면 대기 중'); if (applyTimer) { clearInterval(applyTimer); applyTimer = null; } }
}

async function backgroundUpdate(trigger) {
  if (updating) return;
  updating = true;
  try {
    log('업데이트 확인(' + trigger + ')');
    const ch = await resolveChannel();
    const info = await fetchJson(
      'https://api.github.com/repos/' + ch.repo + '/commits/' + encodeURIComponent(ch.branch), CHECK_TIMEOUT);
    const sha = info && info.sha;
    if (!sha) throw new Error('버전 정보를 읽지 못함');
    const current = U.readVersion(contentDir);
    if (sha === current) { log('최신 버전입니다 (' + sha.slice(0, 7) + ')'); return; }
    if (sha === stagedVersion()) { log('이미 받아 둔 버전, 적용 대기: ' + sha.slice(0, 7)); scheduleApply(); return; }

    log('새 버전 발견: ' + (current || '없음').slice(0, 7) + ' → ' + sha.slice(0, 7) + ', 다운로드 시작');
    const zipUrl = 'https://codeload.github.com/' + ch.repo + '/zip/refs/heads/' + ch.branch;
    let lastPct = -1;
    const buf = await downloadBuffer(zipUrl, function (received, total) {
      const pct = total ? Math.round(received / total * 100) : -1;
      if (pct >= 0 && pct !== lastPct && pct % 25 === 0) { lastPct = pct; log('다운로드 ' + pct + '%'); }
    });
    log('다운로드 완료 ' + (buf.length / 1048576).toFixed(1) + 'MB');

    fs.rmSync(tmpDir, { recursive: true, force: true });
    const n = U.extractZipStripRoot(buf, tmpDir);
    if (n < 5 || !fs.existsSync(path.join(tmpDir, 'index.html'))) throw new Error('받은 파일이 올바르지 않음 (' + n + '개)');
    U.writeVersion(tmpDir, sha);
    fs.rmSync(stagedDir, { recursive: true, force: true });
    fs.renameSync(tmpDir, stagedDir);
    log('새 버전 준비 완료: ' + sha.slice(0, 7) + ' (' + n + '개 파일)');
    scheduleApply();
  } catch (e) {
    log('업데이트 보류: ' + e.message + ' — ' + (RETRY_INTERVAL / 60000) + '분 후 재시도');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(function () { backgroundUpdate('재시도'); }, RETRY_INTERVAL);
  } finally {
    updating = false;
  }
}

function scheduleApply() {
  tryApplyWhenIdle();
  if (!applyTimer) applyTimer = setInterval(tryApplyWhenIdle, APPLY_POLL);
}

/* 최초 실행: 내장 콘텐츠를 사용자 데이터 폴더로 복사 */
function ensureContent() {
  if (fs.existsSync(path.join(contentDir, 'index.html'))) return;
  if (fs.existsSync(path.join(bundledDir, 'index.html'))) {
    log('내장 콘텐츠 복사: ' + bundledDir);
    U.copyDir(bundledDir, contentDir);
  } else {
    log('경고: 내장 콘텐츠가 없음 (' + bundledDir + ')');
  }
}

/* ── app:// 프로토콜: 콘텐츠 폴더를 안전하게 서빙 ── */
function registerProtocol() {
  protocol.handle('app', function (request) {
    const u = new URL(request.url);
    if (u.pathname === '/__quit') {                    // 게임 화면의 비밀 종료(모서리 5번 터치)
      log('게임에서 종료 요청');
      setTimeout(function () { app.quit(); }, 50);
      return new Response('bye', { status: 200 });
    }
    if (u.pathname === '/__version') {                 // 게임 화면의 버전 표시용
      const sha = U.readVersion(contentDir) || 'bundled';
      return new Response('v' + app.getVersion() + ' · ' + sha.slice(0, 7),
        { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    const file = U.safeResolve(contentDir, u.pathname);
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}

/* ── 키오스크 창 ── */
function createWindow() {
  win = new BrowserWindow({
    fullscreen: true, kiosk: true, frame: false, autoHideMenuBar: true,
    backgroundColor: '#bfe6ff', show: false,
    webPreferences: { contextIsolation: true, sandbox: true }
  });
  win.removeMenu();
  win.loadURL('app://game/index.html');
  win.once('ready-to-show', function () { win.show(); closeSplash(); });
  win.on('closed', function () { win = null; });
}

function boot() {
  showSplash();
  ensureContent();
  applyStaged('실행 시');          // 지난번에 받아 둔 새 버전이 있으면 먼저 적용
  createWindow();                  // 게임은 즉시 시작
  backgroundUpdate('실행 시');     // 업데이트는 뒤에서
}

app.whenReady().then(function () {
  registerProtocol();
  powerSaveBlocker.start('prevent-display-sleep');            // 전시 중 화면 꺼짐 방지

  const settings = loadSettings();
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: !!settings.autoStart });
    log('로그인 시 자동 실행: ' + (settings.autoStart ? '켬' : '끔'));
  }

  globalShortcut.register('Control+Alt+Q', function () { app.quit(); });
  globalShortcut.register('Control+Alt+U', function () {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (!applyStaged('단축키')) backgroundUpdate('단축키');
  });

  boot();
});

app.on('second-instance', function () { if (win) win.focus(); });
app.on('window-all-closed', function () { app.quit(); });
app.on('will-quit', function () { globalShortcut.unregisterAll(); });

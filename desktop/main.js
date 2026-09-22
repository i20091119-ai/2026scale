/* ═══════════════════════════════════════════════════════════════
 * main.js — 수평을 맞춰라! 윈도우 키오스크 (Electron)
 *
 * 실행 흐름
 *  1. 스플래시 창 표시
 *  2. 업데이트 확인: GitHub 브랜치 최신 커밋 SHA 조회 → 로컬 버전과 비교
 *  3. 다르면 브랜치 zip 다운로드 → 게임 파일만 풀어 교체
 *     (인터넷이 없거나 실패하면 그냥 넘어감 — 기존 콘텐츠로 실행)
 *  4. 전체화면 키오스크 창에서 app://game/index.html 로드
 *
 * 단축키: Ctrl+Alt+Q 종료 / Ctrl+Alt+U 지금 업데이트 확인 후 재시작
 * ═══════════════════════════════════════════════════════════════ */
'use strict';

const { app, BrowserWindow, protocol, net, powerSaveBlocker, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const U = require('./updater');
const DEFAULT_CHANNEL = require('./channel.json');

const CHECK_TIMEOUT = 8000;      // 버전 신호 대기(ms)
const DOWNLOAD_TIMEOUT = 180000; // 다운로드 대기(ms)

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
}]);

if (!app.requestSingleInstanceLock()) app.quit();

const userData = app.getPath('userData');
const contentDir = path.join(userData, 'content');
const bundledDir = app.isPackaged
  ? path.join(process.resourcesPath, 'content')
  : path.join(__dirname, 'content');
const logFile = path.join(userData, 'kiosk.log');

let splash = null;
let win = null;

function log(msg) {
  const line = '[' + new Date().toISOString() + '] ' + msg + '\n';
  try { fs.appendFileSync(logFile, line); } catch (e) { /* 무시 */ }
  console.log(line.trim());
}

/* ── 설정 (userData/settings.json): { "autoStart": false } ── */
function loadSettings() {
  try { return Object.assign({ autoStart: false }, JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'))); }
  catch (e) { return { autoStart: false }; }
}

/* ── 스플래시 ── */
function showSplash() {
  splash = new BrowserWindow({
    width: 480, height: 320, frame: false, resizable: false, center: true,
    alwaysOnTop: true, show: false, backgroundColor: '#bfe6ff',
    webPreferences: { contextIsolation: true, sandbox: true }
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  splash.once('ready-to-show', function () { splash.show(); });
}

function setStatus(text, pct) {
  log('상태: ' + text + (typeof pct === 'number' ? ' ' + pct + '%' : ''));
  if (!splash || splash.isDestroyed()) return;
  splash.webContents.executeJavaScript(
    'setStatus(' + JSON.stringify(text) + ',' + (typeof pct === 'number' ? pct : 'undefined') + ')'
  ).catch(function () {});
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

async function downloadBuffer(url, ms, onProgress) {
  const res = await withTimeout(net.fetch(url, { headers: { 'User-Agent': 'balance-scale-kiosk' } }), ms, url);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  const started = Date.now();
  for (;;) {
    if (Date.now() - started > ms) throw new Error('다운로드 시간 초과');
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    received += value.length;
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

async function checkAndUpdate() {
  try {
    setStatus('업데이트 확인 중…');
    const ch = await resolveChannel();
    const info = await fetchJson(
      'https://api.github.com/repos/' + ch.repo + '/commits/' + encodeURIComponent(ch.branch), CHECK_TIMEOUT);
    const sha = info && info.sha;
    const current = U.readVersion(contentDir);
    if (!sha) throw new Error('버전 정보를 읽지 못함');
    if (sha === current) { setStatus('최신 버전입니다', 100); return false; }

    log('새 버전 발견: ' + current + ' → ' + sha);
    setStatus('새 버전 다운로드 중…', 0);
    const zipUrl = 'https://codeload.github.com/' + ch.repo + '/zip/refs/heads/' + ch.branch;
    const buf = await downloadBuffer(zipUrl, DOWNLOAD_TIMEOUT, function (received, total) {
      if (total) setStatus('새 버전 다운로드 중…', Math.round(received / total * 100));
      else setStatus('새 버전 다운로드 중… ' + (received / 1048576).toFixed(1) + 'MB');
    });

    setStatus('설치 중…');
    const newDir = path.join(userData, 'content_new');
    fs.rmSync(newDir, { recursive: true, force: true });
    const n = U.extractZipStripRoot(buf, newDir);
    if (n < 5 || !fs.existsSync(path.join(newDir, 'index.html'))) throw new Error('받은 파일이 올바르지 않음 (' + n + '개)');
    U.writeVersion(newDir, sha);
    U.swapContent(contentDir, newDir);
    setStatus('업데이트 완료!', 100);
    log('업데이트 적용: ' + sha + ' (' + n + '개 파일)');
    return true;
  } catch (e) {
    log('업데이트 건너뜀: ' + e.message);
    setStatus('업데이트를 건너뜁니다 (오프라인)');
    return false;
  }
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
  win.once('ready-to-show', function () {
    win.show();
    if (splash && !splash.isDestroyed()) splash.close();
    splash = null;
  });
  win.on('closed', function () { win = null; });
}

async function boot() {
  showSplash();
  ensureContent();
  await checkAndUpdate();
  await new Promise(function (r) { setTimeout(r, 600); });   // 상태 문구를 잠깐 보여준다
  createWindow();
}

app.whenReady().then(function () {
  registerProtocol();
  powerSaveBlocker.start('prevent-display-sleep');            // 전시 중 화면 꺼짐 방지

  const settings = loadSettings();
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!settings.autoStart });

  globalShortcut.register('Control+Alt+Q', function () { app.quit(); });
  globalShortcut.register('Control+Alt+U', async function () {
    if (win) { win.close(); win = null; }
    // 창이 닫히며 파일 핸들이 풀릴 시간을 준다 (Windows 는 열린 파일이 있으면 폴더 교체 실패)
    await new Promise(function (r) { setTimeout(r, 800); });
    await boot();
  });

  boot();
});

app.on('second-instance', function () { if (win) win.focus(); });
app.on('window-all-closed', function () { app.quit(); });
app.on('will-quit', function () { globalShortcut.unregisterAll(); });

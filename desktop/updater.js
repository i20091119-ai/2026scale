/* ═══════════════════════════════════════════════════════════════
 * updater.js — 콘텐츠 자동 업데이트의 순수 로직 (Electron 비의존)
 *
 *  - 버전 신호: GitHub API 로 브랜치 최신 커밋 SHA 조회
 *  - 변경 시: 브랜치 zip 을 내려받아 게임 파일만 골라 풀고 교체
 *  이 파일은 node 단독으로 테스트할 수 있도록 electron 을 require 하지 않는다.
 * ═══════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');

/* 게임 실행에 필요한 파일만 추출 (문서·데스크톱 소스는 제외) */
const CONTENT_ALLOW = ['index.html', 'problems.html', 'css/', 'js/', 'assets/'];

function isContentPath(rel) {
  return CONTENT_ALLOW.some(function (p) {
    return p.endsWith('/') ? rel.startsWith(p) : rel === p;
  });
}

/* 콘텐츠 루트 아래로만 경로를 풀어준다 (../ 탈출 방지). 실패 시 null */
function safeResolve(rootDir, urlPath) {
  let rel = decodeURIComponent(urlPath || '/');
  if (rel === '/' || rel === '') rel = '/index.html';
  const abs = path.normalize(path.join(rootDir, rel));
  const root = path.normalize(rootDir + path.sep);
  if (!abs.startsWith(root)) return null;
  return abs;
}

/* GitHub zipball 은 "<repo>-<branch>/..." 한 단계 폴더로 감싸여 있다.
 * 첫 폴더를 벗겨내고 게임 파일만 destDir 에 푼다. 풀린 파일 수를 돌려준다. */
function extractZipStripRoot(zipBuffer, destDir) {
  const AdmZip = require('adm-zip');   // 지연 로드: collect-content.js 는 이 의존성이 필요 없다
  const zip = new AdmZip(zipBuffer);
  let count = 0;
  zip.getEntries().forEach(function (entry) {
    if (entry.isDirectory) return;
    const parts = entry.entryName.split('/');
    if (parts.length < 2) return;
    const rel = parts.slice(1).join('/');
    if (!isContentPath(rel)) return;
    const target = path.join(destDir, rel);
    if (!path.normalize(target).startsWith(path.normalize(destDir + path.sep))) return;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.getData());
    count++;
  });
  return count;
}

function readVersion(contentDir) {
  try { return fs.readFileSync(path.join(contentDir, '.version'), 'utf8').trim(); }
  catch (e) { return ''; }
}

function writeVersion(contentDir, sha) {
  fs.writeFileSync(path.join(contentDir, '.version'), sha);
}

/* 새 콘텐츠 폴더를 현재 폴더와 원자적으로 교체 (실패 시 원래대로) */
function swapContent(contentDir, newDir) {
  const oldDir = contentDir + '_old';
  fs.rmSync(oldDir, { recursive: true, force: true });
  if (fs.existsSync(contentDir)) fs.renameSync(contentDir, oldDir);
  try {
    fs.renameSync(newDir, contentDir);
  } catch (e) {
    if (fs.existsSync(oldDir)) fs.renameSync(oldDir, contentDir);
    throw e;
  }
  fs.rmSync(oldDir, { recursive: true, force: true });
}

/* 재귀 복사 (최초 실행 시 내장 콘텐츠 → 사용자 데이터 폴더) */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  fs.readdirSync(src, { withFileTypes: true }).forEach(function (ent) {
    const s = path.join(src, ent.name), d = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  });
}

module.exports = {
  CONTENT_ALLOW, isContentPath, safeResolve, extractZipStripRoot,
  readVersion, writeVersion, swapContent, copyDir
};

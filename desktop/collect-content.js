/* 빌드 전에 저장소 루트의 게임 파일을 desktop/content 로 모은다.
 * (설치파일에 내장되는 초기 콘텐츠 — 이후엔 자동 업데이트가 갈아끼움) */
'use strict';
const path = require('path');
const fs = require('fs');
const { copyDir, CONTENT_ALLOW } = require('./updater');

const root = path.resolve(__dirname, '..');
const dest = path.join(__dirname, 'content');
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });

CONTENT_ALLOW.forEach(function (p) {
  const src = path.join(root, p);
  if (!fs.existsSync(src)) return;
  if (p.endsWith('/')) copyDir(src, path.join(dest, p));
  else fs.copyFileSync(src, path.join(dest, p));
});
fs.writeFileSync(path.join(dest, '.version'), 'bundled');
console.log('content collected →', dest);

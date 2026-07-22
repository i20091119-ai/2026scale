/* ═══════════════════════════════════════════════════════════════
 * config.js — 운영 설정
 *
 * RANKING_API_URL: Google Apps Script 웹 앱 배포 URL(…/exec).
 *   - 설정하면: 랭킹이 구글 시트에 저장되어 모든 기기가 공유
 *     (서버 연결이 안 되면 자동으로 이 기기 저장으로 동작하고,
 *      연결이 돌아오면 밀린 기록을 자동 전송)
 *   - 비워 두면: 이 기기(localStorage)에만 저장
 *
 * 설정 방법: docs/랭킹_서버_설정.md 참고
 * ═══════════════════════════════════════════════════════════════ */
window.GameConfig = {
  RANKING_API_URL: 'https://script.google.com/macros/s/AKfycbwCQjHP1gu2riFBoqijCyU_ZTwphApB1ClDy0JsjuNyHtvrf5xCu0xspGV7e-0wHEeY/exec'
};

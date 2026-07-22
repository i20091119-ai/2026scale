/* ═══════════════════════════════════════════════════════════════
 * remote-rank.js — 구글 시트(Apps Script) 랭킹 서버 통신
 * config.js 의 RANKING_API_URL 이 비어 있으면 비활성화된다.
 * ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var URL = (window.GameConfig && window.GameConfig.RANKING_API_URL) || '';

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error('timeout')); }, ms);
      })
    ]);
  }

  window.RemoteRank = {
    enabled: !!URL,

    /* 상위 기록 가져오기 → [{n, s, d}] 또는 실패 시 null */
    fetchTop: function () {
      if (!URL) return Promise.resolve(null);
      return withTimeout(fetch(URL).then(function (r) { return r.json(); }), 5000)
        .then(function (data) {
          return (data && data.ok && Array.isArray(data.list)) ? data.list : null;
        })
        .catch(function () { return null; });
    },

    /* 기록 올리기 → 성공 여부.
     * Content-Type 을 text/plain 으로 보내 CORS 사전요청 없이
     * Apps Script 가 받을 수 있게 한다. */
    submit: function (name, score) {
      if (!URL) return Promise.resolve(false);
      return withTimeout(fetch(URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ name: name, score: score })
      }).then(function (r) { return r.json(); }), 6000)
        .then(function (data) { return !!(data && data.ok); })
        .catch(function () { return false; });
    }
  };
})();

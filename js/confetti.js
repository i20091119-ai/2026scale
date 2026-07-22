/* ═══════════════════════════════════════════════════════════════
 * confetti.js — 내장 축하 연출(컨페티 + 폭죽), 외부 라이브러리 없음
 * ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var COLORS = ['#ff6b8a', '#ffb347', '#ffe066', '#7bd88f', '#5ec8e5', '#9b8cff', '#ff9ff3'];
  var running = false, canvas, cx, parts, rafId;

  function spawnBurst(x, y, count) {
    for (var i = 0; i < count; i++) {
      var ang = Math.random() * Math.PI * 2;
      var speed = 3 + Math.random() * 9;
      parts.push({
        x: x, y: y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed - 4,
        w: 8 + Math.random() * 10,
        h: 5 + Math.random() * 7,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.4,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        life: 1,
        decay: 0.004 + Math.random() * 0.006,
        shape: Math.random() < 0.25 ? 'circle' : 'rect'
      });
    }
  }

  function frame() {
    if (!running) return;
    cx.clearRect(0, 0, canvas.width, canvas.height);
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.vy += 0.18;                     // 중력
      p.vx *= 0.99; p.vy *= 0.995;
      p.x += p.vx; p.y += p.vy;
      p.rot += p.vr;
      p.life -= p.decay;
      if (p.life <= 0 || p.y > canvas.height + 40) { parts.splice(i, 1); continue; }
      cx.save();
      cx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.5));
      cx.translate(p.x, p.y);
      cx.rotate(p.rot);
      cx.fillStyle = p.color;
      if (p.shape === 'circle') {
        cx.beginPath(); cx.arc(0, 0, p.w / 2, 0, Math.PI * 2); cx.fill();
      } else {
        cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      cx.restore();
    }
    rafId = requestAnimationFrame(frame);
  }

  var burstTimer = null;

  window.Confetti = {
    start: function (canvasEl) {
      canvas = canvasEl;
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      cx = canvas.getContext('2d');
      parts = [];
      running = true;
      // 첫 대량 발사 + 주기적 추가 발사
      spawnBurst(canvas.width * 0.3, canvas.height * 0.4, 90);
      spawnBurst(canvas.width * 0.7, canvas.height * 0.35, 90);
      burstTimer = setInterval(function () {
        if (parts.length < 400) {
          spawnBurst(canvas.width * (0.15 + Math.random() * 0.7),
                     canvas.height * (0.2 + Math.random() * 0.4), 50);
        }
      }, 1200);
      frame();
    },
    stop: function () {
      running = false;
      if (burstTimer) { clearInterval(burstTimer); burstTimer = null; }
      if (rafId) cancelAnimationFrame(rafId);
      if (cx) cx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };
})();

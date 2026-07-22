/* ═══════════════════════════════════════════════════════════════
 * app.js — 균형 저울 게임 본체
 * 경남수학문화관 체험전시관 · 터치형 전자칠판용
 * ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 상수 ─────────────────────────────────────────────────── */
  var STAGE_W = 1920, STAGE_H = 1080;
  var BEAM_W = 1300, BEAM_H = 30, SLOT_GAP = 145;   // 거리 1칸 = 145px
  var WEIGHT_ON_BEAM = 116;                          // 저울 위 추 크기(px)
  var MAX_ANGLE = 11;                                // 최대 기울기(도)
  var TOTAL_QUESTIONS = 10;
  var TIME_LIMIT = 30;                               // 문제당 초
  var IDLE_LIMIT_MS = 90000;                         // 방치 → 시작화면
  var SCAFFOLD_MAX_TIER = 2;                         // 이 단계까지 유아용 도움 표시

  /* ── DOM ──────────────────────────────────────────────────── */
  var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage');
  var screens = {
    start: $('screen-start'),
    game: $('screen-game'),
    result: $('screen-result'),
    name: $('screen-name'),
    ranking: $('screen-ranking')
  };
  var beamEl = $('beam');
  var scaleArea = $('scale-area');
  var trayEl = $('tray');
  var equationEl = $('equation');
  var messageEl = $('message');
  var timerBar = $('timer-bar');
  var scoreEl = $('score');
  var qProgressEl = $('q-progress');
  var starRowEl = $('star-row');
  var feedbackOverlay = $('feedback-overlay');
  var feedbackCard = $('feedback-card');

  /* ── 상태 ─────────────────────────────────────────────────── */
  var pool = ProblemPool.generate();   // 100문제 (10단계 × 10)
  var state = {
    screen: 'start',
    problems: [],       // 이번 판 10문제
    qIndex: 0,
    problem: null,
    score: 0,
    correctCount: 0,
    wrongAttempts: 0,
    results: [],        // 문제별 true/false
    locked: true,
    solved: false,
    timerEnd: 0,
    timerRaf: 0,
    pausedRemaining: null,
    lastTickSec: -1,
    blankChips: [],    // 등식의 빈칸 칩 [{el, d}]
    targets: []        // 저울의 목표 칸 [{el, d, side, stack}] (중3 단계는 2개)
  };
  var drag = null;
  var lastInputAt = Date.now();

  /* ══════════ 화면 배율 (1920×1080 → 실제 화면) ══════════ */
  function fitStage() {
    var s = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    stage.style.transform = 'translate(-50%, -50%) scale(' + s + ')';
    stage.dataset.scale = s;
  }
  window.addEventListener('resize', fitStage);
  fitStage();

  function stageScale() { return parseFloat(stage.dataset.scale) || 1; }

  /* ══════════ 화면 전환 ══════════ */
  function showScreen(name) {
    Object.keys(screens).forEach(function (k) {
      screens[k].classList.toggle('active', k === name);
    });
    state.screen = name;
  }

  /* ══════════ 무게추 요소 생성 ══════════
   * assets/weights/weight-NN.png 가 있으면 일러스트를 쓰고,
   * 없으면 내장 그래픽(파스텔 추 + 숫자)으로 대체한다. */
  function makeWeight(n, cls) {
    var el = document.createElement('div');
    el.className = 'weight ' + (cls || '');
    el.dataset.n = n;
    el.style.setProperty('--wh', (n * 47) % 360);

    var img = document.createElement('img');
    img.className = 'w-img';
    img.alt = '';
    img.draggable = false;
    img.src = 'assets/weights/weight-' + String(n).padStart(2, '0') + '.png';
    img.addEventListener('load', function () { el.classList.add('has-img'); });
    img.addEventListener('error', function () { img.remove(); });

    var fb = document.createElement('div');
    fb.className = 'w-fallback';
    fb.innerHTML =
      '<div class="w-knob"></div>' +
      '<div class="w-body"><span class="w-num">' + n + '</span></div>';

    el.appendChild(fb);
    el.appendChild(img);
    return el;
  }

  /* ══════════ 저울 렌더링 ══════════ */
  function slotX(side, d) {
    var sign = side === 'left' ? -1 : 1;
    return BEAM_W / 2 + sign * d * SLOT_GAP;
  }

  var STACK_STEP = 128;   // 같은 칸에 추를 쌓을 때의 세로 간격(px)

  function renderScale(p) {
    beamEl.innerHTML = '';
    state.targets = [];
    var stacks = {};   // '팔:거리' → 그 칸에 쌓인 추 개수
    function stackLevel(side, d) {
      var key = side + ':' + d;
      var lv = stacks[key] || 0;
      stacks[key] = lv + 1;
      return lv;
    }

    // 거리 눈금 (양팔 1~4칸)
    ['left', 'right'].forEach(function (side) {
      for (var d = 1; d <= ProblemPool.MAX_DIST; d++) {
        var mark = document.createElement('div');
        mark.className = 'slot-mark';
        mark.style.left = slotX(side, d) + 'px';
        mark.innerHTML = '<div class="slot-tick"></div><div class="slot-num">' + d + '</div>';
        beamEl.appendChild(mark);
      }
    });

    // 이미 올라가 있는 추
    var scaffold = isScaffold();
    var slotBadges = {};   // 스캐폴딩: 칸마다 풍선 하나 (쌓인 추는 "2+3"처럼 합쳐 표시)
    ['left', 'right'].forEach(function (side) {
      p[side].forEach(function (t) {
        var w = makeWeight(t.w, 'on-beam');
        w.style.left = (slotX(side, t.d) - WEIGHT_ON_BEAM / 2) + 'px';
        w.style.bottom = 'calc(100% + ' + (stackLevel(side, t.d) * STACK_STEP) + 'px)';
        beamEl.appendChild(w);
        if (scaffold) {
          var key = side + ':' + t.d;
          if (!slotBadges[key]) slotBadges[key] = { el: w, values: [] };
          slotBadges[key].el = w;              // 맨 위 추가 풍선을 단다
          slotBadges[key].values.push(t.w);
        }
      });
    });
    Object.keys(slotBadges).forEach(function (key) {
      var info = slotBadges[key];
      var d = +key.split(':')[1];
      var expr = info.values.join('+');
      var total = info.values.reduce(function (a, b) { return a + b; }, 0);
      var text = d > 1 ? expr + '×' + d + '=' + total * d
        : (info.values.length > 1 ? expr : expr);
      addBadgeText(info.el, text);
    });

    renderSideSums(p);

    // 목표 칸(? 또는 x) — 그 칸에 이미 추가 있으면 그 위에 표시.
    // 미지수가 양쪽에 있는 방정식(중3)은 목표 칸이 양팔에 하나씩 생긴다.
    p.blanks.forEach(function (b) {
      var stack = stacks[b.side + ':' + b.d] || 0;
      var target = document.createElement('div');
      target.className = 'target-slot';
      target.style.left = (slotX(b.side, b.d) - WEIGHT_ON_BEAM / 2) + 'px';
      target.style.bottom = 'calc(100% + ' + (stack * STACK_STEP) + 'px)';
      target.innerHTML = '<span class="target-q' + (p.x ? ' x' : '') + '">' + (p.x ? 'x' : '?') + '</span>';
      beamEl.appendChild(target);
      state.targets.push({ el: target, d: b.d, side: b.side, stack: stack });
    });

    setTilt(computeTilt(null), false);
  }

  /* ══════════ 유아용 스캐폴딩 (1~2단계) ══════════
   * 추마다 "이 칸에서는 이 값" 풍선을 달고, 양팔 아래에 합계를 보여준다. */
  function isScaffold() {
    return state.problem && state.problem.tier <= SCAFFOLD_MAX_TIER;
  }

  function addBadgeText(weightEl, text) {
    var b = document.createElement('div');
    b.className = 'w-badge';
    b.textContent = text;
    weightEl.appendChild(b);
  }

  function addValueBadge(weightEl, w, d) {
    addBadgeText(weightEl, d > 1 ? (w + '×' + d + '=' + w * d) : String(w));
  }

  function renderSideSums(p) {
    var scaffold = isScaffold();
    ['left', 'right'].forEach(function (side) {
      var el = $(side === 'left' ? 'sum-left' : 'sum-right');
      el.classList.toggle('hidden', !scaffold);
      if (!scaffold) return;
      var parts = p[side].map(function (t) { return t.d > 1 ? t.w + '×' + t.d : String(t.w); });
      var hasBlank = p.blanks.some(function (b) { return b.side === side; });
      if (hasBlank) parts.push(p.x ? 'x' : '?');
      var text = parts.join(' + ') || '0';
      // 빈칸이 없는 팔은 합계까지 보여줘 목표 값을 알 수 있게 한다
      if (!hasBlank && parts.length > 1) text += ' = ' + ProblemPool.torque(p[side]);
      el.innerHTML = (side === 'left' ? '👈 왼쪽 ' : '👉 오른쪽 ') + '<b>' + text + '</b>';
    });
  }

  /* placedW: 목표 칸(들)에 임시/정답으로 올린 무게 (없으면 null) */
  function torquesWith(placedW) {
    var L = ProblemPool.torque(state.problem.left);
    var R = ProblemPool.torque(state.problem.right);
    if (placedW != null) {
      state.problem.blanks.forEach(function (b) {
        if (b.side === 'left') L += placedW * b.d; else R += placedW * b.d;
      });
    }
    return { L: L, R: R };
  }

  function computeTilt(placedW) {
    var t = torquesWith(placedW);
    var diff = t.R - t.L;   // 양수 → 오른쪽이 무거움 → 시계방향 회전
    return Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, diff * 1.2));
  }

  function setTilt(angle, settle) {
    beamEl.classList.toggle('settle', !!settle);
    beamEl.style.transform = 'rotate(' + angle + 'deg)';
  }

  function heavierSideText(placedW) {
    var t = torquesWith(placedW);
    if (t.L === t.R) return null;
    return t.L > t.R ? '왼쪽' : '오른쪽';
  }

  /* ══════════ 등식 렌더링 ══════════ */
  function termHTML(w, d) {
    return d > 1
      ? '<span class="t-w">' + w + '</span><span class="t-x">×</span><span class="t-d">' + d + '</span>'
      : '<span class="t-w">' + w + '</span>';
  }

  function blankChipHTML(p, d) {
    if (p.x) {
      // 방정식 표기: x, 2x, 3x … (계수 = 거리)
      return (d > 1 ? '<span class="t-w">' + d + '</span>' : '') +
             '<span class="blank-box x">x</span>';
    }
    return d > 1
      ? '<span class="blank-box">?</span><span class="t-x">×</span><span class="t-d">' + d + '</span>'
      : '<span class="blank-box">?</span>';
  }

  function renderEquation(p) {
    equationEl.innerHTML = '';
    state.blankChips = [];

    function addChip(html, cls) {
      var s = document.createElement('span');
      s.className = 'chip ' + (cls || '');
      s.innerHTML = html;
      equationEl.appendChild(s);
      return s;
    }
    function addOp(txt) {
      var s = document.createElement('span');
      s.className = 'op';
      s.textContent = txt;
      equationEl.appendChild(s);
    }

    ['left', 'right'].forEach(function (side, si) {
      if (si === 1) addOp('=');
      var knowns = p[side].map(function (t) { return { html: termHTML(t.w, t.d), blank: false }; });
      var blanks = p.blanks
        .filter(function (b) { return b.side === side; })
        .map(function (b) { return { html: blankChipHTML(p, b.d), blank: true, d: b.d }; });
      // 방정식(x) 표기에서는 미지수 항을 앞에 쓴다: 3x + 4 = 16
      var chips = p.x ? blanks.concat(knowns) : knowns.concat(blanks);
      chips.forEach(function (c, i) {
        if (i > 0) addOp('+');
        var el = addChip(c.html, c.blank ? 'blank' : '');
        if (c.blank) state.blankChips.push({ el: el, d: c.d });
      });
    });
  }

  function fillBlank(answer) {
    var p = state.problem;
    state.blankChips.forEach(function (c) {
      if (p.x && c.d > 1) {
        // 3x → 3×6 형태로 채워 계산 결과가 보이게 한다
        c.el.innerHTML = '<span class="t-w">' + c.d + '</span><span class="t-x">×</span>' +
                         '<span class="blank-box filled">' + answer + '</span>';
      } else {
        var box = c.el.querySelector('.blank-box');
        if (box) { box.textContent = answer; box.classList.add('filled'); box.classList.remove('x'); }
      }
      c.el.classList.add('solved');
    });
  }

  /* ══════════ 보관함 렌더링 ══════════ */
  function renderTray(p) {
    trayEl.innerHTML = '';
    ProblemPool.trayNumbers(p.answer).forEach(function (n) {
      var w = makeWeight(n, 'tray-weight');
      w.addEventListener('pointerdown', onWeightPointerDown);
      trayEl.appendChild(w);
    });
  }

  /* ══════════ 드래그 앤 드롭 (Pointer Events) ══════════ */
  function clientToStage(cx, cy) {
    var r = stage.getBoundingClientRect();
    var s = stageScale();
    return { x: (cx - r.left) / s, y: (cy - r.top) / s };
  }

  function onWeightPointerDown(e) {
    if (state.locked || drag) return;
    e.preventDefault();
    SFX.unlock();
    SFX.pickup();

    var src = e.currentTarget;
    var ghost = src.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.classList.remove('tray-weight');
    if (src.classList.contains('has-img')) ghost.classList.add('has-img');
    stage.appendChild(ghost);

    drag = { n: +src.dataset.n, src: src, ghost: ghost, pointerId: e.pointerId };
    src.classList.add('drag-src');
    src.setPointerCapture(e.pointerId);
    src.addEventListener('pointermove', onWeightPointerMove);
    src.addEventListener('pointerup', onWeightPointerUp);
    src.addEventListener('pointercancel', onWeightPointerUp);
    moveGhost(e.clientX, e.clientY);
  }

  function moveGhost(cx, cy) {
    var p = clientToStage(cx, cy);
    drag.ghost.style.left = (p.x - 65) + 'px';
    drag.ghost.style.top = (p.y - 80) + 'px';
    // 목표 칸 위에 있으면 하이라이트 (양쪽 미지수면 두 칸 모두).
    // 유아용 단계에서는 "이 칸에 놓으면 이 값이 돼요"를 미리 보여준다.
    var over = isOverTarget(cx, cy);
    state.targets.forEach(function (t) {
      t.el.classList.toggle('hover', over);
      if (isScaffold() && drag) setTargetPreview(t, over ? drag.n : null);
    });
  }

  function setTargetPreview(t, n) {
    var q = t.el.querySelector('.target-q');
    if (!q) return;
    if (n != null) {
      q.textContent = String(n * t.d);
      q.classList.add('preview');
    } else {
      q.textContent = state.problem.x ? 'x' : '?';
      q.classList.remove('preview');
    }
  }

  function isOverTarget(cx, cy) {
    var pad = 60 * stageScale();
    return state.targets.some(function (t) {
      var r = t.el.getBoundingClientRect();
      return cx > r.left - pad && cx < r.right + pad &&
             cy > r.top - pad && cy < r.bottom + pad * 1.6;
    });
  }

  function onWeightPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    moveGhost(e.clientX, e.clientY);
  }

  function onWeightPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    var d = drag;
    drag = null;
    d.src.removeEventListener('pointermove', onWeightPointerMove);
    d.src.removeEventListener('pointerup', onWeightPointerUp);
    d.src.removeEventListener('pointercancel', onWeightPointerUp);
    state.targets.forEach(function (t) {
      t.el.classList.remove('hover');
      if (isScaffold()) setTargetPreview(t, null);
    });

    if (!state.locked && !state.solved && isOverTarget(e.clientX, e.clientY)) {
      d.ghost.remove();
      d.src.classList.remove('drag-src');
      attemptPlace(d.n);
    } else {
      flyBack(d);
    }
  }

  function flyBack(d) {
    var srcRect = d.src.getBoundingClientRect();
    var p = clientToStage(srcRect.left, srcRect.top);
    d.ghost.classList.add('fly-back');
    d.ghost.style.left = p.x + 'px';
    d.ghost.style.top = p.y + 'px';
    setTimeout(function () {
      d.ghost.remove();
      d.src.classList.remove('drag-src');
    }, 300);
    SFX.drop();
  }

  /* ══════════ 정답 판정 ══════════ */
  function attemptPlace(n) {
    var p = state.problem;
    if (n === p.answer) succeed();
    else fail(n);
  }

  /* 목표 칸(들)에 추 올리기 — 양쪽 미지수면 같은 추가 양팔에 올라간다 */
  function placeWeightOnTarget(n) {
    return state.targets.map(function (t) {
      var w = makeWeight(n, 'on-beam placed');
      w.style.left = (slotX(t.side, t.d) - WEIGHT_ON_BEAM / 2) + 'px';
      w.style.bottom = 'calc(100% + ' + (t.stack * STACK_STEP) + 'px)';
      if (isScaffold()) addValueBadge(w, n, t.d);
      beamEl.appendChild(w);
      return w;
    });
  }

  function succeed() {
    state.solved = true;
    state.locked = true;
    stopTimer();
    state.targets.forEach(function (t) { t.el.classList.add('done'); });
    placeWeightOnTarget(state.problem.answer);
    setTilt(0, true);
    fillBlank(state.problem.answer);
    SFX.correct();

    // 점수 = 문제 단계 × 남은 시간(초)
    var timeLeft = Math.max(1, Math.ceil((state.timerEnd - performance.now()) / 1000));
    var tier = state.qIndex + 1;
    var points = tier * timeLeft;

    state.correctCount++;
    state.results.push(true);
    animateScore(state.score, state.score + points);
    state.score += points;
    renderStars();

    messageEl.innerHTML = '⚖️ 수평이 되었어요! <b>무게×거리</b>가 양쪽 모두 같아요.';
    showFeedback('🎉 정답이에요!', '+' + points + '점 (' + tier + '단계 × ' + timeLeft + '초)', 'good');
    setTimeout(nextQuestion, 1800);
  }

  function fail(n) {
    state.locked = true;
    state.wrongAttempts++;
    SFX.wrong();

    var temps = placeWeightOnTarget(n);
    temps.forEach(function (t) { t.classList.add('temp-wrong'); });
    setTilt(computeTilt(n), false);
    scaleArea.classList.add('shake');

    var side = heavierSideText(n);
    messageEl.innerHTML = side
      ? '❌ 아직 수평이 아니에요! <b>' + side + '</b>이 더 무거워요. 다른 추를 골라 보세요.'
      : '❌ 다시 한번 생각해 보세요!';

    setTimeout(function () {
      scaleArea.classList.remove('shake');
      temps.forEach(function (t) { t.remove(); });
      setTilt(computeTilt(null), false);
      state.locked = false;
    }, 1300);
  }

  function questionTimeout() {
    if (state.solved || state.screen !== 'game') return;
    state.solved = true;
    state.locked = true;
    stopTimer();
    SFX.timeout();

    // 정답을 보여주며 수평이 되는 모습으로 학습 기회 제공
    state.targets.forEach(function (t) { t.el.classList.add('done'); });
    placeWeightOnTarget(state.problem.answer);
    setTilt(0, true);
    fillBlank(state.problem.answer);

    state.results.push(false);
    renderStars();
    messageEl.innerHTML = '⏰ 시간 초과! 정답은 <b>' + state.problem.answer + '</b>이었어요.';
    showFeedback('⏰ 시간 초과!', '정답은 ' + state.problem.answer, 'bad');
    setTimeout(nextQuestion, 2400);
  }

  /* ══════════ 피드백 오버레이 ══════════ */
  function showFeedback(title, sub, kind) {
    feedbackCard.className = 'feedback-card ' + kind;
    feedbackCard.innerHTML = '<div class="fb-title">' + title + '</div>' +
                             '<div class="fb-sub">' + sub + '</div>';
    feedbackOverlay.classList.remove('hidden');
    setTimeout(function () { feedbackOverlay.classList.add('hidden'); }, 1400);
  }

  /* ══════════ 점수 · 진행 표시 ══════════ */
  function animateScore(from, to) {
    var t0 = performance.now(), dur = 600;
    (function step(now) {
      var k = Math.min(1, (now - t0) / dur);
      scoreEl.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  function renderStars() {
    var html = '';
    for (var i = 0; i < TOTAL_QUESTIONS; i++) {
      if (i < state.results.length) html += state.results[i] ? '⭐' : '<span class="star-miss">☆</span>';
      else html += '<span class="star-todo">☆</span>';
    }
    starRowEl.innerHTML = html;
  }

  /* ══════════ 타이머 ══════════ */
  function startTimer() {
    state.timerEnd = performance.now() + TIME_LIMIT * 1000;
    state.lastTickSec = -1;
    state.pausedRemaining = null;
    timerBar.classList.remove('warn', 'danger');
    runTimerLoop();
  }

  function runTimerLoop() {
    cancelAnimationFrame(state.timerRaf);
    (function tick(now) {
      if (state.screen !== 'game' || state.solved) return;
      var left = Math.max(0, state.timerEnd - now);
      var ratio = left / (TIME_LIMIT * 1000);
      timerBar.style.width = (ratio * 100) + '%';
      timerBar.classList.toggle('warn', ratio < 0.4 && ratio >= 0.17);
      timerBar.classList.toggle('danger', ratio < 0.17);
      var sec = Math.ceil(left / 1000);
      if (sec <= 5 && sec !== state.lastTickSec && sec > 0) { SFX.tick(); state.lastTickSec = sec; }
      if (left <= 0) { questionTimeout(); return; }
      state.timerRaf = requestAnimationFrame(tick);
    })(performance.now());
  }

  function stopTimer() { cancelAnimationFrame(state.timerRaf); }

  /* 게임 방법 팝업이 열려 있는 동안 남은 시간을 보존한다 */
  function pauseTimer() {
    if (state.screen === 'game' && !state.solved && state.pausedRemaining == null) {
      state.pausedRemaining = Math.max(0, state.timerEnd - performance.now());
      stopTimer();
    }
  }

  function resumeTimer() {
    if (state.pausedRemaining != null) {
      state.timerEnd = performance.now() + state.pausedRemaining;
      state.pausedRemaining = null;
      runTimerLoop();
    }
  }

  /* ══════════ 게임 진행 ══════════ */
  function startGame() {
    state.problems = ProblemPool.drawGame(pool);
    state.qIndex = 0;
    state.score = 0;
    state.correctCount = 0;
    state.results = [];
    scoreEl.textContent = '0';
    showScreen('game');
    loadQuestion();
  }

  function loadQuestion() {
    var p = state.problems[state.qIndex];
    state.problem = p;
    state.solved = false;
    state.locked = false;
    state.wrongAttempts = 0;

    qProgressEl.textContent = '문제 ' + (state.qIndex + 1) + ' / ' + TOTAL_QUESTIONS;
    $('q-grade').textContent = ProblemPool.TIER_INFO[p.tier - 1].grade + ' 수준';
    renderStars();

    // 수식 카드를 저울과 부딪히지 않는 모서리에 배치:
    // 무거운(내려가는) 팔 쪽 위 모서리에 두면 올라가는 추와 겹치지 않는다.
    var t0 = torquesWith(null);
    var panel = document.querySelector('.equation-panel');
    panel.classList.toggle('right', t0.R > t0.L);
    var termCount = p.left.length + p.right.length + p.blanks.length;
    panel.classList.toggle('compact', termCount >= 5);

    renderEquation(p);
    renderScale(p);
    renderTray(p);
    if (p.x) {
      messageEl.innerHTML = p.blanks.length > 1
        ? '<b>x</b>의 값을 구해 보세요! 양쪽 <b>x</b> 칸에 <b>같은 무게추</b>가 함께 올라가요.'
        : '<b>x</b>의 값을 구해서 무게추를 <b>x</b> 칸에 올려 보세요!';
    } else {
      messageEl.innerHTML = '무게추를 끌어서 반짝이는 <b>?</b> 칸에 올려 보세요! <span class="msg-hint">(무게 × 거리를 계산해요)</span>';
    }
    timerBar.style.width = '100%';
    startTimer();
    // 문제 전환 중에 게임 방법 팝업을 열어 둔 경우: 새 문제도 멈춘 채 시작
    if (!$('howto-modal').classList.contains('hidden')) pauseTimer();
  }

  function nextQuestion() {
    state.qIndex++;
    if (state.qIndex >= TOTAL_QUESTIONS) endGame();
    else loadQuestion();
  }

  function endGame() {
    showScreen('result');
    $('result-score').textContent = state.score;
    $('result-detail').textContent =
      TOTAL_QUESTIONS + '문제 중 ' + state.correctCount + '문제 정답';

    // 최대 점수 = (1+2+…+10) × 30초 = 1650점
    var rank;
    if (state.score >= 1250) rank = '🏆 수학 천재!';
    else if (state.score >= 850) rank = '🎓 수학 박사!';
    else if (state.score >= 450) rank = '🌟 수학 우등생!';
    else if (state.score > 0) rank = '💪 멋진 도전자!';
    else rank = '🍀 다음엔 잘할 수 있어요!';
    $('result-rank').textContent = rank;

    var starCount = state.correctCount === 0 ? 0
      : Math.max(1, Math.round(state.correctCount / TOTAL_QUESTIONS * 5));
    var sHtml = '';
    for (var i = 0; i < 5; i++) {
      sHtml += '<span class="rstar' + (i < starCount ? ' on' : '') + '" style="animation-delay:' + (0.15 * i) + 's">★</span>';
    }
    $('result-stars').innerHTML = sHtml;

    SFX.fanfare();
    Confetti.start($('confetti-canvas'));

    // assets/celebration.mp4 가 있으면 배경 영상으로 재생 (없으면 내장 연출만)
    var video = $('celebration-video');
    video.currentTime = 0;
    video.muted = true;
    video.loop = true;
    video.play().then(function () {
      video.classList.add('visible');
    }).catch(function () { /* 파일 없음/재생 불가 → 내장 연출만 사용 */ });
  }

  function goHome() {
    stopTimer();
    $('howto-modal').classList.add('hidden');
    Confetti.stop();
    var video = $('celebration-video');
    video.pause();
    video.classList.remove('visible');
    showScreen('start');
  }

  /* ══════════ 명예의 전당 (랭킹, localStorage 저장) ══════════ */
  var RANK_KEY = 'gnmc-scale-ranking';
  var NAME_MAX = 8;
  var composer = Hangul.create();

  function loadRanking() {
    try { return JSON.parse(localStorage.getItem(RANK_KEY)) || []; }
    catch (e) { return []; }
  }

  function addRanking(name, score) {
    var list = loadRanking();
    var entry = { id: Date.now() + '-' + Math.floor(Math.random() * 1e6), n: name, s: score, d: Date.now() };
    list.push(entry);
    list.sort(function (a, b) { return b.s - a.s || a.d - b.d; });
    localStorage.setItem(RANK_KEY, JSON.stringify(list.slice(0, 50)));
    return entry;
  }

  function showRankingScreen(highlightId) {
    var list = loadRanking().slice(0, 10);
    var host = $('ranking-list');
    if (!list.length) {
      host.innerHTML = '<li class="rank-empty">아직 기록이 없어요. 첫 번째 주인공이 되어 보세요!</li>';
    } else {
      var medals = ['🥇', '🥈', '🥉'];
      host.innerHTML = list.map(function (e, i) {
        var when = new Date(e.d);
        var dateStr = (when.getMonth() + 1) + '.' + when.getDate();
        return '<li class="rank-row' + (e.id === highlightId ? ' me' : '') + '">' +
          '<span class="rank-no">' + (medals[i] || (i + 1) + '위') + '</span>' +
          '<span class="rank-name">' + escapeHTML(e.n) + '</span>' +
          '<span class="rank-date">' + dateStr + '</span>' +
          '<span class="rank-score">' + e.s + '점</span></li>';
      }).join('');
    }
    Confetti.stop();
    showScreen('ranking');
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ── 닉네임 입력 + 화면 키보드 ── */
  var OSK_PAGES = {
    '한글': [
      ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ'],
      ['ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'],
      ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅛ'],
      ['ㅜ', 'ㅠ', 'ㅡ', 'ㅣ', '⌫']
    ],
    'ABC': [
      'ABCDEFGHIJ'.split(''),
      'KLMNOPQRS'.split(''),
      'TUVWXYZ'.split('').concat(['⌫'])
    ],
    '123': [
      '1234567890'.split(''),
      ['⭐', '🌙', '❤', '😀', '🐥', '⚖', '⌫']
    ]
  };

  function renderOSK(pageName) {
    var host = $('osk');
    host.innerHTML = '';
    OSK_PAGES[pageName].forEach(function (row) {
      var rowEl = document.createElement('div');
      rowEl.className = 'osk-row';
      row.forEach(function (key) {
        var b = document.createElement('button');
        b.className = 'osk-key' + (key === '⌫' ? ' osk-back' : '');
        b.textContent = key;
        b.addEventListener('click', function () { onOSKKey(key); });
        rowEl.appendChild(b);
      });
      host.appendChild(rowEl);
    });
    document.querySelectorAll('.osk-tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.page === pageName);
    });
  }

  function onOSKKey(key) {
    SFX.click();
    if (key === '⌫') composer.backspace();
    else if (composer.length() < NAME_MAX) composer.input(key);
    $('name-display').textContent = composer.text();
  }

  function showNameEntry() {
    Confetti.stop();
    composer.reset();
    $('name-display').textContent = '';
    $('name-score').textContent = state.score;
    renderOSK('한글');
    showScreen('name');
  }

  function submitName() {
    var name = composer.text().trim();
    if (!name) {
      $('name-display').parentElement.classList.remove('need');
      void $('name-display').parentElement.offsetWidth;   // 애니메이션 재시작
      $('name-display').parentElement.classList.add('need');
      SFX.wrong();
      return;
    }
    SFX.correct();
    var entry = addRanking(name, state.score);
    showRankingScreen(entry.id);
  }

  document.querySelectorAll('.osk-tab').forEach(function (t) {
    t.addEventListener('click', function () { SFX.click(); renderOSK(t.dataset.page); });
  });
  $('btn-rank-entry').addEventListener('click', function () { SFX.click(); showNameEntry(); });
  $('btn-name-ok').addEventListener('click', submitName);
  $('btn-name-skip').addEventListener('click', function () { SFX.click(); showRankingScreen(null); });
  $('btn-hall').addEventListener('click', function () { SFX.unlock(); SFX.click(); showRankingScreen(null); });
  $('btn-rank-restart').addEventListener('click', function () { SFX.click(); startGame(); });
  $('btn-rank-home').addEventListener('click', function () { SFX.click(); goHome(); });

  /* ══════════ 시작 화면: 떠다니는 추 장식 ══════════ */
  (function buildFloatWeights() {
    var host = document.querySelector('.float-weights');
    var nums = [3, 7, 1, 5, 9, 2, 8, 4];
    nums.forEach(function (n, i) {
      var w = makeWeight(n, 'float-weight');
      w.style.left = (6 + (i * 12.5) % 90) + '%';
      w.style.top = (10 + ((i * 37) % 70)) + '%';
      w.style.animationDelay = (i * 0.7) + 's';
      w.style.animationDuration = (5 + (i % 3) * 1.4) + 's';
      host.appendChild(w);
    });
  })();

  /* ══════════ 게임 방법 팝업 ══════════ */
  var howtoModal = $('howto-modal');

  function openHowto() {
    SFX.unlock();
    SFX.click();
    pauseTimer();
    howtoModal.classList.remove('hidden');
  }

  function closeHowto() {
    SFX.click();
    howtoModal.classList.add('hidden');
    resumeTimer();
  }

  $('btn-howto-start').addEventListener('click', openHowto);
  $('btn-howto-game').addEventListener('click', openHowto);
  $('btn-howto-close').addEventListener('click', closeHowto);
  howtoModal.addEventListener('click', function (e) {
    if (e.target === howtoModal) closeHowto();   // 바깥(배경) 터치로도 닫기
  });

  /* ══════════ 버튼 ══════════ */
  $('btn-start').addEventListener('click', function () { SFX.unlock(); SFX.click(); startGame(); });
  $('btn-restart').addEventListener('click', function () { SFX.click(); Confetti.stop(); startGame(); });
  $('btn-quit').addEventListener('click', function () { SFX.click(); goHome(); });
  $('btn-mute').addEventListener('click', function () {
    var m = SFX.toggleMute();
    $('btn-mute').textContent = m ? '🔇' : '🔊';
    if (!m) SFX.click();
  });
  $('btn-mute').textContent = SFX.isMuted() ? '🔇' : '🔊';

  /* ══════════ 디자인 교체 슬롯 감지 ══════════
   * assets/ui/ 에 이미지가 있으면 body 클래스로 스킨을 켠다.
   * (규격: docs/디자인_가이드.md) */
  [
    ['assets/ui/bg-start.png', 'skin-bg-start'],
    ['assets/ui/bg-game.png', 'skin-bg-game'],
    ['assets/ui/bg-result.png', 'skin-bg-result'],
    ['assets/ui/title.png', 'skin-title'],
    ['assets/ui/beam.png', 'skin-beam'],
    ['assets/ui/stand.png', 'skin-stand'],
    ['assets/ui/tray.png', 'skin-tray']
    // 시작 화면 안내 카드(howto-1~3.png)는 카드의 img onload 로 개별 적용된다
  ].forEach(function (pair) {
    var im = new Image();
    im.onload = function () { document.body.classList.add(pair[1]); };
    im.src = pair[0];
  });

  /* ══════════ 전시(키오스크) 대응 ══════════ */
  // 방치 시 시작화면 복귀
  document.addEventListener('pointerdown', function () { lastInputAt = Date.now(); }, true);
  setInterval(function () {
    if (state.screen !== 'start' && Date.now() - lastInputAt > IDLE_LIMIT_MS) goHome();
  }, 5000);

  // 롱프레스 메뉴·더블탭 확대·드래그 선택 차단
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  document.addEventListener('dblclick', function (e) { e.preventDefault(); });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });

  showScreen('start');

  // 점검·테스트용 (콘솔에서 상태 확인)
  window.GameDebug = { state: state, pool: pool };
})();

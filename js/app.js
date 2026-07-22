/* ═══════════════════════════════════════════════════════════════
 * app.js — 균형 저울 게임 본체
 * 경남수학문화관 체험전시관 · 터치형 전자칠판용
 * ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 상수 ─────────────────────────────────────────────────── */
  var STAGE_W = 1920, STAGE_H = 1080;
  var BEAM_W = 1100, BEAM_H = 26, SLOT_GAP = 125;   // 거리 1칸 = 125px
  var WEIGHT_ON_BEAM = 104;                          // 저울 위 추 크기(px)
  var MAX_ANGLE = 13;                                // 최대 기울기(도)
  var TOTAL_QUESTIONS = 10;
  var TIME_LIMIT = 30;                               // 문제당 초
  var IDLE_LIMIT_MS = 90000;                         // 방치 → 시작화면

  /* ── DOM ──────────────────────────────────────────────────── */
  var $ = function (id) { return document.getElementById(id); };
  var stage = $('stage');
  var screens = {
    start: $('screen-start'),
    game: $('screen-game'),
    result: $('screen-result')
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
    streak: 0,
    correctCount: 0,
    wrongAttempts: 0,
    results: [],        // 문제별 true/false
    locked: true,
    solved: false,
    timerEnd: 0,
    timerRaf: 0,
    lastTickSec: -1,
    blankChipEl: null,
    targetSlotEl: null,
    targetStack: 0
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

  var STACK_STEP = 114;   // 같은 칸에 추를 쌓을 때의 세로 간격(px)

  function renderScale(p) {
    beamEl.innerHTML = '';
    state.targetSlotEl = null;
    state.targetStack = 0;
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
    ['left', 'right'].forEach(function (side) {
      p[side].forEach(function (t) {
        var w = makeWeight(t.w, 'on-beam');
        w.style.left = (slotX(side, t.d) - WEIGHT_ON_BEAM / 2) + 'px';
        w.style.bottom = 'calc(100% + ' + (stackLevel(side, t.d) * STACK_STEP) + 'px)';
        beamEl.appendChild(w);
      });
    });

    // 목표 칸(?) — 그 칸에 이미 추가 있으면 그 위에 표시
    state.targetStack = stacks[p.blankSide + ':' + p.blankD] || 0;
    var target = document.createElement('div');
    target.className = 'target-slot';
    target.style.left = (slotX(p.blankSide, p.blankD) - WEIGHT_ON_BEAM / 2) + 'px';
    target.style.bottom = 'calc(100% + ' + (state.targetStack * STACK_STEP) + 'px)';
    target.innerHTML = '<span class="target-q">?</span>';
    beamEl.appendChild(target);
    state.targetSlotEl = target;

    setTilt(computeTilt(null), false);
  }

  /* placedW: 빈칸에 임시/정답으로 올린 무게 (없으면 null) */
  function computeTilt(placedW) {
    var L = ProblemPool.torque(state.problem.left);
    var R = ProblemPool.torque(state.problem.right);
    if (placedW != null) {
      var add = placedW * state.problem.blankD;
      if (state.problem.blankSide === 'left') L += add; else R += add;
    }
    var diff = R - L;   // 양수 → 오른쪽이 무거움 → 시계방향 회전
    return Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, diff * 1.2));
  }

  function setTilt(angle, settle) {
    beamEl.classList.toggle('settle', !!settle);
    beamEl.style.transform = 'rotate(' + angle + 'deg)';
  }

  function heavierSideText(placedW) {
    var L = ProblemPool.torque(state.problem.left);
    var R = ProblemPool.torque(state.problem.right);
    if (placedW != null) {
      var add = placedW * state.problem.blankD;
      if (state.problem.blankSide === 'left') L += add; else R += add;
    }
    if (L === R) return null;
    return L > R ? '왼쪽' : '오른쪽';
  }

  /* ══════════ 등식 렌더링 ══════════ */
  function termHTML(w, d) {
    return d > 1
      ? '<span class="t-w">' + w + '</span><span class="t-x">×</span><span class="t-d">' + d + '</span>'
      : '<span class="t-w">' + w + '</span>';
  }

  function renderEquation(p) {
    equationEl.innerHTML = '';
    state.blankChipEl = null;

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
      var chips = p[side].map(function (t) { return { html: termHTML(t.w, t.d), blank: false }; });
      if (p.blankSide === side) {
        chips.push({
          html: p.blankD > 1
            ? '<span class="blank-box">?</span><span class="t-x">×</span><span class="t-d">' + p.blankD + '</span>'
            : '<span class="blank-box">?</span>',
          blank: true
        });
      }
      chips.forEach(function (c, i) {
        if (i > 0) addOp('+');
        var el = addChip(c.html, c.blank ? 'blank' : '');
        if (c.blank) state.blankChipEl = el;
      });
    });
  }

  function fillBlank(answer) {
    if (!state.blankChipEl) return;
    var box = state.blankChipEl.querySelector('.blank-box');
    if (box) { box.textContent = answer; box.classList.add('filled'); }
    state.blankChipEl.classList.add('solved');
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
    // 목표 칸 위에 있으면 하이라이트
    if (state.targetSlotEl) {
      state.targetSlotEl.classList.toggle('hover', isOverTarget(cx, cy));
    }
  }

  function isOverTarget(cx, cy) {
    if (!state.targetSlotEl) return false;
    var r = state.targetSlotEl.getBoundingClientRect();
    var pad = 60 * stageScale();
    return cx > r.left - pad && cx < r.right + pad &&
           cy > r.top - pad && cy < r.bottom + pad * 1.6;
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
    if (state.targetSlotEl) state.targetSlotEl.classList.remove('hover');

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

  function placeWeightOnTarget(n) {
    var p = state.problem;
    var w = makeWeight(n, 'on-beam placed');
    w.style.left = (slotX(p.blankSide, p.blankD) - WEIGHT_ON_BEAM / 2) + 'px';
    w.style.bottom = 'calc(100% + ' + (state.targetStack * STACK_STEP) + 'px)';
    beamEl.appendChild(w);
    return w;
  }

  function succeed() {
    state.solved = true;
    state.locked = true;
    stopTimer();
    if (state.targetSlotEl) state.targetSlotEl.classList.add('done');
    placeWeightOnTarget(state.problem.answer);
    setTilt(0, true);
    fillBlank(state.problem.answer);
    SFX.correct();

    var timeLeft = Math.max(0, Math.ceil((state.timerEnd - performance.now()) / 1000));
    var base = Math.max(100 - state.wrongAttempts * 20, 40);
    var bonusTime = timeLeft * 2;
    var bonusStreak = Math.min(state.streak * 10, 50);
    var points = base + bonusTime + bonusStreak;

    state.streak++;
    state.correctCount++;
    state.results.push(true);
    animateScore(state.score, state.score + points);
    state.score += points;
    renderStars();

    messageEl.innerHTML = '⚖️ 수평이 되었어요! <b>무게×거리</b>가 양쪽 모두 같아요.';
    showFeedback('🎉 정답이에요!', '+' + points + '점', 'good');
    setTimeout(nextQuestion, 1800);
  }

  function fail(n) {
    state.locked = true;
    state.wrongAttempts++;
    SFX.wrong();

    var temp = placeWeightOnTarget(n);
    temp.classList.add('temp-wrong');
    setTilt(computeTilt(n), false);
    scaleArea.classList.add('shake');

    var side = heavierSideText(n);
    messageEl.innerHTML = side
      ? '❌ 아직 수평이 아니에요! <b>' + side + '</b>이 더 무거워요. 다른 추를 골라 보세요.'
      : '❌ 다시 한번 생각해 보세요!';

    setTimeout(function () {
      scaleArea.classList.remove('shake');
      temp.remove();
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
    if (state.targetSlotEl) state.targetSlotEl.classList.add('done');
    placeWeightOnTarget(state.problem.answer);
    setTilt(0, true);
    fillBlank(state.problem.answer);

    state.streak = 0;
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
    timerBar.classList.remove('warn', 'danger');
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

  /* ══════════ 게임 진행 ══════════ */
  function startGame() {
    state.problems = ProblemPool.drawGame(pool);
    state.qIndex = 0;
    state.score = 0;
    state.streak = 0;
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
    renderStars();
    renderEquation(p);
    renderScale(p);
    renderTray(p);
    messageEl.innerHTML = '무게추를 끌어서 반짝이는 <b>?</b> 칸에 올려 보세요! <span class="msg-hint">(무게 × 거리를 계산해요)</span>';
    timerBar.style.width = '100%';
    startTimer();
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

    var rank;
    if (state.score >= 1700) rank = '🏆 수학 천재!';
    else if (state.score >= 1200) rank = '🎓 수학 박사!';
    else if (state.score >= 700) rank = '🌟 수학 우등생!';
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
    Confetti.stop();
    var video = $('celebration-video');
    video.pause();
    video.classList.remove('visible');
    showScreen('start');
  }

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

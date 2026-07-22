/* ═══════════════════════════════════════════════════════════════
 * problems.js — 문제풀 생성기 (초1 ~ 중3 수준)
 *
 * 난이도 10단계 × 각 10문제 = 총 100문제.
 * 시드 고정 난수를 사용하므로 풀은 항상 동일하게 재현된다(검수 가능).
 * 게임에서 n번째 문제는 n단계 풀에서 랜덤으로 1개를 뽑는다.
 * 전체 풀은 problems.html 에서 열람할 수 있다.
 *
 * 수학 모델(지렛대 원리): 수평 ⇔ Σ(무게×거리)왼쪽 = Σ(무게×거리)오른쪽
 *  - 거리 1칸의 추 w  → 등식의 항 "w"
 *  - 거리 d칸의 추 w  → 등식의 항 "w×d"
 *  - 빈칸(거리 d)     → "□×d" / x표기 단계에서는 "dx"
 *
 * 저울은 곧 일차방정식이다: 미지수 x = 올려야 하는 추의 무게,
 * 거리 = 계수. 미지수가 양쪽에 있는 방정식(중3 단계)은 양팔에
 * 목표 칸이 2개 생기고, 같은 무게추가 양쪽에 동시에 올라간다.
 *
 * 문제 객체:
 *   { tier, left:[{w,d}], right:[{w,d}],
 *     blanks:[{side:'left'|'right', d}],   // 목표 칸 1~2개
 *     answer, x:boolean }                  // x: 방정식(x) 표기 여부
 * ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var MAX_WEIGHT = 18;   // 보유 무게추 일러스트: 1 ~ 18
  var MAX_DIST = 4;      // 양팔 거리 칸: 1 ~ 4
  var PER_TIER = 10;     // 단계별 문제 수
  var SEED = 20260722;

  /* 단계별 학년·내용 (게임 화면과 문제풀 열람에 함께 표시) */
  var TIER_INFO = [
    { grade: '초1', label: '한 자리 수의 덧셈' },
    { grade: '초2', label: '받아올림이 있는 덧셈과 뺄셈' },
    { grade: '초3', label: '세 수의 덧셈과 뺄셈' },
    { grade: '초3', label: '곱셈구구' },
    { grade: '초4', label: '곱셈과 나눗셈' },
    { grade: '초5', label: '자연수의 혼합 계산' },
    { grade: '초6', label: '혼합 계산 심화' },
    { grade: '중1', label: '일차방정식' },
    { grade: '중2', label: '일차방정식 심화' },
    { grade: '중3', label: '미지수가 양쪽에 있는 방정식' }
  ];

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var rng = mulberry32(SEED);
  function ri(min, max) { return min + Math.floor(rng() * (max - min + 1)); }
  function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }

  function torque(terms) {
    var t = 0;
    for (var i = 0; i < terms.length; i++) t += terms[i].w * terms[i].d;
    return t;
  }

  /* 알려진 항들과 목표 칸(1~2개)으로부터 정답을 계산해 문제를 완성한다.
   * 수평 조건: torque(left) + Σ(왼쪽 blank d)·x = torque(right) + Σ(오른쪽 blank d)·x
   * → x = (torque(right) − torque(left)) / (Σ왼쪽 blank d − Σ오른쪽 blank d)
   * 정답이 1..MAX_WEIGHT 의 자연수가 아니면 null. */
  function finish(tier, left, right, blanks, useX) {
    var netBlank = 0;
    for (var i = 0; i < blanks.length; i++) {
      netBlank += blanks[i].side === 'left' ? blanks[i].d : -blanks[i].d;
      if (blanks[i].d < 1 || blanks[i].d > MAX_DIST) return null;
    }
    if (netBlank === 0) return null;
    var diff = torque(right) - torque(left);
    if (diff % netBlank !== 0) return null;
    var answer = diff / netBlank;
    if (answer < 1 || answer > MAX_WEIGHT) return null;
    var all = left.concat(right);
    for (var j = 0; j < all.length; j++) {
      if (all[j].w < 1 || all[j].w > MAX_WEIGHT) return null;
      if (all[j].d < 1 || all[j].d > MAX_DIST) return null;
    }
    return { tier: tier, left: left, right: right, blanks: blanks,
             answer: answer, x: !!useX };
  }

  /* 좌우를 뒤집어 빈칸이 등식 왼쪽에도 나타나게 한다 */
  function maybeMirror(p, prob) {
    if (p && rng() < prob) {
      var t = p.left; p.left = p.right; p.right = t;
      p.blanks.forEach(function (b) {
        b.side = b.side === 'left' ? 'right' : 'left';
      });
    }
    return p;
  }

  /* ── 단계별 출제 규칙 ─────────────────────────────────────── */
  var tierBuilders = [
    // 1단계 [초1] a + b = □  (합 9 이하, 거리 1)
    function () {
      var a = ri(1, 8), b = ri(1, Math.min(8, 9 - a));
      return finish(1, [{ w: a, d: 1 }, { w: b, d: 1 }], [], [{ side: 'right', d: 1 }]);
    },
    // 2단계 [초2] a + b = c + □  (받아올림, 뺄셈 개념)
    function () {
      var a = ri(4, 9), b = ri(4, 9), c = ri(2, a + b - 2);
      return finish(2, [{ w: a, d: 1 }, { w: b, d: 1 }], [{ w: c, d: 1 }], [{ side: 'right', d: 1 }]);
    },
    // 3단계 [초3] a + b + c = d + □  (세 수 계산, 좌우 반전 섞임)
    function () {
      var a = ri(2, 9), b = ri(2, 9), c = ri(2, 9), d = ri(3, 14);
      return maybeMirror(
        finish(3, [{ w: a, d: 1 }, { w: b, d: 1 }, { w: c, d: 1 }], [{ w: d, d: 1 }],
               [{ side: 'right', d: 1 }]),
        0.4);
    },
    // 4단계 [초3] a×d = □  (곱셈구구 — 거리 칸 등장)
    function () {
      var d = ri(2, 4), a = ri(2, Math.floor(MAX_WEIGHT / d));
      return finish(4, [{ w: a, d: d }], [], [{ side: 'right', d: 1 }]);
    },
    // 5단계 [초4] a×d1 = □×d2  (나눗셈 개념)
    function () {
      var d1 = ri(2, 4), d2 = pick([2, 3].filter(function (x) { return x !== d1; })),
          a = ri(2, 9);
      return finish(5, [{ w: a, d: d1 }], [], [{ side: 'right', d: d2 }]);
    },
    // 6단계 [초5] a×d + b = □ 또는 a×d + b = c + □  (혼합 계산)
    function () {
      var d = ri(2, 3), a = ri(2, 5), b = ri(1, 9);
      var right = rng() < 0.5 ? [] : [{ w: ri(1, 9), d: 1 }];
      return finish(6, [{ w: a, d: d }, { w: b, d: 1 }], right, [{ side: 'right', d: 1 }]);
    },
    // 7단계 [초6] a×d1 + b = c + □×d2  (혼합 계산 심화)
    function () {
      var d1 = ri(2, 4), d2 = ri(2, 3), a = ri(2, 7), b = ri(1, 9), c = ri(1, 9);
      return maybeMirror(
        finish(7, [{ w: a, d: d1 }, { w: b, d: 1 }], [{ w: c, d: 1 }],
               [{ side: 'right', d: d2 }]),
        0.3);
    },
    // 8단계 [중1] dx + b = c×d2  (일차방정식, x 표기 시작)
    function () {
      var d = ri(2, 4), xv = ri(2, 8), b = ri(1, 9);
      var total = d * xv + b;
      var d2 = pick([1, 2, 3, 4].filter(function (k) {
        return total % k === 0 && total / k <= MAX_WEIGHT;
      }));
      if (!d2) return null;
      return maybeMirror(
        finish(8, [{ w: b, d: 1 }], [{ w: total / d2, d: d2 }],
               [{ side: 'left', d: d }], true),
        0.3);
    },
    // 9단계 [중2] d1x + a×d2 = b×d3 + c  (계수·항이 늘어난 일차방정식)
    function () {
      var d1 = ri(2, 4), d2 = ri(1, 3), d3 = ri(2, 4);
      var a = ri(2, 9), b = ri(2, 9), c = ri(1, 9);
      var right = rng() < 0.5 ? [{ w: b, d: d3 }] : [{ w: b, d: d3 }, { w: c, d: 1 }];
      return maybeMirror(
        finish(9, [{ w: a, d: d2 }], right, [{ side: 'left', d: d1 }], true),
        0.4);
    },
    // 10단계 [중3] d1x + a = d2x + b  (미지수가 양쪽에!)
    function () {
      var d1 = ri(2, 4), d2 = ri(1, d1 - 1);
      var xv = ri(2, Math.floor(16 / (d1 - d2)));
      var a = ri(1, MAX_WEIGHT - (d1 - d2) * xv);
      var b = a + (d1 - d2) * xv;
      return maybeMirror(
        finish(10, [{ w: a, d: 1 }], [{ w: b, d: 1 }],
               [{ side: 'left', d: d1 }, { side: 'right', d: d2 }], true),
        0.5);
    }
  ];

  function signature(p) {
    function key(terms) {
      return terms.map(function (t) { return t.w + 'x' + t.d; }).sort().join(',');
    }
    var bk = p.blanks.map(function (b) { return b.side + b.d; }).sort().join(',');
    return [key(p.left), key(p.right), bk, p.answer].join('|');
  }

  function generatePool() {
    var pool = [];   // pool[tier-1] = 문제 10개 배열
    for (var t = 0; t < tierBuilders.length; t++) {
      var list = [], seen = {}, guard = 0;
      while (list.length < PER_TIER && guard++ < 8000) {
        var p = tierBuilders[t]();
        if (!p) continue;
        var sig = signature(p);
        if (seen[sig]) continue;
        seen[sig] = true;
        list.push(p);
      }
      pool.push(list);
    }
    return pool;
  }

  /* 게임 한 판(10문제) 뽑기 — 각 단계에서 무작위로 1문제 */
  function drawGame(pool) {
    return pool.map(function (list) {
      return list[Math.floor(Math.random() * list.length)];
    });
  }

  /* 보관함에 담을 무게추: 정답 + 서로 다른 오답 7개 (1..MAX_WEIGHT) */
  function trayNumbers(answer) {
    var nums = [answer], tries = 0;
    while (nums.length < 8 && tries++ < 300) {
      var n = Math.random() < 0.6
        ? answer + (Math.floor(Math.random() * 9) - 4)   // 정답 근처
        : 1 + Math.floor(Math.random() * MAX_WEIGHT);    // 아무거나
      if (n >= 1 && n <= MAX_WEIGHT && nums.indexOf(n) === -1) nums.push(n);
    }
    for (var i = nums.length - 1; i > 0; i--) {          // 섞기
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = nums[i]; nums[i] = nums[j]; nums[j] = tmp;
    }
    return nums;
  }

  /* 등식 문자열 만들기 (문제풀 열람·검증용) */
  function equationText(p) {
    function side(name) {
      var parts = [];
      var blanks = p.blanks.filter(function (b) { return b.side === name; });
      var knowns = p[name].map(function (t) {
        return t.d > 1 ? t.w + '×' + t.d : String(t.w);
      });
      var blankParts = blanks.map(function (b) {
        if (p.x) return b.d > 1 ? b.d + 'x' : 'x';
        return b.d > 1 ? '□×' + b.d : '□';
      });
      // 방정식(x) 표기에서는 미지수 항을 앞에 쓴다
      parts = p.x ? blankParts.concat(knowns) : knowns.concat(blankParts);
      return parts.join(' + ') || '0';
    }
    return side('left') + ' = ' + side('right');
  }

  window.ProblemPool = {
    MAX_WEIGHT: MAX_WEIGHT,
    MAX_DIST: MAX_DIST,
    TIER_INFO: TIER_INFO,
    generate: generatePool,
    drawGame: drawGame,
    trayNumbers: trayNumbers,
    torque: torque,
    equationText: equationText
  };
})();

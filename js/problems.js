/* ═══════════════════════════════════════════════════════════════
 * problems.js — 문제풀 생성기
 *
 * 난이도 10단계 × 각 10문제 = 총 100문제.
 * 시드 고정 난수를 사용하므로 풀은 항상 동일하게 재현된다(검수 가능).
 * 게임에서 n번째 문제는 n단계 풀에서 랜덤으로 1개를 뽑는다.
 *
 * 수학 모델(지렛대 원리): 수평 ⇔ Σ(무게×거리)왼쪽 = Σ(무게×거리)오른쪽
 *  - 거리 1칸의 추 w  → 등식의 항 "w"
 *  - 거리 d칸의 추 w  → 등식의 항 "w×d"
 *  - 빈칸(거리 d)     → "□×d" (d=1이면 "□")
 *
 * 문제 객체 형태:
 *   { tier, left:[{w,d}], right:[{w,d}], blankSide:'left'|'right',
 *     blankD, answer }
 *  left/right 는 이미 올라가 있는 추 목록. 빈칸은 blankSide 팔의
 *  blankD 거리 칸이며 정답 무게는 answer.
 * ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var MAX_WEIGHT = 18;   // 보유 무게추 일러스트: 1 ~ 18
  var MAX_DIST = 4;      // 양팔 거리 칸: 1 ~ 4
  var PER_TIER = 10;     // 단계별 문제 수
  var SEED = 20260722;

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

  /* 알려진 항들과 빈칸 거리로부터 정답을 계산해 문제를 완성한다.
   * 정답이 1..MAX_WEIGHT 의 자연수가 아니면 null. */
  function finish(tier, left, right, blankSide, blankD) {
    var known = blankSide === 'left' ? left : right;
    var other = blankSide === 'left' ? right : left;
    var need = torque(other) - torque(known);
    if (need <= 0 || need % blankD !== 0) return null;
    var answer = need / blankD;
    if (answer < 1 || answer > MAX_WEIGHT) return null;
    var all = left.concat(right);
    for (var i = 0; i < all.length; i++) {
      if (all[i].w < 1 || all[i].w > MAX_WEIGHT) return null;
      if (all[i].d < 1 || all[i].d > MAX_DIST) return null;
    }
    return { tier: tier, left: left, right: right,
             blankSide: blankSide, blankD: blankD, answer: answer };
  }

  /* 높은 단계에서는 빈칸이 등식 왼쪽에 오기도 하도록 좌우를 뒤집는다 */
  function maybeMirror(p, prob) {
    if (p && rng() < prob) {
      var t = p.left; p.left = p.right; p.right = t;
      p.blankSide = p.blankSide === 'left' ? 'right' : 'left';
    }
    return p;
  }

  /* ── 단계별 출제 규칙 ─────────────────────────────────────── */
  var tierBuilders = [
    // 1단계: a + b = □  (작은 덧셈, 거리 1)
    function () {
      var a = ri(1, 5), b = ri(1, 5);
      return finish(1, [{ w: a, d: 1 }, { w: b, d: 1 }], [], 'right', 1);
    },
    // 2단계: a + b = c + □  (뺄셈 개념)
    function () {
      var a = ri(2, 8), b = ri(2, 8), c = ri(1, Math.max(1, a + b - 1));
      return finish(2, [{ w: a, d: 1 }, { w: b, d: 1 }], [{ w: c, d: 1 }], 'right', 1);
    },
    // 3단계: a + b + c = d + □  (세 수 덧셈, 좌우 반전 섞임)
    function () {
      var a = ri(2, 9), b = ri(2, 9), c = ri(2, 9), d = ri(3, 12);
      return maybeMirror(
        finish(3, [{ w: a, d: 1 }, { w: b, d: 1 }, { w: c, d: 1 }], [{ w: d, d: 1 }], 'right', 1),
        0.4);
    },
    // 4단계: a×d = □  (곱셈 도입 — 거리 칸 등장)
    function () {
      var d = ri(2, 3), a = ri(2, Math.floor(MAX_WEIGHT / d));
      return finish(4, [{ w: a, d: d }], [], 'right', 1);
    },
    // 5단계: a×d1 = □×d2  (나눗셈 개념)
    function () {
      var d1 = ri(2, 4), d2 = pick([2, 3].filter(function (x) { return x !== d1; })),
          a = ri(2, 9);
      return finish(5, [{ w: a, d: d1 }], [], 'right', d2);
    },
    // 6단계: a×d + b = □  (곱셈 + 덧셈 혼합)
    function () {
      var d = ri(2, 3), a = ri(2, 5), b = ri(1, 9);
      return finish(6, [{ w: a, d: d }, { w: b, d: 1 }], [], 'right', 1);
    },
    // 7단계: a×d1 + b = c + □×d2
    function () {
      var d1 = ri(2, 4), d2 = ri(2, 3), a = ri(2, 7), b = ri(1, 9), c = ri(1, 9);
      return maybeMirror(
        finish(7, [{ w: a, d: d1 }, { w: b, d: 1 }], [{ w: c, d: 1 }], 'right', d2),
        0.3);
    },
    // 8단계: a×d1 + b×d2 = □×d3
    function () {
      var d1 = ri(2, 4), d2 = ri(2, 4), d3 = ri(2, 4), a = ri(2, 8), b = ri(2, 8);
      return finish(8, [{ w: a, d: d1 }, { w: b, d: d2 }], [], 'right', d3);
    },
    // 9단계: a×d1 + b×d2 = c×d3 + □×d4
    function () {
      var a = ri(2, 9), b = ri(2, 9), c = ri(2, 9);
      var d1 = ri(2, 4), d2 = ri(1, 4), d3 = ri(2, 4), d4 = ri(2, 4);
      return maybeMirror(
        finish(9, [{ w: a, d: d1 }, { w: b, d: d2 }], [{ w: c, d: d3 }], 'right', d4),
        0.4);
    },
    // 10단계: a×d1 + b×d2 + c = d×d3 + □×d4  (최고 난도)
    function () {
      var a = ri(3, 9), b = ri(2, 9), c = ri(1, 9), d = ri(2, 9);
      var d1 = ri(3, 4), d2 = ri(2, 4), d3 = ri(2, 4), d4 = ri(2, 4);
      return maybeMirror(
        finish(10, [{ w: a, d: d1 }, { w: b, d: d2 }, { w: c, d: 1 }],
               [{ w: d, d: d3 }], 'right', d4),
        0.5);
    }
  ];

  function signature(p) {
    function key(terms) {
      return terms.map(function (t) { return t.w + 'x' + t.d; }).sort().join(',');
    }
    return [key(p.left), key(p.right), p.blankSide, p.blankD, p.answer].join('|');
  }

  function generatePool() {
    var pool = [];   // pool[tier-1] = 문제 10개 배열
    for (var t = 0; t < tierBuilders.length; t++) {
      var list = [], seen = {}, guard = 0;
      while (list.length < PER_TIER && guard++ < 5000) {
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

  window.ProblemPool = {
    MAX_WEIGHT: MAX_WEIGHT,
    MAX_DIST: MAX_DIST,
    generate: generatePool,
    drawGame: drawGame,
    trayNumbers: trayNumbers,
    torque: torque
  };
})();

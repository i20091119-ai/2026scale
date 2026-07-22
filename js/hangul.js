/* ═══════════════════════════════════════════════════════════════
 * hangul.js — 화면 키보드용 한글 조합기
 * 전자칠판에는 실물 키보드가 없을 수 있으므로, 자모 터치 입력을
 * 표준 오토마타로 조합해 닉네임을 만들 수 있게 한다.
 * ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  var JUNG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
  var JONG = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

  var VCOMB = { 'ㅗㅏ':'ㅘ', 'ㅗㅐ':'ㅙ', 'ㅗㅣ':'ㅚ', 'ㅜㅓ':'ㅝ', 'ㅜㅔ':'ㅞ', 'ㅜㅣ':'ㅟ', 'ㅡㅣ':'ㅢ' };
  var VSPLIT = { 'ㅘ':'ㅗ', 'ㅙ':'ㅗ', 'ㅚ':'ㅗ', 'ㅝ':'ㅜ', 'ㅞ':'ㅜ', 'ㅟ':'ㅜ', 'ㅢ':'ㅡ' };
  var JCOMB = { 'ㄱㅅ':'ㄳ', 'ㄴㅈ':'ㄵ', 'ㄴㅎ':'ㄶ', 'ㄹㄱ':'ㄺ', 'ㄹㅁ':'ㄻ', 'ㄹㅂ':'ㄼ',
                'ㄹㅅ':'ㄽ', 'ㄹㅌ':'ㄾ', 'ㄹㅍ':'ㄿ', 'ㄹㅎ':'ㅀ', 'ㅂㅅ':'ㅄ' };
  var JSPLIT = { 'ㄳ':['ㄱ','ㅅ'], 'ㄵ':['ㄴ','ㅈ'], 'ㄶ':['ㄴ','ㅎ'], 'ㄺ':['ㄹ','ㄱ'], 'ㄻ':['ㄹ','ㅁ'],
                 'ㄼ':['ㄹ','ㅂ'], 'ㄽ':['ㄹ','ㅅ'], 'ㄾ':['ㄹ','ㅌ'], 'ㄿ':['ㄹ','ㅍ'], 'ㅀ':['ㄹ','ㅎ'],
                 'ㅄ':['ㅂ','ㅅ'] };

  function create() {
    var out = [];                      // 확정된 글자들
    var cho = -1, jung = -1, jong = 0; // 조합 중인 음절

    function cur() {
      if (cho < 0 && jung < 0) return '';
      if (cho >= 0 && jung < 0) return CHO[cho];
      if (cho < 0 && jung >= 0) return JUNG[jung];
      return String.fromCharCode(0xAC00 + cho * 588 + jung * 28 + jong);
    }

    function commit() {
      var c = cur();
      if (c) out.push(c);
      cho = -1; jung = -1; jong = 0;
    }

    function inputConsonant(ch) {
      var ci = CHO.indexOf(ch);
      if (jung >= 0) {
        if (jong === 0) {
          var ji = JONG.indexOf(ch);
          if (ji > 0) { jong = ji; return; }
        } else {
          var comb = JCOMB[JONG[jong] + ch];
          if (comb) { jong = JONG.indexOf(comb); return; }
        }
        commit(); cho = ci;
      } else {
        if (cho >= 0) commit();
        cho = ci;
      }
    }

    function inputVowel(ch) {
      var vi = JUNG.indexOf(ch);
      if (cho >= 0 && jung < 0) { jung = vi; return; }
      if (jung >= 0 && jong === 0) {
        var comb = VCOMB[JUNG[jung] + ch];
        if (comb) { jung = JUNG.indexOf(comb); return; }
        commit(); jung = vi; return;
      }
      if (jong > 0) {
        // 받침을 다음 음절의 초성으로 넘긴다 (예: '갑' + ㅏ → '가바')
        var jstr = JONG[jong], moved;
        if (JSPLIT[jstr]) { moved = JSPLIT[jstr][1]; jong = JONG.indexOf(JSPLIT[jstr][0]); }
        else { moved = jstr; jong = 0; }
        commit(); cho = CHO.indexOf(moved); jung = vi; return;
      }
      jung = vi;   // 빈 상태에서 모음 단독 입력
    }

    return {
      input: function (ch) {
        if (CHO.indexOf(ch) >= 0 || JONG.indexOf(ch) > 0) inputConsonant(ch);
        else if (JUNG.indexOf(ch) >= 0) inputVowel(ch);
        else { commit(); out.push(ch); }   // 영문·숫자·기호는 그대로
      },
      backspace: function () {
        if (jong > 0) {
          var jstr = JONG[jong];
          jong = JSPLIT[jstr] ? JONG.indexOf(JSPLIT[jstr][0]) : 0;
          return;
        }
        if (jung >= 0) {
          var vstr = JUNG[jung];
          if (VSPLIT[vstr]) jung = JUNG.indexOf(VSPLIT[vstr]);
          else jung = -1;
          return;
        }
        if (cho >= 0) { cho = -1; return; }
        out.pop();
      },
      reset: function () { out = []; cho = -1; jung = -1; jong = 0; },
      text: function () { return out.join('') + cur(); },
      length: function () { return out.length + (cur() ? 1 : 0); }
    };
  }

  window.Hangul = { create: create };
})();

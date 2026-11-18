/* 정기 지출 주기 계산 (앱과 서버가 같이 씀)
 * r: { cycle: '주'|'월'|'년'|'일', every: N, start: 'yyyy-MM-dd', day: (옛 자료: 매월 며칠) }
 */
var Recur = (function () {
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function norm(r) {
    var cycle = ['주', '월', '년', '일'].indexOf(r.cycle) >= 0 ? r.cycle : '월';
    var every = Math.max(1, Math.min(365, Math.round(Number(r.every) || 1)));
    var start = /^\d{4}-\d{2}-\d{2}$/.test(String(r.start || '')) ? String(r.start) : '2026-01-' + pad(Math.min(31, Math.max(1, Number(r.day) || 1)));
    return { cycle: cycle, every: every, start: start };
  }
  function addMonths(a, k) {
    var y = a.getFullYear(), m = a.getMonth() + k, d = a.getDate();
    var last = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(d, last));
  }
  /** from~to(포함) 사이의 날짜 목록 */
  function between(r, from, to) {
    var n = norm(r), a = parse(n.start), f = parse(from), t = parse(to), out = [];
    if (t < a) return out;
    if (n.cycle === '주' || n.cycle === '일') {
      var step = (n.cycle === '주' ? 7 : 1) * n.every;
      var k = Math.max(0, Math.floor((f - a) / 864e5 / step) - 1);
      for (var i = 0; i < 1000; i++, k++) {
        var d = new Date(a.getFullYear(), a.getMonth(), a.getDate() + k * step);
        if (d > t) break;
        if (d >= f) out.push(ymd(d));
      }
    } else {
      var mstep = (n.cycle === '년' ? 12 : 1) * n.every;
      var diff = (f.getFullYear() - a.getFullYear()) * 12 + f.getMonth() - a.getMonth();
      var k2 = Math.max(0, Math.floor(diff / mstep) - 1);
      for (var j = 0; j < 1000; j++, k2++) {
        var d2 = addMonths(a, k2 * mstep);
        if (d2 > t) break;
        if (d2 >= f) out.push(ymd(d2));
      }
    }
    return out;
  }
  /** 오늘(포함) 이후 첫 날짜 */
  function next(r, today) {
    var t = parse(today), lim = new Date(t.getFullYear() + 12, t.getMonth(), t.getDate());
    var l = between(r, today, ymd(lim));
    return l[0] || '';
  }
  var WD = ['일', '월', '화', '수', '목', '금', '토'];
  /** 사람이 읽는 주기 설명 */
  function label(r) {
    var n = norm(r), a = parse(n.start);
    if (n.cycle === '일') return n.every + '일마다';
    if (n.cycle === '주') return (n.every === 1 ? '매주 ' : n.every + '주마다 ') + WD[a.getDay()] + '요일';
    if (n.cycle === '월') return (n.every === 1 ? '매달 ' : n.every + '달마다 ') + a.getDate() + '일';
    return (n.every === 1 ? '매년 ' : n.every + '년마다 ') + (a.getMonth() + 1) + '월 ' + a.getDate() + '일';
  }
  /** 한 달 평균 금액으로 환산 (요약용) */
  function monthly(r, amount) {
    var n = norm(r);
    var perYear = n.cycle === '일' ? 365 / n.every : n.cycle === '주' ? 52.14 / n.every : n.cycle === '월' ? 12 / n.every : 1 / n.every;
    return Math.round(amount * perYear / 12);
  }
  return { between: between, next: next, label: label, monthly: monthly, norm: norm, ymd: ymd };
})();
export default Recur;

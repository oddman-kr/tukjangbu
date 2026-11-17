/**
 * 우리집 가계부 — 서버 코드 (Google Apps Script)
 * 이 파일 전체를 Apps Script 편집기의 Code.gs에 붙여 넣으세요.
 * 데이터는 이 스크립트가 연결된 구글 시트에 저장됩니다.
 */

var TZ = 'Asia/Seoul';
var SH_TX = '거래내역', SH_CAT = '카테고리', SH_REC = '고정지출', SH_CFG = '설정', SH_WISH = '위시리스트';
var WISH_HEAD = ['ID', '이름', '가격', '링크', '분류', '메모', '조건', '목표금액', '상태', '요청자', '요청메시지', '답장', '처리자', '생성시각', '처리시각', '필요한 이유', '필요한 날짜'];
var WISH_STATUS = ['원함', '요청', '승인', '거절', '구매함'];
var TX_HEAD = ['ID', '날짜', '구분', '카테고리', '금액', '내용', '결제수단', '입력자', '메모', '입력시각', '공용/개인'];
var CAT_HEAD = ['구분', '카테고리', '월예산', '키워드(쉼표로 구분)', '순서'];
var REC_HEAD = ['ID', '구분', '카테고리', '내용', '금액', '매월(일)', '결제수단', '사용'];
var CFG_HEAD = ['항목', '값'];

var SEED_CATS = [
  ['지출', '장보기', 600000, '마트,이마트,홈플러스,롯데마트,코스트코,트레이더스,쿠팡,컬리,마켓컬리,시장,식자재,장보기,반찬'],
  ['지출', '외식·배달', 400000, '점심,저녁,아침,식당,외식,배달,배민,배달의민족,요기요,쿠팡이츠,치킨,피자,김밥,국밥,회식,술,맥주,고기,초밥,떡볶이,햄버거,맥도날드'],
  ['지출', '카페·간식', 100000, '카페,커피,스타벅스,스벅,메가커피,빽다방,컴포즈,이디야,투썸,편의점,간식,빵,베이커리,아이스크림,디저트,GS25,CU,세븐일레븐'],
  ['지출', '주거·관리비', 300000, '월세,관리비,전기,가스,수도,전세이자,대출이자,난방'],
  ['지출', '통신', 120000, '통신,통신비,휴대폰,핸드폰,인터넷,요금제,KT,SKT,LGU'],
  ['지출', '교통·차량', 200000, '교통,버스,지하철,택시,카카오T,주유,기름,주차,톨게이트,하이패스,세차,KTX,SRT'],
  ['지출', '생활용품', 80000, '다이소,생활용품,세제,휴지,샴푸,청소,주방용품,이케아'],
  ['지출', '의류·미용', 150000, '옷,의류,신발,미용실,헤어,무신사,화장품,올리브영,네일'],
  ['지출', '의료·건강', 100000, '병원,약국,약,치과,한의원,안과,헬스,필라테스,요가,영양제'],
  ['지출', '문화·여가', 100000, '영화,CGV,메가박스,공연,전시,책,교보,게임,여가,취미,노래방,볼링'],
  ['지출', '구독', 50000, '구독,유튜브,넷플릭스,티빙,웨이브,디즈니,멜론,스포티파이,쿠팡와우,네이버플러스,클라우드'],
  ['지출', '경조사·선물', 100000, '축의금,조의금,부조,경조사,선물,생일,기념일,세뱃돈,명절'],
  ['지출', '육아·교육', 0, '학원,교육,유치원,어린이집,기저귀,분유,장난감,교재,강의'],
  ['지출', '여행', 100000, '여행,숙소,호텔,펜션,에어비앤비,항공,비행기,렌터카'],
  ['지출', '보험', 200000, '보험,실비,실손'],
  ['지출', '기타지출', 50000, ''],
  ['수입', '급여', 0, '월급,급여,월급날'],
  ['수입', '상여', 0, '상여,보너스,성과급,인센티브'],
  ['수입', '부수입', 0, '부수입,부업,중고,당근,알바,프리랜스'],
  ['수입', '기타수입', 0, '환급,용돈,이자,배당,캐시백'],
  ['저축', '비상금', 0, '비상금,파킹'],
  ['저축', '적금·예금', 0, '적금,예금'],
  ['저축', '연금', 0, '연금저축,IRP,연금'],
  ['저축', '투자', 0, 'ISA,주식,ETF,펀드,투자'],
  ['저축', '청약', 0, '청약']
];

function doGet() {
  ensureSetup_();
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('우리집 가계부')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover');
}

/** 외부 앱(휴대폰 웹앱, 아이폰 단축어)용 입구. 본문: {"pin":"…","action":"…","payload":{…}} */
function doPost(e) {
  var body = {};
  try { body = JSON.parse(e && e.postData && e.postData.contents || '{}'); } catch (x) {}
  var res = api(body.pin, body.action, body.payload || body);
  return ContentService.createTextOutput(res).setMimeType(ContentService.MimeType.JSON);
}

/** 앱에서 부르는 단일 진입점. 결과는 JSON 문자열로 돌려줍니다. */
function api(pin, action, payload) {
  try {
    ensureSetup_();
    payload = payload || {};
    var cfg = readCfg_();
    if (action === 'status') return out_({ hasPin: !!cfg.PIN });
    if (action === 'setPin') {
      return withLock_(function () {
        var c = readCfg_();
        if (c.PIN) throw new Error('이미 비밀번호가 정해져 있어요.');
        var p = String(payload.pin || '');
        if (!/^\d{4,8}$/.test(p)) throw new Error('숫자 4~8자리로 정해 주세요.');
        writeCfg_('PIN', p);
        return out_({ ok: true });
      });
    }
    var cache = CacheService.getScriptCache();
    var fails = Number(cache.get('pinFails') || 0);
    if (fails >= 15) return out_({ error: '비밀번호를 여러 번 틀려서 10분 동안 잠겼어요.', message: '비밀번호를 여러 번 틀려서 10분 동안 잠겼어요.' });
    if (!cfg.PIN || String(pin) !== String(cfg.PIN)) {
      cache.put('pinFails', String(fails + 1), 600);
      return out_({ error: 'PIN', message: '가계부 비밀번호가 맞지 않아요.' });
    }

    switch (action) {
      case 'load': return out_(load_(payload));
      case 'add': return withLock_(function () { return out_(addTx_(payload.items || [])); });
      case 'voice': return withLock_(function () { return out_(voice_(payload)); });
      case 'receipt': return out_(receipt_(payload));
      case 'update': return withLock_(function () { return out_(updateTx_(payload.tx)); });
      case 'delete': return withLock_(function () { return out_(deleteTx_(payload.id)); });
      case 'saveCats': return withLock_(function () { return out_(saveCats_(payload.cats || [])); });
      case 'saveCfg': return withLock_(function () { return out_(saveCfg_(payload)); });
      case 'renameMember': return withLock_(function () { return out_(renameMember_(payload)); });
      case 'saveRec': return withLock_(function () { return out_(saveRec_(payload.list || [])); });
      case 'saveWish': return withLock_(function () { return out_(saveWish_(payload.wish)); });
      case 'deleteWish': return withLock_(function () { return out_(deleteWish_(payload.id)); });
      default: return out_({ error: '알 수 없는 요청: ' + action });
    }
  } catch (e) {
    return out_({ error: String(e && e.message || e) });
  }
}

/* ---------------- 내부 함수 ---------------- */

function out_(o) { return JSON.stringify(o); }

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name, head) {
  var ss = ss_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#1F3864').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
  } else if (sh.getLastColumn() < head.length) {
    // 새 열이 생긴 경우 머리글만 채워 넣어요 (기존 데이터는 그대로)
    var have = sh.getLastColumn();
    sh.getRange(1, have + 1, 1, head.length - have).setValues([head.slice(have)]).setFontWeight('bold').setBackground('#1F3864').setFontColor('#FFFFFF');
  }
  return sh;
}

function ensureSetup_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SETUP_V1') === 'done') return;
  withLock_(function () {
    if (props.getProperty('SETUP_V1') === 'done') return;
    var ss = ss_();
    ss.setSpreadsheetTimeZone(TZ);
    var tx = sheet_(SH_TX, TX_HEAD);
    tx.getRange('B:B').setNumberFormat('yyyy-mm-dd');
    tx.getRange('E:E').setNumberFormat('#,##0');
    tx.getRange('A:A').setNumberFormat('@');
    tx.setColumnWidth(6, 200);
    var cat = sheet_(SH_CAT, CAT_HEAD);
    if (cat.getLastRow() < 2) {
      var rows = SEED_CATS.map(function (r, i) { return [r[0], r[1], r[2], r[3], i + 1]; });
      cat.getRange(2, 1, rows.length, 5).setValues(rows);
      cat.getRange('C:C').setNumberFormat('#,##0');
      cat.setColumnWidth(4, 420);
    }
    var rec = sheet_(SH_REC, REC_HEAD);
    rec.getRange('A:A').setNumberFormat('@');
    var cfg = sheet_(SH_CFG, CFG_HEAD);
    if (cfg.getLastRow() < 2) {
      cfg.getRange(2, 1, 3, 2).setValues([
        ['구성원', '남편,아내'],
        ['결제수단', '신용카드,체크카드,현금,계좌이체'],
        ['PIN', '']
      ]);
      cfg.getRange('B:B').setNumberFormat('@');
    }
    var first = ss.getSheetByName('시트1') || ss.getSheetByName('Sheet1');
    if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);
    props.setProperty('SETUP_V1', 'done');
  });
}

function readCfg_() {
  var sh = sheet_(SH_CFG, CFG_HEAD);
  var n = sh.getLastRow();
  var o = {};
  if (n >= 2) sh.getRange(2, 1, n - 1, 2).getValues().forEach(function (r) { if (r[0]) o[String(r[0])] = String(r[1]); });
  return o;
}

function writeCfg_(key, val) {
  var sh = sheet_(SH_CFG, CFG_HEAD);
  var n = sh.getLastRow();
  if (n >= 2) {
    var keys = sh.getRange(2, 1, n - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]) === key) { sh.getRange(i + 2, 2).setNumberFormat('@').setValue(val); return; }
    }
  }
  sh.appendRow([key, val]);
}

function fmtDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v || '').slice(0, 10);
}

function readCats_() {
  var sh = sheet_(SH_CAT, CAT_HEAD);
  var n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, 5).getValues()
    .filter(function (r) { return r[1]; })
    .map(function (r, i) { return { type: String(r[0]), name: String(r[1]), budget: Number(r[2]) || 0, keywords: String(r[3] || ''), order: Number(r[4]) || i + 1 }; })
    .sort(function (a, b) { return a.order - b.order; });
}

function readRec_() {
  var sh = sheet_(SH_REC, REC_HEAD);
  var n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, 8).getValues()
    .filter(function (r) { return r[0]; })
    .map(function (r) {
      return { id: String(r[0]), type: String(r[1]), category: String(r[2]), desc: String(r[3]), amount: Number(r[4]) || 0,
        day: Number(r[5]) || 1, method: String(r[6] || ''), active: r[7] === true || String(r[7]).toUpperCase() === 'TRUE' };
    });
}

function rowToTx_(r) {
  return { id: String(r[0]), date: fmtDate_(r[1]), type: String(r[2]), category: String(r[3]), amount: Number(r[4]) || 0,
    desc: String(r[5] || ''), method: String(r[6] || ''), who: String(r[7] || ''), memo: String(r[8] || ''),
    created: r[9] instanceof Date ? r[9].toISOString() : String(r[9] || ''), scope: String(r[10] || '') === '개인' ? '개인' : '공용' };
}

function txToRow_(t, created) {
  return [String(t.id), t.date, t.type || '지출', t.category || '', Number(t.amount) || 0, t.desc || '', t.method || '', t.who || '', t.memo || '', created || new Date(), t.scope === '개인' ? '개인' : '공용'];
}

function readTx_(sinceStr) {
  var sh = sheet_(SH_TX, TX_HEAD);
  var n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, TX_HEAD.length).getValues()
    .filter(function (r) { return r[0]; })
    .map(rowToTx_)
    .filter(function (t) { return !sinceStr || t.date >= sinceStr; });
}

function load_(p) {
  runRecurring_();
  var cfg = readCfg_();
  var months = Math.min(Number(p.months) || 13, 60);
  var since = new Date();
  since.setMonth(since.getMonth() - months + 1, 1);
  var sinceStr = Utilities.formatDate(since, TZ, 'yyyy-MM-dd');
  return {
    cfg: { members: (cfg['구성원'] || '').split(',').map(trim_).filter(String), methods: (cfg['결제수단'] || '').split(',').map(trim_).filter(String), kids: (cfg['자녀'] || '').split(',').map(trim_).filter(String) },
    wishes: readWish_(),
    cats: readCats_(),
    rec: readRec_(),
    tx: readTx_(sinceStr),
    since: sinceStr,
    serverTime: new Date().toISOString()
  };
}

function trim_(s) { return String(s).trim(); }

function existingIds_() {
  var sh = sheet_(SH_TX, TX_HEAD);
  var n = sh.getLastRow();
  var map = {};
  if (n >= 2) sh.getRange(2, 1, n - 1, 1).getValues().forEach(function (r, i) { map[String(r[0])] = i + 2; });
  return map;
}

function cleanTx_(t) {
  if (!t || !t.id) throw new Error('ID 없음');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(t.date))) throw new Error('날짜 형식 오류');
  var amt = Math.round(Number(t.amount));
  if (!isFinite(amt) || amt === 0) throw new Error('금액 오류');
  return { id: String(t.id).slice(0, 40), date: String(t.date), type: ['지출', '수입', '저축'].indexOf(t.type) >= 0 ? t.type : '지출',
    category: String(t.category || '').slice(0, 30), amount: amt, desc: String(t.desc || '').slice(0, 100),
    method: String(t.method || '').slice(0, 30), who: String(t.who || '').slice(0, 20), memo: String(t.memo || '').slice(0, 200), scope: t.scope === '개인' ? '개인' : '공용' };
}

function addTx_(items) {
  var ids = existingIds_();
  var rows = [], added = [];
  items.forEach(function (raw) {
    var t = cleanTx_(raw);
    if (ids[t.id]) return; // 재전송된 항목은 건너뜀
    ids[t.id] = true;
    rows.push(txToRow_(t));
    added.push(t.id);
  });
  if (rows.length) {
    var sh = sheet_(SH_TX, TX_HEAD);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, TX_HEAD.length).setValues(rows);
  }
  return { ok: true, added: added };
}

function updateTx_(raw) {
  var t = cleanTx_(raw);
  var ids = existingIds_();
  var row = ids[t.id];
  if (!row) throw new Error('이미 삭제된 내역이에요.');
  var sh = sheet_(SH_TX, TX_HEAD);
  var created = sh.getRange(row, 10).getValue();
  sh.getRange(row, 1, 1, TX_HEAD.length).setValues([txToRow_(t, created || new Date())]);
  return { ok: true };
}

function deleteTx_(id) {
  var row = existingIds_()[String(id)];
  if (row) sheet_(SH_TX, TX_HEAD).deleteRow(row);
  return { ok: true };
}

function saveCats_(cats) {
  var sh = sheet_(SH_CAT, CAT_HEAD);
  var rows = cats.filter(function (c) { return c && c.name; }).map(function (c, i) {
    return [['지출', '수입', '저축'].indexOf(c.type) >= 0 ? c.type : '지출', String(c.name).slice(0, 30), Math.max(0, Math.round(Number(c.budget) || 0)), String(c.keywords || '').slice(0, 500), i + 1];
  });
  if (!rows.length) throw new Error('카테고리가 하나는 있어야 해요.');
  var n = sh.getLastRow();
  if (n >= 2) sh.getRange(2, 1, n - 1, 5).clearContent();
  sh.getRange(2, 1, rows.length, 5).setValues(rows);
  return { ok: true };
}

function saveCfg_(p) {
  if (p.members) writeCfg_('구성원', p.members.map(trim_).filter(String).join(','));
  if (p.methods) writeCfg_('결제수단', p.methods.map(trim_).filter(String).join(','));
  if (p.kids) writeCfg_('자녀', p.kids.map(trim_).filter(String).join(','));
  if (p.newPin) {
    if (!/^\d{4,8}$/.test(String(p.newPin))) throw new Error('숫자 4~8자리로 정해 주세요.');
    writeCfg_('PIN', String(p.newPin));
  }
  return { ok: true };
}

/** 구성원 이름 바꾸기: 설정·과거 내역·위시의 이름까지 함께 바꿔요 */
function renameMember_(p) {
  var from = trim_(p.from || ''), to = trim_(p.to || '').slice(0, 20);
  if (!from || !to) throw new Error('이름을 적어 주세요.');
  if (/[,]/.test(to)) throw new Error('이름에 쉼표는 쓸 수 없어요.');
  var cfg = readCfg_();
  var mem = (cfg['구성원'] || '').split(',').map(trim_).filter(String);
  if (mem.indexOf(from) < 0) throw new Error('구성원 목록에 없는 이름이에요.');
  if (from === to) return { ok: true };
  if (mem.indexOf(to) >= 0) throw new Error('이미 같은 이름의 구성원이 있어요.');
  writeCfg_('구성원', mem.map(function (m) { return m === from ? to : m; }).join(','));
  var kd = (cfg['자녀'] || '').split(',').map(trim_).filter(String);
  writeCfg_('자녀', kd.map(function (m) { return m === from ? to : m; }).join(','));
  var fix = function (sh, cols) {
    var n = sh.getLastRow(); if (n < 2) return 0;
    var c = 0;
    cols.forEach(function (col) {
      var rg = sh.getRange(2, col, n - 1, 1), v = rg.getValues(), ch = false;
      v.forEach(function (r) { if (String(r[0]) === from) { r[0] = to; ch = true; c++; } });
      if (ch) rg.setValues(v);
    });
    return c;
  };
  var n = fix(sheet_(SH_TX, TX_HEAD), [8]);
  fix(wishSheet_(), [10, 13]);
  return { ok: true, changed: n };
}

function saveRec_(list) {
  CacheService.getScriptCache().remove('recDone_' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd'));
  var sh = sheet_(SH_REC, REC_HEAD);
  var rows = list.filter(function (r) { return r && r.id && r.amount; }).map(function (r) {
    return [String(r.id), ['지출', '수입', '저축'].indexOf(r.type) >= 0 ? r.type : '지출', String(r.category || ''), String(r.desc || '').slice(0, 100),
      Math.round(Number(r.amount)) || 0, Math.min(31, Math.max(1, Number(r.day) || 1)), String(r.method || ''), r.active !== false];
  });
  var n = sh.getLastRow();
  if (n >= 2) sh.getRange(2, 1, n - 1, 8).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, 8).setValues(rows);
  return { ok: true };
}

/** 고정지출: 이번 달 지정일이 지났고 아직 기록이 없으면 자동으로 한 줄 추가 */
function runRecurring_() {
  var cache = CacheService.getScriptCache();
  var dayKey = 'recDone_' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd');
  if (cache.get(dayKey)) return; // 오늘 이미 확인함 → 시트 읽기 생략(속도)
  var rec = readRec_().filter(function (r) { return r.active && r.amount; });
  cache.put(dayKey, '1', 21600);
  if (!rec.length) return;
  withLock_(function () {
    var now = new Date();
    var ym = Utilities.formatDate(now, TZ, 'yyyyMM');
    var y = Number(ym.slice(0, 4)), m = Number(ym.slice(4));
    var today = Number(Utilities.formatDate(now, TZ, 'd'));
    var lastDay = new Date(y, m, 0).getDate();
    var sh = sheet_(SH_TX, TX_HEAD);
    var n = sh.getLastRow();
    var memos = n >= 2 ? sh.getRange(2, 9, n - 1, 1).getValues().map(function (r) { return String(r[0]); }).join('\n') : '';
    var ids = existingIds_();
    var rows = [];
    rec.forEach(function (r) {
      var d = Math.min(r.day, lastDay);
      if (today < d) return;
      var mark = '[고정#' + r.id + '#' + ym + ']';
      var id = 'rec-' + r.id + '-' + ym;
      if (memos.indexOf(mark) >= 0 || ids[id]) return;
      var date = y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
      rows.push(txToRow_({ id: id, date: date, type: r.type, category: r.category, amount: r.amount, desc: r.desc, method: r.method, who: '자동', memo: mark }));
    });
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, TX_HEAD.length).setValues(rows);
  });
}

/** 말한 문장을 서버에서 바로 나눠 저장 (아이폰 단축어용) */
function voice_(p) {
  var text = String(p.text || '').trim();
  if (!text) return { ok: false, message: '아무 말도 들리지 않았어요.' };
  var cfg = readCfg_();
  var methods = (cfg['결제수단'] || '').split(',').map(trim_).filter(String);
  var tx = readTx_(Utilities.formatDate(new Date(Date.now() - 400 * 864e5), TZ, 'yyyy-MM-dd'));
  var hist = {};
  tx.slice().sort(function (a, b) { return a.created < b.created ? -1 : 1; }).forEach(function (t) {
    var k = (t.desc || '').replace(/\s+/g, ''); if (k && t.who !== '자동') hist[k] = { type: t.type, category: t.category, method: t.method };
  });
  var today = new Date(Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd'));
  var items = Parser.parse(text, { today: today, cats: readCats_(), methods: methods, history: hist });
  if (!items.length) return { ok: false, message: '금액을 못 알아들었어요: "' + text + '"' };
  var who = String(p.who || '단축어').slice(0, 20);
  var now = new Date().toISOString();
  var list = items.map(function (it) {
    return { id: 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), date: it.date, type: it.type, category: it.category,
      amount: it.amount, desc: it.desc, method: it.method, who: who, memo: '', created: now };
  });
  addTx_(list);
  var total = list.reduce(function (s, t) { return s + t.amount; }, 0);
  var first = list[0];
  var msg = (first.desc || first.category) + ' ' + first.amount.toLocaleString('ko-KR') + '원(' + first.category + ')' +
    (list.length > 1 ? ' 외 ' + (list.length - 1) + '건, 합계 ' + total.toLocaleString('ko-KR') + '원' : '') + ' 저장했어요';
  return { ok: true, message: msg, items: list };
}

/** 영수증 사진 → 구글 드라이브 글자 인식(OCR) → 가게·합계·날짜 추출. 저장은 앱에서 확인 후 */
function receipt_(p) {
  var b64 = String(p.image || '').replace(/^data:[^,]+,/, '');
  if (!b64) return { ok: false, message: '사진이 없어요.' };
  if (b64.length > 9000000) return { ok: false, message: '사진이 너무 커요. 다시 찍어 주세요.' };
  var mime = /^image\/(jpeg|png|webp)$/.test(p.mime) ? p.mime : 'image/jpeg';
  var stamp = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd_HHmmss');
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), mime, '영수증_' + stamp + (mime === 'image/png' ? '.png' : '.jpg'));
  var text = ocr_(blob);
  var url = '';
  try { url = receiptFolder_().createFile(blob).getUrl(); } catch (e) { }
  var cfg = readCfg_();
  var methods = (cfg['결제수단'] || '').split(',').map(trim_).filter(String);
  var tx = readTx_(Utilities.formatDate(new Date(Date.now() - 400 * 864e5), TZ, 'yyyy-MM-dd'));
  var hist = {};
  tx.slice().sort(function (a, b) { return a.created < b.created ? -1 : 1; }).forEach(function (t) {
    var k = (t.desc || '').replace(/\s+/g, ''); if (k && t.who !== '자동') hist[k] = { type: t.type, category: t.category, method: t.method };
  });
  var today = new Date(Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd'));
  var r = Receipt.parse(text, { today: today, cats: readCats_(), methods: methods, history: hist });
  var memo = url ? '영수증 ' + url : '영수증';
  if (r.item) r.item.memo = memo;
  return { ok: r.ok, item: r.item || null, store: r.store, date: r.date, memo: memo, text: String(text).slice(0, 2000),
    message: r.ok ? '영수증을 읽었어요' : '합계 금액을 찾지 못했어요. 금액을 직접 넣어 주세요.' };
}

function receiptFolder_() {
  var it = DriveApp.getFoldersByName('가계부 영수증');
  return it.hasNext() ? it.next() : DriveApp.createFolder('가계부 영수증');
}

/** 사진을 구글 문서로 변환해 글자를 읽고, 임시 문서는 바로 지움 */
function ocr_(blob) {
  var token = ScriptApp.getOAuthToken();
  var boundary = 'gagyebu' + Date.now();
  var meta = JSON.stringify({ name: 'ocr-temp-' + Date.now(), mimeType: 'application/vnd.google-apps.document' });
  var head = Utilities.newBlob('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta +
    '\r\n--' + boundary + '\r\nContent-Type: ' + blob.getContentType() + '\r\n\r\n').getBytes();
  var tail = Utilities.newBlob('\r\n--' + boundary + '--').getBytes();
  var res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&ocrLanguage=ko&fields=id', {
    method: 'post', contentType: 'multipart/related; boundary=' + boundary,
    payload: head.concat(blob.getBytes()).concat(tail),
    headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error('사진 글자 인식에 실패했어요: ' + res.getContentText().slice(0, 300));
  var id = JSON.parse(res.getContentText()).id;
  try {
    var ex = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id + '/export?mimeType=text/plain', {
      headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (ex.getResponseCode() >= 300) throw new Error('사진 글자 읽기에 실패했어요.');
    return ex.getContentText('UTF-8').replace(/^\uFEFF/, '');
  } finally {
    UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + id, { method: 'delete', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  }
}

/* ---------- 영수증 해석 ---------- */
/* 영수증 글자(OCR 결과)에서 가게 이름·합계·날짜·결제수단을 뽑는다. Parser.guessCategory 필요 */
var Receipt = (function () {
  var TOTAL_KEYS = [
    /합\s*계\s*금\s*액/, /총\s*합\s*계/, /결\s*제\s*금\s*액/, /받\s*을\s*금\s*액/, /청\s*구\s*금\s*액/,
    /승\s*인\s*금\s*액/, /카\s*드\s*결\s*제/, /신\s*용\s*카\s*드/, /총\s*액/, /총\s*금\s*액/, /판\s*매\s*금\s*액/,
    /합\s*계/, /TOTAL/i, /결\s*제/
  ];
  var SKIP_TOTAL = /(부가세|부가가치세|과세물품|면세물품|공급가액|세액|할인|포인트|적립|거스름|잔액|받은금액|봉사료|VAT)/i;
  var NOT_STORE = /(영수증|사업자|대표|전화|TEL|주소|카드|승인|일시|번호|매출|고객|POS|포스|금액|합계|부가세|과세|면세|수량|단가|품명|상품|교환|환불|감사|www|http|\d{2,}-\d{2,}|\[|\]|^[\d\s.,:\-\/]+$)/i;

  function nums(line) {
    var out = [], m, re = /(\d{1,3}(?:[,.]\d{3})+|\d{3,8})\s*원?/g;
    while ((m = re.exec(line))) {
      var raw = m[1];
      var before = line.slice(Math.max(0, m.index - 1), m.index);
      var after = line.slice(m.index + m[0].length, m.index + m[0].length + 1);
      if (/[-\/:]/.test(before) || /^[-\/:]/.test(after)) continue; // 전화·사업자번호·날짜·시간
      var v = Number(raw.replace(/[,.]/g, ''));
      if (/^\d{3,8}$/.test(raw) && raw.length >= 7) continue; // 쉼표 없는 7자리 이상은 번호일 가능성
      if (v >= 100 && v < 10000000) out.push(v);
    }
    return out;
  }

  function findTotal(lines) {
    for (var k = 0; k < TOTAL_KEYS.length; k++) {
      for (var i = lines.length - 1; i >= 0; i--) {
        var L = lines[i];
        if (!TOTAL_KEYS[k].test(L) || SKIP_TOTAL.test(L)) continue;
        var n = nums(L);
        if (!n.length && i + 1 < lines.length) n = nums(lines[i + 1]);
        if (n.length) return n[n.length - 1];
      }
    }
    var all = [];
    lines.forEach(function (L) { if (!SKIP_TOTAL.test(L) && /,\d{3}|원/.test(L)) all = all.concat(nums(L)); });
    return all.length ? Math.max.apply(null, all) : 0;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function findDate(text, today) {
    var m = text.match(/(20\d{2})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/) ||
            text.match(/(?:^|[^\d])(\d{2})[.\-\/](\d{1,2})[.\-\/](\d{1,2})(?:[^\d]|$)/);
    if (!m) return '';
    var y = Number(m[1]); if (y < 100) y += 2000;
    var mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    var dt = new Date(y, mo - 1, d);
    var lim = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    var old = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
    if (dt > lim || dt < old) return '';
    return y + '-' + pad(mo) + '-' + pad(d);
  }

  function cleanStore(s) {
    return s.replace(/\(\s*주\s*\)|㈜|주식회사|유한회사/g, '').replace(/[\[\]<>*#=_|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
  }

  function findStore(lines) {
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/(?:상\s*호|가\s*맹\s*점\s*명?|매\s*장\s*명?|점\s*포\s*명|업\s*체\s*명)\s*[:：]?\s*(.+)/);
      if (m && /[가-힣A-Za-z]/.test(m[1])) {
        var v = cleanStore(m[1].replace(/(대표|사업자|TEL|전화).*$/i, ''));
        if (v.length >= 2) return v;
      }
    }
    for (var j = 0; j < Math.min(lines.length, 8); j++) {
      var L = lines[j].trim();
      if (L.length < 2 || L.length > 32 || NOT_STORE.test(L) || !/[가-힣A-Za-z]{2,}/.test(L)) continue;
      return cleanStore(L);
    }
    return '';
  }

  function findMethod(text, methods) {
    var pick = function (re) { for (var i = 0; i < methods.length; i++) if (re.test(methods[i])) return methods[i]; return ''; };
    if (/현\s*금\s*(영수증|결제|매출|\s*\d)/.test(text) && !/(카\s*드\s*(결제|승인|번호)|승인\s*번호)/.test(text)) return pick(/현금/);
    if (/체\s*크\s*카\s*드|체\s*크/.test(text)) return pick(/체크/) || pick(/카드/);
    if (/(카\s*드|승\s*인|신\s*용|페\s*이)/.test(text)) return pick(/^(?!.*체크).*카드/) || pick(/카드/);
    return '';
  }

  /** opts: { today, cats, methods, history } → {ok, item?, store, total, date, text} */
  function parse(text, opts) {
    opts = opts || {};
    var today = opts.today || new Date();
    var raw = String(text || '').replace(/\r/g, '');
    var lines = raw.split('\n').map(function (s) { return s.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
    var total = findTotal(lines);
    var store = findStore(lines);
    var date = findDate(raw, today) || Parser.ymd(today);
    var method = findMethod(raw, opts.methods || []);
    var cats = opts.cats || [];
    var g = Parser.guessCategory(store, store, cats, opts.history || {});
    var isEtc = !g.learned && /기타/.test(g.category || '');
    if (isEtc) {
      var g2 = Parser.guessCategory(store, lines.slice(0, 25).join(' ').replace(/(카드|승인|현금|결제|주차권?)/g, ' '), cats, {});
      if (g2.category && g2.type === '지출') g = g2;
    }
    if (g.type !== '지출') { var ex = cats.filter(function (c) { return c.type === '지출'; }); g = { type: '지출', category: (ex.filter(function (c) { return /기타/.test(c.name); })[0] || ex[0] || {}).name || '' }; }
    if (!total) return { ok: false, store: store, date: date, text: raw };
    return { ok: true, store: store, total: total, date: date, text: raw,
      item: { date: date, type: '지출', category: g.category, amount: total, desc: store || '영수증', method: method || (opts.methods || [])[0] || '' } };
  }

  return { parse: parse, findTotal: findTotal, findStore: findStore, findDate: findDate };
})();



/* ---------- 한국어 문장 파서 (앱과 같은 코드) ---------- */
/* 한국어 지출 문장 파서: "어제 점심 김밥천국 8천원, 커피 4500원 카드" → 항목 배열 */
var Parser = (function () {
  var HDIG = { '영': 0, '공': 0, '일': 1, '이': 2, '삼': 3, '사': 4, '오': 5, '육': 6, '칠': 7, '팔': 8, '구': 9 };
  var SMALL = { '십': 10, '백': 100, '천': 1000 };
  var BIG = { '만': 1e4, '억': 1e8 };
  var COUNTERS = '월일시분개명번층호살세잔병권장회박인캔봉벌켤대등위퍼%';

  function koNum(s) {
    s = String(s).replace(/[\s,원]/g, '');
    var total = 0, section = 0, buf = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (/[0-9.]/.test(ch)) buf += ch;
      else if (ch in HDIG) buf += String(HDIG[ch]);
      else if (ch in SMALL) { section += (buf ? parseFloat(buf) : 1) * SMALL[ch]; buf = ''; }
      else if (ch in BIG) { section += buf ? parseFloat(buf) : 0; total += (section || 1) * BIG[ch]; section = 0; buf = ''; }
    }
    section += buf ? parseFloat(buf) : 0;
    return Math.round(total + section);
  }

  var RE_DIGIT = /\d[\d,]*(?:\.\d+)?(?:\s?[십백천만억](?:\s?\d[\d,]*(?:\.\d+)?)?)*(?:\s?원)?/g;
  var RE_HAN = /(^|[^가-힣0-9.,])([일이삼사오육칠팔구십백천만억](?:\s?[일이삼사오육칠팔구십백천만억]|[0-9,])*\s?원)/g;

  function findAmounts(text) {
    var res = [], m;
    function overlaps(st, en) { return res.some(function (r) { return st < r.end && en > r.start; }); }
    RE_HAN.lastIndex = 0;
    while ((m = RE_HAN.exec(text))) {
      var st = m.index + m[1].length, en = st + m[2].length;
      var v2 = koNum(m[2]);
      if (v2 > 0) res.push({ start: st, end: en, value: v2 });
    }
    RE_DIGIT.lastIndex = 0;
    while ((m = RE_DIGIT.exec(text))) {
      var raw = m[0].replace(/\s+$/, '');
      var s0 = m.index, e0 = m.index + raw.length;
      if (overlaps(s0, e0)) continue;
      var next = text.charAt(e0);
      var hasUnit = /[십백천만억원]/.test(raw);
      if (!hasUnit && next && COUNTERS.indexOf(next) >= 0) continue;
      if (!hasUnit && /^\s*(년|월|일)/.test(text.slice(e0))) continue;
      var v = koNum(raw);
      if (!hasUnit && v < 100) continue;
      if (v <= 0) continue;
      res.push({ start: s0, end: e0, value: v });
    }
    return res.sort(function (a, b) { return a.start - b.start; });
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  var WD = { '일': 0, '월': 1, '화': 2, '수': 3, '목': 4, '금': 5, '토': 6 };
  var RE_DATE = /(오늘|어제|그제|그저께|엊그제|(\d{1,2})\s?월\s?(\d{1,2})\s?일|(\d{1,2})\s?일(?![가-힣])|(지난\s?주\s?)?([월화수목금토일])요일)/g;

  function findDates(text, today) {
    var res = [], m;
    RE_DATE.lastIndex = 0;
    while ((m = RE_DATE.exec(text))) {
      var d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      var w = m[1];
      if (w === '오늘') { }
      else if (w === '어제') d.setDate(d.getDate() - 1);
      else if (w === '그제' || w === '그저께' || w === '엊그제') d.setDate(d.getDate() - 2);
      else if (m[2]) {
        d = new Date(today.getFullYear(), Number(m[2]) - 1, Number(m[3]));
        if (d > today) d.setFullYear(d.getFullYear() - 1);
      } else if (m[4]) {
        var day = Number(m[4]);
        if (day < 1 || day > 31) continue;
        d = new Date(today.getFullYear(), today.getMonth(), day);
        if (d > today) d = new Date(today.getFullYear(), today.getMonth() - 1, day);
      } else if (m[6]) {
        if (m[5]) {
          var mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7);
          d = new Date(mon); d.setDate(mon.getDate() + ((WD[m[6]] + 6) % 7));
        } else {
          d.setDate(d.getDate() - ((d.getDay() - WD[m[6]] + 7) % 7));
        }
      }
      res.push({ start: m.index, end: m.index + m[0].length, date: ymd(d) });
    }
    return res;
  }

  var METHOD_WORDS = [
    { re: /체크\s?카드|체크/, key: '체크' },
    { re: /신용\s?카드|카드\s?로|카드\s?결제|카드/, key: '카드' },
    { re: /현금/, key: '현금' },
    { re: /계좌\s?이체|이체|송금|토스로|토스/, key: '이체' },
    { re: /페이|삼성페이|애플페이|카카오페이|네이버페이/, key: '페이' }
  ];

  function matchMethod(seg, methods) {
    for (var i = 0; i < METHOD_WORDS.length; i++) {
      var mm = seg.match(METHOD_WORDS[i].re);
      if (!mm) continue;
      var key = METHOD_WORDS[i].key, found = null;
      methods.forEach(function (x) {
        if (found) return;
        if (key === '체크' && /체크/.test(x)) found = x;
        else if (key === '카드' && /카드/.test(x) && !/체크/.test(x)) found = x;
        else if (key === '현금' && /현금/.test(x)) found = x;
        else if (key === '이체' && /이체|송금|계좌/.test(x)) found = x;
        else if (key === '페이' && /페이/.test(x)) found = x;
      });
      if (!found && key === '페이') methods.forEach(function (x) { if (!found && /카드/.test(x) && !/체크/.test(x)) found = x; });
      if (found) return { method: found, word: mm[0] };
    }
    return null;
  }

  var FILLER = /(썼어요|썼어|썼음|썼다|씀|사용했어요|사용했어|사용|결제했어요|결제했어|결제함|결제|지출했어|지출|구매했어|구매|샀어요|샀어|샀음|냈어요|냈어|냈음|나갔어|들어왔어요|들어왔어|들어옴|받았어요|받았어|받음|입금됐어|입금|그리고|그다음|정도|쯤|약|총|에다가)/g;
  var INCOME_HINT = /(들어왔|들어옴|받았|받음|입금|월급|급여|보너스|상여|환급)/;
  var SAVE_HINT = /(적금|저축|예금|청약|연금저축|IRP|ISA|비상금)/i;

  function cleanDesc(s) {
    s = s.replace(FILLER, ' ');
    s = s.replace(/[,.!?·~]+/g, ' ');
    var toks = s.split(/\s+/).filter(Boolean).map(function (t) {
      if (t.length > 2) t = t.replace(/(에서는|에서|이랑|하고|으로)$/, '');
      if (t.length > 1) t = t.replace(/(에|을|를|랑|은|는)$/, '');
      return t;
    }).filter(function (t) { return t && !/^(원|랑|하고|에|에서|로|으로|은|는|이|가)$/.test(t); });
    return toks.join(' ').trim();
  }

  function guessCategory(desc, seg, cats, history) {
    var key = desc.replace(/\s+/g, '');
    if (key && history && history[key]) {
      var h = history[key];
      if (cats.some(function (c) { return c.name === h.category && c.type === h.type; })) return { type: h.type, category: h.category, learned: true };
    }
    var hay = (seg + ' ' + desc).toLowerCase();
    var best = null, bestLen = 0;
    cats.forEach(function (c) {
      String(c.keywords || '').split(',').forEach(function (k) {
        k = k.trim().toLowerCase();
        if (k && hay.indexOf(k) >= 0 && k.length > bestLen) { best = c; bestLen = k.length; }
      });
      var nm = c.name.toLowerCase();
      if (!best && hay.indexOf(nm) >= 0) { best = c; bestLen = nm.length; }
    });
    if (best) return { type: best.type, category: best.name };
    var type = INCOME_HINT.test(seg) ? '수입' : SAVE_HINT.test(seg) ? '저축' : '지출';
    var fallback = cats.filter(function (c) { return c.type === type; });
    var etc = fallback.filter(function (c) { return /기타/.test(c.name); })[0] || fallback[fallback.length - 1];
    return { type: type, category: etc ? etc.name : '' };
  }

  /**
   * opts: { today: Date, cats: [...], methods: [...], history: {descKey: {type, category, method}}, defaultMethod }
   */
  function parse(text, opts) {
    opts = opts || {};
    var today = opts.today || new Date();
    var cats = opts.cats || [], methods = opts.methods || [];
    text = String(text || '').replace(/ /g, ' ');
    var amts = findAmounts(text);
    if (!amts.length) return [];
    var dates = findDates(text, today);
    var items = [];
    var prevEnd = 0;
    var globalDate = dates.length ? dates[0].date : ymd(today);
    var globalMethod = matchMethod(text, methods);
    for (var i = 0; i < amts.length; i++) {
      var a = amts[i];
      var nextStart = i + 1 < amts.length ? amts[i + 1].start : text.length;
      var before = text.slice(prevEnd, a.start);
      var after = text.slice(a.end, nextStart);
      var useAfter = !cleanDesc(stripDates(before)).replace(/\s/g, '') ;
      var seg = useAfter ? after : before;
      if (!useAfter && i === amts.length - 1) seg = before + ' ' + after; // 마지막 항목 뒤의 "카드로" 같은 말 포함
      var segStart = useAfter ? a.end : prevEnd;
      var segEnd = useAfter ? nextStart : (i === amts.length - 1 ? text.length : a.start);
      var date = null;
      dates.forEach(function (d) { if (!date && d.start >= segStart && d.end <= segEnd) date = d.date; });
      var mm = matchMethod(seg, methods) || globalMethod;
      var descSrc = stripDates(seg);
      if (mm) descSrc = descSrc.replace(mm.word, ' ');
      var desc = cleanDesc(descSrc);
      var g = guessCategory(desc, seg, cats, opts.history);
      var hist = opts.history && opts.history[desc.replace(/\s+/g, '')];
      items.push({
        date: date || globalDate,
        type: g.type,
        category: g.category,
        amount: a.value,
        desc: desc,
        method: mm ? mm.method : (hist && hist.method) || (g.type !== '지출' ? (methods.filter(function (x) { return /이체|계좌/.test(x); })[0] || '') : (opts.defaultMethod || methods[0] || '')),
        learned: !!g.learned
      });
      prevEnd = useAfter ? nextStart : a.end;
    }
    return items;
  }

  function stripDates(s) {
    return s.replace(RE_DATE, ' ');
  }

  return { parse: parse, guessCategory: guessCategory, koNum: koNum, findAmounts: findAmounts, findDates: findDates, ymd: ymd };
})();



/* ---------- 위시리스트 · 자녀 요청 ---------- */
function wishSheet_() {
  var sh = sheet_(SH_WISH, WISH_HEAD);
  return sh;
}

function readWish_() {
  var sh = wishSheet_();
  var n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, WISH_HEAD.length).getValues().filter(function (r) { return r[0]; }).map(function (r) {
    var iso = function (v) { return v instanceof Date ? v.toISOString() : String(v || ''); };
    return { id: String(r[0]), name: String(r[1]), price: Number(r[2]) || 0, link: String(r[3] || ''), kind: String(r[4] || ''), memo: String(r[5] || ''),
      cond: String(r[6] || '없음'), target: Number(r[7]) || 0, status: String(r[8] || '원함'), by: String(r[9] || ''), msg: String(r[10] || ''),
      reply: String(r[11] || ''), handledBy: String(r[12] || ''), created: iso(r[13]), handled: iso(r[14]),
      reason: String(r[15] || ''), needBy: r[16] instanceof Date ? fmtDate_(r[16]) : String(r[16] || '') };
  });
}

function saveWish_(w) {
  if (!w || !w.id || !String(w.name || '').trim()) throw new Error('물건 이름을 적어 주세요.');
  var link = String(w.link || '').trim();
  if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
  var row = [String(w.id).slice(0, 40), String(w.name).trim().slice(0, 80), Math.max(0, Math.round(Number(w.price) || 0)), link.slice(0, 500),
    String(w.kind || '').slice(0, 20), String(w.memo || '').slice(0, 300), ['없음', '저축', '부수입', '남은예산'].indexOf(w.cond) >= 0 ? w.cond : '없음',
    Math.max(0, Math.round(Number(w.target) || 0)), WISH_STATUS.indexOf(w.status) >= 0 ? w.status : '원함', String(w.by || '').slice(0, 20),
    String(w.msg || '').slice(0, 300), String(w.reply || '').slice(0, 300), String(w.handledBy || '').slice(0, 20),
    w.created ? new Date(w.created) : new Date(), w.handled ? new Date(w.handled) : '',
    String(w.reason || '').slice(0, 300), /^\d{4}-\d{2}-\d{2}$/.test(String(w.needBy || '')) ? String(w.needBy) : ''];
  var sh = wishSheet_();
  var n = sh.getLastRow();
  if (n >= 2) {
    var ids = sh.getRange(2, 1, n - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === row[0]) { sh.getRange(i + 2, 1, 1, WISH_HEAD.length).setValues([row]); return { ok: true }; }
    }
  }
  sh.getRange(sh.getLastRow() + 1, 1, 1, WISH_HEAD.length).setValues([row]);
  sh.getRange('C:C').setNumberFormat('#,##0'); sh.getRange('H:H').setNumberFormat('#,##0'); sh.getRange('A:A').setNumberFormat('@'); sh.getRange('Q:Q').setNumberFormat('@');
  return { ok: true };
}

function deleteWish_(id) {
  var sh = wishSheet_();
  var n = sh.getLastRow();
  if (n < 2) return { ok: true };
  var ids = sh.getRange(2, 1, n - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) { sh.deleteRow(i + 2); break; }
  return { ok: true };
}

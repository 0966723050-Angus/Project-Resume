/**
 * ATK專案履歷 — 分享連結免登入檢視(Google Apps Script 網頁應用程式)
 *
 * 部署:script.google.com 新增專案 → 貼上本檔 → 部署 → 新增部署作業 → 類型「網頁應用程式」
 *       執行身分:我(管理者)  /  誰可以存取:所有人  → 複製網址貼到 js/config.js 的 SHARE_URL
 *       更新程式後:部署 → 管理部署作業 → 編輯 → 版本選「新版本」→ 部署(網址不變)
 *       加速:在編輯器選函式 installWarmTrigger → 執行一次(建立每 10 分鐘預熱排程)
 *       備份:在編輯器選函式 installDailyBackup → 執行一次(建立每日 02:00 備份排程並立即備份)
 *       專案現況:在編輯器選函式 installPmReport → 執行一次(每天 08:30 寄未結案專案的現況、Open 追蹤事項與未結案殘件;pmReport 立即寄一封)
 *       工時:在編輯器選函式 installHoursNotice → 執行一次(每月第一個上班日 09:00 由釘釘機器人傳未提報提醒;testHoursNotice 只寄預覽 E-Mail 給管理者)
 *       日曆:在編輯器選函式 syncCalendar → 執行一次(授權日曆),再部署新版本;之後近期工作項目每次存檔自動同步
 * 安全:只回傳「履歷編號 + 分享碼」都相符的那一份履歷;圖片/附件也只限該履歷中有列出的檔案。
 *
 *   ?id=<履歷編號>&k=<分享碼>                → { ok, resume }
 *   ?a=file&id=<履歷編號>&k=<分享碼>&f=<檔案ID> → { ok, name, mime, data(base64) }
 *   ?a=ding&id=<履歷編號>&k=<分享碼>          → 由釘釘群組機器人發送「標題=連結」訊息 → { ok }
 *   ?a=cal                                    → 依 Work List.xlsm 同步「已排定」項目到 Google 日曆 → { ok, created, updated, removed }
 */
var FILE_ID = '1dC9czmVBo1rFfRU_kWU3IPHOm0OU-pkR';                       // 可填 Project Resume.xlsx 的檔案 ID(App 設定頁可複製);空白則依檔名搜尋
var FILE_NAME = 'Project Resume.xlsx';
var SHEET = 'Project Resume';
var COLS = {
  code: '專案代號', name: '專案名稱', plant: '作業廠區', line: '線別', equip: '設備名稱', unit: '單元', stage: '專案階段',
  start: '作業開始時間', end: '作業結束時間', hours: '報工時數', members: '協同作業人員', work: '工作內容',
  problem: '問題描述', images: '圖片', files: '附件', cause: '發生原因', temp: '暫定對策', perm: '永久對策',
  result: '處理結果', note: '備註', id: '履歷編號', remain: '轉殘件', author: '填表人', shareKey: '分享碼',
};
var HEAD = ['code', 'name', 'plant', 'line', 'equip', 'unit', 'stage', 'start', 'end', 'hours', 'members', 'work', 'author'];
var PROB = ['problem', 'images', 'files', 'cause', 'temp', 'perm', 'result', 'note', 'remain'];
var MAX_FILE = 20 * 1024 * 1024;

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.a === 'cal') return json(syncCalendar());
    var r = findResume(String(p.id || ''), String(p.k || ''));
    if (p.a === 'file') return json(fileOut(r, String(p.f || '')));
    if (p.a === 'ding') return json(dingSend(r, String(p.k || '')));
    return json({ ok: true, resume: r });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}

// POST(電腦上的 erp-sync.ps1 用;金鑰放在內容裡,不放在網址)
function doPost(e) {
  try {
    var b = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (b.a === 'erp') return json(erpOut(String(b.key || ''), String(b.since || '')));
    if (b.a === 'tok') return json(tokenBroker(b));
    return json({ ok: false, error: '不支援的動作' });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}

// ---------- 長效登入:網頁取得的 Google 授權碼 / 長效憑證(refresh token)→ 換發存取權杖 ----------
// 用戶端密鑰存在「指令碼屬性」GOOGLE_CLIENT_SECRET(不放在程式碼);用戶端 ID 與網頁 js/config.js 相同
var OAUTH_CLIENT_ID = '873968217418-q5t3i90e4pf04kbd4l6vbpjib13etb7o.apps.googleusercontent.com';
function tokenBroker(b) {
  var secret = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_SECRET');
  if (!secret) return { ok: false, error: '尚未設定 GOOGLE_CLIENT_SECRET' };
  var p = { client_id: OAUTH_CLIENT_ID, client_secret: secret };
  if (b.code) {
    var redirect = String(b.redirect || 'postmessage');
    if (redirect !== 'postmessage' && redirect.indexOf(APP_URL) !== 0) return { ok: false, error: 'redirect_uri 不符' };
    p.code = String(b.code); p.grant_type = 'authorization_code'; p.redirect_uri = redirect;
  } else if (b.rt) {
    p.refresh_token = String(b.rt); p.grant_type = 'refresh_token';
  } else return { ok: false, error: '缺少參數' };
  var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', { method: 'post', payload: p, muteHttpExceptions: true });
  var j = {};
  try { j = JSON.parse(r.getContentText() || '{}'); } catch (e) {}
  if (r.getResponseCode() !== 200) return { ok: false, error: j.error || ('HTTP ' + r.getResponseCode()), detail: j.error_description || '' };
  return { ok: true, access_token: j.access_token, expires_in: j.expires_in, refresh_token: j.refresh_token || '' };
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// 檔案:先用設定的 FILE_ID,其次用上次找到並記住的 ID,最後才依檔名搜尋(搜尋較慢)
function getFile() {
  if (FILE_ID) return DriveApp.getFileById(FILE_ID);
  var props = PropertiesService.getScriptProperties();
  var saved = props.getProperty('FILE_ID');
  if (saved) { try { var f0 = DriveApp.getFileById(saved); if (!f0.isTrashed()) return f0; } catch (err) { /* 找不到就重新搜尋 */ } }
  var it = DriveApp.searchFiles('title = "' + FILE_NAME + '" and trashed = false');
  if (!it.hasNext()) throw new Error('找不到 ' + FILE_NAME);
  var f = it.next();
  props.setProperty('FILE_ID', f.getId());
  return f;
}

// 依履歷編號讀取資料列。整份檔案解析一次後,每份履歷各自存入快取(6 小時,檔案更新後自動換新),
// 之後開連結只要讀一筆快取,不必再解壓/解析 Excel
var CACHE_SEC = 21600;
function loadRowsById(id) {
  var f = getFile();
  var ver = f.getId() + '_' + f.getLastUpdated().getTime();
  var cache = CacheService.getScriptCache();
  var hit = cache.get('r_' + ver + '_' + id);
  if (hit) return JSON.parse(hit);
  // 這個版本已解析過且沒有此編號:可能是剛存檔、雲端硬碟的「更新時間」還沒跟上(仍是舊版本號)
  // → 重新解析一次最新內容(15 秒內最多一次,避免被亂打的編號拖慢)
  if (cache.get('v_' + ver)) {
    if (cache.get('reparse')) return [];
    cache.put('reparse', '1', 15);
  }
  var byId = buildCache(f, ver);
  return byId[id] || [];
}
function buildCache(f, ver) {
  var parts = {};
  Utilities.unzip(f.getBlob().setContentType('application/zip')).forEach(function (b) { parts[b.getName()] = b; });
  var text = function (name) { return parts[name] ? parts[name].getDataAsString('UTF-8') : null; };
  var rows = parseSheet(text('xl/workbook.xml'), text('xl/_rels/workbook.xml.rels'), text('xl/sharedStrings.xml'), text, SHEET);
  var byId = {};
  rows.forEach(function (r) { if (r.id) (byId[r.id] = byId[r.id] || []).push(r); });
  var cache = CacheService.getScriptCache();
  var batch = {}, n = 0;
  Object.keys(byId).forEach(function (id) {
    batch['r_' + ver + '_' + id] = JSON.stringify(byId[id]);
    if (++n % 200 === 0) { try { cache.putAll(batch, CACHE_SEC); } catch (err) {} batch = {}; }
  });
  try { cache.putAll(batch, CACHE_SEC); cache.put('v_' + ver, '1', CACHE_SEC); } catch (err) { /* 快取失敗不影響結果 */ }
  return byId;
}

// 定時預熱(每 10 分鐘):先把最新版本解析進快取,開連結時就不用等解析
function warm() {
  var f = getFile();
  var ver = f.getId() + '_' + f.getLastUpdated().getTime();
  if (!CacheService.getScriptCache().get('v_' + ver)) buildCache(f, ver);
}
// 第一次部署後在編輯器手動執行一次:建立預熱排程
function installWarmTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'warm') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('warm').timeBased().everyMinutes(10).create();
  warm();
}

function findResume(id, key) {
  if (!id || !key) throw new Error('連結不完整');
  var rows = loadRowsById(id);
  if (!rows.length) throw new Error('找不到此專案履歷');
  var sk = '';
  rows.forEach(function (r) { if (!sk && r.shareKey) sk = r.shareKey; });
  if (!sk || sk !== key) throw new Error('連結無效或已變更');
  var res = { id: id, problems: [] };
  HEAD.forEach(function (k) { res[k] = ''; });
  rows.forEach(function (r) {
    HEAD.forEach(function (k) { if (res[k] === '' && r[k] !== '' && r[k] != null) res[k] = r[k]; });
    var p = {};
    PROB.forEach(function (k) { p[k] = r[k] || ''; });
    res.problems.push(p);
  });
  return res;
}

function fileOut(res, fid) {
  if (!/^[\w-]+$/.test(fid)) throw new Error('檔案代碼錯誤');
  var listed = res.problems.some(function (p) { return (p.images + '\n' + p.files).indexOf('/d/' + fid) >= 0; });
  if (!listed) throw new Error('此檔案不屬於這份履歷');
  var file = DriveApp.getFileById(fid);
  if (file.getSize() > MAX_FILE) throw new Error('檔案太大,請登入後從雲端硬碟開啟');
  var blob = file.getBlob();
  return { ok: true, name: file.getName(), mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

// ---------- xlsx XML 解析(純字串處理,不依賴 GAS API,便於測試) ----------
function decodeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, function (m, g) {
    if (g[0] === '#') return String.fromCharCode(g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[g.toLowerCase()];
  });
}
function attr(tag, name) {
  var m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag);
  return m ? decodeXml(m[1]) : null;
}
// <si>/<is> 內的文字(略過注音 <rPh>)
function richText(xml) {
  xml = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  var out = '', re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g, m;
  while ((m = re.exec(xml))) out += decodeXml(m[1] || '');
  return out;
}
function colIdx(ref) {
  var letters = /^[A-Z]+/.exec(ref)[0], n = 0;
  for (var i = 0; i < letters.length; i++) n = n * 26 + letters.charCodeAt(i) - 64;
  return n;
}
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function serialToDT(v) {
  var d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(v) * 1440) * 60000);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) + 'T' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
}

function parseSheet(wbXml, relsXml, sstXml, text, sheetName) {
  var grid = parseGrid(wbXml, relsXml, sstXml, text, sheetName);
  var header = grid.filter(function (g) { return g.r === 1; })[0];
  if (!header) return [];
  var idxOf = {};
  Object.keys(header.cells).forEach(function (ci) { idxOf[String(header.cells[ci].val).trim()] = Number(ci); });
  var out = [];
  grid.forEach(function (g) {
    if (g.r < 2) return;
    var rec = {}, any = false;
    Object.keys(COLS).forEach(function (k) {
      var c = g.cells[idxOf[COLS[k]]];
      if (!c || c.val === '') { rec[k] = ''; return; }
      var v = c.val;
      if ((k === 'start' || k === 'end') && c.num && v !== '' && !isNaN(Number(v))) v = serialToDT(v);
      rec[k] = String(v);
      any = true;
    });
    if (any) out.push(rec);
  });
  return out;
}

// 工作表 → [{ r: 列號, cells: { 欄號: { val, num } } }]
function parseGrid(wbXml, relsXml, sstXml, text, sheetName) {
  var rels = {}, m, re = /<Relationship\b[^>]*>/g;
  while ((m = re.exec(relsXml))) rels[attr(m[0], 'Id')] = attr(m[0], 'Target');
  var path = null;
  re = /<sheet\b[^>]*>/g;
  while ((m = re.exec(wbXml))) if (attr(m[0], 'name') === sheetName) path = rels[attr(m[0], 'r:id')];
  if (!path) throw new Error('找不到工作表 ' + sheetName);
  path = path.charAt(0) === '/' ? path.slice(1) : 'xl/' + path;
  var sst = [];
  if (sstXml) { re = /<si>([\s\S]*?)<\/si>/g; while ((m = re.exec(sstXml))) sst.push(richText(m[1])); }
  var xml = text(path);
  var grid = [];
  var rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g, rm;
  while ((rm = rowRe.exec(xml))) {
    var rnum = Number(attr(rm[0], 'r'));
    var cells = {};
    var cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, cm;
    while ((cm = cRe.exec(rm[2]))) {
      var tag = '<c' + cm[1] + '>';
      var ref = attr(tag, 'r'), t = attr(tag, 't');
      var inner = cm[2] || '', val = '';
      if (t === 'inlineStr') { var is = /<is>([\s\S]*?)<\/is>/.exec(inner); val = is ? richText(is[1]) : ''; }
      else {
        var v = /<v>([\s\S]*?)<\/v>/.exec(inner);
        if (v) val = t === 's' ? (sst[Number(v[1])] || '') : decodeXml(v[1]);
      }
      if (ref) cells[colIdx(ref)] = { val: val, num: !t || t === 'n' };
    }
    grid.push({ r: rnum, cells: cells });
  }
  return grid;
}

// ---------- 每日逾期通知(08:30 寄信給管理者;手機 Gmail App 會跳出通知) ----------
// 啟用:在編輯器選函式 installDailyNotify → 執行一次(第一次會要求授權寄信)。測試:執行 testNotify(不論有無逾期都寄一封)
// 內容:追蹤/殘件事項 — 狀態不是 Close 且「改善期限」已過;專案管理 — 未結案專案中,狀態不是 Close 且「期限」已過的追蹤事項
var NOTIFY_TO = '';  // 收件者;空白 = 執行者(管理者)本人
var APP_URL = 'https://0966723050-angus.github.io/Project-Resume/';
var PM_FILE_NAMES = ['Project Management.xlsx', 'Project Managment.xlsx'];
var REMAIN_SHEET = 'Remain Item';
var PM_SHEET = 'project list';
var TZ = 'Asia/Taipei';

function installDailyNotify() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['dailyNotifyPlan', 'dailyOverdue'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  // 每天 7 點多先排好當天 08:30 的單次排程(每日排程只能指定到「幾點」,單次排程才能準時到分鐘)
  ScriptApp.newTrigger('dailyNotifyPlan').timeBased().everyDays(1).atHour(7).inTimezone(TZ).create();
  dailyNotifyPlan();
}
function dailyNotifyPlan() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dailyOverdue') ScriptApp.deleteTrigger(t); });
  var at = new Date(Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'08:30:00") + '+08:00');
  if (at.getTime() > Date.now()) ScriptApp.newTrigger('dailyOverdue').timeBased().at(at).create();
}
function dailyOverdue() { sendOverdue(false); }
function testNotify() { sendOverdue(true); }

function sendOverdue(always) {
  var today = todaySerial();
  var remainGrid = readGrid(getFile(), REMAIN_SHEET);
  var pmFile = findByNames(PM_FILE_NAMES, 'PM_FILE_ID');
  var pmGrid = pmFile ? readGrid(pmFile, PM_SHEET) : null;
  var r = overdueFrom(remainGrid, pmGrid, today);
  var n = r.remain.length + r.pm.length;
  if (!n && !always) return;
  var md = Utilities.formatDate(new Date(), TZ, 'M/d');
  var subject = '【逾期提醒 ' + md + '】追蹤/殘件 ' + r.remain.length + ' 項、專案管理追蹤 ' + r.pm.length + ' 項';
  MailApp.sendEmail({
    to: NOTIFY_TO || Session.getEffectiveUser().getEmail(),
    subject: subject,
    body: overdueText(r) + (pmFile ? '' : '\n(找不到 Project Management.xlsx)') + '\n\n' + APP_URL,
    htmlBody: overdueHtml(r) + (pmFile ? '' : '<p>(找不到 Project Management.xlsx)</p>'),
    name: 'ATK專案履歷',
  });
}

// ── 每月工時未提報通知 ──
// 啟用:在編輯器選函式 installHoursNotice → 執行一次。測試:執行 testHoursNotice(訊息只寄 E-Mail 給管理者預覽,不傳到釘釘)
// 每月第一個上班日 09:00 檢查「上個月」每位公司人員(有 E-Mail、權限表未勾「免提報工時」)的未提報上班日,
// 由專案履歷的釘釘機器人(DINGTALK_WEBHOOK)傳一則訊息到群組,列出未提報同仁與日期(請於 2 天內補齊);
// 訊息只列姓名(不 @);同一個月只傳一次
// 上班日依行政院人事行政總處行事曆(TaiwanCalendar,國定假日不算、補班算;抓不到時只排除週六日),
// 另排除「公司假日」工作表(颱風假等)與各人「請假」工作表登記的日子
var HOURS_SHEET = '工時', STAFF_SHEET = '公司人員', PERM_SHEET = '權限', LEAVE_SHEET = '請假', OFF_SHEET = '公司假日';
var HOURS_DEADLINE_DAYS = 2;
var TW_CAL_URL = 'https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/';

function installHoursNotice() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['hoursNoticePlan', 'hoursNotice'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  // 每天 7 點多檢查今天是不是本月第一個上班日,是的話排好 09:00 的單次排程
  ScriptApp.newTrigger('hoursNoticePlan').timeBased().everyDays(1).atHour(7).inTimezone(TZ).create();
  hoursNoticePlan();
}
function hoursNoticePlan() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'hoursNotice') ScriptApp.deleteTrigger(t); });
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  if (PropertiesService.getScriptProperties().getProperty('HOURS_NOTICE_SENT') === prevMonthOf(today)) return;
  var days = workdaysOf(today.slice(0, 7), twHolidays(+today.slice(0, 4)), offDaysOf(getFile()));
  if (days[0] !== today) return;
  var at = new Date(today + 'T09:00:00+08:00');
  if (at.getTime() > Date.now()) ScriptApp.newTrigger('hoursNotice').timeBased().at(at).create();
  else hoursNotice(); // 已過 09:00(例如當天才安裝)就直接檢查
}
function hoursNotice() { sendHoursNotice(false); }
function testHoursNotice() { sendHoursNotice(true); }

function sendHoursNotice(test) {
  var props = PropertiesService.getScriptProperties();
  var today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var mon = prevMonthOf(today);
  if (!test && props.getProperty('HOURS_NOTICE_SENT') === mon) return;
  var hol = twHolidays(+mon.slice(0, 4));
  var file = getFile();
  var permGrid = null;
  try { permGrid = readGrid(file, PERM_SHEET); } catch (err) { /* 還沒有權限表 */ }
  var leaveGrid = null;
  try { leaveGrid = readGrid(file, LEAVE_SHEET); } catch (err) { /* 還沒有人登記請假 */ }
  var list = missingByPerson(readGrid(file, HOURS_SHEET), readGrid(file, STAFF_SHEET), permGrid, workdaysOf(mon, hol, offDaysOf(file)), leaveGrid);
  var deadline = Utilities.formatDate(new Date(Date.now() + HOURS_DEADLINE_DAYS * 86400000), TZ, 'M/d');
  var msg = hoursNoticeMarkdown(mon, list, deadline, APP_URL + '#/hours') + (hol ? '' : '\n\n(行事曆無法取得,只排除週六日)');
  if (test) {
    MailApp.sendEmail({
      to: NOTIFY_TO || Session.getEffectiveUser().getEmail(),
      subject: '[測試,未傳到釘釘] 【工時提報提醒】' + mon.replace('-', '/') + ' 共 ' + list.length + ' 人未完成',
      body: msg,
      name: 'ATK專案履歷',
    });
    return;
  }
  if (list.length) dingPost('工時提報提醒', msg);
  props.setProperty('HOURS_NOTICE_SENT', mon);
}
// 行政院人事行政總處行事曆的假日(yyyy-mm-dd);抓不到回傳 null(改用週六日)
function twHolidays(year) {
  try {
    var resp = UrlFetchApp.fetch(TW_CAL_URL + year + '.json', { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    return holidaySet(JSON.parse(resp.getContentText()));
  } catch (err) { return null; }
}

// ---- 以下為純資料處理(不呼叫 GAS API,可在瀏覽器測試) ----
// 釘釘訊息(markdown):未提報同仁姓名、天數與日期
function hoursNoticeMarkdown(mon, list, deadline, url) {
  var md = function (d) { return +d.slice(5, 7) + '/' + +d.slice(8); };
  var lines = list.map(function (p) { return '- ' + p.name + ':' + p.miss.length + ' 天(' + p.miss.map(md).join('、') + ')'; });
  return '### 【工時提報提醒】' + mon.replace('-', '/') + '\n\n以下同仁尚有工時未提報,請於 **' + HOURS_DEADLINE_DAYS + ' 天內(' + deadline + ' 前)**完成:\n\n' +
    lines.join('\n') + '\n\n若當天請假,請在工時統計頁的方框打勾。[前往工時統計](' + url + ')';
}
function holidaySet(list) {
  var set = {};
  list.forEach(function (d) { if (d.isHoliday) set[d.date.slice(0, 4) + '-' + d.date.slice(4, 6) + '-' + d.date.slice(6, 8)] = true; });
  return set;
}
function prevMonthOf(ymd) {
  var y = +ymd.slice(0, 4), m = +ymd.slice(5, 7) - 1;
  if (!m) { y--; m = 12; }
  return y + '-' + pad2(m);
}
// off:公司假日(颱風假等){ 'yyyy-mm-dd': true }
function workdaysOf(mon, hol, off) {
  var y = +mon.slice(0, 4), m = +mon.slice(5, 7), out = [];
  for (var d = new Date(Date.UTC(y, m - 1, 1)); d.getUTCMonth() === m - 1; d = new Date(d.getTime() + 86400000)) {
    var s = d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
    if ((hol ? !hol[s] : d.getUTCDay() % 6 !== 0) && !(off && off[s])) out.push(s);
  }
  return out;
}
function offDaysFrom(grid) {
  var set = {};
  if (!grid) return set;
  var t = tableOf(grid);
  t.rows.forEach(function (row) { var n = cellSerial(row, t.col['日期']); if (n != null) set[serialYMD(n).replace(/\//g, '-')] = true; });
  return set;
}
function isYes(v) { return /^(✔|☑|✅|v|y|是|true|1)/i.test(String(v || '').trim()); }
// 每位公司人員(有 E-Mail、未勾免提報工時)在 days 中沒有任何工時紀錄的日子;每筆紀錄從開始日到結束日都算有提報,
// 「請假」工作表登記的日子也不算未提報
function missingByPerson(hoursGrid, staffGrid, permGrid, days, leaveGrid) {
  var exempt = {};
  if (permGrid) {
    var pt = tableOf(permGrid);
    pt.rows.forEach(function (row) { if (isYes(cellText(row, pt.col['免提報工時']))) exempt[cellText(row, pt.col['人員']).toLowerCase()] = true; });
  }
  var ht = tableOf(hoursGrid), hc = ht.col;
  var done = {}; // key(email 或 name:姓名) → { 'yyyy-mm-dd': true }
  ht.rows.forEach(function (row) {
    var a = cellSerial(row, hc['開始時間']);
    if (a == null) return;
    var b = cellSerial(row, hc['結束時間']);
    if (b == null || b < a || b - a > 62) b = a;
    var email = cellText(row, hc['E-Mail']).toLowerCase(), name = cellText(row, hc['姓名']);
    [email, 'name:' + name].forEach(function (k) {
      if (!k || k === 'name:') return;
      var set = done[k] || (done[k] = {});
      for (var n = a; n <= b; n++) set[serialYMD(n).replace(/\//g, '-')] = true;
    });
  });
  if (leaveGrid) {
    var lt = tableOf(leaveGrid);
    lt.rows.forEach(function (row) {
      var n = cellSerial(row, lt.col['日期']);
      if (n == null) return;
      var email = cellText(row, lt.col['E-Mail']).toLowerCase(), name = cellText(row, lt.col['姓名']);
      var k = email || 'name:' + name;
      (done[k] || (done[k] = {}))[serialYMD(n).replace(/\//g, '-')] = true;
    });
  }
  var st = tableOf(staffGrid), sc = st.col, out = [];
  st.rows.forEach(function (row) {
    var email = cellText(row, sc['E-Mail']).toLowerCase(), name = cellText(row, sc['姓名']);
    if (!email || exempt[email]) return;
    var a = done[email] || {}, b = done['name:' + name] || {};
    var miss = days.filter(function (d) { return !a[d] && !b[d]; });
    if (miss.length) out.push({ name: name, email: email, miss: miss });
  });
  return out;
}

// ── 每日 02:00 自動備份 ──
// 備份到 Project Resume.xlsx 所在資料夾下的「專案履歷備份/yyyy-MM-dd」,只保留最新 BACKUP_KEEP 份(較舊的移到垃圾桶)
var BACKUP_FOLDER = '專案履歷備份';
var BACKUP_KEEP = 5;
var WORK_FILE_ID = '1bss9sYHoav894eaCxA9u68CcfHNuYUNZ'; // Work List.xlsm(同 js/config.js 的 WORK.FILE_ID)
var SCHED_FILE = 'Project Schedule.json';               // 與 Project Management.xlsx 同資料夾

// 在編輯器執行一次:建立每日 02:00 備份排程,並立即備份一次
function installDailyBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['dailyBackupPlan', 'dailyBackup'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  // 同每日通知:每天 1 點多先排好當天 02:00 的單次排程(準時到分鐘)
  ScriptApp.newTrigger('dailyBackupPlan').timeBased().everyDays(1).atHour(1).inTimezone(TZ).create();
  dailyBackupPlan();
  dailyBackup();
}
function dailyBackupPlan() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dailyBackup') ScriptApp.deleteTrigger(t); });
  var at = new Date(Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'02:00:00") + '+08:00');
  if (at.getTime() > Date.now()) ScriptApp.newTrigger('dailyBackup').timeBased().at(at).create();
}
function dailyBackup() {
  var resume = getFile();
  var pmFile = findByNames(PM_FILE_NAMES, 'PM_FILE_ID');
  var files = [resume, pmFile];
  try { files.push(DriveApp.getFileById(WORK_FILE_ID)); } catch (err) { Logger.log('找不到 Work List.xlsm:' + err); }
  if (pmFile) {
    var pmDirs = pmFile.getParents();
    if (pmDirs.hasNext()) { var sf = pmDirs.next().getFilesByName(SCHED_FILE); if (sf.hasNext()) files.push(sf.next()); }
  }
  var dirs = resume.getParents();
  var base = dirs.hasNext() ? dirs.next() : DriveApp.getRootFolder();
  var root = subFolder(base, BACKUP_FOLDER);
  var day = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var dest = subFolder(root, day);
  var done = [];
  files.forEach(function (f) {
    if (!f || f.isTrashed()) return;
    var old = dest.getFilesByName(f.getName()); // 同一天重跑:先移除舊的
    while (old.hasNext()) old.next().setTrashed(true);
    f.makeCopy(f.getName(), dest);
    done.push(f.getName());
  });
  // 日期資料夾由新到舊排序,第 BACKUP_KEEP 份之後的移到垃圾桶(中間漏備份的日子不影響份數)
  var days = [];
  var it = root.getFolders();
  while (it.hasNext()) { var d = it.next(); if (/^\d{4}-\d{2}-\d{2}$/.test(d.getName())) days.push(d); }
  days.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });
  days.slice(BACKUP_KEEP).forEach(function (d) { d.setTrashed(true); });
  Logger.log('已備份到 ' + BACKUP_FOLDER + '/' + day + ':' + done.join('、'));
}
function subFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

// 依檔名找檔案(記住 ID,下次免搜尋)
function findByNames(names, propKey) {
  var props = PropertiesService.getScriptProperties();
  var saved = props.getProperty(propKey);
  if (saved) { try { var f0 = DriveApp.getFileById(saved); if (!f0.isTrashed()) return f0; } catch (err) {} }
  for (var i = 0; i < names.length; i++) {
    var it = DriveApp.searchFiles('title = "' + names[i] + '" and trashed = false');
    if (it.hasNext()) { var f = it.next(); props.setProperty(propKey, f.getId()); return f; }
  }
  return null;
}
function readGrid(file, sheetName) {
  var parts = {};
  Utilities.unzip(file.getBlob().setContentType('application/zip')).forEach(function (b) { parts[b.getName()] = b; });
  var text = function (name) { return parts[name] ? parts[name].getDataAsString('UTF-8') : null; };
  return parseGrid(text('xl/workbook.xml'), text('xl/_rels/workbook.xml.rels'), text('xl/sharedStrings.xml'), text, sheetName);
}
function todaySerial() {
  var p = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd').split('-');
  return Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - Date.UTC(1899, 11, 30)) / 86400000);
}

// ---- 以下為純資料處理(不呼叫 GAS API,可在瀏覽器測試) ----
function tableOf(grid) {
  var header = grid.filter(function (g) { return g.r === 1; })[0];
  var col = {};
  if (header) Object.keys(header.cells).forEach(function (ci) {
    var t = String(header.cells[ci].val).trim();
    if (t && !col[t]) col[t] = Number(ci); // 同名標題取第一個
  });
  return { col: col, rows: grid.filter(function (g) { return g.r >= 2; }) };
}
function cellText(row, ci) { var c = ci && row.cells[ci]; return c ? String(c.val).trim() : ''; }
// 日期 → Excel 序號;接受數字序號或「2026/10/30」「2026-10-30」文字
function cellSerial(row, ci) {
  var c = ci && row.cells[ci];
  if (!c || c.val === '') return null;
  if (c.num && !isNaN(Number(c.val))) return Math.floor(Number(c.val));
  var m = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/.exec(String(c.val).trim());
  return m ? Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000) : null;
}
function serialYMD(n) {
  var d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  return d.getUTCFullYear() + '/' + pad2(d.getUTCMonth() + 1) + '/' + pad2(d.getUTCDate());
}
function isClosed(s) { return /^close$/i.test(String(s || '').trim()); }

function overdueFrom(remainGrid, pmGrid, today) {
  var out = { remain: [], pm: [] };
  var rt = tableOf(remainGrid), rc = rt.col;
  rt.rows.forEach(function (row) {
    if (isClosed(cellText(row, rc['狀態']))) return;
    var due = cellSerial(row, rc['改善期限']);
    var problem = cellText(row, rc['問題描述']);
    if (due == null || due >= today || !(problem || cellText(row, rc['專案代號']))) return;
    out.remain.push({
      code: cellText(row, rc['專案代號']), name: cellText(row, rc['專案名稱']), item: problem,
      owner: cellText(row, rc['負責人']), due: serialYMD(due), days: today - due,
    });
  });
  if (pmGrid) {
    var pt = tableOf(pmGrid), pc = pt.col;
    pt.rows.forEach(function (row) {
      var code = cellText(row, pc['專案代號']), name = cellText(row, pc['專案名稱']);
      if ((!code && !name) || cellText(row, pc['結案']) === '是') return;
      for (var n = 1; ; n++) {
        var sfx = n === 1 ? '' : String(n);
        var ci = { item: pc['追蹤確認事項' + sfx], progress: pc['進度與結果' + sfx], due: pc['期限' + sfx], status: pc['狀態' + sfx], owner: pc['追蹤負責人' + sfx] };
        if (!ci.item && !ci.progress && !ci.due && !ci.status) break;
        var item = cellText(row, ci.item), progress = cellText(row, ci.progress);
        var due = cellSerial(row, ci.due);
        if (isClosed(cellText(row, ci.status)) || due == null || due >= today) continue;
        out.pm.push({ code: code, name: name, batch: cellText(row, pc['批次']), item: item || progress || '(未填事項)', owner: cellText(row, ci.owner), due: serialYMD(due), days: today - due });
      }
    });
  }
  var byDays = function (a, b) { return b.days - a.days; };
  out.remain.sort(byDays);
  out.pm.sort(byDays);
  return out;
}

function overdueText(r) {
  var line = function (x) {
    return '・' + x.code + ' ' + x.name + (x.batch ? '(批次' + x.batch + ')' : '') + ':' + x.item.replace(/\s+/g, ' ').slice(0, 60) +
      ' — 期限 ' + x.due + '(逾期 ' + x.days + ' 天)' + (x.owner ? ' / ' + x.owner : '');
  };
  return '【追蹤/殘件事項】' + r.remain.length + ' 項\n' + (r.remain.map(line).join('\n') || '(無)') + '\n\n' +
    '【專案管理 追蹤事項】' + r.pm.length + ' 項\n' + (r.pm.map(line).join('\n') || '(無)');
}
function htmlEsc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function overdueHtml(r) {
  var th = 'style="background:#1e40af;color:#fff;padding:6px 8px;text-align:left;font-size:13px;white-space:nowrap"';
  var td = 'style="border-bottom:1px solid #e5e7eb;padding:6px 8px;font-size:13px;vertical-align:top"';
  var table = function (title, rows, ownerCol) {
    var h = '<h3 style="margin:18px 0 6px;font-size:16px">' + title + '(' + rows.length + ' 項)</h3>';
    if (!rows.length) return h + '<p style="color:#6b7280;margin:0">(無)</p>';
    h += '<table style="border-collapse:collapse;width:100%"><tr><th ' + th + '>專案</th><th ' + th + '>事項</th>' +
      (ownerCol ? '<th ' + th + '>負責人</th>' : '') + '<th ' + th + '>期限</th><th ' + th + '>逾期</th></tr>';
    rows.forEach(function (x) {
      h += '<tr><td ' + td + '><b>' + htmlEsc(x.code) + '</b><br>' + htmlEsc(x.name) + (x.batch ? '(批次' + htmlEsc(x.batch) + ')' : '') + '</td>' +
        '<td ' + td + '>' + htmlEsc(x.item).replace(/\n/g, '<br>') + '</td>' + (ownerCol ? '<td ' + td + '>' + htmlEsc(x.owner) + '</td>' : '') +
        '<td ' + td + ' nowrap>' + x.due + '</td><td ' + td + ' nowrap><b style="color:#dc2626">' + x.days + ' 天</b></td></tr>';
    });
    return h + '</table>';
  };
  return '<div style="font-family:sans-serif;color:#111">' + table('追蹤/殘件事項', r.remain, true) + table('專案管理 追蹤事項', r.pm, false) +
    '<p style="margin-top:18px"><a href="' + APP_URL + '">開啟 ATK專案履歷</a></p></div>';
}

// ---------- 每日專案管理現況(08:30 寄信給管理者) ----------
// 啟用:在編輯器選函式 installPmReport → 執行一次。測試:執行 pmReport(立即寄一封)
// 內容:(1) Project Management.xlsx「project list」中未結案的專案(排除「結案」=是、階段為完工、現況為 Finish/已完工/Pending),
//       每個專案列出階段、需求日期、現況,以及狀態不是 Close 的追蹤確認事項
//       (2) Project Resume.xlsx「Remain Item」中狀態不是 Close 的殘件/追蹤事項
function installPmReport() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['pmReportPlan', 'pmReport'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  // 每天 7 點多先排好當天 08:30 的單次排程(每日排程只能指定到「幾點」)
  ScriptApp.newTrigger('pmReportPlan').timeBased().everyDays(1).atHour(7).inTimezone(TZ).create();
  pmReportPlan();
}
function pmReportPlan() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'pmReport') ScriptApp.deleteTrigger(t); });
  var at = new Date(Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'08:30:00") + '+08:00');
  if (at.getTime() > Date.now()) ScriptApp.newTrigger('pmReport').timeBased().at(at).create();
}
function pmReport() {
  var pmFile = findByNames(PM_FILE_NAMES, 'PM_FILE_ID');
  if (!pmFile) throw new Error('找不到 Project Management.xlsx');
  var today = todaySerial();
  var list = pmReportFrom(readGrid(pmFile, PM_SHEET), today);
  var remains = remainOpenFrom(readGrid(getFile(), REMAIN_SHEET), today);
  var md = Utilities.formatDate(new Date(), TZ, 'M/d');
  var items = list.reduce(function (n, p) { return n + p.tracks.length; }, 0);
  MailApp.sendEmail({
    to: NOTIFY_TO || Session.getEffectiveUser().getEmail(),
    subject: '【專案現況 ' + md + '】未結案專案 ' + list.length + ' 個、追蹤事項(Open)' + items + ' 項、殘件/追蹤 ' + remains.length + ' 項',
    body: pmReportText(list, remains) + '\n\n' + APP_URL,
    htmlBody: pmReportHtml(list, remains),
    name: 'ATK專案履歷',
  });
}

// ---- 以下為純資料處理(不呼叫 GAS API,可在瀏覽器測試) ----
// 已完工/Pending:「階段」為完工,或「現況」寫 Finish / 已完工 / Pending(現況欄常用來標這兩種狀態)
function isPmDone(stage, current) {
  return /完工|pending/i.test(String(stage || '')) || /^\s*(finish(ed)?|已?完工|pending)/i.test(String(current || ''));
}
function pmReportFrom(pmGrid, today) {
  var pt = tableOf(pmGrid), pc = pt.col, out = [];
  pt.rows.forEach(function (row) {
    var code = cellText(row, pc['專案代號']), name = cellText(row, pc['專案名稱']);
    if ((!code && !name) || cellText(row, pc['結案']) === '是') return;
    var stage = cellText(row, pc['階段']), current = cellText(row, pc['現況']);
    if (isPmDone(stage, current)) return;
    var need = cellSerial(row, pc['需求日期']);
    var p = { code: code, name: name, batch: cellText(row, pc['批次']), stage: stage, need: need == null ? '' : serialYMD(need),
      current: current, tracks: [] };
    for (var n = 1; ; n++) {
      var sfx = n === 1 ? '' : String(n);
      var ci = { item: pc['追蹤確認事項' + sfx], progress: pc['進度與結果' + sfx], due: pc['期限' + sfx], status: pc['狀態' + sfx], owner: pc['追蹤負責人' + sfx] };
      if (!ci.item && !ci.progress && !ci.due && !ci.status) break;
      var item = cellText(row, ci.item), progress = cellText(row, ci.progress), status = cellText(row, ci.status);
      if ((!item && !progress) || isClosed(status)) continue;
      var due = cellSerial(row, ci.due);
      p.tracks.push({ item: item || '(未填事項)', progress: progress, owner: cellText(row, ci.owner), due: due == null ? '' : serialYMD(due), late: due != null && due < today ? today - due : 0, status: status || 'Open' });
    }
    out.push(p);
  });
  return out;
}
// 殘件/追蹤事項:狀態不是 Close 的(有問題描述或專案代號),依專案代號、改善期限排序
function remainOpenFrom(grid, today) {
  var t = tableOf(grid), c = t.col, out = [];
  var prog = c['改善進度與結果'] || c['改善進度及結果'];
  t.rows.forEach(function (row) {
    var problem = cellText(row, c['問題描述']), code = cellText(row, c['專案代號']);
    if (isClosed(cellText(row, c['狀態'])) || !(problem || code)) return;
    var due = cellSerial(row, c['改善期限']);
    out.push({ code: code, name: cellText(row, c['專案名稱']), problem: problem || '(未填問題描述)', progress: cellText(row, prog),
      owner: cellText(row, c['負責人']), dept: cellText(row, c['權責區分']), status: cellText(row, c['狀態']) || 'Open',
      dueN: due, due: due == null ? '' : serialYMD(due), late: due != null && due < today ? today - due : 0 });
  });
  out.sort(function (a, b) { return a.code < b.code ? -1 : a.code > b.code ? 1 : (a.dueN == null ? 1e9 : a.dueN) - (b.dueN == null ? 1e9 : b.dueN); });
  return out;
}
// 殘件依專案代號分到各專案下;專案不在未結案清單(或沒填代號)的放到 others
function remainByProject(list, remains) {
  var key = function (c) { return String(c || '').trim().toUpperCase(); };
  var map = {}, others = [];
  list.forEach(function (p) { if (p.code) map[key(p.code)] = []; });
  (remains || []).forEach(function (x) { var k = key(x.code); if (k && map[k]) map[k].push(x); else others.push(x); });
  return { of: function (p) { return (p.code && map[key(p.code)]) || []; }, others: others };
}
function remainLine(x, withCode) {
  return (withCode ? x.code + ' ' + x.name + ':' : '') + x.problem.replace(/\s+/g, ' ') + (x.progress ? ' → ' + x.progress.replace(/\s+/g, ' ') : '') +
    (x.owner ? ' / ' + x.owner : '') + (x.due ? '(期限 ' + x.due + (x.late ? ',逾期 ' + x.late + ' 天' : '') + ')' : '');
}
function pmReportText(list, remains) {
  var g = remainByProject(list, remains);
  var out = list.length ? list.map(function (p) {
    var head = '■ ' + p.code + ' ' + p.name + (p.batch ? '(批次' + p.batch + ')' : '') + ' — 階段:' + (p.stage || '—') + (p.need ? ' / 需求日期 ' + p.need : '');
    var cur = '  現況:' + (p.current ? p.current.replace(/\s*\n\s*/g, ' / ') : '(未填)');
    var tr = '  [追蹤事項]\n' + (p.tracks.length ? p.tracks.map(function (t) {
      return '  ・' + t.item.replace(/\s+/g, ' ') + (t.progress ? ' → ' + t.progress.replace(/\s+/g, ' ') : '') + (t.owner ? ' / ' + t.owner : '') + (t.due ? '(期限 ' + t.due + (t.late ? ',逾期 ' + t.late + ' 天' : '') + ')' : '');
    }).join('\n') : '  ・(無 Open 追蹤事項)');
    var rm = g.of(p);
    var rt = rm.length ? '\n  [殘件事項]\n' + rm.map(function (x) { return '  ・' + remainLine(x, false); }).join('\n') : '';
    return head + '\n' + cur + '\n' + tr + rt;
  }).join('\n\n') : '目前沒有未結案的專案。';
  if (g.others.length) out += '\n\n【其他殘件事項】(專案不在上列清單)\n' + g.others.map(function (x) { return '・' + remainLine(x, true); }).join('\n');
  return out;
}
function pmReportHtml(list, remains) {
  var th = 'style="background:#1e40af;color:#fff;padding:6px 8px;text-align:left;font-size:13px;white-space:nowrap"';
  var td = 'style="border-bottom:1px solid #e5e7eb;padding:6px 8px;font-size:13px;vertical-align:top"';
  var br = function (s) { return htmlEsc(s).replace(/\n/g, '<br>'); };
  var g = remainByProject(list, remains);
  var sub = function (t) { return '<div style="padding:8px 10px 4px;font-size:13px"><b>' + t + '</b></div>'; };
  var remainRows = function (rows, withCode) {
    var r = '<table style="border-collapse:collapse;width:100%"><tr>' + (withCode ? '<th ' + th + '>專案</th>' : '') + '<th ' + th + '>問題描述</th><th ' + th + '>改善進度與結果</th><th ' + th + '>負責人</th><th ' + th + '>期限</th><th ' + th + '>狀態</th></tr>';
    rows.forEach(function (x) {
      r += '<tr>' + (withCode ? '<td ' + td + '><b>' + htmlEsc(x.code) + '</b><br>' + htmlEsc(x.name) + '</td>' : '') + '<td ' + td + '>' + br(x.problem) + '</td><td ' + td + '>' + br(x.progress) + '</td>' +
        '<td ' + td + '>' + htmlEsc(x.owner) + (x.dept ? '<br><span style="color:#6b7280">' + htmlEsc(x.dept) + '</span>' : '') + '</td>' +
        '<td ' + td + ' nowrap>' + (x.due || '—') + (x.late ? '<br><b style="color:#dc2626">逾期 ' + x.late + ' 天</b>' : '') + '</td><td ' + td + ' nowrap>' + htmlEsc(x.status) + '</td></tr>';
    });
    return r + '</table>';
  };
  var h = '<div style="font-family:sans-serif;color:#111"><h3 style="margin:0 0 10px;font-size:17px">專案管理(未結案 ' + list.length + ' 個)</h3>';
  if (!list.length) h += '<p>目前沒有未結案的專案。</p>';
  list.forEach(function (p) {
    h += '<div style="margin:0 0 18px;border:1px solid #d1d5db;border-radius:8px;overflow:hidden">' +
      '<div style="background:#eff6ff;padding:8px 10px"><b style="font-size:15px">' + htmlEsc(p.code) + ' ' + htmlEsc(p.name) + '</b>' +
      (p.batch ? '<span style="color:#6b7280">(批次' + htmlEsc(p.batch) + ')</span>' : '') +
      '<div style="font-size:13px;color:#374151;margin-top:2px">階段:<b>' + htmlEsc(p.stage || '—') + '</b>' + (p.need ? ' ・ 需求日期 ' + p.need : '') + '</div></div>' +
      '<div style="padding:8px 10px;font-size:13px"><b>現況</b><br>' + (p.current ? br(p.current) : '<span style="color:#9ca3af">(未填)</span>') + '</div>';
    h += sub('追蹤事項(Open ' + p.tracks.length + ' 項)');
    if (p.tracks.length) {
      h += '<table style="border-collapse:collapse;width:100%"><tr><th ' + th + '>追蹤確認事項</th><th ' + th + '>進度與結果</th><th ' + th + '>負責人</th><th ' + th + '>期限</th></tr>';
      p.tracks.forEach(function (t) {
        h += '<tr><td ' + td + '>' + br(t.item) + '</td><td ' + td + '>' + br(t.progress) + '</td><td ' + td + '>' + htmlEsc(t.owner) + '</td><td ' + td + ' nowrap>' + (t.due || '—') +
          (t.late ? '<br><b style="color:#dc2626">逾期 ' + t.late + ' 天</b>' : '') + '</td></tr>';
      });
      h += '</table>';
    } else h += '<div style="padding:0 10px 8px;font-size:13px;color:#9ca3af">(無 Open 追蹤事項)</div>';
    var rm = g.of(p);
    if (rm.length) h += sub('殘件事項(未結案 ' + rm.length + ' 項)') + remainRows(rm, false);
    h += '</div>';
  });
  if (g.others.length) h += '<h3 style="margin:24px 0 8px;font-size:17px">其他殘件事項(專案不在上列清單,' + g.others.length + ' 項)</h3>' + remainRows(g.others, true);
  return h + '<p style="margin-top:18px"><a href="' + APP_URL + '#/pm">專案管理</a> ・ <a href="' + APP_URL + '#/remain">殘件/追蹤事項</a></p></div>';
}

// ---------- 傳送到釘釘群組(自訂機器人) ----------
// 設定:專案設定(齒輪)→ 指令碼屬性 → 新增
//   DINGTALK_WEBHOOK = 機器人 Webhook 網址(https://oapi.dingtalk.com/robot/send?access_token=…)
//   DINGTALK_SECRET  = 機器人安全設定選「加簽」時的 SEC… 密鑰(選「自訂關鍵詞」則不用填,關鍵詞請用「專案履歷」)
// Webhook 不寫在程式裡(本檔放在公開的 GitHub)。訊息內容由伺服器依履歷產生,同一份履歷 30 秒內只送一次
function dingSend(res, key) {
  var cache = CacheService.getScriptCache();
  if (cache.get('ding_' + res.id)) throw new Error('剛剛已傳送過,請稍後再試');
  var title = resumeTitleOf(res) + (res.author ? '_' + String(res.author).trim() : ''); // 連結名稱後加 _填表人
  var url = APP_URL + '#/v/' + encodeURIComponent(res.id) + '?k=' + encodeURIComponent(key);
  dingPost(title, '[' + title.replace(/[\[\]]/g, '') + '](' + url + ')');
  cache.put('ding_' + res.id, '1', 30);
  return { ok: true, title: title };
}
// 由釘釘群組機器人傳 markdown 訊息;atMobiles:要 @ 的手機號碼(文字中也要有 @號碼)
function dingPost(title, text, atMobiles) {
  var props = PropertiesService.getScriptProperties();
  var hook = props.getProperty('DINGTALK_WEBHOOK');
  if (!hook) throw new Error('尚未設定釘釘機器人(DINGTALK_WEBHOOK)');
  var secret = props.getProperty('DINGTALK_SECRET');
  if (secret) {
    var ts = String(Date.now());
    var sign = Utilities.base64Encode(Utilities.computeHmacSha256Signature(ts + '\n' + secret, secret));
    hook += '&timestamp=' + ts + '&sign=' + encodeURIComponent(sign);
  }
  var body = { msgtype: 'markdown', markdown: { title: title, text: text } };
  if (atMobiles && atMobiles.length) body.at = { atMobiles: atMobiles, isAtAll: false };
  var resp = UrlFetchApp.fetch(hook, { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: JSON.stringify(body) });
  var j = {};
  try { j = JSON.parse(resp.getContentText()); } catch (err) {}
  if (j.errcode !== 0) throw new Error('釘釘拒絕:' + (j.errmsg || resp.getResponseCode()));
}
function offDaysOf(file) {
  try { return offDaysFrom(readGrid(file, OFF_SHEET)); } catch (err) { return {}; } // 還沒有公司假日工作表
}
// 第一次使用前在編輯器執行一次:授權「連線到外部服務」(只連線測試,不會發訊息到群組)
function authorizeDingtalk() {
  var code = UrlFetchApp.fetch('https://oapi.dingtalk.com/', { muteHttpExceptions: true }).getResponseCode();
  Logger.log('已授權外部連線(釘釘回應 ' + code + ');Webhook ' + (PropertiesService.getScriptProperties().getProperty('DINGTALK_WEBHOOK') ? '已設定' : '尚未設定'));
}
// 與 App 的複製連結標題相同:「2026/10/28 MD-2260002 INX_TFT6 FFU改造 專案履歷」
function resumeTitleOf(r) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(r.start || ''));
  var t = [m ? m[1] + '/' + m[2] + '/' + m[3] : '', r.code, r.name].filter(Boolean).join(' ');
  return (t ? t + ' ' : '') + '專案履歷';
}

// ---------- ERP 工時:手機匯出的 ERP-WT.xlsx(專案履歷檔同層「ERP工時」資料夾)→ 電腦上的排程程式(erp-sync.ps1)取回 ----------
// 金鑰存在「指令碼屬性」ERP_KEY(不放在程式碼);第一次在編輯器執行 erpKeySetup 產生,並填入電腦的 erp-sync.key
// since:電腦上次取回的修改時間(ISO);檔案沒有更新時只回傳時間,不回傳內容
function erpOut(key, since) {
  var want = PropertiesService.getScriptProperties().getProperty('ERP_KEY');
  if (!want || key !== want) throw new Error('金鑰不符');
  var parents = getFile().getParents();
  if (!parents.hasNext()) throw new Error('找不到專案履歷檔所在的資料夾');
  var dirs = parents.next().getFoldersByName('ERP工時');
  if (!dirs.hasNext()) return { ok: true, none: true };
  var files = dirs.next().getFilesByName('ERP-WT.xlsx'), f = null;
  while (files.hasNext()) { var x = files.next(); if (!x.isTrashed() && (!f || x.getLastUpdated() > f.getLastUpdated())) f = x; }
  if (!f) return { ok: true, none: true };
  var mod = f.getLastUpdated().toISOString();
  var out = { ok: true, modified: mod };
  if (!since || mod > since) out.b64 = Utilities.base64Encode(f.getBlob().getBytes());
  return out;
}
function erpKeySetup() {
  var props = PropertiesService.getScriptProperties();
  var k = props.getProperty('ERP_KEY');
  if (!k) { k = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); props.setProperty('ERP_KEY', k); }
  Logger.log('ERP_KEY=' + k);
}

// ---------- 近期工作項目 → Google 日曆(App 存檔後呼叫 ?a=cal;也可在編輯器直接執行 syncCalendar) ----------
// 「已排定」的項目建立全天事件:標題「工作項目_硬體、軟體人員」、顏色羅勒綠;以事件標籤 wl 記住對應的工作項目,
// 之後日期/人員有改就更新;項目刪除或改成其他狀態(完工除外)時移除該事件。只動本程式建立(或認領)的事件
var CAL_NAME = 'ATK';
var WL_SHEET = 'List', WL_ARCHIVE = '資料庫', WL_MAX_ROW = 17;
var CAL_TAG = 'wl';

function syncCalendar() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var cals = CalendarApp.getCalendarsByName(CAL_NAME);
    if (!cals.length) throw new Error('找不到日曆「' + CAL_NAME + '」');
    var cal = cals[0];
    var file = DriveApp.getFileById(WORK_FILE_ID);
    var want = scheduledFrom(readGrid(file, WL_SHEET));
    var done = {};
    try { readGrid(file, WL_ARCHIVE).forEach(function (g) { var t = g.r >= 2 && cellText(g, 1); if (t) done[t] = true; }); } catch (err) {}

    var now = new Date();
    var evs = cal.getEvents(new Date(now.getTime() - 400 * 86400000), new Date(now.getTime() + 730 * 86400000));
    var tagged = {}, byTitle = {};
    evs.forEach(function (ev) {
      var k = ev.getTag(CAL_TAG);
      if (k) (tagged[k] = tagged[k] || []).push(ev);
      else if (ev.isAllDayEvent()) byTitle[ev.getTitle()] = byTitle[ev.getTitle()] || ev;
    });
    var res = { ok: true, created: 0, updated: 0, removed: 0 };
    Object.keys(want).forEach(function (k) {
      var w = want[k];
      var list = tagged[k] || [];
      var ev = list[0] || byTitle[w.title]; // 沒有對應事件時,認領手動建立的同名全天事件,避免重複
      list.slice(1).forEach(function (x) { x.deleteEvent(); res.removed++; });
      delete tagged[k];
      if (!ev) {
        ev = cal.createAllDayEvent(w.title, w.start, w.endEx);
        ev.setTag(CAL_TAG, k);
        ev.setColor(CalendarApp.EventColor.GREEN);
        res.created++;
        return;
      }
      var changed = false;
      if (!ev.getTag(CAL_TAG)) { ev.setTag(CAL_TAG, k); changed = true; }
      if (ev.getTitle() !== w.title) { ev.setTitle(w.title); changed = true; }
      if (!ev.isAllDayEvent() || ev.getAllDayStartDate().getTime() !== w.start.getTime() || ev.getAllDayEndDate().getTime() !== w.endEx.getTime()) {
        ev.setAllDayDates(w.start, w.endEx); changed = true;
      }
      if (ev.getColor() !== String(CalendarApp.EventColor.GREEN)) { ev.setColor(CalendarApp.EventColor.GREEN); changed = true; }
      if (changed) res.updated++;
    });
    // 不再是「已排定」的項目:完工(已移到資料庫)保留事件,其餘移除
    Object.keys(tagged).forEach(function (k) {
      if (done[k]) return;
      tagged[k].forEach(function (ev) { ev.deleteEvent(); res.removed++; });
    });
    Logger.log('日曆同步:新增 ' + res.created + '、更新 ' + res.updated + '、移除 ' + res.removed);
    return res;
  } finally { lock.releaseLock(); }
}

// List 工作表 → { 工作項目: { title, start, endEx(結束日隔天) } };只取狀態「已排定/已確定」且有開始日期的列
function scheduledFrom(grid) {
  var out = {};
  grid.forEach(function (g) {
    if (g.r < 2 || g.r > WL_MAX_ROW) return;
    var item = cellText(g, 1), status = cellText(g, 5);
    if (!item || (status !== '已排定' && status !== '已確定')) return;
    var s = cellSerial(g, 2), e = cellSerial(g, 3);
    if (s == null) return;
    if (e == null || e < s) e = s;
    var who = [cellText(g, 6), cellText(g, 7)].filter(Boolean).join('、');
    out[item] = { title: who ? item + '_' + who : item, start: serialDate(s), endEx: serialDate(e + 1) };
  });
  return out;
}
function serialDate(n) {
  var d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

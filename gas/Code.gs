/**
 * ATK專案履歷 — 分享連結免登入檢視(Google Apps Script 網頁應用程式)
 *
 * 部署:script.google.com 新增專案 → 貼上本檔 → 部署 → 新增部署作業 → 類型「網頁應用程式」
 *       執行身分:我(管理者)  /  誰可以存取:所有人  → 複製網址貼到 js/config.js 的 SHARE_URL
 *       更新程式後:部署 → 管理部署作業 → 編輯 → 版本選「新版本」→ 部署(網址不變)
 *       加速:在編輯器選函式 installWarmTrigger → 執行一次(建立每 10 分鐘預熱排程)
 * 安全:只回傳「履歷編號 + 分享碼」都相符的那一份履歷;圖片/附件也只限該履歷中有列出的檔案。
 *
 *   ?id=<履歷編號>&k=<分享碼>                → { ok, resume }
 *   ?a=file&id=<履歷編號>&k=<分享碼>&f=<檔案ID> → { ok, name, mime, data(base64) }
 *   ?a=ding&id=<履歷編號>&k=<分享碼>          → 由釘釘群組機器人發送「標題=連結」訊息 → { ok }
 */
var FILE_ID = '';                       // 可填 Project Resume.xlsx 的檔案 ID(App 設定頁可複製);空白則依檔名搜尋
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
    var r = findResume(String(p.id || ''), String(p.k || ''));
    if (p.a === 'file') return json(fileOut(r, String(p.f || '')));
    if (p.a === 'ding') return json(dingSend(r, String(p.k || '')));
    return json({ ok: true, resume: r });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
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
        var ci = { item: pc['追蹤確認事項' + sfx], progress: pc['進度與結果' + sfx], due: pc['期限' + sfx], status: pc['狀態' + sfx] };
        if (!ci.item && !ci.progress && !ci.due && !ci.status) break;
        var item = cellText(row, ci.item), progress = cellText(row, ci.progress);
        var due = cellSerial(row, ci.due);
        if (isClosed(cellText(row, ci.status)) || due == null || due >= today) continue;
        out.pm.push({ code: code, name: name, batch: cellText(row, pc['批次']), item: item || progress || '(未填事項)', due: serialYMD(due), days: today - due });
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

// ---------- 傳送到釘釘群組(自訂機器人) ----------
// 設定:專案設定(齒輪)→ 指令碼屬性 → 新增
//   DINGTALK_WEBHOOK = 機器人 Webhook 網址(https://oapi.dingtalk.com/robot/send?access_token=…)
//   DINGTALK_SECRET  = 機器人安全設定選「加簽」時的 SEC… 密鑰(選「自訂關鍵詞」則不用填,關鍵詞請用「專案履歷」)
// Webhook 不寫在程式裡(本檔放在公開的 GitHub)。訊息內容由伺服器依履歷產生,同一份履歷 30 秒內只送一次
function dingSend(res, key) {
  var props = PropertiesService.getScriptProperties();
  var hook = props.getProperty('DINGTALK_WEBHOOK');
  if (!hook) throw new Error('尚未設定釘釘機器人(DINGTALK_WEBHOOK)');
  var cache = CacheService.getScriptCache();
  if (cache.get('ding_' + res.id)) throw new Error('剛剛已傳送過,請稍後再試');
  var secret = props.getProperty('DINGTALK_SECRET');
  if (secret) {
    var ts = String(Date.now());
    var sign = Utilities.base64Encode(Utilities.computeHmacSha256Signature(ts + '\n' + secret, secret));
    hook += '&timestamp=' + ts + '&sign=' + encodeURIComponent(sign);
  }
  var title = resumeTitleOf(res);
  var url = APP_URL + '#/v/' + encodeURIComponent(res.id) + '?k=' + encodeURIComponent(key);
  var resp = UrlFetchApp.fetch(hook, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ msgtype: 'markdown', markdown: { title: title, text: '[' + title.replace(/[\[\]]/g, '') + '](' + url + ')' } }),
  });
  var j = {};
  try { j = JSON.parse(resp.getContentText()); } catch (err) {}
  if (j.errcode !== 0) throw new Error('釘釘拒絕:' + (j.errmsg || resp.getResponseCode()));
  cache.put('ding_' + res.id, '1', 30);
  return { ok: true, title: title };
}
// 與 App 的複製連結標題相同:「2026/10/28 MD-2260002 INX_TFT6 FFU改造 專案履歷」
function resumeTitleOf(r) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(r.start || ''));
  var t = [m ? m[1] + '/' + m[2] + '/' + m[3] : '', r.code, r.name].filter(Boolean).join(' ');
  return (t ? t + ' ' : '') + '專案履歷';
}

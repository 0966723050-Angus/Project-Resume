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
  if (cache.get('v_' + ver)) return []; // 這個版本已解析過且沒有此編號
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

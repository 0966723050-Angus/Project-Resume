/**
 * ATK專案履歷 — 分享連結免登入檢視(Google Apps Script 網頁應用程式)
 *
 * 部署:script.google.com 新增專案 → 貼上本檔 → 部署 → 新增部署作業 → 類型「網頁應用程式」
 *       執行身分:我(管理者)  /  誰可以存取:所有人  → 複製網址貼到 js/config.js 的 SHARE_URL
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

function getFile() {
  if (FILE_ID) return DriveApp.getFileById(FILE_ID);
  var it = DriveApp.searchFiles('title = "' + FILE_NAME + '" and trashed = false');
  if (!it.hasNext()) throw new Error('找不到 ' + FILE_NAME);
  return it.next();
}

// 讀取「Project Resume」工作表的資料列(依檔案更新時間快取 5 分鐘)
function loadRows() {
  var f = getFile();
  var cache = CacheService.getScriptCache();
  var ck = 'rows_' + f.getId() + '_' + f.getLastUpdated().getTime();
  var hit = cache.get(ck);
  if (hit) return JSON.parse(hit);
  var parts = {};
  Utilities.unzip(f.getBlob().setContentType('application/zip')).forEach(function (b) { parts[b.getName()] = b; });
  var text = function (name) { return parts[name] ? parts[name].getDataAsString('UTF-8') : null; };
  var rows = parseSheet(text('xl/workbook.xml'), text('xl/_rels/workbook.xml.rels'), text('xl/sharedStrings.xml'), text, SHEET);
  try { cache.put(ck, JSON.stringify(rows), 300); } catch (err) { /* 超過快取上限就不快取 */ }
  return rows;
}

function findResume(id, key) {
  if (!id || !key) throw new Error('連結不完整');
  var rows = loadRows().filter(function (r) { return r.id === id; });
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

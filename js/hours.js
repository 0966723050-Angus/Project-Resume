// hours.js - 工時紀錄(存在 Project Resume.xlsx 的「工時」工作表,一列一筆)
// 欄位依表頭文字對應;時間存成「yyyy-mm-dd hh:mm」文字,另存「月份」(yyyy-mm)方便在 Excel 樞紐分析
(function () {
  const SHEET = '工時';
  const FIELDS = [
    { key: 'id', label: '工時編號', w: 18 },
    { key: 'month', label: '月份', w: 9 },
    { key: 'name', label: '姓名', w: 12 },
    { key: 'email', label: 'E-Mail', w: 28 },
    { key: 'code', label: '專案代號', w: 14 },
    { key: 'pname', label: '專案名稱', w: 30 },
    { key: 'cat', label: '報工類別', w: 9 },
    { key: 'start', label: '開始時間', w: 17 },
    { key: 'end', label: '結束時間', w: 17 },
    { key: 'hours', label: '報工總時數', w: 10, num: true },
    { key: 'note', label: '備註說明', w: 40 },
    { key: 'resume', label: '來源履歷', w: 18 },
    { key: 'by', label: '建立者', w: 28 },
  ];
  const CATS = ['設計', '工程', '一般'];
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const col = (i) => (i < 26 ? '' : String.fromCharCode(64 + Math.floor(i / 26))) + String.fromCharCode(65 + (i % 26));
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cell = (ref, v, num) => {
    if (v === '' || v == null) return '';
    if (num && Number.isFinite(Number(v))) return `<c r="${ref}"><v>${Number(v)}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  };
  const dt = (v) => (typeof v === 'number' ? Store.serialToDT(v, true) : Store.normDT(v, true)); // → yyyy-mm-ddThh:mm
  const toText = (v) => String(v || '').replace('T', ' ');

  function read(book) {
    const g = WorkIO.grid(book, SHEET);
    if (!g) return [];
    const colOf = {};
    for (let i = 0; i < 40; i++) { const f = FIELDS.find((x) => x.label === String(g.get(col(i) + 1) ?? '').trim()); if (f && !colOf[f.key]) colOf[f.key] = col(i); }
    const out = [];
    for (let r = 2; r <= g.lastRow; r++) {
      const p = {};
      FIELDS.forEach((f) => { const v = colOf[f.key] ? g.get(colOf[f.key] + r) : undefined; p[f.key] = v == null ? '' : v; });
      if (!p.name && !p.code && !p.hours) continue;
      p.start = p.start === '' ? '' : dt(p.start);
      p.end = p.end === '' ? '' : dt(p.end);
      p.hours = p.hours === '' ? '' : Number(p.hours) || 0;
      FIELDS.forEach((f) => { if (!['start', 'end', 'hours'].includes(f.key)) p[f.key] = String(p[f.key]).trim(); });
      p.email = p.email.toLowerCase();
      if (!p.id) p.id = Store.newId('WH');
      out.push(p);
    }
    return out;
  }

  // 整張重寫「工時」工作表(不存在時新增),依開始時間排序
  function write(book, recs) {
    const rows = recs.slice().sort((a, b) => String(a.start).localeCompare(String(b.start)));
    const head = `<row r="1">${FIELDS.map((f, i) => cell(col(i) + 1, f.label)).join('')}</row>`;
    const body = rows.map((p, n) => {
      const r = n + 2;
      const v = { ...p, month: String(p.start || '').slice(0, 7), start: toText(p.start), end: toText(p.end) };
      return `<row r="${r}">${FIELDS.map((f, i) => cell(col(i) + r, v[f.key], f.num)).join('')}</row>`;
    }).join('');
    const cols = FIELDS.map((f, i) => `<col min="${i + 1}" max="${i + 1}" width="${f.w}" customWidth="1"/>`).join('');
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}">` +
      `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="20"/><cols>${cols}</cols><sheetData>${head}${body}</sheetData></worksheet>`;
    const isNew = !book.sheets[SHEET];
    book.files[WorkIO.ensureSheetPath(book.files, SHEET)] = new TextEncoder().encode(xml);
    // 新增工作表時改了 workbook.xml 等檔案:清掉 Book 的解析快取,之後的寫入(例如履歷)才不會蓋回舊版
    if (isNew) for (const p of ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', '[Content_Types].xml']) { delete book.docs[p]; book.touched.delete(p); }
  }

  // 兩個時間相差幾小時,扣除每天 12:00~13:00 午休中重疊的部分(取到 0.5 小時);缺值回傳 null
  const LUNCH = [12 / 24, 13 / 24];
  function diffHours(start, end) {
    const s = Store.dtToSerial(start), e = Store.dtToSerial(end);
    if (s == null || e == null || e <= s) return null;
    let d = e - s;
    for (let day = Math.floor(s); day <= Math.floor(e); day++) d -= Math.max(0, Math.min(e, day + LUNCH[1]) - Math.max(s, day + LUNCH[0]));
    return Math.round(d * 24 * 2) / 2;
  }

  // ---- 上班日(行政院人事行政總處行事曆:國定假日、補假不算,補班算)----
  // 資料取自 TaiwanCalendar(jsDelivr),每年一份,記在本機;抓不到時只排除週六日
  const CAL_URL = (y) => `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${y}.json`;
  const cal = {}; // year → Promise<Set<'yyyy-mm-dd'> 假日> | null(改用週六日)
  function holidays(year) {
    if (!cal[year]) {
      cal[year] = (async () => {
        const key = 'pr_twcal_' + year;
        let list = null;
        try { list = JSON.parse(localStorage.getItem(key) || 'null'); } catch { /* 忽略 */ }
        if (!list) {
          const resp = await fetch(CAL_URL(year));
          if (!resp.ok) throw new Error('calendar ' + resp.status);
          list = (await resp.json()).filter((d) => d.isHoliday).map((d) => `${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}`);
          if (list.length > 60) try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* 忽略 */ }
        }
        return new Set(list);
      })().catch(() => null);
    }
    return cal[year];
  }
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  // 某月(yyyy-mm)到 before(不含,yyyy-mm-dd)為止的上班日;當天 23:59 前還能提報,所以不含今天
  // off:公司另外公告的全員放假日(颱風假等,Set<'yyyy-mm-dd'>)
  async function workdays(mon, before, off) {
    const [y, m] = mon.split('-').map(Number);
    const hol = await holidays(y);
    const out = [];
    for (let d = new Date(y, m - 1, 1); d.getMonth() === m - 1; d.setDate(d.getDate() + 1)) {
      const s = iso(d);
      if (before && s >= before) break;
      if ((hol ? !hol.has(s) : d.getDay() % 6 !== 0) && !(off && off.has(s))) out.push(s);
    }
    return { days: out, exact: !!hol };
  }
  // 有提報的日子:每筆紀錄從開始日到結束日都算
  function reportedDays(recs) {
    const set = new Set();
    for (const r of recs) {
      const a = String(r.start || '').slice(0, 10), b = String(r.end || '').slice(0, 10) || a;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a)) continue;
      for (let d = new Date(a + 'T00:00'), n = 0; iso(d) <= b && n < 62; d.setDate(d.getDate() + 1), n++) set.add(iso(d));
      set.add(a);
    }
    return set;
  }

  // ---- 請假日(「請假」工作表,一列一天:E-Mail | 姓名 | 日期 yyyy-mm-dd);請假日不算未提報 ----
  const LEAVE_SHEET = '請假';
  const LEAVE_FIELDS = [{ key: 'email', label: 'E-Mail', w: 28 }, { key: 'name', label: '姓名', w: 12 }, { key: 'date', label: '日期', w: 12 }];
  function readLeave(book) {
    const g = WorkIO.grid(book, LEAVE_SHEET);
    if (!g) return [];
    const colOf = {};
    for (let i = 0; i < 10; i++) { const f = LEAVE_FIELDS.find((x) => x.label === String(g.get(col(i) + 1) ?? '').trim()); if (f && !colOf[f.key]) colOf[f.key] = col(i); }
    const out = [];
    for (let r = 2; r <= g.lastRow; r++) {
      const get = (k) => (colOf[k] ? g.get(colOf[k] + r) : undefined);
      const d = get('date');
      const date = typeof d === 'number' ? Store.serialToDT(d).slice(0, 10) : String(d ?? '').trim().replace(/\//g, '-').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      out.push({ email: String(get('email') ?? '').trim().toLowerCase(), name: String(get('name') ?? '').trim(), date });
    }
    return out;
  }
  function writeLeave(book, list) {
    const rows = list.slice().sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'zh-Hant'));
    const head = `<row r="1">${LEAVE_FIELDS.map((f, i) => cell(col(i) + 1, f.label)).join('')}</row>`;
    const body = rows.map((p, n) => `<row r="${n + 2}">${LEAVE_FIELDS.map((f, i) => cell(col(i) + (n + 2), p[f.key])).join('')}</row>`).join('');
    const cols = LEAVE_FIELDS.map((f, i) => `<col min="${i + 1}" max="${i + 1}" width="${f.w}" customWidth="1"/>`).join('');
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}">` +
      `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="20"/><cols>${cols}</cols><sheetData>${head}${body}</sheetData></worksheet>`;
    const isNew = !book.sheets[LEAVE_SHEET];
    book.files[WorkIO.ensureSheetPath(book.files, LEAVE_SHEET)] = new TextEncoder().encode(xml);
    if (isNew) for (const p of ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', '[Content_Types].xml']) { delete book.docs[p]; book.touched.delete(p); }
  }

  // ---- 公司假日(「公司假日」工作表:日期 | 說明 | 設定者):颱風假/特定假日,全員免提報 ----
  const OFF_SHEET = '公司假日';
  const OFF_FIELDS = [{ key: 'date', label: '日期', w: 12 }, { key: 'note', label: '說明', w: 24 }, { key: 'by', label: '設定者', w: 28 }];
  function readSheet(book, sheet, fields) {
    const g = WorkIO.grid(book, sheet);
    if (!g) return [];
    const colOf = {};
    for (let i = 0; i < 10; i++) { const f = fields.find((x) => x.label === String(g.get(col(i) + 1) ?? '').trim()); if (f && !colOf[f.key]) colOf[f.key] = col(i); }
    const out = [];
    for (let r = 2; r <= g.lastRow; r++) {
      const p = {};
      fields.forEach((f) => { const v = colOf[f.key] ? g.get(colOf[f.key] + r) : undefined; p[f.key] = v; });
      const d = p.date;
      p.date = typeof d === 'number' ? Store.serialToDT(d).slice(0, 10) : String(d ?? '').trim().replace(/\//g, '-').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) continue;
      fields.forEach((f) => { if (f.key !== 'date') p[f.key] = String(p[f.key] ?? '').trim(); });
      out.push(p);
    }
    return out;
  }
  function writeSheet(book, sheet, fields, rows) {
    const head = `<row r="1">${fields.map((f, i) => cell(col(i) + 1, f.label)).join('')}</row>`;
    const body = rows.map((p, n) => `<row r="${n + 2}">${fields.map((f, i) => cell(col(i) + (n + 2), p[f.key])).join('')}</row>`).join('');
    const cols = fields.map((f, i) => `<col min="${i + 1}" max="${i + 1}" width="${f.w}" customWidth="1"/>`).join('');
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}">` +
      `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="20"/><cols>${cols}</cols><sheetData>${head}${body}</sheetData></worksheet>`;
    const isNew = !book.sheets[sheet];
    book.files[WorkIO.ensureSheetPath(book.files, sheet)] = new TextEncoder().encode(xml);
    if (isNew) for (const p of ['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', '[Content_Types].xml']) { delete book.docs[p]; book.touched.delete(p); }
  }
  const readOff = (book) => readSheet(book, OFF_SHEET, OFF_FIELDS);
  const writeOff = (book, list) => writeSheet(book, OFF_SHEET, OFF_FIELDS, list.slice().sort((a, b) => a.date.localeCompare(b.date)));

  window.Hours = { SHEET, FIELDS, CATS, read, write, diffHours, workdays, reportedDays, readLeave, writeLeave, readOff, writeOff };
})();

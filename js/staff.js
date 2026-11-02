// staff.js - 公司人員名單(存在 Project Resume.xlsx 的「公司人員」工作表,一列一人)
// 欄位:員工代號 | 姓名 | 英文姓名 | 部門 | E-Mail;依表頭文字對應欄位(舊版缺少的欄位也讀得正確)
(function () {
  const SHEET = '公司人員';
  const FIELDS = [
    { key: 'empNo', label: '員工代號' },
    { key: 'name', label: '姓名' },
    { key: 'ename', label: '英文姓名' },
    { key: 'dept', label: '部門' },
    { key: 'email', label: 'E-Mail' },
  ];
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const COLS = 'ABCDEFGHIJ';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cell = (ref, text) => (text ? `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>` : '');

  function read(book) {
    const g = WorkIO.grid(book, SHEET);
    if (!g) return [];
    const colOf = {};
    for (const c of COLS) { const f = FIELDS.find((x) => x.label.toLowerCase() === String(g.get(c + 1) ?? '').trim().toLowerCase()); if (f && !colOf[f.key]) colOf[f.key] = c; }
    const out = [];
    for (let r = 2; r <= g.lastRow; r++) {
      const p = {};
      FIELDS.forEach((f) => { p[f.key] = colOf[f.key] ? String(g.get(colOf[f.key] + r) ?? '').trim() : ''; });
      if (FIELDS.some((f) => p[f.key])) out.push(p);
    }
    return out;
  }

  // 整張重寫「公司人員」工作表(不存在時新增)
  function write(book, people) {
    const head = `<row r="1">${FIELDS.map((f, i) => cell(COLS[i] + 1, f.label)).join('')}</row>`;
    const body = people.map((p, i) => `<row r="${i + 2}">${FIELDS.map((f, j) => cell(COLS[j] + (i + 2), p[f.key])).join('')}</row>`).join('');
    const cols = [12, 14, 18, 14, 36].map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}">` +
      `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="20"/><cols>${cols}</cols><sheetData>${head}${body}</sheetData></worksheet>`;
    book.files[WorkIO.ensureSheetPath(book.files, SHEET)] = new TextEncoder().encode(xml);
  }

  // 批次匯入:每行「員工代號 姓名」(空白、Tab 或逗號分隔,可直接從 Excel 複製兩欄貼上);
  // 同名者補上/更新員工代號,名單沒有的人新增;回傳 { updated, added, skipped }
  function importEmpNo(list, text) {
    const res = { updated: 0, added: 0, skipped: 0 };
    for (const line of String(text || '').split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      const m = /^(\S+)[\s,，]+(.+)$/.exec(t);
      if (!m || m[1] === '員工代號') { res.skipped++; continue; }
      const no = m[1].trim(), name = m[2].trim();
      const p = list.find((x) => x.name === name);
      if (p) { if (p.empNo !== no) { p.empNo = no; res.updated++; } } else { list.push({ empNo: no, name, ename: '', dept: '', email: '' }); res.added++; }
    }
    return res;
  }

  window.Staff = { FIELDS, read, write, importEmpNo };
})();

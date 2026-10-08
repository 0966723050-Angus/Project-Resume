// pm-store.js — 「專案管理」Project Management.xlsx 的讀取與「逐格修改」寫入。
// 這張表已有大量資料與個別格式,因此不重寫整張表:只改有變動的儲存格,新增時接在最後一筆資料下方,
// 刪除時把下方各列往上移一列。追蹤事項第 2 組起寫在 EXTRA_START 欄之後(標題加編號)。
(function () {
  const CFG = window.APP_CONFIG;
  const PM = CFG.PM;
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const EPOCH = Date.UTC(1899, 11, 30);
  const DAY = 86400000;
  const DATE_FMT = 'yyyy/m/d;@';
  const pad = (n) => String(n).padStart(2, '0');
  const colToIdx = (s) => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
  const idxToCol = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const refCol = (ref) => colToIdx(/^[A-Z]+/.exec(ref)[0]);
  const kids = (el, name) => Array.from(el.childNodes).filter((n) => n.nodeType === 1 && (!name || n.localName === name));

  function serialToISO(v) {
    const d = new Date(EPOCH + Math.round(Number(v)) * DAY);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  function isoToSerial(s) {
    const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(String(s || '').trim());
    return m ? Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - EPOCH) / DAY) : null;
  }
  const trackTitle = (t, n) => (n === 1 ? t.title : t.title + n);
  const normStatus = (v) => (/^open$/i.test(v) ? 'Open' : /^close$/i.test(v) ? 'Close' : v);

  // 依儲存格樣式判斷是否為日期格式
  function dateStyles(book) {
    const doc = book.doc('xl/styles.xml');
    const custom = {};
    const nf = doc.getElementsByTagNameNS(NS, 'numFmts')[0];
    if (nf) for (const f of kids(nf, 'numFmt')) custom[f.getAttribute('numFmtId')] = f.getAttribute('formatCode');
    const xfs = kids(doc.getElementsByTagNameNS(NS, 'cellXfs')[0], 'xf');
    return xfs.map((xf) => {
      const id = Number(xf.getAttribute('numFmtId') || 0);
      if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47)) return true;
      const code = custom[id] && custom[id].replace(/"[^"]*"|\[[^\]]*\]/g, '');
      return !!code && /[ymd]/i.test(code) && !/%/.test(code);
    });
  }

  function read(bytes) {
    const book = new Store.Book(bytes);
    const name = book.sheets[PM.SHEET] ? PM.SHEET : Object.keys(book.sheets)[0];
    const { rows } = book.rowsOf(name);
    const header = rows.find((x) => x.r === 1);
    const byTitle = {};
    if (header) for (const [ci, c] of header.cells) { const t = String(book.cellValue(c) || '').trim(); if (t && !byTitle[t]) byTitle[t] = ci; }
    const idx = {};
    for (const col of PM.COLS) if (byTitle[col.title]) idx[col.key] = byTitle[col.title];
    if (!idx.code) throw new Error(`「${name}」工作表找不到「專案代號」欄`);
    const groups = []; // [{ item: ci, progress: ci, due: ci, status: ci }]
    for (let n = 1; ; n++) {
      const g = {};
      for (const t of PM.TRACK) if (byTitle[trackTitle(t, n)]) g[t.key] = byTitle[trackTitle(t, n)];
      if (!Object.keys(g).length) break;
      groups.push(g);
    }
    const cellVal = (row, ci, kind) => {
      const c = ci && row.cells.get(ci);
      if (!c) return '';
      let v = book.cellValue(c);
      if (v === '' || v == null) return '';
      if (kind === 'd' && typeof v === 'number') return serialToISO(v);
      return String(v);
    };
    const records = [];
    let lastRow = 1;
    for (const row of rows) {
      if (row.r < 2) continue;
      const rec = { _row: row.r, tracks: [] };
      let any = false;
      for (const col of PM.COLS) { rec[col.key] = cellVal(row, idx[col.key], col.kind); if (rec[col.key]) any = true; }
      for (const g of groups) {
        const t = {};
        for (const tc of PM.TRACK) t[tc.key] = cellVal(row, g[tc.key], tc.kind);
        t.status = normStatus(t.status);
        rec.tracks.push(t);
      }
      while (rec.tracks.length && !Object.values(rec.tracks[rec.tracks.length - 1]).some(Boolean)) rec.tracks.pop();
      if (rec.tracks.length) any = true;
      if (!rec.code && !rec.name) continue; // 只有格式、沒有專案的列不算資料
      rec._hash = JSON.stringify([PM.COLS.map((c) => rec[c.key]), rec.tracks]);
      records.push(rec);
      lastRow = Math.max(lastRow, row.r);
    }
    return { book, name, idx, groups, records, lastRow, header };
  }

  // 寫入:op = { type:'save', rec } 或 { type:'delete', rec };以 rec._row/_hash 確認雲端那一列沒被改過
  function apply(bytes, op) {
    const data = read(bytes);
    const { book, name, idx } = data;
    const { doc, sheetData, rows } = book.rowsOf(name);
    const rowByNum = new Map(rows.map((x) => [x.r, x]));
    const isDate = dateStyles(book);
    const path = book.sheets[name].path;
    book.touched.add(path);
    const rec = op.rec;
    let fresh = null;
    if (rec._row) {
      fresh = data.records.find((x) => x._row === rec._row);
      if (!fresh || fresh._hash !== rec._hash) throw new Error('雲端上的這一列已被修改或移動,請重新載入後再編輯');
    }

    if (op.type === 'delete') {
      if (!fresh) return book.toBytes();
      const del = rec._row;
      sheetData.removeChild(rowByNum.get(del).el);
      // 下方各列往上移一列
      for (const x of rows) {
        if (x.r <= del) continue;
        const nr = x.r - 1;
        x.el.setAttribute('r', String(nr));
        for (const c of kids(x.el, 'c')) c.setAttribute('r', /^[A-Z]+/.exec(c.getAttribute('r'))[0] + nr);
      }
      fixRanges(book, doc, name, data.lastRow - 1);
      return book.toBytes();
    }

    // 追蹤事項組數不夠 → 新增標題欄(樣式、欄寬比照第 1 組)
    while (data.groups.length < rec.tracks.length) addGroup(book, doc, data);
    // 進度狀態等新欄位:有值才建立(接在最後一欄之後,標題樣式比照對應的日期欄)
    // 第一次用到時,缺少的狀態欄依設定順序一次建立,欄位才會排在一起
    const extras = PM.COLS.filter((c) => c.extra);
    if (extras.some((c) => !idx[c.key] && String(rec[c.key] || '').trim())) {
      for (const col of extras) if (!idx[col.key]) idx[col.key] = addColumn(book, doc, data, col.title, idx[col.extra], 12);
    }

    let rowEl, r;
    if (fresh) { r = rec._row; rowEl = rowByNum.get(r).el; } else {
      // 新增:接在最後一筆資料之下,沿用上一列的儲存格樣式與列高
      r = data.lastRow + 1;
      const tpl = rowByNum.get(data.lastRow) || rowByNum.get(1);
      rowEl = tpl.el.cloneNode(false);
      rowEl.setAttribute('r', String(r));
      for (const c of kids(tpl.el, 'c')) {
        const nc = doc.createElementNS(NS, 'c');
        nc.setAttribute('r', idxToCol(refCol(c.getAttribute('r'))) + r);
        if (c.getAttribute('s') != null) nc.setAttribute('s', c.getAttribute('s'));
        rowEl.appendChild(nc);
      }
      const old = rowByNum.get(r);
      if (old) sheetData.replaceChild(rowEl, old.el);
      else sheetData.insertBefore(rowEl, rows.find((x) => x.r > r)?.el || null);
    }
    const tplRow = rowByNum.get(Math.max(2, Math.min(data.lastRow, r - 1))) || null;
    const setCell = (ci, val, kind, styleCol) => {
      if (!ci) return;
      const ref = idxToCol(ci) + r;
      let c = kids(rowEl, 'c').find((x) => x.getAttribute('r') === ref);
      if (!c) {
        c = doc.createElementNS(NS, 'c');
        c.setAttribute('r', ref);
        // 樣式:上一列同欄;新增的欄沒有 → 比照對應欄(例如現地施工比照製令開立)
        const t = (tplRow && tplRow.cells.get(ci)) || (styleCol && (kids(rowEl, 'c').find((x) => refCol(x.getAttribute('r')) === styleCol) || (tplRow && tplRow.cells.get(styleCol))));
        if (t && t.getAttribute('s') != null) c.setAttribute('s', t.getAttribute('s'));
        rowEl.insertBefore(c, kids(rowEl, 'c').find((x) => refCol(x.getAttribute('r')) > ci) || null);
      }
      while (c.firstChild) c.removeChild(c.firstChild);
      c.removeAttribute('t');
      const s = String(val ?? '').trim() === '' ? '' : String(val);
      if (!s) return;
      if (kind === 'd' && isoToSerial(s) != null) {
        const st = Number(c.getAttribute('s') || 0);
        if (!isDate[st]) c.setAttribute('s', book.fmtStyle(st, DATE_FMT));
        const v = doc.createElementNS(NS, 'v'); v.textContent = String(isoToSerial(s)); c.appendChild(v);
        return;
      }
      if (kind === 'n' && /^-?\d{1,15}(\.\d+)?$/.test(s.trim()) && !/^0\d/.test(s.trim())) {
        const v = doc.createElementNS(NS, 'v'); v.textContent = String(Number(s)); c.appendChild(v);
        return;
      }
      c.setAttribute('t', 'inlineStr');
      const is = doc.createElementNS(NS, 'is');
      const t = doc.createElementNS(NS, 't');
      if (/^\s|\s$|\n/.test(s)) t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      t.textContent = s;
      is.appendChild(t);
      c.appendChild(is);
    };
    // 只寫有變動的格子(新增時寫全部有值的欄位)
    const before = fresh || {};
    for (const col of PM.COLS) if (!fresh || (rec[col.key] ?? '') !== (before[col.key] ?? '')) setCell(idx[col.key], rec[col.key], col.kind, col.extra && idx[col.extra]);
    const nGroups = Math.max(rec.tracks.length, before.tracks ? before.tracks.length : 0);
    for (let i = 0; i < nGroups; i++) {
      const g = data.groups[i];
      if (!g) continue;
      const nt = rec.tracks[i] || {}, ot = (before.tracks && before.tracks[i]) || {};
      for (const tc of PM.TRACK) if (!fresh || (nt[tc.key] ?? '') !== (ot[tc.key] ?? '')) setCell(g[tc.key], nt[tc.key], tc.kind);
    }
    // 長文字時加高列高(不低於原本)
    let lines = 1;
    const widths = book.colWidths(doc);
    const texts = [...PM.COLS.map((c) => [idx[c.key], rec[c.key]]), ...rec.tracks.flatMap((t, i) => PM.TRACK.map((tc) => [data.groups[i] && data.groups[i][tc.key], t[tc.key]]))];
    for (const [ci, v] of texts) {
      if (!ci || !v) continue;
      const per = Math.max(4, Math.floor(((widths[ci] || {}).width || 9) * 1.1));
      let n = 0;
      for (const para of String(v).split('\n')) n += Math.max(1, Math.ceil([...para].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0) / per));
      lines = Math.max(lines, n);
    }
    const ht = Math.min(409, Math.max(Number(rowEl.getAttribute('ht')) || 0, lines * 14 + 8));
    rowEl.setAttribute('ht', String(ht));
    rowEl.setAttribute('customHeight', '1');
    fixRanges(book, doc, name, Math.max(data.lastRow, r));
    return book.toBytes();
  }

  function addGroup(book, doc, data) {
    const n = data.groups.length + 1;
    const first = data.groups[0] || {};
    const header = book.rowsOf(data.name).rows.find((x) => x.r === 1);
    const used = Math.max(PM.EXTRA_START - 1, ...header.cells.keys());
    const g = {};
    PM.TRACK.forEach((tc, k) => {
      const ci = used + 1 + k;
      g[tc.key] = ci;
      const src = first[tc.key] && header.cells.get(first[tc.key]);
      const c = doc.createElementNS(NS, 'c');
      c.setAttribute('r', idxToCol(ci) + 1);
      if (src && src.getAttribute('s') != null) c.setAttribute('s', src.getAttribute('s'));
      c.setAttribute('t', 'inlineStr');
      const is = doc.createElementNS(NS, 'is');
      const t = doc.createElementNS(NS, 't');
      t.textContent = trackTitle(tc, n);
      is.appendChild(t);
      c.appendChild(is);
      header.el.insertBefore(c, kids(header.el, 'c').find((x) => refCol(x.getAttribute('r')) > ci) || null);
      header.cells.set(ci, c);
      // 欄寬比照第 1 組
      const w = book.colWidths(doc)[first[tc.key]];
      if (w) book.ensureWidth(doc, ci, w.width);
    });
    data.groups.push(g);
  }

  // 在最後一欄之後(至少從 EXTRA_START)新增一個標題欄,回傳欄號
  function addColumn(book, doc, data, title, styleCol, width) {
    const header = book.rowsOf(data.name).rows.find((x) => x.r === 1);
    const ci = Math.max(PM.EXTRA_START - 1, ...header.cells.keys()) + 1;
    const src = styleCol && header.cells.get(styleCol);
    const c = doc.createElementNS(NS, 'c');
    c.setAttribute('r', idxToCol(ci) + 1);
    if (src && src.getAttribute('s') != null) c.setAttribute('s', src.getAttribute('s'));
    c.setAttribute('t', 'inlineStr');
    const is = doc.createElementNS(NS, 'is');
    const t = doc.createElementNS(NS, 't');
    t.textContent = title;
    is.appendChild(t);
    c.appendChild(is);
    header.el.insertBefore(c, kids(header.el, 'c').find((x) => refCol(x.getAttribute('r')) > ci) || null);
    if (width) book.ensureWidth(doc, ci, width);
    return ci;
  }

  // 更新 dimension / 篩選範圍
  function fixRanges(book, doc, name, lastRow) {
    const dim = doc.getElementsByTagNameNS(NS, 'dimension')[0];
    let maxCol = 1;
    for (const row of kids(doc.getElementsByTagNameNS(NS, 'sheetData')[0], 'row')) for (const c of kids(row, 'c')) maxCol = Math.max(maxCol, refCol(c.getAttribute('r')));
    if (dim) {
      const end = /:([A-Z]+)(\d+)$/.exec(dim.getAttribute('ref') || '');
      const endRow = end ? Math.max(+end[2], lastRow) : lastRow;
      dim.setAttribute('ref', `A1:${idxToCol(Math.max(maxCol, end ? colToIdx(end[1]) : 1))}${endRow}`);
    }
    const af = doc.getElementsByTagNameNS(NS, 'autoFilter')[0];
    if (af) {
      const m = /^([A-Z]+)1:([A-Z]+)\d+$/.exec(af.getAttribute('ref') || '');
      if (m) {
        af.setAttribute('ref', `${m[1]}1:${m[2]}${lastRow}`);
        for (const k of kids(af, 'sortState')) af.removeChild(k);
        book.setFilterName(name, `'${name.replace(/'/g, "''")}'!$${m[1]}$1:$${m[2]}$${lastRow}`);
      }
    }
  }

  // 年度:由專案代號推算(EQ-2260008 → 第 5~6 碼「26」→ 2026)
  function yearFromCode(code) {
    const m = /^[A-Za-z]+-?\d(\d{2})/.exec(String(code || '').trim());
    return m ? String(2000 + Number(m[1])) : '';
  }

  window.PmStore = { read, apply, yearFromCode, normStatus };
})();

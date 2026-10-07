// store.js
// 直接讀寫 Project Resume.xlsx 內部的 XML(fflate 解/壓縮)。
// 只重寫三張工作表(Project Resume / Remain Item / Choice)的資料列,
// 標題列、欄寬、凍結窗格、條件式格式、外部連結等其餘內容原封不動。
(function () {
  const CFG = window.APP_CONFIG;
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
  const EPOCH = Date.UTC(1899, 11, 30);
  const DAY = 86400000;
  const FMT_DT = 'yyyy/mm/dd hh:mm';
  const FMT_D = 'yyyy/mm/dd';
  const td = new TextDecoder('utf-8');
  const te = new TextEncoder();

  // ---------- 小工具 ----------
  const colToIdx = (s) => { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
  const idxToCol = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const splitRef = (ref) => { const m = /^([A-Z]+)(\d+)$/.exec(ref || ''); return m ? { col: colToIdx(m[1]), row: +m[2] } : null; };
  const kids = (el, name) => Array.from(el.childNodes).filter((n) => n.nodeType === 1 && (!name || n.localName === name));
  const kid = (el, name) => kids(el, name)[0] || null;
  const pad = (n) => String(n).padStart(2, '0');
  function parseXml(str) {
    const doc = new DOMParser().parseFromString(str, 'application/xml');
    if (doc.getElementsByTagName('parsererror')[0]) throw new Error('Excel 檔案 XML 解析失敗');
    return doc;
  }
  function richText(el) {
    let s = '';
    for (const n of kids(el)) {
      if (n.localName === 't') s += n.textContent;
      else if (n.localName === 'r') { const t = kid(n, 't'); if (t) s += t.textContent; }
    }
    return s;
  }
  function visualLen(str) { let n = 0; for (const ch of str) n += ch.charCodeAt(0) > 0x2e80 ? 2 : 1; return n; }

  // Excel 日期序號 ↔ 'YYYY-MM-DD' / 'YYYY-MM-DDTHH:MM'(以牆上時間計,不做時區換算)
  function serialToDT(serial, withTime) {
    const d = new Date(EPOCH + Math.round(Number(serial) * 1440) * 60000);
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    return withTime ? `${date}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : date;
  }
  function dtToSerial(str) {
    const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(String(str || '').trim());
    if (!m) return null;
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
    return Math.round(((ms - EPOCH) / DAY) * 1440) / 1440;
  }
  // 文字形式的日期也統一成表單格式
  function normDT(v, withTime) {
    if (typeof v === 'number') return serialToDT(v, withTime);
    const s = dtToSerial(v);
    return s == null ? String(v ?? '') : serialToDT(s, withTime);
  }

  function newId(prefix) {
    const t = new Date();
    return `${prefix}-${String(t.getFullYear()).slice(2)}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${Math.random().toString(36).slice(2, 6)}`;
  }
  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  // ---------- 活頁簿 ----------
  class Book {
    constructor(bytes) {
      this.files = fflate.unzipSync(new Uint8Array(bytes));
      this.docs = {};
      const wb = this.doc('xl/workbook.xml');
      const rels = this.doc('xl/_rels/workbook.xml.rels');
      const relMap = {};
      for (const r of rels.getElementsByTagName('Relationship')) {
        const t = r.getAttribute('Target');
        relMap[r.getAttribute('Id')] = t.startsWith('/') ? t.slice(1) : 'xl/' + t;
      }
      this.sheets = {};
      Array.from(wb.getElementsByTagNameNS(NS, 'sheet')).forEach((s, i) => {
        this.sheets[s.getAttribute('name')] = { path: relMap[s.getAttributeNS(NS_R, 'id')], index: i };
      });
      this.sst = [];
      if (this.files['xl/sharedStrings.xml']) {
        for (const si of kids(this.doc('xl/sharedStrings.xml').documentElement, 'si')) this.sst.push(richText(si));
      }
      this.touched = new Set();
    }
    doc(path) {
      if (!this.docs[path]) {
        const f = this.files[path];
        if (!f) throw new Error('Excel 檔案中找不到 ' + path);
        this.docs[path] = parseXml(td.decode(f));
      }
      return this.docs[path];
    }
    sheetDoc(name) {
      const s = this.sheets[name];
      if (!s) throw new Error(`Excel 檔案中找不到工作表「${name}」`);
      return this.doc(s.path);
    }
    cellValue(c) {
      const t = c.getAttribute('t');
      if (t === 'inlineStr') { const is = kid(c, 'is'); return is ? richText(is) : ''; }
      const v = kid(c, 'v');
      if (!v) return '';
      const raw = v.textContent;
      if (t === 's') return this.sst[+raw] ?? '';
      if (t === 'str' || t === 'e') return raw;
      if (t === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
    rowsOf(name) {
      const doc = this.sheetDoc(name);
      const sheetData = doc.getElementsByTagNameNS(NS, 'sheetData')[0];
      const rows = [];
      for (const el of kids(sheetData, 'row')) {
        const cells = new Map();
        for (const c of kids(el, 'c')) { const p = splitRef(c.getAttribute('r')); if (p) cells.set(p.col, c); }
        rows.push({ r: +el.getAttribute('r'), el, cells });
      }
      return { doc, sheetData, rows };
    }
    colWidths(doc) {
      const w = {};
      const cols = doc.getElementsByTagNameNS(NS, 'cols')[0];
      if (cols) for (const c of kids(cols, 'col')) for (let i = +c.getAttribute('min'); i <= +c.getAttribute('max'); i++) w[i] = { width: +c.getAttribute('width') || 9, style: c.getAttribute('style') };
      return w;
    }

    // 讀取「標題列 + 資料列」型的工作表 → { records, layout }
    readTable(name, cols) {
      const { doc, rows } = this.rowsOf(name);
      const header = rows.find((x) => x.r === 1);
      const byTitle = {};
      let maxCol = 0;
      if (header) for (const [ci, c] of header.cells) {
        const t = String(this.cellValue(c) || '').trim();
        if (t) { byTitle[t] = ci; maxCol = Math.max(maxCol, ci); }
      }
      const idx = {};
      const missing = [];
      for (const col of cols) {
        const ci = [col.title, ...(col.alt || [])].map((t) => byTitle[t]).find((x) => x);
        if (ci) idx[col.key] = ci; else missing.push(col);
      }
      for (const col of missing) idx[col.key] = ++maxCol; // 缺少的欄位接在最後
      const styles = {};
      const records = [];
      for (const row of rows) {
        if (row.r < 2) continue;
        const rec = { _row: row.r };
        let any = false;
        for (const col of cols) {
          const c = row.cells.get(idx[col.key]);
          if (!c) continue;
          if (styles[col.key] == null && c.getAttribute('s') != null) styles[col.key] = c.getAttribute('s');
          let v = this.cellValue(c);
          if (v === '' || v == null) continue;
          if (col.kind === 'dt') v = normDT(v, true);
          else if (col.kind === 'd') v = normDT(v, false);
          else if (col.kind === 'n') v = typeof v === 'number' ? v : (Number(v) || String(v));
          else v = typeof v === 'number' ? String(v) : String(v);
          rec[col.key] = v;
          any = true;
        }
        if (any) records.push(rec);
      }
      const headerStyle = header && header.cells.get(1) ? header.cells.get(1).getAttribute('s') : null;
      return { records, layout: { name, cols, idx, styles, missing, headerStyle, widths: this.colWidths(doc) } };
    }

    // 重寫資料列(第 2 列起)
    writeTable(layout, records, baseStyles) {
      const { name, cols, idx, widths } = layout;
      const { doc, sheetData, rows } = this.rowsOf(name);
      const header = rows.find((x) => x.r === 1);
      for (const row of rows) if (row.r >= 2) sheetData.removeChild(row.el);
      // 補上缺少的欄位標題
      if (header) for (const col of layout.missing) {
        const ci = idx[col.key];
        const old = header.cells.get(ci);
        const c = doc.createElementNS(NS, 'c');
        c.setAttribute('r', idxToCol(ci) + 1);
        if (layout.headerStyle != null) c.setAttribute('s', layout.headerStyle);
        setValue(doc, c, col.title);
        if (old) header.el.replaceChild(c, old);
        else header.el.insertBefore(c, kids(header.el, 'c').find((x) => splitRef(x.getAttribute('r')).col > ci) || null);
      }
      const order = [...cols].sort((a, b) => idx[a.key] - idx[b.key]);
      const styleOf = (col) => {
        const kind = col.kind === 'w' ? 'w' : col.kind;
        if (kind === 'dt' || kind === 'd') return this.fmtStyle(layout.styles[col.key] ?? baseStyles.c, kind === 'dt' ? FMT_DT : FMT_D);
        return layout.styles[col.key] ?? (kind === 'w' ? baseStyles.w : baseStyles.c);
      };
      const styleCache = {};
      for (const col of order) styleCache[col.key] = styleOf(col);
      const list = records.length ? records : [{}, {}]; // 沒資料時保留兩列空白格式列
      let lastRow = 1;
      list.forEach((rec, i) => {
        const r = i + 2;
        lastRow = r;
        const row = doc.createElementNS(NS, 'row');
        row.setAttribute('r', String(r));
        let lines = 1;
        for (const col of order) {
          const c = doc.createElementNS(NS, 'c');
          c.setAttribute('r', idxToCol(idx[col.key]) + r);
          if (styleCache[col.key] != null) c.setAttribute('s', styleCache[col.key]);
          const v = rec[col.key];
          if (col.kind === 'dt' || col.kind === 'd') {
            const s = dtToSerial(v);
            if (s != null) { const ve = doc.createElementNS(NS, 'v'); ve.textContent = String(s); c.appendChild(ve); }
            else setValue(doc, c, v);
          } else if (col.kind === 'n' && v !== '' && v != null && Number.isFinite(Number(v))) {
            const ve = doc.createElementNS(NS, 'v'); ve.textContent = String(Number(v)); c.appendChild(ve);
          } else setValue(doc, c, v);
          if (v && (col.kind === 'w' || col.kind === 'c')) {
            const per = Math.max(4, Math.floor(((widths[idx[col.key]] || {}).width || 9) * 1.15));
            let n = 0;
            for (const para of String(v).split('\n')) n += Math.max(1, Math.ceil(visualLen(para) / per));
            lines = Math.max(lines, n);
          }
          row.appendChild(c);
        }
        const ht = Math.min(409, Math.max(30, lines * 14 + 8));
        row.setAttribute('ht', String(ht));
        row.setAttribute('customHeight', '1');
        sheetData.appendChild(row);
      });
      for (const col of cols) if (col.kind === 'dt') this.ensureWidth(doc, idx[col.key], 17);
      const lastCol = idxToCol(Math.max(...cols.map((c) => idx[c.key]), ...(header ? [...header.cells.keys()] : [1])));
      const dim = doc.getElementsByTagNameNS(NS, 'dimension')[0];
      if (dim) dim.setAttribute('ref', `A1:${lastCol}${lastRow}`);
      const af = doc.getElementsByTagNameNS(NS, 'autoFilter')[0];
      if (af) {
        af.setAttribute('ref', `A1:${lastCol}${lastRow}`);
        for (const k of kids(af, 'sortState')) af.removeChild(k);
        this.setFilterName(name, `'${name.replace(/'/g, "''")}'!$A$1:$${lastCol}$${lastRow}`);
      }
      this.touched.add(this.sheets[name].path);
    }

    // 欄寬至少 min(日期時間欄太窄時 Excel 會顯示 ####);必要時把 <col> 範圍拆開
    ensureWidth(doc, ci, min) {
      const cols = doc.getElementsByTagNameNS(NS, 'cols')[0];
      if (!cols) return;
      const hit = kids(cols, 'col').find((c) => +c.getAttribute('min') <= ci && +c.getAttribute('max') >= ci);
      if (hit && (+hit.getAttribute('width') || 0) >= min) return;
      if (hit) {
        const lo = +hit.getAttribute('min'), hi = +hit.getAttribute('max');
        const part = (a, b) => { const c = hit.cloneNode(false); c.setAttribute('min', a); c.setAttribute('max', b); return c; };
        const mid = part(ci, ci);
        mid.setAttribute('width', String(min));
        mid.setAttribute('customWidth', '1');
        if (lo < ci) cols.insertBefore(part(lo, ci - 1), hit);
        cols.insertBefore(mid, hit);
        if (hi > ci) cols.insertBefore(part(ci + 1, hi), hit);
        cols.removeChild(hit);
      } else {
        const c = doc.createElementNS(NS, 'col');
        c.setAttribute('min', ci); c.setAttribute('max', ci); c.setAttribute('width', String(min)); c.setAttribute('customWidth', '1');
        cols.insertBefore(c, kids(cols, 'col').find((x) => +x.getAttribute('min') > ci) || null);
      }
    }

    setFilterName(name, ref) {
      const wb = this.doc('xl/workbook.xml');
      const idx = String(this.sheets[name].index);
      for (const d of wb.getElementsByTagNameNS(NS, 'definedName')) {
        if (d.getAttribute('name') === '_xlnm._FilterDatabase' && d.getAttribute('localSheetId') === idx) {
          d.textContent = ref;
          this.touched.add('xl/workbook.xml');
        }
      }
    }

    // 以 base 樣式為底、套用指定數字格式的儲存格樣式(不存在就新增)
    fmtStyle(base, code) {
      const doc = this.doc('xl/styles.xml');
      const root = doc.documentElement;
      let numFmts = kid(root, 'numFmts');
      let fmtId = null;
      if (numFmts) for (const f of kids(numFmts, 'numFmt')) if (f.getAttribute('formatCode') === code) fmtId = f.getAttribute('numFmtId');
      if (fmtId == null) {
        if (!numFmts) { numFmts = doc.createElementNS(NS, 'numFmts'); root.insertBefore(numFmts, root.firstElementChild); }
        const used = kids(numFmts, 'numFmt').map((f) => +f.getAttribute('numFmtId'));
        fmtId = String(Math.max(175, ...used) + 1);
        const f = doc.createElementNS(NS, 'numFmt');
        f.setAttribute('numFmtId', fmtId);
        f.setAttribute('formatCode', code);
        numFmts.appendChild(f);
        numFmts.setAttribute('count', String(kids(numFmts, 'numFmt').length));
        this.touched.add('xl/styles.xml');
      }
      const cellXfs = kid(root, 'cellXfs');
      const xfs = kids(cellXfs, 'xf');
      const src = xfs[Number(base) || 0];
      if (src.getAttribute('numFmtId') === fmtId) return String(Number(base) || 0);
      const want = (xf) => ['fontId', 'fillId', 'borderId'].every((a) => xf.getAttribute(a) === src.getAttribute(a)) &&
        xf.getAttribute('numFmtId') === fmtId;
      const found = xfs.findIndex(want);
      if (found >= 0) return String(found);
      const xf = src.cloneNode(true);
      xf.setAttribute('numFmtId', fmtId);
      xf.setAttribute('applyNumberFormat', '1');
      xf.setAttribute('applyAlignment', '1');
      let al = kid(xf, 'alignment');
      if (!al) { al = doc.createElementNS(NS, 'alignment'); xf.appendChild(al); }
      al.setAttribute('horizontal', 'center');
      al.setAttribute('vertical', 'center');
      cellXfs.appendChild(xf);
      cellXfs.setAttribute('count', String(xfs.length + 1));
      this.touched.add('xl/styles.xml');
      return String(xfs.length);
    }

    // ---------- Choice:下拉選單清單 ----------
    readChoice() {
      const { rows } = this.rowsOf(CFG.CHOICE_SHEET);
      const header = rows.find((x) => x.r === 1);
      const colOf = {};
      if (header) for (const [ci, c] of header.cells) {
        const key = CFG.CHOICE_COLS[String(this.cellValue(c) || '').trim()];
        if (key) colOf[key] = ci;
      }
      const lists = { projects: [] };
      for (const key of Object.values(CFG.CHOICE_COLS)) if (key !== 'code' && key !== 'name') lists[key] = [];
      for (const row of rows) {
        if (row.r < 2) continue;
        const get = (key) => { const c = colOf[key] && row.cells.get(colOf[key]); const v = c ? this.cellValue(c) : ''; return String(v ?? '').trim(); };
        const code = get('code'), name = get('name');
        if (code || name) lists.projects.push({ code, name });
        for (const key of Object.keys(lists)) {
          if (key === 'projects') continue;
          const v = get(key);
          if (v && !lists[key].includes(v)) lists[key].push(v);
        }
      }
      return { lists, colOf };
    }

    writeChoice(choice) {
      const { lists, colOf } = choice;
      const { doc, sheetData, rows } = this.rowsOf(CFG.CHOICE_SHEET);
      const widths = this.colWidths(doc);
      for (const row of rows) if (row.r >= 2) sheetData.removeChild(row.el);
      const colLists = [];
      if (colOf.code) colLists.push([colOf.code, lists.projects.map((p) => p.code)]);
      if (colOf.name) colLists.push([colOf.name, lists.projects.map((p) => p.name)]);
      for (const [key, ci] of Object.entries(colOf)) if (key !== 'code' && key !== 'name' && lists[key]) colLists.push([ci, lists[key]]);
      colLists.sort((a, b) => a[0] - b[0]);
      const n = Math.max(0, ...colLists.map(([, l]) => l.length));
      for (let i = 0; i < n; i++) {
        const r = i + 2;
        const row = doc.createElementNS(NS, 'row');
        row.setAttribute('r', String(r));
        for (const [ci, list] of colLists) {
          const v = list[i];
          if (v == null || v === '') continue;
          const c = doc.createElementNS(NS, 'c');
          c.setAttribute('r', idxToCol(ci) + r);
          if (widths[ci] && widths[ci].style != null) c.setAttribute('s', widths[ci].style);
          setValue(doc, c, v);
          row.appendChild(c);
        }
        sheetData.appendChild(row);
      }
      const dim = doc.getElementsByTagNameNS(NS, 'dimension')[0];
      if (dim) dim.setAttribute('ref', `A1:${idxToCol(Math.max(1, ...Object.values(colOf)))}${n + 1}`);
      this.touched.add(this.sheets[CFG.CHOICE_SHEET].path);
    }

    toBytes() {
      for (const path of this.touched) {
        const xml = new XMLSerializer().serializeToString(this.docs[path]).replace(/^<\?xml[^>]*\?>\s*/, '');
        this.files[path] = te.encode(XML_DECL + xml);
      }
      return fflate.zipSync(this.files, { level: 6 });
    }
  }

  function setValue(doc, c, val) {
    if (val === '' || val == null) return;
    c.setAttribute('t', 'inlineStr');
    const is = doc.createElementNS(NS, 'is');
    const t = doc.createElementNS(NS, 't');
    const str = String(val);
    if (/^\s|\s$|\n/.test(str)) t.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    t.textContent = str;
    is.appendChild(t);
    c.appendChild(is);
  }

  // ---------- 履歷:列 ↔ 履歷(一份履歷含多個問題) ----------
  const RC = CFG.RESUME_COLS;
  const HEAD_KEYS = RC.filter((c) => !c.prob && c.key !== 'id').map((c) => c.key);
  const PROB_KEYS = RC.filter((c) => c.prob).map((c) => c.key);
  const tempId = (rec, prefix) => {
    const { _row, ...vals } = rec;
    return `${prefix}${_row}-${hash(JSON.stringify(vals))}`;
  };

  function groupResumes(rows) {
    const map = new Map();
    for (const rec of rows) {
      const id = rec.id || tempId(rec, 'T');
      let r = map.get(id);
      if (!r) {
        r = { id, saved: !!rec.id, problems: [] };
        for (const k of HEAD_KEYS) r[k] = '';
        map.set(id, r);
      }
      for (const k of HEAD_KEYS) if ((r[k] === '' || r[k] == null) && rec[k] != null) r[k] = rec[k];
      const p = {};
      for (const k of PROB_KEYS) p[k] = rec[k] ?? '';
      r.problems.push(p);
    }
    return [...map.values()];
  }

  function ungroupResumes(resumes) {
    const rows = [];
    for (const r of resumes) {
      if (!r.saved) { r.id = newId('PR'); r.saved = true; }
      const probs = r.problems.length ? r.problems : [{}];
      probs.forEach((p, i) => {
        const rec = { id: r.id };
        for (const col of RC) {
          if (col.prob) rec[col.key] = p[col.key] ?? '';
          else if (col.key !== 'id' && (!col.head || i === 0)) rec[col.key] = r[col.key] ?? '';
        }
        rows.push(rec);
      });
    }
    return rows;
  }

  function prepRemains(rows) {
    return rows.map((rec) => {
      const { _row, ...vals } = rec;
      return { ...vals, id: rec.id || tempId(rec, 'T'), saved: !!rec.id };
    });
  }

  // 讀取全部資料
  function readAll(bytes) {
    const book = new Book(bytes);
    const pr = book.readTable(CFG.RESUME_SHEET, CFG.RESUME_COLS);
    const rm = book.readTable(CFG.REMAIN_SHEET, CFG.REMAIN_COLS);
    const choice = book.readChoice();
    return {
      book, prLayout: pr.layout, rmLayout: rm.layout, choice,
      resumes: groupResumes(pr.records), remains: prepRemains(rm.records),
      changed: new Set(),
    };
  }

  // 依 data.changed('resume' / 'remain' / 'choice')寫回,回傳新的 xlsx 位元組
  function writeAll(data) {
    const { book } = data;
    // 基本樣式:置中與換行文字(取自 Project Resume 第一筆資料的格式)
    const s = data.prLayout.styles;
    const base = { c: s.code ?? s.plant ?? null, w: s.work ?? s.problem ?? s.name ?? null };
    if (data.changed.has('resume')) book.writeTable(data.prLayout, ungroupResumes(data.resumes), base);
    if (data.changed.has('remain')) {
      for (const r of data.remains) if (!r.saved) { r.id = newId('RI'); r.saved = true; }
      book.writeTable(data.rmLayout, data.remains, base);
    }
    if (data.changed.has('choice')) book.writeChoice(data.choice);
    return book.toBytes();
  }

  window.Store = { Book, readAll, writeAll, newId, serialToDT, dtToSerial, normDT };
})();

// worklist-io.js - ATK工作項目(Work List.xlsm)讀寫
// 讀取:以 Store.Book 解析「List」A~I 欄、「資料庫」(已結案)、「人員」(人員下拉名單)、「權限」(免密碼)
// 寫入:只對 List 工作表做「最小幅度」修改(改動到的儲存格),保留 VBA 巨集與內嵌的 Schedule 圖表;
//       資料庫 / 人員 / 權限工作表整張重寫(不存在時自動新增)
(function () {
  const W = window.APP_CONFIG.WORK;
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const REL_NS_URI = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const WORKSHEET_CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';
  const LIST_COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
  const DAY_MS = 86400000;

  function serialToISODate(serial) {
    if (serial === null || serial === undefined || serial === '' || !Number.isFinite(Number(serial))) return '';
    const d = new Date(EXCEL_EPOCH_UTC + Number(serial) * DAY_MS);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  function isoDateToSerial(iso) {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return null;
    return Math.round((Date.UTC(y, m - 1, d) - EXCEL_EPOCH_UTC) / DAY_MS);
  }
  const escapeXml = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const idxToCol = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const colLetterToIndex = (letters) => { let idx = 0; for (const ch of letters) idx = idx * 26 + (ch.charCodeAt(0) - 64); return idx; };

  // ---------- 讀取 ----------

  // 工作表 → { get(ref), lastRow };工作表不存在回傳 null
  function grid(book, name) {
    if (!book.sheets[name]) return null;
    const { rows } = book.rowsOf(name);
    const m = new Map();
    let lastRow = 0;
    for (const row of rows) {
      for (const [ci, c] of row.cells) {
        const v = book.cellValue(c);
        if (v !== '' && v != null) { m.set(idxToCol(ci) + row.r, v); lastRow = Math.max(lastRow, row.r); }
      }
    }
    return { get: (ref) => m.get(ref), lastRow };
  }
  const str = (v) => (v != null ? String(v) : '');

  function parseRows(g) {
    const rows = [];
    for (let r = W.MIN_ROW; r <= W.MAX_ROW; r++) {
      const get = (col) => g.get(col + r);
      const hasAny = ['A', 'B', 'C', 'E', 'F', 'G', 'H', 'I'].some((c) => get(c) !== undefined);
      if (!hasAny) continue;
      const d = get('D');
      rows.push({
        row: r, item: str(get('A')), start: serialToISODate(get('B')), end: serialToISODate(get('C')),
        duration: d !== undefined && Number.isFinite(Number(d)) ? Number(d) : null,
        status: str(get('E')), hw: str(get('F')), sw: str(get('G')), note: str(get('H')), plan: str(get('I')),
      });
    }
    return rows;
  }

  const ARCHIVE_SHEET = '資料庫';
  const ARCHIVE_HEADERS = ['工作項目', '計畫開始時間', '計畫結束時間', '工時(天)', '狀態', '硬體作業人員', '軟體/電控作業人員', '備註', '預計工作', '結案日期'];

  function parseArchive(g) {
    if (!g) return [];
    // 依表頭找欄位,相容舊版資料庫(I 欄是結案日期、沒有預計工作)
    const colOf = (name) => 'ABCDEFGHIJKL'.split('').find((c) => g.get(c + 1) === name);
    const closedCol = colOf('結案日期') || 'I';
    const planCol = colOf('預計工作');
    const out = [];
    for (let r = 2; r <= g.lastRow; r++) {
      const get = (col) => g.get(col + r);
      if (['A', 'B', 'C', 'E'].every((c) => get(c) === undefined)) continue;
      const start = serialToISODate(get('B'));
      const end = serialToISODate(get('C'));
      const s = isoDateToSerial(start), e = isoDateToSerial(end);
      out.push({
        item: str(get('A')), start, end, duration: s != null && e != null ? e - s + 1 : null,
        status: get('E') != null ? String(get('E')) : '完工',
        hw: str(get('F')), sw: str(get('G')), note: str(get('H')),
        plan: planCol ? str(get(planCol)) : '', closed: serialToISODate(get(closedCol)),
      });
    }
    return out;
  }

  const ROSTER_SHEET = '人員';
  const ROSTER_HEADERS = ['硬體作業人員', '軟體/電控作業人員'];
  // 回傳 { hw, sw };工作表不存在時回傳 null(由呼叫端以現有資料產生初始名單)
  function parseRoster(g) {
    if (!g) return null;
    const col = (letter) => {
      const out = [];
      for (let r = 2; r <= g.lastRow; r++) {
        const name = str(g.get(letter + r)).trim();
        if (name && !out.includes(name)) out.push(name);
      }
      return out;
    };
    return { hw: col('A'), sw: col('B') };
  }

  const PERM_SHEET = '權限';
  const PERM_CHECKED = '☑免密碼';
  const PERM_UNCHECKED = '☐免密碼';
  function parsePermissions(g) {
    if (!g) return [];
    const out = [];
    for (let r = 2; r <= g.lastRow; r++) {
      const email = str(g.get('A' + r)).trim().toLowerCase();
      if (!email) continue;
      out.push({ email, noPassword: /^(☑|✅|✔|y|是|true|1)/i.test(str(g.get('B' + r)).trim()) });
    }
    return out;
  }

  function parse(bytes) {
    const book = new Store.Book(bytes);
    const list = grid(book, W.SHEET);
    if (!list) throw new Error(`Work List 檔案中找不到工作表「${W.SHEET}」`);
    return {
      rows: parseRows(list),
      archive: parseArchive(grid(book, ARCHIVE_SHEET)),
      roster: parseRoster(grid(book, ROSTER_SHEET)),
      permissions: parsePermissions(grid(book, PERM_SHEET)),
      headers: LIST_COLS.map((c) => str(list.get(c + 1))),
    };
  }

  // ---------- 寫入(List 工作表最小幅度 patch) ----------

  function findInsertAnchor(rowEl, colLetter) {
    const targetIdx = colLetterToIndex(colLetter);
    for (const el of Array.from(rowEl.children).filter((x) => x.localName === 'c')) {
      const m = (el.getAttribute('r') || '').match(/^([A-Z]+)(\d+)$/);
      if (m && colLetterToIndex(m[1]) > targetIdx) return el;
    }
    return null;
  }
  function getOrCreateCell(doc, rowEl, colLetter, rowNum, fallbackStyle) {
    const ref = `${colLetter}${rowNum}`;
    let cell = Array.from(rowEl.children).find((el) => el.localName === 'c' && el.getAttribute('r') === ref);
    if (cell) return cell;
    cell = doc.createElementNS(NS, 'c');
    cell.setAttribute('r', ref);
    if (fallbackStyle) cell.setAttribute('s', fallbackStyle);
    const anchor = findInsertAnchor(rowEl, colLetter);
    if (anchor) rowEl.insertBefore(cell, anchor); else rowEl.appendChild(cell);
    return cell;
  }
  // 移除公式與既有內容,改為 inlineStr,避免動到 sharedStrings.xml
  function setCellInlineString(doc, cell, text) {
    Array.from(cell.children).forEach((child) => cell.removeChild(child));
    if (text === '' || text == null) { cell.removeAttribute('t'); return; }
    cell.setAttribute('t', 'inlineStr');
    const isEl = doc.createElementNS(NS, 'is');
    const tEl = doc.createElementNS(NS, 't');
    tEl.textContent = String(text);
    isEl.appendChild(tEl);
    cell.appendChild(isEl);
  }
  function setCellNumber(doc, cell, num) {
    Array.from(cell.children).forEach((child) => { if (child.localName === 'v' || child.localName === 'is') cell.removeChild(child); });
    cell.removeAttribute('t');
    if (num === null || num === undefined || Number.isNaN(num)) return;
    const vEl = doc.createElementNS(NS, 'v');
    vEl.textContent = String(num);
    cell.appendChild(vEl);
  }
  // 保留 <f>,只更新 <v>
  function setFormulaCellValue(doc, cell, numOrNull) {
    let vEl = Array.from(cell.children).find((c) => c.localName === 'v');
    if (!vEl) { vEl = doc.createElementNS(NS, 'v'); cell.appendChild(vEl); }
    if (numOrNull === null || numOrNull === undefined || Number.isNaN(numOrNull)) { cell.setAttribute('t', 'str'); vEl.textContent = ''; }
    else { cell.removeAttribute('t'); vEl.textContent = String(numOrNull); }
  }
  // D 欄工時為共用公式:D2 的主公式 ref 擴充到涵蓋所有列,其他列補上共用公式參照
  function ensureDurationFormula(doc, rowEl, rowNum) {
    const dCell = getOrCreateCell(doc, rowEl, 'D', rowNum, '3');
    let fEl = Array.from(dCell.children).find((c) => c.localName === 'f');
    if (rowNum === W.MIN_ROW) {
      if (fEl) {
        const m = (fEl.getAttribute('ref') || '').match(/^D\d+:D(\d+)$/);
        if (W.MAX_ROW > (m ? Number(m[1]) : W.MIN_ROW)) fEl.setAttribute('ref', `D${W.MIN_ROW}:D${W.MAX_ROW}`);
      }
      return dCell;
    }
    if (!fEl) {
      fEl = doc.createElementNS(NS, 'f');
      fEl.setAttribute('t', 'shared');
      fEl.setAttribute('si', '0');
      dCell.insertBefore(fEl, dCell.firstChild);
    }
    return dCell;
  }
  // I 欄存「預計工作」:補上表頭,並把原本與 I~T 共用的窄欄寬獨立出來加寬
  function ensurePlanColumn(doc, headerRow) {
    if (headerRow) {
      const cell = getOrCreateCell(doc, headerRow, 'I', 1, '5');
      if (!Array.from(cell.children).some((c) => c.localName === 'is' || c.localName === 'v')) {
        cell.setAttribute('s', '5');
        setCellInlineString(doc, cell, '預計工作');
      }
    }
    const colsEl = doc.getElementsByTagNameNS(NS, 'cols')[0];
    if (!colsEl) return;
    const wide = Array.from(colsEl.children).find((c) => c.localName === 'col' && c.getAttribute('min') === '9' && c.getAttribute('max') === '20');
    if (!wide) return;
    const iCol = wide.cloneNode(false);
    iCol.setAttribute('max', '9');
    iCol.setAttribute('width', '38');
    iCol.setAttribute('customWidth', '1');
    wide.setAttribute('min', '10');
    colsEl.insertBefore(iCol, wide);
  }

  const dec = (u8) => new TextDecoder('utf-8').decode(u8);
  const enc = (s) => new TextEncoder().encode(s);

  // 找出(或新增)工作表在 zip 內的路徑;新增時一併更新 workbook.xml / workbook.xml.rels / [Content_Types].xml
  function ensureSheetPath(zip, sheetName) {
    const wbXml = dec(zip['xl/workbook.xml']);
    const relsXml = dec(zip['xl/_rels/workbook.xml.rels']);
    const sheetTag = (wbXml.match(/<sheet\b[^>]*>/g) || []).find((t) => t.includes(`name="${sheetName}"`));
    if (sheetTag) {
      const rid = (sheetTag.match(/r:id="([^"]+)"/) || [])[1];
      const relTag = (relsXml.match(/<Relationship\b[^>]*>/g) || []).find((t) => t.includes(`Id="${rid}"`));
      const target = relTag && (relTag.match(/Target="([^"]+)"/) || [])[1];
      if (target) return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    }
    let n = 2;
    while (zip[`xl/worksheets/sheet${n}.xml`]) n++;
    const path = `xl/worksheets/sheet${n}.xml`;
    const maxSheetId = Math.max(0, ...[...wbXml.matchAll(/sheetId="(\d+)"/g)].map((m) => Number(m[1])));
    const maxRid = Math.max(0, ...[...relsXml.matchAll(/\bId="rId(\d+)"/g)].map((m) => Number(m[1])));
    const rid = `rId${maxRid + 1}`;
    zip['xl/workbook.xml'] = enc(wbXml.replace('</sheets>', `<sheet name="${sheetName}" sheetId="${maxSheetId + 1}" r:id="${rid}"/></sheets>`));
    zip['xl/_rels/workbook.xml.rels'] = enc(relsXml.replace('</Relationships>',
      `<Relationship Id="${rid}" Type="${REL_NS_URI}/worksheet" Target="worksheets/sheet${n}.xml"/></Relationships>`));
    zip['[Content_Types].xml'] = enc(dec(zip['[Content_Types].xml']).replace('</Types>', `<Override PartName="/${path}" ContentType="${WORKSHEET_CT}"/></Types>`));
    return path;
  }

  const textCell = (ref, text, style) =>
    text === '' || text == null ? '' : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
  const numCell = (ref, num, style) => (num == null || Number.isNaN(num) ? '' : `<c r="${ref}" s="${style}"><v>${num}</v></c>`);
  const sheetXml = (inner) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${NS}" xmlns:r="${REL_NS_URI}">${inner}</worksheet>`;

  function archiveSheetXml(archiveRows, headers) {
    const L = 'ABCDEFGHIJ';
    const headerRow = `<row r="1">${headers.map((t, i) => textCell(`${L[i]}1`, t, 5)).join('')}</row>`;
    const body = archiveRows.map((a, i) => {
      const r = i + 2;
      const s = isoDateToSerial(a.start), e = isoDateToSerial(a.end);
      return `<row r="${r}">` + textCell(`A${r}`, a.item, 2) + numCell(`B${r}`, s, 11) + numCell(`C${r}`, e, 11) +
        numCell(`D${r}`, s != null && e != null ? e - s + 1 : null, 3) + textCell(`E${r}`, a.status || '完工', 3) +
        textCell(`F${r}`, a.hw, 2) + textCell(`G${r}`, a.sw, 2) + textCell(`H${r}`, a.note, 3) + textCell(`I${r}`, a.plan, 2) +
        numCell(`J${r}`, isoDateToSerial(a.closed), 11) + `</row>`;
    }).join('');
    const cols = [43, 19, 19, 10, 12, 30, 30, 30, 38, 19].map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    return sheetXml(`<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
      `<sheetFormatPr defaultRowHeight="20"/><cols>${cols}</cols><sheetData>${headerRow}${body}</sheetData>`);
  }
  function rosterSheetXml(roster) {
    let body = '';
    for (let i = 0; i < Math.max(roster.hw.length, roster.sw.length); i++) {
      const r = i + 2;
      body += `<row r="${r}">${textCell(`A${r}`, roster.hw[i], 2)}${textCell(`B${r}`, roster.sw[i], 2)}</row>`;
    }
    return sheetXml(`<sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="20"/>` +
      `<cols><col min="1" max="2" width="26" customWidth="1"/></cols>` +
      `<sheetData><row r="1">${textCell('A1', ROSTER_HEADERS[0], 5)}${textCell('B1', ROSTER_HEADERS[1], 5)}</row>${body}</sheetData>`);
  }

  /**
   * 把編輯後的資料(rows 已指定 row 列號)、資料庫與人員名單套用到原始 xlsm,回傳新的檔案 bytes
   */
  function buildPatched(originalBytes, rows, archiveRows, roster) {
    const zip = fflate.unzipSync(new Uint8Array(originalBytes));
    const listPath = ensureSheetPath(zip, W.SHEET);
    if (!zip[listPath]) throw new Error('原始檔案缺少工作表 XML,無法寫入');
    const doc = new DOMParser().parseFromString(dec(zip[listPath]), 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('工作表 XML 解析失敗');

    const sheetData = doc.getElementsByTagNameNS(NS, 'sheetData')[0];
    const rowByNum = new Map();
    Array.from(sheetData.children).forEach((el) => { if (el.localName === 'row') rowByNum.set(Number(el.getAttribute('r')), el); });
    const byRowNum = new Map(rows.map((r) => [r.row, r]));

    for (let r = W.MIN_ROW; r <= W.MAX_ROW; r++) {
      const rowEl = rowByNum.get(r);
      if (!rowEl) continue; // 範本已預留 2..MAX_ROW
      const data = byRowNum.get(r) || {};
      setCellInlineString(doc, getOrCreateCell(doc, rowEl, 'A', r, null), data.item || '');
      setCellNumber(doc, getOrCreateCell(doc, rowEl, 'B', r, '11'), isoDateToSerial(data.start));
      setCellNumber(doc, getOrCreateCell(doc, rowEl, 'C', r, '11'), isoDateToSerial(data.end));
      const s = isoDateToSerial(data.start), e = isoDateToSerial(data.end);
      setFormulaCellValue(doc, ensureDurationFormula(doc, rowEl, r), s != null && e != null ? e - s + 1 : null);
      setCellInlineString(doc, getOrCreateCell(doc, rowEl, 'E', r, '3'), data.status || '');
      setCellInlineString(doc, getOrCreateCell(doc, rowEl, 'F', r, '3'), data.hw || '');
      setCellInlineString(doc, getOrCreateCell(doc, rowEl, 'G', r, '3'), data.sw || '');
      setCellInlineString(doc, getOrCreateCell(doc, rowEl, 'H', r, '3'), data.note || '');
      setCellInlineString(doc, getOrCreateCell(doc, rowEl, 'I', r, '3'), data.plan || '');
    }
    ensurePlanColumn(doc, rowByNum.get(1));
    zip[listPath] = enc(new XMLSerializer().serializeToString(doc));

    if (archiveRows) {
      let headers = ARCHIVE_HEADERS;
      try { const hs = parse(originalBytes).headers; if (hs.every(Boolean)) headers = [...hs, '預計工作', '結案日期']; } catch { /* 用預設表頭 */ }
      zip[ensureSheetPath(zip, ARCHIVE_SHEET)] = enc(archiveSheetXml(archiveRows, headers));
    }
    if (roster) zip[ensureSheetPath(zip, ROSTER_SHEET)] = enc(rosterSheetXml(roster));
    return fflate.zipSync(zip, { level: 6 });
  }

  // 只改寫「權限」工作表,其餘內容(List、資料庫、VBA、圖表)原封不動
  function buildPermissions(originalBytes, entries) {
    const zip = fflate.unzipSync(new Uint8Array(originalBytes));
    const body = entries.map((e, i) => {
      const r = i + 2;
      return `<row r="${r}">${textCell(`A${r}`, e.email, 2)}${textCell(`B${r}`, e.noPassword ? PERM_CHECKED : PERM_UNCHECKED, 2)}</row>`;
    }).join('');
    zip[ensureSheetPath(zip, PERM_SHEET)] = enc(sheetXml(`<sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="20"/>` +
      `<cols><col min="1" max="1" width="40" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/></cols>` +
      `<sheetData><row r="1">${textCell('A1', '人員', 5)}</row>${body}</sheetData>`));
    return fflate.zipSync(zip, { level: 6 });
  }

  window.WorkIO = { parse, buildPatched, buildPermissions, serialToISODate, isoDateToSerial, MIME: 'application/vnd.ms-excel.sheet.macroEnabled.12' };
})();

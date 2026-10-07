// export.js — 把殘件項目匯出成獨立的 .xlsx(欄位同「Remain Item」工作表)
(function () {
  const CFG = window.APP_CONFIG;
  const te = new TextEncoder();
  const escXml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const idxToCol = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const vlen = (s) => { let n = 0; for (const ch of s) n += ch.charCodeAt(0) > 0x2e80 ? 2 : 1; return n; };

  // 匯出的欄位(不含內部用的「來源履歷」「殘件編號」);附件只列檔名與連結
  const COLS = [
    ['date', 12, 'd'], ['code', 14, 'c'], ['name', 22, 'w'], ['problem', 30, 'w'], ['cause', 24, 'w'], ['temp', 22, 'w'],
    ['perm', 24, 'w'], ['ecn', 8, 'c'], ['dept', 11, 'c'], ['owner', 11, 'c'], ['due', 12, 'd'], ['progress', 26, 'w'],
    ['status', 9, 'c'], ['note', 20, 'w'], ['files', 34, 'w'],
  ];
  const EPOCH = Date.UTC(1899, 11, 30);
  function serial(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - EPOCH) / 86400000) : null;
  }

  function build(items, title) {
    const titles = Object.fromEntries(CFG.REMAIN_COLS.map((c) => [c.key, c.title]));
    const last = idxToCol(COLS.length);
    let rows = `<row r="1" ht="22" customHeight="1"><c r="A1" s="5" t="inlineStr"><is><t>${escXml(title)}</t></is></c></row>`;
    rows += '<row r="2" ht="30" customHeight="1">' + COLS.map(([k], i) =>
      `<c r="${idxToCol(i + 1)}2" s="1" t="inlineStr"><is><t>${escXml(titles[k])}</t></is></c>`).join('') + '</row>';
    items.forEach((it, n) => {
      const r = n + 3;
      let lines = 1;
      const cells = COLS.map(([k, w, kind], i) => {
        const ref = idxToCol(i + 1) + r;
        let v = it[k] ?? '';
        if (k === 'files') v = String(v).split('\n').filter(Boolean).join('\n');
        if (kind === 'd') {
          const s = serial(v);
          return s != null ? `<c r="${ref}" s="3"><v>${s}</v></c>` : `<c r="${ref}" s="4"/>`;
        }
        if (v === '') return `<c r="${ref}" s="${kind === 'w' ? 2 : 4}"/>`;
        let n2 = 0;
        for (const p of String(v).split('\n')) n2 += Math.max(1, Math.ceil(vlen(p) / (w * 1.1)));
        lines = Math.max(lines, n2);
        return `<c r="${ref}" s="${kind === 'w' ? 2 : 4}" t="inlineStr"><is><t xml:space="preserve">${escXml(v)}</t></is></c>`;
      }).join('');
      rows += `<row r="${r}" ht="${Math.min(409, Math.max(20, lines * 15 + 5))}" customHeight="1">${cells}</row>`;
    });
    const lastRow = Math.max(2, items.length + 2);
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${last}${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="16.2"/><cols>${COLS.map(([, w], i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rows}</sheetData><autoFilter ref="A2:${last}${lastRow}"/>
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="landscape" fitToHeight="0"/></worksheet>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="176" formatCode="yyyy/mm/dd"/></numFmts>
<fonts count="3"><font><sz val="10"/><name val="微軟正黑體"/><family val="2"/><charset val="136"/></font><font><b/><sz val="10"/><name val="微軟正黑體"/><family val="2"/><charset val="136"/></font><font><b/><sz val="14"/><name val="微軟正黑體"/><family val="2"/><charset val="136"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color indexed="64"/></left><right style="thin"><color indexed="64"/></right><top style="thin"><color indexed="64"/></top><bottom style="thin"><color indexed="64"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="176" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const files = {
      '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
      '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Remain Item" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'Remain Item'!$A$2:$${last}$${lastRow}</definedName></definedNames></workbook>`,
      'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      'xl/worksheets/sheet1.xml': sheet,
      'xl/styles.xml': styles,
    };
    const out = {};
    for (const [k, v] of Object.entries(files)) out[k] = te.encode(v);
    return fflate.zipSync(out, { level: 6 });
  }

  window.Exporter = { build };
})();

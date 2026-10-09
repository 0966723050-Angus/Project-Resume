// gantt.js — 專案 Schedule 長條圖
// 先把整張圖排成一組基本圖形(矩形/線/文字),再分別畫成 SVG(畫面)與 PDF(pdf-lib,真正的文字與向量圖形,可在 Acrobat 編輯),
// 兩者版面完全一致。頁面為 A3 橫式,表格依項目數自動放大以佈滿頁面。
(function () {
  const DAY = 86400000;
  const W = 1191, H = 842;          // A3 橫式(pt)
  const FRAME = 18;                 // 外框與紙張邊緣距離
  const PAD = 22;                   // 外框內留白
  const LABEL_W = 215;              // 工作項目欄寬
  const MONTH_H = 24, DATE_H = 22;  // 表頭:月份列、週一日期列
  const PDF_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
  const FONTKIT = 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js';
  // 靜態 Noto Sans TC 粗體(OTF):只嵌入用到的字也能正確顯示。
  // (Google Fonts 的可變字型 NotoSansTC[wght].ttf 子集化後會掉字,不可用)
  const FONT_URL = 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/TC/NotoSansTC-Bold.otf';
  const PALETTE = ['#ED7D31', '#00C9B1', '#4472C4', '#F4C430', '#00B050', '#5B9BD5', '#8E9AAF', '#FF66CC', '#7030A0', '#C00000', '#70AD47', '#FFA000', '#264478'];
  const C = {
    frame: '#374151', border: '#9CA3AF', title: '#111827', sub: '#6B7280', text: '#1F2937', muted: '#6B7280',
    head: '#E8EDF5', headText: '#1F2937', zebra: '#F7F9FC', day: '#EEF1F5', week: '#CBD2DC', month: '#8B95A5',
  };

  const utc = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const mondayOf = (t) => t - (((new Date(t).getUTCDay() + 6) % 7) * DAY);
  const endOf = (it) => { const s = utc(it.start); const d = Number(it.days); return s != null && d > 0 ? s + (Math.round(d) - 1) * DAY : null; };
  const ymd = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`; };
  // 顏色依工作項目名稱決定(未設定時:預設清單的順序;其他項目依名稱雜湊),各專案一致
  function colorFor(name, colors) {
    if (colors && colors[name]) return colors[name];
    const defs = ((window.APP_CONFIG.CHOICE_DEFAULTS || {}).schedItem) || [];
    let i = defs.indexOf(name);
    if (i < 0) { i = 0; for (const ch of String(name)) i = (i * 31 + ch.charCodeAt(0)) >>> 0; }
    return PALETTE[i % PALETTE.length];
  }
  const titleOf = (data) => `${data.title || ''} Project Schedule`.trim();

  // ---------- 版面:產生基本圖形(座標以左上為原點,文字 y 為基線) ----------
  // measure(text, size) 用來估算文字寬度(PDF 用字型實際寬度,SVG 用估算)
  function build(data, colors, measure) {
    const items = (data.items || []).filter((it) => it.name || it.start);
    let s = utc(data.start), e = utc(data.end);
    const starts = items.map((it) => utc(it.start)).filter((x) => x != null);
    const ends = items.map(endOf).filter((x) => x != null);
    if (s == null) s = starts.length ? Math.min(...starts) : Date.now();
    if (e == null) e = ends.length ? Math.max(...ends) : s + 27 * DAY;
    if (e < s) e = s;
    const t0 = mondayOf(s);                 // 從起始日所在週的週一
    const t1 = mondayOf(e) + 6 * DAY;       // 到結束日所在週的週日
    const days = Math.round((t1 - t0) / DAY) + 1;

    const out = [];
    const rect = (x, y, w, h, o) => out.push({ t: 'rect', x, y, w, h, ...o });
    const line = (x1, y1, x2, y2, color, w) => out.push({ t: 'line', x1, y1, x2, y2, color, w });
    const text = (x, y, s2, size, o) => out.push({ t: 'text', x, y, s: s2, size, color: C.text, anchor: 'start', ...o });

    // 外框
    rect(FRAME, FRAME, W - FRAME * 2, H - FRAME * 2, { stroke: C.frame, sw: 1.6 });
    const L = FRAME + PAD, R = W - FRAME - PAD;
    // 標題 + 期間
    text(W / 2, FRAME + PAD + 24, titleOf(data), 26, { anchor: 'middle', color: C.title });
    text(W / 2, FRAME + PAD + 46, `${ymd(t0)}  ~  ${ymd(t1)}`, 11.5, { anchor: 'middle', color: C.sub });

    // 表格
    const top = FRAME + PAD + 64;
    const bottom = H - FRAME - PAD;
    const chartX = L + LABEL_W, chartW = R - chartX;
    const dayW = chartW / days;
    const rowsTop = top + MONTH_H + DATE_H;
    const n = Math.max(items.length, 1);
    const rowH = Math.min(200, (bottom - rowsTop) / n);  // 佈滿頁面
    const tableBottom = rowsTop + rowH * n;
    const xOf = (t) => chartX + (t - t0) / DAY * dayW;

    // 表頭底色、斑馬紋
    rect(L, top, R - L, MONTH_H + DATE_H, { fill: C.head });
    for (let i = 0; i < n; i++) if (i % 2 === 1) rect(L, rowsTop + i * rowH, R - L, rowH, { fill: C.zebra });
    // 每日細格線
    if (dayW >= 2.4) for (let d = 1; d < days; d++) if (d % 7) line(chartX + d * dayW, rowsTop, chartX + d * dayW, tableBottom, C.day, 0.5);
    // 每週線 + 週一日期(置中對齊週一那一天)
    const weeks = [];
    for (let t = t0; t <= t1; t += 7 * DAY) weeks.push(t);
    const dateSize = Math.max(7.5, Math.min(10.5, dayW * 7 * 0.3));
    const step = Math.max(1, Math.ceil((measure('12/31', dateSize) + 6) / (dayW * 7)));
    weeks.forEach((t, k) => {
      const x = xOf(t);
      if (k > 0) line(x, rowsTop, x, tableBottom, C.week, 0.7); // 不穿過日期列,日期字才清楚
      if (k % step === 0) {
        const d = new Date(t);
        text(x + dayW / 2, top + MONTH_H + DATE_H / 2 + dateSize * 0.36, `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, dateSize, { anchor: 'middle', color: C.headText });
      }
    });
    // 月份列(每月一格,月份分隔線較深)
    const d0 = new Date(t0);
    let m = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), 1);
    while (m <= t1) {
      const md = new Date(m);
      const next = Date.UTC(md.getUTCFullYear(), md.getUTCMonth() + 1, 1);
      const a = Math.max(m, t0), b = Math.min(next - DAY, t1);
      const xa = xOf(a), xb = xOf(b) + dayW;
      if (m > t0) { line(xa, top, xa, top + MONTH_H, C.month, 0.9); line(xa, rowsTop, xa, tableBottom, C.month, 0.9); }
      const label = `${md.getUTCFullYear()}/${String(md.getUTCMonth() + 1).padStart(2, '0')}`;
      const ms = 11;
      if (xb - xa > measure(label, ms) + 8) text((xa + xb) / 2, top + MONTH_H / 2 + ms * 0.36, label, ms, { anchor: 'middle', color: C.headText });
      m = next;
    }
    line(L, top + MONTH_H, R, top + MONTH_H, C.week, 0.7);
    line(L, rowsTop, R, rowsTop, C.month, 0.9);
    // 工作項目欄
    text(L + LABEL_W / 2, top + (MONTH_H + DATE_H) / 2 + 13 * 0.36, '工作項目', 13, { anchor: 'middle', color: C.headText });
    const labelSize = Math.max(9, Math.min(16, rowH * 0.36));
    const barH = Math.max(6, Math.min(34, rowH * 0.46));
    items.forEach((it, i) => {
      const y = rowsTop + i * rowH;
      line(L, y + rowH, R, y + rowH, C.week, 0.5);
      // 項目名稱(太長時縮小字)
      let ls = labelSize;
      const name = it.name || '';
      while (ls > 7 && measure(name, ls) > LABEL_W - 24) ls -= 0.5;
      text(L + 12, y + rowH / 2 + ls * 0.36, name, ls, { color: C.text });
      // 長條(圓角)+ 工期
      const a = utc(it.start), b = endOf(it);
      if (a == null || b == null || b < t0 || a > t1) return;
      const x0 = xOf(Math.max(a, t0)), x1 = xOf(Math.min(b, t1)) + dayW;
      const bw = Math.max(2, x1 - x0);
      rect(x0, y + (rowH - barH) / 2, bw, barH, { fill: colorFor(name, colors), r: Math.min(4, barH / 2, bw / 2) });
      const dur = `${Math.round(Number(it.days))}天`;
      const ds = Math.max(8, Math.min(10.5, barH * 0.55));
      const dw = measure(dur, ds);
      const ty = y + rowH / 2 + ds * 0.36;
      if (x1 + 6 + dw <= R - 2) text(x1 + 5, ty, dur, ds, { color: C.muted });
      else if (x0 - 6 - dw >= chartX + 2) text(x0 - 5, ty, dur, ds, { color: C.muted, anchor: 'end' });
    });
    // 表格外框與欄位分隔
    line(chartX, top, chartX, tableBottom, C.month, 0.9);
    rect(L, top, R - L, tableBottom - top, { stroke: C.border, sw: 1 });
    return { items: out, height: H };
  }

  // ---------- SVG ----------
  // SVG 中以字數估算文字寬度(中文 1 字寬、英數約 0.56)
  const estimate = (s, size) => { let w = 0; for (const ch of String(s)) w += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.58; return w * size; };
  function svg(data, colors) {
    const { items } = build(data, colors, estimate);
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="'Noto Sans TC','Microsoft JhengHei','PingFang TC',sans-serif" font-weight="700">`,
      `<rect width="${W}" height="${H}" fill="#fff"/>`];
    for (const p of items) {
      if (p.t === 'rect') out.push(`<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}"${p.r ? ` rx="${p.r}"` : ''} fill="${p.fill || 'none'}"${p.stroke ? ` stroke="${p.stroke}" stroke-width="${p.sw}"` : ''}/>`);
      else if (p.t === 'line') out.push(`<line x1="${p.x1}" y1="${p.y1}" x2="${p.x2}" y2="${p.y2}" stroke="${p.color}" stroke-width="${p.w}"/>`);
      else out.push(`<text x="${p.x}" y="${p.y}" font-size="${p.size}" fill="${p.color}" text-anchor="${p.anchor}">${esc(p.s)}</text>`);
    }
    out.push('</svg>');
    return out.join('');
  }

  // ---------- PDF ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('無法載入 PDF 元件,請確認網路'));
      document.head.appendChild(s);
    });
  }
  // 中文字型約 6MB:第一次下載後存入瀏覽器快取
  let fontPromise = null;
  function loadFont() {
    if (!fontPromise) {
      fontPromise = (async () => {
        let cache = null;
        try { cache = await caches.open('pr-fonts-v3'); } catch { /* 不支援時直接下載 */ }
        const hit = cache && await cache.match(FONT_URL);
        if (hit) return hit.arrayBuffer();
        const r = await fetch(FONT_URL);
        if (!r.ok) throw new Error('無法下載中文字型');
        if (cache) await cache.put(FONT_URL, r.clone()).catch(() => {});
        return r.arrayBuffer();
      })().catch((e) => { fontPromise = null; throw e; });
    }
    return fontPromise;
  }
  function prefetch() { loadFont().catch(() => {}); loadScript(PDF_LIB).catch(() => {}); loadScript(FONTKIT).catch(() => {}); }

  async function pdf(data, colors) {
    await loadScript(PDF_LIB);
    await loadScript(FONTKIT);
    const { PDFDocument, rgb } = window.PDFLib;
    const doc = await PDFDocument.create();
    doc.registerFontkit(window.fontkit);
    // 關閉連字(ff 等),避免字母被合併成一個字;字型名稱每次不同,
    // 避免同時開多個匯出檔時,檢視程式把不同檔案的同名子集字型混用而顯示亂碼
    const font = await doc.embedFont((await loadFont()).slice(0), {
      subset: true, customName: 'NotoSansTC-Bold-' + Date.now().toString(36), features: { liga: false, clig: false, dlig: false },
    });
    const title = titleOf(data);
    doc.setTitle(title);
    doc.setCreator('ATK專案履歷');
    doc.setLanguage('zh-TW');
    const page = doc.addPage([W, H]);
    const Y = (y) => H - y; // 版面座標(上→下) → PDF 座標(下→上)
    const col = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(c || ''); const v = m ? parseInt(m[1], 16) : 0; return rgb((v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255); };
    const { items } = build(data, colors, (s, size) => font.widthOfTextAtSize(String(s), size));
    for (const p of items) {
      if (p.t === 'rect') {
        if (p.r && p.fill) {
          // 圓角長條:以 SVG 路徑繪製(原點在左上角,y 向下)
          const { w, h, r } = p;
          const path = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
          page.drawSvgPath(path, { x: p.x, y: Y(p.y), color: col(p.fill) });
        } else {
          page.drawRectangle({
            x: p.x, y: Y(p.y + p.h), width: p.w, height: p.h,
            color: p.fill ? col(p.fill) : undefined, borderColor: p.stroke ? col(p.stroke) : undefined, borderWidth: p.stroke ? p.sw : 0,
          });
        }
      } else if (p.t === 'line') {
        page.drawLine({ start: { x: p.x1, y: Y(p.y1) }, end: { x: p.x2, y: Y(p.y2) }, color: col(p.color), thickness: p.w });
      } else {
        const tw = font.widthOfTextAtSize(p.s, p.size);
        const x = p.anchor === 'middle' ? p.x - tw / 2 : p.anchor === 'end' ? p.x - tw : p.x;
        page.drawText(p.s, { x, y: Y(p.y), size: p.size, font, color: col(p.color) });
      }
    }
    return doc.save({ useObjectStreams: false });
  }

  window.Gantt = { svg, pdf, prefetch, endOf: (it) => { const e = endOf(it); return e == null ? '' : iso(e); }, colorFor, PALETTE, titleOf };
})();

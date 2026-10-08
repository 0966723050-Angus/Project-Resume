// gantt.js — 專案 Schedule 長條圖:同一套版面計算,畫成 SVG(畫面)與 PDF(pdf-lib,真正的文字與向量圖形,可在 Acrobat 編輯)
(function () {
  const DAY = 86400000;
  const W = 1191, H = 842; // A3 橫式(pt)
  const M = 30, LABEL_W = 190, TOP = 112, BOTTOM = 40;
  const PDF_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
  const FONTKIT = 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js';
  // 靜態 Noto Sans TC Regular(OTF):只嵌入用到的字也能正確顯示。
  // (Google Fonts 的可變字型 NotoSansTC[wght].ttf 子集化後會掉字,不可用)
  const FONT_URL = 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/SubsetOTF/TC/NotoSansTC-Regular.otf';
  const PALETTE = ['#ED7D31', '#00E5C8', '#4472C4', '#FFD966', '#00B050', '#5B9BD5', '#A5A5A5', '#FF66CC', '#7030A0', '#C00000', '#70AD47', '#FFC000', '#264478'];

  const utc = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const mondayOf = (t) => t - (((new Date(t).getUTCDay() + 6) % 7) * DAY);
  const endOf = (it) => { const s = utc(it.start); const d = Number(it.days); return s != null && d > 0 ? s + (Math.round(d) - 1) * DAY : null; };
  // 顏色依工作項目名稱決定(未設定時:預設清單的順序;其他項目依名稱雜湊),各專案一致
  function colorFor(name, colors) {
    if (colors && colors[name]) return colors[name];
    const defs = ((window.APP_CONFIG.CHOICE_DEFAULTS || {}).schedItem) || [];
    let i = defs.indexOf(name);
    if (i < 0) { i = 0; for (const ch of String(name)) i = (i * 31 + ch.charCodeAt(0)) >>> 0; }
    return PALETTE[i % PALETTE.length];
  }

  // 版面:圖表期間從起始日所在週的週一開始,到結束日所在週的週日
  function layout(data) {
    const items = (data.items || []).filter((it) => it.name || it.start);
    let s = utc(data.start), e = utc(data.end);
    const starts = items.map((it) => utc(it.start)).filter((x) => x != null);
    const ends = items.map(endOf).filter((x) => x != null);
    if (s == null) s = starts.length ? Math.min(...starts) : Date.now();
    if (e == null) e = ends.length ? Math.max(...ends) : s + 27 * DAY;
    if (e < s) e = s;
    const t0 = mondayOf(s);
    const t1 = mondayOf(e) + 6 * DAY;
    const days = Math.round((t1 - t0) / DAY) + 1;
    const chartX = M + LABEL_W, chartW = W - chartX - M;
    const dayW = chartW / days;
    const avail = H - TOP - BOTTOM;
    const rowH = Math.max(14, Math.min(30, avail / Math.max(items.length, 1)));
    const weeks = [];
    for (let t = t0; t <= t1; t += 7 * DAY) weeks.push(t);
    const step = Math.max(1, Math.ceil(weeks.length / Math.floor(chartW / 26))); // 週數太多時隔週標日期
    const bars = items.map((it, i) => {
      const a = utc(it.start), b = endOf(it);
      let bar = null;
      if (a != null && b != null && b >= t0 && a <= t1) {
        const x0 = chartX + (Math.max(a, t0) - t0) / DAY * dayW;
        const x1 = chartX + ((Math.min(b, t1) - t0) / DAY + 1) * dayW;
        bar = { x: x0, w: Math.max(1.5, x1 - x0) };
      }
      return { name: it.name || '', y: TOP + i * rowH, bar, i };
    });
    return { t0, t1, days, chartX, chartW, dayW, rowH, weeks, step, bars, gridBottom: TOP + Math.max(items.length, 1) * rowH };
  }
  const weekLabel = (t) => { const d = new Date(t); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
  const titleOf = (data) => `${data.title || ''} Project Schedule`.trim();

  // ---------- SVG ----------
  function svg(data, colors) {
    const L = layout(data);
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const out = [];
    const h = Math.max(L.gridBottom + BOTTOM, 300);
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${h}" width="${W}" height="${h}" font-family="'Noto Sans TC','Microsoft JhengHei','PingFang TC',sans-serif">`);
    out.push(`<rect width="${W}" height="${h}" fill="#fff"/>`);
    out.push(`<text x="${W / 2}" y="58" text-anchor="middle" font-size="22" fill="#404040">${esc(titleOf(data))}</text>`);
    // 每日格線 / 每週粗線
    if (L.dayW >= 2.5) for (let d = 0; d <= L.days; d++) {
      const x = L.chartX + d * L.dayW;
      if (d % 7) out.push(`<line x1="${x}" y1="${TOP}" x2="${x}" y2="${L.gridBottom}" stroke="#e3e3e3" stroke-width="0.5"/>`);
    }
    L.weeks.forEach((t, k) => {
      const x = L.chartX + (t - L.t0) / DAY * L.dayW;
      out.push(`<line x1="${x}" y1="${TOP - 4}" x2="${x}" y2="${L.gridBottom}" stroke="#9a9a9a" stroke-width="0.8"/>`);
      if (k % L.step === 0) out.push(`<text x="${x + 2}" y="${TOP - 10}" font-size="9" fill="#404040">${weekLabel(t)}</text>`);
    });
    out.push(`<line x1="${L.chartX + L.chartW}" y1="${TOP - 4}" x2="${L.chartX + L.chartW}" y2="${L.gridBottom}" stroke="#9a9a9a" stroke-width="0.8"/>`);
    for (const b of L.bars) {
      out.push(`<line x1="${L.chartX}" y1="${b.y + L.rowH}" x2="${L.chartX + L.chartW}" y2="${b.y + L.rowH}" stroke="#e3e3e3" stroke-width="0.5"/>`);
      out.push(`<text x="${L.chartX - 8}" y="${b.y + L.rowH / 2 + 4}" text-anchor="end" font-size="${Math.min(11, L.rowH * 0.55)}" fill="#404040">${esc(b.name)}</text>`);
      if (b.bar) out.push(`<rect x="${b.bar.x}" y="${b.y + L.rowH * 0.22}" width="${b.bar.w}" height="${L.rowH * 0.56}" fill="${colorFor(b.name, colors)}"/>`);
    }
    out.push(`<line x1="${L.chartX}" y1="${TOP}" x2="${L.chartX + L.chartW}" y2="${TOP}" stroke="#9a9a9a" stroke-width="0.8"/>`);
    out.push(`<line x1="${L.chartX}" y1="${L.gridBottom}" x2="${L.chartX + L.chartW}" y2="${L.gridBottom}" stroke="#9a9a9a" stroke-width="0.8"/>`);
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
  // 中文字型約 5.7MB:第一次下載後存入瀏覽器快取
  let fontPromise = null;
  function loadFont() {
    if (!fontPromise) {
      fontPromise = (async () => {
        let cache = null;
        try { cache = await caches.open('pr-fonts-v2'); } catch { /* 不支援時直接下載 */ }
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
    // 關閉連字(ff 等),避免字母被合併成一個字
    const font = await doc.embedFont(await loadFont(), { subset: true, features: { liga: false, clig: false, dlig: false } });
    const title = titleOf(data);
    doc.setTitle(title);
    doc.setCreator('ATK專案履歷');
    doc.setLanguage('zh-TW');
    const page = doc.addPage([W, H]);
    const L = layout(data);
    const Y = (y) => H - y; // SVG 座標(上→下) → PDF 座標(下→上)
    const hex = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(c || ''); const n = m ? parseInt(m[1], 16) : 0; return rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };
    const gray = (v) => rgb(v, v, v);
    const line = (x1, y1, x2, y2, c, w) => page.drawLine({ start: { x: x1, y: Y(y1) }, end: { x: x2, y: Y(y2) }, color: c, thickness: w });
    const tw = font.widthOfTextAtSize(title, 22);
    page.drawText(title, { x: (W - tw) / 2, y: Y(58), size: 22, font, color: gray(0.25) });
    if (L.dayW >= 2.5) for (let d = 0; d <= L.days; d++) if (d % 7) {
      const x = L.chartX + d * L.dayW;
      line(x, TOP, x, L.gridBottom, gray(0.89), 0.5);
    }
    L.weeks.forEach((t, k) => {
      const x = L.chartX + (t - L.t0) / DAY * L.dayW;
      line(x, TOP - 4, x, L.gridBottom, gray(0.6), 0.8);
      if (k % L.step === 0) page.drawText(weekLabel(t), { x: x + 2, y: Y(TOP - 10), size: 9, font, color: gray(0.25) });
    });
    line(L.chartX + L.chartW, TOP - 4, L.chartX + L.chartW, L.gridBottom, gray(0.6), 0.8);
    for (const b of L.bars) {
      line(L.chartX, b.y + L.rowH, L.chartX + L.chartW, b.y + L.rowH, gray(0.89), 0.5);
      const size = Math.min(11, L.rowH * 0.55);
      if (b.name) page.drawText(b.name, { x: L.chartX - 8 - font.widthOfTextAtSize(b.name, size), y: Y(b.y + L.rowH / 2 + 4), size, font, color: gray(0.25) });
      if (b.bar) page.drawRectangle({ x: b.bar.x, y: Y(b.y + L.rowH * 0.78), width: b.bar.w, height: L.rowH * 0.56, color: hex(colorFor(b.name, colors)) });
    }
    line(L.chartX, TOP, L.chartX + L.chartW, TOP, gray(0.6), 0.8);
    line(L.chartX, L.gridBottom, L.chartX + L.chartW, L.gridBottom, gray(0.6), 0.8);
    return doc.save({ useObjectStreams: false });
  }

  window.Gantt = { svg, pdf, prefetch, layout, endOf: (it) => { const e = endOf(it); return e == null ? '' : iso(e); }, colorFor, PALETTE, titleOf };
})();

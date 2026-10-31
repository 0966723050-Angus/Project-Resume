// worklist-gantt.js - ATK工作項目甘特圖(SVG,RWD)
// 版面採「凍結窗格」:左上角固定、日期表頭隨內容橫向捲動但縱向固定、
// 工作項目欄隨內容縱向捲動但橫向固定,只有右下角圖表本體會上下左右捲動。
(function () {
  const ROW_H = 34;
  const HEADER_H = 40;
  const BASE_DAY_W = 40; // 縮放 1x 時,自動塞滿容器寬度的參考基準(下限)
  const ABS_MIN_DAY_W = 18;
  const ABS_MAX_DAY_W = 160;
  const BAR_H = 16;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
  const DONE_GREEN = '#1b5e20';
  const DONE_STRIPE = '#a5d6a7';
  const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.25, 1.6, 2, 2.5];
  const DEFAULT_ZOOM_INDEX = 3; // = 1x

  const getVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  function colorForStatus(status) {
    const s = (status || '').trim();
    if (s === '已排定' || s === '已確定') return getVar('--wl-confirmed');
    if (s === '暫定') return getVar('--wl-tentative');
    return getVar('--wl-pending');
  }

  function parseISO(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
  const toISO = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  const addDays = (date, n) => new Date(date.getTime() + n * 86400000);
  const diffDays = (a, b) => Math.round((b.getTime() - a.getTime()) / 86400000);
  const fmtMD = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  const mondayIndex = (date) => (date.getUTCDay() + 6) % 7; // 0=一 ... 6=日
  const mondayOfWeek = (date) => addDays(date, -mondayIndex(date));
  function todayUTC() { const t = new Date(); return new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())); }
  const addMonthsUTC = (date, n) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n, date.getUTCDate()));
  // 本週(週一~週日)
  function currentWeekRange() { const monday = mondayOfWeek(todayUTC()); return { start: monday, end: addDays(monday, 6) }; }
  // 預設:從本週一起往後 2 個月,補到當週週日
  function defaultRange() {
    const monday = mondayOfWeek(todayUTC());
    const roughEnd = addMonthsUTC(monday, 2);
    return { start: monday, end: addDays(roughEnd, 6 - mondayIndex(roughEnd)) };
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }
  const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // 明細視窗以「點擊」開關:再點同一長條、點其他長條或點圖表外都會關閉
  let openBarEl = null;
  let tipEl = null;
  function hideTooltip() { if (tipEl) tipEl.style.opacity = '0'; openBarEl = null; }
  document.addEventListener('click', (evt) => { if (openBarEl && !evt.target.closest('.wl-bar')) hideTooltip(); });

  const zoomValue = (i) => ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, i ?? DEFAULT_ZOOM_INDEX))];

  // els: { labels, header, svg, scroll, headerScroll, tooltip }
  function render(els, rows, range, zoomIndex) {
    const { labels: labelsEl, header: headerSvg, svg, scroll: scrollEl, headerScroll } = els;
    tipEl = els.tooltip;
    if (!scrollEl.__wlSync) { // 本體捲動時同步表頭的橫向位置與工作項目欄的縱向位置
      scrollEl.addEventListener('scroll', () => { headerScroll.scrollLeft = scrollEl.scrollLeft; labelsEl.scrollTop = scrollEl.scrollTop; });
      scrollEl.__wlSync = true;
    }
    hideTooltip();
    labelsEl.innerHTML = '';
    headerSvg.innerHTML = '';
    svg.innerHTML = '';

    const rangeStart = range.start, rangeEnd = range.end;
    const numDays = Math.max(diffDays(rangeStart, rangeEnd) + 1, 1);
    const zoom = zoomValue(zoomIndex);
    const containerW = scrollEl.clientWidth || 320;
    const fitDayW = Math.max(BASE_DAY_W, Math.floor(containerW / numDays));
    const dayW = Math.min(ABS_MAX_DAY_W, Math.max(ABS_MIN_DAY_W, Math.round(fitDayW * zoom)));
    const fontSize = Math.max(9, Math.min(15, Math.round(11 * zoom)));
    const width = numDays * dayW + 4;
    const bodyHeight = Math.max(rows.length * ROW_H + 4, 4);
    const border = getVar('--border');
    const muted = getVar('--muted');

    headerSvg.setAttribute('width', width);
    headerSvg.setAttribute('height', HEADER_H);
    headerSvg.setAttribute('viewBox', `0 0 ${width} ${HEADER_H}`);
    svg.setAttribute('width', width);
    svg.setAttribute('height', bodyHeight);
    svg.setAttribute('viewBox', `0 0 ${width} ${bodyHeight}`);

    // 已結案項目的斜線填色:深綠底 + 淺色 45 度斜線
    const defs = svgEl('defs');
    const pattern = svgEl('pattern', { id: 'wlDoneHatch', patternUnits: 'userSpaceOnUse', width: 7, height: 7, patternTransform: 'rotate(45)' });
    pattern.appendChild(svgEl('rect', { width: 7, height: 7, fill: DONE_GREEN }));
    pattern.appendChild(svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 7, stroke: DONE_STRIPE, 'stroke-width': 2.5 }));
    defs.appendChild(pattern);
    svg.appendChild(defs);

    // 日期欄頭 + 直向格線(每天一欄)
    for (let d = 0; d <= numDays; d++) {
      const x = d * dayW + 2;
      headerSvg.appendChild(svgEl('line', { x1: x, y1: 0, x2: x, y2: HEADER_H, stroke: border, 'stroke-width': 1 }));
      svg.appendChild(svgEl('line', { x1: x, y1: 0, x2: x, y2: bodyHeight - 2, stroke: border, 'stroke-width': 1 }));
      if (d < numDays) {
        const date = addDays(rangeStart, d);
        const wLabel = svgEl('text', { x: x + dayW / 2, y: 16, 'font-size': fontSize, 'text-anchor': 'middle', fill: mondayIndex(date) >= 5 ? '#ff5a5a' : muted, 'font-weight': 600 });
        wLabel.textContent = WEEKDAY_LABELS[mondayIndex(date)];
        headerSvg.appendChild(wLabel);
        const dLabel = svgEl('text', { x: x + dayW / 2, y: 31, 'font-size': fontSize, 'text-anchor': 'middle', fill: muted });
        dLabel.textContent = fmtMD(date);
        headerSvg.appendChild(dLabel);
      }
    }

    // 今天標記線
    const todayOffset = diffDays(rangeStart, todayUTC());
    if (todayOffset >= 0 && todayOffset < numDays) {
      const x = todayOffset * dayW + 2;
      headerSvg.appendChild(svgEl('line', { x1: x, y1: 0, x2: x, y2: HEADER_H, stroke: '#ff5a5a', 'stroke-width': 1.5, 'stroke-dasharray': '4,3' }));
      svg.appendChild(svgEl('line', { x1: x, y1: 0, x2: x, y2: bodyHeight - 2, stroke: '#ff5a5a', 'stroke-width': 1.5, 'stroke-dasharray': '4,3' }));
    }

    if (rows.length === 0) {
      const t = svgEl('text', { x: 12, y: 24, 'font-size': 13, fill: muted });
      t.textContent = '目前沒有工作項目';
      svg.appendChild(t);
      return;
    }

    rows.forEach((r, i) => {
      const y = i * ROW_H;
      const labelDiv = document.createElement('div');
      labelDiv.className = 'wl-glabel';
      labelDiv.textContent = r.item || '(未命名)';
      labelDiv.title = r.item || '';
      labelsEl.appendChild(labelDiv);
      svg.appendChild(svgEl('line', { x1: 0, y1: y + ROW_H, x2: width, y2: y + ROW_H, stroke: border, 'stroke-width': 1 }));

      if (!r.start || !r.end) return;
      const s = parseISO(r.start), e = parseISO(r.end);
      if (e < rangeStart || s > rangeEnd) return; // 完全落在檢視範圍外
      const clippedStart = s < rangeStart ? rangeStart : s;
      const clippedEnd = e > rangeEnd ? rangeEnd : e;
      const x = diffDays(rangeStart, clippedStart) * dayW + 2;
      const barW = Math.max((diffDays(clippedStart, clippedEnd) + 1) * dayW - 4, 10);
      const rect = svgEl('rect', {
        x, y: y + (ROW_H - BAR_H) / 2, width: barW, height: BAR_H, rx: 6, ry: 6,
        fill: r.archived ? 'url(#wlDoneHatch)' : colorForStatus(r.status), class: 'wl-bar',
      });
      if (r.archived) { rect.setAttribute('stroke', DONE_GREEN); rect.setAttribute('stroke-width', 1.5); }
      rect.style.cursor = 'pointer';
      svg.appendChild(rect);

      rect.addEventListener('click', (evt) => {
        evt.stopPropagation();
        if (openBarEl === rect) { hideTooltip(); return; }
        const people = [r.hw, r.sw].filter(Boolean).join(' / ');
        tipEl.innerHTML =
          `<strong>${escapeHtml(r.item)}</strong><br>${r.start} ~ ${r.end}(${r.duration ?? ''}天)<br>` +
          (r.archived ? `狀態:已結案(資料庫)${r.closed ? `,結案日 ${r.closed}` : ''}` : `狀態:${escapeHtml(r.status || '-')}`) +
          (people ? `<br>${escapeHtml(people)}` : '') +
          (r.plan ? `<br>預計工作:${escapeHtml(r.plan)}` : '') +
          (r.note ? `<br>備註:${escapeHtml(r.note)}` : '');
        tipEl.style.left = Math.max(8, Math.min(evt.clientX + 12, window.innerWidth - 250)) + 'px';
        tipEl.style.top = Math.max(evt.clientY - 40, 8) + 'px';
        tipEl.style.opacity = '1';
        openBarEl = rect;
      });
    });

    // 重新渲染後(例如縮放),讓表頭/標籤欄的捲動位置與本體同步
    headerScroll.scrollLeft = scrollEl.scrollLeft;
    labelsEl.scrollTop = scrollEl.scrollTop;
  }

  window.WorkGantt = { render, defaultRange, currentWeekRange, todayUTC, toISO, parseISO, ZOOM_STEPS, DEFAULT_ZOOM_INDEX };
})();

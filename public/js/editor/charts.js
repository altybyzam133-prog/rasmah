'use strict';

/* ============================================================================
   Charts — bar / pie / line, built from plain fabric shapes (rects, a path
   for pie wedges, a polyline for the line chart) grouped into one object, so
   the result stays a normal editable design element rather than a baked-in
   image. Data comes from a simple "Label,Value" textarea, one row per line.
   ========================================================================== */

(function () {
  const ED = window.ED;

  const typeRow = document.getElementById('chartTypeRow');
  const dataInput = document.getElementById('chartData');
  const insertBtn = document.getElementById('chartInsertBtn');
  if (!typeRow || !dataInput || !insertBtn) return;

  const PALETTE = ['#7c5cff', '#00c2ff', '#ff6b6b', '#ffd166', '#06d6a0', '#f78fb3'];
  const FONT = ED.lang === 'ar' ? 'Cairo' : 'Poppins';

  let chartType = 'bar';
  typeRow.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-charttype]');
    if (!btn) return;
    chartType = btn.dataset.charttype;
    [...typeRow.querySelectorAll('button')].forEach((b) => b.classList.toggle('on', b === btn));
  });

  function parseData() {
    return dataInput.value.split('\n')
      .map((line) => line.split(','))
      .filter((p) => p.length === 2 && p[1].trim() !== '')
      .map(([label, value]) => ({ label: label.trim(), value: parseFloat(value) || 0 }));
  }

  function label(text, opts) {
    return new fabric.Textbox(text, Object.assign({ fontFamily: FONT, fill: '#4b4768' }, opts));
  }

  function buildBarChart(data) {
    const W = 480, H = 320, padBottom = 40, padTop = 24;
    const max = Math.max(...data.map((d) => d.value), 1);
    const n = data.length, gap = 14;
    const barW = (W - gap * (n + 1)) / n;
    const objs = [];
    data.forEach((d, i) => {
      const barH = ((H - padBottom - padTop) * d.value) / max;
      const x = gap + i * (barW + gap);
      const y = H - padBottom - barH;
      objs.push(new fabric.Rect({ left: x, top: y, width: barW, height: Math.max(2, barH), fill: PALETTE[i % PALETTE.length], rx: 4, ry: 4 }));
      objs.push(label(String(d.value), { left: x, top: y - 22, width: barW, fontSize: 14, textAlign: 'center' }));
      objs.push(label(d.label, { left: x - 6, top: H - padBottom + 6, width: barW + 12, fontSize: 12, textAlign: 'center', fill: '#6c6883' }));
    });
    return objs;
  }

  function buildPieChart(data) {
    const size = 260, r = size / 2, cx = r, cy = r;
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    let angle = -90;
    const objs = [];
    data.forEach((d, i) => {
      const sweep = (d.value / total) * 360;
      const a0 = (angle * Math.PI) / 180, a1 = ((angle + sweep) * Math.PI) / 180;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const large = sweep > 180 ? 1 : 0;
      objs.push(new fabric.Path(`M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`, { fill: PALETTE[i % PALETTE.length] }));
      angle += sweep;
    });
    data.forEach((d, i) => {
      const ly = size + 16 + i * 24;
      objs.push(new fabric.Rect({ left: 0, top: ly, width: 14, height: 14, fill: PALETTE[i % PALETTE.length], rx: 3, ry: 3 }));
      objs.push(label(`${d.label} (${d.value})`, { left: 22, top: ly - 2, width: 220, fontSize: 14 }));
    });
    return objs;
  }

  function buildLineChart(data) {
    const W = 480, H = 300, padBottom = 40, padTop = 24, padSide = 24;
    const max = Math.max(...data.map((d) => d.value), 1);
    const n = data.length;
    const stepX = n > 1 ? (W - padSide * 2) / (n - 1) : 0;
    const points = data.map((d, i) => ({
      x: padSide + i * stepX,
      y: H - padBottom - ((H - padBottom - padTop) * d.value) / max,
    }));
    const objs = [new fabric.Polyline(points, { fill: '', stroke: PALETTE[0], strokeWidth: 3, strokeLineJoin: 'round' })];
    data.forEach((d, i) => {
      objs.push(new fabric.Circle({ left: points[i].x - 5, top: points[i].y - 5, radius: 5, fill: PALETTE[0] }));
      objs.push(label(d.label, { left: points[i].x - 30, top: H - padBottom + 6, width: 60, fontSize: 12, textAlign: 'center', fill: '#6c6883' }));
    });
    return objs;
  }

  function buildChart(type, data) {
    if (type === 'pie') return buildPieChart(data);
    if (type === 'line') return buildLineChart(data);
    return buildBarChart(data);
  }
  ED.buildChart = buildChart;

  /* ---- edit an already-placed chart's data ---------------------------------
     Without this, fixing one wrong number after a chart was already placed
     meant deleting it and rebuilding from scratch. Double-clicking a chart
     group prefills this same panel from the type/raw-text it was built with
     (persisted via chartType/chartRaw — see EXTRA_PROPS in core.js) and
     switches the Insert button into an Update mode that rebuilds the group
     in place (same position/rotation/scale) instead of adding a new one. */
  const insertBtnDefaultText = insertBtn.textContent;
  let editingGroup = null;

  function exitEditMode() {
    editingGroup = null;
    insertBtn.textContent = insertBtnDefaultText;
  }
  document.querySelectorAll('.ed-tab').forEach((t) => t.addEventListener('click', () => {
    if (t.dataset.tab !== 'charts' && editingGroup) exitEditMode();
  }));

  ED.canvas.on('mouse:dblclick', (opt) => {
    const target = opt.target;
    if (!target || target.name !== 'chart' || !target.chartType) return;
    editingGroup = target;
    chartType = target.chartType;
    dataInput.value = target.chartRaw || '';
    [...typeRow.querySelectorAll('button')].forEach((b) => b.classList.toggle('on', b.dataset.charttype === chartType));
    insertBtn.textContent = ED.i18n.chartUpdate || insertBtnDefaultText;
    document.querySelector('.ed-tab[data-tab="charts"]')?.dispatchEvent(new Event('click', { bubbles: true }));
  });

  insertBtn.addEventListener('click', () => {
    const data = parseData();
    if (!data.length) return;
    if (editingGroup) {
      const { left, top, angle, scaleX, scaleY } = editingGroup;
      ED.canvas.remove(editingGroup);
      const group = new fabric.Group(buildChart(chartType, data), {
        name: 'chart', chartType, chartRaw: dataInput.value, left, top, angle, scaleX, scaleY,
      });
      ED.canvas.add(group);
      ED.canvas.setActiveObject(group);
      ED.canvas.requestRenderAll();
      ED.record();
      exitEditMode();
    } else {
      const group = new fabric.Group(buildChart(chartType, data), { name: 'chart', chartType, chartRaw: dataInput.value });
      ED.addObject(group);
    }
  });
})();

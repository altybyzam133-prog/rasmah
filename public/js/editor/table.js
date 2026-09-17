'use strict';

/* ============================================================================
   Table — a grid of rect cells + text, added as individual (ungrouped)
   objects rather than a fabric.Group: grouped Textboxes can't be double-click
   edited without first ungrouping, and being able to type directly into a
   cell is the whole point of a table. Resizing/moving the table as one unit
   isn't supported here — select-and-drag a rubber-band over it instead.
   ========================================================================== */

(function () {
  const ED = window.ED;
  const canvas = ED.canvas;
  const rowsInput = document.getElementById('tableRows');
  const colsInput = document.getElementById('tableCols');
  const insertBtn = document.getElementById('tableInsertBtn');
  if (!rowsInput || !colsInput || !insertBtn) return;

  const FONT = ED.lang === 'ar' ? 'Cairo' : 'Poppins';
  const HEADER_FILL = '#7c5cff';
  const CELL_FILL = '#ffffff';
  const BORDER = '#d6d2e6';

  function buildTable(rows, cols) {
    const cellW = 120, cellH = 44;
    const left0 = ED.W / 2 - (cols * cellW) / 2;
    const top0 = ED.H / 2 - (rows * cellH) / 2;
    const objs = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const left = left0 + c * cellW, top = top0 + r * cellH;
        const isHeader = r === 0;
        objs.push(new fabric.Rect({
          left, top, width: cellW, height: cellH,
          fill: isHeader ? HEADER_FILL : CELL_FILL, stroke: BORDER, strokeWidth: 1,
          name: 'table',
        }));
        const text = isHeader ? (ED.lang === 'ar' ? `عمود ${c + 1}` : `Column ${c + 1}`) : '';
        objs.push(new fabric.Textbox(text, {
          left: left + 8, top: top + cellH / 2 - 10, width: cellW - 16, fontSize: 14,
          fontFamily: FONT, fill: isHeader ? '#ffffff' : '#1b1830', name: 'table',
        }));
      }
    }
    return objs;
  }
  ED.buildTable = buildTable;

  insertBtn.addEventListener('click', () => {
    const rows = Math.max(1, Math.min(12, Math.round(+rowsInput.value) || 3));
    const cols = Math.max(1, Math.min(8, Math.round(+colsInput.value) || 3));
    buildTable(rows, cols).forEach((o) => canvas.add(o));
    canvas.requestRenderAll();
    ED.record();
    if (window.ED_syncLayers) window.ED_syncLayers();
  });
})();

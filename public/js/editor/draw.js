'use strict';

/* ============================================================================
   Freehand draw tool — fabric's built-in free-drawing mode (PencilBrush).
   Active only while the "Draw" tab is open; switching to any other tab hands
   control back to normal selection, since drawing and selecting share the
   same pointer events and can't both be live at once.
   ========================================================================== */

(function () {
  const ED = window.ED;
  const canvas = ED.canvas;
  const colorInput = document.getElementById('drawColor');
  const widthInput = document.getElementById('drawWidth');
  const widthOut = document.getElementById('drawWidthOut');
  if (!colorInput || !widthInput) return;

  function applyBrushSettings() {
    if (!canvas.freeDrawingBrush) return;
    canvas.freeDrawingBrush.color = colorInput.value;
    canvas.freeDrawingBrush.width = +widthInput.value;
  }

  function setDrawing(on) {
    if (on && !canvas.freeDrawingBrush) canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
    canvas.isDrawingMode = on;
    if (on) applyBrushSettings();
  }

  document.querySelectorAll('.ed-tab').forEach((tab) => {
    tab.addEventListener('click', () => setDrawing(tab.dataset.tab === 'draw'));
  });

  colorInput.addEventListener('input', applyBrushSettings);
  widthInput.addEventListener('input', () => {
    widthOut.textContent = widthInput.value;
    applyBrushSettings();
  });

  canvas.on('path:created', () => {
    ED.record();
    if (window.ED_syncLayers) window.ED_syncLayers();
  });
})();

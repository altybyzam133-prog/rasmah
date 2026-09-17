'use strict';

/* ============================================================================
   "Frames" — real Canva-style photo frames: shaped placeholders (circle,
   square, star) you drag a photo onto, and the photo clips to that shape
   while staying draggable/resizable within it (fabric's native clipPath,
   absolutePositioned so the mask stays put on the canvas while the photo
   underneath moves). This is a different thing from the decorative border
   shapes in the "frames" category of the elements library.
   ========================================================================== */

(function () {
  const ED = window.ED;
  const canvas = ED.canvas;

  const PLACEHOLDER_FILL = 'rgba(124, 92, 255, .08)';
  const PLACEHOLDER_STROKE = '#9c8fd9';

  function starPoints(outer, inner, spikes) {
    const pts = [];
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (Math.PI / spikes) * i - Math.PI / 2;
      pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
    }
    return pts;
  }

  function makeFrame(kind) {
    const u = Math.min(ED.W, ED.H);
    const common = {
      fill: PLACEHOLDER_FILL, stroke: PLACEHOLDER_STROKE, strokeDashArray: [8, 6],
      isFrame: true, frameShape: kind,
    };
    if (kind === 'circle') return new fabric.Circle({ ...common, radius: u * 0.22 });
    if (kind === 'star') return new fabric.Polygon(starPoints(u * 0.24, u * 0.24 * 0.42, 5), common);
    return new fabric.Rect({
      ...common, width: u * 0.4, height: u * 0.4,
      rx: kind === 'rounded' ? 24 : 0, ry: kind === 'rounded' ? 24 : 0,
    });
  }

  document.querySelectorAll('[data-frame]').forEach((b) =>
    b.addEventListener('click', () => ED.addObject(makeFrame(b.dataset.frame)))
  );

  /* ---- photo grids: several rect frames placed at once in a preset layout - */
  // each cell is [x, y, w, h] as a fraction of the layout's own bounding box
  const GRID_LAYOUTS = {
    '2col': [[0, 0, 0.48, 1], [0.52, 0, 0.48, 1]],
    '2row': [[0, 0, 1, 0.48], [0, 0.52, 1, 0.48]],
    grid4: [[0, 0, 0.48, 0.48], [0.52, 0, 0.48, 0.48], [0, 0.52, 0.48, 0.48], [0.52, 0.52, 0.48, 0.48]],
    big2: [[0, 0, 0.64, 1], [0.68, 0, 0.32, 0.48], [0.68, 0.52, 0.32, 0.48]],
  };
  function addGridLayout(key) {
    const cells = GRID_LAYOUTS[key];
    if (!cells) return;
    const boxW = ED.W * 0.8, boxH = ED.H * 0.5;
    const left0 = (ED.W - boxW) / 2, top0 = (ED.H - boxH) / 2;
    cells.forEach((c) => {
      canvas.add(new fabric.Rect({
        left: left0 + c[0] * boxW, top: top0 + c[1] * boxH,
        width: c[2] * boxW, height: c[3] * boxH,
        fill: PLACEHOLDER_FILL, stroke: PLACEHOLDER_STROKE, strokeDashArray: [8, 6],
        isFrame: true, frameShape: 'rect',
      }));
    });
    canvas.requestRenderAll();
    ED.record();
    if (window.ED_syncLayers) window.ED_syncLayers();
  }
  document.querySelectorAll('[data-grid]').forEach((b) =>
    b.addEventListener('click', () => addGridLayout(b.dataset.grid))
  );

  /* ---- filling a frame with a photo ---------------------------------------- */
  // a static clone of the frame's current geometry, pinned to canvas space —
  // not a live reference, so the frame can be restyled/removed afterward
  // without dragging the clip along with it.
  function cloneClipShape(frame) {
    const common = {
      left: frame.left, top: frame.top,
      originX: frame.originX, originY: frame.originY,
      angle: frame.angle || 0, scaleX: frame.scaleX || 1, scaleY: frame.scaleY || 1,
      absolutePositioned: true,
    };
    if (frame.frameShape === 'circle') return new fabric.Circle({ ...common, radius: frame.radius });
    if (frame.frameShape === 'star') return new fabric.Polygon(frame.points, common);
    return new fabric.Rect({ ...common, width: frame.width, height: frame.height, rx: frame.rx || 0, ry: frame.ry || 0 });
  }

  ED.fillFrame = function (frame, url) {
    fabric.Image.fromURL(url, (img) => {
      if (!img || !img.width) return;
      const rect = frame.getBoundingRect(true, true);
      const scale = Math.max(rect.width / img.width, rect.height / img.height);
      img.set({
        left: rect.left + rect.width / 2,
        top: rect.top + rect.height / 2,
        originX: 'center', originY: 'center',
        scaleX: scale, scaleY: scale,
        clipPath: cloneClipShape(frame),
      });
      canvas.add(img);
      canvas.moveTo(img, canvas.getObjects().indexOf(frame));
      frame.set('fill', 'transparent'); // keep the dashed stroke as a border ring around the photo
      canvas.setActiveObject(img);
      canvas.requestRenderAll();
      ED.record();
      if (window.ED_syncLayers) window.ED_syncLayers();
    }, { crossOrigin: 'anonymous' });
  };

  function frameAt(pointer) {
    const frames = canvas.getObjects().filter((o) => o.isFrame);
    for (let i = frames.length - 1; i >= 0; i--) {
      if (frames[i].containsPoint(pointer, null, true, true)) return frames[i];
    }
    return null;
  }

  /* ---- drag a photo (Uploads/AI thumbnails) onto a frame ------------------- */
  document.addEventListener('dragstart', (e) => {
    const thumb = e.target.closest('.ed-upload-thumb');
    if (!thumb || !thumb.dataset.url) return;
    e.dataTransfer.setData('text/uri-list', thumb.dataset.url);
    e.dataTransfer.effectAllowed = 'copy';
  });

  const upperCanvas = canvas.upperCanvasEl;
  upperCanvas.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  upperCanvas.addEventListener('drop', (e) => {
    e.preventDefault();
    const url = e.dataTransfer.getData('text/uri-list');
    if (!url) return;
    const pointer = canvas.getPointer(e);
    const frame = frameAt(pointer);
    if (frame) {
      ED.fillFrame(frame, url);
      return;
    }
    // dropped on open canvas (no frame under the pointer): place it there directly
    fabric.Image.fromURL(url, (img) => {
      if (!img || !img.width) return;
      const target = ED.W * 0.6;
      const s = Math.min(1, target / img.width);
      img.set({ left: pointer.x, top: pointer.y, originX: 'center', originY: 'center', scaleX: s, scaleY: s });
      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.requestRenderAll();
      ED.record();
    });
  });
})();

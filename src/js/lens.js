// Control handlers (null-safe for pages without controls)
(() => {
  const magInput = document.getElementById('magnification');
  const magValue = document.getElementById('magValue');
  if (magInput && magValue) {
    magInput.addEventListener('input', (e) => {
      magValue.textContent = e.target.value;
    });
  }

  const distInput = document.getElementById('distortion');
  const distValue = document.getElementById('distValue');
  if (distInput && distValue) {
    distInput.addEventListener('input', (e) => {
      distValue.textContent = e.target.value;
    });
  }
})();

class NeonGlassLensEffect {
  constructor() {
    this.lenses = [];
    this.globalMagnification = 1;
    this.globalDistortion = 1;
    this.enabled = true;
    this.isCapturing = false;
    this.snapshotCanvas = null; // full-page snapshot (html2canvas result)
    this.snapshotWidth = 0;
    this.snapshotHeight = 0;
    this.initialScrollX = 0;
    this.initialScrollY = 0;
    this.init();
  }

  init() {
    document.querySelectorAll('.bg-neon-glass.lens-enabled').forEach((element) => {
      const canvas = element.querySelector('.lens-canvas');
      if (!canvas) return;

      const lens = {
        element: element,
        canvas: canvas,
        ctx: canvas.getContext('2d', { willReadFrequently: true }),

        magnification: 1,
        distortion: 1,
        opacity: 0.4,
        blur: 6,
        active: false,
        // Optional specular highlight band (modulated by background luminance)
        specular: {
          enabled: (element.dataset.lensSpecularEnabled || 'true') !== 'false',
          top:  parseFloat(element.dataset.lensSpecularTop || '12'),    // px from top
          height: parseFloat(element.dataset.lensSpecularHeight || '56'), // px tall
          left: parseFloat(element.dataset.lensSpecularLeft || '16'),   // left inset px
          right: parseFloat(element.dataset.lensSpecularRight || '16'), // right inset px
          strength: Math.max(0, Math.min(1, parseFloat(element.dataset.lensSpecularStrength || '0.35'))),
          radius: Math.max(0, parseFloat(element.dataset.lensSpecularRadius || '12')),
          gamma: Math.max(0.1, parseFloat(element.dataset.lensSpecularGamma || '1.0'))
        },
        // Optional top-band alpha fade mask (kept for experimentation; off by default)
        bandMask: {
          enabled: (element.dataset.lensBandEnabled || 'false') === 'true',
          top:  parseFloat(element.dataset.lensBandTop || '12'),
          height: parseFloat(element.dataset.lensBandHeight || '56'),
          left: parseFloat(element.dataset.lensBandLeft || '16'),
          right: parseFloat(element.dataset.lensBandRight || '16'),
          alphaTop: 1.0,
          alphaBottom: 0.15
        },
        // Subtle noise overlay to reduce banding
        noise: {
          enabled: (element.dataset.lensNoiseEnabled || 'true') !== 'false',
          alpha: Math.max(0, Math.min(1, parseFloat(element.dataset.lensNoiseAlpha || '0.15'))),
          size: Math.max(16, parseInt(element.dataset.lensNoiseSize || '128', 10)),
          mono: (element.dataset.lensNoiseMono || 'true') !== 'false'
        }
      };

      this.lenses.push(lens);
      this.setupCanvas(lens);
    });

    this.setupControls();

    // Take a full-page snapshot once, then render from it
    this.captureSnapshot().then(() => {
      this.renderAllLenses();
    });

    // Redraw from snapshot on scroll/resize (no re-capture)
    let rafId = null;
    const scheduleRender = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        this.renderAllLenses();
      });
    };
    // Watch scroll on both window and document; also run a watcher loop
    window.addEventListener('scroll', scheduleRender, { passive: true });
    document.addEventListener('scroll', scheduleRender, { passive: true });
    window.addEventListener('resize', () => {
      this.lenses.forEach(lens => this.setupCanvas(lens));
      scheduleRender();
    });
    // Polling watcher to catch programmatic scrolls
    let lastX = window.scrollX, lastY = window.scrollY;
    const tick = () => {
      const x = window.scrollX, y = window.scrollY;
      if (x !== lastX || y !== lastY) {
        lastX = x; lastY = y;
        this.renderAllLenses();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    // Only render lenses that are near/in the viewport
    try {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          const lens = this.lenses.find(l => l.element === entry.target);
          if (!lens) return;
          lens.active = entry.isIntersecting;
          if (lens.active) {
            scheduleRender();
          } else {
            lens.ctx.clearRect(0, 0, lens.canvas.width, lens.canvas.height);
          }
        });
      }, { root: null, rootMargin: '200px 0px', threshold: 0.01 });
      this.lenses.forEach(l => io.observe(l.element));
      this._io = io;
    } catch (_) {
      // IntersectionObserver not available; fall back to scroll polling only
    }
  }

  setupCanvas(lens) {
    const rect = lens.element.getBoundingClientRect();
    lens.canvas.width = rect.width;
    lens.canvas.height = rect.height;
    // Invalidate cached mask when size changes
    lens._maskCanvas = null;
  }

  setupControls() {
    const magnificationSlider = document.getElementById('magnification');
    const distortionSlider = document.getElementById('distortion');
    const enableCheckbox = document.getElementById('enableLens');

    magnificationSlider.addEventListener('input', (e) => {
      this.globalMagnification = parseFloat(e.target.value);
      this.renderAllLenses();
    });

    distortionSlider.addEventListener('input', (e) => {
      this.globalDistortion = parseFloat(e.target.value);
      this.renderAllLenses();
    });

    enableCheckbox.addEventListener('change', (e) => {
      this.enabled = e.target.checked;
      if (this.enabled) {
        this.renderAllLenses();
      } else {
        this.lenses.forEach(lens => {
          lens.ctx.clearRect(0, 0, lens.canvas.width, lens.canvas.height);
        });
      }
    });
  }

  async captureSnapshot() {
    if (this.snapshotCanvas || !this.enabled || this.isCapturing) return;
    this.isCapturing = true;
    const hidden = [];
    try {
      // record scroll anchors
      this.initialScrollX = window.scrollX;
      this.initialScrollY = window.scrollY;
      // Hide lenses to avoid recursive capture
      document.querySelectorAll('.bg-neon-glass.lens-enabled').forEach(el => {
        hidden.push({ el, vis: el.style.visibility });
        el.style.visibility = 'hidden';
      });
      await new Promise(requestAnimationFrame);

      const docEl = document.documentElement;
      const docWidth = Math.max(docEl.scrollWidth, docEl.clientWidth);
      const docHeight = Math.max(docEl.scrollHeight, docEl.clientHeight);

      const snap = await html2canvas(document.body, {
        x: 0,
        y: 0,
        width: docWidth,
        height: docHeight,
        scale: 1,
        useCORS: true,
        allowTaint: true,
        removeContainer: true,
        foreignObjectRendering: false,
        backgroundColor: null,
        logging: false,
        ignoreElements: (el) => {
          try {
            if (el.closest && el.closest('.html2canvas-container')) return true;
            if (el.closest && el.closest('[data-html2canvas-ignore]')) return true;
          } catch (_) {}
          return false;
        }
      });

      this.snapshotCanvas = snap;
      this.snapshotWidth = docWidth;
      this.snapshotHeight = docHeight;
      // Record each lens's document-space origin at snapshot time
      this.lenses.forEach(lens => {
        const r0 = lens.element.getBoundingClientRect();
        lens.docX0 = Math.floor(r0.left + this.initialScrollX);
        lens.docY0 = Math.floor(r0.top + this.initialScrollY);
      });
    } catch (_) {
    	console.trace(_);
      // leave snapshot null; fallback rendering will be used
    } finally {
      hidden.forEach(({ el, vis }) => { el.style.visibility = vis || 'visible'; });
      this.isCapturing = false;
    }
  }

  renderAllLenses() {
    if (!this.enabled) return;
    if (!this.snapshotCanvas) {
      this.lenses.forEach(lens => this.drawFallbackEffect(lens));
      return;
    }
    for (const lens of this.lenses) {
      if (lens.active) {
        this.renderLensFromSnapshot(lens);
      } else {
        lens.ctx.clearRect(0, 0, lens.canvas.width, lens.canvas.height);
      }
    }
  }

  renderLensFromSnapshot(lens) {
    const rect = lens.element.getBoundingClientRect();
    // Compute base sampling from lens's snapshot-time document origin, then
    // apply inverse scroll deltas so background slides under the lens.
    const deltaY = window.scrollY - this.initialScrollY;
    const deltaX = window.scrollX - this.initialScrollX;
    const baseSx = (lens.docX0 != null ? lens.docX0 : Math.floor(this.initialScrollX + rect.left)) - deltaX;
    const baseSy = (lens.docY0 != null ? lens.docY0 : Math.floor(this.initialScrollY + rect.top)) - deltaY;
    const mag = Math.max(0.5, (lens.magnification || 1) * this.globalMagnification);
    // Compute source rect centered under lens, accounting for magnification
    let srcW = rect.width / mag;
    let srcH = rect.height / mag;
    let srcX = baseSx + (rect.width - srcW) / 2;
    let srcY = baseSy + (rect.height - srcH) / 2;
    // Clamp to snapshot bounds
    srcX = Math.max(0, Math.min(this.snapshotWidth - srcW, Math.floor(srcX)));
    srcY = Math.max(0, Math.min(this.snapshotHeight - srcH, Math.floor(srcY)));
    const sx = srcX, sy = srcY, sw = Math.max(0, Math.floor(srcW)), sh = Math.max(0, Math.floor(srcH));

    lens.ctx.save();
    lens.ctx.clearRect(0, 0, lens.canvas.width, lens.canvas.height);
    try {
      if (sw > 0 && sh > 0) {
        lens.ctx.drawImage(this.snapshotCanvas, sx, sy, sw, sh, 0, 0, rect.width, rect.height);
      }
      if (this.globalDistortion > 0) {
        try { this.applyEdgeDistortion(lens, this.globalDistortion); } catch (_) {}
      }
      // Blur pass
      lens.ctx.filter = `blur(${lens.blur}px)`;
      lens.ctx.drawImage(lens.canvas, 0, 0);
      lens.ctx.filter = 'none';

      // (Ripple ring distortion removed)

      // Specular highlight band, modulated by background luminance
      if (lens.specular && lens.specular.enabled) {
        try { this.applySpecularHighlightBand(lens); } catch (_) {}
      }

      // Subtle noise overlay (before masks so it is masked too)
      if (lens.noise && lens.noise.enabled) {
        try { this.applyNoiseOverlay(lens); } catch (_) {}
      }

      // Apply edge opacity mask: opaque at edges, fade to 0.15 by 5px (existing step)
      this.applyEdgeOpacityMask(lens, 5 /*px*/, 0.15 /*min alpha*/);

      // Additional interior falloff:
      // - From 5px to 50px (top/bottom) and 5px to 75px (left/right),
      //   with center clamped to 0.15 overall alpha (no further reduction).
      // Relative factor set so 0.15 (from first mask) remains 0.15 at the interior.
      try {
        this.applyInteriorFalloffMask(lens,
          5  /*startPx for all sides*/,
          50 /*topEndPx*/, 75 /*rightEndPx*/, 50 /*bottomEndPx*/, 75 /*leftEndPx*/,
          1.0 /*relativeMinAlpha*/,
          14 /*featherPx*/);
      } catch (_) {}

      // Apply an additional vertical band fade near the top (reference image)
      if (lens.bandMask && lens.bandMask.enabled) {
        try { this.applyTopBandOpacityMask(lens); } catch (_) {}
      }

      // Brightness gain without CSS (approx. 4x). Alpha preserved.
      try { this.applyBrightnessGain(lens, 4.0); } catch (_) {}

    } catch (_) {
      this.drawFallbackEffect(lens);
    } finally {
      lens.ctx.restore();
    }
  }

  applyEdgeOpacityMask(lens, fadePx, minAlpha) {
    const w = lens.canvas.width | 0;
    const h = lens.canvas.height | 0;
    if (w === 0 || h === 0) return;
    // Build or reuse mask canvas
    let mask = lens._maskCanvas;
    // Fetch border radii from the lens container to inherit rounding
    const cs = getComputedStyle(lens.element);
    const px = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
    const radii = {
      tl: px(cs.borderTopLeftRadius),
      tr: px(cs.borderTopRightRadius),
      br: px(cs.borderBottomRightRadius),
      bl: px(cs.borderBottomLeftRadius)
    };
    const radiiKey = `${radii.tl}|${radii.tr}|${radii.br}|${radii.bl}`;

    if (!mask || mask.width !== w || mask.height !== h || mask._fadePx !== fadePx || mask._minAlpha !== minAlpha || mask._radiiKey !== radiiKey) {
      mask = document.createElement('canvas');
      mask.width = w; mask.height = h;
      const m = mask.getContext('2d');
      // Create a rounded-rect clip to inherit border-radius
      const rr = (ctx, x, y, w, h, r) => {
        const tl = Math.max(0, r.tl || 0);
        const tr = Math.max(0, r.tr || 0);
        const br = Math.max(0, r.br || 0);
        const bl = Math.max(0, r.bl || 0);
        ctx.beginPath();
        ctx.moveTo(x + tl, y);
        ctx.lineTo(x + w - tr, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
        ctx.lineTo(x + w, y + h - br);
        ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
        ctx.lineTo(x + bl, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
        ctx.lineTo(x, y + tl);
        ctx.quadraticCurveTo(x, y, x + tl, y);
        ctx.closePath();
      };
      m.save();
      rr(m, 0, 0, w, h, radii);
      m.clip();

      // Base fill at minAlpha across the clipped area
      m.fillStyle = `rgba(0,0,0,${minAlpha})`;
      m.fillRect(0, 0, w, h);

      const clamp = (v) => Math.max(0, Math.min(v, 1));
      const a0 = clamp(1);
      const a1 = clamp(minAlpha);

      // Top edge gradient
      let g = m.createLinearGradient(0, 0, 0, fadePx);
      g.addColorStop(0, `rgba(0,0,0,${a0})`);
      g.addColorStop(1, `rgba(0,0,0,${a1})`);
      m.fillStyle = g;
      m.fillRect(0, 0, w, fadePx);

      // Bottom edge gradient
      g = m.createLinearGradient(0, h, 0, h - fadePx);
      g.addColorStop(0, `rgba(0,0,0,${a0})`);
      g.addColorStop(1, `rgba(0,0,0,${a1})`);
      m.fillStyle = g;
      m.fillRect(0, h - fadePx, w, fadePx);

      // Left edge gradient
      g = m.createLinearGradient(0, 0, fadePx, 0);
      g.addColorStop(0, `rgba(0,0,0,${a0})`);
      g.addColorStop(1, `rgba(0,0,0,${a1})`);
      m.fillStyle = g;
      m.fillRect(0, 0, fadePx, h);

      // Right edge gradient
      g = m.createLinearGradient(w, 0, w - fadePx, 0);
      g.addColorStop(0, `rgba(0,0,0,${a0})`);
      g.addColorStop(1, `rgba(0,0,0,${a1})`);
      m.fillStyle = g;
      m.fillRect(w - fadePx, 0, fadePx, h);

      m.restore();

      mask._fadePx = fadePx;
      mask._minAlpha = minAlpha;
      mask._radiiKey = radiiKey;
      lens._maskCanvas = mask;
    }

    // Multiply drawn content by mask alpha
    lens.ctx.save();
    lens.ctx.globalCompositeOperation = 'destination-in';
    lens.ctx.drawImage(mask, 0, 0);
    lens.ctx.globalCompositeOperation = 'source-over';
    lens.ctx.restore();
  }

  // Additional multiplicative mask that leaves the first fade (0..startPx)
  // intact (factor=1), then linearly falls to relMinAlpha by endPx, and stays
  // at relMinAlpha deeper inside. This composes with the first mask so center
  // goes from ~0.15 down to ~0.01 without altering the edge glow.
  applyInteriorFalloffMask(lens, startPx, topEndPx, rightEndPx, bottomEndPx, leftEndPx, relMinAlpha, featherPx = 0) {
    const w = lens.canvas.width | 0;
    const h = lens.canvas.height | 0;
    if (!w || !h) return;

    const s = Math.max(0, Math.round(startPx || 0));
    const et = Math.max(s + 1, Math.min(h, Math.round(topEndPx || (s + 20))));
    const er = Math.max(s + 1, Math.min(w, Math.round(rightEndPx || (s + 20))));
    const eb = Math.max(s + 1, Math.min(h, Math.round(bottomEndPx || (s + 20))));
    const el = Math.max(s + 1, Math.min(w, Math.round(leftEndPx || (s + 20))));
    const f = Math.max(0, Math.round(featherPx || 0));
    const etf = Math.min(h, et + f);
    const erf = Math.min(w, er + f);
    const ebf = Math.min(h, eb + f);
    const elf = Math.min(w, el + f);
    const aInterior = Math.max(0, Math.min(1, relMinAlpha != null ? relMinAlpha : 1));

    // cache by geometry + params
    let mask = lens._maskInterior;
    const key = `${w}|${h}|${s}|${et}|${er}|${eb}|${el}|${aInterior}|${f}`;
    if (!mask || mask.width !== w || mask.height !== h || mask._key !== key) {
      mask = document.createElement('canvas');
      mask.width = w; mask.height = h;
      const m = mask.getContext('2d');

      // Determine border radii to inherit from container
      const cs = getComputedStyle(lens.element);
      const px = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
      const radii = {
        tl: px(cs.borderTopLeftRadius),
        tr: px(cs.borderTopRightRadius),
        br: px(cs.borderBottomRightRadius),
        bl: px(cs.borderBottomLeftRadius)
      };

      // Rounded-rect clip util
      const rr = (ctx, x, y, w, h, r) => {
        const tl = Math.max(0, r.tl || 0);
        const tr = Math.max(0, r.tr || 0);
        const br = Math.max(0, r.br || 0);
        const bl = Math.max(0, r.bl || 0);
        ctx.beginPath();
        ctx.moveTo(x + tl, y);
        ctx.lineTo(x + w - tr, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
        ctx.lineTo(x + w, y + h - br);
        ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
        ctx.lineTo(x + bl, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
        ctx.lineTo(x, y + tl);
        ctx.quadraticCurveTo(x, y, x + tl, y);
        ctx.closePath();
      };

      // Clip to rounded rect and start with interior factor
      m.save();
      rr(m, 0, 0, w, h, radii);
      m.clip();
      m.fillStyle = `rgba(0,0,0,${aInterior})`;
      m.fillRect(0, 0, w, h);

      // Helper to draw a three-stop gradient strip: [0..s]=1, [s..e]=1→aInterior
      // Easing helper (smoothstep) for a softer transition
      const ease = (t) => t * t * (3 - 2 * t);
      const addEasedStopsLin = (grad, startPx, endPx, total) => {
        const ts = [0, 0.25, 0.5, 0.75, 1];
        for (const t of ts) {
          const e = ease(t);
          const a = 1 + (aInterior - 1) * e;
          const pos = (startPx + (endPx - startPx) * t) / total;
          grad.addColorStop(Math.max(0, Math.min(1, pos)), `rgba(0,0,0,${a})`);
        }
      };

      // Top strip (with feather)
      let g = m.createLinearGradient(0, 0, 0, etf);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(s / etf, 'rgba(0,0,0,1)');
      addEasedStopsLin(g, s, etf, etf);
      m.fillStyle = g; m.fillRect(0, 0, w, etf);

      // Bottom strip
      g = m.createLinearGradient(0, h, 0, h - ebf);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(s / ebf, 'rgba(0,0,0,1)');
      addEasedStopsLin(g, s, ebf, ebf);
      m.fillStyle = g; m.fillRect(0, h - ebf, w, ebf);

      // Left strip
      g = m.createLinearGradient(0, 0, elf, 0);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(s / elf, 'rgba(0,0,0,1)');
      addEasedStopsLin(g, s, elf, elf);
      m.fillStyle = g; m.fillRect(0, 0, elf, h);

      // Right strip
      g = m.createLinearGradient(w, 0, w - erf, 0);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(s / erf, 'rgba(0,0,0,1)');
      addEasedStopsLin(g, s, erf, erf);
      m.fillStyle = g; m.fillRect(w - erf, 0, erf, h);

      // Corner compensation with quarter-circle radial gradients so the
      // falloff follows rounded corners rather than square joints.
      const cs2 = getComputedStyle(lens.element);
      const px2 = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
      const rTL = px2(cs2.borderTopLeftRadius);
      const rTR = px2(cs2.borderTopRightRadius);
      const rBR = px2(cs2.borderBottomRightRadius);
      const rBL = px2(cs2.borderBottomLeftRadius);

      // Helper to draw a quarter radial gradient
      const cornerGrad = (cx, cy, rx, ry, rCorner) => {
        const rMax = Math.max(1, Math.min(Math.min(rx, ry), rCorner + Math.max(etf, erf, ebf, elf)));
        const rc = Math.max(s + 1, Math.min(rMax, Math.min(rx, ry)));
        const gg = m.createRadialGradient(cx, cy, 0, cx, cy, rc);
        gg.addColorStop(0, 'rgba(0,0,0,1)');
        gg.addColorStop(Math.min(1, s / rc), 'rgba(0,0,0,1)');
        // Eased stops within the corner radius
        const ts = [0.25, 0.5, 0.75, 1];
        for (const t of ts) {
          const e = ease(t);
          const a = 1 + (aInterior - 1) * e;
          gg.addColorStop(Math.min(1, (s + (rc - s) * t) / rc), `rgba(0,0,0,${a})`);
        }
        m.fillStyle = gg;
      };

      // Top-left
      m.save();
      m.beginPath();
      m.moveTo(0, 0);
      m.arc(rTL, rTL, Math.min(et, el), Math.PI, 1.5*Math.PI);
      m.lineTo(0, 0);
      m.closePath();
      m.clip();
      cornerGrad(rTL, rTL, elf, etf, rTL);
      m.fillRect(0, 0, Math.min(elf, rTL + etf), Math.min(etf, rTL + elf));
      m.restore();

      // Top-right
      m.save();
      m.beginPath();
      m.moveTo(w, 0);
      m.arc(w - rTR, rTR, Math.min(et, er), -Math.PI/2, 0);
      m.lineTo(w, 0);
      m.closePath();
      m.clip();
      cornerGrad(w - rTR, rTR, erf, etf, rTR);
      m.fillRect(w - Math.min(erf, rTR + etf), 0, Math.min(erf, rTR + etf), Math.min(etf, rTR + erf));
      m.restore();

      // Bottom-right
      m.save();
      m.beginPath();
      m.moveTo(w, h);
      m.arc(w - rBR, h - rBR, Math.min(eb, er), 0, Math.PI/2);
      m.lineTo(w, h);
      m.closePath();
      m.clip();
      cornerGrad(w - rBR, h - rBR, erf, ebf, rBR);
      m.fillRect(w - Math.min(erf, rBR + ebf), h - Math.min(ebf, rBR + erf), Math.min(erf, rBR + ebf), Math.min(ebf, rBR + erf));
      m.restore();

      // Bottom-left
      m.save();
      m.beginPath();
      m.moveTo(0, h);
      m.arc(rBL, h - rBL, Math.min(eb, el), Math.PI/2, Math.PI);
      m.lineTo(0, h);
      m.closePath();
      m.clip();
      cornerGrad(rBL, h - rBL, elf, ebf, rBL);
      m.fillRect(0, h - Math.min(ebf, rBL + elf), Math.min(elf, rBL + ebf), Math.min(ebf, rBL + elf));
      m.restore();
      m.restore();

      mask._key = key;
      lens._maskInterior = mask;
    }

    const ctx = lens.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(lens._maskInterior, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  drawFallbackEffect(lens) {
    const rect = lens.element.getBoundingClientRect();
    lens.ctx.clearRect(0, 0, rect.width, rect.height);

    const gradient = lens.ctx.createRadialGradient(
      rect.width / 2, rect.height / 2, 0,
      rect.width / 2, rect.height / 2, Math.max(rect.width, rect.height) / 2
    );
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.1)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0.02)');

    lens.ctx.fillStyle = gradient;
    lens.ctx.fillRect(0, 0, rect.width, rect.height);
  }

  // Specular highlight band that brightens toward white based on
  // both a vertical gradient (top→bottom) and the underlying
  // content luminance (dark content receives little/no highlight).
  applySpecularHighlightBand(lens) {
    const cfg = lens.specular || {};
    const w = lens.canvas.width | 0;
    const h = lens.canvas.height | 0;
    if (!w || !h) return;

    const top = Math.max(0, Math.min(h, Math.round(cfg.top || 0)));
    const height = Math.max(1, Math.min(h - top, Math.round(cfg.height || 1)));
    const left = Math.max(0, Math.min(w - 1, Math.round(cfg.left || 0)));
    const right = Math.max(0, Math.min(w - left - 1, Math.round(cfg.right || 0)));
    const bandW = Math.max(1, w - left - right);
    const strength = Math.max(0, Math.min(1, cfg.strength || 0.35));
    const gamma = Math.max(0.1, cfg.gamma || 1.0);
    const radius = Math.max(0, Math.min(64, cfg.radius || Math.min(16, height / 2)));

    // Copy the current band region into an offscreen canvas
    const off = document.createElement('canvas');
    off.width = bandW; off.height = height;
    const octx = off.getContext('2d', { willReadFrequently: true });
    octx.drawImage(lens.canvas, left, top, bandW, height, 0, 0, bandW, height);

    const img = octx.getImageData(0, 0, bandW, height);
    const data = img.data;
    const inv255 = 1 / 255;
    for (let y = 0; y < height; y++) {
      // vertical factor: 1 at top → 0 at bottom
      const v = 1 - (y / (height - 1 || 1));
      for (let x = 0; x < bandW; x++) {
        const i = (y * bandW + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        // relative luminance (sRGB)
        let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        let ln = Math.pow(lum * inv255, gamma); // luminance gate (no hard threshold)
        const s = strength * v * ln; // final mix toward white
        if (s > 0) {
          data[i]     = Math.min(255, Math.round(r + (255 - r) * s));
          data[i + 1] = Math.min(255, Math.round(g + (255 - g) * s));
          data[i + 2] = Math.min(255, Math.round(b + (255 - b) * s));
          // leave alpha unchanged
        }
      }
    }
    octx.putImageData(img, 0, 0);

    // Draw back with rounded-rect clipping to create pill-like band
    const ctx = lens.ctx;
    ctx.save();
    const rr = (c, x, y, w, h, r) => {
      const rad = Math.max(0, r || 0);
      c.beginPath();
      c.moveTo(x + rad, y);
      c.lineTo(x + w - rad, y);
      c.quadraticCurveTo(x + w, y, x + w, y + rad);
      c.lineTo(x + w, y + h - rad);
      c.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
      c.lineTo(x + rad, y + h);
      c.quadraticCurveTo(x, y + h, x, y + h - rad);
      c.lineTo(x, y + rad);
      c.quadraticCurveTo(x, y, x + rad, y);
      c.closePath();
    };
    rr(ctx, left, top, bandW, height, radius);
    ctx.clip();
    ctx.drawImage(off, left, top);
    ctx.restore();
  }

  applyEdgeDistortion(lens, strength) {
    const canvas = lens.canvas;
    const ctx = lens.ctx;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const outputData = ctx.createImageData(imageData);

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;

    // Copy original data first
    for (let i = 0; i < outputData.data.length; i++) {
      outputData.data[i] = imageData.data[i];
    }

    // Apply barrel distortion at edges only (85%+ from center)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - centerX;
        const dy = y - centerY;

        const normalizedX = Math.abs(dx) / centerX;
        const normalizedY = Math.abs(dy) / centerY;
        const edgeProximity = Math.max(normalizedX, normalizedY);

        if (edgeProximity > 0.85) {
          const edgeFactor = (edgeProximity - 0.85) / 0.15;
          const distortionAmount = strength * edgeFactor * edgeFactor * 2.0;

          const distance = Math.sqrt(dx * dx + dy * dy);
          const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY);
          const normalizedDistance = distance / maxDistance;

          const distortion = 1.0 + distortionAmount * normalizedDistance;

          const sourceX = centerX + (dx / distortion);
          const sourceY = centerY + (dy / distortion);

          if (sourceX >= 0 && sourceX < width - 1 && sourceY >= 0 && sourceY < height - 1) {
            const destIndex = (y * width + x) * 4;
            const sourceIndex = (Math.floor(sourceY) * width + Math.floor(sourceX)) * 4;

            // Copy pixel data
            outputData.data[destIndex] = imageData.data[sourceIndex];
            outputData.data[destIndex + 1] = imageData.data[sourceIndex + 1];
            outputData.data[destIndex + 2] = imageData.data[sourceIndex + 2];
            outputData.data[destIndex + 3] = imageData.data[sourceIndex + 3];
          }
        }
      }
    }

    ctx.putImageData(outputData, 0, 0);
  }

  // Multiply RGB channels by constant gain in linear light, then convert
  // back to sRGB. Preserves alpha. This avoids gamma artifacts (banding/
  // hue shifts) compared to naive sRGB multiplication.
  applyBrightnessGain(lens, gain = 1) {
    if (!isFinite(gain) || Math.abs(gain - 1) < 1e-3) return;
    const w = lens.canvas.width | 0;
    const h = lens.canvas.height | 0;
    if (!w || !h) return;
    const img = lens.ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const g = gain > 0 ? gain : 0;
    const inv255 = 1 / 255;
    const srgbToLinear = (cs) => (cs <= 0.04045 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4));
    const linearToSrgb = (cl) => (cl <= 0.0031308 ? cl * 12.92 : 1.055 * Math.pow(cl, 1 / 2.4) - 0.055);
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i] * inv255; let gl = d[i + 1] * inv255; let b = d[i + 2] * inv255;
      let rl = srgbToLinear(r); let glin = srgbToLinear(gl); let bl = srgbToLinear(b);
      rl *= g; glin *= g; bl *= g;
      if (rl > 1) rl = 1; if (glin > 1) glin = 1; if (bl > 1) bl = 1;
      d[i]     = Math.max(0, Math.min(255, Math.round(linearToSrgb(rl) * 255)));
      d[i + 1] = Math.max(0, Math.min(255, Math.round(linearToSrgb(glin) * 255)));
      d[i + 2] = Math.max(0, Math.min(255, Math.round(linearToSrgb(bl) * 255)));
      // alpha unchanged
    }
    lens.ctx.putImageData(img, 0, 0);
  }

  // Build or reuse a noise tile canvas
  _getNoiseTile(size = 128, mono = true) {
    this._noiseCache = this._noiseCache || {};
    const key = `${size}|${mono?1:0}`;
    if (this._noiseCache[key]) return this._noiseCache[key];
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const data = img.data;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const n = (Math.random() * 255) | 0; // uniform noise
        if (mono) {
          data[i] = data[i + 1] = data[i + 2] = n;
        } else {
          data[i] = n;
          data[i + 1] = (Math.random() * 255) | 0;
          data[i + 2] = (Math.random() * 255) | 0;
        }
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this._noiseCache[key] = c;
    return c;
  }

  // Overlay tiled noise using soft-light blending and configurable alpha
  applyNoiseOverlay(lens) {
    const cfg = lens.noise || {};
    const tile = this._getNoiseTile(cfg.size || 128, !!cfg.mono);
    const ctx = lens.ctx;
    ctx.save();
    try {
      ctx.globalAlpha = Math.max(0, Math.min(1, cfg.alpha != null ? cfg.alpha : 0.15));
      // Prefer soft-light; fall back to overlay if unsupported
      const prev = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'soft-light';
      if (ctx.globalCompositeOperation !== 'soft-light') {
        ctx.globalCompositeOperation = 'overlay';
      }
      const pattern = ctx.createPattern(tile, 'repeat');
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, lens.canvas.width, lens.canvas.height);
      ctx.globalCompositeOperation = prev;
    } finally {
      ctx.restore();
    }
  }


  // Additional vertical band opacity mask
  // Multiplies existing alpha so that within a rounded-rect band near the top
  // the opacity transitions from 1.0 (top of band) to 0.15 (bottom of band).
  // Outside the band, alpha remains unchanged.
  applyTopBandOpacityMask(lens) {
    const cfg = lens.bandMask || {};
    const w = lens.canvas.width | 0;
    const h = lens.canvas.height | 0;
    if (!w || !h) return;

    const top = Math.max(0, Math.min(h, Math.round(cfg.top || 0)));
    const height = Math.max(1, Math.min(h - top, Math.round(cfg.height || 1)));
    const left = Math.max(0, Math.min(w - 1, Math.round(cfg.left || 0)));
    const right = Math.max(0, Math.min(w - left - 1, Math.round(cfg.right || 0)));
    const bandW = Math.max(1, w - left - right);
    const alphaTop = (typeof cfg.alphaTop === 'number') ? cfg.alphaTop : 1.0;
    const alphaBottom = (typeof cfg.alphaBottom === 'number') ? cfg.alphaBottom : 0.15;
    const radius = Math.min(height / 2, 16);

    const ctx = lens.ctx;
    ctx.save();
    try {
      // Build a vertical gradient of the amount to subtract from alpha.
      // Using destination-out: dest_alpha = dest_alpha * (1 - src_alpha)
      // If src_alpha = (1 - desiredAlpha), result = dest * desiredAlpha.
      const g = ctx.createLinearGradient(0, top, 0, top + height);
      g.addColorStop(0, `rgba(0,0,0,${Math.max(0, 1 - alphaTop)})`);
      g.addColorStop(1, `rgba(0,0,0,${Math.max(0, 1 - alphaBottom)})`);
      ctx.fillStyle = g;

      // Draw a rounded-rect band
      const rr = (c, x, y, w, h, r) => {
        const rad = Math.max(0, r || 0);
        c.beginPath();
        c.moveTo(x + rad, y);
        c.lineTo(x + w - rad, y);
        c.quadraticCurveTo(x + w, y, x + w, y + rad);
        c.lineTo(x + w, y + h - rad);
        c.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
        c.lineTo(x + rad, y + h);
        c.quadraticCurveTo(x, y + h, x, y + h - rad);
        c.lineTo(x, y + rad);
        c.quadraticCurveTo(x, y, x + rad, y);
        c.closePath();
      };

      ctx.globalCompositeOperation = 'destination-out';
      rr(ctx, left, top, bandW, height, radius);
      ctx.fill();
    } finally {
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    }
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new NeonGlassLensEffect();
});

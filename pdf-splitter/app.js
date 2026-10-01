/* 试卷切分助手 - 前端逻辑
   pdf.js 负责解析/预览，pdf-lib 负责按栏裁剪并放大到 A4 */
(function () {
  'use strict';

  // PDF.js worker；https 下正常，file:// 下加载失败会自动回退到主线程
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
  }
  var PDFLib = window.PDFLib;
  var A4W = 595.276, A4H = 841.89;

  var state = {
    file: null,
    ab: null,            // 原始 ArrayBuffer
    bytes: null,         // 旋转归一化后的字节；预览与输出共用同一份，坐标系才一致
    pdf: null,           // pdf.js 文档
    sizes: [],           // 每页 {W,H}（归一化 + 用户手动旋转后的实际显示尺寸）
    userRot: [],         // 每页用户在预览里手动追加的旋转角度 0/90/180/270
    cuts: [],            // 每页分割线边界占页宽比例（智能识别/手动拖动会写它）
    mode: '2',           // 默认「左右 2 栏」；取值 '2' / '3' / 'auto'(智能识别)
    marginX: 10,         // 左右边距 mm，滑块 0–20
    marginY: 20,         // 上下边距 mm，滑块 0–40（决定放大率）
    shift: 0,
    trim: false,         // 默认不勾；用户勾过一次就记住（见 TRIM_KEY）
    busy: false,
    resultBytes: null,
    resultUrl: null,
    resultName: 'split.pdf'
  };

  // ---- DOM ----
  var $ = function (id) { return document.getElementById(id); };
  var dropzone = $('dropzone'), fileInput = $('file-input');
  var cardUpload = $('card-upload'), cardFile = $('card-file'),
      cardConfig = $('card-config'), cardPreview = $('card-preview'),
      cardResult = $('card-result'), abProg = $('ab-prog'),
      actionBar = $('action-bar');
  var pvGrid = $('pv-grid');

  // ---- 工具函数 ----
  function fmtSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  }
  // ---- 分割线模型：每页一组内部边界占页宽比例（不含全局 shift）----
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function equalCuts(n) { var a = []; for (var k = 1; k < n; k++) a.push(k / n); return a; }
  // 取某页当前边界；未设置时按当前模式给默认（auto 未检测前暂按 2 栏）
  function cutsFor(i) {
    if (state.cuts[i]) return state.cuts[i];
    var n = state.mode === 'auto' ? 2 : (parseInt(state.mode, 10) || 1);
    return equalCuts(n);
  }
  function numBands(i) { return cutsFor(i).length + 1; }
  // 由 cuts + 全局 shift 算出该页各栏像素矩形（预览与切分共用，坐标才一致）
  function bandsFor(i, W, H) {
    var cuts = cutsFor(i), n = cuts.length + 1, cw = W / n, shiftPx = state.shift / 100 * cw;
    var bounds = [0];
    for (var k = 0; k < cuts.length; k++) bounds.push(clamp(cuts[k] * W + shiftPx, 1, W - 1));
    bounds.push(W);
    for (k = 1; k < bounds.length; k++) if (bounds[k] <= bounds[k - 1]) bounds[k] = Math.min(W, bounds[k - 1] + 1);
    var bands = [];
    for (k = 0; k < n; k++) bands.push({ left: bounds[k], right: bounds[k + 1], bottom: 0, top: H });
    return bands;
  }

  // 比例兜底（仅内容渲染失败时用）
  function detectCols(W, H) {
    var r = W / H;
    if (r >= 1.85) return 3;
    if (r >= 1.2) return 2;
    return 1;
  }
  function groupRuns(flag, w) {
    var runs = [], s = -1;
    for (var x = 0; x < w; x++) { if (flag[x] && s < 0) s = x; else if (!flag[x] && s >= 0) { runs.push({ start: s, end: x - 1 }); s = -1; } }
    if (s >= 0) runs.push({ start: s, end: w - 1 });
    return runs;
  }
  // 从位图算分割线：①优先找竖线(含断续但贯穿上下的分隔线) ②没竖线按空白沟 ③窄边条并入相邻栏
  function detectCutsFromCanvas(ctx, w, h) {
    var data = ctx.getImageData(0, 0, w, h).data;
    var colInk = new Int32Array(w), x, y;
    for (x = 0; x < w; x++) { var c = 0; for (y = 0; y < h; y++) { var p = (y * w + x) * 4; if (data[p] < 200 || data[p + 1] < 200 || data[p + 2] < 200) c++; } colInk[x] = c; }
    var cuts = null;
    // ① 竖线：某列纵向墨迹占比高且很窄
    var lineT = Math.round(h * 0.45), isLine = new Uint8Array(w);
    for (x = 0; x < w; x++) isLine[x] = colInk[x] >= lineT ? 1 : 0;
    var lineCuts = [];
    groupRuns(isLine, w).forEach(function (r) {
      var wd = r.end - r.start + 1, ctr = (r.start + r.end) / 2 / w;
      if (wd <= Math.max(3, Math.round(w * 0.03)) && ctr > 0.12 && ctr < 0.88) lineCuts.push(ctr);
    });
    if (lineCuts.length >= 1) { cuts = lineCuts; }
    else {
      // ② 空白沟分栏
      var inkT = Math.max(2, Math.round(h * 0.012)), hasInk = new Uint8Array(w);
      for (x = 0; x < w; x++) hasInk[x] = colInk[x] > inkT ? 1 : 0;
      var minGap = Math.max(4, Math.round(w * 0.02)), merged = [];
      groupRuns(hasInk, w).forEach(function (b) {
        if (merged.length && b.start - merged[merged.length - 1].end < minGap) merged[merged.length - 1].end = b.end;
        else merged.push({ start: b.start, end: b.end });
      });
      merged = merged.filter(function (b) { return (b.end - b.start) >= w * 0.03; });
      if (merged.length >= 2) {
        cuts = [];
        for (var k = 1; k < merged.length; k++) cuts.push((merged[k - 1].end + merged[k].start) / 2 / w);
        // ③ 窄边条并入相邻栏（首/尾太窄则去掉那个切点）
        var total = merged[merged.length - 1].end - merged[0].start;
        if (cuts.length && (merged[0].end - merged[0].start) < total * 0.16) cuts.shift();
        if (cuts.length && (merged[merged.length - 1].end - merged[merged.length - 1].start) < total * 0.16) cuts.pop();
      } else { cuts = []; }
    }
    cuts.sort(function (a, b) { return a - b; });
    if (cuts.length > 2) cuts = cuts.slice(0, 2);   // 最多 3 栏
    return cuts;
  }
  function analyzeCuts(pno) {
    function fallback() { var s = state.sizes[pno]; return s ? equalCuts(detectCols(s.W, s.H)) : []; }
    return state.pdf.getPage(pno + 1).then(function (page) {
      var base = page.getViewport({ scale: 1 });
      var scale = Math.min(1, 420 / base.width);
      var vp = page.getViewport({ scale: scale });
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(vp.width));
      canvas.height = Math.max(1, Math.ceil(vp.height));
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
        var cuts;
        try { cuts = detectCutsFromCanvas(ctx, canvas.width, canvas.height); }
        catch (err) { console.error('detectCuts 失败', err); cuts = fallback(); }
        canvas.width = canvas.height = 0; return cuts;
      });
    }).catch(function (e) { console.error('analyzeCuts 失败', pno, e); return fallback(); });
  }
  // 智能识别：逐页内容检测，结果写入 state.cuts
  function detectAllCols() {
    if (!state.pdf) return Promise.resolve();
    state.cuts = [];
    var jobs = [];
    for (var i = 0; i < state.sizes.length; i++) {
      (function (idx) { jobs.push(analyzeCuts(idx).then(function (c) { state.cuts[idx] = c; })); })(i);
    }
    return Promise.all(jobs).then(function () { updateOverlays(); });
  }
  // 固定栏数：把所有页铺成等分
  function applyEqualCuts(n) { state.cuts = []; for (var i = 0; i < state.sizes.length; i++) state.cuts[i] = equalCuts(n); }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

  // ---- 旋转校正 ----
  // pdf.js 的 viewport 会应用 /Rotate，而 pdf-lib 的 getSize()/embedPage() 完全忽略它，
  // 所以必须先烘焙旋转，否则预览与裁剪用的是两套坐标，输出还会横倒。
  // 下面四个矩阵把页面内容按 /Rotate 顺时针旋转到显示方向，已用文本坐标逐一实测核对。
  var ROT_MATRIX = {
    0:   function (W, H) { return [1, 0, 0, 1, 0, 0]; },
    90:  function (W, H) { return [0, -1, 1, 0, 0, W]; },
    180: function (W, H) { return [-1, 0, 0, -1, W, H]; },
    270: function (W, H) { return [0, 1, -1, 0, H, 0]; }
  };

  function readRot(page) {
    var v = null;
    try {
      // /Rotate 是可继承属性，可能只写在祖先 Pages 节点上。
      // getInheritableAttribute 会从本页沿整条父链向上取第一个有值的节点；
      // 旧代码只查了一级 Parent，深层继承的旋转会被漏判，导致输出方向错误。
      v = page.node.getInheritableAttribute
        ? page.node.getInheritableAttribute(PDFLib.PDFName.of('Rotate'))
        : page.node.get(PDFLib.PDFName.of('Rotate'));
    } catch (e) { /* 取不到就当不旋转 */ }
    var deg = v && typeof v.numberValue === 'number' ? v.numberValue : 0;
    deg = ((deg % 360) + 360) % 360;
    return deg === 90 || deg === 180 || deg === 270 ? deg : 0;
  }

  // 每页总旋转 = PDF 声明的 /Rotate + 用户在预览里手动追加的旋转
  function pageRot(page, i) {
    return (readRot(page) + (state.userRot[i] || 0)) % 360;
  }
  // 返回归一化 + 用户旋转后的字节；所有页都无需旋转时返回 null，让调用方直接用原字节，省一次重存
  function normalizeRotation(doc) {
    var pages = doc.getPages();
    var rots = pages.map(function (p, i) { return pageRot(p, i); });
    // 只要某页有「声明 /Rotate」或「用户手动旋转」（任一非 0）就得重存——
    // 即便二者相加正好抵消成 0，也必须重存把声明的 /Rotate 剥进几何；
    // 否则预览(pdf.js 自动应用 /Rotate) 与切分(pdf-lib 忽略 /Rotate) 坐标会错位。
    var need = false;
    for (var i = 0; i < pages.length; i++) {
      if (readRot(pages[i]) !== 0 || (state.userRot[i] || 0) !== 0) { need = true; break; }
    }
    if (!need) return Promise.resolve(null);

    var out = null;
    var chain = PDFLib.PDFDocument.create().then(function (d) { out = d; });
    pages.forEach(function (page, i) {
      chain = chain.then(function () {
        var rot = rots[i];
        var sz = page.getSize(), W = sz.width, H = sz.height;
        return out.embedPage(page, { left: 0, bottom: 0, right: W, top: H }, ROT_MATRIX[rot](W, H))
          .then(function (emb) {
            var dims = rot % 180 === 90 ? [H, W] : [W, H];
            out.addPage(dims).drawPage(emb, { x: 0, y: 0, width: emb.width, height: emb.height });
          });
      });
    });
    return chain.then(function () { return out.save({ useObjectStreams: true }); });
  }

  // ---- 裁白边 ----
  // 把该栏渲染成位图，扫出有墨迹的最小矩形，作为真正的裁剪框
  var TRIM_PAD = 3;        // pt，留一点余量避免削到笔画

  function scanInk(data, w, h, scale, ox) {
    var minX = -1, maxX = -1, minY = -1, maxY = -1;
    for (var y = 0; y < h; y++) {
      var rowHas = false;
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) {
          rowHas = true;
          if (x < minX || minX < 0) minX = x;
          if (x > maxX) maxX = x;
        }
      }
      if (rowHas) {
        if (minY < 0) minY = y;
        maxY = y;
      }
    }
    if (minX < 0) return null;
    var left = minX / scale + ox - TRIM_PAD;
    var right = (maxX + 1) / scale + ox + TRIM_PAD;
    var top = minY / scale - TRIM_PAD;
    var bottom = (maxY + 1) / scale + TRIM_PAD;
    return { left: left, right: right, top: top, bottom: bottom };  // y 向下，调用方换算
  }

  function scanBands(ctx, scale, pageH, bands) {
    return bands.map(function (bd) {
      var px0 = Math.max(0, Math.floor(bd.left * scale));
      var px1 = Math.min(ctx.canvas.width, Math.ceil(bd.right * scale));
      var pw = px1 - px0;
      if (pw <= 0 || ctx.canvas.height <= 0) return null;
      var box = scanInk(ctx.getImageData(px0, 0, pw, ctx.canvas.height).data,
                        pw, ctx.canvas.height, scale, px0 / scale);
      if (!box) return null;
      var res = {
        left: Math.max(bd.left, box.left),
        right: Math.min(bd.right, box.right),
        bottom: Math.max(0, pageH - box.bottom),
        top: Math.min(pageH, pageH - box.top)
      };
      return res.right - res.left > 8 && res.top - res.bottom > 8 ? res : null;
    });
  }

  // 预览已经栅格化过的页，直接复用它的位图，同一页不必渲染两遍
  function paintedPreview(pno) {
    if (previewItems.length !== state.sizes.length) return null;  // 预览与新文件不同步时不复用
    var it = previewItems[pno];
    if (!it || !it.painted) return null;
    var c = it.el.querySelector('canvas');
    if (!c || c.width < 80 || c.height < 80) return null;
    return c;
  }

  // 返回每栏收紧后的裁剪框；检测不到墨迹的栏返回 null，由调用方保留原始整栏
  function trimBands(pno, pageH, bands) {
    var pc = paintedPreview(pno);
    var sz = state.sizes[pno];
    if (pc && sz) {
      return Promise.resolve(scanBands(pc.getContext('2d'), pc.width / sz.W, pageH, bands));
    }
    return state.pdf.getPage(pno + 1).then(function (page) {
      var vp0 = page.getViewport({ scale: 1 });
      // 与预览同一尺度，保证屏幕内外的页切出来的边距一致
      var scale = Math.min(2, RENDER_W / vp0.width);
      var vp = page.getViewport({ scale: scale });
      var canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
        return scanBands(ctx, scale, pageH, bands);
      }).then(function (r) {
        canvas.width = canvas.height = 0;   // 及时释放，扫描件位图很占内存
        return r;
      }, function (e) {
        canvas.width = canvas.height = 0;
        console.error('trim failed', pno, e);
        return bands.map(function () { return null; });
      });
    });
  }

  // ---- 选择文件 ----
  dropzone.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) loadFile(fileInput.files[0]);
    fileInput.value = '';
  });
  $('btn-repick').addEventListener('click', function () { fileInput.click(); });
  $('btn-repick2').addEventListener('click', function () { fileInput.click(); });

  // ---- 预览内手动旋转：点页卡片左上/右上角的 ⟳，该页逆/顺时针转 90° ----
  pvGrid.addEventListener('click', function (e) {
    var btn = e.target.closest('.pv-rot');
    if (!btn) return;
    if (state.busy) return;                       // 切分处理中不打断
    var item = btn.closest('.pv-item');
    var idx = item && parseInt(item.getAttribute('data-idx'), 10);
    if (isNaN(idx)) return;
    var step = parseInt(btn.getAttribute('data-rot'), 10);
    if (step !== 90 && step !== 270) step = 90;   // 只认 ±90（270 即逆时针 90）
    state.userRot[idx] = ((state.userRot[idx] || 0) + step) % 360;
    // 旋转会改变页面尺寸/栏数，需重算字节并作废旧结果
    reloadPreview().then(resetResult);
  });

  // ---- 整篇旋转：一次把所有页都转 90°，省去逐页点 ----
  // 与单页按钮共用同一 userRot 数组（按页累加），所以整篇转后仍可再单页微调
  function rotateAll(step) {
    if (state.busy) return;                       // 切分处理中不打断
    for (var i = 0; i < state.sizes.length; i++) {
      state.userRot[i] = ((state.userRot[i] || 0) + step) % 360;
    }
    reloadPreview().then(resetResult);
  }
  $('btn-rot-all-left').addEventListener('click', function () { rotateAll(270); });   // 左旋 90° = +270°
  $('btn-rot-all-right').addEventListener('click', function () { rotateAll(90); });   // 右旋 90°

  function loadFile(file) {
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      alert('请选择 PDF 文件');
      return;
    }
    resetResult();
    cardResult.hidden = true;
    cardFile.hidden = true;
    cardConfig.hidden = true;
    cardPreview.hidden = true;
    actionBar.hidden = true;

    file.arrayBuffer().then(function (ab) {
      state.file = file;
      state.ab = ab;
      state.userRot = [];                 // 新文件清空手动旋转
      state.cuts = [];                    // 新文件清空自定义分割线
      setMode('2');                       // 新文件/换文件：默认回到「左右 2 栏」
      $('fi-name').textContent = file.name;
      cardFile.hidden = false;
      cardConfig.hidden = false;
      cardPreview.hidden = false;
      actionBar.hidden = false;
      cardUpload.hidden = true;
      return reloadPreview().then(function () {
        $('fi-sub').textContent = state.sizes.length + ' 页 · ' + fmtSize(file.size);
      });
    }).catch(function (e) {
      console.error(e);
      alert('无法打开该 PDF：\n' + (e && e.message ? e.message : e) +
        '\n（若是加密文件，请先去除密码）');
    });
  }

  function ab2bytes(ab) { return new Uint8Array(ab); }

  // 按当前 userRot 从原始字节重算「已烘焙旋转」的工作字节，并刷新预览。
  // 预览与切分共用这份字节，坐标系才始终一致；每次都从原始 ab 重建，不随点击次数累积失真。
  function reloadPreview() {
    return PDFLib.PDFDocument.load(state.ab.slice(0), { ignoreEncryption: true })
      .then(function (doc) { return normalizeRotation(doc); })
      .then(function (norm) {
        state.bytes = norm || ab2bytes(state.ab);
        return openPdf();
      })
      .then(function () {
        buildPreview();
        if (state.mode === 'auto') detectAllCols();   // 旋转后内容朝向变了，智能识别需重算
      });
  }

  function openPdf() {
    // 换文件时释放上一份：pdf.js 的文档缓存与 worker 会一直占着内存，手机上吃紧
    var prev = state.pdf;
    state.pdf = null;
    var rel = prev ? prev.destroy().catch(function () {}) : Promise.resolve();
    return rel.then(function () {
      return pdfjsLib.getDocument({ data: state.bytes.slice(0) }).promise;
    }).then(function (pdf) {
      state.pdf = pdf;
      var jobs = [];
      for (var i = 1; i <= pdf.numPages; i++) {
        jobs.push(pdf.getPage(i).then(function (p) {
          var v = p.getViewport({ scale: 1 });
          return { W: v.width, H: v.height };
        }));
      }
      return Promise.all(jobs).then(function (arr) {
        state.sizes = arr;
      });
    });
  }

  // ---- 预览 ----
  var RENDER_W = 820; // 预览 canvas 逻辑宽度
  var previewItems = [];
  function buildPreview() {
    pvGrid.innerHTML = '';
    var items = previewItems = [];
    for (var i = 0; i < state.sizes.length; i++) {
      (function (idx) {
        var s = state.sizes[idx];
        var item = document.createElement('div');
        item.className = 'pv-item';
        item.setAttribute('data-idx', idx);
        item.innerHTML =
          '<div class="pv-wrap" style="aspect-ratio:' + Math.round(s.W) + ' / ' + Math.round(s.H) + '">' +
            '<canvas></canvas>' +
            '<div class="cut-layer"></div>' +
            '<button type="button" class="pv-rot pv-rot-l" data-rot="270" title="此页逆时针转 90°" aria-label="此页逆时针转 90°">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>' +
            '</button>' +
            '<button type="button" class="pv-rot pv-rot-r" data-rot="90" title="此页顺时针转 90°" aria-label="此页顺时针转 90°">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>' +
            '</button>' +
          '</div>' +
          '<div class="pv-foot"></div>';
        pvGrid.appendChild(item);
        items.push({ idx: idx, el: item, s: s, rendered: false, painted: false });
      })(i);
    }
    updateOverlays();

    // 懒加载渲染
    if (!('IntersectionObserver' in window)) {
      items.forEach(function (it) { renderItem(it); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        // 切分时预览与裁白边检测共用同一个 pdf.js 队列，处理中先让路，
        // 不 unobserve，留给 renderVisiblePending() 补渲染
        if (state.busy) return;
        var it = en.target.__it;
        if (it && !it.rendered) renderItem(it);
        io.unobserve(en.target);
      });
    }, { rootMargin: '200px' });
    items.forEach(function (it) { it.el.__it = it; io.observe(it.el); });
  }

  function renderVisiblePending() {
    var vh = window.innerHeight || document.documentElement.clientHeight;
    previewItems.forEach(function (it) {
      if (it.rendered) return;
      var r = it.el.getBoundingClientRect();
      if (r.bottom > -200 && r.top < vh + 200) renderItem(it);
    });
  }

  function renderItem(it) {
    var canvas = it.el.querySelector('canvas');
    var scale = RENDER_W / it.s.W;
    var vp = state.pdf.getPage(it.idx + 1).then(function (page) {
      var viewport = page.getViewport({ scale: scale });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      return page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
    }).then(function () {
      it.painted = true;   // 位图真正可用，裁白边时可以直接复用
    }).catch(function (e) { console.error('render', it.idx, e); });
    it.rendered = true;
    return vp;
  }

  // 更新切分线（可拖把手）/ 标签 / 输出页数（不重渲染 canvas）
  function updateOverlays() {
    var total = 0;
    var nodes = pvGrid.querySelectorAll('.pv-item');
    for (var i = 0; i < nodes.length; i++) {
      var s = state.sizes[i];
      var bands = bandsFor(i, s.W, s.H);
      var n = bands.length;
      var layer = nodes[i].querySelector('.cut-layer');
      var html = '';
      for (var k = 1; k < n; k++) {
        var pct = clamp(bands[k].left / s.W * 100, 1.5, 98.5);
        html += '<div class="cut-line cut-handle" data-page="' + i + '" data-k="' + k + '" style="left:' + pct.toFixed(2) + '%">' +
                '<span class="cut-lbl">' + k + '</span><span class="cut-grip"></span></div>';
      }
      layer.className = 'cut-layer';
      layer.style.position = 'absolute';
      layer.style.inset = '0';
      layer.style.pointerEvents = 'none';
      layer.innerHTML = html;
      var foot = nodes[i].querySelector('.pv-foot');
      foot.innerHTML = '<span>原第 <b>' + (i + 1) + '</b> 页</span>' +
                       '<span>' + (n === 1 ? '保持 1 页' : '切出 <b>' + n + '</b> 页') + '</span>';
      total += n;
    }
    $('out-badge').textContent = '将生成 ' + total + ' 页';
    return total;
  }

  // ---- 拖动分割线：按住某页的把手横向拖，只改该页那条边界（全局 shift 仍叠加）----
  var dragCtx = null;
  pvGrid.addEventListener('pointerdown', function (e) {
    var h = e.target.closest('.cut-handle');
    if (!h || state.busy) return;
    var item = h.closest('.pv-item');
    var i = parseInt(item.getAttribute('data-idx'), 10);
    var k = parseInt(h.getAttribute('data-k'), 10);   // 1-based 内部边界
    if (isNaN(i) || isNaN(k)) return;
    if (!state.cuts[i]) state.cuts[i] = cutsFor(i).slice();
    var wrap = item.querySelector('.pv-wrap');
    dragCtx = { i: i, k: k, rect: wrap.getBoundingClientRect(), W: state.sizes[i].W };
    e.preventDefault();
  });
  window.addEventListener('pointermove', function (e) {
    if (!dragCtx) return;
    var cuts = state.cuts[dragCtx.i];
    var n = cuts.length + 1, cw = dragCtx.W / n, shiftPx = state.shift / 100 * cw;
    var frac = (e.clientX - dragCtx.rect.left) / dragCtx.rect.width;   // 显示位置 0..1
    var base = frac - shiftPx / dragCtx.W;                              // 反推不含 shift 的基准
    var lo = (dragCtx.k - 2 >= 0) ? cuts[dragCtx.k - 2] + 0.04 : 0.04;
    var hi = (dragCtx.k < cuts.length) ? cuts[dragCtx.k] - 0.04 : 0.96;
    cuts[dragCtx.k - 1] = clamp(base, lo, hi);
    updateOverlays();
  });
  window.addEventListener('pointerup', function () { if (dragCtx) { dragCtx = null; resetResult(); } });
  window.addEventListener('pointercancel', function () { dragCtx = null; });

  // ---- 设置交互 ----
  function setMode(m) {
    state.mode = m;
    $('seg-mode').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === m);
    });
  }
  $('seg-mode').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    setMode(btn.getAttribute('data-mode'));
    resetResult();
    if (cardPreview.hidden) return;
    if (state.mode === 'auto') { detectAllCols(); }                        // 智能识别：按内容检测每页分割线
    else { applyEqualCuts(parseInt(state.mode, 10)); updateOverlays(); }   // 固定栏数：重新铺等分
  });
  $('margin-x-range').addEventListener('input', function () {
    state.marginX = parseInt(this.value, 10);
    $('margin-x-val').textContent = state.marginX;
    resetResult();
  });
  $('margin-y-range').addEventListener('input', function () {
    state.marginY = parseInt(this.value, 10);
    $('margin-y-val').textContent = state.marginY;
    resetResult();
  });
  $('shift-range').addEventListener('input', function () {
    state.shift = parseInt(this.value, 10);
    $('shift-val').textContent = state.shift;
    if (!cardPreview.hidden) updateOverlays();
    resetResult();
  });

  // 边距/微调 步进按钮：点一次 ±1 单位（与拖动滑块走同一 input 事件，状态/预览同步）
  document.querySelectorAll('.step').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var r = document.getElementById(btn.getAttribute('data-target'));
      if (!r) return;
      var unit = parseFloat(r.getAttribute('step') || '1');
      var dir = parseInt(btn.getAttribute('data-step'), 10) || 0;
      var v = parseFloat(r.value) + unit * dir;
      v = Math.max(parseFloat(r.min), Math.min(parseFloat(r.max), v));
      v = Math.round(v * 100) / 100;
      if (String(v) !== String(r.value)) {
        r.value = v;
        r.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  });
  // 白边裁剪默认关；用户选过一次就记住（file:// 或隐私模式下 localStorage 会抛，忽略即可）
  var TRIM_KEY = 'pdfsplitter.trimWhite';
  try { state.trim = localStorage.getItem(TRIM_KEY) === '1'; } catch (e) {}
  $('trim-chk').checked = state.trim;
  $('trim-note').hidden = !state.trim;
  $('trim-chk').addEventListener('change', function () {
    state.trim = this.checked;
    $('trim-note').hidden = !state.trim;
    try { localStorage.setItem(TRIM_KEY, state.trim ? '1' : '0'); } catch (e) {}
    resetResult();
  });

  // ---- 切分生成 ----
  $('btn-process').addEventListener('click', process);
  function setProgress(pct, text) {
    abProg.classList.add('on');
    $('p-fill').style.width = pct + '%';
    $('p-text').textContent = text;
  }
  function clearProgress() {
    abProg.classList.remove('on');
  }

  async function process() {
    if (!state.bytes || state.busy) return;
    state.busy = true;
    cardResult.hidden = true;
    setProgress(2, '正在读取 PDF…');
    var btn = $('btn-process');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>处理中';

    try {
      var src = await PDFLib.PDFDocument.load(state.bytes.slice(0), { ignoreEncryption: true });
      var out = await PDFLib.PDFDocument.create();
      var srcPages = src.getPages();
      var embedList = [], bbs = [];

      for (var pno = 0; pno < srcPages.length; pno++) {
        var sz = srcPages[pno].getSize();
        var W = sz.width, H = sz.height;
        var bands = bandsFor(pno, W, H);

        // 已预览过的页在 trimBands 里直接复用位图；没预览过的页要等一次 pdf.js
        // 栅格化（约 1s/页），这就是「处理会稍慢」提示所指的那段时间
        if (state.trim) {
          setProgress(3 + Math.round(pno / srcPages.length * 5),
            '正在检测白边 ' + (pno + 1) + ' / ' + srcPages.length + ' 页…');
          var trimmed = await trimBands(pno, H, bands);
          for (var t = 0; t < bands.length; t++) {
            if (trimmed[t]) bands[t] = trimmed[t];
          }
          await tick();
        }

        for (var b = 0; b < bands.length; b++) {
          embedList.push(srcPages[pno]);
          bbs.push({ left: bands[b].left, bottom: bands[b].bottom || 0,
                     right: bands[b].right, top: bands[b].top || H });
        }
      }

      setProgress(8, '正在嵌入页面内容…');
      await tick();
      var embs = await out.embedPages(embedList, bbs);
      var mm2pt = 72 / 25.4;
      var marginX = state.marginX * mm2pt, marginY = state.marginY * mm2pt;

      for (var i = 0; i < embs.length; i++) {
        var emb = embs[i];
        var np = out.addPage([A4W, A4H]);
        var aw = A4W - 2 * marginX, ah = A4H - 2 * marginY;
        var s = Math.min(aw / emb.width, ah / emb.height);
        var dw = emb.width * s, dh = emb.height * s;
        np.drawPage(emb, { x: (A4W - dw) / 2, y: (A4H - dh) / 2, width: dw, height: dh });
        if (i % 2 === 0) {
          var pct = 10 + Math.round((i / embs.length) * 82);
          setProgress(pct, '正在生成第 ' + (i + 1) + ' / ' + embs.length + ' 页…');
        }
        if (i % 6 === 5) await tick();
      }

      setProgress(95, '正在保存…');
      var bytes = await out.save({ useObjectStreams: true });
      state.resultBytes = bytes;
      state.resultName = baseName(state.file.name) + '_A4切分.pdf';
      if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
      var blob = new Blob([bytes], { type: 'application/pdf' });
      state.resultUrl = URL.createObjectURL(blob);

      var t = 0;
      for (var j = 0; j < state.sizes.length; j++) {
        t += numBands(j);
      }
      $('r-sub').textContent = '共 ' + t + ' 页 · A4 纵向 · ' + fmtSize(bytes.length);
      cardResult.hidden = false;
      clearProgress();
      // 结果卡是最后一张，直接跳到底部，「保存到本地」就在拇指边。
      // 不用 smooth 滚动：动画要等 rAF，页面在后台或被长按时可能根本不动
      window.scrollTo(0, document.body.scrollHeight);
    } catch (e) {
      console.error(e);
      clearProgress();
      alert('处理失败：\n' + (e && e.message ? e.message : e));
    } finally {
      btn.disabled = false;
      btn.textContent = '重新切分';
      state.busy = false;
      // 补渲染处理期间被让路的预览（滚动已到位后再补，避免又排队）
      setTimeout(renderVisiblePending, 400);
    }
  }

  function baseName(n) { return n.replace(/\.pdf$/i, ''); }

  // ---- 下载 / 分享 ----
  // Android 外壳里 blob 下载和 navigator.share 都不可用，改走原生通道
  function shellUsable() { return !!(window.PdfShell && state.resultBytes); }
  function shellTransfer() {
    var bytes = state.resultBytes, CH = 768 * 1024;
    window.PdfShell.begin(state.resultName);
    for (var i = 0; i < bytes.length; i += CH) {
      window.PdfShell.chunk(toBase64(bytes.subarray(i, i + CH)));
    }
  }
  function toBase64(u8) {
    var blk = 0x8000, s = '';
    for (var i = 0; i < u8.length; i += blk) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + blk));
    }
    return btoa(s);
  }

  $('btn-download').addEventListener('click', function () {
    if (!state.resultUrl) return;
    if (shellUsable()) { shellTransfer(); window.PdfShell.save(); return; }
    var a = document.createElement('a');
    a.href = state.resultUrl;
    a.download = state.resultName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  $('btn-share').addEventListener('click', function () {
    if (!state.resultBytes) return;
    if (shellUsable()) { shellTransfer(); window.PdfShell.share(); return; }
    var file = new File([state.resultBytes], state.resultName, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: '切分后试卷' }).catch(function () {});
    } else if (navigator.share) {
      navigator.share({ title: state.resultName, text: '试卷已切分完成' }).catch(function () {});
    } else {
      alert('当前浏览器不支持系统分享，请点击“下载 PDF”');
    }
  });

  function resetResult() {
    state.resultBytes = null;
    if (state.resultUrl) { URL.revokeObjectURL(state.resultUrl); state.resultUrl = null; }
    cardResult.hidden = true;
    var openBtn = $('btn-open');
    if (openBtn) openBtn.hidden = true;
    var path = $('saved-path');
    if (path) path.hidden = true;
    var btn = $('btn-process');
    if (btn) btn.textContent = '开始切分';
  }

  if (window.PdfShell) {
    $('dl-label').textContent = '保存到本地';
    document.querySelector('#card-result .print-tip').textContent =
      '结果会写入手机 下载（Download）/ 试卷切分 文件夹；点「分享」可直接发送到微信、QQ 或系统打印服务。';
    window.__onPdfSaved = function (path) {
      $('btn-open').hidden = false;
      $('saved-path-t').textContent = path || '';
      $('saved-path').hidden = false;
    };
    $('btn-open').addEventListener('click', function () { window.PdfShell.open(); });
  }
})();

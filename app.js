/* app.js — sekmeler, CSV okuma, değer sorgulama ve grafikler */
(function () {
  'use strict';

  const ROW = -1; // "satır numarası" sanal sütunu
  const STORE_KEY = 'egri-uydurma-v1';
  const SERIES = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'];
  const colorVar = (i) => 'var(' + SERIES[(i < 0 ? 0 : i) % SERIES.length] + ')';

  const SAMPLE = 'Sicaklik;Basinc;Yogunluk;Viskozite\n0;1,013;999,8;1,792\n10;1,228;999,7;1,307\n20;2,339;998,2;1,002\n30;4,246;995,7;0,798\n40;7,384;992,2;0,653\n50;12,35;988,1;0,547\n60;19,94;983,2;0,467\n80;47,39;971,8;0,355\n100;101,3;958,4;0,282';

  // ---------- durum ----------

  let state = load() || { tabs: [], active: null, seq: 0 };
  if (!state.tabs.length) addTab();
  const runtime = new Map(); // tabId -> { data, fits: Map }

  function newTab(name) {
    state.seq++;
    return {
      id: 't' + Date.now().toString(36) + state.seq,
      name: name || 'Sekme ' + state.seq,
      csv: '', headerMode: 'header', skipRows: 0, delimiter: 'auto', decimal: 'auto',
      lookupCol: ROW, lookupValue: '', defaultMethod: 'spline', pairMethods: {},
      cellRef: 'A1', trExcel: false, showData: true,
      charts: [],
    };
  }
  function addTab() {
    const t = newTab();
    state.tabs.push(t);
    state.active = t.id;
    return t;
  }
  const activeTab = () => state.tabs.find((t) => t.id === state.active) || state.tabs[0];

  function load() {
    try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); return s && Array.isArray(s.tabs) ? s : null; } catch (e) { return null; }
  }
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* depolama yoksa sorun değil */ } }, 300);
  }

  function saveNow() { clearTimeout(saveTimer); try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* yok */ } }
  addEventListener('pagehide', saveNow);

  // ---------- CSV ----------

  function detectDelimiter(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
    let best = ',', bestScore = -1;
    for (const d of [';', '\t', ',', '|']) {
      const counts = lines.map((l) => splitLine(l, d).length);
      if (!counts.length || counts[0] < 2) continue;
      const same = counts.filter((c) => c === counts[0]).length;
      const score = same * 100 + counts[0];
      if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  function splitLine(line, d) {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === d) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }

  function parseNum(s, dec) {
    s = String(s).trim().replace(/\s/g, '');
    if (!s) return NaN;
    if (dec === ',') s = s.replace(/\./g, '').replace(',', '.');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
    return Number(s);
  }

  function parseData(tab) {
    const text = tab.csv || '';
    if (!text.trim()) return null;
    const delim = tab.delimiter === 'auto' ? detectDelimiter(text) : tab.delimiter === 'tab' ? '\t' : tab.delimiter;
    let rows = text.split(/\r?\n/).filter((l) => l.trim() !== '').map((l) => splitLine(l, delim));
    rows = rows.slice(Math.max(0, tab.skipRows | 0));
    let headers = null;
    if (tab.headerMode === 'header' && rows.length) headers = rows.shift().map((h) => h.trim());
    else if (tab.headerMode === 'skip' && rows.length) rows.shift();
    const ncol = Math.max(0, ...rows.map((r) => r.length), headers ? headers.length : 0);
    let dec = tab.decimal;
    if (dec === 'auto') {
      let comma = 0, dot = 0;
      for (const r of rows) for (const c of r) {
        const v = c.trim();
        if (/^-?\d{1,3}(\.\d{3})*,\d+$|^-?\d+,\d+$/.test(v)) comma++;
        else if (/^-?\d*\.\d+$/.test(v)) dot++;
      }
      dec = delim !== ',' && comma > dot ? ',' : '.';
    }
    const names = [], cols = [];
    for (let c = 0; c < ncol; c++) {
      names.push((headers && headers[c]) || 'Sütun ' + (c + 1));
      cols.push(rows.map((r) => parseNum(r[c] == null ? '' : r[c], dec)));
    }
    const numeric = cols.map((col) => col.filter(Number.isFinite).length >= 2);
    return { names, cols, raw: rows, nrows: rows.length, numeric, delim, dec };
  }

  function rt(tab) {
    let r = runtime.get(tab.id);
    if (!r) { r = { data: parseData(tab), fits: new Map() }; runtime.set(tab.id, r); }
    return r;
  }
  function reparse(tab) {
    const data = parseData(tab);
    runtime.set(tab.id, { data, fits: new Map() });
    // veri değişince artık olmayan / sayısal olmayan sütun seçimlerini temizle
    const ok = (i) => i === ROW || (data && i < data.names.length && data.numeric[i]);
    if (!ok(tab.lookupCol)) tab.lookupCol = ROW;
    tab.charts.forEach((c) => { if (!ok(c.x)) c.x = ROW; c.ys = c.ys.filter((y) => y !== ROW && ok(y) && y !== c.x); });
  }

  const colName = (data, i) => (i === ROW ? 'Satır no' : data.names[i]);
  function colValues(data, i) {
    return i === ROW ? data.cols[0].map((_, r) => r + 1) : data.cols[i];
  }

  const methodFor = (tab, xi, yi) => tab.pairMethods[xi + '|' + yi] || tab.defaultMethod;

  function getFit(tab, xi, yi, method) {
    const r = rt(tab);
    method = method || methodFor(tab, xi, yi);
    const key = xi + '|' + yi + '|' + method;
    if (!r.fits.has(key)) r.fits.set(key, Fit.fit(method, colValues(r.data, xi), colValues(r.data, yi)));
    return r.fits.get(key);
  }

  // ---------- yardımcılar ----------

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v) => (Number.isFinite(v) ? Fit.short(v) : '—');
  const fmtR = (v) => (Number.isFinite(v) ? v.toFixed(6) : '—');

  function methodOptions(selected) {
    return Fit.METHODS.map((m) => `<option value="${m.id}"${m.id === selected ? ' selected' : ''}>${esc(m.label)}</option>`).join('');
  }
  function colOptions(data, selected, withRow) {
    let h = withRow ? `<option value="${ROW}"${selected === ROW ? ' selected' : ''}>Satır no (1, 2, 3…)</option>` : '';
    data.names.forEach((n, i) => {
      if (!data.numeric[i]) return;
      h += `<option value="${i}"${selected === i ? ' selected' : ''}>${esc(n)}</option>`;
    });
    return h;
  }

  function toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }
  function copy(text) {
    const done = () => toast('Kopyalandı');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* yok */ }
      ta.remove();
    }
  }

  // ---------- sekmeler ----------

  const $tabs = document.getElementById('tabs');
  const $panel = document.getElementById('panel');

  function renderTabs() {
    $tabs.innerHTML = state.tabs.map((t) => `
      <div class="tab${t.id === state.active ? ' active' : ''}" data-tab="${t.id}" title="Yeniden adlandırmak için çift tıklayın">
        <span class="tab-name">${esc(t.name)}</span>
        ${state.tabs.length > 1 ? `<button class="close" data-close="${t.id}" aria-label="Sekmeyi kapat">×</button>` : ''}
      </div>`).join('') + '<button class="tab-add" id="addTab" title="Yeni sekme">+</button>';
  }

  $tabs.addEventListener('click', (e) => {
    const close = e.target.closest('[data-close]');
    if (close) {
      const t = state.tabs.find((x) => x.id === close.dataset.close);
      if (t && (t.csv.trim() === '' || confirm('"' + t.name + '" sekmesi kapatılsın mı?'))) {
        state.tabs = state.tabs.filter((x) => x !== t);
        runtime.delete(t.id);
        if (state.active === t.id) state.active = state.tabs[Math.max(0, state.tabs.length - 1)].id;
        save(); renderAll();
      }
      return;
    }
    if (e.target.closest('#addTab')) { addTab(); save(); renderAll(); return; }
    const tab = e.target.closest('[data-tab]');
    if (tab && tab.dataset.tab !== state.active) { state.active = tab.dataset.tab; save(); renderAll(); }
  });
  $tabs.addEventListener('dblclick', (e) => {
    const el = e.target.closest('[data-tab]');
    if (!el) return;
    const t = state.tabs.find((x) => x.id === el.dataset.tab);
    const name = prompt('Sekme adı', t.name);
    if (name && name.trim()) { t.name = name.trim(); save(); renderTabs(); }
  });

  // ---------- panel ----------

  function renderAll() { renderTabs(); renderPanel(); }

  function renderPanel() {
    const tab = activeTab();
    const data = rt(tab).data;
    $panel.innerHTML = `
      <div class="col">
        <section class="card">
          <h2>Veri <span class="sp"></span>
            <button data-act="sample">Örnek veri</button>
            <label class="hint"><input type="checkbox" data-f="showData" ${tab.showData ? 'checked' : ''}> tabloyu göster</label>
          </h2>
          <div class="drop">
            <textarea class="csv" data-f="csv" placeholder="CSV içeriğini buraya yapıştırın ya da dosya seçin / sürükleyip bırakın…" spellcheck="false">${esc(tab.csv)}</textarea>
          </div>
          <div class="row">
            <input type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" data-act="file">
          </div>
          <div class="row">
            <label>İlk satır
              <select data-f="headerMode">
                <option value="header"${tab.headerMode === 'header' ? ' selected' : ''}>başlık olarak al</option>
                <option value="skip"${tab.headerMode === 'skip' ? ' selected' : ''}>yoksay</option>
                <option value="none"${tab.headerMode === 'none' ? ' selected' : ''}>veri olarak al</option>
              </select></label>
            <label>Baştan atla <input type="number" min="0" step="1" style="width:60px" data-f="skipRows" value="${tab.skipRows}"> satır</label>
          </div>
          <div class="row">
            <label>Ayırıcı
              <select data-f="delimiter">
                ${[['auto', 'otomatik'], [',', 'virgül ,'], [';', 'noktalı virgül ;'], ['tab', 'sekme ⇥'], ['|', 'dik çizgi |']]
                  .map(([v, l]) => `<option value="${v}"${tab.delimiter === v ? ' selected' : ''}>${l}</option>`).join('')}
              </select></label>
            <label>Ondalık
              <select data-f="decimal">
                ${[['auto', 'otomatik'], ['.', 'nokta 1.5'], [',', 'virgül 1,5']]
                  .map(([v, l]) => `<option value="${v}"${tab.decimal === v ? ' selected' : ''}>${l}</option>`).join('')}
              </select></label>
            ${data ? `<span class="hint">${data.nrows} satır · ${data.names.length} sütun · ayırıcı “${data.delim === '\t' ? '⇥' : esc(data.delim)}” · ondalık “${data.dec}”</span>` : ''}
          </div>
          ${data && tab.showData ? dataTable(data) : ''}
        </section>
        ${data ? lookupCard(tab, data) : ''}
      </div>
      <div class="col" id="chartsCol">
        ${data ? chartsHtml(tab, data) : '<section class="card empty">Grafikler için önce veri girin.</section>'}
      </div>`;
    attachDrop();
  }

  function dataTable(data) {
    const max = 500;
    const head = '<tr><th>#</th>' + data.names.map((n, i) => `<th>${esc(n)}${data.numeric[i] ? '' : ' <span class="hint">(metin)</span>'}</th>`).join('') + '</tr>';
    const body = data.raw.slice(0, max).map((r, ri) => '<tr><td class="num nan">' + (ri + 1) + '</td>' + data.cols.map((col, ci) => {
      const v = col[ri];
      return Number.isFinite(v) ? `<td class="num">${v}</td>` : `<td class="nan">${esc(r[ci] == null ? '' : r[ci])}</td>`;
    }).join('') + '</tr>').join('');
    return `<div class="table-wrap"><table>${head}${body}</table></div>` + (data.nrows > max ? `<div class="hint">İlk ${max} satır gösteriliyor</div>` : '');
  }

  // ---------- değer sorgulama ----------

  function lookupCard(tab, data) {
    return `
      <section class="card">
        <h2>Değer sorgula</h2>
        <div class="lookup-input">
          <select data-f="lookupCol">${colOptions(data, tab.lookupCol, true)}</select>
          <span>=</span>
          <input type="text" inputmode="decimal" data-f="lookupValue" value="${esc(tab.lookupValue)}" placeholder="değer girin">
        </div>
        <div class="row">
          <label>Varsayılan yöntem <select data-f="defaultMethod">${methodOptions(tab.defaultMethod)}</select></label>
          <button data-act="resetMethods" title="Sütunlara özel seçilen yöntemleri temizle">Tümüne uygula</button>
        </div>
        <div class="row">
          <label>Excel hücresi <input type="text" data-f="cellRef" value="${esc(tab.cellRef)}" style="width:70px"></label>
          <label><input type="checkbox" data-f="trExcel" ${tab.trExcel ? 'checked' : ''}> Türkçe Excel (ondalık virgül, ÜS)</label>
        </div>
        <div id="results">${resultsHtml(tab, data)}</div>
      </section>`;
  }

  function lookupX(tab) {
    const s = String(tab.lookupValue);
    return parseNum(s, s.includes(',') ? ',' : '.');
  }

  function resultsHtml(tab, data) {
    const xi = tab.lookupCol;
    const x = lookupX(tab, data);
    const ref = (tab.cellRef || 'A1').trim() || 'A1';
    const rows = [];
    data.names.forEach((name, yi) => {
      if (yi === xi || !data.numeric[yi]) return;
      const method = methodFor(tab, xi, yi);
      const f = getFit(tab, xi, yi, method);
      let valCell = '—', status = '';
      if (f.ok && Number.isFinite(x)) {
        const y = f.eval(x);
        valCell = fmt(y);
        const [a, b] = f.domain;
        if (x < a || x > b) {
          const span = b - a || 1;
          const d = x < a ? a - x : x - b;
          status = `<span class="badge warn" title="Veri aralığı: ${fmt(a)} … ${fmt(b)}">⚠ Ekstrapolasyon %${Math.round((d / span) * 100)} dışarıda</span>`;
        } else status = '<span class="badge ok">✓ Aralık içi</span>';
      }
      const excel = f.ok ? f.excel(ref, { tr: tab.trExcel }) : '';
      rows.push(`
        <tr>
          <td><span class="swatch" style="background:${colorVar(yi)}"></span><b>${esc(name)}</b></td>
          <td class="val">${valCell}<div>${status}</div></td>
          <td style="white-space:normal;min-width:220px">
            <select data-pair="${xi}|${yi}">${methodOptions(method)}</select>
            ${f.ok ? `
              <div class="hint">R = ${fmtR(f.r)} · R² = ${fmtR(f.r2)}${f.interpolating ? ' (noktalardan geçer)' : ''} · n = ${f.n}</div>
              <div class="formula">${esc(f.formula)}</div>
              ${f.segments ? segmentsDetails(f) : ''}
              <div class="excel-box"><input type="text" readonly value="${esc(excel)}" title="${excel.length} karakter"><button data-copy="${esc(excel)}">Kopyala</button></div>
              ${excel.length > 8192 ? '<div class="err">Formül Excel sınırını (8192 karakter) aşıyor; polinom yöntemi deneyin.</div>' : ''}`
              : `<div class="err">${esc(f.error)}</div>`}
          </td>
        </tr>`);
    });
    if (!rows.length) return '<div class="hint">Karşılaştırılacak başka sayısal sütun yok.</div>';
    return `<div class="hint" style="margin-bottom:6px">Girdi: <b>${esc(colName(data, xi))}</b>${Number.isFinite(x) ? ' = ' + fmt(x) : ''} · Excel formüllerinde girdi hücresi <b>${esc(ref)}</b></div>
      <div class="table-wrap" style="max-height:none"><table class="results">
        <tr><th>Sütun</th><th>Değer</th><th>Yöntem · formül</th></tr>${rows.join('')}</table></div>`;
  }

  function segmentsDetails(f) {
    const rows = f.segments.map((s) => `<tr>
      <td>${s.from === -Infinity ? '−∞' : fmt(s.from)} … ${s.to === Infinity ? '+∞' : fmt(s.to)}${s.extrap ? ' <span class="hint">(ekstr.)</span>' : ''}</td>
      ${s.c.map((c) => `<td class="num">${fmt(c)}</td>`).join('')}</tr>`).join('');
    return `<details><summary>Parça katsayıları: y = a + b·(x−x₀) + c·(x−x₀)² + d·(x−x₀)³, x₀ = aralık başı</summary>
      <div class="table-wrap"><table><tr><th>Aralık</th><th>a</th><th>b</th><th>c</th><th>d</th></tr>${rows}</table></div></details>`;
  }

  // ---------- grafikler ----------

  function chartsHtml(tab, data) {
    if (!tab.charts.length) {
      const ys = data.numeric.map((n, i) => (n ? i : null)).filter((i) => i !== null);
      // varsayılan: x = ilk sayısal sütun, y = geri kalanı (yoksa satır no)
      const x = ys.length > 1 ? ys[0] : ROW;
      tab.charts.push(newChart(x, ys.filter((i) => i !== x).slice(0, 1)));
      save();
    }
    return tab.charts.map((ch, k) => chartCard(tab, data, ch, k)).join('') +
      '<button class="primary" data-act="addChart" style="align-self:flex-start">+ Grafik ekle</button>';
  }

  function newChart(x, ys) {
    return { id: 'c' + Math.random().toString(36).slice(2, 8), x, ys, ext: 25, xmin: '', xmax: '', ymin: '', ymax: '' };
  }

  function chartCard(tab, data, ch, k) {
    const chips = data.names.map((n, i) => (!data.numeric[i] || i === ch.x) ? '' :
      `<label class="ychip${ch.ys.includes(i) ? ' on' : ''}"><input type="checkbox" data-chart-y="${ch.id}" value="${i}" ${ch.ys.includes(i) ? 'checked' : ''}>
        <span class="swatch" style="background:${colorVar(i)}"></span>${esc(n)}</label>`).join('');
    return `
      <section class="card chart-card" data-chart="${ch.id}">
        <h2>Grafik ${k + 1}<span class="sp"></span>
          <button data-act="dupChart" data-id="${ch.id}" title="Kopyasını oluştur">⧉</button>
          <button data-act="delChart" data-id="${ch.id}" title="Grafiği sil">✕</button></h2>
        <div class="controls">
          <label>X ekseni <select data-chart-x="${ch.id}">${colOptions(data, ch.x, true)}</select></label>
          <span class="hint">Y:</span><div class="ychips">${chips || '<span class="hint">sütun yok</span>'}</div>
        </div>
        <div class="controls range">
          <label>X <input type="text" placeholder="min" data-chart-r="${ch.id}" data-k="xmin" value="${esc(ch.xmin)}">
            <input type="text" placeholder="max" data-chart-r="${ch.id}" data-k="xmax" value="${esc(ch.xmax)}"></label>
          <label>Y <input type="text" placeholder="min" data-chart-r="${ch.id}" data-k="ymin" value="${esc(ch.ymin)}">
            <input type="text" placeholder="max" data-chart-r="${ch.id}" data-k="ymax" value="${esc(ch.ymax)}"></label>
          <label>Ekstrapolasyon görünümü ±<input type="number" min="0" max="500" step="5" style="width:64px" data-chart-r="${ch.id}" data-k="ext" value="${ch.ext}">%</label>
        </div>
        <div class="svg-host">${chartSvg(tab, data, ch)}</div>
        <div class="legend">${legendHtml(tab, data, ch)}</div>
      </section>`;
  }

  function legendHtml(tab, data, ch) {
    return ch.ys.map((yi) => {
      const method = methodFor(tab, ch.x, yi);
      const f = getFit(tab, ch.x, yi, method);
      return `<div class="legend-item">
        <span><span class="swatch" style="background:${colorVar(yi)}"></span><b>${esc(data.names[yi])}</b></span>
        <select data-pair="${ch.x}|${yi}">${methodOptions(method)}</select>
        ${f.ok ? `<span class="hint">R = ${fmtR(f.r)} · R² = ${fmtR(f.r2)}</span>
          <button data-copy="${esc(f.excel((tab.cellRef || 'A1').trim() || 'A1', { tr: tab.trExcel }))}" title="Excel formülünü kopyala">Excel formülü</button>
          <span class="formula">${esc(f.formula)}</span>` : `<span class="err">${esc(f.error)}</span>`}
      </div>`;
    }).join('');
  }

  function niceTicks(min, max, count) {
    const span = max - min;
    if (!(span > 0)) return [min];
    const step0 = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const err = step0 / mag;
    const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return out;
  }

  const chartMeta = new Map(); // chartId -> ölçekler (hover için)
  const W = 760, H = 420, M = { l: 64, r: 16, t: 14, b: 40 };

  function chartSvg(tab, data, ch) {
    const xsAll = colValues(data, ch.x);
    const series = ch.ys.map((yi) => ({ yi, f: getFit(tab, ch.x, yi), pts: [] }));
    let dmin = Infinity, dmax = -Infinity, ymn = Infinity, ymx = -Infinity;
    for (const s of series) {
      const ys = data.cols[s.yi];
      for (let i = 0; i < xsAll.length; i++) {
        if (Number.isFinite(xsAll[i]) && Number.isFinite(ys[i])) {
          s.pts.push([xsAll[i], ys[i]]);
          dmin = Math.min(dmin, xsAll[i]); dmax = Math.max(dmax, xsAll[i]);
          ymn = Math.min(ymn, ys[i]); ymx = Math.max(ymx, ys[i]);
        }
      }
    }
    if (!series.length || !Number.isFinite(dmin)) {
      chartMeta.delete(ch.id);
      return '<div class="empty">Y ekseni için en az bir sütun seçin.</div>';
    }
    const lx = ch.x === tab.lookupCol ? lookupX(tab, data) : NaN;
    const pad = ((dmax - dmin) || Math.abs(dmax) || 1) * (Number(ch.ext) || 0) / 100;
    let x0 = dmin - pad, x1 = dmax + pad;
    if (Number.isFinite(lx)) { x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); }
    const ux0 = parseNum(ch.xmin, '.'), ux1 = parseNum(ch.xmax, '.');
    if (Number.isFinite(ux0)) x0 = ux0;
    if (Number.isFinite(ux1)) x1 = ux1;
    if (!(x1 > x0)) { x0 -= 1; x1 += 1; }

    // eğrileri örnekle; y otomatik aralığı veriye göre, eğri taşmaları sınırlı
    const N = 400;
    const yspan = (ymx - ymn) || Math.abs(ymx) || 1;
    let cy0 = ymn, cy1 = ymx;
    for (const s of series) {
      s.curve = [];
      if (!s.f.ok) continue;
      for (let i = 0; i <= N; i++) {
        const x = x0 + ((x1 - x0) * i) / N;
        const y = s.f.eval(x);
        s.curve.push([x, y]);
        if (Number.isFinite(y)) { cy0 = Math.min(cy0, Math.max(y, ymn - yspan)); cy1 = Math.max(cy1, Math.min(y, ymx + yspan)); }
      }
      if (Number.isFinite(lx)) {
        const y = s.f.eval(lx);
        if (Number.isFinite(y)) { cy0 = Math.min(cy0, y); cy1 = Math.max(cy1, y); }
      }
    }
    let y0 = cy0 - (cy1 - cy0) * 0.05, y1 = cy1 + (cy1 - cy0) * 0.05;
    const uy0 = parseNum(ch.ymin, '.'), uy1 = parseNum(ch.ymax, '.');
    if (Number.isFinite(uy0)) y0 = uy0;
    if (Number.isFinite(uy1)) y1 = uy1;
    if (!(y1 > y0)) { y0 -= 1; y1 += 1; }

    const pw = W - M.l - M.r, ph = H - M.t - M.b;
    const sx = (x) => M.l + ((x - x0) / (x1 - x0)) * pw;
    const sy = (y) => M.t + ph - ((y - y0) / (y1 - y0)) * ph;
    chartMeta.set(ch.id, { x0, x1, y0, y1, sx, sy, pw, ph, series, tabId: tab.id, xcol: ch.x, dmin, dmax });

    const clip = 'clip-' + ch.id;
    let g = `<defs><clipPath id="${clip}"><rect x="${M.l}" y="${M.t}" width="${pw}" height="${ph}"/></clipPath></defs>`;
    // ekstrapolasyon bölgeleri
    const exL = Math.max(M.l, Math.min(M.l + pw, sx(dmin))), exR = Math.max(M.l, Math.min(M.l + pw, sx(dmax)));
    if (exL > M.l) g += `<rect x="${M.l}" y="${M.t}" width="${exL - M.l}" height="${ph}" fill="var(--extrap)"/>`;
    if (exR < M.l + pw) g += `<rect x="${exR}" y="${M.t}" width="${M.l + pw - exR}" height="${ph}" fill="var(--extrap)"/>`;
    if (exL > M.l + 40) g += `<text x="${M.l + 6}" y="${M.t + 14}" style="fill:var(--warn-fg)">◀ ekstrapolasyon</text>`;
    if (M.l + pw - exR > 40) g += `<text x="${M.l + pw - 6}" y="${M.t + 14}" text-anchor="end" style="fill:var(--warn-fg)">ekstrapolasyon ▶</text>`;
    // ızgara ve eksenler
    for (const t of niceTicks(x0, x1, 8)) {
      g += `<line x1="${sx(t)}" x2="${sx(t)}" y1="${M.t}" y2="${M.t + ph}" stroke="var(--grid)"/>`;
      g += `<text x="${sx(t)}" y="${M.t + ph + 16}" text-anchor="middle">${fmt(t)}</text>`;
    }
    for (const t of niceTicks(y0, y1, 6)) {
      g += `<line x1="${M.l}" x2="${M.l + pw}" y1="${sy(t)}" y2="${sy(t)}" stroke="var(--grid)"/>`;
      g += `<text x="${M.l - 6}" y="${sy(t) + 4}" text-anchor="end">${fmt(t)}</text>`;
    }
    g += `<line x1="${M.l}" x2="${M.l + pw}" y1="${M.t + ph}" y2="${M.t + ph}" stroke="var(--muted)"/>`;
    g += `<text x="${M.l + pw / 2}" y="${H - 6}" text-anchor="middle" style="font-weight:600">${esc(colName(data, ch.x))}</text>`;

    // eğriler: veri aralığında düz, dışında kesikli
    const lim = (y) => Math.max(-1e6, Math.min(1e6, y));
    const pathFor = (pts) => {
      let d = '', pen = false;
      for (const [x, y] of pts) {
        if (!Number.isFinite(y)) { pen = false; continue; }
        d += (pen ? 'L' : 'M') + sx(x).toFixed(1) + ' ' + lim(sy(y)).toFixed(1);
        pen = true;
      }
      return d;
    };
    g += `<g clip-path="url(#${clip})">`;
    for (const s of series) {
      if (!s.curve.length) continue;
      const a = s.f.domain[0], b = s.f.domain[1];
      const inside = s.curve.filter(([x]) => x >= a && x <= b);
      inside.unshift([a, s.f.eval(a)]); inside.push([b, s.f.eval(b)]);
      const left = s.curve.filter(([x]) => x <= a).concat([[a, s.f.eval(a)]]);
      const right = [[b, s.f.eval(b)]].concat(s.curve.filter(([x]) => x >= b));
      const col = colorVar(s.yi);
      g += `<path d="${pathFor(inside)}" fill="none" stroke="${col}" stroke-width="2"/>`;
      g += `<path d="${pathFor(left)}" fill="none" stroke="${col}" stroke-width="2" stroke-dasharray="6 4" opacity=".8"/>`;
      g += `<path d="${pathFor(right)}" fill="none" stroke="${col}" stroke-width="2" stroke-dasharray="6 4" opacity=".8"/>`;
    }
    for (const s of series) {
      for (const [x, y] of s.pts) g += `<circle cx="${sx(x).toFixed(1)}" cy="${sy(y).toFixed(1)}" r="4" fill="${colorVar(s.yi)}" stroke="var(--surface)" stroke-width="2"/>`;
    }
    // sorgu çizgisi
    if (Number.isFinite(lx)) {
      g += `<line x1="${sx(lx)}" x2="${sx(lx)}" y1="${M.t}" y2="${M.t + ph}" stroke="var(--text)" stroke-dasharray="3 3"/>`;
      for (const s of series) {
        const y = s.f.eval(lx);
        if (Number.isFinite(y)) g += `<circle cx="${sx(lx)}" cy="${sy(y)}" r="6" fill="var(--surface)" stroke="${colorVar(s.yi)}" stroke-width="3"/>`;
      }
    }
    g += '</g>';
    g += `<line class="hover-line" x1="0" x2="0" y1="${M.t}" y2="${M.t + ph}" stroke="var(--muted)" visibility="hidden"/>`;
    g += `<rect class="hit" data-hit="${ch.id}" x="${M.l}" y="${M.t}" width="${pw}" height="${ph}" fill="transparent" style="cursor:crosshair"/>`;
    return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafik">${g}</svg>`;
  }

  // ---------- olaylar ----------

  function refreshRight(tab) {
    const data = rt(tab).data;
    const col = document.getElementById('chartsCol');
    if (col && data) col.innerHTML = chartsHtml(tab, data);
  }
  function refreshResults(tab) {
    const data = rt(tab).data;
    const el = document.getElementById('results');
    if (el && data) el.innerHTML = resultsHtml(tab, data);
  }
  function refreshChart(tab, ch) {
    const data = rt(tab).data;
    const card = document.querySelector(`[data-chart="${ch.id}"]`);
    if (!card) return;
    card.querySelector('.svg-host').innerHTML = chartSvg(tab, data, ch);
    card.querySelector('.legend').innerHTML = legendHtml(tab, data, ch);
  }

  let csvTimer = 0;
  $panel.addEventListener('input', (e) => {
    const t = e.target, tab = activeTab();
    const f = t.dataset.f;
    if (f === 'csv') {
      tab.csv = t.value; save();
      clearTimeout(csvTimer);
      csvTimer = setTimeout(() => { reparse(tab); keepFocus(renderPanel); }, 400);
    } else if (f === 'lookupValue') {
      tab.lookupValue = t.value; save();
      refreshResults(tab); refreshRight(tab);
    } else if (f === 'cellRef') {
      tab.cellRef = t.value; save();
      refreshResults(tab);
    } else if (t.dataset.chartR) {
      const ch = tab.charts.find((c) => c.id === t.dataset.chartR);
      ch[t.dataset.k] = t.dataset.k === 'ext' ? Number(t.value) || 0 : t.value;
      save(); refreshChart(tab, ch);
    }
  });

  $panel.addEventListener('change', (e) => {
    const t = e.target, tab = activeTab();
    const f = t.dataset.f;
    if (['headerMode', 'delimiter', 'decimal', 'skipRows'].includes(f)) {
      tab[f] = f === 'skipRows' ? Math.max(0, t.value | 0) : t.value;
      reparse(tab); save(); renderPanel();
    } else if (f === 'showData' || f === 'trExcel') {
      tab[f] = t.checked; save(); renderPanel();
    } else if (f === 'lookupCol') {
      tab.lookupCol = Number(t.value); save(); renderPanel();
    } else if (f === 'defaultMethod') {
      tab.defaultMethod = t.value; save(); renderPanel();
    } else if (t.dataset.pair) {
      tab.pairMethods[t.dataset.pair] = t.value; save(); renderPanel();
    } else if (t.dataset.chartX) {
      const ch = tab.charts.find((c) => c.id === t.dataset.chartX);
      ch.x = Number(t.value); ch.ys = ch.ys.filter((y) => y !== ch.x);
      ch.xmin = ch.xmax = '';
      save(); refreshRight(tab);
    } else if (t.dataset.chartY) {
      const ch = tab.charts.find((c) => c.id === t.dataset.chartY);
      const v = Number(t.value);
      ch.ys = t.checked ? ch.ys.concat(v).sort((a, b) => a - b) : ch.ys.filter((y) => y !== v);
      save(); refreshRight(tab);
    } else if (t.dataset.act === 'file' && t.files[0]) {
      readFile(t.files[0]);
    }
  });

  $panel.addEventListener('click', (e) => {
    const tab = activeTab();
    const b = e.target.closest('button');
    const hit = e.target.closest('[data-hit]');
    if (hit) { chartClick(e, hit); return; }
    if (!b) return;
    if (b.dataset.copy != null) { copy(b.dataset.copy); return; }
    const act = b.dataset.act;
    if (act === 'sample') {
      if (tab.csv.trim() && !confirm('Mevcut veri örnek veriyle değiştirilsin mi?')) return;
      Object.assign(tab, { csv: SAMPLE, headerMode: 'header', skipRows: 0, delimiter: 'auto', decimal: 'auto', charts: [], pairMethods: {}, lookupCol: 0, lookupValue: '120' });
      reparse(tab); save(); renderPanel();
    } else if (act === 'resetMethods') {
      tab.pairMethods = {}; save(); renderPanel();
    } else if (act === 'addChart') {
      const data = rt(tab).data;
      const last = tab.charts[tab.charts.length - 1];
      tab.charts.push(last ? newChart(last.x, last.ys.slice()) : newChart(ROW, data.numeric.map((n, i) => (n ? i : null)).filter((i) => i !== null).slice(0, 1)));
      save(); refreshRight(tab);
    } else if (act === 'dupChart') {
      const i = tab.charts.findIndex((c) => c.id === b.dataset.id);
      tab.charts.splice(i + 1, 0, Object.assign({}, tab.charts[i], { id: newChart().id, ys: tab.charts[i].ys.slice() }));
      save(); refreshRight(tab);
    } else if (act === 'delChart') {
      tab.charts = tab.charts.filter((c) => c.id !== b.dataset.id);
      if (!tab.charts.length) tab.charts.push(newChart(ROW, []));
      save(); refreshRight(tab);
    }
  });

  // grafiğe tıklayınca o x değeri sorgulanır
  function chartClick(e, hit) {
    const m = chartMeta.get(hit.dataset.hit);
    if (!m) return;
    const tab = activeTab();
    const x = pointerX(e, hit, m);
    tab.lookupCol = m.xcol;
    tab.lookupValue = String(Number(x.toPrecision(6)));
    save(); renderPanel();
  }

  function pointerX(e, hit, m) {
    const svg = hit.ownerSVGElement;
    const p = svg.createSVGPoint();
    p.x = e.clientX; p.y = e.clientY;
    const loc = p.matrixTransform(svg.getScreenCTM().inverse());
    return m.x0 + ((loc.x - M.l) / m.pw) * (m.x1 - m.x0);
  }

  const $tip = document.getElementById('tooltip');
  $panel.addEventListener('pointermove', (e) => {
    const hit = e.target.closest('[data-hit]');
    if (!hit) { $tip.hidden = true; return; }
    const m = chartMeta.get(hit.dataset.hit);
    if (!m) return;
    const tab = activeTab();
    const data = rt(tab).data;
    const x = pointerX(e, hit, m);
    const line = hit.ownerSVGElement.querySelector('.hover-line');
    line.setAttribute('x1', m.sx(x)); line.setAttribute('x2', m.sx(x)); line.setAttribute('visibility', 'visible');
    const out = x < m.dmin || x > m.dmax;
    $tip.innerHTML = `<div class="tt-row">${esc(colName(data, m.xcol))}<b>${fmt(x)}</b></div>` +
      m.series.map((s) => `<div class="tt-row"><span class="swatch" style="background:${colorVar(s.yi)}"></span>${esc(data.names[s.yi])}<b>${fmt(s.f.eval(x))}</b></div>`).join('') +
      (out ? '<div class="tt-row" style="color:var(--warn-fg)">⚠ ekstrapolasyon</div>' : '') +
      '<div class="hint">tıkla: bu değeri sorgula</div>';
    $tip.hidden = false;
    const r = $tip.getBoundingClientRect();
    let left = e.clientX + 14, top = e.clientY + 14;
    if (left + r.width > innerWidth - 8) left = e.clientX - r.width - 14;
    if (top + r.height > innerHeight - 8) top = e.clientY - r.height - 14;
    $tip.style.left = left + 'px'; $tip.style.top = top + 'px';
  });
  $panel.addEventListener('pointerout', (e) => {
    if (e.target.closest && e.target.closest('[data-hit]')) {
      $tip.hidden = true;
      const l = e.target.ownerSVGElement && e.target.ownerSVGElement.querySelector('.hover-line');
      if (l) l.setAttribute('visibility', 'hidden');
    }
  });

  function readFile(file) {
    const tab = activeTab();
    const reader = new FileReader();
    reader.onload = () => {
      let text = String(reader.result);
      // UTF-8 değilse (ör. Excel'in Türkçe CSV'si) Windows-1254 dene
      if (text.includes('�')) {
        const r2 = new FileReader();
        r2.onload = () => apply(String(r2.result));
        r2.readAsText(file, 'windows-1254');
        return;
      }
      apply(text);
    };
    reader.readAsText(file);
    function apply(text) {
      tab.csv = text.replace(/^﻿/, '');
      if (/^Sekme \d+$/.test(tab.name)) tab.name = file.name.replace(/\.[^.]+$/, '');
      tab.charts = []; tab.pairMethods = {}; tab.lookupCol = ROW; tab.lookupValue = '';
      reparse(tab); save(); renderAll();
    }
  }

  function attachDrop() {
    const drop = $panel.querySelector('.drop');
    if (!drop) return;
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault(); drop.classList.remove('dragover');
      if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
    });
  }

  // CSV yazarken panel yeniden çizildiğinde imleci koru
  function keepFocus(fn) {
    const a = document.activeElement;
    const f = a && a.dataset && a.dataset.f;
    const s = a && a.selectionStart, en = a && a.selectionEnd, sc = a && a.scrollTop;
    fn();
    if (f) {
      const el = $panel.querySelector(`[data-f="${f}"]`);
      if (el) { el.focus(); try { el.setSelectionRange(s, en); el.scrollTop = sc; } catch (e) { /* yok */ } }
    }
  }

  renderAll();
})();

/*
 * fit.js — eğri uydurma (interpolasyon / regresyon) çekirdeği.
 * Tarayıcıda window.Fit, Node'da module.exports olarak kullanılır.
 *
 * Her yöntem aynı şekilde bir "model" döndürür:
 *   { ok, error, method, eval(x), domain:[min,max], n, r, r2, rmse,
 *     formula (okunabilir), excel(ref, {tr}), segments? }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Fit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const METHODS = [
    { id: 'linear', label: 'Doğrusal interpolasyon (parçalı)', interp: true },
    { id: 'spline', label: 'Kübik spline (natural)', interp: true },
    { id: 'pchip', label: 'Monoton kübik spline (PCHIP)', interp: true },
    { id: 'poly1', label: 'Polinom 1. derece (doğru)', deg: 1 },
    { id: 'poly2', label: 'Polinom 2. derece', deg: 2 },
    { id: 'poly3', label: 'Polinom 3. derece', deg: 3 },
    { id: 'poly4', label: 'Polinom 4. derece', deg: 4 },
    { id: 'poly5', label: 'Polinom 5. derece', deg: 5 },
    { id: 'poly6', label: 'Polinom 6. derece', deg: 6 },
    { id: 'exp', label: 'Üstel  y = a·e^(b·x)' },
    { id: 'log', label: 'Logaritmik  y = a + b·ln(x)' },
    { id: 'power', label: 'Kuvvet  y = a·x^b' },
  ];
  const METHOD_BY_ID = Object.fromEntries(METHODS.map((m) => [m.id, m]));

  // ---------- yardımcılar ----------

  function finitePairs(xs, ys) {
    const px = [], py = [];
    for (let i = 0; i < xs.length; i++) {
      if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) { px.push(xs[i]); py.push(ys[i]); }
    }
    return [px, py];
  }

  // x'e göre sırala, aynı x değerlerinin y ortalamasını al (interpolasyon için şart)
  function sortedUnique(xs, ys) {
    const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
    const ux = [], uy = [];
    let i = 0;
    while (i < idx.length) {
      const x = xs[idx[i]];
      let sum = 0, cnt = 0;
      while (i < idx.length && xs[idx[i]] === x) { sum += ys[idx[i]]; cnt++; i++; }
      ux.push(x); uy.push(sum / cnt);
    }
    return [ux, uy];
  }

  // Kısmi pivotlu Gauss eliminasyonu
  function solve(A, b) {
    const n = b.length;
    const M = A.map((row, i) => row.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-300) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = c + 1; r < n; r++) {
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    const x = new Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let s = M[r][n];
      for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
      x[r] = s / M[r][r];
    }
    return x;
  }

  function binom(n, k) {
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return r;
  }

  function horner(c, x) {
    let y = 0;
    for (let k = c.length - 1; k >= 0; k--) y = y * x + c[k];
    return y;
  }

  function stats(xs, ys, f) {
    const n = ys.length;
    const mean = ys.reduce((a, b) => a + b, 0) / n;
    let ssRes = 0, ssTot = 0;
    for (let i = 0; i < n; i++) {
      const e = ys[i] - f(xs[i]);
      ssRes += e * e;
      ssTot += (ys[i] - mean) ** 2;
    }
    let r2 = ssTot > 0 ? 1 - ssRes / ssTot : (ssRes < 1e-24 ? 1 : NaN);
    if (Math.abs(1 - r2) < 1e-13) r2 = 1;
    return { r2, r: r2 >= 0 ? Math.sqrt(r2) : NaN, rmse: Math.sqrt(ssRes / n) };
  }

  // ---------- sayı / formül biçimlendirme ----------

  function num(v, tr) {
    if (v === 0 || Object.is(v, -0)) return '0';
    let s = String(Number(v.toPrecision(15)));
    s = s.replace('e+', 'E').replace('e', 'E');
    if (tr) s = s.replace('.', ',');
    return s;
  }

  function short(v) {
    if (!Number.isFinite(v)) return String(v);
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e6 || a < 1e-4) return v.toExponential(5).replace(/\.?0+e/, 'e');
    return String(Number(v.toPrecision(7)));
  }

  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  const sup = (k) => String(k).split('').map((d) => SUP[d]).join('');

  // Excel: c0 + c1*v + c2*v^2 ... (v: "A1" ya da "(A1-3)")
  function excelPoly(c, v, tr) {
    let out = '';
    for (let k = 0; k < c.length; k++) {
      if (c[k] === 0) continue;
      const a = num(Math.abs(c[k]), tr);
      const body = k === 0 ? a : a + '*' + (k === 1 ? v : v + '^' + k);
      if (out === '') out = (c[k] < 0 ? '-' : '') + body;
      else out += (c[k] < 0 ? '-' : '+') + body;
    }
    return out || '0';
  }

  // Okunabilir: 1.2 + 3.4·x − 0.5·x²
  function prettyPoly(c, v) {
    let out = '';
    for (let k = 0; k < c.length; k++) {
      if (c[k] === 0) continue;
      const a = short(Math.abs(c[k]));
      const body = k === 0 ? a : a + '·' + (k === 1 ? v : v + sup(k));
      if (out === '') out = (c[k] < 0 ? '−' : '') + body;
      else out += (c[k] < 0 ? ' − ' : ' + ') + body;
    }
    return out || '0';
  }

  function shiftVar(ref, x0, tr) {
    if (x0 === 0) return ref;
    return '(' + ref + (x0 > 0 ? '-' : '+') + num(Math.abs(x0), tr) + ')';
  }

  // ---------- parçalı (piecewise) modeller ----------
  // segment: { from, to, x0, c:[c0,c1,c2,c3] }  y = Σ c_k (x-x0)^k
  // Veri aralığı dışındaki iki segment uç noktadaki teğet doğrusudur (güvenli ekstrapolasyon).

  function makePiecewise(px, py, coefs, leftSlope, rightSlope) {
    const n = px.length;
    const segs = [{ from: -Infinity, to: px[0], x0: px[0], c: [py[0], leftSlope, 0, 0], extrap: true }];
    for (let i = 0; i < n - 1; i++) segs.push({ from: px[i], to: px[i + 1], x0: px[i], c: coefs[i] });
    segs.push({ from: px[n - 1], to: Infinity, x0: px[n - 1], c: [py[n - 1], rightSlope, 0, 0], extrap: true });
    return segs;
  }

  function evalSegments(segs, x) {
    if (!Number.isFinite(x)) return NaN;
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (x >= segs[mid].from) lo = mid; else hi = mid - 1;
    }
    const s = segs[lo];
    return horner(s.c, x - s.x0);
  }

  function excelSegments(segs, ref, tr) {
    const parts = segs.map((s, i) => {
      const conds = [];
      if (i > 0) conds.push('(' + ref + '>=' + num(s.from, tr) + ')');
      if (i < segs.length - 1) conds.push('(' + ref + '<' + num(s.to, tr) + ')');
      const c = trimZeros(s.c);
      return conds.join('*') + '*(' + excelPoly(c, shiftVar(ref, s.x0, tr), tr) + ')';
    });
    return '=' + parts.join('+');
  }

  function trimZeros(c) {
    let k = c.length;
    while (k > 1 && c[k - 1] === 0) k--;
    return c.slice(0, k);
  }

  function linearCoefs(px, py) {
    const coefs = [];
    for (let i = 0; i < px.length - 1; i++) {
      coefs.push([py[i], (py[i + 1] - py[i]) / (px[i + 1] - px[i]), 0, 0]);
    }
    return coefs;
  }

  function naturalSplineCoefs(px, py) {
    const n = px.length;
    if (n < 3) return linearCoefs(px, py);
    const h = [];
    for (let i = 0; i < n - 1; i++) h.push(px[i + 1] - px[i]);
    // Üçlü köşegen sistem: ikinci türevler M (uçlarda 0)
    const m = n - 2;
    const a = new Array(m), b = new Array(m), c = new Array(m), d = new Array(m);
    for (let i = 1; i <= m; i++) {
      a[i - 1] = h[i - 1];
      b[i - 1] = 2 * (h[i - 1] + h[i]);
      c[i - 1] = h[i];
      d[i - 1] = 6 * ((py[i + 1] - py[i]) / h[i] - (py[i] - py[i - 1]) / h[i - 1]);
    }
    for (let i = 1; i < m; i++) { // Thomas algoritması
      const w = a[i] / b[i - 1];
      b[i] -= w * c[i - 1];
      d[i] -= w * d[i - 1];
    }
    const M = new Array(n).fill(0);
    for (let i = m - 1; i >= 0; i--) M[i + 1] = (d[i] - c[i] * M[i + 2]) / b[i];
    const coefs = [];
    for (let i = 0; i < n - 1; i++) {
      const delta = (py[i + 1] - py[i]) / h[i];
      coefs.push([py[i], delta - (h[i] * (2 * M[i] + M[i + 1])) / 6, M[i] / 2, (M[i + 1] - M[i]) / (6 * h[i])]);
    }
    return coefs;
  }

  function pchipCoefs(px, py) {
    const n = px.length;
    if (n < 3) return linearCoefs(px, py);
    const h = [], del = [];
    for (let i = 0; i < n - 1; i++) { h.push(px[i + 1] - px[i]); del.push((py[i + 1] - py[i]) / h[i]); }
    const d = new Array(n);
    for (let i = 1; i < n - 1; i++) {
      if (del[i - 1] * del[i] <= 0) d[i] = 0;
      else {
        const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
        d[i] = (w1 + w2) / (w1 / del[i - 1] + w2 / del[i]);
      }
    }
    const endSlope = (h0, h1, d0, d1) => {
      let s = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
      if (Math.sign(s) !== Math.sign(d0)) s = 0;
      else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(s) > Math.abs(3 * d0)) s = 3 * d0;
      return s;
    };
    d[0] = endSlope(h[0], h[1], del[0], del[1]);
    d[n - 1] = endSlope(h[n - 2], h[n - 3], del[n - 2], del[n - 3]);
    const coefs = [];
    for (let i = 0; i < n - 1; i++) {
      coefs.push([py[i], d[i], (3 * del[i] - 2 * d[i] - d[i + 1]) / h[i], (d[i] + d[i + 1] - 2 * del[i]) / (h[i] * h[i])]);
    }
    return coefs;
  }

  function fitPiecewise(method, xs, ys) {
    const [px, py] = sortedUnique(xs, ys);
    if (px.length < 2) return fail('En az 2 farklı x değeri gerekli');
    const coefs = method === 'linear' ? linearCoefs(px, py)
      : method === 'spline' ? naturalSplineCoefs(px, py) : pchipCoefs(px, py);
    const last = coefs[coefs.length - 1];
    const hl = px[px.length - 1] - px[px.length - 2];
    const leftSlope = coefs[0][1];
    const rightSlope = last[1] + 2 * last[2] * hl + 3 * last[3] * hl * hl;
    const segs = makePiecewise(px, py, coefs, leftSlope, rightSlope);
    const f = (x) => evalSegments(segs, x);
    const label = { linear: 'Parçalı doğrusal', spline: 'Parçalı kübik (natural spline)', pchip: 'Parçalı kübik (PCHIP)' }[method];
    return {
      ok: true, method, eval: f, segments: segs, n: xs.length,
      domain: [px[0], px[px.length - 1]],
      ...stats(xs, ys, f),
      interpolating: true,
      formula: label + ', ' + (px.length - 1) + ' aralık; veri dışında uçtaki teğet doğrusu ile devam eder',
      excel: (ref, opt) => excelSegments(segs, ref || 'A1', opt && opt.tr),
    };
  }

  // ---------- regresyon modelleri ----------

  function polyFit(xs, ys, deg) {
    // Sayısal kararlılık için x'i ölçekle, sonra ham katsayılara aç
    const n = xs.length;
    let mn = Infinity, mx = -Infinity;
    for (const x of xs) { if (x < mn) mn = x; if (x > mx) mx = x; }
    const m = (mn + mx) / 2, s = (mx - mn) / 2 || 1;
    const t = xs.map((x) => (x - m) / s);
    const A = Array.from({ length: deg + 1 }, () => new Array(deg + 1).fill(0));
    const b = new Array(deg + 1).fill(0);
    for (let i = 0; i < n; i++) {
      const pw = [1];
      for (let k = 1; k <= 2 * deg; k++) pw.push(pw[k - 1] * t[i]);
      for (let r = 0; r <= deg; r++) {
        b[r] += pw[r] * ys[i];
        for (let c = 0; c <= deg; c++) A[r][c] += pw[r + c];
      }
    }
    const ct = solve(A, b);
    if (!ct) return null;
    const raw = new Array(deg + 1).fill(0);
    for (let k = 0; k <= deg; k++) {
      const ck = ct[k] / Math.pow(s, k);
      for (let j = 0; j <= k; j++) raw[j] += ck * binom(k, j) * Math.pow(-m, k - j);
    }
    return { raw, scaled: ct, m, s };
  }

  function fitPoly(deg, xs, ys) {
    const ux = new Set(xs).size;
    if (ux < deg + 1) return fail(deg + '. derece için en az ' + (deg + 1) + ' farklı x değeri gerekli');
    const p = polyFit(xs, ys, deg);
    if (!p) return fail('Denklem çözülemedi (tekil matris)');
    // Grafikte/Excel'de aynı sonucu görmek için ham katsayılarla hesapla
    const f = (x) => horner(p.raw, x);
    const st = stats(xs, ys, f);
    if (deg === 1 && p.raw[1] < 0) st.r = -st.r; // doğrusal regresyonda R işaretli (Pearson r)
    return {
      ok: true, method: 'poly' + deg, eval: f, coef: p.raw, n: xs.length,
      domain: [Math.min(...xs), Math.max(...xs)],
      ...st,
      formula: 'y = ' + prettyPoly(p.raw, 'x'),
      excel: (ref, opt) => '=' + excelPoly(p.raw, ref || 'A1', opt && opt.tr),
    };
  }

  function linReg(xs, ys) {
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
    if (sxx === 0) return null;
    const b = sxy / sxx;
    return { a: my - b * mx, b };
  }

  function fitExp(xs, ys) {
    if (ys.some((y) => y <= 0)) return fail('Üstel model için tüm y değerleri > 0 olmalı');
    const l = linReg(xs, ys.map(Math.log));
    if (!l) return fail('En az 2 farklı x değeri gerekli');
    const a = Math.exp(l.a), b = l.b;
    const f = (x) => a * Math.exp(b * x);
    return {
      ok: true, method: 'exp', eval: f, coef: [a, b], n: xs.length,
      domain: [Math.min(...xs), Math.max(...xs)], ...stats(xs, ys, f),
      formula: 'y = ' + short(a) + '·e^(' + short(b) + '·x)',
      excel: (ref, opt) => '=' + num(a, opt && opt.tr) + '*' + (opt && opt.tr ? 'ÜS' : 'EXP') + '(' + num(b, opt && opt.tr) + '*' + (ref || 'A1') + ')',
    };
  }

  function fitLog(xs, ys) {
    if (xs.some((x) => x <= 0)) return fail('Logaritmik model için tüm x değerleri > 0 olmalı');
    const l = linReg(xs.map(Math.log), ys);
    if (!l) return fail('En az 2 farklı x değeri gerekli');
    const f = (x) => (x > 0 ? l.a + l.b * Math.log(x) : NaN);
    return {
      ok: true, method: 'log', eval: f, coef: [l.a, l.b], n: xs.length,
      domain: [Math.min(...xs), Math.max(...xs)], ...stats(xs, ys, f),
      formula: 'y = ' + prettyPoly([l.a, l.b], 'ln(x)'),
      excel: (ref, opt) => '=' + excelPoly([l.a, l.b], 'LN(' + (ref || 'A1') + ')', opt && opt.tr),
    };
  }

  function fitPower(xs, ys) {
    if (xs.some((x) => x <= 0) || ys.some((y) => y <= 0)) return fail('Kuvvet modeli için tüm x ve y değerleri > 0 olmalı');
    const l = linReg(xs.map(Math.log), ys.map(Math.log));
    if (!l) return fail('En az 2 farklı x değeri gerekli');
    const a = Math.exp(l.a), b = l.b;
    const f = (x) => (x > 0 ? a * Math.pow(x, b) : NaN);
    return {
      ok: true, method: 'power', eval: f, coef: [a, b], n: xs.length,
      domain: [Math.min(...xs), Math.max(...xs)], ...stats(xs, ys, f),
      formula: 'y = ' + short(a) + '·x^' + short(b),
      excel: (ref, opt) => '=' + num(a, opt && opt.tr) + '*' + (ref || 'A1') + '^(' + num(b, opt && opt.tr) + ')',
    };
  }

  function fail(error) {
    return { ok: false, error, eval: () => NaN, r: NaN, r2: NaN, excel: () => '', formula: '' };
  }

  function fit(method, xs, ys) {
    const [px, py] = finitePairs(xs, ys);
    if (px.length < 2) return fail('En az 2 sayısal nokta gerekli');
    let res;
    if (method === 'linear' || method === 'spline' || method === 'pchip') res = fitPiecewise(method, px, py);
    else if (/^poly\d$/.test(method)) res = fitPoly(Number(method.slice(4)), px, py);
    else if (method === 'exp') res = fitExp(px, py);
    else if (method === 'log') res = fitLog(px, py);
    else if (method === 'power') res = fitPower(px, py);
    else res = fail('Bilinmeyen yöntem: ' + method);
    res.method = method;
    return res;
  }

  return { METHODS, METHOD_BY_ID, fit, short, num };
});

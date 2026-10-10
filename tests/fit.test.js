// node tests/fit.test.js — fit.js için hızlı doğrulama
const assert = require('assert');
const Fit = require('../fit.js');

// Excel formülünü JS'e çevirip modelle aynı sonucu verdiğini kontrol et
function excelToFn(formula) {
  const js = formula.slice(1).replace(/A1/g, 'x').replace(/\^/g, '**')
    .replace(/EXP\(/g, 'Math.exp(').replace(/LN\(/g, 'Math.log(').replace(/>=/g, '>=');
  return new Function('x', 'return ' + js);
}
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

const xs = [1, 2, 3, 4, 5, 6, 7];
const ys = xs.map((x) => 2 + 3 * x - 0.5 * x * x);

for (const m of Fit.METHODS) {
  const xx = m.id === 'log' || m.id === 'power' ? xs : xs;
  const yy = m.id === 'exp' || m.id === 'power' ? xs.map((x) => 2 * Math.exp(0.3 * x)) : ys;
  const r = Fit.fit(m.id, xx, yy);
  assert.ok(r.ok, m.id + ': ' + r.error);
  const fn = excelToFn(r.excel('A1'));
  for (const x of [-3, 0.5, 1, 2.5, 4, 7, 9.3]) {
    const a = r.eval(x), b = fn(x);
    if (Number.isFinite(a)) assert.ok(close(a, b), `${m.id} x=${x}: ${a} vs ${b}`);
  }
  if (m.interp) for (let i = 0; i < xs.length; i++) assert.ok(close(r.eval(xx[i]), yy[i]), m.id + ' interp');
  console.log(m.id.padEnd(7), 'R²=', r.r2.toFixed(6), r.formula.slice(0, 70));
}

// Tam kuadratik veride poly2 kesin olmalı
const p2 = Fit.fit('poly2', xs, ys);
assert.ok(close(p2.coef[0], 2) && close(p2.coef[1], 3) && close(p2.coef[2], -0.5));
assert.strictEqual(p2.r2, 1);
// Büyük x ofsetinde bile kararlı
const bx = xs.map((x) => x + 1e4), p3 = Fit.fit('poly3', bx, ys);
assert.ok(p3.r2 > 0.999999, 'offset poly3 ' + p3.r2);
// Türkçe Excel: ondalık virgül
assert.ok(Fit.fit('poly1', [1, 2], [1.5, 2.5]).excel('B2', { tr: true }).includes('0,5'));
console.log('Tüm testler geçti');

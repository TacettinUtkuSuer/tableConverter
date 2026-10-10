# tableConverter — Eğri Uydurma

CSV verisine interpolasyon / regresyon eğrisi oturtan, bir sütuna girilen değerin
diğer sütunlarda neye karşılık geldiğini hesaplayan tarayıcı uygulaması.
Kurulum gerektirmez: `index.html` dosyasını tarayıcıda açmanız yeterli (internet gerekmez).

## Özellikler

- **Sekmeler:** `+` ile yeni sekme, her sekmede ayrı CSV ve ayarlar. Çift tıkla yeniden adlandır.
  Tüm durum tarayıcıda (localStorage) saklanır.
- **CSV:** yapıştır, dosya seç ya da sürükle-bırak. Ayırıcı (`,` `;` sekme `|`) ve ondalık
  (`1.5` / `1,5`) otomatik algılanır. İlk satır *başlık / yoksay / veri* seçilebilir,
  baştan N satır atlanabilir.
- **Değer sorgulama:** bir sütun (veya *Satır no* = 1, 2, 3…) seçip değer girin; diğer tüm
  sütunlardaki karşılığı hesaplanır. Veri aralığı dışındaysa **⚠ Ekstrapolasyon** uyarısı
  ve aralığın yüzde kaçı dışarıda olduğu gösterilir.
- **Yöntemler** (her sütun için ayrı seçilebilir):
  parçalı doğrusal, kübik spline (natural), monoton kübik (PCHIP),
  polinom 1–6. derece, üstel, logaritmik, kuvvet.
  Parçalı yöntemler veri dışında uçtaki teğet doğrusu ile devam eder (güvenli ekstrapolasyon).
- **R, R², formül ve Excel formülü:** Excel formülü varsayılan olarak `A1` hücresini kullanır
  (değiştirilebilir). Spline'lar da tek hücre formülü olarak verilir. *Türkçe Excel* seçeneği
  ondalık virgül ve `ÜS` kullanır.
- **Grafikler:** istediğiniz kadar grafik; her birinde X ekseni (veya satır no) ve birden çok
  Y sütunu seçilir. Ekstrapolasyon bölgeleri kırmızı gölgeli ve eğri kesikli çizilir.
  Üzerine gelince değerler görünür, tıklayınca o X değeri sorgulanır. X/Y aralığı elle ayarlanabilir.

## Test

```
node tests/fit.test.js
```

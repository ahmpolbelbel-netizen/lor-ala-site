'use strict';
/* doctor-sw: service worker кабинета врача (scope /wwwdoctor.html).
   Даёт браузеру показать кнопку установки и открывает установленное
   приложение без сети. PUSH НЕ ТРОГАЕТ: push остаётся в mobile-online-push-sw.js.
   ВАЖНО: перехватывает ТОЛЬКО навигации (саму страницу кабинета). Иконки, манифест
   и прочие GET браузер забирает сам — установка приложения не должна зависеть
   от нашего кэша и от качества сети в момент проверки. */
var LOR_DOCTOR_CACHE = 'lor-doctor-v1';
self.addEventListener('install', function (event) { self.skipWaiting(); });
self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== LOR_DOCTOR_CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.mode !== 'navigate') return;                 /* всё, кроме открытия страниц — мимо */
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;    /* внешнее (API) — мимо */
  /* страница кабинета: всегда свежая из сети, при отсутствии сети — из кэша */
  event.respondWith(fetch(req).then(function (res) {
    var cp = res.clone();
    caches.open(LOR_DOCTOR_CACHE).then(function (c) { c.put(req, cp); });
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) { return hit || caches.match('/wwwdoctor.html'); });
  }));
});

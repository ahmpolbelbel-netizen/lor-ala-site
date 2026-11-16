'use strict';
/* doctor-sw: service worker кабинета врача (scope /wwwdoctor.html).
   Даёт браузеру показать кнопку установки и открывает установленное
   приложение без сети. PUSH НЕ ТРОГАЕТ: push остаётся в mobile-online-push-sw.js. */
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
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   /* API и прочее внешнее — не трогаем */
  if (req.mode === 'navigate') {
    /* страница кабинета: всегда свежая из сети, при отсутствии сети — из кэша */
    event.respondWith(fetch(req).then(function (res) {
      var cp = res.clone();
      caches.open(LOR_DOCTOR_CACHE).then(function (c) { c.put(req, cp); });
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || caches.match('/wwwdoctor.html'); });
    }));
    return;
  }
  /* свои статические файлы (иконки, манифест): кэш сразу, обновление в фоне */
  event.respondWith(caches.match(req).then(function (hit) {
    var fp = fetch(req).then(function (res) {
      var cp = res.clone();
      caches.open(LOR_DOCTOR_CACHE).then(function (c) { c.put(req, cp); });
      return res;
    });
    return hit || fp;
  }));
});

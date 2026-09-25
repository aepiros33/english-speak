/* 간단한 서비스 워커: 앱 파일을 캐시해 오프라인에서도 열리게 함.
   파일을 수정해 배포할 때는 CACHE 이름의 버전을 올리세요. */
var CACHE = 'speak-app-v2';
var ASSETS = [
  './', './index.html', './style.css', './app.js', './core.js', './data.js', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'
];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
/* stale-while-revalidate: 캐시를 먼저 보여주고, 뒤에서 새 버전을 받아 캐시 갱신 */
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(function (cache) {
    return cache.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(function () {
        return hit || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
      });
      return hit || net;
    });
  }));
});

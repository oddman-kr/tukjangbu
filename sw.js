// 앱 화면은 폰에 보관해 둔 것을 즉시 보여 주고, 새 버전은 뒤에서 받아 다음 실행 때 적용 (데이터는 항상 서버에서)
const V = 'hhb-v26';
const SHELL = ['./', './index.html', './config.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // 로그인 버전(/v2/)과 지금 버전(/)은 서로 다른 화면이에요. 섞이지 않게 따로 보관해요
  const key = e.request.mode === 'navigate' ? (u.pathname.indexOf('/v2/') >= 0 ? './v2/index.html' : './index.html') : e.request;
  e.respondWith(caches.open(V).then(c => c.match(key, { ignoreSearch: true }).then(hit => {
    const net = fetch(e.request).then(r => { if (r && r.ok) c.put(key, r.clone()); return r; }).catch(() => hit);
    if (hit) { e.waitUntil(net); return hit; }
    return net;
  })));
});

// 화면(HTML)은 항상 최신 것을 먼저 받아요. 인터넷이 느리거나 끊기면(2.5초) 폰에 보관한 화면을 보여 줘요.
// 아이콘 같은 나머지 파일은 보관본을 바로 쓰고 뒤에서 새로 받아요. (데이터는 항상 서버에서)
const V = 'hhb-v32';
const SHELL = ['./', './index.html', './config.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => Promise.all(SHELL.map(u => fetch(u, { cache: 'reload' }).then(r => r.ok && c.put(u, r)).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (e.request.mode === 'navigate') {
    // 로그인 버전(/v2/)과 지금 버전(/)은 서로 다른 화면이라 따로 보관해요
    const key = u.pathname.indexOf('/v2/') >= 0 ? './v2/index.html' : './index.html';
    e.respondWith(caches.open(V).then(c => {
      const net = fetch(e.request, { cache: 'no-cache' }).then(r => { if (r && r.ok) c.put(key, r.clone()); return r; });
      const slow = new Promise(res => setTimeout(res, 2500)).then(() => c.match(key));
      return Promise.race([net.catch(() => c.match(key)), slow.then(h => h || net)]).then(r => r || net);
    }));
    return;
  }
  e.respondWith(caches.open(V).then(c => c.match(e.request, { ignoreSearch: true }).then(hit => {
    const net = fetch(e.request).then(r => { if (r && r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    if (hit) { e.waitUntil(net); return hit; }
    return net;
  })));
});

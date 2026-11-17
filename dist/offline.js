const version = 'gestor-pedidos-offline-v1'
const assets = ['./', './index.html', './style.css', './app.js', './catalog.js', './cloud.js', './cloud-config.js', './plantilla.xlsx']
self.addEventListener('install', event => {
  event.waitUntil(caches.open(version).then(cache => cache.addAll(assets)))
})
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('gestor-pedidos-offline-') && key !== version).map(key => caches.delete(key)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return
  event.respondWith(fetch(event.request).catch(async () => {
    const cached = await caches.match(event.request, {ignoreSearch:true})
    return cached || (event.request.mode === 'navigate' && await caches.match('./index.html')) || Response.error()
  }))
})

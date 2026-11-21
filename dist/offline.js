const version = 'gestor-pedidos-offline-v19'
const assets = [
  './', './index.html', './style.css?v=19', './app.js?v=19', './catalog.js?v=16', './cloud.js?v=19', './push.js?v=19', './cloud-config.js',
  './plantilla.xlsx', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './icons/maskable-512.png', './icons/apple-touch-icon.png'
]
self.addEventListener('install', event => {
  event.waitUntil(caches.open(version).then(cache => cache.addAll(assets)).then(() => self.skipWaiting()))
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
self.addEventListener('push', event => {
  let payload={title:'Novedad en tus pedidos',body:'Abre la app para ver el detalle.'}
  try { payload={...payload,...event.data.json()} } catch {}
  const target=new URL(payload.url || './',self.registration.scope)
  const allowed=new URL(self.registration.scope)
  const url=target.origin===allowed.origin && target.pathname.startsWith(allowed.pathname) ? target.href : allowed.href
  event.waitUntil(Promise.all([
    self.registration.showNotification(payload.title,{body:payload.body,icon:'./icons/icon-192.png',badge:'./icons/icon-192.png',tag:payload.tag,silent:false,data:{url}}),
    self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>clients.forEach(client=>client.postMessage({type:'order-push',title:payload.title,body:payload.body})))
  ]))
})
self.addEventListener('notificationclick',event=>{
  event.notification.close()
  event.waitUntil((async()=>{
    const url=event.notification.data?.url || self.registration.scope
    const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true})
    const existing=clients.find(client=>client.url.startsWith(self.registration.scope))
    if(existing) { await existing.navigate(url); await existing.focus() }
    else await self.clients.openWindow(url)
  })())
})

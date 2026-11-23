/* Service worker mínimo: deixa o app instalável e mostra uma tela amigável sem internet.
   Não guarda dados do Supabase (só arquivos do próprio site), então nada sensível fica em cache. */
const V = 'ga-v2'   // v2: descarta caches antigos
const OFFLINE = '/offline.html'
self.addEventListener('install', (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll([OFFLINE, '/icon-192.png'])).then(() => self.skipWaiting())) })
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())) })
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url)
  if (r.method !== 'GET' || u.origin !== self.location.origin) return          // Supabase e outros domínios passam direto
  if (r.mode === 'navigate') { e.respondWith(fetch(r).catch(() => caches.match(OFFLINE))); return }   // sempre a versão mais nova; offline → aviso
  if (u.pathname.startsWith('/assets/')) {                                        // arquivos com hash: cache-first
    e.respondWith(caches.open(V).then(async (c) => { const h = await c.match(r); if (h && !/text\/html/.test(h.headers.get('content-type') || '')) return h; const n = await fetch(r); if (n.ok && !/text\/html/.test(n.headers.get('content-type') || '')) c.put(r, n.clone()); return n }))
  }
})

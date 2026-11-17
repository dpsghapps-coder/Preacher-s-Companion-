const V='hymnal-v17', DATA='hymnal-data-v15';
// The databases are large: not precached, cached after the first successful download, and kept across versions.
const FILES=['./','index.html','app.js','style.css','manifest.webmanifest','icon.svg','shepherds-staff-cover.jpg','vendor/sql-wasm.js','vendor/sql-wasm.wasm'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V&&x!==DATA).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const r=e.request; if(r.method!=='GET')return;
  const url=new URL(r.url);
  if(url.origin!==location.origin||url.pathname.startsWith('/api/'))return;      // Google script, API: straight to network
  const dbm=url.pathname.match(/\/(hymnal|staff)\.db$/);
  if(dbm){const key=dbm[1]+'.db';
    e.respondWith((async()=>{
      const cache=await caches.open(DATA), hit=await cache.match(key);
      const net=fetch(r).then(async res=>{ if(res.ok) await cache.put(key,res.clone()); return res; });
      if(r.cache==='reload') return net;                          // "Update database": network only, errors reach the page
      if(hit){ net.catch(()=>{}); return hit; }                   // stale-while-revalidate
      return net;
    })());
    return;
  }
  e.respondWith(caches.match(r,{ignoreSearch:true}).then(x=>x||fetch(r)));
});

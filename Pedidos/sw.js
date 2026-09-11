const CACHE_NAME = "tago-pedidos-v2";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Siempre intenta traer la versión más nueva de la red primero;
// solo usa la copia en caché si no hay conexión (para que las
// actualizaciones de la app se vean de inmediato en cada visita).
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

// Al tocar un aviso del chat: si Pedidos ya está abierto, lo trae al frente y le pide que
// abra esa conversación; si no, abre la app directo en ella.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const chatId = event.notification.data && event.notification.data.chatId;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((lista) => {
      const abierto = lista.find((w) => w.url.includes("/pedidos"));
      if (abierto) {
        abierto.focus();
        if (chatId) abierto.postMessage({ abrirChat: chatId });
        return;
      }
      return self.clients.openWindow("/pedidos/" + (chatId ? "#chat=" + chatId : ""));
    })
  );
});

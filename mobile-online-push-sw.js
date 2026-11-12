self.addEventListener('push', event => {
  let data = {}; try { data = event.data ? event.data.json() : {}; } catch (_) {}
  event.waitUntil(self.registration.showNotification('Новая онлайн-запись', {
    body: 'Откройте кабинет врача и проверьте отдельный список онлайн-записей.',
    tag: String(data.tag || 'lor-online-booking'), renotify: false,
    data: { url: 'https://lor-ala.vercel.app/wwwdoctor.html' }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = 'https://lor-ala.vercel.app/wwwdoctor.html';
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) if (client.url.startsWith('https://lor-ala.vercel.app/')) { await client.focus(); return; }
    await self.clients.openWindow(url);
  })());
});

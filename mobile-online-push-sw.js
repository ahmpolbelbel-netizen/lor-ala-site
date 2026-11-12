/* One same-origin service worker handles doctor alerts and patient reminders. */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  const isPatientReminder = data && data.type === 'patient_reminder';
  const title = isPatientReminder ? 'Напоминание о записи' : 'Новая онлайн-запись';
  const body = isPatientReminder && typeof data.body === 'string'
    ? data.body
    : (isPatientReminder
      ? 'Напоминаем о вашей предварительной записи. Откройте страницу онлайн-записи для подробностей.'
      : 'Откройте кабинет врача и проверьте отдельный список онлайн-записей.');
  const url = isPatientReminder
    ? 'https://lor-ala.vercel.app/lk_with_online_booking.html'
    : 'https://lor-ala.vercel.app/wwwdoctor.html';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag: String(data && data.tag || (isPatientReminder ? 'lor-patient-reminder' : 'lor-online-booking')),
    renotify: false,
    data: { url }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = event.notification.data && event.notification.data.url || 'https://lor-ala.vercel.app/wwwdoctor.html';
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      if (client.url.startsWith('https://lor-ala.vercel.app/')) {
        await client.focus();
        if ('navigate' in client && client.url !== url) await client.navigate(url);
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});

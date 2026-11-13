/* Shared same-origin worker for physician alerts and patient reminders. */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  const isPatientReminder = data && data.type === 'patient_reminder';
  const title = typeof data.title === 'string' && data.title.trim()
    ? data.title.trim()
    : (isPatientReminder ? 'Доктор ЛОР' : 'Онлайн-запись');
  const body = typeof data.body === 'string' && data.body.trim()
    ? data.body.trim()
    : (isPatientReminder ? 'Напоминаем о вашей записи.' : 'Проверьте список онлайн-записей.');
  const fallbackUrl = isPatientReminder
    ? 'https://lor-ala.vercel.app/lk_with_online_booking.html?push=booking-confirmed'
    : 'https://lor-ala.vercel.app/wwwdoctor.html';
  const url = typeof data.url === 'string' && data.url.startsWith('https://lor-ala.vercel.app/')
    ? data.url
    : fallbackUrl;
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

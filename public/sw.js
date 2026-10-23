/*
 * Service worker for band alerts (Web Push). Only shows notifications and opens the
 * linked page; no caching, no offline behavior.
 */

self.addEventListener("push", (event) => {
  let data = { title: "The Leftovers", body: "", url: "/admin", tag: undefined };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    // Malformed payload: show the generic alert.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: "/brand/app-icon-192.png",
      badge: "/brand/app-icon-192.png",
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Only ever navigate within this site.
  const target = new URL(event.notification.data?.url ?? "/admin", self.location.origin);
  const url = target.origin === self.location.origin ? target.href : `${self.location.origin}/admin`;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

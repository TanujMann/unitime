// UniTime AI — Push-capable Service Worker
// This file MUST be served as a separate file (not blob URL) for iOS push to work

const CACHE = 'unitime-v4';

// ── Install & Activate ──
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
  startLocalChecker();
});

// ── Offline Cache ──
self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});

// ══════════════════════════════════════════════
//  PUSH EVENT — Fires even when app is closed!
// ══════════════════════════════════════════════
self.addEventListener('push', event => {
  let data = { title: 'UniTime AI', body: 'You have a reminder!' };
  
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    try {
      data.body = event.data.text();
    } catch (e2) {}
  }

  const options = {
    body: data.body || '',
    icon: data.icon || undefined,
    badge: data.badge || undefined,
    tag: data.tag || 'unitime-push-' + Date.now(),
    renotify: true,
    requireInteraction: data.urgent || false,
    silent: false,
    vibrate: data.urgent ? [200, 80, 200, 80, 400] : [100, 50, 100],
    data: data.data || {},
    actions: data.actions || [
      { action: 'open', title: 'Open App' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const isVisible = clients.some(client => client.visibilityState === 'visible');
      if (isVisible) {
        clients.forEach(client => client.postMessage({
          action: 'SHOW_IN_APP_NOTIF',
          payload: data
        }));
        return null;
      }
      return self.registration.showNotification(data.title, options);
    })
  );
});

// ── Notification Click ──
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if (client.url) {
          client.focus();
          client.postMessage({
            action: 'NOTIFICATION_CLICKED',
            type: event.notification.data?.type || 'class'
          });
          return;
        }
      }
      return self.clients.openWindow('./index.html');
    })
  );
});

self.addEventListener('notificationclose', () => {});

// ══════════════════════════════════════════════
//  LOCAL FALLBACK CHECKER (in-memory, for when
//  push server is not set up)
// ══════════════════════════════════════════════
let _localReminders = [];
let _localFired = new Set();
let _localInterval = null;

self.addEventListener('message', event => {
  const data = event.data;
  if (!data) return;
  
  if (data.action === 'SYNC_REMINDERS') {
    _localReminders = [].concat(data.classReminders || [], data.taskReminders || []);
    const newKeys = new Set(_localReminders.map(r => getKey(r)));
    for (const key of _localFired) {
      if (!newKeys.has(key)) _localFired.delete(key);
    }
    if (!_localInterval) startLocalChecker();
  }
});

function getKey(r) {
  return (r.type || '') + '_' + (r.subject || r.title || '') + '_' + r.fireAt;
}

function startLocalChecker() {
  if (_localInterval) clearInterval(_localInterval);
  _localInterval = setInterval(checkLocal, 15000);
}

function checkLocal() {
  if (!_localReminders.length) return;
  const now = Date.now();
  for (const r of _localReminders) {
    const key = getKey(r);
    if (_localFired.has(key)) continue;
    if (r.fireAt <= now && r.fireAt > now - 20000) {
      _localFired.add(key);
      fireLocal(r);
    }
  }
  _localReminders = _localReminders.filter(r => r.fireAt > now - 300000);
}

function fireLocal(r) {
  const isUrgent = r.urgency === 'urgent';
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const isVisible = clients.some(client => client.visibilityState === 'visible');
    
    if (r.type === 'class') {
      const title = isUrgent ? '\u{1F6A8} ' + r.subject + ' \u2014 Starting NOW!' : '\u2728 ' + r.subject + ' in ' + r.minsLeft + ' min';
      const body = (r.room ? '\u{1F4CD} ' + r.room : '') + (r.prof ? ' \u00B7 ' + r.prof : '');
      const options = {
        body,
        tag: 'unitime-class-' + r.subject + '-' + r.minsLeft,
        renotify: true,
        requireInteraction: isUrgent,
        vibrate: isUrgent ? [200,80,200,80,400] : [100,50,100],
        data: { type: 'class', subject: r.subject },
        actions: [{ action: 'open', title: 'Open App' }, { action: 'dismiss', title: 'Dismiss' }]
      };
      
      if (isVisible) {
        clients.forEach(client => client.postMessage({ action: 'SHOW_IN_APP_NOTIF', payload: { title, body, originalData: r, urgent: isUrgent, data: options.data } }));
        return;
      }
      self.registration.showNotification(title, options).catch(() => {});
    } else {
      const isNow = r.minsLeft <= 0;
      const title = isNow ? '\u{1F6A8} ' + r.title + ' \u2014 Due NOW!' : '\u2728 ' + r.title + ' in ' + r.minsLeft + ' min';
      const body = (r.subject ? '\u{1F4DA} ' + r.subject + '\n' : '') + 'Priority: ' + (r.pri === 'h' ? 'High' : r.pri === 'l' ? 'Low' : 'Medium');
      const options = {
        body,
        tag: 'unitime-task-' + (r.title || '') + '-' + r.minsLeft,
        renotify: true,
        requireInteraction: isNow,
        vibrate: isNow ? [200,80,200,80,400] : [100,50,100],
        data: { type: 'task', title: r.title },
        actions: [{ action: 'open', title: 'Open App' }, { action: 'dismiss', title: 'Dismiss' }]
      };
      
      if (isVisible) {
        clients.forEach(client => client.postMessage({ action: 'SHOW_IN_APP_NOTIF', payload: { title, body, originalData: r, urgent: isNow, data: options.data } }));
        return;
      }
      self.registration.showNotification(title, options).catch(() => {});
    }
  });
}

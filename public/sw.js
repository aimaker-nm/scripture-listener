// Minimal service worker so Chrome can install the page as an app. Everything is served live
// by the local server (nothing cached), so the app always shows the current version.
self.addEventListener('fetch', () => {});

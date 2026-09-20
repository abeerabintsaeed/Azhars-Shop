(async () => {
  const AZ = window.AZ, S = AZ.state;
  try {
    const [settings, categories, sales, me] = await Promise.all([
      AZ.api('/api/settings'), AZ.api('/api/categories'), AZ.api('/api/sales/active'), AZ.api('/api/auth/me')
    ]);
    Object.assign(S, { settings, categories, sales, user: me.user });
  } catch (e) {
    AZ.setApp('<div class="container"><div class="empty" style="padding:120px 0"><h3>' + (navigator.onLine ? 'The store could not start' : 'You are offline') + '</h3><p>' + AZ.esc(e.message) + '</p><p style="margin-top:20px"><button class="btn btn-primary" data-act="reload">Try again</button></p></div></div>');
    return;
  }
  AZ.renderChrome();
  await AZ.route();
})();

// Make the store installable and quick to reopen (works on https and on localhost).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

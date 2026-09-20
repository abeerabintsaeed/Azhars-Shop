(() => {
'use strict';
const AZ = window.AZ = { state: { user: null, settings: {}, categories: [], sales: [] }, routes: [], actions: {}, forms: {}, changes: {} };
const S = AZ.state;

// ---------- utilities ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => 'Rs. ' + Math.round(Number(n) || 0).toLocaleString('en-US');
const fdate = d => { const x = new Date(String(d).includes('T') ? d : String(d).replace(' ', 'T') + 'Z'); return x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
async function api(url, opts = {}) {
  const o = { credentials: 'same-origin', method: opts.method || 'GET', headers: {} };
  if (opts.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
  let r;
  try { r = await fetch(url, o); } catch { throw new Error('We cannot reach the store right now. Please check your internet connection and try again.'); }
  let data = null; try { data = await r.json(); } catch { /* not json */ }
  if (!r.ok) { const e = new Error((data && data.error) || 'Something went wrong. Please try again.'); e.status = r.status; throw e; }
  return data;
}
function toast(msg, opts = {}) {
  const el = document.createElement('div');
  el.className = 'toast' + (opts.err ? ' err' : '');
  el.innerHTML = `<span>${esc(msg)}</span>` + (opts.link ? `<a href="${esc(opts.link)}">${esc(opts.linkText)}</a>` : '');
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), opts.ms || 3800);
}
function modal(html, onMount) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-bg" data-act="modal-bg"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  if (onMount) onMount($('.modal', root));
  const first = $('.modal input, .modal select, .modal textarea', root); if (first) first.focus();
}
const closeModal = () => { $('#modal-root').innerHTML = ''; };
function confirmBox(title, text, okLabel = 'Delete') {
  return new Promise(res => {
    modal(`<h3>${esc(title)}</h3><p class="muted">${esc(text)}</p><div class="actions"><button class="btn btn-ghost" data-act="cfm-no">Cancel</button><button class="btn btn-danger" data-act="cfm-yes">${esc(okLabel)}</button></div>`);
    AZ._cfm = v => { closeModal(); res(v); };
  });
}
const go = h => { location.hash = h; };
const setApp = html => { $('#app').innerHTML = html; window.scrollTo(0, 0); };
const spinner = () => '<div class="spinner"></div>';
Object.assign(AZ, { $, $$, esc, fmt, fdate, api, toast, modal, closeModal, confirmBox, go, setApp });

const ICON = {
  truck: '<svg viewBox="0 0 24 24"><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7.5" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/></svg>',
  cash: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="3"/><circle cx="12" cy="12" r="2.6"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="18" rx="3"/><path d="M11 18h2"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
};
const COLORS = { Black: '#2A2730', Tan: '#B98A5E', Brown: '#6B4630', Burgundy: '#6E2A3A', Sage: '#8FA88A', Lilac: '#B9A6E6', Ivory: '#EFE9DD', Navy: '#2D3A5C', White: '#FFFFFF', Grey: '#9A97A3', Gray: '#9A97A3', Beige: '#D9C8AE', Olive: '#6E7440', Camel: '#B98A5E', Cream: '#F1EBDD', Red: '#B23A3A', Blue: '#3D5A99', Green: '#4F7A55', Pink: '#E8B4C6', Purple: '#8064B8', Maroon: '#5A1F2C', Cognac: '#9A5B32', Chocolate: '#4A2E22' };
const KIND = { formal: 'oxford', sneakers: 'sneaker', boots: 'boot', sandals: 'sandal', wallets: 'wallet', belts: 'belt', bags: 'bag', 'shoe-care': 'care' };
AZ.COLORS = COLORS;

// ---------- cart (kept in the browser; prices are always re-checked by the server) ----------
const CART_KEY = 'azhars_cart';
const cart = AZ.cart = {
  items: (() => { try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]').filter(i => i && i.v && i.q > 0); } catch { return []; } })(),
  save() { try { localStorage.setItem(CART_KEY, JSON.stringify(this.items)); } catch { /* private mode */ } this.badge(); },
  count() { return this.items.reduce((a, i) => a + i.q, 0); },
  add(v, q = 1) { const it = this.items.find(i => i.v === v); if (it) it.q += q; else this.items.push({ v, q }); this.save(); },
  set(v, q) { const it = this.items.find(i => i.v === v); if (!it) return; it.q = Math.max(1, q); this.save(); },
  remove(v) { this.items = this.items.filter(i => i.v !== v); this.save(); },
  clear() { this.items = []; this.save(); },
  badge() { const n = this.count(), b = $('#cart-count'); if (b) { b.textContent = n; b.hidden = n === 0; } },
  payload() { return this.items.map(i => ({ variant_id: i.v, qty: i.q })); }
};

// ---------- install as an app ----------
let installPrompt = null;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
window.addEventListener('appinstalled', () => { installPrompt = null; toast('AZHARS is installed on this device'); renderChrome(); });
AZ.actions.install = async () => {
  if (installPrompt) { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; return; }
  const ua = navigator.userAgent, ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1), android = /android/i.test(ua);
  const row = (mine, title, steps) => `<div class="note ${mine ? 'ok' : 'info'}" style="margin-bottom:10px"><b>${title}${mine ? ' (this device)' : ''}</b><ol style="margin:8px 0 0;padding-left:20px">${steps.map(x => `<li>${x}</li>`).join('')}</ol></div>`;
  modal(`<h3>Install AZHARS</h3><p class="muted" style="margin-bottom:14px">It opens like a normal app from your home screen or desktop, with no app store needed.</p>
    ${row(ios, 'iPhone or iPad', ['Open this page in <b>Safari</b>.', 'Tap the <b>Share</b> button (a square with an arrow).', 'Scroll and tap <b>Add to Home Screen</b>, then <b>Add</b>.'])}
    ${row(android, 'Android phone', ['Open this page in <b>Chrome</b>.', 'Tap the <b>three dots</b> menu at the top right.', 'Tap <b>Install app</b> (or <b>Add to Home screen</b>).'])}
    ${row(!ios && !android, 'Laptop or desktop', ['Open this page in <b>Chrome</b> or <b>Edge</b>.', 'Click the <b>install icon</b> at the right end of the address bar (or menu, then <b>Install AZHARS</b>).', 'On a Mac with Safari: <b>File</b>, then <b>Add to Dock</b>.'])}
    <div class="actions"><button class="btn btn-primary" data-act="close-modal">Got it</button></div>`);
};

// ---------- chrome (nav + footer) ----------
function renderChrome() {
  const st = S.settings;
  $('#announce').textContent = st.announcement || '';
  $('#announce').hidden = !st.announcement;
  $('#logo').textContent = (st.store_name || 'AZHARS').toUpperCase();
  const cur = location.hash.slice(1) || '/';
  const link = (href, label, cls = '') => `<a href="#${href}" class="${cls} ${cur === href || (href !== '/' && cur.startsWith(href + '/')) ? 'on' : ''}">${esc(label)}</a>`;
  $('#navlinks').innerHTML = link('/shop', 'Shop all') + S.categories.slice(0, 4).map(c => link('/shop/' + c.slug, c.name)).join('')
    + (S.sales.length ? link('/shop?sale=1', 'Sale', 'sale-link') : '')
    + (S.user && S.user.role === 'admin' ? link('/admin', 'Admin') : '');
  $('#acct-btn').setAttribute('href', S.user ? '#/account' : '#/login');
  cart.badge();
  $('#footer').innerHTML = `<div class="container"><div class="foot">
    <div><div class="logo" style="font-size:1.15rem">${esc((st.store_name || 'AZHARS').toUpperCase())}</div><p style="margin-top:12px;max-width:30ch">${esc(st.tagline || '')}</p></div>
    <div><h4>Shop</h4>${S.categories.slice(0, 5).map(c => `<a href="#/shop/${esc(c.slug)}">${esc(c.name)}</a>`).join('')}</div>
    <div><h4>Account</h4><a href="#/account">My orders</a><a href="#/cart">Shopping bag</a><a href="#/login">Log in</a>${isStandalone() ? '' : '<button class="foot-link" data-act="install">Install the app</button>'}</div>
    <div><h4>Contact</h4><p>${esc(st.contact_email)}</p><p>${esc(st.contact_phone)}</p><p>${esc(st.address)}</p></div>
  </div><div class="foot-bottom">&copy; ${new Date().getFullYear()} ${esc(st.store_name || 'AZHARS')}. All rights reserved.</div></div>`;
}
AZ.renderChrome = renderChrome;

// ---------- product card + price ----------
function priceHTML(p) {
  const from = p.has_range ? '<small class="muted" style="font-weight:400">From </small>' : '';
  return p.on_sale
    ? `<div class="price">${from}<span class="now sale">${fmt(p.sale_price)}</span><s>${fmt(p.price)}</s></div>`
    : `<div class="price">${from}<span class="now">${fmt(p.price)}</span></div>`;
}
function cardHTML(p) {
  const badge = !p.in_stock ? '<span class="pill-badge out">Sold out</span>' : p.on_sale ? `<span class="pill-badge">${p.percent_off}% off</span>` : '';
  return `<a class="card" href="#/product/${esc(p.slug)}"><div class="card-img">${badge}
    <img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">${p.image2 ? `<img class="alt" src="${esc(p.image2)}" alt="" loading="lazy">` : ''}</div>
    <div class="card-body"><div class="card-cat">${esc(p.category_name || '')}</div><h3>${esc(p.name)}</h3>${priceHTML(p)}</div></a>`;
}
AZ.cardHTML = cardHTML;
const gridHTML = list => `<div class="grid">${list.map(cardHTML).join('')}</div>`;

// ---------- HOME ----------
AZ.routes.push([/^\/?$/, async () => {
  const wantSale = S.sales.length > 0;
  const [feat, fresh, onSale] = await Promise.all([
    api('/api/products?featured=1&limit=8&sort=newest'),
    api('/api/products?sort=newest&limit=8'),
    wantSale ? api('/api/products?sale=1&limit=4') : Promise.resolve({ products: [] })
  ]);
  const hero = feat.products[0] || fresh.products[0];
  const cats = S.categories.slice(0, 5);
  const bento = cats.length >= 5 ? 'bento' : 'bento plain';
  const tiles = cats.map((c, i) => {
    const col = ['B9A6E6', '8FA88A', '6B4630', '2D3A5C', 'B98A5E'][i % 5];
    const img = c.image || `/img/ph/${KIND[c.slug] || 'oxford'}.svg?c=${col}&bg=${i % 2 ? 'sage' : 'lav'}`;
    return `<a class="tile ${i === 0 && cats.length >= 5 ? 'big' : ''}" href="#/shop/${esc(c.slug)}"><img src="${esc(img)}" alt="" loading="lazy"><div class="tile-in"><h3>${esc(c.name)}</h3><p>${c.product_count} ${c.product_count === 1 ? 'style' : 'styles'}</p></div></a>`;
  }).join('');
  const sale = S.sales[0];
  const free = S.settings.free_shipping_over;
  const arrivals = fresh.products.slice(0, 8);
  return `
  <div class="container">
    <section class="stage">
      <div>
        <h1>Leather shoes, made for <span style="white-space:nowrap">all-day</span> wear.</h1>
        <p class="lede">Formal, casual and everything in between. Plus boots, chappals, wallets, belts and bags.</p>
        <div class="cta"><a class="btn btn-primary btn-lg" href="#/shop?sort=newest">Shop new arrivals</a>${sale ? '<a class="btn btn-lav btn-lg" href="#/shop?sale=1">See the sale</a>' : '<a class="btn btn-lav btn-lg" href="#/shop">Browse all</a>'}</div>
      </div>
      <div class="stage-art"><div class="hero-disc"></div>
        <img class="stage-shoe" src="/img/ph/oxford.svg?c=6B4630&bg=none" alt="Brown leather oxford shoe">
        ${hero ? `<a class="chip-float" href="#/product/${esc(hero.slug)}"><img src="${esc(hero.image)}" alt=""><div><b>${esc(hero.name)}</b><span>${fmt(hero.sale_price)}</span></div></a>` : ''}
      </div>
    </section>
    <div class="trust">
      <div>${ICON.truck}<p><b>Free delivery over ${fmt(free)}</b><span>Across Pakistan</span></p></div>
      <div>${ICON.cash}<p><b>Cash on delivery</b><span>Pay when it arrives</span></p></div>
      <div>${ICON.phone}<p><b>JazzCash, Easypaisa, bank</b><span>Pay the way you prefer</span></p></div>
    </div>

    ${cats.length ? `<section class="section"><div class="section-head"><div><h2>Shop by category</h2></div><a class="link" href="#/shop">View everything</a></div><div class="${bento}">${tiles}</div></section>` : ''}

    ${sale ? `<section class="section"><div class="saleband"><div><h2>${esc(sale.banner_text)}</h2><p>${sale.ends_at ? 'Ends ' + fdate(sale.ends_at) + '. ' : ''}Prices update automatically in your bag.</p></div><a class="btn btn-primary btn-lg" href="#/shop?sale=1">Shop the sale</a></div>
      ${onSale.products.length ? `<div style="margin-top:34px">${gridHTML(onSale.products)}</div>` : ''}</section>` : ''}

    ${arrivals.length ? `<section class="section"><div class="section-head"><div><h2>New arrivals</h2><p>The latest additions to the store.</p></div><a class="link" href="#/shop?sort=newest">Shop all</a></div>${gridHTML(arrivals)}</section>` : ''}

    <section class="section"><div class="split">
      <div class="panel"><h2>Leather that softens with wear.</h2><p>Every pair and every accessory here is chosen to be worn hard and look better for it.</p>
        <ul class="facts"><li>${ICON.check}<span>Full-grain and nappa leathers</span></li><li>${ICON.check}<span>Sizes 39 to 45 in most styles</span></li><li>${ICON.check}<span>Order online, pay on delivery or by transfer</span></li></ul>
        <a class="btn btn-primary" href="#/shop">Explore the collection</a></div>
      <div class="panel art"><img src="/img/ph/wallet.svg?c=8FA88A&bg=sage" alt="Sage green leather wallet"></div>
    </div></section>

    <section class="section"><div class="news"><h2>Get first look at new drops</h2><p>Sale dates and new arrivals, straight to your inbox. No spam.</p>
      <form data-form="subscribe"><input type="email" name="email" placeholder="you@example.com" aria-label="Email address" required><button class="btn" type="submit">Subscribe</button></form></div></section>
  </div>`;
}]);

// ---------- SHOP ----------
AZ.routes.push([/^\/shop(?:\/([\w-]+))?$/, async (m, q) => {
  const cat = m[1] || '';
  const params = new URLSearchParams();
  if (cat) params.set('category', cat);
  ['q', 'sort', 'size', 'color', 'sale', 'page'].forEach(k => q.get(k) && params.set(k, q.get(k)));
  params.set('limit', '12');
  const data = await api('/api/products?' + params);
  const c = S.categories.find(x => x.slug === cat);
  const title = q.get('q') ? `Results for "${q.get('q')}"` : q.get('sale') ? 'Sale' : c ? c.name : 'Shop all';
  const sub = q.get('sale') ? 'Everything currently on offer.' : c ? c.description : 'Shoes, boots, chappals and leather accessories.';
  const base = cat ? '/shop/' + cat : '/shop';
  const keep = extra => { const p = new URLSearchParams(); ['q', 'sort', 'size', 'color', 'sale'].forEach(k => q.get(k) && p.set(k, q.get(k))); Object.entries(extra || {}).forEach(([k, v]) => v ? p.set(k, v) : p.delete(k)); const s = p.toString(); return '#' + base + (s ? '?' + s : ''); };
  const opt = (v, cur, label) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label || v)}</option>`;
  const pages = Array.from({ length: data.pages }, (_, i) => i + 1);
  return `<div class="container">
    <div class="page-head"><h1>${esc(title)}</h1><p>${esc(sub || '')}</p></div>
    <div class="cat-pills"><a class="pill ${!cat && !q.get('sale') ? 'on' : ''}" href="#/shop">All</a>${S.categories.map(x => `<a class="pill ${x.slug === cat ? 'on' : ''}" href="#/shop/${esc(x.slug)}">${esc(x.name)}</a>`).join('')}${S.sales.length ? `<a class="pill ${q.get('sale') ? 'on' : ''}" href="#/shop?sale=1">On sale</a>` : ''}</div>
    <div class="filters" data-base="${esc(base)}" data-q="${esc(q.get('q') || '')}" data-sale="${esc(q.get('sale') || '')}">
      <select data-change="filter" name="sort" aria-label="Sort">${opt('', q.get('sort') || '', 'Featured')}${opt('newest', q.get('sort'), 'Newest')}${opt('price-asc', q.get('sort'), 'Price: low to high')}${opt('price-desc', q.get('sort'), 'Price: high to low')}${opt('name', q.get('sort'), 'Name A-Z')}</select>
      ${data.facets.sizes.length ? `<select data-change="filter" name="size" aria-label="Size">${opt('', q.get('size') || '', 'Any size')}${data.facets.sizes.map(s => opt(s, q.get('size'), 'Size ' + s)).join('')}</select>` : ''}
      ${data.facets.colors.length ? `<select data-change="filter" name="color" aria-label="Colour">${opt('', q.get('color') || '', 'Any colour')}${data.facets.colors.map(s => opt(s, q.get('color'))).join('')}</select>` : ''}
      <span class="count">${data.total} ${data.total === 1 ? 'product' : 'products'}</span>
    </div>
    ${data.products.length ? gridHTML(data.products) : `<div class="empty"><h3>Nothing matches yet</h3><p>Try removing a filter or searching for something else.</p><p style="margin-top:18px"><a class="btn btn-lav" href="#/shop">Clear filters</a></p></div>`}
    ${data.pages > 1 ? `<div class="pager">${pages.map(n => `<a class="pill ${n === data.page ? 'on' : ''}" href="${keep({ page: n > 1 ? n : '' })}">${n}</a>`).join('')}</div>` : ''}
  </div>`;
}]);
AZ.changes.filter = el => {
  const box = el.closest('.filters'), p = new URLSearchParams();
  $$('select', box).forEach(s => s.value && p.set(s.name, s.value));
  if (box.dataset.q) p.set('q', box.dataset.q);
  if (box.dataset.sale) p.set('sale', box.dataset.sale);
  const s = p.toString();
  go(box.dataset.base + (s ? '?' + s : ''));
};

// ---------- PRODUCT ----------
AZ.routes.push([/^\/product\/([\w-]+)$/, async m => {
  const { product: p, related } = await api('/api/products/' + m[1]);
  document.title = p.name + ' - ' + (S.settings.store_name || 'AZHARS');
  const sel = { color: p.colors.find(c => p.variants.some(v => v.color === c && v.stock > 0)) || p.colors[0] || '', size: '', qty: 1, img: 0 };
  if (p.sizes.length === 1 && p.variants.some(v => v.size === p.sizes[0] && v.stock > 0)) sel.size = p.sizes[0];
  const find = () => p.variants.find(v => (v.color || '') === sel.color && (v.size || '') === sel.size);
  const html = `<div class="container"><div class="crumbs"><a href="#/">Home</a> / <a href="#/shop">Shop</a>${p.category_slug ? ` / <a href="#/shop/${esc(p.category_slug)}">${esc(p.category_name)}</a>` : ''}</div>
    <div class="pdp"><div class="gallery" id="gallery"></div>
    <div><h1>${esc(p.name)}</h1><div id="pdp-price"></div><p class="desc">${esc(p.description)}</p><div id="pdp-opts"></div>
      <div class="details"><details open><summary>Details</summary><p>${p.material ? 'Material: ' + esc(p.material) + '.<br>' : ''}${p.brand ? 'Brand: ' + esc(p.brand) + '.<br>' : ''}${p.variants[0] && p.variants[0].sku ? 'Style code: ' + esc(p.variants[0].sku.split('-').slice(0, 2).join('-')) : ''}</p></details>
      <details><summary>Delivery and payment</summary><p>Delivery is ${fmt(S.settings.shipping_fee)}, and free on orders over ${fmt(S.settings.free_shipping_over)}. Pay by cash on delivery, bank transfer, JazzCash or Easypaisa.</p></details></div></div></div>
    ${related.length ? `<section class="section"><div class="section-head"><h2>You may also like</h2></div>${gridHTML(related)}</section>` : ''}</div>`;
  const mount = root => {
    const paint = () => {
      const v = find();
      const imgs = p.images.length ? p.images : [p.image];
      $('#gallery', root).innerHTML = `<div class="thumbs">${imgs.length > 1 ? imgs.map((u, i) => `<button class="${i === sel.img ? 'on' : ''}" data-act="pdp-img" data-i="${i}" aria-label="Photo ${i + 1}"><img src="${esc(u)}" alt=""></button>`).join('') : ''}</div><div class="main-img"><img src="${esc(imgs[sel.img] || imgs[0])}" alt="${esc(p.name)}"></div>`;
      const shown = v || { price: p.price, sale_price: p.sale_price };
      const on = shown.sale_price < shown.price;
      $('#pdp-price', root).innerHTML = `<div class="price">${!v && p.has_range ? '<small class="muted" style="font-weight:400">From </small>' : ''}<span class="now ${on ? 'sale' : ''}">${fmt(shown.sale_price)}</span>${on ? `<s>${fmt(shown.price)}</s><span class="save-tag">Save ${Math.round((1 - shown.sale_price / shown.price) * 100)}%</span>` : ''}</div>`;
      const colorOk = c => p.variants.some(x => x.color === c && x.stock > 0 && (!sel.size || x.size === sel.size));
      const sizeOk = s => p.variants.some(x => x.size === s && x.stock > 0 && (!sel.color || x.color === sel.color));
      let o = '';
      if (p.colors.length) o += `<div class="opt"><div class="opt-h"><b>Colour</b><span>${esc(sel.color)}</span></div><div class="swatches">${p.colors.map(c => COLORS[c]
        ? `<button class="swatch ${c === sel.color ? 'on' : ''} ${colorOk(c) ? '' : 'na'}" style="background:${COLORS[c]}" data-act="pdp-color" data-v="${esc(c)}" title="${esc(c)}" aria-label="${esc(c)}"></button>`
        : `<button class="size ${c === sel.color ? 'on' : ''} ${colorOk(c) ? '' : 'na'}" data-act="pdp-color" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div></div>`;
      if (p.sizes.length) o += `<div class="opt"><div class="opt-h"><b>Size</b><span>${sel.size ? esc(sel.size) : 'Choose a size'}</span></div><div class="sizes">${p.sizes.map(s => `<button class="size ${s === sel.size ? 'on' : ''} ${sizeOk(s) ? '' : 'na'}" data-act="pdp-size" data-v="${esc(s)}" ${sizeOk(s) ? '' : 'disabled aria-label="Size ' + esc(s) + ', out of stock"'}>${esc(s)}</button>`).join('')}</div></div>`;
      const max = v ? v.stock : 0;
      const need = p.sizes.length && !sel.size;
      const label = !p.in_stock ? 'Sold out' : need ? 'Choose a size' : v && v.stock <= 0 ? 'Out of stock' : 'Add to bag';
      o += `<div class="buy"><div class="qty"><button data-act="pdp-qty" data-d="-1" aria-label="Fewer">&minus;</button><span>${sel.qty}</span><button data-act="pdp-qty" data-d="1" aria-label="More">+</button></div><button class="btn btn-primary btn-lg" data-act="pdp-add" ${!p.in_stock || (v && v.stock <= 0) ? 'disabled' : ''}>${label}</button></div>
        <div class="stock-note ${v && v.stock > 0 && v.stock <= 3 ? 'low' : ''}">${v && v.stock > 0 && v.stock <= 3 ? `Only ${max} left` : v && v.stock > 0 ? 'In stock' : ''}</div>`;
      $('#pdp-opts', root).innerHTML = o;
    };
    AZ.pdp = {
      color: c => { sel.color = c; if (sel.size && !p.variants.some(x => x.color === c && x.size === sel.size && x.stock > 0)) sel.size = ''; sel.qty = 1; paint(); },
      size: s => { sel.size = s; sel.qty = 1; paint(); },
      img: i => { sel.img = i; paint(); },
      qty: d => { const v = find(); const max = v ? v.stock : 10; sel.qty = Math.min(Math.max(1, sel.qty + d), Math.max(1, max)); paint(); },
      add: () => {
        const v = find();
        if (p.sizes.length && !sel.size) return toast('Please choose a size first.', { err: true });
        if (!v || v.stock <= 0) return toast('That option is out of stock.', { err: true });
        const inBag = (cart.items.find(i => i.v === v.id) || { q: 0 }).q;
        if (inBag + sel.qty > v.stock) return toast(`Only ${v.stock} available${inBag ? ' (you already have ' + inBag + ' in your bag)' : ''}.`, { err: true });
        cart.add(v.id, sel.qty);
        toast('Added to your bag', { link: '#/cart', linkText: 'View bag' });
      }
    };
    paint();
  };
  return { html, mount };
}]);
Object.assign(AZ.actions, {
  'pdp-color': el => AZ.pdp.color(el.dataset.v), 'pdp-size': el => AZ.pdp.size(el.dataset.v),
  'pdp-img': el => AZ.pdp.img(+el.dataset.i), 'pdp-qty': el => AZ.pdp.qty(+el.dataset.d), 'pdp-add': () => AZ.pdp.add()
});

// ---------- CART ----------
async function priced(coupon) {
  const r = await api('/api/cart/price', { method: 'POST', body: { items: cart.payload(), coupon } });
  let changed = false;
  r.issues.forEach(i => { if (i.remove) { cart.remove(i.variant_id); changed = true; } else if (i.qty) { cart.set(i.variant_id, i.qty); changed = true; } });
  if (changed) cart.save();
  return r;
}
function summaryHTML(r, opts = {}) {
  const left = Math.max(0, r.free_shipping_over - (r.subtotal - r.coupon_discount));
  return `<div class="summary"><h3>Order summary</h3>
    ${r.lines.length && !opts.noProgress ? `<div class="small muted">${left > 0 ? `Add <b>${fmt(left)}</b> more for free delivery` : 'You have free delivery'}</div><div class="progress"><i style="width:${Math.min(100, Math.round((r.subtotal - r.coupon_discount) / r.free_shipping_over * 100))}%"></i></div>` : ''}
    <div class="sum-row"><span>Subtotal</span><span>${fmt(r.subtotal)}</span></div>
    ${r.sale_savings > 0 ? `<div class="sum-row disc"><span>Sale savings (included)</span><span>${fmt(r.sale_savings)}</span></div>` : ''}
    ${r.coupon_discount > 0 ? `<div class="sum-row disc"><span>Code ${esc(r.coupon_code)}</span><span>&minus;${fmt(r.coupon_discount)}</span></div>` : ''}
    <div class="sum-row"><span>Delivery</span><span>${r.shipping ? fmt(r.shipping) : 'Free'}</span></div>
    <div class="sum-row total"><span>Total</span><span>${fmt(r.total)}</span></div>${opts.extra || ''}</div>`;
}
let couponCode = '';
AZ.routes.push([/^\/cart$/, async () => {
  if (!cart.items.length) return `<div class="container"><div class="empty" style="padding:120px 0"><h3>Your bag is empty</h3><p>Find something you like and it will show up here.</p><p style="margin-top:20px"><a class="btn btn-primary" href="#/shop">Start shopping</a></p></div></div>`;
  const r = await priced(couponCode);
  if (!r.lines.length) return `<div class="container"><div class="empty" style="padding:120px 0"><h3>Your bag is empty</h3><p>The items in your bag are no longer available.</p><p style="margin-top:20px"><a class="btn btn-primary" href="#/shop">Continue shopping</a></p></div></div>`;
  if (r.coupon_error) couponCode = '';
  const extra = `<form class="coupon" data-form="coupon"><input class="input" name="code" placeholder="Discount code" value="${esc(r.coupon_code)}" aria-label="Discount code"><button class="btn btn-lav btn-sm" type="submit">Apply</button></form>
    ${r.coupon_error ? `<div class="small" style="color:var(--danger);margin-bottom:8px">${esc(r.coupon_error)}</div>` : ''}
    <a class="btn btn-primary btn-lg btn-block" href="#/checkout" style="margin-top:14px">Checkout</a>`;
  return `<div class="container"><div class="page-head"><h1>Your bag</h1></div><div class="two"><div>
    ${r.issues.filter(i => !i.remove).map(i => `<div class="note warn">${esc(i.message)}</div>`).join('')}
    ${r.lines.map(l => `<div class="line"><a href="#/product/${esc(l.slug)}"><img src="${esc(l.image)}" alt=""></a>
      <div><h3><a href="#/product/${esc(l.slug)}">${esc(l.name)}</a></h3><div class="meta">${esc(l.label)}</div>
        <div class="qty"><button data-act="cart-qty" data-v="${l.variant_id}" data-d="-1" aria-label="Fewer">&minus;</button><span>${l.qty}</span><button data-act="cart-qty" data-v="${l.variant_id}" data-d="1" aria-label="More">+</button></div>
        <div style="margin-top:8px"><button class="link small" data-act="cart-remove" data-v="${l.variant_id}">Remove</button></div></div>
      <div class="tot">${l.original_price > l.unit_price ? `<s>${fmt(l.original_price * l.qty)}</s>` : ''}${fmt(l.line_total)}</div></div>`).join('')}
    </div>${summaryHTML(r, { extra })}</div></div>`;
}]);
Object.assign(AZ.actions, {
  'cart-qty': async el => { const v = +el.dataset.v, it = cart.items.find(i => i.v === v); if (!it) return; const nq = it.q + (+el.dataset.d); if (nq < 1) return; cart.set(v, nq); await AZ.route(); },
  'cart-remove': async el => { cart.remove(+el.dataset.v); await AZ.route(); }
});
AZ.forms.coupon = async form => {
  couponCode = new FormData(form).get('code').trim();
  await AZ.route();
};

// ---------- CHECKOUT ----------
AZ.routes.push([/^\/checkout$/, async () => {
  if (!cart.items.length) return go('/cart');
  const r = await priced(couponCode);
  if (!r.lines.length) return go('/cart');
  const u = S.user || {}, methods = S.settings.payment_methods;
  const lines = `<div style="margin:0 0 16px">${r.lines.map(l => `<div class="sum-row" style="gap:12px"><span>${esc(l.name)} <span class="muted">&times; ${l.qty}</span></span><span>${fmt(l.line_total)}</span></div>`).join('')}</div>`;
  return `<div class="container"><div class="page-head"><h1>Checkout</h1>${!S.user ? '<p>Have an account? <a class="link" href="#/login?next=/checkout">Log in</a> to fill this in faster. Or continue as a guest.</p>' : ''}</div>
  <form class="two" data-form="checkout"><div>
    <div class="box"><h3>Contact and delivery</h3><div class="form">
      <div class="row"><div class="field"><label for="c-name">Full name</label><input class="input" id="c-name" name="name" value="${esc(u.name || '')}" required autocomplete="name"></div>
      <div class="field"><label for="c-phone">Phone</label><input class="input" id="c-phone" name="phone" value="${esc(u.phone || '')}" required autocomplete="tel" placeholder="03xx xxxxxxx"></div></div>
      <div class="field"><label for="c-email">Email</label><input class="input" id="c-email" type="email" name="email" value="${esc(u.email || '')}" required autocomplete="email"></div>
      <div class="field"><label for="c-addr">Delivery address</label><input class="input" id="c-addr" name="address" required autocomplete="street-address" placeholder="House, street, area"></div>
      <div class="row"><div class="field"><label for="c-city">City</label><input class="input" id="c-city" name="city" required autocomplete="address-level2"></div>
      <div class="field"><label for="c-prov">Province</label><select id="c-prov" name="province"><option value="">Select</option>${['Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan', 'Islamabad Capital Territory', 'Azad Kashmir', 'Gilgit-Baltistan'].map(x => `<option>${x}</option>`).join('')}</select></div></div>
      <div class="field"><label for="c-notes">Order notes (optional)</label><textarea class="input" id="c-notes" name="notes" rows="2" placeholder="Landmark, preferred delivery time..."></textarea></div>
    </div></div>
    <div class="box"><h3>Payment</h3>${methods.map((m, i) => `<label class="pay-opt ${i === 0 ? 'on' : ''}"><input type="radio" name="payment_method" value="${esc(m.id)}" ${i === 0 ? 'checked' : ''} data-change="pay-pick"><div><b>${esc(m.label)}</b><span>${esc(m.instructions)}</span></div></label>`).join('')}</div>
  </div>
  <div>${summaryHTML(r, { noProgress: true, extra: `<div id="co-err"></div><button class="btn btn-primary btn-lg btn-block" type="submit" style="margin-top:16px">Place order</button><p class="small muted" style="margin-top:12px;text-align:center">${couponCode && r.coupon_code ? 'Code ' + esc(r.coupon_code) + ' applied.' : ''}</p>` }).replace('<h3>Order summary</h3>', '<h3>Order summary</h3>' + lines)}</div></form></div>`;
}]);
AZ.changes['pay-pick'] = el => $$('.pay-opt').forEach(o => o.classList.toggle('on', $('input', o).checked));
AZ.forms.checkout = async (form, ev) => {
  const btn = $('button[type=submit]', form), err = $('#co-err');
  err.innerHTML = ''; btn.disabled = true; btn.textContent = 'Placing order...';
  const fd = Object.fromEntries(new FormData(form));
  try {
    const { order, token } = await api('/api/orders', { method: 'POST', body: { ...fd, items: cart.payload(), coupon: couponCode } });
    cart.clear(); couponCode = '';
    go(order.payment_method === 'card_demo' ? `/pay/${order.id}?t=${token}` : `/order/${order.id}?t=${token}`);
  } catch (e) {
    err.innerHTML = `<div class="note err">${esc(e.message)}</div>`;
    btn.disabled = false; btn.textContent = 'Place order';
  }
};

// ---------- ORDER + demo gateway ----------
const STATUS = { pending: ['Order received', ''], confirmed: ['Confirmed', 'good'], shipped: ['On its way', 'good'], delivered: ['Delivered', 'good'], cancelled: ['Cancelled', 'bad'] };
const PAY = { unpaid: ['Pay on delivery', 'warn'], awaiting: ['Awaiting payment', 'warn'], paid: ['Paid', 'good'], failed: ['Payment failed', 'bad'], refunded: ['Refunded', ''] };
AZ.STATUS = STATUS; AZ.PAY = PAY;
AZ.routes.push([/^\/order\/(\d+)$/, async (m, q) => {
  const { order: o } = await api(`/api/orders/${m[1]}?t=${encodeURIComponent(q.get('t') || '')}`);
  const t = q.get('t') || '';
  const manual = ['bank', 'jazzcash', 'easypaisa'].includes(o.payment_method) && o.payment_status !== 'paid';
  const st = STATUS[o.status] || [o.status, ''], ps = PAY[o.payment_status] || [o.payment_status, ''];
  return `<div class="container" style="max-width:820px"><div class="page-head"><h1>${o.status === 'cancelled' ? 'Order cancelled' : 'Thank you, ' + esc(o.name.split(' ')[0])}</h1><p>Order <b>${esc(o.order_no)}</b> &middot; placed ${fdate(o.created_at)}. ${S.user ? 'You can find it any time under My orders.' : 'Bookmark this page to check on your order later.'}</p></div>
    <div style="display:flex;gap:8px;margin-bottom:22px;flex-wrap:wrap"><span class="status ${st[1]}">${st[0]}</span><span class="status ${ps[1]}">${ps[0]}</span>${o.tracking ? `<span class="status">Tracking: ${esc(o.tracking)}</span>` : ''}</div>
    ${o.payment_status === 'failed' && o.payment_method === 'card_demo' ? `<div class="note err">The test payment failed. <a class="link" href="#/pay/${o.id}?t=${esc(t)}">Try again</a></div>` : ''}
    ${o.payment_status === 'awaiting' && o.payment_method === 'card_demo' ? `<div class="note warn">Payment pending. <a class="link" href="#/pay/${o.id}?t=${esc(t)}">Complete payment</a></div>` : ''}
    ${manual ? `<div class="box" style="margin-bottom:20px"><h3>Complete your payment (${esc(o.payment_label)})</h3><p class="muted">${esc(o.payment_instructions)}</p>
      <form class="coupon" data-form="payref" data-id="${o.id}" data-t="${esc(t)}" style="margin-top:16px"><input class="input" name="reference" placeholder="Transaction ID" value="${esc(o.payment_ref || '')}" aria-label="Transaction ID" required><button class="btn btn-primary btn-sm" type="submit">Save</button></form>
      <p class="small muted">Amount to send: <b>${fmt(o.total)}</b>. We confirm your order once the payment is verified.</p></div>` : ''}
    ${o.payment_method === 'cod' ? `<div class="note info">Please keep <b>${fmt(o.total)}</b> ready for the courier.</div>` : ''}
    <div class="box"><h3>Items</h3>${o.items.map(i => `<div class="line" style="grid-template-columns:72px 1fr auto;padding:14px 0"><img src="${esc(i.image)}" alt="" style="width:72px"><div><b>${esc(i.name)}</b><div class="meta">${esc(i.variant_label)} &middot; Qty ${i.qty}</div></div><div class="tot">${fmt(i.unit_price * i.qty)}</div></div>`).join('')}
      <div class="sum-row" style="margin-top:10px"><span>Subtotal</span><span>${fmt(o.subtotal)}</span></div>
      ${o.coupon_discount ? `<div class="sum-row disc"><span>Code ${esc(o.coupon_code)}</span><span>&minus;${fmt(o.coupon_discount)}</span></div>` : ''}
      <div class="sum-row"><span>Delivery</span><span>${o.shipping ? fmt(o.shipping) : 'Free'}</span></div><div class="sum-row total"><span>Total</span><span>${fmt(o.total)}</span></div></div>
    <div class="box"><h3>Delivering to</h3><p>${esc(o.name)}<br>${esc(o.address)}<br>${esc(o.city)}${o.province ? ', ' + esc(o.province) : ''}<br>${esc(o.phone)}</p></div>
    <p style="margin-top:26px"><a class="btn btn-lav" href="#/shop">Continue shopping</a></p></div>`;
}]);
AZ.forms.payref = async form => {
  try { await api(`/api/orders/${form.dataset.id}/reference`, { method: 'POST', body: { reference: new FormData(form).get('reference'), t: form.dataset.t } }); toast('Transaction ID saved. Thank you.'); }
  catch (e) { toast(e.message, { err: true }); }
};
AZ.routes.push([/^\/pay\/(\d+)$/, async (m, q) => {
  const { order: o } = await api(`/api/orders/${m[1]}?t=${encodeURIComponent(q.get('t') || '')}`);
  if (o.payment_status === 'paid') return go(`/order/${o.id}?t=${q.get('t')}`);
  return `<div class="container"><div class="gateway box"><span class="status warn">Test mode</span><h2 style="margin-top:14px;font-size:1.5rem">Test payment gateway</h2>
    <div class="amount">${fmt(o.total)}</div><p class="muted" style="margin-bottom:24px">Order ${esc(o.order_no)}. This screen simulates a card gateway so you can test the flow. No real money moves.</p>
    <div style="display:grid;gap:10px"><button class="btn btn-primary btn-lg" data-act="demo-pay" data-id="${o.id}" data-t="${esc(q.get('t') || '')}" data-ok="1">Approve test payment</button><button class="btn btn-ghost" data-act="demo-pay" data-id="${o.id}" data-t="${esc(q.get('t') || '')}" data-ok="0">Simulate a declined payment</button></div></div></div>`;
}]);
AZ.actions['demo-pay'] = async el => {
  try { await api(`/api/orders/${el.dataset.id}/demo-pay`, { method: 'POST', body: { approve: el.dataset.ok === '1', t: el.dataset.t } }); go(`/order/${el.dataset.id}?t=${el.dataset.t}`); }
  catch (e) { toast(e.message, { err: true }); }
};

// ---------- AUTH + ACCOUNT ----------
const authPage = (mode, next) => {
  const reg = mode === 'register';
  return `<div class="container"><div class="auth"><h1>${reg ? 'Create your account' : 'Welcome back'}</h1><p class="sub">${reg ? 'Track orders and check out faster.' : 'Log in to see your orders.'}</p>
    <form class="box form" data-form="${reg ? 'register' : 'login'}" data-next="${esc(next)}">
      <div id="auth-err"></div>
      ${reg ? '<div class="field"><label for="a-name">Full name</label><input class="input" id="a-name" name="name" required autocomplete="name"></div>' : ''}
      <div class="field"><label for="a-email">Email</label><input class="input" id="a-email" type="email" name="email" required autocomplete="email"></div>
      ${reg ? '<div class="field"><label for="a-phone">Phone (optional)</label><input class="input" id="a-phone" name="phone" autocomplete="tel"></div>' : ''}
      <div class="field"><label for="a-pass">Password</label><input class="input" id="a-pass" type="password" name="password" required minlength="${reg ? 8 : 1}" autocomplete="${reg ? 'new-password' : 'current-password'}">${reg ? '<div class="hint">At least 8 characters.</div>' : ''}</div>
      <button class="btn btn-primary btn-lg btn-block" type="submit">${reg ? 'Create account' : 'Log in'}</button>
      <p class="small muted" style="text-align:center">${reg ? 'Already have an account? <a class="link" href="#/login">Log in</a>' : 'New here? <a class="link" href="#/register">Create an account</a>'}</p></form></div></div>`;
};
AZ.routes.push([/^\/login$/, (m, q) => S.user ? go('/account') : authPage('login', q.get('next') || '/account')]);
AZ.routes.push([/^\/register$/, (m, q) => S.user ? go('/account') : authPage('register', q.get('next') || '/account')]);
const authSubmit = kind => async form => {
  const btn = $('button[type=submit]', form); btn.disabled = true;
  try {
    const { user } = await api('/api/auth/' + kind, { method: 'POST', body: Object.fromEntries(new FormData(form)) });
    S.user = user; renderChrome();
    toast(kind === 'login' ? 'Welcome back, ' + user.name.split(' ')[0] : 'Account created. Welcome!');
    go(form.dataset.next || '/account');
  } catch (e) { $('#auth-err', form).innerHTML = `<div class="note err">${esc(e.message)}</div>`; btn.disabled = false; }
};
AZ.forms.login = authSubmit('login'); AZ.forms.register = authSubmit('register');
AZ.actions.logout = async () => { await api('/api/auth/logout', { method: 'POST' }); S.user = null; renderChrome(); toast('Logged out'); go('/'); };

AZ.routes.push([/^\/account$/, async (m, q) => {
  if (!S.user) return go('/login?next=/account');
  const tab = q.get('tab') || 'orders';
  let body = '';
  if (tab === 'orders') {
    const { orders } = await api('/api/orders/mine');
    body = orders.length ? orders.map(o => { const st = STATUS[o.status] || [o.status, ''], ps = PAY[o.payment_status] || [o.payment_status, '']; return `<a class="order-card" style="display:block" href="#/order/${o.id}"><div class="order-top"><div><b>${esc(o.order_no)}</b> <span class="muted small">&middot; ${fdate(o.created_at)}</span></div><div><span class="status ${st[1]}">${st[0]}</span> <span class="status ${ps[1]}">${ps[0]}</span></div></div>
      <div class="order-items">${o.items.slice(0, 5).map(i => `<img src="${esc(i.image)}" alt="${esc(i.name)}">`).join('')}</div><div style="margin-top:12px;font-weight:600">${fmt(o.total)}</div></a>`; }).join('')
      : '<div class="empty"><h3>No orders yet</h3><p>When you place an order it will appear here.</p><p style="margin-top:18px"><a class="btn btn-primary" href="#/shop">Start shopping</a></p></div>';
  } else if (tab === 'profile') {
    body = `<form class="box form" data-form="profile" style="max-width:520px"><div class="field"><label>Email</label><input class="input" value="${esc(S.user.email)}" disabled></div>
      <div class="field"><label for="p-name">Full name</label><input class="input" id="p-name" name="name" value="${esc(S.user.name)}" required></div>
      <div class="field"><label for="p-phone">Phone</label><input class="input" id="p-phone" name="phone" value="${esc(S.user.phone)}"></div><button class="btn btn-primary" type="submit">Save changes</button></form>`;
  } else {
    body = `<form class="box form" data-form="password" style="max-width:520px"><div id="pw-err"></div><div class="field"><label for="w-cur">Current password</label><input class="input" id="w-cur" type="password" name="current" required autocomplete="current-password"></div>
      <div class="field"><label for="w-new">New password</label><input class="input" id="w-new" type="password" name="next" required minlength="8" autocomplete="new-password"><div class="hint">At least 8 characters.</div></div><button class="btn btn-primary" type="submit">Update password</button></form>`;
  }
  return `<div class="container"><div class="page-head"><h1>Hi, ${esc(S.user.name.split(' ')[0])}</h1></div>
    <div class="tabs"><a class="pill ${tab === 'orders' ? 'on' : ''}" href="#/account">Orders</a><a class="pill ${tab === 'profile' ? 'on' : ''}" href="#/account?tab=profile">Profile</a><a class="pill ${tab === 'password' ? 'on' : ''}" href="#/account?tab=password">Password</a>
    ${S.user.role === 'admin' ? '<a class="pill" href="#/admin">Admin panel</a>' : ''}<button class="pill" data-act="logout">Log out</button></div>${body}</div>`;
}]);
AZ.forms.profile = async form => {
  try { const { user } = await api('/api/auth/profile', { method: 'PUT', body: Object.fromEntries(new FormData(form)) }); S.user = user; toast('Profile saved'); }
  catch (e) { toast(e.message, { err: true }); }
};
AZ.forms.password = async form => {
  try { await api('/api/auth/password', { method: 'PUT', body: Object.fromEntries(new FormData(form)) }); form.reset(); S.user.must_change = false; toast('Password updated'); }
  catch (e) { $('#pw-err').innerHTML = `<div class="note err">${esc(e.message)}</div>`; }
};

// ---------- misc forms + actions ----------
AZ.forms.search = form => { const q = $('input', form).value.trim(); $('#searchbar').classList.remove('open'); if (q) go('/shop?q=' + encodeURIComponent(q)); };
AZ.forms.subscribe = async form => {
  try { await api('/api/subscribe', { method: 'POST', body: { email: new FormData(form).get('email') } }); form.reset(); toast('You are on the list. Thank you!'); }
  catch (e) { toast(e.message, { err: true }); }
};
Object.assign(AZ.actions, {
  menu: () => $('#navlinks').classList.toggle('open'),
  search: () => { const b = $('#searchbar'); b.classList.toggle('open'); if (b.classList.contains('open')) $('#search-input').focus(); },
  'modal-bg': (el, ev) => { if (ev.target === el) closeModal(); },
  'cfm-no': () => AZ._cfm(false), 'cfm-yes': () => AZ._cfm(true), 'close-modal': closeModal, reload: () => location.reload()
});

// ---------- router ----------
let routeId = 0;
async function route() {
  const id = ++routeId;
  const h = location.hash.slice(1) || '/';
  const qi = h.indexOf('?'), p = qi < 0 ? h : h.slice(0, qi), q = new URLSearchParams(qi < 0 ? '' : h.slice(qi + 1));
  $('#navlinks').classList.remove('open');
  document.title = (S.settings.store_name || 'AZHARS') + ' - Leather shoes & accessories';
  const isAdmin = p.startsWith('/admin');
  document.body.classList.toggle('is-admin', isAdmin);
  for (const [re, fn] of AZ.routes) {
    const m = re.exec(p);
    if (!m) continue;
    try {
      const out = await fn(m, q);
      if (id !== routeId || out === undefined) return;
      if (typeof out === 'string') setApp(out); else { setApp(out.html); if (out.mount) out.mount($('#app')); }
    } catch (e) {
      if (id !== routeId) return;
      if (e.status === 401) return go('/login?next=' + encodeURIComponent(p));
      setApp(`<div class="container"><div class="empty" style="padding:120px 0"><h3>${e.status === 404 ? 'We could not find that' : 'Something went wrong'}</h3><p>${esc(e.message)}</p><p style="margin-top:20px"><a class="btn btn-primary" href="#/">Back to the shop</a></p></div></div>`);
    }
    renderChrome();
    return;
  }
  setApp('<div class="container"><div class="empty" style="padding:120px 0"><h3>Page not found</h3><p><a class="btn btn-primary" href="#/">Back to the shop</a></p></div></div>');
}
AZ.route = route;

// ---------- global event delegation (no inline handlers) ----------
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const fn = AZ.actions[el.dataset.act];
  if (fn) { if (el.tagName === 'A' && !el.getAttribute('href')) ev.preventDefault(); Promise.resolve(fn(el, ev)).catch(e => toast(e.message, { err: true })); }
});
document.addEventListener('change', ev => {
  const el = ev.target.closest('[data-change]');
  if (el && AZ.changes[el.dataset.change]) Promise.resolve(AZ.changes[el.dataset.change](el, ev)).catch(e => toast(e.message, { err: true }));
});
document.addEventListener('submit', ev => {
  const form = ev.target.closest('[data-form]');
  if (!form) return;
  const fn = AZ.forms[form.dataset.form];
  if (!fn) return;
  ev.preventDefault();
  Promise.resolve(fn(form, ev)).catch(e => toast(e.message, { err: true }));
});
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') { closeModal(); $('#searchbar').classList.remove('open'); } });
window.addEventListener('hashchange', route);
})();

(() => {
'use strict';
const AZ = window.AZ, S = AZ.state;
const { $, $$, esc, fmt, fdate, api, toast, modal, closeModal, confirmBox, go } = AZ;
const adm = AZ.adm = {};

const NAV = [['', 'Dashboard'], ['orders', 'Orders'], ['products', 'Products'], ['bulk', 'Bulk upload'], ['categories', 'Categories'], ['sales', 'Sales'], ['coupons', 'Coupons'], ['customers', 'Customers'], ['settings', 'Settings']];
const layout = (active, title, sub, body, bar = '') => `<div class="container"><div class="adm">
  <nav class="adm-side" aria-label="Admin">${NAV.map(([k, l]) => `<a href="#/admin${k ? '/' + k : ''}" class="${active === k ? 'on' : ''}">${l}</a>`).join('')}</nav>
  <div class="adm-main"><h1>${esc(title)}</h1><p class="sub">${esc(sub || '')}</p>${bar}${body}</div></div></div>`;
const statusPill = s => { const [l, c] = AZ.STATUS[s] || [s, '']; return `<span class="status ${c}">${l}</span>`; };
const payPill = s => { const [l, c] = AZ.PAY[s] || [s, '']; return `<span class="status ${c}">${l}</span>`; };
const val = (form, n) => form.elements[n] ? form.elements[n].value : '';
const chk = (form, n) => !!(form.elements[n] && form.elements[n].checked);
const toLocal = iso => { if (!iso) return ''; const d = new Date(iso), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const toISO = v => v ? new Date(v).toISOString() : null;
const fld = (label, name, v = '', extra = '', hint = '') => `<div class="field"><label for="f-${name}">${label}</label><input class="input" id="f-${name}" name="${name}" value="${esc(v)}" ${extra}>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;

AZ.routes.push([/^\/admin(?:\/([a-z]+))?(?:\/([\w-]+))?$/, async (m) => {
  if (!S.user) return go('/login?next=/admin');
  if (S.user.role !== 'admin') return `<div class="container"><div class="empty" style="padding:120px 0"><h3>Admin access only</h3><p>Log in with the store admin account to continue.</p><p style="margin-top:18px"><button class="btn btn-primary" data-act="logout">Log out</button></p></div></div>`;
  const page = adm[m[1] || 'dashboard'];
  if (typeof page !== 'function') return layout('', 'Not found', '', '<p>That admin page does not exist.</p>');
  return page(m[2]);
}]);

// ---------------- dashboard ----------------
adm.dashboard = async () => {
  const d = await api('/api/admin/stats');
  const max = Math.max(1, ...d.daily.map(x => x.t));
  const body = `${d.persistent ? '' : '<div class="note err"><b>Your data is not being saved permanently.</b> This store is online without a Volume, so every product, order and customer will be erased the next time it restarts or updates. Attach a Volume in Railway (see DEPLOY-GUIDE) before adding anything real.</div>'}${d.must_change ? '<div class="note warn">You are still using the default admin password. <a class="link" href="#/account?tab=password">Change it now</a> before you put the store online.</div>' : ''}
  <div class="stats"><div class="stat lav"><span>Sales, last 30 days</span><b>${fmt(d.revenue_30)}</b></div><div class="stat"><span>Orders</span><b>${d.orders}</b></div><div class="stat sage"><span>Waiting to be confirmed</span><b>${d.pending}</b></div><div class="stat"><span>Unpaid so far</span><b>${fmt(d.unpaid_total)}</b></div></div>
  <div class="two-col"><div class="box"><h3>Recent orders</h3>${d.recent.length ? `<table>${d.recent.map(o => `<tr><td><a class="link" href="#/admin/order/${o.id}">${o.order_no}</a></td><td>${esc(o.name)}</td><td>${statusPill(o.status)}</td><td class="r">${fmt(o.total)}</td></tr>`).join('')}</table>` : '<p class="muted">No orders yet. They will show up here.</p>'}</div>
  <div class="box"><h3>Running low</h3>${d.low_stock.length ? `<table>${d.low_stock.map(v => `<tr><td><a class="link" href="#/admin/product/${v.product_id}">${esc(v.name)}</a></td><td class="muted">${esc([v.color, v.size].filter(Boolean).join(' / '))}</td><td class="r"><span class="status ${v.stock === 0 ? 'bad' : 'warn'}">${v.stock === 0 ? 'Sold out' : v.stock + ' left'}</span></td></tr>`).join('')}</table>` : '<p class="muted">Everything is well stocked.</p>'}</div></div>
  ${d.daily.length ? `<div class="box" style="margin-top:20px"><h3>Daily sales, last 30 days</h3><div class="mini-chart">${d.daily.map(x => `<i style="height:${Math.max(6, Math.round(x.t / max * 100))}%" title="${x.d}: ${fmt(x.t)}"></i>`).join('')}</div></div>` : ''}`;
  return layout('', 'Dashboard', `${d.products} products, ${d.customers} customers`, body);
};

// ---------------- orders ----------------
adm.orders = async () => {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const list = await api('/api/admin/orders?' + q);
  const bar = `<div class="adm-bar" data-base="/admin/orders"><input class="input" placeholder="Search name, phone or order no." value="${esc(q.get('q') || '')}" data-change="adm-orders-filter" name="q" aria-label="Search orders">
    <select data-change="adm-orders-filter" name="status" style="width:auto;border-radius:999px"><option value="">All statuses</option>${['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'].map(s => `<option value="${s}" ${q.get('status') === s ? 'selected' : ''}>${AZ.STATUS[s][0]}</option>`).join('')}</select></div>`;
  const body = list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>City</th><th>Payment</th><th>Status</th><th class="r">Total</th></tr></thead><tbody>${list.map(o => `<tr><td><a class="link" href="#/admin/order/${o.id}">${o.order_no}</a></td><td>${fdate(o.created_at)}</td><td>${esc(o.name)}<div class="muted small">${esc(o.phone)}</div></td><td>${esc(o.city)}</td><td>${esc(o.payment_method)} ${payPill(o.payment_status)}</td><td>${statusPill(o.status)}</td><td class="r">${fmt(o.total)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><h3>No orders found</h3></div>';
  return layout('orders', 'Orders', 'Confirm, ship and mark payments as received.', body, bar);
};
AZ.changes['adm-orders-filter'] = el => {
  const bar = el.closest('.adm-bar'), p = new URLSearchParams();
  $$('input,select', bar).forEach(i => i.value && p.set(i.name, i.value));
  go('/admin/orders' + (p.toString() ? '?' + p : ''));
};
adm.order = async id => {
  const { order: o } = await api('/api/admin/orders/' + id);
  const opts = (list, cur, map) => list.map(s => `<option value="${s}" ${s === cur ? 'selected' : ''}>${map[s][0]}</option>`).join('');
  const body = `<div class="two-col"><div>
    <div class="box"><h3>Items</h3>${o.items.map(i => `<div class="sum-row"><span>${esc(i.name)} <span class="muted">${esc(i.variant_label)} &times; ${i.qty}</span></span><span>${fmt(i.unit_price * i.qty)}</span></div>`).join('')}
      <div class="sum-row"><span>Delivery</span><span>${fmt(o.shipping)}</span></div>${o.coupon_discount ? `<div class="sum-row disc"><span>Code ${esc(o.coupon_code)}</span><span>&minus;${fmt(o.coupon_discount)}</span></div>` : ''}<div class="sum-row total"><span>Total</span><span>${fmt(o.total)}</span></div></div>
    <div class="box"><h3>Customer</h3><p>${esc(o.name)}<br>${esc(o.phone)} &middot; ${esc(o.email)}<br><br>${esc(o.address)}<br>${esc(o.city)}${o.province ? ', ' + esc(o.province) : ''} ${esc(o.postal)}</p>${o.notes ? `<p class="muted" style="margin-top:12px">Note: ${esc(o.notes)}</p>` : ''}</div></div>
    <form class="box form" data-form="adm-order" data-id="${o.id}" style="align-self:start"><h3>Update order</h3>
      <p class="muted small">Payment: <b>${esc(o.payment_label)}</b>${o.payment_ref ? ` &middot; Transaction ID: <b>${esc(o.payment_ref)}</b>` : ''}</p>
      <div class="field"><label>Order status</label><select name="status">${opts(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'], o.status, AZ.STATUS)}</select><div class="hint">Cancelling puts the items back into stock.</div></div>
      <div class="field"><label>Payment status</label><select name="payment_status">${opts(['unpaid', 'awaiting', 'paid', 'failed', 'refunded'], o.payment_status, AZ.PAY)}</select></div>
      ${fld('Tracking number', 'tracking', o.tracking)}<button class="btn btn-primary" type="submit">Save changes</button></form></div>`;
  return layout('orders', 'Order ' + o.order_no, 'Placed ' + fdate(o.created_at), body, '<p style="margin:-14px 0 18px"><a class="link" href="#/admin/orders">&larr; All orders</a></p>');
};
AZ.forms['adm-order'] = async form => {
  await api('/api/admin/orders/' + form.dataset.id, { method: 'PUT', body: { status: val(form, 'status'), payment_status: val(form, 'payment_status'), tracking: val(form, 'tracking') } });
  toast('Order updated');
};

// ---------------- products list ----------------
adm.products = async () => {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const [list, cats] = await Promise.all([api('/api/admin/products?' + q), api('/api/categories')]);
  const bar = `<div class="adm-bar"><input class="input" placeholder="Search products" value="${esc(q.get('q') || '')}" data-change="adm-products-filter" name="q" aria-label="Search products">
    <select data-change="adm-products-filter" name="category" style="width:auto;border-radius:999px"><option value="">All categories</option>${cats.map(c => `<option value="${c.id}" ${String(c.id) === q.get('category') ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    <span class="sp"></span><a class="btn btn-lav btn-sm" href="#/admin/bulk">Bulk upload</a><a class="btn btn-primary btn-sm" href="#/admin/product/new">Add product</a></div>
    <div class="adm-bar" id="bulk-bar" hidden><span class="small muted" id="sel-count"></span><button class="btn btn-ghost btn-sm" data-act="adm-bulk" data-do="hide">Hide</button><button class="btn btn-ghost btn-sm" data-act="adm-bulk" data-do="show">Show</button><button class="btn btn-danger btn-sm" data-act="adm-bulk" data-do="delete">Delete</button></div>`;
  const body = list.length ? `<div class="tbl-wrap"><table><thead><tr><th><input type="checkbox" data-change="adm-sel-all" aria-label="Select all"></th><th></th><th>Product</th><th>Category</th><th class="r">Price</th><th class="r">Stock</th><th>Visibility</th><th></th></tr></thead><tbody>${list.map(p => `<tr>
    <td><input type="checkbox" class="sel" value="${p.id}" data-change="adm-sel" aria-label="Select ${esc(p.name)}"></td>
    <td><img class="thumb" src="${esc(p.image)}" alt=""></td><td><a class="link" href="#/admin/product/${p.id}">${esc(p.name)}</a><div class="muted small">${p.variants} variant${p.variants === 1 ? '' : 's'}</div></td>
    <td>${esc(p.category_name || '-')}</td><td class="r">${fmt(p.base_price)}</td><td class="r">${p.stock === 0 ? '<span class="status bad">0</span>' : p.stock}</td>
    <td><button class="status ${p.active ? 'good' : ''}" style="border:0;cursor:pointer" data-act="adm-toggle" data-id="${p.id}" data-on="${p.active ? 1 : 0}">${p.active ? 'Visible' : 'Hidden'}</button></td>
    <td class="r"><div class="row-actions"><a class="btn btn-ghost btn-sm" href="#/admin/product/${p.id}">Edit</a><button class="btn btn-danger btn-sm" data-act="adm-del-product" data-id="${p.id}" data-name="${esc(p.name)}">Delete</button></div></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty"><h3>No products yet</h3><p>Add your first product, or import many at once.</p><p style="margin-top:18px"><a class="btn btn-primary" href="#/admin/product/new">Add product</a></p></div>';
  return layout('products', 'Products', `${list.length} product${list.length === 1 ? '' : 's'}`, body, bar);
};
AZ.changes['adm-products-filter'] = el => {
  const bar = el.closest('.adm-bar'), p = new URLSearchParams();
  $$('input,select', bar).forEach(i => i.value && p.set(i.name, i.value));
  go('/admin/products' + (p.toString() ? '?' + p : ''));
};
const selIds = () => $$('.sel:checked').map(i => +i.value);
const updSel = () => { const n = selIds().length; $('#bulk-bar').hidden = n === 0; $('#sel-count').textContent = n + ' selected'; };
AZ.changes['adm-sel'] = updSel;
AZ.changes['adm-sel-all'] = el => { $$('.sel').forEach(i => { i.checked = el.checked; }); updSel(); };
Object.assign(AZ.actions, {
  'adm-toggle': async el => { await api('/api/admin/products/' + el.dataset.id, { method: 'PATCH', body: { active: el.dataset.on !== '1' } }); await AZ.route(); },
  'adm-del-product': async el => { if (await confirmBox('Delete "' + el.dataset.name + '"?', 'This removes the product and all its variants. Past orders keep their details.')) { await api('/api/admin/products/' + el.dataset.id, { method: 'DELETE' }); toast('Product deleted'); await AZ.route(); } },
  'adm-bulk': async el => {
    const ids = selIds(), act = el.dataset.do;
    if (act === 'delete' && !(await confirmBox(`Delete ${ids.length} product(s)?`, 'This cannot be undone.'))) return;
    await api('/api/admin/products/bulk-action', { method: 'POST', body: { ids, action: act } });
    toast('Done'); await AZ.route();
  }
});

// ---------------- product form ----------------
adm.product = async id => {
  const isNew = id === 'new';
  const [cats, p] = await Promise.all([api('/api/categories'), isNew ? Promise.resolve({ name: '', description: '', category_id: '', base_price: '', brand: 'AZHARS', material: '', tags: '', featured: 0, active: 1, images: [], variants: [{ size: '', color: '', sku: '', stock: 0 }] }) : api('/api/admin/products/' + id)]);
  const html = layout('products', isNew ? 'Add product' : 'Edit product', isNew ? 'Fill in the details, add photos and set sizes and colours.' : p.name, `
  <form class="form" data-form="adm-product" data-id="${isNew ? '' : p.id}">
    <div class="box"><h3>Basics</h3><div class="form">
      ${fld('Product name', 'name', p.name, 'required')}
      <div class="row"><div class="field"><label for="f-category_id">Category</label><select id="f-category_id" name="category_id"><option value="">None</option>${cats.map(c => `<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        ${fld('Price (Rs.)', 'base_price', p.base_price, 'type="number" min="0" required', 'The default price. A variant can override it below.')}</div>
      <div class="field"><label for="f-description">Description</label><textarea class="input" id="f-description" name="description" rows="4">${esc(p.description)}</textarea></div>
      <div class="row">${fld('Brand', 'brand', p.brand)}${fld('Material', 'material', p.material)}</div>
      ${fld('Tags', 'tags', p.tags, '', 'Comma separated, helps search. Example: formal, office, leather')}
      <div style="display:flex;gap:26px;flex-wrap:wrap"><label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Visible in the shop</label><label class="check"><input type="checkbox" name="featured" ${p.featured ? 'checked' : ''}> Featured on the home page</label></div></div></div>
    <div class="box"><h3>Photos</h3><div class="imgs" id="pf-imgs"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center"><label class="btn btn-lav btn-sm" style="cursor:pointer">Upload photos<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden data-change="adm-upload"></label>
      <input class="input" id="pf-url" placeholder="or paste an image link" style="width:auto;flex:1;min-width:200px;border-radius:999px;padding:9px 16px"><button class="btn btn-ghost btn-sm" type="button" data-act="adm-add-url">Add link</button></div>
      <p class="hint small muted" style="margin-top:10px">The first photo is the main one. Shoppers see the second photo when they hover a product.</p></div>
    <div class="box"><h3>Sizes, colours and stock</h3>
      <div class="note info small">Each row is one buyable option. Use quick add to create every colour and size combination at once.</div>
      <div class="row" style="margin-bottom:8px"><div class="field"><label>Colours</label><input class="input" id="qa-colors" placeholder="Black, Brown"></div><div class="field"><label>Sizes</label><input class="input" id="qa-sizes" placeholder="39, 40, 41, 42, 43"></div></div>
      <div style="display:flex;gap:10px;align-items:end;margin-bottom:18px"><div class="field" style="width:140px"><label>Stock each</label><input class="input" id="qa-stock" type="number" min="0" value="5"></div><button class="btn btn-lav btn-sm" type="button" data-act="adm-quick">Add combinations</button></div>
      <div style="overflow-x:auto"><table class="vt"><thead><tr><th>Colour</th><th>Size</th><th>SKU</th><th>Price (optional)</th><th>Stock</th><th></th></tr></thead><tbody id="pf-vars"></tbody></table></div>
      <button class="btn btn-ghost btn-sm" type="button" data-act="adm-add-var" style="margin-top:12px">Add a row</button></div>
    <div style="display:flex;gap:10px"><button class="btn btn-primary btn-lg" type="submit">${isNew ? 'Create product' : 'Save changes'}</button><a class="btn btn-ghost btn-lg" href="#/admin/products">Cancel</a></div>
  </form>`);
  const mount = () => {
    const imgs = [...p.images];
    const paint = () => { $('#pf-imgs').innerHTML = imgs.length ? imgs.map((u, i) => `<figure><img src="${esc(u)}" alt=""><button type="button" data-act="adm-rm-img" data-i="${i}" aria-label="Remove photo">&times;</button></figure>`).join('') : '<span class="muted small">No photos yet. A placeholder is shown until you add one.</span>'; };
    const row = v => {
      const tr = document.createElement('tr'); tr.dataset.id = v.id || '';
      tr.innerHTML = `<td><input class="input" data-k="color" value="${esc(v.color)}" aria-label="Colour"></td><td><input class="input" data-k="size" value="${esc(v.size)}" style="width:80px" aria-label="Size"></td><td><input class="input" data-k="sku" value="${esc(v.sku)}" aria-label="SKU"></td><td><input class="input" data-k="price_override" type="number" min="0" value="${v.price_override == null ? '' : v.price_override}" style="width:120px" aria-label="Variant price"></td><td><input class="input" data-k="stock" type="number" min="0" value="${v.stock || 0}" style="width:90px" aria-label="Stock"></td><td><button class="btn btn-ghost btn-sm" type="button" data-act="adm-rm-var" aria-label="Remove row">&times;</button></td>`;
      $('#pf-vars').appendChild(tr);
    };
    p.variants.forEach(row); paint();
    adm.pf = {
      addImg: u => { imgs.push(u); paint(); }, rmImg: i => { imgs.splice(i, 1); paint(); },
      addRow: () => row({ stock: 0 }),
      quick: () => {
        const colors = $('#qa-colors').value.split(',').map(s => s.trim()).filter(Boolean), sizes = $('#qa-sizes').value.split(',').map(s => s.trim()).filter(Boolean), stock = $('#qa-stock').value || 0;
        const have = new Set($$('#pf-vars tr').map(tr => `${$('[data-k=color]', tr).value.trim()}|${$('[data-k=size]', tr).value.trim()}`));
        const cs = colors.length ? colors : [''], ss = sizes.length ? sizes : [''];
        let n = 0;
        // drop a single empty starter row
        $$('#pf-vars tr').forEach(tr => { if ($$('input', tr).every(i => !i.value || i.dataset.k === 'stock')) tr.remove(); });
        cs.forEach(c => ss.forEach(s => { if (!have.has(`${c}|${s}`)) { row({ color: c, size: s, stock }); n++; } }));
        toast(n + ' option' + (n === 1 ? '' : 's') + ' added');
      },
      collect: () => ({ images: imgs, variants: $$('#pf-vars tr').map(tr => { const o = { id: tr.dataset.id || undefined }; $$('input', tr).forEach(i => { o[i.dataset.k] = i.value; }); return o; }).filter(v => v.id || v.color || v.size || v.sku || +v.stock > 0 || $$('#pf-vars tr').length === 1) })
    };
  };
  return { html, mount };
};
Object.assign(AZ.actions, {
  'adm-add-url': () => { const i = $('#pf-url'); if (i.value.trim()) { adm.pf.addImg(i.value.trim()); i.value = ''; } },
  'adm-rm-img': el => adm.pf.rmImg(+el.dataset.i), 'adm-add-var': () => adm.pf.addRow(), 'adm-quick': () => adm.pf.quick(),
  'adm-rm-var': el => el.closest('tr').remove()
});
AZ.changes['adm-upload'] = async el => {
  for (const f of el.files) {
    if (f.size > 8 * 1024 * 1024) { toast(f.name + ' is larger than 8 MB.', { err: true }); continue; }
    const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
    try { const { url } = await api('/api/admin/upload', { method: 'POST', body: { filename: f.name, data } }); adm.pf.addImg(url); } catch (e) { toast(e.message, { err: true }); }
  }
  el.value = '';
};
AZ.forms['adm-product'] = async form => {
  const { images, variants } = adm.pf.collect();
  const body = { name: val(form, 'name'), category_id: val(form, 'category_id'), base_price: val(form, 'base_price'), description: val(form, 'description'), brand: val(form, 'brand'), material: val(form, 'material'), tags: val(form, 'tags'), active: chk(form, 'active'), featured: chk(form, 'featured'), images, variants };
  const id = form.dataset.id;
  await api('/api/admin/products' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body });
  toast(id ? 'Product saved' : 'Product created'); go('/admin/products');
};

// ---------------- bulk upload ----------------
adm.bulk = async () => {
  const body = `<div class="box"><h3>1. Get the template</h3><p class="muted">One row per size/colour. Rows with the same product name are grouped into one product with variants. Open it in Excel, fill it in, then save as <b>CSV (Comma delimited)</b>.</p>
    <p style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap"><a class="btn btn-lav" href="/api/admin/products/template.csv" download>Download template</a><a class="btn btn-ghost" href="/api/admin/products/export.csv" download>Export current products</a></p>
    <details style="margin-top:18px"><summary class="link">What goes in each column?</summary><div class="muted small" style="margin-top:10px;line-height:1.7">
      <b>name</b>, <b>price</b> (whole rupees) and <b>category</b> are needed on the first row of each product. Missing categories are created for you.<br>
      <b>image_urls</b>: separate several with <code>|</code>. Use full web links, or just a file name like <code>kasur-oxford-1.jpg</code> after uploading the photo in step 2.<br>
      <b>size</b>, <b>color</b>, <b>sku</b>, <b>stock</b> describe each variant. <b>variant_price</b> is optional (overrides the price for that row).<br>
      <b>featured</b> and <b>active</b> accept yes or no. If a product name already exists, it is updated instead of duplicated.</div></details></div>
  <div class="box"><h3>2. Upload your product photos (optional)</h3><p class="muted">Select many photos at once. Then type the file names shown below into the <b>image_urls</b> column. Use | between several photos of the same product.</p>
    <p style="margin-top:14px"><label class="btn btn-lav" style="cursor:pointer">Choose photos<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden data-change="adm-bulk-photos"></label></p><div id="bulk-photos" class="small" style="margin-top:12px;line-height:1.8"></div></div>
  <div class="box"><h3>3. Upload your file</h3><div class="drop"><label class="btn btn-primary" style="cursor:pointer">Choose CSV file<input type="file" accept=".csv,text/csv" hidden data-change="adm-bulk-file"></label><p class="muted small" style="margin-top:12px" id="bulk-name">No file chosen</p></div><div id="bulk-result" style="margin-top:20px"></div></div>`;
  return layout('bulk', 'Bulk upload', 'Add or update hundreds of products at once from a spreadsheet.', body);
};
AZ.changes['adm-bulk-photos'] = async el => {
  const out = $('#bulk-photos'); out.innerHTML = '';
  for (const f of el.files) {
    if (f.size > 8 * 1024 * 1024) { out.insertAdjacentHTML('beforeend', `<div style="color:var(--danger)">${esc(f.name)}: larger than 8 MB, skipped.</div>`); continue; }
    const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
    try {
      const { url } = await api('/api/admin/upload', { method: 'POST', body: { filename: f.name, data, keep_name: true } });
      out.insertAdjacentHTML('beforeend', `<div><b>${esc(url.replace('/uploads/', ''))}</b> <span class="muted">uploaded</span></div>`);
    } catch (e) { out.insertAdjacentHTML('beforeend', `<div style="color:var(--danger)">${esc(f.name)}: ${esc(e.message)}</div>`); }
  }
  el.value = '';
};
AZ.changes['adm-bulk-file'] = async el => {
  const f = el.files[0]; if (!f) return;
  $('#bulk-name').textContent = f.name;
  const csv = await f.text();
  adm.bulkCsv = csv;
  const r = await api('/api/admin/products/bulk', { method: 'POST', body: { csv, dry: true } });
  const ok = r.created + r.updated;
  $('#bulk-result').innerHTML = `${r.errors.length ? `<div class="note err"><b>${r.errors.length} problem${r.errors.length > 1 ? 's' : ''} found</b><ul style="margin:8px 0 0;padding-left:18px">${r.errors.slice(0, 12).map(e => `<li>Row ${e.row}: ${esc(e.message)}</li>`).join('')}</ul>${r.errors.length > 12 ? `<p class="small" style="margin-top:6px">...and ${r.errors.length - 12} more.</p>` : ''}</div>` : ''}
    ${ok ? `<div class="note ok"><b>Ready to import:</b> ${r.created} new, ${r.updated} to update, ${r.variants} variants.${r.categories_created.length ? ` New categories: ${esc(r.categories_created.join(', '))}.` : ''}${r.errors.length ? ' Rows with problems will be skipped.' : ''}</div>
      <table><thead><tr><th>Product</th><th>Action</th><th>Variants</th></tr></thead><tbody>${r.preview.map(p => `<tr><td>${esc(p.name)}</td><td>${p.action === 'create' ? 'New' : 'Update'}</td><td>${p.variants}</td></tr>`).join('')}</tbody></table>
      <p style="margin-top:16px"><button class="btn btn-primary" data-act="adm-bulk-go">Import ${ok} product${ok > 1 ? 's' : ''}</button></p>` : ''}`;
};
AZ.actions['adm-bulk-go'] = async el => {
  el.disabled = true;
  const r = await api('/api/admin/products/bulk', { method: 'POST', body: { csv: adm.bulkCsv } });
  $('#bulk-result').innerHTML = `<div class="note ok"><b>Import finished.</b> ${r.created} created, ${r.updated} updated. <a class="link" href="#/admin/products">View products</a></div>`;
  toast('Import finished');
};

// ---------------- categories ----------------
adm.categories = async () => {
  const cats = await api('/api/categories');
  adm.cats = cats;
  const body = `<div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Description</th><th class="r">Products</th><th class="r">Order</th><th></th></tr></thead><tbody>${cats.map(c => `<tr><td><b>${esc(c.name)}</b><div class="muted small">/${esc(c.slug)}</div></td><td class="muted">${esc(c.description)}</td><td class="r">${c.product_count}</td><td class="r">${c.sort_order}</td><td class="r"><div class="row-actions"><button class="btn btn-ghost btn-sm" data-act="adm-cat" data-id="${c.id}">Edit</button><button class="btn btn-danger btn-sm" data-act="adm-cat-del" data-id="${c.id}" data-name="${esc(c.name)}">Delete</button></div></td></tr>`).join('')}</tbody></table></div>`;
  return layout('categories', 'Categories', 'Group products so shoppers can browse. Lower order numbers appear first.', body, '<div class="adm-bar"><span class="sp"></span><button class="btn btn-primary btn-sm" data-act="adm-cat" data-id="">Add category</button></div>');
};
AZ.actions['adm-cat'] = el => {
  const c = adm.cats.find(x => String(x.id) === el.dataset.id) || { name: '', description: '', image: '', sort_order: 50 };
  modal(`<h3>${c.id ? 'Edit category' : 'Add category'}</h3><form class="form" data-form="adm-cat" data-id="${c.id || ''}">${fld('Name', 'name', c.name, 'required')}${fld('Short description', 'description', c.description)}
    ${fld('Image link (optional)', 'image', c.image, '', 'Leave empty to use the default artwork.')}${fld('Display order', 'sort_order', c.sort_order, 'type="number"')}
    <div class="actions"><button class="btn btn-ghost" type="button" data-act="close-modal">Cancel</button><button class="btn btn-primary" type="submit">Save</button></div></form>`);
};
AZ.forms['adm-cat'] = async form => {
  const id = form.dataset.id;
  await api('/api/admin/categories' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: { name: val(form, 'name'), description: val(form, 'description'), image: val(form, 'image'), sort_order: val(form, 'sort_order') } });
  closeModal(); toast('Category saved'); S.categories = await api('/api/categories'); await AZ.route();
};
AZ.actions['adm-cat-del'] = async el => {
  if (!(await confirmBox('Delete "' + el.dataset.name + '"?', 'Categories that still have products cannot be deleted.'))) return;
  await api('/api/admin/categories/' + el.dataset.id, { method: 'DELETE' });
  toast('Category deleted'); S.categories = await api('/api/categories'); await AZ.route();
};

// ---------------- sales ----------------
adm.sales = async () => {
  const [sales, cats] = await Promise.all([api('/api/admin/sales'), api('/api/categories')]);
  adm.saleList = sales; adm.cats = cats;
  const st = { live: ['Live now', 'good'], scheduled: ['Scheduled', 'warn'], ended: ['Ended', ''], paused: ['Paused', ''] };
  const scope = s => s.scope === 'all' ? 'Everything' : s.scope === 'category' ? (cats.find(c => c.id === s.category_id) || {}).name || 'Category' : s.product_ids.length + ' product(s)';
  const body = sales.length ? `<div class="tbl-wrap"><table><thead><tr><th>Sale</th><th>Discount</th><th>Applies to</th><th>Runs</th><th>Status</th><th></th></tr></thead><tbody>${sales.map(s => `<tr><td><b>${esc(s.name)}</b></td><td>${s.discount_type === 'percent' ? s.discount_value + '% off' : fmt(s.discount_value) + ' off'}</td><td>${esc(scope(s))}</td><td class="small">${s.starts_at ? fdate(s.starts_at) : 'Now'} &rarr; ${s.ends_at ? fdate(s.ends_at) : 'No end date'}</td><td><span class="status ${st[s.state][1]}">${st[s.state][0]}</span></td><td class="r"><div class="row-actions"><button class="btn btn-ghost btn-sm" data-act="adm-sale" data-id="${s.id}">Edit</button><button class="btn btn-danger btn-sm" data-act="adm-sale-del" data-id="${s.id}" data-name="${esc(s.name)}">Delete</button></div></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty"><h3>No sales yet</h3><p>Create a seasonal sale like Eid, Summer or Black Friday.</p></div>';
  return layout('sales', 'Sale seasons', 'Prices drop automatically on the dates you set. If two sales overlap, shoppers get the lower price (they do not stack).', body, '<div class="adm-bar"><span class="sp"></span><button class="btn btn-primary btn-sm" data-act="adm-sale" data-id="">New sale</button></div>');
};
AZ.actions['adm-sale'] = async el => {
  const s = adm.saleList.find(x => String(x.id) === el.dataset.id) || { name: '', banner_text: '', discount_type: 'percent', discount_value: 20, scope: 'all', category_id: null, product_ids: [], starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 7 * 864e5).toISOString(), active: 1 };
  const prods = await api('/api/admin/products');
  modal(`<h3>${s.id ? 'Edit sale' : 'New sale'}</h3><form class="form" data-form="adm-sale" data-id="${s.id || ''}">
    <div class="field"><label for="f-name">Sale name</label><input class="input" id="f-name" name="name" value="${esc(s.name)}" list="sale-names" required placeholder="Eid Sale"><datalist id="sale-names"><option value="Eid Sale"><option value="Ramadan Sale"><option value="Independence Day Sale"><option value="Summer Sale"><option value="Winter Sale"><option value="Black Friday"><option value="End of Season Clearance"></datalist></div>
    ${fld('Banner text', 'banner_text', s.banner_text, '', 'Shown on the home page. Example: Eid Sale: 25% off everything')}
    <div class="row"><div class="field"><label>Discount type</label><select name="discount_type" data-change="adm-sale-type"><option value="percent" ${s.discount_type === 'percent' ? 'selected' : ''}>Percentage</option><option value="fixed" ${s.discount_type === 'fixed' ? 'selected' : ''}>Fixed amount (Rs.)</option></select></div>${fld('Amount', 'discount_value', s.discount_value, 'type="number" min="1" required')}</div>
    <div class="field"><label>Applies to</label><select name="scope" data-change="adm-sale-scope"><option value="all" ${s.scope === 'all' ? 'selected' : ''}>Everything in the store</option><option value="category" ${s.scope === 'category' ? 'selected' : ''}>One category</option><option value="products" ${s.scope === 'products' ? 'selected' : ''}>Specific products</option></select></div>
    <div class="field" id="sc-cat" ${s.scope === 'category' ? '' : 'hidden'}><label>Category</label><select name="category_id">${adm.cats.map(c => `<option value="${c.id}" ${c.id === s.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    <div class="field" id="sc-prod" ${s.scope === 'products' ? '' : 'hidden'}><label>Products</label><div class="pick">${prods.map(p => `<label class="check"><input type="checkbox" name="pid" value="${p.id}" ${s.product_ids.includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}</div></div>
    <div class="row"><div class="field"><label for="f-starts">Starts</label><input class="input" id="f-starts" type="datetime-local" name="starts_at" value="${toLocal(s.starts_at)}"></div><div class="field"><label for="f-ends">Ends</label><input class="input" id="f-ends" type="datetime-local" name="ends_at" value="${toLocal(s.ends_at)}"><div class="hint">Leave empty to run until you stop it.</div></div></div>
    <label class="check"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Sale is switched on</label>
    <div class="actions"><button class="btn btn-ghost" type="button" data-act="close-modal">Cancel</button><button class="btn btn-primary" type="submit">Save sale</button></div></form>`);
};
AZ.changes['adm-sale-scope'] = el => { const f = el.form; $('#sc-cat', f).hidden = el.value !== 'category'; $('#sc-prod', f).hidden = el.value !== 'products'; };
AZ.changes['adm-sale-type'] = () => {};
AZ.forms['adm-sale'] = async form => {
  const id = form.dataset.id;
  await api('/api/admin/sales' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: { name: val(form, 'name'), banner_text: val(form, 'banner_text'), discount_type: val(form, 'discount_type'), discount_value: val(form, 'discount_value'), scope: val(form, 'scope'), category_id: val(form, 'category_id'), product_ids: $$('input[name=pid]:checked', form).map(i => +i.value), starts_at: toISO(val(form, 'starts_at')), ends_at: toISO(val(form, 'ends_at')), active: chk(form, 'active') } });
  closeModal(); toast('Sale saved'); S.sales = await api('/api/sales/active'); AZ.renderChrome(); await AZ.route();
};
AZ.actions['adm-sale-del'] = async el => {
  if (!(await confirmBox('Delete "' + el.dataset.name + '"?', 'Prices go back to normal straight away.'))) return;
  await api('/api/admin/sales/' + el.dataset.id, { method: 'DELETE' });
  toast('Sale deleted'); S.sales = await api('/api/sales/active'); AZ.renderChrome(); await AZ.route();
};

// ---------------- coupons ----------------
adm.coupons = async () => {
  const list = await api('/api/admin/coupons'); adm.couponList = list;
  const body = list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Code</th><th>Discount</th><th>Minimum order</th><th>Used</th><th>Status</th><th></th></tr></thead><tbody>${list.map(c => `<tr><td><b>${esc(c.code)}</b></td><td>${c.discount_type === 'percent' ? c.discount_value + '%' : fmt(c.discount_value)}</td><td>${c.min_order ? fmt(c.min_order) : '-'}</td><td>${c.used_count}${c.usage_limit ? ' / ' + c.usage_limit : ''}</td><td><span class="status ${c.active ? 'good' : ''}">${c.active ? 'Active' : 'Off'}</span></td><td class="r"><div class="row-actions"><button class="btn btn-ghost btn-sm" data-act="adm-coupon" data-id="${c.id}">Edit</button><button class="btn btn-danger btn-sm" data-act="adm-coupon-del" data-id="${c.id}" data-name="${esc(c.code)}">Delete</button></div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><h3>No coupons yet</h3></div>';
  return layout('coupons', 'Coupons', 'Discount codes customers type in at the bag.', body, '<div class="adm-bar"><span class="sp"></span><button class="btn btn-primary btn-sm" data-act="adm-coupon" data-id="">New coupon</button></div>');
};
AZ.actions['adm-coupon'] = el => {
  const c = adm.couponList.find(x => String(x.id) === el.dataset.id) || { code: '', discount_type: 'percent', discount_value: 10, min_order: 0, expires_at: null, usage_limit: '', active: 1 };
  modal(`<h3>${c.id ? 'Edit coupon' : 'New coupon'}</h3><form class="form" data-form="adm-coupon" data-id="${c.id || ''}">${fld('Code', 'code', c.code, 'required placeholder="WELCOME10" style="text-transform:uppercase"')}
    <div class="row"><div class="field"><label>Type</label><select name="discount_type"><option value="percent" ${c.discount_type === 'percent' ? 'selected' : ''}>Percentage</option><option value="fixed" ${c.discount_type === 'fixed' ? 'selected' : ''}>Fixed amount (Rs.)</option></select></div>${fld('Amount', 'discount_value', c.discount_value, 'type="number" min="1" required')}</div>
    <div class="row">${fld('Minimum order (Rs.)', 'min_order', c.min_order, 'type="number" min="0"')}${fld('Usage limit', 'usage_limit', c.usage_limit || '', 'type="number" min="1"', 'Leave empty for unlimited.')}</div>
    <div class="field"><label for="f-exp">Expires</label><input class="input" id="f-exp" type="datetime-local" name="expires_at" value="${toLocal(c.expires_at)}"></div>
    <label class="check"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}> Coupon is active</label>
    <div class="actions"><button class="btn btn-ghost" type="button" data-act="close-modal">Cancel</button><button class="btn btn-primary" type="submit">Save coupon</button></div></form>`);
};
AZ.forms['adm-coupon'] = async form => {
  const id = form.dataset.id;
  await api('/api/admin/coupons' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: { code: val(form, 'code'), discount_type: val(form, 'discount_type'), discount_value: val(form, 'discount_value'), min_order: val(form, 'min_order'), usage_limit: val(form, 'usage_limit'), expires_at: toISO(val(form, 'expires_at')), active: chk(form, 'active') } });
  closeModal(); toast('Coupon saved'); await AZ.route();
};
AZ.actions['adm-coupon-del'] = async el => { if (await confirmBox('Delete coupon ' + el.dataset.name + '?', 'Customers will no longer be able to use it.')) { await api('/api/admin/coupons/' + el.dataset.id, { method: 'DELETE' }); toast('Coupon deleted'); await AZ.route(); } };

// ---------------- customers ----------------
adm.customers = async () => {
  const list = await api('/api/admin/customers');
  const body = list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Joined</th><th class="r">Orders</th><th class="r">Spent</th></tr></thead><tbody>${list.map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.email)}</td><td>${esc(c.phone)}</td><td>${fdate(c.created_at)}</td><td class="r">${c.orders}</td><td class="r">${fmt(c.spent)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><h3>No customers yet</h3><p>Customers who create an account appear here. Guest checkouts show up under Orders.</p></div>';
  return layout('customers', 'Customers', `${list.length} registered`, body);
};

// ---------------- settings ----------------
adm.settings = async () => {
  const s = await api('/api/admin/settings');
  const body = `<form class="form" data-form="adm-settings"><div class="box"><h3>Store details</h3><div class="form">${fld('Store name', 'store_name', s.store_name)}${fld('Tagline', 'tagline', s.tagline)}${fld('Announcement bar', 'announcement', s.announcement, '', 'The thin green bar at the very top. Leave empty to hide it.')}
    <div class="row">${fld('Contact email', 'contact_email', s.contact_email)}${fld('Contact phone', 'contact_phone', s.contact_phone)}</div>${fld('Address', 'address', s.address)}</div></div>
    <div class="box"><h3>Delivery</h3><div class="row">${fld('Delivery charge (Rs.)', 'shipping_fee', s.shipping_fee, 'type="number" min="0"')}${fld('Free delivery over (Rs.)', 'free_shipping_over', s.free_shipping_over, 'type="number" min="0"')}</div></div>
    <div class="box"><h3>Payment methods</h3>${s.payment_methods.map(m => `<div class="pay-opt" style="cursor:default;display:block" data-pm="${esc(m.id)}"><label class="check" style="margin-bottom:10px"><input type="checkbox" data-k="enabled" ${m.enabled ? 'checked' : ''}> <b>${esc(m.label)}</b></label>
      <div class="field"><label>Name shown at checkout</label><input class="input" data-k="label" value="${esc(m.label)}"></div><div class="field" style="margin-top:10px"><label>Instructions shown to the customer</label><textarea class="input" data-k="instructions" rows="2">${esc(m.instructions)}</textarea>${m.id === 'card_demo' ? '<div class="hint">This is a test gateway, no real money moves. Switch it off before you go live, or replace it with a real gateway.</div>' : ''}</div></div>`).join('')}
      <p class="hint small muted" style="margin-top:12px">Put your real account numbers in the bank, JazzCash and Easypaisa instructions. The ones shown are placeholders.</p></div>
    <div><button class="btn btn-primary btn-lg" type="submit">Save settings</button></div></form>
    <div class="box" style="margin-top:20px"><h3>Backup</h3><p class="muted">Download a copy of everything: products, orders and customers. Do this regularly and keep the file somewhere safe (your computer, Google Drive). Product photos are stored separately and are not inside this file.</p>
      <p style="margin-top:14px"><a class="btn btn-lav" href="/api/admin/backup" download>Download backup</a></p></div>`;
  return layout('settings', 'Settings', 'Store details, delivery charges and payment methods.', body);
};
AZ.forms['adm-settings'] = async form => {
  const b = {};
  ['store_name', 'tagline', 'announcement', 'contact_email', 'contact_phone', 'address', 'shipping_fee', 'free_shipping_over'].forEach(k => { b[k] = val(form, k); });
  b.payment_methods = $$('[data-pm]', form).map(box => ({ id: box.dataset.pm, enabled: $('[data-k=enabled]', box).checked, label: $('[data-k=label]', box).value, instructions: $('[data-k=instructions]', box).value }));
  await api('/api/admin/settings', { method: 'PUT', body: b });
  S.settings = await api('/api/settings'); AZ.renderChrome(); toast('Settings saved');
};
})();

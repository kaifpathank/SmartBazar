// Smart Bazar - single page app (plain JavaScript, no build step)

// ---------- tiny helpers ----------
class Raw { constructor(s) { this.s = s; } }
const raw = (s) => new Raw(s);
const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Tagged template: every ${value} is HTML-escaped unless wrapped in raw() or is an array of raw parts.
function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    let s;
    if (v instanceof Raw) s = v.s;
    else if (Array.isArray(v)) s = v.map((x) => (x instanceof Raw ? x.s : escapeHtml(x ?? ''))).join('');
    else if (v === null || v === undefined || v === false) s = '';
    else s = escapeHtml(v);
    out += s + strings[i + 1];
  });
  return new Raw(out);
}
const $ = (sel, root = document) => root.querySelector(sel);
const inr = (n) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

// ---------- state ----------
const state = {
  token: store.get('sb_token', null),
  user: null,
  cart: store.get('sb_cart', []), // [{productId, qty}]
  products: [],
  categories: [],
  adminTab: 'overview',
};
const FREE_DELIVERY_ABOVE = 499, DELIVERY_FEE = 29;
const FREE_STATUS_FLOW = ['placed', 'confirmed', 'packed', 'out_for_delivery', 'delivered'];
const STATUS_LABEL = { placed: 'Placed', confirmed: 'Confirmed', packed: 'Packed', out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled' };

// ---------- api ----------
async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (state.token) headers.Authorization = 'Bearer ' + state.token;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try { res = await fetch('/api' + path, { method, headers, body: payload }); }
  catch { throw new Error('Cannot reach the server. Is it running?'); }
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    if (res.status === 401 && state.token) { logout(true); }
    throw new Error(data?.error || 'Request failed (' + res.status + ')');
  }
  return data;
}

function toast(msg, isErr = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ---------- cart ----------
const saveCart = () => store.set('sb_cart', state.cart);
const productById = (id) => state.products.find((p) => p.id === Number(id));
const cartQty = (id) => state.cart.find((c) => c.productId === Number(id))?.qty || 0;
const cartCount = () => state.cart.reduce((n, c) => n + c.qty, 0);
function cleanCart() {
  state.cart = state.cart.filter((c) => productById(c.productId) && productById(c.productId).stock > 0)
    .map((c) => ({ ...c, qty: Math.min(c.qty, productById(c.productId).stock, 20) }));
  saveCart();
}
function cartTotals() {
  const subtotal = state.cart.reduce((s, c) => s + (productById(c.productId)?.price || 0) * c.qty, 0);
  const mrp = state.cart.reduce((s, c) => s + (productById(c.productId)?.mrp || 0) * c.qty, 0);
  const fee = subtotal === 0 || subtotal >= FREE_DELIVERY_ABOVE ? 0 : DELIVERY_FEE;
  return { subtotal, fee, total: subtotal + fee, savings: mrp - subtotal };
}
function setQty(id, qty) {
  id = Number(id);
  const p = productById(id);
  if (!p) return;
  qty = Math.max(0, Math.min(qty, p.stock, 20));
  const line = state.cart.find((c) => c.productId === id);
  if (qty === 0) state.cart = state.cart.filter((c) => c.productId !== id);
  else if (line) line.qty = qty; else state.cart.push({ productId: id, qty });
  saveCart();
}

// ---------- auth ----------
function logout(expired = false) {
  state.token = null; state.user = null; store.del('sb_token');
  if (expired) toast('Session expired. Please login again.', true);
  navigate('#/login');
}
function setSession(token, user) {
  state.token = token; state.user = user; store.set('sb_token', token);
}

// ---------- components ----------
const unitImg = (p, cls) => p.image
  ? html`<div class="${cls}"><img src="${p.image}" alt="${p.name}" loading="lazy" /></div>`
  : html`<div class="${cls}" role="img" aria-label="${p.name}">${p.emoji || '🛒'}</div>`;
const off = (p) => (p.mrp > p.price ? Math.round(((p.mrp - p.price) / p.mrp) * 100) : 0);

function qtyControl(p) {
  const q = cartQty(p.id);
  if (p.stock <= 0) return html`<button class="btn ghost sm" disabled>Out of stock</button>`;
  if (!q) return html`<button class="btn sm" data-act="add" data-id="${p.id}">Add</button>`;
  return html`<div class="qty"><button data-act="dec" data-id="${p.id}" aria-label="Decrease">−</button><span>${q}</span><button data-act="inc" data-id="${p.id}" aria-label="Increase">+</button></div>`;
}

function productCard(p) {
  return html`<div class="card pcard">
    ${off(p) ? html`<span class="off">${off(p)}% OFF</span>` : ''}
    <a href="#/product/${p.id}">${unitImg(p, 'pimg')}</a>
    <a href="#/product/${p.id}" class="pname">${p.name}</a>
    <div class="muted small">${p.unit}</div>
    ${p.stock > 0 && p.stock <= 5 ? html`<div class="stockflag">Only ${p.stock} left</div>` : ''}
    <div class="row between"><div><span class="price">${inr(p.price)}</span>${p.mrp > p.price ? html`<span class="mrp">${inr(p.mrp)}</span>` : ''}</div>
    <div data-qty="${p.id}">${qtyControl(p)}</div></div>
  </div>`;
}

function header() {
  const u = state.user;
  const hash = location.hash || '#/';
  const act = (p) => (hash.startsWith(p) ? 'active' : '');
  return html`<header class="topbar"><div class="wrap">
    <a class="logo" href="#/">🛒 Smart Bazar</a>
    <form class="search" data-form="search" role="search"><input type="search" name="q" placeholder="Search for atta, milk, biscuits…" aria-label="Search products" value="${new URLSearchParams(hash.split('?')[1] || '').get('q') || ''}" /></form>
    <nav class="nav">
      <a class="${act('#/shop')}" href="#/shop">Shop</a>
      ${u?.role === 'admin' ? html`<a class="${act('#/admin')}" href="#/admin">Admin</a>` : ''}
      ${u ? html`<a class="${act('#/orders')}" href="#/orders">Orders</a>` : ''}
      <a class="${act('#/cart')}" href="#/cart">Cart ${cartCount() ? html`<span class="badge">${cartCount()}</span>` : ''}</a>
      ${u ? html`<button data-act="logout" title="${u.email}">Logout (${u.name.split(' ')[0]})</button>` : html`<a class="${act('#/login')}" href="#/login">Login</a>`}
    </nav></div></header>`;
}

function mount(view) {
  $('#app').innerHTML = header().s + '<main><div class="wrap" id="view"></div></main><footer class="footer">Smart Bazar · Fresh groceries, fair prices. Free delivery above ' + inr(FREE_DELIVERY_ABOVE) + '</footer>';
  $('#view').innerHTML = view.s;
  window.scrollTo(0, 0);
}
const empty = (emoji, title, sub, cta) => html`<div class="empty"><div class="big">${emoji}</div><h2>${title}</h2><p>${sub}</p>${cta || ''}</div>`;

// ---------- views: customer ----------
function viewHome() {
  const deals = [...state.products].filter((p) => off(p) >= 10 && p.stock > 0).sort((a, b) => off(b) - off(a)).slice(0, 8);
  const catCount = (c) => state.products.filter((p) => p.category_id === c.id).length;
  mount(html`
    <div class="hero"><div><h1>Fresh groceries,<br/>delivered fast.</h1><p>Fruits, vegetables, dairy, staples and more at fair prices. Free delivery on orders above ${inr(FREE_DELIVERY_ABOVE)}.</p><a class="btn" href="#/shop">Start shopping</a></div><div class="big">🧺</div></div>
    <h2>Shop by category</h2>
    <div class="chips">${state.categories.map((c) => html`<a class="chip" href="#/shop?cat=${c.id}">${c.emoji} ${c.name} (${catCount(c)})</a>`)}</div>
    ${deals.length ? html`<h2>Best deals</h2><div class="grid">${deals.map(productCard)}</div>` : ''}
    <h2>Fresh arrivals</h2>
    <div class="grid">${state.products.slice(0, 8).map(productCard)}</div>`);
}

function viewShop(params) {
  const cat = Number(params.get('cat')) || 0, q = (params.get('q') || '').toLowerCase().trim(), sort = params.get('sort') || '';
  let list = state.products.filter((p) => (!cat || p.category_id === cat) && (!q || (p.name + ' ' + p.description + ' ' + p.category).toLowerCase().includes(q)));
  if (sort === 'low') list.sort((a, b) => a.price - b.price);
  if (sort === 'high') list.sort((a, b) => b.price - a.price);
  if (sort === 'off') list.sort((a, b) => off(b) - off(a));
  const link = (c) => `#/shop?${new URLSearchParams({ ...(c ? { cat: c } : {}), ...(q ? { q } : {}), ...(sort ? { sort } : {}) })}`;
  mount(html`
    <div class="row between wrapflex"><h1>${q ? 'Results for “' + q + '”' : 'All products'}</h1>
      <select data-change="sort" style="width:auto" aria-label="Sort"><option value="">Sort: Latest</option><option value="low" ${sort === 'low' ? raw('selected') : ''}>Price: low to high</option><option value="high" ${sort === 'high' ? raw('selected') : ''}>Price: high to low</option><option value="off" ${sort === 'off' ? raw('selected') : ''}>Biggest discount</option></select></div>
    <div class="chips"><a class="chip ${cat ? '' : 'on'}" href="${link(0)}">All</a>${state.categories.map((c) => html`<a class="chip ${cat === c.id ? 'on' : ''}" href="${link(c.id)}">${c.emoji} ${c.name}</a>`)}</div>
    ${list.length ? html`<div class="grid">${list.map(productCard)}</div>` : empty('🔍', 'No products found', 'Try a different search or category.', html`<a class="btn" href="#/shop">Clear filters</a>`)}`);
}

function viewProduct(id) {
  const p = productById(id);
  if (!p) return mount(empty('😕', 'Product not found', 'It may have been removed.', html`<a class="btn" href="#/shop">Back to shop</a>`));
  const similar = state.products.filter((x) => x.category_id === p.category_id && x.id !== p.id).slice(0, 4);
  mount(html`
    <p class="muted small"><a href="#/shop">Shop</a> › <a href="#/shop?cat=${p.category_id}">${p.category}</a> › ${p.name}</p>
    <div class="card pad"><div class="formgrid" style="align-items:start">
      <div>${unitImg(p, 'pimg')}</div>
      <div>
        <h1>${p.name}</h1><div class="muted">${p.unit} · ${p.category}</div>
        <p style="margin:14px 0"><span class="price" style="font-size:28px">${inr(p.price)}</span>${p.mrp > p.price ? html`<span class="mrp">${inr(p.mrp)}</span> <span class="pill delivered">${off(p)}% off</span>` : ''}</p>
        <p>${p.description || 'Quality product from Smart Bazar.'}</p>
        ${p.stock > 0 && p.stock <= 5 ? html`<p class="stockflag">Hurry! Only ${p.stock} left in stock.</p>` : ''}
        <div style="margin:16px 0" data-qty="${p.id}">${qtyControl(p)}</div>
        <a class="btn ghost" href="#/cart">Go to cart</a>
      </div></div></div>
    ${similar.length ? html`<h2>You may also like</h2><div class="grid">${similar.map(productCard)}</div>` : ''}`);
}

function viewCart() {
  cleanCart();
  if (!state.cart.length) return mount(empty('🛒', 'Your cart is empty', 'Add some fresh items to get started.', html`<a class="btn" href="#/shop">Browse products</a>`));
  const t = cartTotals();
  mount(html`<h1>Your cart (${cartCount()} items)</h1>
    <div class="two"><div class="card pad">${state.cart.map((c) => { const p = productById(c.productId); return html`
      <div class="line-item">${unitImg(p, 'thumb')}<div class="grow"><a href="#/product/${p.id}"><b>${p.name}</b></a><div class="muted small">${p.unit} · ${inr(p.price)} each</div></div>
      <div data-qty="${p.id}">${qtyControl(p)}</div><b style="min-width:70px;text-align:right">${inr(p.price * c.qty)}</b></div>`; })}</div>
    <div class="card pad sticky"><h3>Bill details</h3><div class="bill">
      <div><span>Items total</span><span>${inr(t.subtotal)}</span></div>
      <div><span>Delivery</span><span>${t.fee ? inr(t.fee) : 'FREE'}</span></div>
      ${t.savings > 0 ? html`<div class="muted"><span>You save</span><span>${inr(t.savings)}</span></div>` : ''}
      <div class="total"><span>To pay</span><span>${inr(t.total)}</span></div></div>
      ${t.fee ? html`<p class="muted small">Add ${inr(FREE_DELIVERY_ABOVE - t.subtotal)} more for free delivery.</p>` : ''}
      <a class="btn block" href="#/checkout">Proceed to checkout</a></div></div>`);
}

function authGuard() {
  if (!state.user) { sessionStorage.setItem('sb_after', location.hash); navigate('#/login'); toast('Please login to continue'); return false; }
  return true;
}

function viewCheckout() {
  if (!authGuard()) return;
  cleanCart();
  if (!state.cart.length) return navigate('#/cart');
  const t = cartTotals(), saved = store.get('sb_addr', {});
  mount(html`<h1>Checkout</h1><div class="two"><form class="card pad" data-form="checkout" novalidate>
    <h3>Delivery address</h3>
    <div class="formgrid"><div><label for="a-name">Receiver name</label><input id="a-name" type="text" name="name" required value="${saved.name || state.user.name}" /></div>
    <div><label for="a-phone">Mobile number</label><input id="a-phone" type="tel" name="phone" maxlength="10" inputmode="numeric" required value="${saved.phone || state.user.phone || ''}" /></div></div>
    <label for="a-line">Full address</label><textarea id="a-line" name="line" rows="3" required placeholder="House no, street, area, city">${saved.line || ''}</textarea>
    <label for="a-pin">Pincode</label><input id="a-pin" type="text" name="pincode" maxlength="6" inputmode="numeric" required value="${saved.pincode || ''}" style="max-width:180px" />
    <h3 style="margin-top:22px">Payment method</h3>
    <label class="optcard on"><input type="radio" name="pay" value="cod" checked /><div><b>Cash on delivery</b><div class="muted small">Pay when your order arrives</div></div></label>
    <label class="optcard"><input type="radio" name="pay" value="upi" /><div><b>UPI (demo)</b><div class="muted small">Simulated payment for demo. No real money is charged.</div></div></label>
    <div id="form-error"></div>
    <button class="btn block" style="margin-top:16px" type="submit">Place order · ${inr(t.total)}</button></form>
    <div class="card pad sticky"><h3>Order summary</h3>${state.cart.map((c) => { const p = productById(c.productId); return html`<div class="row between small" style="padding:4px 0"><span>${p.name} × ${c.qty}</span><span>${inr(p.price * c.qty)}</span></div>`; })}
    <div class="bill"><div class="total"><span>Total</span><span>${inr(t.total)}</span></div></div><p class="muted small">Delivery ${t.fee ? inr(t.fee) : 'FREE'} included.</p></div></div>`);
}

const orderItemsTable = (o) => html`<div class="tablewrap"><table><thead><tr><th>Item</th><th>Qty</th><th class="right">Amount</th></tr></thead><tbody>
  ${o.items.map((i) => html`<tr><td>${i.name} <span class="muted small">(${i.unit})</span></td><td>${i.qty}</td><td class="right">${inr(i.price * i.qty)}</td></tr>`)}
  <tr><td colspan="2" class="muted">Delivery fee</td><td class="right">${o.delivery_fee ? inr(o.delivery_fee) : 'FREE'}</td></tr>
  <tr><td colspan="2"><b>Total</b></td><td class="right"><b>${inr(o.total)}</b></td></tr></tbody></table></div>`;

function timeline(o) {
  if (o.status === 'cancelled') return html`<p><span class="pill cancelled">Cancelled</span></p>`;
  const idx = FREE_STATUS_FLOW.indexOf(o.status);
  return html`<div class="timeline">${FREE_STATUS_FLOW.map((s, i) => html`<div class="step ${i <= idx ? 'done' : ''}"><div class="dot">${i <= idx ? '✓' : ''}</div>${STATUS_LABEL[s]}</div>`)}</div>`;
}
const fmtDate = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

async function viewOrders() {
  if (!authGuard()) return;
  mount(html`<h1>My orders</h1><p class="muted">Loading…</p>`);
  const orders = await api('/orders');
  mount(html`<h1>My orders</h1>${orders.length ? orders.map((o) => html`<a class="card pad" style="display:block;margin-bottom:12px" href="#/orders/${o.id}">
    <div class="row between wrapflex"><div><b>${o.code}</b> <span class="muted small">· ${fmtDate(o.created_at)}</span></div><span class="pill ${o.status}">${STATUS_LABEL[o.status]}</span></div>
    <div class="muted small" style="margin-top:6px">${o.items.map((i) => i.name + ' ×' + i.qty).join(', ')}</div>
    <div style="margin-top:6px"><b>${inr(o.total)}</b> <span class="pill ${o.payment_status}">${o.payment_method === 'cod' ? 'COD' : 'UPI'} · ${o.payment_status}</span></div></a>`) : empty('📦', 'No orders yet', 'Your orders will show up here.', html`<a class="btn" href="#/shop">Shop now</a>`)}`);
}

async function viewOrder(id, justPlaced) {
  if (!authGuard()) return;
  const o = await api('/orders/' + id);
  mount(html`${justPlaced ? html`<div class="card pad" style="background:var(--brand-soft);margin-bottom:16px"><h2 style="margin:0">🎉 Order placed!</h2><p style="margin:6px 0 0">Thank you ${state.user.name.split(' ')[0]}, your order <b>${o.code}</b> is confirmed.</p></div>` : ''}
    <div class="row between wrapflex"><h1>Order ${o.code}</h1><span class="pill ${o.status}">${STATUS_LABEL[o.status]}</span></div>
    <p class="muted">${fmtDate(o.created_at)} · Payment: ${o.payment_method === 'cod' ? 'Cash on delivery' : 'UPI'} (${o.payment_status})</p>
    <div class="card pad">${timeline(o)}</div>
    <div class="two" style="margin-top:16px"><div class="card pad">${orderItemsTable(o)}</div>
    <div class="card pad"><h3>Delivering to</h3><b>${o.address_name}</b><br/>${o.address_line}<br/>PIN ${o.address_pincode}<br/><span class="muted">📞 ${o.address_phone}</span>
    ${['placed', 'confirmed'].includes(o.status) && state.user.role !== 'admin' ? html`<button class="btn danger block" style="margin-top:16px" data-act="cancel-order" data-id="${o.id}">Cancel order</button>` : ''}</div></div>`);
}

function viewAuth(mode) {
  if (state.user) return navigate(state.user.role === 'admin' ? '#/admin' : '#/');
  const isSignup = mode === 'signup', role = state.authRole || 'customer';
  mount(html`<div class="auth card pad"><h1>${isSignup ? 'Create account' : 'Welcome back'}</h1>
    ${isSignup ? html`<div class="seg"><button type="button" class="${role === 'customer' ? 'on' : ''}" data-act="role" data-role="customer">🛍️ Customer</button><button type="button" class="${role === 'admin' ? 'on' : ''}" data-act="role" data-role="admin">🏪 Shopkeeper (Admin)</button></div>` : ''}
    <form data-form="${isSignup ? 'signup' : 'login'}" novalidate>
      ${isSignup ? html`<label for="s-name">Full name</label><input id="s-name" type="text" name="name" required autocomplete="name" /><label for="s-phone">Mobile (optional)</label><input id="s-phone" type="tel" name="phone" maxlength="10" inputmode="numeric" autocomplete="tel" />` : ''}
      <label for="s-email">Email</label><input id="s-email" type="email" name="email" required autocomplete="email" />
      <label for="s-pass">Password</label><input id="s-pass" type="password" name="password" required minlength="6" autocomplete="${isSignup ? 'new-password' : 'current-password'}" />
      ${isSignup && role === 'admin' ? html`<label for="s-code">Admin signup code</label><input id="s-code" type="password" name="adminCode" required /><p class="muted small">Ask the store owner for this code. It is set in the server's .env file.</p>` : ''}
      <div id="form-error"></div>
      <button class="btn block" style="margin-top:16px" type="submit">${isSignup ? 'Sign up' : 'Login'}</button></form>
    <p class="muted small" style="text-align:center;margin-top:16px">${isSignup ? html`Already have an account? <a href="#/login"><b>Login</b></a>` : html`New here? <a href="#/signup"><b>Create an account</b></a>`}</p></div>`);
}

// ---------- views: admin ----------
function adminGuard() {
  if (!state.user) { sessionStorage.setItem('sb_after', '#/admin'); navigate('#/login'); return false; }
  if (state.user.role !== 'admin') { toast('Admin access only', true); navigate('#/'); return false; }
  return true;
}

function exportOrdersCsv(orders) {
  const columns = [
    'Order ID', 'Order code', 'Date', 'Status', 'Customer', 'Phone',
    'Address', 'Pincode', 'Payment method', 'Payment status', 'Order total',
    'Delivery fee', 'Item', 'Unit', 'Quantity', 'Item price', 'Line total',
  ];
  const escapeCell = (value) => {
    let text = String(value ?? '');
    if (/^[\t\r ]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const rows = orders.flatMap((order) => {
    const items = order.items?.length ? order.items : [null];
    return items.map((item) => [
      order.id, order.code, order.created_at, order.status, order.customer,
      order.address_phone, order.address_line, order.address_pincode,
      order.payment_method, order.payment_status, order.total, order.delivery_fee,
      item?.name, item?.unit, item?.qty, item?.price,
      item ? item.price * item.qty : '',
    ]);
  });
  const csv = [columns, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `smart-bazar-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function viewAdmin() {
  if (!adminGuard()) return;
  const tab = state.adminTab;
  const tabs = [['overview', 'Overview'], ['orders', 'Orders'], ['products', 'Products']];
  const head = html`<div class="row between wrapflex"><h1>Admin dashboard</h1><span class="muted small">Signed in as ${state.user.email}</span></div>
    <div class="tabs">${tabs.map(([k, l]) => html`<button class="${tab === k ? 'on' : ''}" data-act="admin-tab" data-tab="${k}">${l}</button>`)}</div>`;
  mount(html`${head}<p class="muted">Loading…</p>`);
  let body;
  if (tab === 'overview') {
    const s = await api('/admin/stats');
    body = html`<div class="stats">
      <div class="card stat"><div class="n">${inr(s.paidSales)}</div><div class="l">Paid sales</div></div>
      <div class="card stat"><div class="n">${s.totalOrders}</div><div class="l">Total orders</div></div>
      <div class="card stat"><div class="n">${s.pendingOrders}</div><div class="l">Orders to fulfil</div></div>
      <div class="card stat"><div class="n">${s.customers}</div><div class="l">Customers</div></div>
      <div class="card stat"><div class="n">${s.products}</div><div class="l">Active products</div></div></div>
      <div class="two" style="margin-top:20px;grid-template-columns:1fr 1fr">
      <div class="card pad"><h3>⚠️ Low stock</h3>${s.lowStock.length ? s.lowStock.map((p) => html`<div class="row between" style="padding:6px 0"><span>${p.emoji} ${p.name} <span class="muted small">${p.unit}</span></span><span class="pill ${p.stock === 0 ? 'cancelled' : 'placed'}">${p.stock} left</span></div>`) : html`<p class="muted">All products are well stocked.</p>`}</div>
      <div class="card pad"><h3>🏆 Top selling</h3>${s.topProducts.length ? s.topProducts.map((p) => html`<div class="row between" style="padding:6px 0"><span>${p.name}</span><span class="muted small">${p.qty} sold · ${inr(p.revenue)}</span></div>`) : html`<p class="muted">No sales yet.</p>`}</div></div>`;
  } else if (tab === 'orders') {
    const orders = await api('/orders');
    body = html`<div class="row between wrapflex" style="margin-bottom:12px"><span class="muted">${orders.length} orders</span><button class="btn sm" data-act="export-orders" ${orders.length ? '' : raw('disabled')}>Export CSV</button></div>
      ${orders.length ? html`<div class="card pad tablewrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th></tr></thead><tbody>
      ${orders.map((o) => html`<tr><td><a href="#/orders/${o.id}"><b>${o.code}</b></a><div class="muted small">${fmtDate(o.created_at)}</div></td><td>${o.customer}<div class="muted small">${o.address_phone}</div></td>
      <td class="small">${o.items.map((i) => i.name + ' ×' + i.qty).join(', ')}</td><td><b>${inr(o.total)}</b></td>
      <td><span class="pill ${o.payment_status}">${o.payment_method.toUpperCase()} · ${o.payment_status}</span></td>
      <td>${['delivered', 'cancelled'].includes(o.status) ? html`<span class="pill ${o.status}">${STATUS_LABEL[o.status]}</span>` : html`<select data-change="order-status" data-id="${o.id}" style="width:auto">${[...FREE_STATUS_FLOW, 'cancelled'].map((s) => html`<option value="${s}" ${s === o.status ? raw('selected') : ''}>${STATUS_LABEL[s]}</option>`)}</select>`}</td></tr>`)}</tbody></table></div>` : empty('📦', 'No orders yet', 'New orders will appear here.')}`;
  } else {
    const products = await api('/products?all=1');
    body = html`<div class="row between wrapflex" style="margin-bottom:12px"><span class="muted">${products.length} products</span>
      <div class="row"><button class="btn ghost sm" data-act="new-category">+ Category</button><button class="btn sm" data-act="edit-product" data-id="0">+ Add product</button></div></div>
      <div class="card pad tablewrap"><table><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th></th></tr></thead><tbody>
      ${products.map((p) => html`<tr><td><div class="row">${unitImg(p, 'thumb')}<div><b>${p.name}</b> ${p.active ? '' : html`<span class="pill cancelled">Hidden</span>`}<div class="muted small">${p.unit}</div></div></div></td><td>${p.category}</td>
      <td>${inr(p.price)}<div class="muted small">MRP ${inr(p.mrp)}</div></td><td><span class="${p.stock <= 5 ? 'pill ' + (p.stock === 0 ? 'cancelled' : 'placed') : ''}">${p.stock}</span></td>
      <td class="right" style="white-space:nowrap"><button class="btn ghost sm" data-act="edit-product" data-id="${p.id}">Edit</button> <button class="btn danger sm" data-act="delete-product" data-id="${p.id}">Delete</button></td></tr>`)}</tbody></table></div>`;
    state.adminProducts = products;
  }
  mount(html`${head}${body}`);
}

function openModal(content) {
  $('#modal-root').innerHTML = `<div class="overlay" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true">${content.s}</div></div>`;
}
const closeModal = () => { $('#modal-root').innerHTML = ''; };

function productModal(p) {
  const isNew = !p;
  p = p || { name: '', description: '', category_id: state.categories[0]?.id, price: '', mrp: '', unit: '1 pc', stock: '', emoji: '🛒', active: 1 };
  openModal(html`<h2 style="margin-top:0">${isNew ? 'Add product' : 'Edit product'}</h2>
    <form data-form="product" data-id="${isNew ? '' : p.id}" novalidate>
      <div class="row" style="margin-bottom:6px"><div class="preview" id="img-preview">${p.image ? html`<img src="${p.image}" alt="" />` : (p.emoji || '🛒')}</div>
      <div class="grow"><label for="p-img" style="margin-top:0">Product photo (JPG/PNG/WEBP, max 3 MB)</label><input id="p-img" type="file" name="image" accept="image/jpeg,image/png,image/webp" />
      ${p.image ? html`<label class="small" style="font-weight:400"><input type="checkbox" name="removeImage" value="true" /> Remove current photo</label>` : ''}</div></div>
      <label for="p-name">Name</label><input id="p-name" type="text" name="name" required value="${p.name}" />
      <label for="p-desc">Description</label><textarea id="p-desc" name="description" rows="2">${p.description}</textarea>
      <div class="formgrid"><div><label for="p-cat">Category</label><select id="p-cat" name="category_id">${state.categories.map((c) => html`<option value="${c.id}" ${c.id === p.category_id ? raw('selected') : ''}>${c.emoji} ${c.name}</option>`)}</select></div>
      <div><label for="p-unit">Unit (e.g. 1 kg, 500 ml)</label><input id="p-unit" type="text" name="unit" value="${p.unit}" /></div>
      <div><label for="p-price">Selling price (₹)</label><input id="p-price" type="number" name="price" min="0" step="0.01" required value="${p.price}" /></div>
      <div><label for="p-mrp">MRP (₹)</label><input id="p-mrp" type="number" name="mrp" min="0" step="0.01" required value="${p.mrp}" /></div>
      <div><label for="p-stock">Stock</label><input id="p-stock" type="number" name="stock" min="0" step="1" required value="${p.stock}" /></div>
      <div><label for="p-emoji">Emoji (shown if no photo)</label><input id="p-emoji" type="text" name="emoji" maxlength="4" value="${p.emoji}" /></div></div>
      <label class="small" style="font-weight:400"><input type="checkbox" name="active" value="1" ${p.active ? raw('checked') : ''} /> Visible to customers</label>
      <div id="form-error"></div>
      <div class="row" style="margin-top:16px;justify-content:flex-end"><button type="button" class="btn ghost" data-act="close-modal-btn">Cancel</button><button class="btn" type="submit">${isNew ? 'Add product' : 'Save changes'}</button></div></form>`);
}

// ---------- data refresh ----------
async function loadCatalog() {
  const [products, categories] = await Promise.all([api('/products'), api('/categories')]);
  state.products = products; state.categories = categories;
}

// ---------- router ----------
function navigate(hash) { if (location.hash === hash) route(); else location.hash = hash; }

let routing = 0;
async function route() {
  const token = ++routing;
  closeModal();
  const raw0 = location.hash || '#/';
  const [path, qs] = raw0.slice(1).split('?');
  const params = new URLSearchParams(qs || '');
  const seg = path.split('/').filter(Boolean);
  try {
    if (!state.products.length || !state.categories.length) await loadCatalog();
    if (token !== routing) return;
    const [a, b] = seg;
    if (!a) return viewHome();
    if (a === 'shop') return viewShop(params);
    if (a === 'product') return viewProduct(b);
    if (a === 'cart') return viewCart();
    if (a === 'checkout') return viewCheckout();
    if (a === 'orders') return b ? await viewOrder(b, params.get('new') === '1') : await viewOrders();
    if (a === 'login') return viewAuth('login');
    if (a === 'signup') return viewAuth('signup');
    if (a === 'admin') return await viewAdmin();
    mount(empty('🤷', 'Page not found', 'The page you are looking for does not exist.', html`<a class="btn" href="#/">Go home</a>`));
  } catch (e) {
    if (token !== routing) return;
    mount(empty('⚠️', 'Something went wrong', e.message, html`<button class="btn" data-act="reload">Try again</button>`));
  }
}

// ---------- events ----------
function refreshQtyControls() {
  document.querySelectorAll('[data-qty]').forEach((el) => { const p = productById(el.dataset.qty); if (p) el.innerHTML = qtyControl(p).s; });
  const badge = $('.nav a[href="#/cart"]');
  if (badge) badge.innerHTML = 'Cart ' + (cartCount() ? `<span class="badge">${cartCount()}</span>` : '');
}

function formError(msg) { const el = $('#form-error'); if (el) el.innerHTML = msg ? `<div class="error" role="alert">${escapeHtml(msg)}</div>` : ''; }

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act, id = el.dataset.id;
  try {
    if (act === 'add') { setQty(id, 1); refreshQtyControls(); toast('Added to cart'); }
    else if (act === 'inc') {
      const p = productById(id);
      if (cartQty(id) >= Math.min(p.stock, 20)) toast(p.stock < 20 ? `Only ${p.stock} in stock` : 'Maximum 20 per order', true);
      setQty(id, cartQty(id) + 1);
      if (location.hash.startsWith('#/cart')) viewCart(); else refreshQtyControls();
    } else if (act === 'dec') { setQty(id, cartQty(id) - 1); if (location.hash.startsWith('#/cart')) viewCart(); else refreshQtyControls(); }
    else if (act === 'logout') { setSession(null, null); store.del('sb_token'); toast('Logged out'); navigate('#/'); }
    else if (act === 'role') { state.authRole = el.dataset.role; viewAuth('signup'); }
    else if (act === 'reload') route();
    else if (act === 'admin-tab') { state.adminTab = el.dataset.tab; viewAdmin(); }
    else if (act === 'export-orders') {
      if (state.user?.role !== 'admin') throw new Error('Admin access only');
      const orders = await api('/orders');
      exportOrdersCsv(orders);
      toast('Orders exported as CSV');
    }
    else if (act === 'close-modal') { if (e.target === el) closeModal(); }
    else if (act === 'close-modal-btn') closeModal();
    else if (act === 'edit-product') { productModal(Number(id) ? state.adminProducts.find((p) => p.id === Number(id)) : null); }
    else if (act === 'delete-product') {
      if (!confirm('Delete this product? If it has past orders it will only be hidden.')) return;
      const r = await api('/products/' + id, { method: 'DELETE' });
      toast(r.archived ? 'Product hidden (it has past orders)' : 'Product deleted');
      await loadCatalog(); viewAdmin();
    } else if (act === 'new-category') {
      const name = prompt('New category name'); if (!name) return;
      const emoji = prompt('Emoji for this category (optional)', '🛒') || '🛒';
      await api('/categories', { method: 'POST', body: { name, emoji } });
      await loadCatalog(); toast('Category added'); viewAdmin();
    } else if (act === 'cancel-order') {
      if (!confirm('Cancel this order?')) return;
      await api('/orders/' + id + '/cancel', { method: 'POST' });
      await loadCatalog(); toast('Order cancelled'); viewOrder(id);
    }
  } catch (err) { toast(err.message, true); }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  try {
    if (el.dataset.change === 'sort') {
      const p = new URLSearchParams(location.hash.split('?')[1] || ''); el.value ? p.set('sort', el.value) : p.delete('sort');
      navigate('#/shop?' + p);
    } else if (el.dataset.change === 'order-status') {
      await api('/orders/' + el.dataset.id + '/status', { method: 'PATCH', body: { status: el.value } });
      await loadCatalog(); toast('Order updated'); viewAdmin();
    } else if (el.name === 'pay') {
      document.querySelectorAll('.optcard').forEach((c) => c.classList.toggle('on', c.contains(el) && el.checked));
    } else if (el.name === 'image' && el.files?.[0]) {
      const f = el.files[0]; const box = $('#img-preview');
      if (f.size > 3 * 1024 * 1024) { toast('Photo must be under 3 MB', true); el.value = ''; return; }
      if (box) box.innerHTML = `<img alt="" src="${URL.createObjectURL(f)}" />`;
    }
  } catch (err) { toast(err.message, true); viewAdmin(); }
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form, fd = new FormData(form), v = Object.fromEntries(fd.entries());
  const btn = form.querySelector('button[type=submit]');
  if (kind === 'search') { navigate('#/shop?' + new URLSearchParams(v.q ? { q: v.q } : {})); return; }
  formError('');
  if (btn) btn.disabled = true;
  try {
    if (kind === 'login' || kind === 'signup') {
      if (!v.email || !v.password) throw new Error('Enter email and password');
      const body = kind === 'signup' ? { ...v, role: state.authRole === 'admin' ? 'admin' : 'customer' } : v;
      const r = await api('/auth/' + kind, { method: 'POST', body });
      setSession(r.token, r.user); state.authRole = 'customer';
      toast('Welcome, ' + r.user.name.split(' ')[0] + '!');
      const after = sessionStorage.getItem('sb_after'); sessionStorage.removeItem('sb_after');
      navigate(after || (r.user.role === 'admin' ? '#/admin' : '#/'));
    } else if (kind === 'checkout') {
      const address = { name: v.name, phone: v.phone, line: v.line, pincode: v.pincode };
      const order = await api('/orders', { method: 'POST', body: { items: state.cart.map((c) => ({ productId: c.productId, qty: c.qty })), address, paymentMethod: v.pay } });
      store.set('sb_addr', address);
      state.cart = []; saveCart(); await loadCatalog();
      navigate('#/orders/' + order.id + '?new=1');
    } else if (kind === 'product') {
      const out = new FormData();
      for (const k of ['name', 'description', 'category_id', 'price', 'mrp', 'unit', 'stock', 'emoji']) out.append(k, v[k] ?? '');
      out.append('active', form.querySelector('[name=active]').checked ? '1' : '0');
      if (form.querySelector('[name=removeImage]')?.checked) out.append('removeImage', 'true');
      const file = form.querySelector('[name=image]').files[0]; if (file) out.append('image', file);
      const id = form.dataset.id;
      await api(id ? '/products/' + id : '/products', { method: id ? 'PUT' : 'POST', form: out });
      closeModal(); await loadCatalog(); toast(id ? 'Product updated' : 'Product added'); viewAdmin();
    }
  } catch (err) { formError(err.message); }
  finally { if (btn) btn.disabled = false; }
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
window.addEventListener('hashchange', route);

// ---------- boot ----------
(async function init() {
  if (state.token) {
    try { state.user = (await api('/auth/me')).user; } catch { state.token = null; store.del('sb_token'); }
  }
  route();
})();

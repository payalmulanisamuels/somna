/**
 * Somna cart drawer engine + site-wide helpers:
 * - Free-shipping bar dynamically calculated against threshold; updates width of [data-cart-drawer-shipping-fill].
 * - 2x FREE E-Books gift auto-added while the 3+1 bundle (4-bag variant) is in the cart.
 * - Hides the gift  from catalog/search grids (they stay purchasable for the auto-add).
 * - Steppers / trash / close for the custom drawer.
 * - Close releases the theme scroll-lock (html[scroll-lock]); a watchdog + pageshow handler self-heal
 *   a stuck scroll-lock (e.g. after checkout -> back button) so the page never freezes.
 * - Delivery-frequency labels mapped by selling-plan ID.
 */
(function () {
  var GIFT_VARIANT = 52294644826343;
  var GIFT_TRIGGER_VARIANT = 52214694314215;

  var PLANLABEL = {
    5969674471: 'every month', 5969707239: 'every 2 months', 5969740007: 'every 4 months',
    5971902695: 'every month', 5971935463: 'every 2 months', 5971968231: 'every month'
  };

  var lastCart = null;

  try {
    var st = document.createElement('style');
    st.textContent =
      '.cdx-topbar .cdx-marqi span{align-items:center!important;gap:0!important}' +
      '.cdx-topbar .cdx-marqi span::before{align-self:center!important;margin:0 16px!important;flex:none!important;position:static!important;transform:none!important}' +
      '.dxsh-card:has(a[href*="/products/2x-free-e-books"]), ' +
      'li:has(> a[href*="/products/2x-free-e-books"]),' +
      'li:has(product-card a[href*="/products/2x-free-e-books"]),' +
      '.product-grid__item:has(a[href*="/products/2x-free-e-books"]),.product-grid__item:has(a[href*="/products/shipping-protection"])' +
      '{display:none!important}';
    document.head.appendChild(st);
  } catch (e) {}

  /* --- release the theme scroll-lock so the page can scroll after the drawer closes --- */
  function releaseScrollLock() {
    try { document.documentElement.removeAttribute('scroll-lock'); } catch (e) {}
  }
  /* Self-heal: if scroll-lock is set but nothing is actually open, remove it. */
  function unfreeze() {
    var h = document.documentElement;
    if (!h.hasAttribute('scroll-lock')) return;
    var open = document.querySelector('dialog[open]') || document.querySelector('theme-drawer[open]') || document.querySelector('[aria-modal="true"]');
    if (!open) releaseScrollLock();
  }
  function closeDrawer() {
    var dr = document.getElementById('cart-drawer');
    if (dr) {
      var dlg = dr.querySelector('dialog');
      if (dlg && dlg.open) { try { dlg.close(); } catch (e) {} }
      dr.removeAttribute('open');
      var cc = dr.querySelector('cart-drawer-component');
      if (cc) cc.removeAttribute('open');
    }
    releaseScrollLock();
  }

  function fixCatalogCount() {
    var grid = document.querySelector('.dxsh-grid');
    if (!grid) return;
    var visible = 0;
    grid.querySelectorAll('.dxsh-card').forEach(function (c) { if (c.offsetParent !== null) visible += 1; });
    document.querySelectorAll('.dxsh-count').forEach(function (el) {
      var want = visible + (visible === 1 ? ' product' : ' products');
      if (el.textContent.trim() !== want) el.textContent = want;
    });
  }

  function refreshDrawer() {
    if (window.SomnaCart && window.SomnaCart.refreshDrawer) return window.SomnaCart.refreshDrawer();
    return Promise.resolve();
  }

  function formatMoney(cents) {
    return '$' + (cents / 100).toFixed(2);
  }

  function updateShippingBar(cart) {
    var bar = document.querySelector('[data-cart-drawer-shipping]');
    if (!bar) return;
    var fill = bar.querySelector('[data-cart-drawer-shipping-fill]');
    var text = bar.querySelector('[data-cart-drawer-shipping-text]');
    var threshold = parseInt(bar.getAttribute('data-threshold'), 10) || 5000;

    var currentCart = cart || lastCart;
    if (!currentCart || typeof currentCart.total_price !== 'number') return;

    var total = currentCart.total_price;
    var pct = Math.min(100, Math.max(0, Math.round((total / threshold) * 100)));

    if (fill) {
      fill.style.width = pct + '%';
    }

    if (text) {
      if (total >= threshold) {
        if (!/unlocked/i.test(text.textContent)) {
          text.textContent = 'You unlocked free shipping!';
        }
      } else {
        var remaining = threshold - total;
        text.textContent = 'Add ' + formatMoney(remaining) + ' more for free shipping!';
      }
    }
  }

  function monthLabel(s) {
    var m = String(s).match(/(\d+)\s*days/i);
    if (!m) return String(s).replace(/^Delivered\s+/i, '');
    var months = Math.max(1, Math.round(parseInt(m[1], 10) / 30));
    return 'every ' + (months === 1 ? 'month' : months + ' months');
  }
  function labelFor(id, fallback) { if (id && PLANLABEL[id]) return PLANLABEL[id]; return monthLabel(fallback); }
  function relabelFreq() {
    document.querySelectorAll('.sdw-item').forEach(function (item) {
      var sel = item.querySelector('.sdw-freq select');
      var pid = sel ? parseInt(sel.value, 10) : null;
      if (sel) { [].forEach.call(sel.options, function (op) { var t = 'Delivered ' + labelFor(parseInt(op.value, 10), op.textContent); if (op.textContent !== t) op.textContent = t; }); }
      var pl = item.querySelector('.sdw-planline');
      if (pl) { var t = 'Delivered ' + labelFor(pid, pl.textContent); if (pl.textContent !== t) pl.textContent = t; }
    });
  }

  var busy = false;
  function again() { busy = false; setTimeout(ensureExtras, 40); }
  function ensureExtras() {
    if (busy) return;
    busy = true;
    fetch('/cart.js', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        lastCart = cart;
        updateShippingBar(cart);

        var items = cart.items || [];
        var  gift = null, hasTrigger = false, realCount = 0;
        items.forEach(function (i) {
          if (i.variant_id === GIFT_VARIANT) { gift = i; return; }
          realCount += 1;
          if (i.variant_id === GIFT_TRIGGER_VARIANT) hasTrigger = true;
        });
        if (hasTrigger && !gift) { return fetch('/cart/add.js', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ items: [{ id: GIFT_VARIANT, quantity: 1 }] }) }).then(function (r) { if (r.ok) return refreshDrawer(); }).then(again); }
        if (!hasTrigger && gift) { return fetch('/cart/change.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: gift.key, quantity: 0 }) }).then(function () { return refreshDrawer(); }).then(again); }
        if (gift && gift.quantity > 1) { return fetch('/cart/change.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: gift.key, quantity: 1 }) }).then(function () { return refreshDrawer(); }).then(again); }
        busy = false;
      })
      .catch(function () { busy = false; });
  }

  var qbusy = false;
  function changeLine(key, qty) {
    if (qbusy) return;
    qbusy = true;
    fetch('/cart/change.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: key, quantity: qty }) })
      .then(function () { return refreshDrawer(); })
      .then(function () { document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true })); })
      .catch(function () {})
      .finally(function () { qbusy = false; });
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('[data-somna-close]')) { e.preventDefault(); closeDrawer(); return; }
    var inc = t.closest('[data-sq-inc]');
    var dec = t.closest('[data-sq-dec]');
    var rem = t.closest('[data-sq-remove]');
    if (inc) { e.preventDefault(); changeLine(inc.getAttribute('data-key'), (parseInt(inc.getAttribute('data-qty'), 10) || 1) + 1); return; }
    if (dec) { e.preventDefault(); changeLine(dec.getAttribute('data-key'), Math.max(0, (parseInt(dec.getAttribute('data-qty'), 10) || 1) - 1)); return; }
    if (rem) { e.preventDefault(); changeLine(rem.getAttribute('data-key'), 0); return; }
  }, true);

  function tick() { updateShippingBar(); relabelFreq(); fixCatalogCount(); unfreeze(); }
  function onCartEvent() { updateShippingBar(); relabelFreq(); ensureExtras(); setTimeout(function () { updateShippingBar(); relabelFreq(); }, 450); }
  document.addEventListener('cart:refresh', onCartEvent);
  document.addEventListener('shopify:cart:lines-update', onCartEvent);
  window.addEventListener('pageshow', function (ev) { if (ev.persisted) { setTimeout(unfreeze, 60); setTimeout(unfreeze, 400); } });
  if (document.readyState !== 'loading') { tick(); ensureExtras(); }
  else document.addEventListener('DOMContentLoaded', function () { tick(); ensureExtras(); });
  setInterval(tick, 1000);
})();
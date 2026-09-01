/**
 * Unified Somna add-to-cart: drawer refresh, subscriptions, and global button handlers.
 */
(function () {
  if (window.SomnaCart) return;

  var LOADING_CLASS = 'somna-atc-loading';
  var pendingAdds = 0;

  function getDrawer() {
    return document.getElementById('cart-drawer');
  }

  function whenDrawerReady() {
    if (!window.customElements) return Promise.resolve(getDrawer());
    return customElements.whenDefined('theme-drawer').then(function () {
      return getDrawer();
    });
  }

  function openDrawer() {
    return whenDrawerReady().then(function (dr) {
      if (dr && dr.open) dr.open();
    });
  }

  function toggleDrawer() {
    return whenDrawerReady().then(function (dr) {
      if (dr && dr.toggle) dr.toggle();
      else if (dr && dr.open) dr.open();
    });
  }

  function setDrawerLoading(on) {
    var dr = getDrawer();
    if (!dr) return;
    if (on) {
      pendingAdds += 1;
      dr.classList.add('is-refreshing');
    } else {
      pendingAdds = Math.max(0, pendingAdds - 1);
      if (pendingAdds === 0) dr.classList.remove('is-refreshing');
    }
  }

  function setButtonLoading(btn, on) {
    if (!btn) return;
    if (on) {
      if (!btn.dataset.somnaLabel) btn.dataset.somnaLabel = btn.innerHTML;
      btn.classList.add(LOADING_CLASS);
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
    } else {
      btn.classList.remove(LOADING_CLASS);
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      if (btn.dataset.somnaLabel) {
        btn.innerHTML = btn.dataset.somnaLabel;
        delete btn.dataset.somnaLabel;
      }
    }
  }

  function bumpCartCount(delta) {
    document.querySelectorAll('.cdx-count').forEach(function (el) {
      var n = parseInt(el.textContent, 10);
      if (isNaN(n)) n = 0;
      n = Math.max(0, n + delta);
      el.textContent = n > 99 ? '99+' : String(n);
    });
  }

  function updateCartCounts(count) {
    if (count == null) {
      return fetch('/cart.js', { credentials: 'same-origin' })
        .then(function (r) {
          return r.json();
        })
        .then(function (c) {
          updateCartCounts(c.item_count);
        })
        .catch(function () {});
    }
    var label = count > 99 ? '99+' : String(count);
    document.querySelectorAll('.cdx-count').forEach(function (el) {
      el.textContent = label;
    });
  }

  function reopenDrawerInstant() {
    return whenDrawerReady().then(function (dr) {
      if (!dr || !dr.open) return;
      var panel = dr.querySelector('dialog');
      if (panel) panel.classList.add('theme-drawer__dialog-instant');
      dr.open();
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (panel) panel.classList.remove('theme-drawer__dialog-instant');
        });
      });
    });
  }

  function swapDrawerContent(sectionHtml) {
    var parsed = document.createElement('div');
    parsed.innerHTML = sectionHtml;
    var nextInner = parsed.querySelector('[data-hydration-key="cart-drawer-inner"]');
    var currentInner = document.querySelector('[data-hydration-key="cart-drawer-inner"]');

    if (nextInner && currentInner) {
      currentInner.replaceWith(nextInner);
      return 'inner';
    }

    var cur = document.getElementById('shopify-section-cart-drawer-section');
    var nextSection =
      parsed.querySelector('#shopify-section-cart-drawer-section') || parsed.firstElementChild;
    if (cur && nextSection) {
      cur.replaceWith(nextSection);
      return 'section';
    }

    return false;
  }

  function refreshDrawer() {
    var wasOpen = !!(getDrawer() && getDrawer().hasAttribute('open'));
    setDrawerLoading(true);
    return fetch('/?sections=cart-drawer-section')
      .then(function (x) {
        return x.json();
      })
      .then(function (d) {
        var h = d && d['cart-drawer-section'];
        if (!h) return;

        var swapMode = swapDrawerContent(h);
        document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));

        if (swapMode === 'section' && wasOpen) {
          return reopenDrawerInstant();
        }
      })
      .finally(function () {
        setDrawerLoading(false);
      });
  }

  function signal(openAfter) {
    return refreshDrawer()
      .then(function () {
        if (openAfter) {
          return whenDrawerReady().then(function (dr) {
            if (dr && dr.open) dr.open();
          });
        }
      })
      .then(function () {
        return fetch('/cart.js', { credentials: 'same-origin' })
        .then(function (r) {
          return r.json();
        })
        .then(function (c) {
          updateCartCounts(c.item_count);
          try {
            var resolve;
            var p = new Promise(function (res) {
              resolve = res;
            });
            var ev = new Event('shopify:cart:lines-update', { bubbles: true });
            ev.action = 'add';
            ev.context = 'product';
            ev.lines = [];
            ev.promise = p;
            ev.somnaHandled = true;
            document.dispatchEvent(ev);
            resolve({
              cart: {
                id: '',
                totalQuantity: c.item_count,
                cost: {
                  totalAmount: {
                    amount: String((c.total_price || 0) / 100),
                    currencyCode: c.currency,
                  },
                },
                lines: [],
                discountCodes: [],
              },
              detail: {
                items: c.items,
                itemCount: c.item_count,
                didError: false,
              },
            });
          } catch (e) {}
        })
        .catch(function () {});
    });
  }

  function normalizeItems(items) {
    return items.map(function (i) {
      var o = { id: Number(i.id), quantity: i.quantity || 1 };
      if (i.selling_plan) o.selling_plan = Number(i.selling_plan);
      return o;
    });
  }

  function add(items, options) {
    options = options || {};
    if (!items || !items.length) return Promise.resolve();

    var openAfter = options.openDrawer !== false;
    var trigger = options.trigger || null;
    var qty = items.reduce(function (sum, item) {
      return sum + (item.quantity || 1);
    }, 0);

    if (trigger) setButtonLoading(trigger, true);

    var payload = { items: normalizeItems(items) };
    return fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        if (!r.ok) throw new Error('add failed');
        return r.json();
      })
      .then(function () {
        var code = options.code;
        if (code) {
          return fetch('/discount/' + encodeURIComponent(code), { credentials: 'same-origin' }).catch(
            function () {}
          );
        }
      })
      .then(function () {
        if (openAfter) bumpCartCount(qty);
        return signal(openAfter);
      })
      .catch(function () {
        if (openAfter) bumpCartCount(-qty);
        window.location.href = '/cart';
      })
      .finally(function () {
        if (trigger) setButtonLoading(trigger, false);
      });
  }

  function parseBundleOpt(opt) {
    var parts = (opt.getAttribute('data-items') || '').split(',');
    var items = [];
    parts.forEach(function (p) {
      p = p.replace(/\s/g, '');
      if (!p) return;
      var seg = p.split('|');
      var it = { id: parseInt(seg[0], 10), quantity: 1 };
      if (seg[1]) it.selling_plan = parseInt(seg[1], 10);
      items.push(it);
    });
    return items;
  }

  function addFromBundleOpt(opt, options) {
    var items = parseBundleOpt(opt);
    if (!items.length) return Promise.resolve();
    options = options || {};
    options.code = opt.getAttribute('data-code') || '';
    return add(items, options);
  }

  function getSelectedPlan(scope) {
    if (!scope) return null;
    var select = scope.querySelector('select[data-cart-upsell-plan], select[data-cart-addon-plan]');
    if (select && select.value) return parseInt(select.value, 10);
    var checked = scope.querySelector('input[data-cart-upsell-plan]:checked');
    if (checked && checked.value) return parseInt(checked.value, 10);
    var attr = scope.getAttribute('data-somna-plan');
    if (attr) return parseInt(attr, 10);
    return null;
  }

  function changeLinePlan(line, planId, quantity) {
    var body = { line: line, quantity: quantity || 1 };
    if (planId) {
      body.selling_plan = planId;
    } else {
      body.selling_plan = '';
    }
    setDrawerLoading(true);
    return fetch('/cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        if (!r.ok) throw new Error('change failed');
        return r.json();
      })
      .then(function () {
        return signal(false);
      })
      .catch(function () {
        window.location.href = '/cart';
      });
  }

  document.addEventListener('shopify:cart:lines-update', function () {
    updateCartCounts();
  });
  document.addEventListener('cart:refresh', function () {
    updateCartCounts();
  });

  document.addEventListener(
    'click',
    function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      if (t.closest('[data-somna-cart-toggle]')) {
        e.preventDefault();
        toggleDrawer();
        return;
      }

      var vidBtn = t.closest('button[data-vid], [data-vid].cda-btn, [data-cda-st-btn][data-vid], #cda-atc[data-vid]');
      if (vidBtn) {
        e.preventDefault();
        e.stopImmediatePropagation();
        var vid = vidBtn.getAttribute('data-vid');
        if (vid) add([{ id: parseInt(vid, 10), quantity: 1 }], { openDrawer: true, trigger: vidBtn });
        return;
      }

      var upsellBtn = t.closest('[data-somna-upsell-add]');
      if (upsellBtn) {
        e.preventDefault();
        e.stopImmediatePropagation();
        var card = upsellBtn.closest('.cart-drawer__upsell-card, .cart-drawer__upsell');
        var id = upsellBtn.getAttribute('data-somna-upsell-add');
        if (!id) return;
        var item = { id: parseInt(id, 10), quantity: 1 };
        var plan = getSelectedPlan(card);
        if (plan) item.selling_plan = plan;
        add([item], { openDrawer: false, trigger: upsellBtn });
        return;
      }

      var addonBtn = t.closest('[data-spsb-add], [data-spdp-add]');
      if (addonBtn) {
        e.preventDefault();
        e.stopImmediatePropagation();
        var addonScope = addonBtn.closest('.spdp-addon, .cart-drawer__upsell-card');
        var addonId = addonBtn.getAttribute('data-spsb-add') || addonBtn.getAttribute('data-spdp-add');
        if (!addonId) return;
        var addonItem = { id: parseInt(addonId, 10), quantity: 1 };
        var addonPlan = getSelectedPlan(addonScope) || getSelectedPlan(addonBtn);
        if (addonPlan) addonItem.selling_plan = addonPlan;
        add([addonItem], { openDrawer: true, trigger: addonBtn });
        return;
      }

      var cta = t.closest('.spsb-cta,.spdp-cta,[id$="-stickycta"]');
      if (cta) {
        var r2 = cta.closest('[id^="shopify-section-"]');
        if (!r2) return;
        var opt = r2.querySelector('[data-bundle].sel') || r2.querySelector('[data-bundle]');
        if (!opt) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        addFromBundleOpt(opt, { openDrawer: true, trigger: cta });
      }
    },
    true
  );

  document.addEventListener('change', function (e) {
    var select = e.target.closest('[data-cart-line-plan]');
    if (!select) return;
    var line = parseInt(select.getAttribute('data-cart-line-plan'), 10);
    var qty = parseInt(select.getAttribute('data-line-qty'), 10) || 1;
    var planId = select.value ? parseInt(select.value, 10) : null;
    if (!line) return;
    select.disabled = true;
    changeLinePlan(line, planId, qty).finally(function () {
      select.disabled = false;
    });
  });

  window.SomnaCart = {
    add: add,
    addFromBundleOpt: addFromBundleOpt,
    refreshDrawer: refreshDrawer,
    openDrawer: openDrawer,
    toggleDrawer: toggleDrawer,
    updateCartCounts: updateCartCounts,
    changeLinePlan: changeLinePlan,
  };

  window.cdaAdd = function (vid, sellingPlan) {
    var item = { id: parseInt(vid, 10), quantity: 1 };
    if (sellingPlan) item.selling_plan = parseInt(sellingPlan, 10);
    return add([item], { openDrawer: true });
  };
})();

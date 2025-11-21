// ==UserScript==
// @name         Capital One Shopping - Show Full Trip Info
// @namespace    https://github.com/lupohan44/c1s_full_trip_info
// @version      0.1
// @description  Show all trip_orders API fields on the Shopping Trips page and allow exporting JSON.
// @author       lupohan44
// @match        https://capitaloneshopping.com/account-settings/shopping-trips
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const API_BASE = '/api/v1/trip_orders';
  const LIMIT = 50;

  // ---- Helpers ----

  function waitForTripsContainer() {
    const selector = '.cashback-trips-page .shopping-trips-container';
    const existing = document.querySelector(selector);
    if (existing) return Promise.resolve(existing);

    return new Promise(resolve => {
      const obs = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    });
  }

  async function fetchAllTrips() {
    const allItems = [];
    let offset = 0;

    while (true) {
      const url = `${API_BASE}?limit=${LIMIT}&offset=${offset}&sort=desc`;
      console.log('[C1S userscript] Fetching', url);

      let resp;
      try {
        resp = await fetch(url, {
          method: 'GET',
          credentials: 'include' // send cookies/session
        });
      } catch (e) {
        console.error('[C1S userscript] fetch error', e);
        break;
      }

      if (!resp.ok) {
        console.error('[C1S userscript] non-OK response', resp.status);
        break;
      }

      const data = await resp.json();
      const items = data.items || [];
      allItems.push(...items);

      if (items.length < LIMIT) break; // no more pages
      offset += LIMIT;
    }

    console.log('[C1S userscript] total items fetched', allItems.length);
    return allItems;
  }

  function buildTripMap(items) {
    const map = Object.create(null);
    for (const it of items) {
      if (it.tripId) map[it.tripId] = it;
      if (it.id && !map[it.id]) map[it.id] = it;
      if (it.orderId && !map[it.orderId]) map[it.orderId] = it;
    }
    return map;
  }

  function formatMoney(amount, currency) {
    if (amount == null) return '—';
    try {
      if (typeof Intl !== 'undefined' && Intl.NumberFormat) {
        return new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: currency || 'USD'
        }).format(amount);
      }
    } catch (e) {
      // fall through to simple format
    }
    return (currency || '') + ' ' + amount.toFixed(2);
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  }

  // Inject extra info under each visible row
  function decorateRows(tripMap) {
    const rows = document.querySelectorAll(
      '.cashback-trip-container .trip-row-body'
    );
    rows.forEach(row => {
      if (row.dataset.c1sEnhanced === '1') return;

      const idElem = row.querySelector('.trip-number-content');
      if (!idElem) return;

      const key = idElem.textContent.trim();
      const info = tripMap[key];
      if (!info) return;

      row.dataset.c1sEnhanced = '1';

      const extra = document.createElement('div');
      extra.className = 'c1s-extra-info';
      extra.style.fontSize = '11px';
      extra.style.color = '#555';
      extra.style.marginTop = '4px';
      extra.style.borderTop = '1px dashed #ddd';
      extra.style.paddingTop = '3px';
      extra.style.display = 'grid';
      extra.style.gridTemplateColumns = 'repeat(3, auto)';
      extra.style.gap = '2px 16px';

      const status = info.status || '—';
      const orderId = info.orderId || '—';
      const domain = info.domain || '—';
      const orderAmt = formatMoney(info.orderAmount, info.orderCurrency);
      const creditAmt = formatMoney(info.creditAmount, info.creditCurrency);
      const createdAt = formatDate(info.createdAt);

      extra.innerHTML = `
        <div><strong>Status:</strong> ${status}</div>
        <div><strong>Order ID:</strong> ${orderId}</div>
        <div><strong>Domain:</strong> ${domain}</div>
        <div><strong>Order Amount:</strong> ${orderAmt}</div>
        <div><strong>Credit Amount:</strong> ${creditAmt}</div>
        <div><strong>Created At (API):</strong> ${createdAt}</div>
      `;

      // Optional: little "Raw" link to log JSON for this row
      const rawLink = document.createElement('a');
      rawLink.textContent = 'Raw JSON → console';
      rawLink.href = 'javascript:void(0)';
      rawLink.style.fontSize = '10px';
      rawLink.style.textDecoration = 'underline';
      rawLink.style.marginTop = '2px';
      rawLink.addEventListener('click', () => {
        console.log('[C1S userscript] trip raw JSON', info);
        alert('Raw JSON logged to console (F12 → Console).');
      });

      const wrapper = document.createElement('div');
      wrapper.style.gridColumn = '1 / -1';
      wrapper.appendChild(rawLink);
      extra.appendChild(wrapper);

      row.appendChild(extra);
    });
  }

  function addExportButton(allItems) {
    const btn = document.createElement('button');
    btn.textContent = 'Download Trip JSON';
    btn.style.position = 'fixed';
    btn.style.zIndex = '99999';
    btn.style.bottom = '12px';
    btn.style.right = '12px';
    btn.style.padding = '6px 10px';
    btn.style.fontSize = '12px';
    btn.style.background = '#1a73e8';
    btn.style.color = '#fff';
    btn.style.border = 'none';
    btn.style.borderRadius = '4px';
    btn.style.cursor = 'pointer';
    btn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';

    btn.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(allItems, null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'c1s_trip_orders.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    document.body.appendChild(btn);
  }

  // ---- Main ----

  (async function main() {
    try {
      const container = await waitForTripsContainer();
      const allItems = await fetchAllTrips();
      const tripMap = buildTripMap(allItems);

      decorateRows(tripMap);
      addExportButton(allItems);

      // In case you click "View More Shopping Trips" and more rows are added
      const obs = new MutationObserver(() => {
        decorateRows(tripMap);
      });
      obs.observe(container, { childList: true, subtree: true });

      console.log('[C1S userscript] enhancement active');
    } catch (e) {
      console.error('[C1S userscript] init error', e);
    }
  })();
})();

/*
 * Tech Grid — admin dashboard.
 *
 * Authenticates with the Supabase service_role key. The key is stored only
 * in sessionStorage (cleared on tab close). It bypasses RLS, so handle with
 * the same care as a database admin password.
 */
(function () {
  'use strict';

  const SS_URL = 'tgg.adm.url';
  const SS_KEY = 'tgg.adm.key';

  let SB = null;
  let categories = [];   // [{id, name, ...}]
  let productCounts = {}; // categoryId -> count

  // ---------- Supabase REST helper ------------------------------
  function makeClient(url, key) {
    const headers = {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    async function request(path, opts) {
      const res = await fetch(url + path, Object.assign({ headers }, opts || {}));
      if (!res.ok) throw new Error(await res.text());
      const txt = await res.text();
      return txt ? JSON.parse(txt) : null;
    }
    return {
      rpc(fn, args) {
        return request('/rest/v1/rpc/' + fn, {
          method: 'POST',
          body: JSON.stringify(args || {})
        });
      },
      select(table, query) {
        return request('/rest/v1/' + table + (query ? '?' + query : ''));
      },
      update(table, query, body) {
        return request('/rest/v1/' + table + '?' + query, {
          method: 'PATCH',
          headers: Object.assign({}, headers, { 'Prefer': 'return=representation' }),
          body: JSON.stringify(body)
        });
      }
    };
  }

  // ---------- DOM helpers ---------------------------------------
  const $ = (s) => document.querySelector(s);
  function el(tag, props, kids) {
    const e = document.createElement(tag);
    if (props) for (const k in props) {
      if (k === 'class') e.className = props[k];
      else if (k === 'text') e.textContent = props[k];
      else if (k === 'html') e.innerHTML = props[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), props[k]);
      else e.setAttribute(k, props[k]);
    }
    (kids || []).forEach(k => k && e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k));
    return e;
  }
  function toast(msg, kind) {
    const t = $('#adm-toast');
    t.textContent = msg;
    t.style.color = kind === 'error' ? '#fca5a5' : kind === 'good' ? '#86efac' : '';
    t.classList.add('is-shown');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('is-shown'), 2800);
  }

  // ---------- Init / auth ---------------------------------------
  function bindLogin() {
    const url = sessionStorage.getItem(SS_URL);
    const key = sessionStorage.getItem(SS_KEY);
    if (url) $('#adm-url').value = url;
    if (key) $('#adm-key').value = key;
    $('#adm-unlock').addEventListener('click', tryUnlock);
    $('#adm-key').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
  }

  async function tryUnlock() {
    const url = $('#adm-url').value.trim().replace(/\/$/, '');
    const key = $('#adm-key').value.trim();
    if (!url || !key) { toast('Enter both URL and key.', 'error'); return; }
    const client = makeClient(url, key);
    try {
      // Probe: this endpoint requires service_role permissions.
      await client.select('categories', 'select=id&limit=1');
    } catch (err) {
      console.error(err); toast('Connection failed — check URL/key.', 'error');
      return;
    }
    SB = client;
    sessionStorage.setItem(SS_URL, url);
    sessionStorage.setItem(SS_KEY, key);
    $('#adm-login').classList.add('adm-hidden');
    $('#adm-app').classList.remove('adm-hidden');
    $('#adm-conn').textContent = 'connected';
    $('#adm-conn').classList.add('is-on');
    initApp();
  }

  function bindTabs() {
    document.querySelectorAll('.adm-tab').forEach(t => {
      t.addEventListener('click', () => {
        document.querySelectorAll('.adm-tab').forEach(x => x.classList.toggle('is-active', x === t));
        const name = t.getAttribute('data-tab');
        document.querySelectorAll('.adm-pane').forEach(p =>
          p.classList.toggle('is-active', p.getAttribute('data-pane') === name));
      });
    });
  }

  // ---------- App ------------------------------------------------
  async function initApp() {
    bindTabs();
    $('#adm-refresh-mappings').addEventListener('click', refreshMappings);
    $('#adm-future-load').addEventListener('click', () => {
      const d = $('#adm-future-date').value;
      if (!d) { toast('Pick a date.', 'error'); return; }
      renderEditor('#adm-future', d);
    });

    const cats = await SB.select('categories', 'select=id,name,description,is_active&order=name.asc&limit=500');
    categories = cats.filter(c => c.is_active);

    // Count products per category
    const pcs = await SB.select('product_categories', 'select=category_id&limit=20000');
    productCounts = pcs.reduce((acc, x) => {
      acc[x.category_id] = (acc[x.category_id] || 0) + 1;
      return acc;
    }, {});

    const today = todayET();
    const tomorrow = addDays(today, 1);
    renderEditor('#adm-today', today);
    renderEditor('#adm-tomorrow', tomorrow);

    // Catalog stats
    const productsCount = await SB.select('products', 'select=id&is_active=eq.true&limit=10000');
    $('#adm-catalog-stats').textContent =
      `${productsCount.length} active products · ${categories.length} active categories · ${pcs.length} mappings`;
  }

  // ---------- Puzzle editor for a given date -------------------
  async function renderEditor(rootSel, dateStr) {
    const host = $(rootSel);
    host.innerHTML = '<div class="adm-mut">Loading…</div>';

    // Fetch existing puzzle for that date (admins ignore RLS, so any draft visible)
    let puzzle = null;
    try {
      const res = await SB.select('puzzles', `select=*&puzzle_date=eq.${dateStr}&limit=1`);
      puzzle = res[0] || null;
    } catch (err) { console.error(err); }

    if (!puzzle) {
      host.innerHTML = '';
      const card = el('div', { class: 'adm-card' }, [
        el('h2', { text: 'No puzzle for ' + dateStr + ' yet' }),
        el('p',  { text: 'Create one automatically (random valid combination) or build manually below.' }),
        el('button', { class: 'adm-btn adm-btn--primary', text: 'Generate now', onclick: async () => {
          try {
            await SB.rpc('generate_puzzle_for_date', { target_date: dateStr });
            toast('Puzzle generated.', 'good');
            renderEditor(rootSel, dateStr);
          } catch (err) { console.error(err); toast('Generation failed: ' + err.message, 'error'); }
        }}),
        el('button', { class: 'adm-btn', text: 'Build manually', onclick: () => {
          const blank = { id: null, puzzle_date: dateStr, row_categories: [null,null,null], col_categories: [null,null,null], status: 'draft' };
          renderManualEditor(host, blank);
        }})
      ]);
      host.appendChild(card);
      return;
    }
    renderManualEditor(host, puzzle);
  }

  function renderManualEditor(host, puzzle) {
    host.innerHTML = '';
    const card = el('div', { class: 'adm-card' });
    card.appendChild(el('h2', { text: 'Puzzle for ' + puzzle.puzzle_date + (puzzle.status === 'draft' ? ' (draft)' : '') }));
    card.appendChild(el('p',  { text: 'Pick a category for each row and column. The cell preview shows how many products satisfy each intersection (need ≥ 3).' }));

    // Working copy
    const draft = {
      row: puzzle.row_categories ? puzzle.row_categories.slice() : [null, null, null],
      col: puzzle.col_categories ? puzzle.col_categories.slice() : [null, null, null]
    };

    const grid = el('div', { class: 'adm-grid' });
    function rebuildGrid() {
      grid.innerHTML = '';
      grid.appendChild(el('div'));
      for (let c = 0; c < 3; c++) grid.appendChild(buildCatSelect('col', c, draft));
      for (let r = 0; r < 3; r++) {
        grid.appendChild(buildCatSelect('row', r, draft));
        for (let c = 0; c < 3; c++) grid.appendChild(buildPreviewCell(draft, r, c));
      }
    }
    function buildCatSelect(axis, idx, d) {
      const sel = el('select', {});
      sel.appendChild(el('option', { value: '', text: '— pick category —' }));
      categories.forEach(cat => {
        const opt = el('option', { value: cat.id, text: cat.name + ' (' + (productCounts[cat.id] || 0) + ')' });
        if (d[axis][idx] === cat.id) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => {
        d[axis][idx] = sel.value || null;
        rebuildGrid();
      });
      return sel;
    }
    function buildPreviewCell(d, r, c) {
      const cell = el('div', { class: 'adm-cell' });
      const rowId = d.row[r], colId = d.col[c];
      if (!rowId || !colId) {
        cell.appendChild(el('div', { class: 'adm-cell-title', text: '–' }));
        return cell;
      }
      cell.appendChild(el('div', { class: 'adm-cell-title', text: 'Loading…' }));
      // Async fetch product list for this intersection
      (async () => {
        try {
          // Fetch product IDs for both categories, intersect
          const a = await SB.select('product_categories', 'select=product_id&category_id=eq.' + rowId + '&limit=1000');
          const b = await SB.select('product_categories', 'select=product_id&category_id=eq.' + colId + '&limit=1000');
          const setB = new Set(b.map(x => x.product_id));
          const ids = a.map(x => x.product_id).filter(id => setB.has(id));
          if (!ids.length) {
            cell.classList.add('adm-cell--bad');
            cell.innerHTML = '';
            cell.appendChild(el('div', { class: 'adm-cell-title', text: '0 products' }));
            cell.appendChild(el('div', { class: 'adm-cell-list', text: 'No valid answers — pick a different category.' }));
            return;
          }
          const names = await SB.select('products', 'select=name&id=in.(' + ids.slice(0, 30).join(',') + ')&order=name.asc');
          cell.innerHTML = '';
          cell.appendChild(el('div', { class: 'adm-cell-title', text: ids.length + ' products' }));
          cell.appendChild(el('div', { class: 'adm-cell-list', text: names.map(n => n.name).join(', ') + (ids.length > 30 ? '…' : '') }));
          if (ids.length >= 3) cell.classList.add('adm-cell--ok');
          else cell.classList.add('adm-cell--bad');
        } catch (err) {
          console.error(err);
          cell.innerHTML = '<div class="adm-cell-title">error</div>';
        }
      })();
      return cell;
    }
    rebuildGrid();
    card.appendChild(grid);

    // Action buttons
    const actions = el('div', { style: 'margin-top: 12px' }, [
      el('button', { class: 'adm-btn adm-btn--primary', text: 'Save changes', onclick: () => save(puzzle, draft, false) }),
      el('button', { class: 'adm-btn', text: 'Save & publish', onclick: () => save(puzzle, draft, true) }),
      el('button', { class: 'adm-btn', text: 'Regenerate randomly', onclick: () => regenerate(puzzle.puzzle_date) }),
    ]);
    card.appendChild(actions);

    host.appendChild(card);
  }

  async function save(puzzle, draft, publish) {
    if (draft.row.includes(null) || draft.col.includes(null)) {
      toast('Pick all 6 categories first.', 'error'); return;
    }
    const body = {
      row_categories: draft.row,
      col_categories: draft.col,
      status: publish ? 'published' : (puzzle.status || 'draft'),
      updated_at: new Date().toISOString()
    };
    try {
      if (puzzle.id) {
        await SB.update('puzzles', 'id=eq.' + puzzle.id, body);
      } else {
        // Insert (admin)
        body.puzzle_date = puzzle.puzzle_date;
        const url = sessionStorage.getItem(SS_URL);
        const key = sessionStorage.getItem(SS_KEY);
        await fetch(url + '/rest/v1/puzzles', {
          method: 'POST',
          headers: {
            'apikey': key, 'Authorization': 'Bearer ' + key,
            'Content-Type': 'application/json', 'Prefer': 'return=representation'
          },
          body: JSON.stringify(body)
        }).then(r => { if (!r.ok) return r.text().then(t => Promise.reject(new Error(t))); });
      }
      toast('Saved.', 'good');
    } catch (err) { console.error(err); toast('Save failed: ' + err.message, 'error'); }
  }

  async function regenerate(dateStr) {
    if (!confirm('Replace the puzzle for ' + dateStr + ' with a new random one? Existing player results for this date will keep referencing the new categories — only do this if no one has played yet.')) return;
    try {
      // Delete existing then generate
      const url = sessionStorage.getItem(SS_URL);
      const key = sessionStorage.getItem(SS_KEY);
      await fetch(url + '/rest/v1/puzzles?puzzle_date=eq.' + dateStr, {
        method: 'DELETE',
        headers: { 'apikey': key, 'Authorization': 'Bearer ' + key }
      });
      await SB.rpc('generate_puzzle_for_date', { target_date: dateStr });
      toast('Regenerated.', 'good');
      // re-render the appropriate pane
      const todayStr = todayET();
      const tomorrowStr = addDays(todayStr, 1);
      if (dateStr === todayStr) renderEditor('#adm-today', dateStr);
      else if (dateStr === tomorrowStr) renderEditor('#adm-tomorrow', dateStr);
      else renderEditor('#adm-future', dateStr);
    } catch (err) { console.error(err); toast('Regenerate failed: ' + err.message, 'error'); }
  }

  async function refreshMappings() {
    $('#adm-refresh-mappings').disabled = true;
    try {
      await SB.rpc('refresh_product_categories', {});
      toast('Mappings refreshed.', 'good');
      // Re-fetch product counts
      const pcs = await SB.select('product_categories', 'select=category_id&limit=20000');
      productCounts = pcs.reduce((a, x) => (a[x.category_id] = (a[x.category_id] || 0) + 1, a), {});
    } catch (err) { console.error(err); toast('Refresh failed.', 'error'); }
    $('#adm-refresh-mappings').disabled = false;
  }

  // ---------- Date helpers (Eastern Time) ----------------------
  function todayET() {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
    return fmt.format(new Date()); // YYYY-MM-DD
  }
  function addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  }

  // ---------- Boot ----------------------------------------------
  document.addEventListener('DOMContentLoaded', bindLogin);
})();

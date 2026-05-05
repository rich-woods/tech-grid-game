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
  const PAGE_SIZE = 50;

  let SB = null;
  let categories = [];     // active-only, used by puzzle editor selects
  let productCounts = {};  // category_id -> count

  const prodState = {
    search: '', kind: '', onlyActive: true,
    page: 0, total: 0, pageSize: 50, initialized: false,
    selected: new Set(),       // ids of currently-selected products
    lastVisibleIds: []         // ids on the page currently displayed
  };
  const catState  = { initialized: false };
  const modalState = { onSave: null, onDelete: null };

  // ---------- Supabase REST helper ------------------------------
  function makeClient(url, key) {
    const baseHeaders = {
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    async function fetchRaw(path, opts) {
      const r = await fetch(url + path, Object.assign({ headers: baseHeaders }, opts || {}));
      if (!r.ok) {
        const text = await r.text();
        throw new Error(text || r.statusText);
      }
      return r;
    }
    async function fetchJson(path, opts) {
      const r = await fetchRaw(path, opts);
      const txt = await r.text();
      return txt ? JSON.parse(txt) : null;
    }
    return {
      url, key,
      rpc(fn, args) {
        return fetchJson('/rest/v1/rpc/' + fn, {
          method: 'POST',
          body: JSON.stringify(args || {})
        });
      },
      select(table, query) {
        return fetchJson('/rest/v1/' + table + (query ? '?' + query : ''));
      },
      // select with total count via Content-Range
      async selectWithCount(table, query) {
        const headers = Object.assign({}, baseHeaders, { 'Prefer': 'count=exact' });
        const r = await fetch(url + '/rest/v1/' + table + (query ? '?' + query : ''), { headers });
        if (!r.ok) throw new Error(await r.text());
        const txt = await r.text();
        const data = txt ? JSON.parse(txt) : [];
        const range = r.headers.get('Content-Range') || '';
        const m = range.match(/\/(\d+|\*)$/);
        const total = (m && m[1] !== '*') ? parseInt(m[1]) : data.length;
        return { data, total };
      },
      insert(table, body) {
        return fetchJson('/rest/v1/' + table, {
          method: 'POST',
          headers: Object.assign({}, baseHeaders, { 'Prefer': 'return=representation' }),
          body: JSON.stringify(body)
        });
      },
      update(table, query, body) {
        return fetchJson('/rest/v1/' + table + '?' + query, {
          method: 'PATCH',
          headers: Object.assign({}, baseHeaders, { 'Prefer': 'return=representation' }),
          body: JSON.stringify(body)
        });
      },
      delete(table, query) {
        return fetchJson('/rest/v1/' + table + '?' + query, { method: 'DELETE' });
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
    t._timer = setTimeout(() => t.classList.remove('is-shown'), 3000);
  }
  function slugify(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  }
  function parseCommaArray(s) {
    return (s || '').split(',').map(x => x.trim()).filter(Boolean);
  }

  // ---------- Form widgets --------------------------------------
  function formField(name, label, type, value, required, help) {
    const lab = el('label', { class: 'adm-form-row' });
    lab.appendChild(el('span', { class: 'adm-form-label', text: label + (required ? ' *' : '') }));
    const input = el('input', { name, type, class: 'adm-input' });
    if (value !== undefined && value !== null && value !== '') input.value = String(value);
    if (required) input.required = true;
    lab.appendChild(input);
    if (help) lab.appendChild(el('span', { class: 'adm-help', text: help }));
    return lab;
  }
  function formSelect(name, label, value, options, help) {
    const lab = el('label', { class: 'adm-form-row' });
    lab.appendChild(el('span', { class: 'adm-form-label', text: label }));
    const sel = el('select', { name, class: 'adm-input' });
    options.forEach(([v, l]) => {
      const opt = el('option', { value: v, text: l });
      if (v === value) opt.selected = true;
      sel.appendChild(opt);
    });
    lab.appendChild(sel);
    if (help) lab.appendChild(el('span', { class: 'adm-help', text: help }));
    return lab;
  }
  function formCheckbox(name, label, value) {
    const lab = el('label', { class: 'adm-form-row adm-form-row--inline' });
    const cb = el('input', { name, type: 'checkbox' });
    if (value) cb.checked = true;
    lab.appendChild(cb);
    lab.appendChild(el('span', { class: 'adm-form-label', text: label }));
    return lab;
  }

  // ---------- Modal ---------------------------------------------
  function bindModal() {
    $('#adm-modal-cancel').addEventListener('click', closeModal);
    $('#adm-modal-save').addEventListener('click', () => {
      if (modalState.onSave) modalState.onSave();
    });
    $('#adm-modal-delete').addEventListener('click', () => {
      if (modalState.onDelete) modalState.onDelete();
    });
    $('#adm-modal').addEventListener('click', (e) => {
      if (e.target.id === 'adm-modal') closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('#adm-modal').classList.contains('is-open')) closeModal();
    });
  }
  function openModal({ title, body, onSave, onDelete }) {
    $('#adm-modal-title').textContent = title;
    const bodyEl = $('#adm-modal-body');
    bodyEl.innerHTML = '';
    bodyEl.appendChild(body);
    modalState.onSave = onSave;
    modalState.onDelete = onDelete || null;
    $('#adm-modal-delete').style.display = onDelete ? '' : 'none';
    $('#adm-modal').classList.add('is-open');
  }
  function closeModal() {
    $('#adm-modal').classList.remove('is-open');
    modalState.onSave = null;
    modalState.onDelete = null;
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

        if (name === 'products' && !prodState.initialized) {
          prodState.initialized = true;
          bindProductFilters();
          loadProducts();
        } else if (name === 'categories' && !catState.initialized) {
          catState.initialized = true;
          loadCategories();
        }
      });
    });
  }

  // ---------- App boot ------------------------------------------
  async function initApp() {
    bindTabs();
    bindModal();
    $('#adm-refresh-mappings').addEventListener('click', refreshMappings);
    $('#adm-cat-new').addEventListener('click', () => openCategoryEditor(null));
    $('#adm-future-load').addEventListener('click', () => {
      const d = $('#adm-future-date').value;
      if (!d) { toast('Pick a date.', 'error'); return; }
      renderEditor('#adm-future', d);
    });

    // Cache categories + product counts (used by puzzle editor selects + product editor checkboxes)
    const cats = await SB.select('categories', 'select=id,name,description,rule,is_active&order=name.asc&limit=500');
    categories = cats.filter(c => c.is_active);

    const pcs = await SB.select('product_categories', 'select=category_id&limit=50000');
    productCounts = pcs.reduce((acc, x) => {
      acc[x.category_id] = (acc[x.category_id] || 0) + 1;
      return acc;
    }, {});

    const today = todayET();
    const tomorrow = addDays(today, 1);
    renderEditor('#adm-today', today);
    renderEditor('#adm-tomorrow', tomorrow);
  }

  // ===============================================================
  // Puzzle editor (today / tomorrow / future)
  // ===============================================================
  async function renderEditor(rootSel, dateStr) {
    const host = $(rootSel);
    host.innerHTML = '<div class="adm-mut">Loading…</div>';
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
      (async () => {
        try {
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
        body.puzzle_date = puzzle.puzzle_date;
        await SB.insert('puzzles', body);
      }
      toast('Saved.', 'good');
    } catch (err) { console.error(err); toast('Save failed: ' + err.message, 'error'); }
  }

  async function regenerate(dateStr) {
    if (!confirm('Replace the puzzle for ' + dateStr + ' with a new random one? Existing player results for this date will keep referencing the new categories — only do this if no one has played yet.')) return;
    try {
      await SB.delete('puzzles', 'puzzle_date=eq.' + dateStr);
      await SB.rpc('generate_puzzle_for_date', { target_date: dateStr });
      toast('Regenerated.', 'good');
      const todayStr = todayET();
      const tomorrowStr = addDays(todayStr, 1);
      if (dateStr === todayStr) renderEditor('#adm-today', dateStr);
      else if (dateStr === tomorrowStr) renderEditor('#adm-tomorrow', dateStr);
      else renderEditor('#adm-future', dateStr);
    } catch (err) { console.error(err); toast('Regenerate failed: ' + err.message, 'error'); }
  }

  async function refreshMappings() {
    const btn = $('#adm-refresh-mappings');
    btn.disabled = true;
    try {
      await SB.rpc('refresh_product_categories', {});
      toast('Mappings refreshed.', 'good');
      const pcs = await SB.select('product_categories', 'select=category_id&limit=50000');
      productCounts = pcs.reduce((a, x) => (a[x.category_id] = (a[x.category_id] || 0) + 1, a), {});
      // refresh categories pane if open
      if (catState.initialized) loadCategories();
    } catch (err) { console.error(err); toast('Refresh failed.', 'error'); }
    btn.disabled = false;
  }

  // ===============================================================
  // Products tab
  // ===============================================================
  function bindProductFilters() {
    let timer = null;
    $('#adm-prod-search').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        prodState.search = $('#adm-prod-search').value.trim();
        prodState.page = 0;
        clearSelection();
        loadProducts();
      }, 250);
    });
    $('#adm-prod-kind').addEventListener('change', () => {
      prodState.kind = $('#adm-prod-kind').value;
      prodState.page = 0;
      clearSelection();
      loadProducts();
    });
    $('#adm-prod-only-active').addEventListener('change', () => {
      prodState.onlyActive = $('#adm-prod-only-active').checked;
      prodState.page = 0;
      clearSelection();
      loadProducts();
    });
    $('#adm-prod-pagesize').addEventListener('change', () => {
      const v = $('#adm-prod-pagesize').value;
      prodState.pageSize = (v === 'all') ? 'all' : parseInt(v);
      prodState.page = 0;
      clearSelection();
      loadProducts();
    });
    $('#adm-prod-new').addEventListener('click', () => openProductEditor(null));
  }

  function clearSelection() {
    prodState.selected.clear();
    renderBulkBar();
  }

  async function loadProducts() {
    const host = $('#adm-prod-list');
    host.innerHTML = '<div class="adm-mut" style="padding:14px">Loading…</div>';
    const { search, kind, onlyActive, page, pageSize } = prodState;
    const qParts = ['select=id,name,slug,manufacturer,kind,release_year,tags,aliases,is_active',
                    'order=name.asc'];
    const limit = pageSize === 'all' ? 10000 : pageSize;
    qParts.push('limit=' + limit);
    if (pageSize !== 'all') qParts.push('offset=' + (page * limit));
    if (search) {
      const s = encodeURIComponent('*' + search + '*');
      qParts.push(`or=(name.ilike.${s},slug.ilike.${s},manufacturer.ilike.${s})`);
    }
    if (kind) qParts.push('kind=eq.' + kind);
    if (onlyActive) qParts.push('is_active=eq.true');
    try {
      const { data, total } = await SB.selectWithCount('products', qParts.join('&'));
      prodState.total = total;
      prodState.lastVisibleIds = data.map(p => p.id);
      renderProductsList(data);
      renderProductsPagination();
      renderBulkBar();
    } catch (err) {
      console.error(err);
      host.innerHTML = '';
      host.appendChild(el('div', { class: 'adm-mut', text: 'Error: ' + err.message }));
    }
  }

  function renderProductsList(rows) {
    const host = $('#adm-prod-list');
    host.innerHTML = '';
    if (!rows.length) {
      host.appendChild(el('div', { class: 'adm-empty', text: 'No products match those filters.' }));
      return;
    }
    const table = el('table', { class: 'adm-table' });

    // Header with select-all checkbox
    const selectAllCb = el('input', { type: 'checkbox', class: 'adm-row-check',
      onchange: (e) => {
        rows.forEach(p => {
          if (e.target.checked) prodState.selected.add(p.id);
          else                  prodState.selected.delete(p.id);
        });
        // re-render rows so per-row checkbox states reflect selection
        document.querySelectorAll('#adm-prod-list .adm-row-check').forEach((cb, i) => {
          if (i > 0) cb.checked = e.target.checked;
        });
        renderBulkBar();
      }
    });
    const thead = el('thead', {}, [
      el('tr', {}, [
        el('th', { class: 'adm-th-check' }, [selectAllCb]),
        el('th', { text: 'Name' }),
        el('th', { text: 'Manufacturer' }),
        el('th', { text: 'Kind' }),
        el('th', { text: 'Year' }),
        el('th', { text: 'Tags' }),
        el('th', { text: '' }),
        el('th', { text: '' })
      ])
    ]);
    table.appendChild(thead);

    const tbody = el('tbody', {});
    rows.forEach(p => {
      const tr = el('tr', { class: p.is_active ? '' : 'is-inactive', onclick: (e) => {
        // ignore clicks on interactive controls so they don't open the editor
        if (e.target.closest('input,button,label')) return;
        openProductEditor(p);
      }});
      const cb = el('input', { type: 'checkbox', class: 'adm-row-check',
        onchange: (e) => {
          if (e.target.checked) prodState.selected.add(p.id);
          else                  prodState.selected.delete(p.id);
          renderBulkBar();
        }
      });
      if (prodState.selected.has(p.id)) cb.checked = true;
      tr.appendChild(el('td', { class: 'adm-td-check' }, [cb]));
      tr.appendChild(el('td', { class: 'adm-cell-name' }, [
        el('div', { class: 'adm-cell-name-main', text: p.name }),
        el('div', { class: 'adm-cell-name-sub', text: p.slug })
      ]));
      tr.appendChild(el('td', { text: p.manufacturer || '—' }));
      tr.appendChild(el('td', { text: p.kind }));
      tr.appendChild(el('td', { text: p.release_year != null ? String(p.release_year) : '—' }));
      tr.appendChild(el('td', { class: 'adm-tag-cell', text: (p.tags || []).slice(0, 4).join(', ') + ((p.tags || []).length > 4 ? ' …' : '') }));
      tr.appendChild(el('td', { class: 'adm-status-cell', text: p.is_active ? '✓' : 'inactive' }));
      tr.appendChild(el('td', { class: 'adm-actions-cell' }, [
        el('button', { class: 'adm-btn adm-btn--ghost adm-btn--sm', text: 'Edit',
          onclick: (e) => { e.stopPropagation(); openProductEditor(p); } }),
        el('button', { class: 'adm-btn adm-btn--ghost adm-btn--sm adm-btn--danger-text', text: 'Delete',
          onclick: (e) => {
            e.stopPropagation();
            if (confirm('Delete "' + p.name + '" permanently? This also clears its guess history.')) {
              deleteProduct(p.id);
            }
          }
        })
      ]));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    host.appendChild(table);
  }

  function renderProductsPagination() {
    const host = $('#adm-prod-pagination');
    host.innerHTML = '';
    const total = prodState.total;
    if (prodState.pageSize === 'all') {
      host.appendChild(el('span', { class: 'adm-mut',
        text: `${total.toLocaleString()} total · showing all (capped at 10,000)` }));
      return;
    }
    const size = prodState.pageSize;
    const pages = Math.max(1, Math.ceil(total / size));
    const stats = el('span', { class: 'adm-mut',
      text: `${total.toLocaleString()} total · page ${prodState.page + 1} of ${pages}` });
    const prev = el('button', { class: 'adm-btn adm-btn--sm', text: '← Prev',
      onclick: () => { if (prodState.page > 0) { prodState.page--; loadProducts(); } }
    });
    const next = el('button', { class: 'adm-btn adm-btn--sm', text: 'Next →',
      onclick: () => { if (prodState.page < pages - 1) { prodState.page++; loadProducts(); } }
    });
    prev.disabled = prodState.page === 0;
    next.disabled = prodState.page >= pages - 1;
    host.appendChild(prev);
    host.appendChild(stats);
    host.appendChild(next);
  }

  // ===============================================================
  // Bulk action bar
  // ===============================================================
  function renderBulkBar() {
    const bar = $('#adm-prod-bulkbar');
    if (!bar) return;
    const n = prodState.selected.size;
    bar.innerHTML = '';
    if (n === 0) { bar.classList.add('adm-hidden'); return; }
    bar.classList.remove('adm-hidden');
    bar.appendChild(el('span', { class: 'adm-bulk-count', text: n + ' selected' }));
    bar.appendChild(el('button', { class: 'adm-btn adm-btn--sm', text: 'Activate',
      onclick: () => bulkSetActive(true) }));
    bar.appendChild(el('button', { class: 'adm-btn adm-btn--sm', text: 'Deactivate',
      onclick: () => bulkSetActive(false) }));
    bar.appendChild(el('button', { class: 'adm-btn adm-btn--sm', text: 'Add to category…',
      onclick: () => openBulkCategoryPicker(true) }));
    bar.appendChild(el('button', { class: 'adm-btn adm-btn--sm', text: 'Remove from category…',
      onclick: () => openBulkCategoryPicker(false) }));
    bar.appendChild(el('button', { class: 'adm-btn adm-btn--sm adm-btn--danger', text: 'Delete',
      onclick: () => bulkDelete() }));
    bar.appendChild(el('span', { style: 'flex:1' }));
    bar.appendChild(el('button', { class: 'adm-btn adm-btn--ghost adm-btn--sm', text: 'Clear selection',
      onclick: () => { clearSelection(); loadProducts(); } }));
  }

  async function bulkSetActive(active) {
    const ids = Array.from(prodState.selected);
    if (!ids.length) return;
    if (!confirm(`${active ? 'Activate' : 'Deactivate'} ${ids.length} products?`)) return;
    try {
      await SB.update('products', 'id=in.(' + ids.join(',') + ')', { is_active: active });
      toast(`${active ? 'Activated' : 'Deactivated'} ${ids.length} products.`, 'good');
      clearSelection();
      loadProducts();
    } catch (err) {
      console.error(err);
      toast('Failed: ' + err.message.slice(0, 120), 'error');
    }
  }

  async function bulkDelete() {
    const ids = Array.from(prodState.selected);
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} products permanently? This also clears related guess history. Cannot be undone.`)) return;
    try {
      const affected = await SB.rpc('bulk_delete_products', { p_product_ids: ids });
      toast('Deleted ' + (affected || ids.length) + ' products.', 'good');
      clearSelection();
      loadProducts();
    } catch (err) {
      console.error(err);
      toast('Bulk delete failed: ' + err.message.slice(0, 120), 'error');
    }
  }

  function openBulkCategoryPicker(addMode) {
    const tagBased = (categories || []).filter(c => c.rule && Array.isArray(c.rule.tags) && c.rule.tags.length);
    if (!tagBased.length) {
      toast('No tag-based categories defined.', 'error'); return;
    }
    const sorted = tagBased.slice().sort((a, b) => a.name.localeCompare(b.name));
    const body = el('div');
    body.appendChild(el('p', { class: 'adm-mut',
      text: (addMode ? 'Add' : 'Remove') + ' tags from this category to/from ' + prodState.selected.size + ' selected products.' }));
    let pickedId = null;
    const list = el('div', { class: 'adm-bulk-cat-list' });
    sorted.forEach(c => {
      const lab = el('label', { class: 'adm-bulk-cat-row' });
      const radio = el('input', { type: 'radio', name: 'bulk-cat' });
      radio.addEventListener('change', () => { pickedId = c.id; });
      lab.appendChild(radio);
      lab.appendChild(el('span', { class: 'adm-bulk-cat-name', text: c.name }));
      lab.appendChild(el('span', { class: 'adm-bulk-cat-tags', text: '{' + c.rule.tags.join(', ') + '}' }));
      list.appendChild(lab);
    });
    body.appendChild(list);

    openModal({
      title: addMode ? 'Add to category' : 'Remove from category',
      body,
      onSave: async () => {
        if (!pickedId) { toast('Pick a category first.', 'error'); return; }
        const ids = Array.from(prodState.selected);
        try {
          const affected = await SB.rpc('bulk_set_category_membership', {
            p_product_ids: ids, p_category_id: pickedId, p_in_category: addMode
          });
          toast((addMode ? 'Added ' : 'Removed ') + (affected || ids.length) + ' products. Run "Refresh mappings" to apply.', 'good');
          closeModal();
          clearSelection();
          loadProducts();
        } catch (err) {
          console.error(err);
          toast('Failed: ' + err.message.slice(0, 120), 'error');
        }
      }
    });
  }

  function openProductEditor(product) {
    const isNew = !product;
    const p = product || { name: '', slug: '', manufacturer: '', kind: 'hardware', release_year: null, tags: [], aliases: [], is_active: true };

    const form = el('div', { class: 'adm-form' });
    form.appendChild(formField('name', 'Name', 'text', p.name, true));
    form.appendChild(formField('slug', 'Slug', 'text', p.slug, false, isNew ? 'auto-generated from name if blank' : 'careful — changing this can orphan past guesses'));
    form.appendChild(formField('manufacturer', 'Manufacturer', 'text', p.manufacturer || ''));
    form.appendChild(formSelect('kind', 'Kind', p.kind, [['hardware','Hardware'], ['software','Software']]));
    form.appendChild(formField('release_year', 'Release year', 'number', p.release_year));
    form.appendChild(formField('aliases', 'Aliases', 'text', (p.aliases || []).join(', '), false, 'alternate names players might type, e.g. ps5'));
    form.appendChild(formCheckbox('is_active', 'Active (used in puzzles)', p.is_active));

    // ---- Category checkboxes ----
    const tagBased = (categories || []).filter(c => c.rule && Array.isArray(c.rule.tags) && c.rule.tags.length);
    const sortedCats = tagBased.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (sortedCats.length) {
      form.appendChild(el('div', { class: 'adm-form-section', text: 'Categories' }));
      const help = el('div', { class: 'adm-help', style: 'margin: -4px 0 8px',
        text: 'Check categories this product belongs to. (Manufacturer, kind, and year categories auto-apply from the fields above.)' });
      form.appendChild(help);
      const grid = el('div', { class: 'adm-cat-checkboxes' });
      const productTags = new Set(p.tags || []);
      sortedCats.forEach(cat => {
        const ruleTags = cat.rule.tags;
        const checked = ruleTags.some(t => productTags.has(t));
        const wrap = el('label', { class: 'adm-cat-check' });
        const cb = el('input', { type: 'checkbox', name: '__cat_' + cat.id, value: cat.id });
        if (checked) cb.checked = true;
        wrap.appendChild(cb);
        wrap.appendChild(el('span', { text: cat.name }));
        grid.appendChild(wrap);
      });
      form.appendChild(grid);
    }

    openModal({
      title: isNew ? 'Add product' : 'Edit: ' + p.name,
      body: form,
      onSave: () => saveProduct(form, p, sortedCats),
      onDelete: isNew ? null : () => {
        if (confirm('Delete "' + p.name + '" permanently? This also clears related guess history. Cannot be undone.')) {
          deleteProduct(p.id);
        }
      }
    });
  }

  async function saveProduct(form, original, sortedCats) {
    const get = (n) => form.querySelector('[name="' + n + '"]');
    const name = get('name').value.trim();
    if (!name) { toast('Name is required.', 'error'); return; }

    // Derive new tags array from category checkboxes:
    //   - Take the existing tags that aren't "owned" by any tag-based category (preserve them).
    //   - Add every tag from the categories that are now checked.
    const managedTags = new Set();
    sortedCats.forEach(cat => cat.rule.tags.forEach(t => managedTags.add(t)));
    const preserved = (original.tags || []).filter(t => !managedTags.has(t));
    const newTagSet = new Set(preserved);
    sortedCats.forEach(cat => {
      const cb = form.querySelector('[name="__cat_' + cat.id + '"]');
      if (cb && cb.checked) cat.rule.tags.forEach(t => newTagSet.add(t));
    });

    const body = {
      name,
      slug: get('slug').value.trim() || slugify(name),
      manufacturer: get('manufacturer').value.trim() || null,
      kind: get('kind').value,
      release_year: get('release_year').value ? parseInt(get('release_year').value) : null,
      tags: Array.from(newTagSet),
      aliases: parseCommaArray(get('aliases').value),
      is_active: get('is_active').checked
    };
    try {
      if (original.id) await SB.update('products', 'id=eq.' + original.id, body);
      else             await SB.insert('products', body);
      toast('Saved. (Run "Refresh mappings" to apply category changes globally.)', 'good');
      closeModal();
      loadProducts();
    } catch (err) {
      console.error(err);
      toast('Save failed: ' + err.message.slice(0, 120), 'error');
    }
  }

  async function deleteProduct(id) {
    try {
      await SB.delete('guesses', 'product_id=eq.' + id);
      await SB.delete('products', 'id=eq.' + id);
      toast('Deleted.', 'good');
      closeModal();
      loadProducts();
    } catch (err) {
      console.error(err);
      toast('Delete failed: ' + err.message.slice(0, 120), 'error');
    }
  }

  // ===============================================================
  // Categories tab
  // ===============================================================
  async function loadCategories() {
    const host = $('#adm-cat-list');
    host.innerHTML = '<div class="adm-mut" style="padding:14px">Loading…</div>';
    try {
      const cats = await SB.select('categories', 'select=id,name,description,rule,is_active&order=name.asc&limit=500');
      categories = cats.filter(c => c.is_active);  // refresh global cache
      renderCategoriesList(cats);
    } catch (err) {
      console.error(err);
      host.innerHTML = '';
      host.appendChild(el('div', { class: 'adm-mut', text: 'Error: ' + err.message }));
    }
  }

  function renderCategoriesList(rows) {
    const host = $('#adm-cat-list');
    host.innerHTML = '';
    if (!rows.length) {
      host.appendChild(el('div', { class: 'adm-empty', text: 'No categories yet.' }));
      return;
    }
    const grid = el('div', { class: 'adm-cat-grid' });
    rows.forEach(c => {
      const card = el('div', {
        class: 'adm-cat-card' + (c.is_active ? '' : ' is-inactive'),
        onclick: () => openCategoryEditor(c)
      });
      card.appendChild(el('div', { class: 'adm-cat-name', text: c.name }));
      card.appendChild(el('div', { class: 'adm-cat-rule', text: ruleSummary(c.rule) }));
      if (c.description) {
        card.appendChild(el('div', { class: 'adm-cat-desc', text: c.description }));
      }
      const meta = el('div', { class: 'adm-cat-meta' }, [
        el('span', { class: 'adm-mut', text: (productCounts[c.id] || 0) + ' products' }),
        el('span', { class: c.is_active ? 'adm-pill-on' : 'adm-pill-off', text: c.is_active ? 'active' : 'inactive' })
      ]);
      card.appendChild(meta);
      grid.appendChild(card);
    });
    host.appendChild(grid);
  }

  function ruleSummary(rule) {
    if (!rule || Object.keys(rule).length === 0) return '(empty rule — matches nothing)';
    const parts = [];
    if (rule.manufacturer && rule.manufacturer.length) {
      parts.push('mfr ∈ {' + rule.manufacturer.join(', ') + '}');
    }
    if (rule.kind) parts.push('kind = ' + rule.kind);
    if (rule.year_min || rule.year_max) {
      parts.push('year ' + (rule.year_min || '−∞') + '–' + (rule.year_max || '∞'));
    }
    if (rule.tags && rule.tags.length) {
      parts.push('tags ∋ {' + rule.tags.join(', ') + '}');
    }
    return parts.join('  AND  ');
  }

  function openCategoryEditor(category) {
    const isNew = !category;
    const c = category || { name: '', description: '', rule: {}, is_active: true };
    const r = c.rule || {};

    const form = el('div', { class: 'adm-form' });
    form.appendChild(formField('name', 'Name', 'text', c.name, true, 'shown to players as the row/column header'));
    form.appendChild(formField('description', 'Description (admin only)', 'text', c.description || ''));

    form.appendChild(el('div', { class: 'adm-form-section', text: 'Match rule (a product must satisfy ALL specified clauses)' }));
    form.appendChild(formField('r_manufacturer', 'Manufacturer (any of)', 'text',
      (r.manufacturer || []).join(', '), false, 'comma-separated, e.g. Apple, Google'));
    form.appendChild(formSelect('r_kind', 'Kind', r.kind || '',
      [['', '— any —'], ['hardware', 'Hardware'], ['software', 'Software']]));
    form.appendChild(formField('r_year_min', 'Year ≥', 'number', r.year_min ?? ''));
    form.appendChild(formField('r_year_max', 'Year ≤', 'number', r.year_max ?? ''));
    form.appendChild(formField('r_tags', 'Tags (any of)', 'text', (r.tags || []).join(', '),
      false, 'comma-separated, e.g. smartphone, mobile'));
    form.appendChild(formCheckbox('is_active', 'Active (eligible for puzzle generation)', c.is_active));

    openModal({
      title: isNew ? 'Add category' : 'Edit: ' + c.name,
      body: form,
      onSave: () => saveCategory(form, c.id),
      onDelete: isNew ? null : () => {
        if (confirm('Delete "' + c.name + '" permanently? Past puzzles using it will keep dangling references.')) {
          deleteCategory(c.id);
        }
      }
    });
  }

  async function saveCategory(form, id) {
    const get = (n) => form.querySelector('[name="' + n + '"]');
    const name = get('name').value.trim();
    if (!name) { toast('Name is required.', 'error'); return; }

    const rule = {};
    const mfrs = parseCommaArray(get('r_manufacturer').value);
    if (mfrs.length) rule.manufacturer = mfrs;
    if (get('r_kind').value) rule.kind = get('r_kind').value;
    if (get('r_year_min').value) rule.year_min = parseInt(get('r_year_min').value);
    if (get('r_year_max').value) rule.year_max = parseInt(get('r_year_max').value);
    const tags = parseCommaArray(get('r_tags').value);
    if (tags.length) rule.tags = tags;

    const body = {
      name,
      description: get('description').value.trim() || null,
      rule,
      is_active: get('is_active').checked
    };
    try {
      if (id) await SB.update('categories', 'id=eq.' + id, body);
      else    await SB.insert('categories', body);
      toast('Saved. Click "Refresh mappings" on the Products tab to apply.', 'good');
      closeModal();
      loadCategories();
    } catch (err) {
      console.error(err);
      toast('Save failed: ' + err.message.slice(0, 120), 'error');
    }
  }

  async function deleteCategory(id) {
    try {
      await SB.delete('categories', 'id=eq.' + id);
      toast('Deleted.', 'good');
      closeModal();
      loadCategories();
    } catch (err) {
      console.error(err);
      toast('Delete failed: ' + err.message.slice(0, 120), 'error');
    }
  }

  // ---------- Date helpers (Eastern Time) ----------------------
  function todayET() {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
    return fmt.format(new Date());
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

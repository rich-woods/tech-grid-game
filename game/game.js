<script>
/*
 * Tech Grid — embeddable daily puzzle game.
 *
 * Mounts into #tech-grid-root (creates the element if missing).
 * Config is hard-coded below; the Supabase anon key is a public key by
 * design, safe to ship in the browser. To swap projects, update the two
 * values in DEFAULT_CONFIG. A host page may also override by setting
 * window.TECH_GRID_CONFIG before this script loads.
 */
(function () {
  'use strict';

  const DEFAULT_CONFIG = {
    supabaseUrl:    'https://hoyjndzedmugrofuohdt.supabase.co',
    supabaseAnonKey:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhveWpuZHplZG11Z3JvZnVvaGR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MTczNzcsImV4cCI6MjA5MzQ5MzM3N30.otWF-43JN1In0YpjKQdz28F-Ja0O-rOJ3Sjwo350ZSM'
  };

  const CONFIG = Object.assign({}, DEFAULT_CONFIG, window.TECH_GRID_CONFIG || {});
  if (!CONFIG.supabaseUrl || !CONFIG.supabaseAnonKey) {
    console.error('[tech-grid] Missing supabaseUrl / supabaseAnonKey');
    return;
  }
  // Tolerate a trailing slash in the configured URL.
  CONFIG.supabaseUrl = CONFIG.supabaseUrl.replace(/\/+$/, '');

  // --------- Tiny Supabase REST helper ----------------------------
  // We avoid the full Supabase JS SDK to keep the embed small.
  const SB = {
    rpc(fn, args) {
      return fetch(CONFIG.supabaseUrl + '/rest/v1/rpc/' + fn, {
        method: 'POST',
        headers: {
          'apikey': CONFIG.supabaseAnonKey,
          'Authorization': 'Bearer ' + CONFIG.supabaseAnonKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(args || {})
      }).then(r => r.ok ? r.json() : r.text().then(t => Promise.reject(new Error(t))));
    },
    select(table, query) {
      const url = CONFIG.supabaseUrl + '/rest/v1/' + table + (query ? '?' + query : '');
      return fetch(url, {
        headers: {
          'apikey': CONFIG.supabaseAnonKey,
          'Authorization': 'Bearer ' + CONFIG.supabaseAnonKey,
          'Accept': 'application/json'
        }
      }).then(r => r.ok ? r.json() : r.text().then(t => Promise.reject(new Error(t))));
    }
  };

  // --------- Player ID (anonymous, persistent) --------------------
  const PLAYER_KEY = 'tgg.player.v1';
  function getPlayerId() {
    let id = localStorage.getItem(PLAYER_KEY);
    if (!id) {
      id = (crypto.randomUUID && crypto.randomUUID()) ||
           ('xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
             const r = Math.random() * 16 | 0;
             return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
           }));
      localStorage.setItem(PLAYER_KEY, id);
    }
    return id;
  }

  // Local mirror of player stats so the UI can render before the network responds
  const STATS_KEY = 'tgg.stats.v1';
  function loadStats() {
    try { return JSON.parse(localStorage.getItem(STATS_KEY)) || defaultStats(); }
    catch (_) { return defaultStats(); }
  }
  function defaultStats() {
    return { gamesPlayed: 0, perfect: 0, currentStreak: 0, maxStreak: 0,
             totalCorrect: 0, lastPlayed: null, displayName: '' };
  }
  function saveStats(s) { localStorage.setItem(STATS_KEY, JSON.stringify(s)); }

  const PROGRESS_KEY = (puzzleId) => 'tgg.progress.' + puzzleId;
  function loadProgress(puzzleId) {
    try { return JSON.parse(localStorage.getItem(PROGRESS_KEY(puzzleId))) || {}; }
    catch (_) { return {}; }
  }
  function saveProgress(puzzleId, p) {
    localStorage.setItem(PROGRESS_KEY(puzzleId), JSON.stringify(p));
  }

  // --------- DOM helpers -----------------------------------------
  const $ = (sel, root) => (root || document).querySelector(sel);
  function el(tag, props, kids) {
    const e = document.createElement(tag);
    if (props) Object.keys(props).forEach(k => {
      if (k === 'class') e.className = props[k];
      else if (k === 'text') e.textContent = props[k];
      else if (k === 'html') e.innerHTML = props[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), props[k]);
      else e.setAttribute(k, props[k]);
    });
    (kids || []).forEach(k => k && e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k));
    return e;
  }

  // --------- State ------------------------------------------------
  const state = {
    playerId: getPlayerId(),
    puzzle: null,           // { id, date, rows:[{id,name}], cols:[{id,name}] }
    progress: {},           // { "r,c": { is_correct, product_name, rarity, percent } }
    stats: loadStats(),
    activePane: 'play',
    activeCell: null,       // { r, c }
    finalized: false,
    searchCache: new Map()  // q -> array of suggestions, capped to 100 entries
  };

  // --------- Rendering -------------------------------------------
  function mount() {
    let root = document.getElementById('tech-grid-root');
    if (!root) { root = el('div', { id: 'tech-grid-root' }); document.body.appendChild(root); }
    root.innerHTML = '';
    root.classList.add('tgg-root');

    root.appendChild(el('div', { class: 'tgg-header' }, [
      el('div', { class: 'tgg-title' }, [
        'Tech Grid',
        el('small', { text: state.puzzle ? formatDate(state.puzzle.date) : 'Loading…' })
      ]),
      buildTabs()
    ]));

    root.appendChild(buildPane('play', buildBoard()));
    root.appendChild(buildPane('stats', buildStats()));
    root.appendChild(buildPane('leaders', buildLeaderboardPlaceholder()));

    root.appendChild(buildModal());
    root.appendChild(buildFeedbackModal());
    root.appendChild(el('div', { id: 'tgg-toast', class: 'tgg-toast' }));
    root.appendChild(buildFooter());

    setActivePane(state.activePane);
  }

  function buildFooter() {
    return el('div', { class: 'tgg-footer' }, [
      el('a', {
        class: 'tgg-feedback-link',
        href: '#',
        text: 'Send feedback',
        onclick: (e) => { e.preventDefault(); openFeedbackModal(); }
      })
    ]);
  }

  function buildFeedbackModal() {
    return el('div', { class: 'tgg-modal-bg', id: 'tgg-fb-bg', onclick: (e) => {
      if (e.target.id === 'tgg-fb-bg') closeFeedbackModal();
    } }, [
      el('div', { class: 'tgg-modal' }, [
        el('h3', { text: 'Send feedback' }),
        el('p', { text: 'Tell us what you liked, what broke, what was confusing — anything helps.' }),
        el('input', {
          class: 'tgg-input', id: 'tgg-fb-name', type: 'text',
          placeholder: 'Your name (optional)', maxlength: 80, autocomplete: 'off',
          style: 'margin-bottom:8px'
        }),
        el('input', {
          class: 'tgg-input', id: 'tgg-fb-contact', type: 'email',
          placeholder: 'Email (optional, only if you want a reply)', maxlength: 200,
          autocomplete: 'off', style: 'margin-bottom:8px'
        }),
        (() => {
          const ta = el('textarea', {
            class: 'tgg-input', id: 'tgg-fb-msg', rows: 5, maxlength: 4000,
            placeholder: 'Your feedback…',
            style: 'resize:vertical;font-family:inherit'
          });
          return ta;
        })(),
        el('div', { class: 'tgg-modal-actions' }, [
          el('button', { class: 'tgg-btn tgg-btn--ghost', text: 'Cancel', onclick: closeFeedbackModal }),
          el('button', { class: 'tgg-btn tgg-btn--primary', id: 'tgg-fb-submit', text: 'Send', onclick: submitFeedback })
        ])
      ])
    ]);
  }

  function openFeedbackModal() {
    const name = $('#tgg-fb-name'); if (name) name.value = state.stats.displayName || '';
    const ctc  = $('#tgg-fb-contact'); if (ctc) ctc.value = '';
    const msg  = $('#tgg-fb-msg'); if (msg) msg.value = '';
    $('#tgg-fb-bg').classList.add('is-open');
    setTimeout(() => { const m = $('#tgg-fb-msg'); if (m) m.focus(); }, 0);
  }
  function closeFeedbackModal() {
    $('#tgg-fb-bg').classList.remove('is-open');
  }

  async function submitFeedback() {
    const message = ($('#tgg-fb-msg').value || '').trim();
    if (message.length < 5) { toast('Please write a bit more.'); return; }
    if (message.length > 4000) { toast('Too long — under 4000 characters please.'); return; }
    const btn = $('#tgg-fb-submit');
    btn.disabled = true;
    try {
      const result = await SB.rpc('submit_feedback', {
        p_player_id:    state.playerId,
        p_display_name: ($('#tgg-fb-name').value || '').trim() || state.stats.displayName || null,
        p_contact:      ($('#tgg-fb-contact').value || '').trim() || null,
        p_message:      message,
        p_user_agent:   navigator.userAgent,
        p_page_url:     location.href
      });
      if (result && result.ok) {
        toast('Thanks — feedback received.');
        closeFeedbackModal();
      } else {
        const reason = result && result.reason;
        const msg =
          reason === 'too_short'    ? 'Please write a bit more.' :
          reason === 'too_long'     ? 'Too long — under 4000 characters please.' :
          reason === 'rate_limited' ? 'Too many submissions — try again later.' :
          'Could not send feedback.';
        toast(msg);
      }
    } catch (err) {
      console.error('[tech-grid] feedback failed', err);
      toast('Could not send feedback.');
    } finally {
      btn.disabled = false;
    }
  }

  function buildTabs() {
    const tabs = el('div', { class: 'tgg-tabs' });
    [['play','Play'], ['stats','Stats'], ['leaders','Leaderboard']].forEach(([k, label]) => {
      tabs.appendChild(el('button', {
        class: 'tgg-tab' + (state.activePane === k ? ' is-active' : ''),
        'data-tab': k,
        text: label,
        onclick: () => setActivePane(k)
      }));
    });
    return tabs;
  }

  function setActivePane(name) {
    state.activePane = name;
    document.querySelectorAll('#tech-grid-root .tgg-tab').forEach(t => {
      t.classList.toggle('is-active', t.getAttribute('data-tab') === name);
    });
    document.querySelectorAll('#tech-grid-root .tgg-pane').forEach(p => {
      p.classList.toggle('is-active', p.getAttribute('data-pane') === name);
    });
    if (name === 'leaders' && state.puzzle) loadLeaderboard();
  }

  function buildPane(name, content) {
    return el('div', { class: 'tgg-pane' + (state.activePane === name ? ' is-active' : ''), 'data-pane': name }, [content]);
  }

  function buildBoard() {
    const wrap = el('div', { class: 'tgg-board-wrap' });
    const board = el('div', { class: 'tgg-board', id: 'tgg-board' });

    if (!state.puzzle) {
      board.appendChild(el('div', { class: 'tgg-pane-empty', text: 'Loading today\'s puzzle…' }));
      wrap.appendChild(board);
      return wrap;
    }

    board.appendChild(el('div', { class: 'tgg-corner' }));
    state.puzzle.cols.forEach(c => board.appendChild(el('div', { class: 'tgg-header-cell', text: c.name })));

    state.puzzle.rows.forEach((rowCat, r) => {
      board.appendChild(el('div', { class: 'tgg-header-cell', text: rowCat.name }));
      state.puzzle.cols.forEach((_, c) => {
        const cell = buildCell(r, c);
        board.appendChild(cell);
      });
    });

    wrap.appendChild(board);

    const status = el('div', { class: 'tgg-status' }, [
      statBox(countCorrect(), 'Correct'),
      statBox(remainingGuesses(), 'Guesses Left'),
      statBox(totalScore(), 'Score')
    ]);
    wrap.appendChild(status);
    wrap.appendChild(el('div', { id: 'tgg-actions', style: 'margin-top:12px;text-align:center' },
      state.finalized
        ? [el('button', { class: 'tgg-btn tgg-btn--primary', text: 'See leaderboard', onclick: () => setActivePane('leaders') })]
        : [
            (remainingGuesses() === 0 || countCorrect() === 9)
              ? el('button', { class: 'tgg-btn tgg-btn--primary', text: 'Submit & see leaderboard', onclick: finalizeAndShow })
              : null,
            countCorrect() < 9 && countCorrect() > 0 && remainingGuesses() > 0
              ? el('button', { class: 'tgg-btn tgg-btn--ghost', text: 'Submit early', style: 'margin-left:8px', onclick: giveUp })
              : null
          ].filter(Boolean)
    ));
    return wrap;
  }

  function statBox(n, label) {
    return el('div', { class: 'tgg-stat' }, [
      el('div', { class: 'tgg-stat-num', text: String(n) }),
      el('div', { class: 'tgg-stat-label', text: label })
    ]);
  }

  function buildCell(r, c) {
    const key = r + ',' + c;
    const p = state.progress[key];
    const filled = !!p;
    const correct = p && p.is_correct;
    const cls = ['tgg-cell'];
    if (filled) cls.push(correct ? 'tgg-cell--correct' : 'tgg-cell--wrong');
    // Cell is permanently locked only if correct, OR game is finalized
    if (state.finalized && !correct) cls.push('tgg-cell--locked');

    const isClickable = !state.finalized && !correct && remainingGuesses() > 0;
    const cell = el('div', {
      class: cls.join(' '),
      'data-r': r, 'data-c': c,
      onclick: () => isClickable ? openGuessModal(r, c) : null
    });

    if (!filled) {
      cell.appendChild(el('div', { class: 'tgg-cell-empty-hint', text: '+ Guess' }));
    } else if (correct) {
      cell.appendChild(el('div', { class: 'tgg-cell-product', text: p.product_name }));
      const rarityLabel = (p.rarity >= 80 ? 'tgg-rarity tgg-rarity--legendary' : 'tgg-rarity');
      cell.appendChild(el('div', { class: rarityLabel, text: 'Rarity ' + p.rarity }));
      cell.appendChild(el('div', { class: 'tgg-breakdown', text: p.percent_picked + '% picked this' }));
    } else {
      cell.appendChild(el('div', { class: 'tgg-cell-product', text: p.attempted || 'Wrong' }));
      cell.appendChild(el('div', { class: 'tgg-cell-meta', text: isClickable ? 'Tap to retry' : 'Not a match' }));
    }
    return cell;
  }

  function buildStats() {
    const s = state.stats;
    const row = (label, val) => el('div', { class: 'tgg-stat' }, [
      el('div', { class: 'tgg-stat-num', text: String(val) }),
      el('div', { class: 'tgg-stat-label', text: label })
    ]);
    return el('div', { class: 'tgg-stats' }, [
      el('div', { class: 'tgg-status', style:'grid-template-columns:repeat(2,1fr);gap:8px' }, [
        row('Games Played', s.gamesPlayed),
        row('Perfect Games', s.perfect),
        row('Current Streak', s.currentStreak),
        row('Max Streak', s.maxStreak)
      ]),
      el('div', { style: 'margin-top:14px' }, [
        el('label', { class: 'tgg-stat-label', text: 'Display Name (used on the leaderboard)' }),
        (() => {
          const i = el('input', { class: 'tgg-input', type: 'text', placeholder: 'e.g. tech-fan-42', maxlength: 24 });
          i.value = s.displayName || '';
          i.style.marginTop = '6px';
          i.oninput = (e) => { state.stats.displayName = e.target.value; saveStats(state.stats); };
          return i;
        })()
      ]),
      el('div', { style: 'margin-top:12px;color:var(--tgg-muted);font-size:0.8rem' }, [
        'Stats are stored in your browser. Clearing site data resets your streak.'
      ])
    ]);
  }

  function buildLeaderboardPlaceholder() {
    return el('div', { id: 'tgg-leaderboard' }, [
      el('div', { class: 'tgg-pane-empty', text: 'Loading leaderboard…' })
    ]);
  }

  function buildModal() {
    return el('div', { class: 'tgg-modal-bg', id: 'tgg-modal-bg', onclick: (e) => {
      if (e.target.id === 'tgg-modal-bg') closeModal();
    } }, [
      el('div', { class: 'tgg-modal' }, [
        el('h3', { id: 'tgg-modal-title', text: 'Pick a product' }),
        el('p',  { id: 'tgg-modal-sub', text: '' }),
        el('input', {
          class: 'tgg-input',
          id: 'tgg-input',
          type: 'text',
          autocomplete: 'off',
          placeholder: 'Type a product name…',
          oninput: onTypeahead,
          onkeydown: onModalKey
        }),
        el('ul', { class: 'tgg-suggestions', id: 'tgg-suggestions' }),
        el('div', { class: 'tgg-modal-actions' }, [
          el('button', { class: 'tgg-btn tgg-btn--ghost', text: 'Cancel', onclick: closeModal }),
          el('button', { class: 'tgg-btn tgg-btn--primary', id: 'tgg-submit', text: 'Submit', onclick: submitFromModal })
        ])
      ])
    ]);
  }

  // --------- Boot ------------------------------------------------
  async function boot() {
    mount();
    try {
      const puzzleArr = await SB.rpc('get_today_puzzle', {}).catch(() => null);
      const puzzle = Array.isArray(puzzleArr) ? puzzleArr[0] : puzzleArr;
      if (!puzzle || !puzzle.id) {
        toast('No puzzle available yet — check back at 9 AM ET.');
        return;
      }
      state.puzzle = puzzle;
      state.progress = loadProgress(puzzle.id);
      state.finalized = !!state.progress.__finalized;
      mount();
    } catch (err) {
      console.error('[tech-grid] boot failed', err);
      toast('Could not load the puzzle.');
    }
  }

  // --------- Guess modal ----------------------------------------
  let modalSelection = null; // suggested product object
  let highlightIdx = -1;

  function openGuessModal(r, c) {
    state.activeCell = { r, c };
    const rowName = state.puzzle.rows[r].name;
    const colName = state.puzzle.cols[c].name;
    $('#tgg-modal-title').textContent = rowName + '  ×  ' + colName;
    $('#tgg-modal-sub').textContent = 'Guess a product that fits both categories.';
    $('#tgg-input').value = '';
    $('#tgg-suggestions').innerHTML = '';
    modalSelection = null;
    highlightIdx = -1;
    $('#tgg-modal-bg').classList.add('is-open');
    setTimeout(() => $('#tgg-input').focus(), 0);
  }
  function closeModal() {
    $('#tgg-modal-bg').classList.remove('is-open');
    state.activeCell = null;
  }

  let typeaheadTimer = null;
  let typeaheadSeq = 0;

  function onTypeahead(e) {
    const q = e.target.value.trim();
    const ul = $('#tgg-suggestions');
    if (!q) {
      ul.innerHTML = '';
      modalSelection = null;
      highlightIdx = -1;
      return;
    }
    // Debounce server fetch
    clearTimeout(typeaheadTimer);
    typeaheadTimer = setTimeout(() => runSearch(q), 180);
  }

  async function runSearch(q) {
    if (q.length < 1) return;
    const cacheKey = q.toLowerCase();
    if (state.searchCache.has(cacheKey)) {
      renderSuggestions(state.searchCache.get(cacheKey));
      return;
    }
    const seq = ++typeaheadSeq;
    try {
      const rows = await SB.rpc('search_products', {
        p_query: q,
        p_puzzle_id: state.puzzle.id,
        p_limit: 8
      });
      if (seq !== typeaheadSeq) return; // a newer keystroke superseded this
      const list = Array.isArray(rows) ? rows : [];
      state.searchCache.set(cacheKey, list);
      if (state.searchCache.size > 100) {
        // drop oldest
        const firstKey = state.searchCache.keys().next().value;
        state.searchCache.delete(firstKey);
      }
      renderSuggestions(list);
    } catch (err) {
      console.error('[tech-grid] search failed', err);
    }
  }

  function renderSuggestions(matches) {
    const ul = $('#tgg-suggestions');
    ul.innerHTML = '';
    const used = new Set(usedProductNames().map(n => n.toLowerCase()));
    const filtered = matches.filter(m => !used.has((m.name || '').toLowerCase()));
    filtered.forEach((m, idx) => {
      const li = el('li', {
        class: 'tgg-suggestion' + (idx === 0 ? ' is-active' : ''),
        'data-idx': idx,
        onclick: () => { modalSelection = m; submitFromModal(); }
      }, [
        el('div', { text: m.name }),
        el('div', { class: 'tgg-suggestion-meta', text: [m.manufacturer, m.kind, m.release_year].filter(Boolean).join(' · ') })
      ]);
      ul.appendChild(li);
    });
    modalSelection = filtered[0] || null;
    highlightIdx = filtered.length ? 0 : -1;
  }

  function onModalKey(e) {
    const ul = $('#tgg-suggestions');
    const items = ul.querySelectorAll('.tgg-suggestion');
    if (e.key === 'ArrowDown') {
      if (!items.length) return;
      highlightIdx = Math.min(items.length - 1, highlightIdx + 1);
      updateHighlight(items);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      if (!items.length) return;
      highlightIdx = Math.max(0, highlightIdx - 1);
      updateHighlight(items);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      submitFromModal();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      closeModal();
    }
  }
  function updateHighlight(items) {
    items.forEach((it, i) => it.classList.toggle('is-active', i === highlightIdx));
    const cacheKey = $('#tgg-input').value.trim().toLowerCase();
    const cached = state.searchCache.get(cacheKey) || [];
    modalSelection = cached[highlightIdx] || null;
  }

  async function submitFromModal() {
    if (!state.activeCell) return;
    const { r, c } = state.activeCell;
    const raw = (modalSelection && modalSelection.name) || $('#tgg-input').value;
    if (!raw || !raw.trim()) { toast('Type a product name.'); return; }
    $('#tgg-submit').disabled = true;
    try {
      const result = await SB.rpc('submit_guess', {
        p_puzzle_id: state.puzzle.id,
        p_player_id: state.playerId,
        p_row_idx: r,
        p_col_idx: c,
        p_raw_text: raw
      });
      handleGuessResult(r, c, raw, result);
    } catch (err) {
      console.error(err);
      toast('Could not submit guess.');
    } finally {
      $('#tgg-submit').disabled = false;
      closeModal();
    }
  }

  function handleGuessResult(r, c, raw, result) {
    const key = r + ',' + c;

    // Soft rejections — no insert on the server, no attempt counted on client.
    if (result.reason === 'cell_already_correct') {
      toast('That cell is already solved.');
      return;
    }
    if (result.reason === 'empty' || result.reason === 'unknown_puzzle') {
      return;
    }

    // Everything below counts as one of the player's 9 attempts.
    state.progress.__attempts = attemptsUsed() + 1;

    if (result.is_correct) {
      state.progress[key] = {
        is_correct: true,
        product_name: result.product.name,
        rarity: result.rarity,
        percent_picked: result.percent_picked,
      };
      toast('Correct! Rarity ' + result.rarity + (result.rarity >= 80 ? ' — rare pick!' : ''));
    } else {
      state.progress[key] = {
        is_correct: false,
        attempted: (result.product && result.product.name) || raw,
        reason: result.reason
      };
      const msg =
        result.reason === 'unknown_product'      ? 'Not in the product list.' :
        result.reason === 'wrong_intersection'   ? 'Doesn\'t fit both categories.' :
        result.reason === 'product_already_used' ? 'You already used that one.' :
        'Wrong.';
      toast(msg);
    }
    saveProgress(state.puzzle.id, state.progress);
    mount();
    if (countCorrect() === 9 || remainingGuesses() === 0) finalizeAndShow();
  }

  // --------- Game flow / scoring --------------------------------
  // state.progress holds the LATEST cell state (correct or last-wrong) per key.
  // state.progress.__attempts is a separate counter incremented on every server
  // submission that produced a result (correct or wrong). Wrong guesses do NOT
  // lock a cell, but they do count toward the 9-guess cap.
  function attemptsUsed() {
    return state.progress.__attempts || 0;
  }
  function countCorrect() {
    return Object.keys(state.progress).filter(k => !k.startsWith('__') && state.progress[k] && state.progress[k].is_correct).length;
  }
  function sumRarity() {
    return Object.keys(state.progress)
      .filter(k => !k.startsWith('__') && state.progress[k] && state.progress[k].is_correct)
      .reduce((s, k) => s + (state.progress[k].rarity || 0), 0);
  }
  function totalScore() {
    // Match the server formula in finalize_game: 100 per correct cell + rarity sum.
    return countCorrect() * 100 + sumRarity();
  }
  // 9 guess attempts total (correct or wrong)
  function remainingGuesses() {
    return Math.max(0, 9 - attemptsUsed());
  }
  // Track which products this player has already used CORRECTLY (so client can
  // pre-flight reject re-use; server enforces this too).
  function usedProductNames() {
    return Object.keys(state.progress)
      .filter(k => !k.startsWith('__') && state.progress[k] && state.progress[k].is_correct)
      .map(k => state.progress[k].product_name);
  }

  async function finalizeAndShow() {
    if (state.finalized) { setActivePane('leaders'); return; }
    state.finalized = true;
    state.progress.__finalized = true;
    saveProgress(state.puzzle.id, state.progress);
    try {
      const res = await SB.rpc('finalize_game', {
        p_puzzle_id: state.puzzle.id,
        p_player_id: state.playerId,
        p_display_name: (state.stats.displayName || '').trim() || null
      });
      // Update local stats mirror
      const correct = countCorrect();
      const today = (state.puzzle.date || '').slice(0, 10);
      const wasYesterday = state.stats.lastPlayed && isYesterday(state.stats.lastPlayed, today);
      state.stats.gamesPlayed += 1;
      state.stats.totalCorrect += correct;
      if (correct === 9) state.stats.perfect += 1;
      if (correct >= 1) {
        state.stats.currentStreak = wasYesterday ? state.stats.currentStreak + 1 : 1;
        state.stats.maxStreak = Math.max(state.stats.maxStreak, state.stats.currentStreak);
      } else {
        state.stats.currentStreak = 0;
      }
      state.stats.lastPlayed = today;
      saveStats(state.stats);
    } catch (err) {
      console.error('[tech-grid] finalize failed', err);
    }
    mount();
    setActivePane('leaders');
  }

  function giveUp() {
    if (!confirm('End the game now and submit your score? Remaining cells will be left blank.')) return;
    finalizeAndShow();
  }

  async function loadLeaderboard() {
    const host = $('#tgg-leaderboard');
    host.innerHTML = '<div class="tgg-pane-empty">Loading…</div>';
    try {
      const rows = await SB.rpc('get_leaderboard', { p_puzzle_id: state.puzzle.id, p_limit: 50 });
      if (!rows || !rows.length) {
        host.innerHTML = '<div class="tgg-pane-empty">No scores yet — be the first!</div>';
        return;
      }
      const list = el('ul', { class: 'tgg-list' });
      rows.forEach((r, i) => {
        list.appendChild(el('li', {}, [
          el('div', { class: 'tgg-rank', text: '#' + (i + 1) }),
          el('div', { text: r.display_name || 'Anonymous' }),
          el('div', { class: 'tgg-cell-meta', text: r.correct_count + '/9' }),
          el('div', { class: 'tgg-rarity', text: r.rarity_score + ' pts' })
        ]));
      });
      host.innerHTML = '';
      host.appendChild(list);
    } catch (err) {
      console.error(err);
      host.innerHTML = '<div class="tgg-pane-empty">Could not load leaderboard.</div>';
    }
  }

  // --------- Utilities ------------------------------------------
  function toast(msg) {
    const t = document.getElementById('tgg-toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('is-shown');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('is-shown'), 2400);
  }
  function formatDate(d) {
    if (!d) return '';
    try {
      const dt = new Date(d + 'T12:00:00');
      return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    } catch (_) { return d; }
  }
  function isYesterday(prevIso, todayIso) {
    try {
      const a = new Date(prevIso); const b = new Date(todayIso);
      return Math.round((b - a) / 86400000) === 1;
    } catch (_) { return false; }
  }

  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})();
</script>


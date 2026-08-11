// Nota — client
// A small vanilla-JS SPA. No build step, no frameworks: fetch() against
// the existing Express API in server.js and re-render a couple of views.
(() => {
  'use strict';

  const TOKEN_KEY = 'nota_token';
  const REFRESH_KEY = 'nota_refresh_token';
  const $app = document.getElementById('app');

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || null,
    refreshToken: localStorage.getItem(REFRESH_KEY) || null,
    user: null,
    balanceCents: 0,
    transactions: [],
    payments: [],
    paymentBusy: false,
    paymentMessage: '',
    paymentError: '',
    authTab: 'login',
    authError: '',
    authBusy: false,
    recipient: null, // {id, name, username}
    recipientQuery: '',
    recipientResults: [],
    recipientSearching: false,
    recipientEmpty: false,
    transferBusy: false,
    transferError: '',
    transferSuccess: '',
    transferKey: cryptoKey(),
    profileOpen: false,
    profileBusy: false,
    profileError: '',
  };

  function cryptoKey() {
    return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
  }

  const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(cents / 100);
  const shortDate = iso => new Date(iso.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' });

  async function api(path, options = {}) {
    const headers = Object.assign({}, options.headers || {});
    if (options.body) headers['Content-Type'] = 'application/json';
    if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
    const res = await fetch(path, Object.assign({}, options, { headers }));
    let body = {};
    try { body = await res.json(); } catch { /* no body */ }
    if (res.status === 401 && state.token && !options._retried) {
      try {
        const refreshed = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: state.refreshToken }) });
        const next = await refreshed.json();
        if (refreshed.ok && next.token) {
          state.token = next.token;
          state.refreshToken = next.refreshToken;
          localStorage.setItem(TOKEN_KEY, next.token);
          localStorage.setItem(REFRESH_KEY, next.refreshToken);
          return api(path, Object.assign({}, options, { _retried: true }));
        }
      } catch { /* fall through to sign out */ }
      signOut();
    }
    if (!res.ok) throw new Error(body.error || 'Something went wrong. Please try again.');
    return body;
  }

  async function signOut() {
    if (state.token) {
      try { await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${state.token}` } }); } catch { /* local sign-out still succeeds */ }
    }
    state.token = null;
    state.refreshToken = null;
    state.user = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    render();
  }

  async function bootstrap() {
    if (!state.token) return render();
    try {
      const me = await api('/api/me');
      state.user = me.user;
      state.balanceCents = me.balanceCents;
      await loadTransactions();
      await loadPayments();
    } catch {
      signOut();
      return;
    }
    render();
  }

  async function loadTransactions() {
    try {
      const data = await api('/api/transactions');
      state.transactions = data.transactions;
    } catch { /* leave prior list if this fails */ }
  }

  async function loadPayments() {
    try { state.payments = (await api('/api/payments')).payments || []; } catch { state.payments = []; }
  }

  // ---------------------------------------------------------------------
  // Auth view
  // ---------------------------------------------------------------------

  function renderAuth() {
    const isLogin = state.authTab === 'login';
    $app.innerHTML = '';

    const shell = el('div', 'auth-shell');
    const head = el('div', 'masthead');
    head.innerHTML = `
      <div class="masthead__brand">Nota
        <small>Test credits · not real money</small>
      </div>`;
    shell.appendChild(head);

    const card = el('div', 'card');

    const tabs = el('div', 'tabs');
    tabs.setAttribute('role', 'tablist');
    const loginTab = tabButton('Sign in', isLogin);
    const registerTab = tabButton('Create account', !isLogin);
    loginTab.addEventListener('click', () => { state.authTab = 'login'; state.authError = ''; render(); });
    registerTab.addEventListener('click', () => { state.authTab = 'register'; state.authError = ''; render(); });
    tabs.append(loginTab, registerTab);
    card.appendChild(tabs);

    if (state.authError) {
      const err = el('div', 'form-error');
      err.textContent = state.authError;
      card.appendChild(err);
    }

    const form = el('form');
    form.noValidate = true;

    if (!isLogin) {
      form.appendChild(field('name', 'Full name', 'text', { autocomplete: 'name' }));
      form.appendChild(field('username', 'Username', 'text', { autocomplete: 'username' }));
      form.appendChild(field('email', 'Email', 'email', { autocomplete: 'email' }));
    } else {
      form.appendChild(field('login', 'Username or email', 'text', { autocomplete: 'username' }));
    }
    form.appendChild(field('password', 'Password', 'password', { autocomplete: isLogin ? 'current-password' : 'new-password' }));

    const submit = el('button', 'btn btn--block');
    submit.type = 'submit';
    submit.textContent = state.authBusy ? 'Please wait…' : (isLogin ? 'Enter Nota →' : 'Create test account →');
    submit.disabled = state.authBusy;
    form.appendChild(submit);

    form.addEventListener('submit', handleAuthSubmit);
    card.appendChild(form);

    const hint = el('div', 'demo-hint');
    hint.innerHTML = `Demo accounts: <strong>amer</strong>, <strong>alex</strong>, <strong>sarah</strong> — password <strong>NotaDemo1!</strong>`;
    card.appendChild(hint);

    shell.appendChild(card);

    const legal = el('footer', 'legal');
    legal.textContent = 'Nota is a fictional prototype. Balances are test credits and cannot be redeemed for real money.';
    shell.appendChild(legal);

    $app.appendChild(shell);
    $app.querySelector('input')?.focus();
  }

  function tabButton(label, selected) {
    const b = el('button', null);
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(selected));
    return b;
  }

  function field(name, label, type, extra = {}) {
    const wrap = el('div', 'field');
    const id = `field-${name}`;
    const lbl = el('label');
    lbl.setAttribute('for', id);
    lbl.textContent = label;
    const input = el('input');
    input.id = id;
    input.name = name;
    input.type = type;
    input.required = true;
    Object.entries(extra).forEach(([k, v]) => input.setAttribute(k, v));
    wrap.append(lbl, input);
    return wrap;
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    state.authBusy = true;
    state.authError = '';
    render();
    try {
      const path = state.authTab === 'login' ? '/api/auth/login' : '/api/auth/register';
      const result = await api(path, { method: 'POST', body: JSON.stringify(data) });
    state.token = result.token;
    state.refreshToken = result.refreshToken;
    state.user = result.user;
    localStorage.setItem(TOKEN_KEY, result.token);
    localStorage.setItem(REFRESH_KEY, result.refreshToken);
      const me = await api('/api/me');
      state.balanceCents = me.balanceCents;
      await loadTransactions();
      await loadPayments();
    } catch (err) {
      state.authError = err.message;
    } finally {
      state.authBusy = false;
      render();
    }
  }

  // ---------------------------------------------------------------------
  // Dashboard view
  // ---------------------------------------------------------------------

  function renderDashboard() {
    $app.innerHTML = '';

    const head = el('div', 'masthead');
    const brand = el('div', 'masthead__brand');
    brand.innerHTML = 'Nota<small>Test credits �� not real money</small>';
    const user = el('div', 'masthead__user');
    const editBtn = el('button', 'link-button');
    editBtn.type = 'button';
    editBtn.textContent = state.user.name;
    editBtn.addEventListener('click', () => { state.profileOpen = !state.profileOpen; render(); });
    const signOutBtn = el('button', 'link-button');
    signOutBtn.type = 'button';
    signOutBtn.textContent = 'Sign out';
    signOutBtn.addEventListener('click', signOut);
    user.append(editBtn, document.createTextNode(' · '), signOutBtn);
    head.append(brand, user);
    $app.appendChild(head);

    if (state.profileOpen) $app.appendChild(renderProfileEditor());

    $app.appendChild(renderNote());
    $app.appendChild(renderSendPanel());
    $app.appendChild(renderPaymentPanel());
    $app.appendChild(renderLedger());

    const legal = el('footer', 'legal');
    legal.textContent = 'Nota is a fictional prototype. Balances are test credits and cannot be redeemed for real money.';
    $app.appendChild(legal);
  }

  function renderNote() {
    const note = el('div', 'note');
    const stamp = el('div', 'stamp');
    stamp.textContent = 'TEST CREDIT · NOT REAL MONEY';
    note.appendChild(stamp);

    const inner = el('div', 'note__inner');
    const eyebrow = el('div', 'note__eyebrow');
    eyebrow.textContent = 'Available balance';
    const balance = el('div', 'note__balance');
    balance.textContent = money(state.balanceCents);
    const meta = el('div', 'note__meta');
    meta.textContent = `@${state.user.username} · ${state.user.email}`;
    inner.append(eyebrow, balance, meta);
    note.appendChild(inner);
    return note;
  }

  function renderProfileEditor() {
    const wrap = el('div', 'send-panel');
    wrap.style.marginBottom = '18px';
    if (state.profileError) {
      const err = el('div', 'form-error');
      err.textContent = state.profileError;
      wrap.appendChild(err);
    }
    const form = el('form');
    const nameField = field('name', 'Full name', 'text');
    nameField.querySelector('input').value = state.user.name;
    const bioField = field('bio', 'Bio', 'text');
    bioField.querySelector('input').value = state.user.bio || '';
    bioField.querySelector('input').removeAttribute('required');
    const curPw = field('currentPassword', 'Current password (to change password)', 'password', { autocomplete: 'current-password' });
    curPw.querySelector('input').required = false;
    const newPw = field('newPassword', 'New password (optional)', 'password', { autocomplete: 'new-password' });
    newPw.querySelector('input').required = false;
    form.append(nameField, bioField, curPw, newPw);
    const save = el('button', 'btn');
    save.type = 'submit';
    save.textContent = state.profileBusy ? 'Saving…' : 'Save profile';
    save.disabled = state.profileBusy;
    form.appendChild(save);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target).entries());
      // Drop empty password fields so the API treats them as "no change".
      if (!data.newPassword) {
        delete data.newPassword;
        delete data.currentPassword;
      }
      state.profileBusy = true;
      state.profileError = '';
      render();
      try {
        const result = await api('/api/me', { method: 'PATCH', body: JSON.stringify(data) });
        state.user = result.user;
        state.profileOpen = false;
      } catch (err) {
        state.profileError = err.message;
      } finally {
        state.profileBusy = false;
        render();
      }
    });
    wrap.appendChild(form);
    return wrap;
  }

  function renderSendPanel() {
    const section = el('div', 'section');
    const title = el('div', 'section__title');
    title.textContent = 'Send test credits';
    section.appendChild(title);

    const panel = el('div', 'send-panel');

    if (state.transferError) {
      const err = el('div', 'form-error');
      err.textContent = state.transferError;
      panel.appendChild(err);
    }
    if (state.transferSuccess) {
      const ok = el('div', 'form-success');
      ok.textContent = state.transferSuccess;
      panel.appendChild(ok);
    }

    const form = el('form');

    if (state.recipient) {
      const chip = el('div', 'recipient-chip');
      chip.append(document.createTextNode(`${state.recipient.name} (@${state.recipient.username})`));
      const clear = el('button');
      clear.type = 'button';
      clear.textContent = '×';
      clear.setAttribute('aria-label', 'Remove recipient');
      clear.addEventListener('click', () => { state.recipient = null; render(); });
      chip.appendChild(clear);
      form.appendChild(chip);
    } else {
      const searchWrap = el('div', 'field recipient-search');
      const lbl = el('label');
      lbl.setAttribute('for', 'recipient-input');
      lbl.textContent = 'Recipient';
      const input = el('input');
      input.id = 'recipient-input';
      input.type = 'text';
      input.placeholder = 'Search by username or email';
      input.autocomplete = 'off';
      input.value = state.recipientQuery;
      input.addEventListener('input', onRecipientSearch);
      searchWrap.append(lbl, input);

      if (state.recipientSearching) {
        const hint = el('div', 'recipient-hint');
        hint.textContent = 'Searching…';
        searchWrap.appendChild(hint);
      } else if (state.recipientEmpty && state.recipientQuery.trim().length >= 2) {
        const hint = el('div', 'recipient-hint');
        hint.textContent = 'No matching users. Try another username or email.';
        searchWrap.appendChild(hint);
      } else if (state.recipientResults.length) {
        const list = el('div', 'recipient-results');
        state.recipientResults.forEach(u => {
          const btn = el('button');
          btn.type = 'button';
          btn.textContent = `${u.name} · @${u.username}`;
          btn.addEventListener('click', () => {
            state.recipient = u;
            state.recipientResults = [];
            state.recipientQuery = '';
            state.recipientEmpty = false;
            render();
          });
          list.appendChild(btn);
        });
        searchWrap.appendChild(list);
      }
      form.appendChild(searchWrap);
    }

    const row = el('div', 'field-row');
    const amountField = field('amount', 'Amount (EUR)', 'text', { inputmode: 'decimal', placeholder: '0.00' });
    const noteField = field('note', 'Note (optional)', 'text');
    noteField.querySelector('label').removeAttribute('for');
    noteField.querySelector('input').id = 'field-note';
    noteField.querySelector('label').setAttribute('for', 'field-note');
    noteField.querySelector('input').required = false;
    row.append(amountField, noteField);
    form.appendChild(row);

    const submit = el('button', 'btn btn--block');
    submit.type = 'submit';
    submit.disabled = state.transferBusy || !state.recipient;
    submit.innerHTML = state.transferBusy ? '<span class="spinner"></span> Sending…' : 'Send test credits →';
    form.appendChild(submit);

    form.addEventListener('submit', handleTransferSubmit);
    panel.appendChild(form);
    section.appendChild(panel);
    return section;
  }

  function renderPaymentPanel() {
    const section = el('div', 'section');
    const title = el('div', 'section__title');
    title.textContent = 'Demo payments';
    section.appendChild(title);
    const panel = el('div', 'send-panel');
    const label = el('div', 'recipient-hint');
    label.textContent = 'Demo/Test only · no cards, banks, or real money are connected.';
    panel.appendChild(label);
    if (state.paymentError) { const err = el('div', 'form-error'); err.textContent = state.paymentError; panel.appendChild(err); }
    if (state.paymentMessage) { const ok = el('div', 'form-success'); ok.textContent = state.paymentMessage; panel.appendChild(ok); }
    const form = el('form');
    const amount = field('paymentAmount', 'Top up test credits (EUR)', 'text', { inputmode: 'decimal', placeholder: '25.00' });
    const outcome = el('div', 'field');
    const outcomeLabel = el('label'); outcomeLabel.textContent = 'Demo outcome';
    const select = el('select'); select.name = 'demoOutcome';
    [['succeeded','Success'],['failed','Failed'],['cancelled','Cancelled'],['pending','Pending']].forEach(([value, text]) => { const option = el('option'); option.value = value; option.textContent = text; select.appendChild(option); });
    outcome.append(outcomeLabel, select);
    form.append(amount, outcome);
    const submit = el('button', 'btn btn--block'); submit.type = 'submit'; submit.disabled = state.paymentBusy; submit.textContent = state.paymentBusy ? 'Creating…' : 'Create demo payment →'; form.appendChild(submit);
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); state.paymentBusy = true; state.paymentError = ''; state.paymentMessage = ''; render();
      const data = Object.fromEntries(new FormData(event.target).entries());
      try {
        const result = await api('/api/payments/intents', { method: 'POST', headers: { 'Idempotency-Key': cryptoKey() }, body: JSON.stringify({ amount: data.paymentAmount, demoOutcome: data.demoOutcome }) });
        state.paymentMessage = `Demo payment ${result.paymentIntent.status}. Provider: ${result.paymentIntent.provider}.`;
        await loadPayments();
      } catch (error) { state.paymentError = error.message; } finally { state.paymentBusy = false; render(); }
    });
    panel.appendChild(form);
    if (state.payments.length) {
      const list = el('div', 'recipient-hint');
      list.textContent = `Recent demo payments: ${state.payments.slice(0, 3).map((payment) => `${payment.status} ${money(payment.amount_cents)}`).join(' · ')}`;
      panel.appendChild(list);
    }
    section.appendChild(panel); return section;
  }

  let searchDebounce = null;
  function onRecipientSearch(e) {
    state.recipientQuery = e.target.value;
    const caret = e.target.selectionStart;
    clearTimeout(searchDebounce);
    if (state.recipientQuery.trim().length < 2) {
      state.recipientResults = [];
      state.recipientSearching = false;
      state.recipientEmpty = false;
      render();
      restoreFocus('recipient-input', caret);
      return;
    }
    state.recipientSearching = true;
    state.recipientEmpty = false;
    render();
    restoreFocus('recipient-input', caret);
    searchDebounce = setTimeout(async () => {
      try {
        const data = await api(`/api/users/search?q=${encodeURIComponent(state.recipientQuery.trim())}`);
        state.recipientResults = data.users;
        state.recipientEmpty = data.users.length === 0;
      } catch {
        state.recipientResults = [];
        state.recipientEmpty = true;
      } finally {
        state.recipientSearching = false;
      }
      render();
      restoreFocus('recipient-input', caret);
    }, 250);
  }

  function restoreFocus(id, caret) {
    const node = document.getElementById(id);
    if (node) {
      node.focus();
      if (typeof caret === 'number') node.setSelectionRange(caret, caret);
    }
  }

  async function handleTransferSubmit(e) {
    e.preventDefault();
    if (!state.recipient) return;
    const data = Object.fromEntries(new FormData(e.target).entries());
    state.transferBusy = true;
    state.transferError = '';
    state.transferSuccess = '';
    render();
    try {
      const result = await api('/api/transfers', {
        method: 'POST',
        headers: { 'Idempotency-Key': state.transferKey },
        body: JSON.stringify({
          recipient: state.recipient.username,
          amount: data.amount,
          note: data.note || '',
          idempotencyKey: state.transferKey,
        }),
      });
      state.transferSuccess = result.message || 'Sent.';
      state.recipient = null;
      state.recipientQuery = '';
      state.recipientEmpty = false;
      state.transferKey = cryptoKey();
      const me = await api('/api/me');
      state.balanceCents = me.balanceCents;
      await loadTransactions();
      setTimeout(() => {
        if (state.transferSuccess) {
          state.transferSuccess = '';
          render();
        }
      }, 4000);
    } catch (err) {
      state.transferError = err.message;
    } finally {
      state.transferBusy = false;
      render();
    }
  }

  function renderLedger() {
    const section = el('div', 'section');
    const title = el('div', 'section__title');
    title.textContent = 'Ledger';
    section.appendChild(title);

    if (!state.transactions.length) {
      const list = el('div', 'ledger');
      const empty = el('div', 'ledger__empty');
      empty.textContent = 'No transfers yet. Send your first test credits above.';
      list.appendChild(empty);
      section.appendChild(list);
      return section;
    }

    const list = el('ul', 'ledger');
    state.transactions.forEach(t => {
      const row = el('li', 'ledger__row');
      const date = el('div', 'ledger__date');
      date.textContent = shortDate(t.createdAt);
      const body = el('div', 'ledger__body');
      const name = el('div', 'ledger__name');
      name.textContent = (t.direction === 'sent' ? '→ ' : '← ') + t.counterparty.name;
      const note = el('div', 'ledger__note');
      note.textContent = t.note || (t.direction === 'sent' ? 'Sent' : 'Received');
      body.append(name, note);
      const amount = el('div', 'ledger__amount ' + (t.direction === 'sent' ? 'ledger__amount--out' : 'ledger__amount--in'));
      amount.textContent = (t.direction === 'sent' ? '−' : '+') + money(t.amountCents);
      row.append(date, body, amount);
      list.appendChild(row);
    });
    section.appendChild(list);
    return section;
  }

  // ---------------------------------------------------------------------
  // Helpers & entry point
  // ---------------------------------------------------------------------

  function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function render() {
    if (!state.token || !state.user) {
      renderAuth();
    } else {
      renderDashboard();
    }
  }

  bootstrap();
})();

// All user content is inserted with textContent (never innerHTML) to prevent XSS.
const app = document.getElementById('app'), nav = document.getElementById('nav');
let token = localStorage.getItem('token'), user = JSON.parse(localStorage.getItem('user') || 'null');

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  kids.flat().forEach(c => n.append(c instanceof Node ? c : document.createTextNode(c ?? '')));
  return n;
}
const toast = (m) => { const t = document.getElementById('toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2200); };
const fmt = (d) => new Date(d.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (res.status === 401 && token) logout(true);
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function setAuth(d) { token = d.token; user = d.user; localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(user)); }
function logout(silent) { token = user = null; localStorage.clear(); renderNav(); if (!silent) toast('Logged out'); location.hash = '#/login'; }

function renderNav() {
  nav.replaceChildren(...(user
    ? [el('span', { class: 'who' }, user.username), el('a', { class: 'btn sm', href: '#/new' }, 'New post'), el('button', { class: 'btn ghost sm', onclick: () => logout() }, 'Log out')]
    : [el('a', { class: 'btn ghost sm', href: '#/login' }, 'Log in'), el('a', { class: 'btn sm', href: '#/register' }, 'Sign up')]));
}

// ---------- Views ----------
async function home(params) {
  const q = params.get('q') || '', page = +params.get('page') || 1;
  const { posts, pages } = await api(`/posts?q=${encodeURIComponent(q)}&page=${page}`);
  const input = el('input', { type: 'search', placeholder: 'Search posts', 'aria-label': 'Search posts', value: q });
  const go = (p) => location.hash = `#/?q=${encodeURIComponent(input.value)}&page=${p}`;
  app.replaceChildren(
    el('h1', {}, 'Latest posts'),
    el('form', { class: 'search', onsubmit: (e) => { e.preventDefault(); go(1); } }, input, el('button', { class: 'btn' }, 'Search')),
    ...(posts.length ? posts.map(p => el('article', { class: 'card' },
      el('h2', {}, el('a', { href: '#/post/' + p.id }, p.title)),
      el('div', { class: 'meta' }, `${p.author} · ${fmt(p.created_at)} · ${p.comment_count} comment${p.comment_count === 1 ? '' : 's'}`),
      el('p', { class: 'excerpt' }, p.content.length > 180 ? p.content.slice(0, 180) + '…' : p.content)))
      : [el('div', { class: 'empty' }, q ? 'No posts match your search.' : 'No posts yet. Be the first to write one.')]),
    el('div', { class: 'pager' },
      el('button', { class: 'btn ghost sm', disabled: page <= 1, onclick: () => go(page - 1) }, 'Previous'),
      el('span', { class: 'meta' }, `Page ${page} of ${pages}`),
      el('button', { class: 'btn ghost sm', disabled: page >= pages, onclick: () => go(page + 1) }, 'Next')));
}

async function postView(id) {
  const p = await api('/posts/' + id);
  const list = el('div');
  const draw = () => list.replaceChildren(...(p.comments.length ? p.comments.map(c => el('div', { class: 'comment' },
    el('div', { class: 'meta' }, `${c.author} · ${fmt(c.created_at)}`), el('p', {}, c.body),
    user && (user.id === c.user_id || user.id === p.user_id) ? el('button', { class: 'btn danger sm', onclick: async () => {
      try { await api('/comments/' + c.id, 'DELETE'); p.comments = p.comments.filter(x => x.id !== c.id); draw(); toast('Comment deleted'); } catch (e) { toast(e.message); }
    } }, 'Delete') : '')) : [el('p', { class: 'meta' }, 'No comments yet.')]);
  draw();
  const err = el('div', { class: 'error' }), ta = el('textarea', { class: 'short', maxlength: 1000, required: true, 'aria-label': 'Comment' });
  const form = user ? el('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = '';
    try { await api(`/posts/${id}/comments`, 'POST', { body: ta.value }); toast('Comment posted'); route(); } catch (x) { err.textContent = x.message; }
  } }, ta, err, el('button', { class: 'btn', style: 'justify-self:start' }, 'Post comment'))
    : el('p', {}, el('a', { href: '#/login' }, 'Log in'), ' to join the discussion.');
  const mine = user && user.id === p.user_id;
  app.replaceChildren(
    el('a', { href: '#/' }, '← All posts'), el('h1', {}, p.title),
    el('div', { class: 'meta' }, `${p.author} · ${fmt(p.created_at)}${p.updated_at !== p.created_at ? ' · edited' : ''}`),
    el('div', { class: 'post-body' }, p.content),
    mine ? el('div', { class: 'row' }, el('a', { class: 'btn ghost sm', href: '#/edit/' + id }, 'Edit'),
      el('button', { class: 'btn danger sm', onclick: async () => {
        if (!confirm('Delete this post and its comments?')) return;
        try { await api('/posts/' + id, 'DELETE'); toast('Post deleted'); location.hash = '#/'; } catch (e) { toast(e.message); }
      } }, 'Delete')) : '',
    el('h2', {}, `Comments (${p.comments.length})`), list, form);
}

async function editor(id) {
  if (!user) return (location.hash = '#/login');
  const p = id ? await api('/posts/' + id) : { title: '', content: '' };
  if (id && p.user_id !== user.id) return (location.hash = '#/');
  const title = el('input', { required: true, minlength: 3, maxlength: 150, value: p.title }), content = el('textarea', { required: true, minlength: 10 });
  content.value = p.content; const err = el('div', { class: 'error' });
  app.replaceChildren(el('h1', {}, id ? 'Edit post' : 'New post'),
    el('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      try { const r = id ? await api('/posts/' + id, 'PUT', { title: title.value, content: content.value }) : await api('/posts', 'POST', { title: title.value, content: content.value });
        toast(id ? 'Post updated' : 'Post published'); location.hash = '#/post/' + r.id; } catch (x) { err.textContent = x.message; }
    } }, el('label', {}, 'Title', title), el('label', {}, 'Content', content), err,
    el('div', { class: 'row' }, el('button', { class: 'btn' }, id ? 'Save changes' : 'Publish'), el('a', { class: 'btn ghost', href: '#/' }, 'Cancel'))));
}

function authView(isReg) {
  const f = {}; const err = el('div', { class: 'error' });
  const field = (name, label, type, extra = {}) => el('label', {}, label, f[name] = el('input', { type, required: true, ...extra }));
  app.replaceChildren(el('h1', {}, isReg ? 'Create your account' : 'Welcome back'),
    el('form', { class: 'card stack', onsubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      try { const d = await api(isReg ? '/auth/register' : '/auth/login', 'POST', Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.value])));
        setAuth(d); renderNav(); toast(isReg ? 'Account created' : 'Logged in'); location.hash = '#/'; } catch (x) { err.textContent = x.message; }
    } }, ...(isReg ? [field('username', 'Username', 'text', { autocomplete: 'username', minlength: 3, maxlength: 30 })] : []),
      field('email', 'Email', 'email', { autocomplete: 'email' }),
      field('password', 'Password', 'password', { autocomplete: isReg ? 'new-password' : 'current-password', minlength: isReg ? 8 : 1 }),
      err, el('button', { class: 'btn' }, isReg ? 'Sign up' : 'Log in'),
      el('p', { class: 'meta' }, isReg ? 'Already registered? ' : 'New here? ', el('a', { href: isReg ? '#/login' : '#/register' }, isReg ? 'Log in' : 'Create an account'))));
}

// ---------- Router ----------
async function route() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?'); const parts = path.split('/').filter(Boolean);
  try {
    if (!parts.length) await home(new URLSearchParams(qs));
    else if (parts[0] === 'post') await postView(parts[1]);
    else if (parts[0] === 'new') await editor();
    else if (parts[0] === 'edit') await editor(parts[1]);
    else if (parts[0] === 'login') authView(false);
    else if (parts[0] === 'register') authView(true);
    else app.replaceChildren(el('div', { class: 'empty' }, 'Page not found.'));
  } catch (e) { app.replaceChildren(el('div', { class: 'empty' }, e.message)); }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
renderNav(); route();

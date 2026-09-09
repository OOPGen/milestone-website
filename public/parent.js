/* Milestone parent portal — read-only, except a parent's own name and password.

   Nothing here can create, edit, publish, archive, or upload content, and no
   route it calls can return another user's account. See
   ACCOUNT-SYSTEM-PLAN.md section 3 and worker/routes/parent.js. */

const { api, apiErrorMessage } = window.MJLA_API;
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

let ME = null;
let currentView = 'overview';

function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtDate(iso){ if(!iso) return '—'; try{ return new Date(iso).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }catch{ return iso; } }
function toggleAdminTheme(){ document.body.classList.toggle('admin-dark'); }
window.toggleAdminTheme = toggleAdminTheme;

const KIND_LABELS = { opening: 'Term opening', closing: 'Term closing', holiday: 'Holiday', event: 'Event', reminder: 'Reminder' };

(async function boot(){
  const res = await api.get('/api/auth/me');
  if (res.status === 503) {
    $('#authGateMessage').textContent = 'Accounts are not connected yet. Please contact the school office.';
    return;
  }
  if (!res.ok || !res.data.user) {
    window.location.href = 'login.html';
    return;
  }
  ME = res.data.user;
  if (ME.role !== 'PARENT') {
    window.location.href = 'admin.html';
    return;
  }

  $('#authGate').hidden = true;
  $('#dashboard').hidden = false;
  $('#profileName').textContent = ME.name || ME.email;
  $('#profileInitials').textContent = (ME.name || ME.email).slice(0, 1).toUpperCase();

  $$('.admin-nav button').forEach(btn => btn.addEventListener('click', () => {
    $$('.admin-nav button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    renderView();
  }));

  $('#logoutBtn').addEventListener('click', async () => {
    await api.post('/api/auth/logout');
    window.location.href = 'login.html';
  });

  renderView();
})();

const VIEW_TITLES = {
  overview: 'Overview', notice: 'Notices', term_date: 'Term Dates & Calendar',
  news: 'News', album: 'Gallery', documents: 'Documents', profile: 'My Profile',
};

async function renderView(){
  $('#viewTitle').textContent = VIEW_TITLES[currentView] || '';
  const el = $('#parentView');
  el.innerHTML = '<div class="admin-card">Loading…</div>';
  try {
    switch (currentView) {
      case 'overview': return renderOverview(el);
      case 'notice': return renderList(el, 'notice', 'Notices');
      case 'term_date': return renderCalendar(el);
      case 'news': return renderList(el, 'news', 'News');
      case 'album': return renderAlbums(el);
      case 'documents': return renderDocuments(el);
      case 'profile': return renderProfile(el);
      default: el.innerHTML = '<div class="admin-card">Unknown view.</div>';
    }
  } catch (err) {
    el.innerHTML = `<div class="admin-card">Something went wrong loading this. ${esc(err?.message || '')}</div>`;
  }
}

async function renderOverview(el){
  const [notices, dates, news, docs] = await Promise.all([
    api.get('/api/parent/content/notice'), api.get('/api/parent/content/term_date'),
    api.get('/api/parent/content/news'), api.get('/api/parent/documents'),
  ]);
  el.innerHTML = `
    <div class="metric-grid">
      <div class="metric-card"><small>Notices</small><strong>${(notices.data.items||[]).length}</strong><span>Current</span></div>
      <div class="metric-card"><small>Calendar entries</small><strong>${(dates.data.items||[]).length}</strong><span>Term dates &amp; events</span></div>
      <div class="metric-card"><small>News</small><strong>${(news.data.items||[]).length}</strong><span>Published</span></div>
      <div class="metric-card"><small>Documents</small><strong>${(docs.data.documents||[]).length}</strong><span>Available to download</span></div>
    </div>
    <div class="admin-card">
      <h4>Welcome, ${esc(ME.name || 'parent')}.</h4>
      <p style="font-size:.85rem;color:var(--admin-muted,#6e6376)">Use the sections on the left for notices, term dates and the school calendar, news, photo galleries, and downloadable documents. This portal is read-only — for anything you need changed, please contact the school office.</p>
    </div>`;
}

async function renderList(el, type, label){
  const res = await api.get(`/api/parent/content/${type}`);
  const items = res.ok ? res.data.items : [];
  el.innerHTML = `
    <div class="admin-card">
      ${items.length ? items.map(i => `
        <div class="parent-item">
          <div class="parent-item-head"><b>${esc(i.title)}</b>${i.visibility === 'parents' ? '<span class="status invited">Parents only</span>' : ''}</div>
          ${i.category ? `<small>${esc(i.category)}</small>` : ''}
          <p>${esc(i.summary || '')}</p>
        </div>`).join('') : `<p class="empty-state">No ${label.toLowerCase()} right now.</p>`}
    </div>`;
}

async function renderCalendar(el){
  const res = await api.get('/api/parent/content/term_date');
  const items = res.ok ? res.data.items : [];
  el.innerHTML = `
    <div class="admin-card">
      <table class="data-table"><thead><tr><th>Date</th><th>Type</th><th>What</th></tr></thead>
      <tbody>${items.length ? items.map(i => `<tr>
        <td><b>${fmtDate(i.start_date)}</b>${i.end_date ? `<br><small>to ${fmtDate(i.end_date)}</small>` : ''}</td>
        <td>${esc(KIND_LABELS[i.kind] || i.kind || '—')}</td>
        <td>${esc(i.title)}${i.summary ? `<br><small>${esc(i.summary)}</small>` : ''}</td>
      </tr>`).join('') : '<tr><td colspan="3" class="empty-state">No calendar entries published yet.</td></tr>'}</tbody></table>
    </div>`;
}

async function renderAlbums(el, openAlbumId){
  if (openAlbumId) return renderAlbumPhotos(el, openAlbumId);
  const res = await api.get('/api/parent/content/album');
  const items = res.ok ? res.data.items : [];
  el.innerHTML = `
    <div class="gallery-grid">${items.length ? items.map(i => `
      <div class="gallery-thumb" data-open="${i.id}" style="cursor:pointer">
        <div style="height:130px;background:var(--purple,#4a148c);display:grid;place-items:center;color:#fff;font:1rem Fraunces">${esc(i.title)}</div>
        <div class="gallery-thumb-meta"><small>${esc(i.summary || '')}</small></div>
      </div>`).join('') : '<p class="empty-state">No photo albums published yet.</p>'}</div>`;
  $$('[data-open]').forEach(card => card.addEventListener('click', () => renderAlbums(el, card.dataset.open)));
}

async function renderAlbumPhotos(el, albumId){
  const res = await api.get(`/api/parent/albums/${albumId}/photos`);
  const photos = res.ok ? res.data.photos : [];
  el.innerHTML = `
    <div class="admin-view-head"><h3>Album</h3><button class="admin-btn" id="backToAlbums">← Back to gallery</button></div>
    <div class="gallery-grid">${photos.length ? photos.map(p => `
      <div class="gallery-thumb"><img src="/api/files/${p.asset_id}" alt="${esc(p.caption||'')}" loading="lazy"/>${p.caption ? `<div class="gallery-thumb-meta"><small>${esc(p.caption)}</small></div>` : ''}</div>`).join('') : '<p class="empty-state">No photos in this album yet.</p>'}</div>`;
  $('#backToAlbums').addEventListener('click', () => renderAlbums(el));
}

async function renderDocuments(el){
  const res = await api.get('/api/parent/documents');
  const docs = res.ok ? res.data.documents : [];
  el.innerHTML = `
    <div class="admin-card">
      <table class="data-table"><thead><tr><th>Document</th><th>Date</th><th></th></tr></thead>
      <tbody>${docs.length ? docs.map(d => `<tr>
        <td><b>${esc(d.title)}</b>${d.description ? `<br><small>${esc(d.description)}</small>` : ''}</td>
        <td>${fmtDate(d.doc_date)}</td>
        <td>${d.asset_id ? `<a class="admin-btn" href="/api/files/${esc(d.asset_id)}" target="_blank" rel="noopener">Download</a>` : '<span class="empty-state" style="padding:6px 10px">Not available</span>'}</td>
      </tr>`).join('') : '<tr><td colspan="3" class="empty-state">No documents published yet.</td></tr>'}</tbody></table>
    </div>`;
}

function renderProfile(el){
  el.innerHTML = `
    <div class="admin-card">
      <h4>Your details</h4>
      <form id="profileForm" class="admin-form">
        <label>Display name<input name="name" value="${esc(ME.name || '')}"/></label>
        <div class="admin-actions"><button type="submit" class="admin-btn primary">Save name</button></div>
        <p class="form-status" id="profileFormStatus"></p>
      </form>
    </div>
    <div class="admin-card">
      <h4>Change password</h4>
      <form id="passwordForm" class="admin-form">
        <label>Current password<input type="password" name="currentPassword" required/></label>
        <label>New password<input type="password" name="newPassword" required minlength="10"/></label>
        <div class="admin-actions"><button type="submit" class="admin-btn primary">Update password</button></div>
        <p class="form-status" id="passwordFormStatus"></p>
      </form>
    </div>`;

  $('#profileForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name = new FormData(e.target).get('name');
    const result = await api.post('/api/auth/profile', { name });
    $('#profileFormStatus').textContent = result.ok ? 'Saved ✓' : apiErrorMessage(result);
    if (result.ok) { ME.name = name; $('#profileName').textContent = name || ME.email; }
  });

  $('#passwordForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const result = await api.post('/api/auth/change-password', { currentPassword: fd.get('currentPassword'), newPassword: fd.get('newPassword') });
    $('#passwordFormStatus').textContent = result.ok ? 'Password updated ✓' : apiErrorMessage(result, 'Your current password is incorrect.');
    if (result.ok) e.target.reset();
  });
}

/* Milestone staff dashboard.

   Everything here calls the real API (worker/index.js) with the session
   cookie sent automatically via credentials:'include' in apiClient.js. There
   is no fake data and no localStorage session — see ACCOUNT-SYSTEM-PLAN.md. */

const { api, apiErrorMessage } = window.MJLA_API;
const $ = (s, ctx) => (ctx || document).querySelector(s);
const $$ = (s, ctx) => (ctx || document).querySelectorAll(s);

let ME = null;
let currentView = 'overview';

function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtDate(iso){ if(!iso) return '—'; try{ return new Date(iso).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }catch{ return iso; } }
function statusPill(s){ return `<span class="status ${esc(s)}">${esc(s)}</span>`; }
function showToast(t){ const x=document.createElement('div'); x.className='admin-toast'; x.textContent=t; document.body.appendChild(x); setTimeout(()=>x.remove(),3200); }
function toggleAdminTheme(){ document.body.classList.toggle('admin-dark'); }
window.toggleAdminTheme = toggleAdminTheme;

/* Mirrors worker/lib/permissions.js MATRIX for nav visibility only. The real
   enforcement is server-side (see tests/account-system.test.mjs) — hiding a
   nav item here is a convenience, not a security boundary. */
const UI_CAPABILITIES = {
  'parents.manage': ['SUPER_ADMIN', 'STAFF_ADMIN'],
  'staff.manage': ['SUPER_ADMIN'],
  'audit.read': ['SUPER_ADMIN'],
  'settings.manage': ['SUPER_ADMIN'],
};
function roleHasCapability(role, cap){ return (UI_CAPABILITIES[cap] || []).includes(role); }

/* ============================================================================
   Boot: confirm a real session before showing anything
   ============================================================================ */

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
  if (ME.role === 'PARENT') {
    window.location.href = 'parent.html';
    return;
  }

  $('#authGate').hidden = true;
  $('#dashboard').hidden = false;
  $('#profileName').textContent = ME.name || ME.email;
  $('#profileInitials').textContent = (ME.name || ME.email).slice(0, 1).toUpperCase();
  $('#userEyebrow').textContent = ME.role === 'SUPER_ADMIN' ? 'Super Admin' : 'Staff Admin';

  $$('.admin-nav button[data-requires]').forEach(btn => {
    btn.hidden = !roleHasCapability(ME.role, btn.dataset.requires);
  });

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
  news: 'News', album: 'Gallery', documents: 'Documents', pages: 'Website Pages',
  contacts: 'Contacts & School Information', parents: 'Parents', staff: 'Staff Accounts',
  audit: 'Audit Log', checklist: 'Content Checklist', settings: 'Settings',
};

async function renderView(){
  $('#viewTitle').textContent = VIEW_TITLES[currentView] || '';
  const el = $('#adminView');
  el.innerHTML = '<div class="admin-card">Loading…</div>';
  try {
    switch (currentView) {
      case 'overview': return renderOverview(el);
      case 'notice': return renderContentSection(el, 'notice', { label: 'notice', hasBody: true, defaultVisibility: 'parents' });
      case 'news': return renderContentSection(el, 'news', { label: 'news article', hasBody: true, defaultVisibility: 'public' });
      case 'term_date': return renderContentSection(el, 'term_date', { label: 'calendar entry', hasKind: true, hasDates: true, defaultVisibility: 'parents' });
      case 'album': return renderAlbums(el);
      case 'documents': return renderDocuments(el);
      case 'pages': return renderPages(el);
      case 'contacts': return renderContacts(el);
      case 'parents': return renderAccounts(el, 'PARENT');
      case 'staff': return renderAccounts(el, 'STAFF');
      case 'audit': return renderAudit(el);
      case 'checklist': return renderChecklist(el);
      case 'settings': return renderSettings(el);
      default: el.innerHTML = '<div class="admin-card">Unknown view.</div>';
    }
  } catch (err) {
    el.innerHTML = `<div class="admin-card">Something went wrong loading this view. ${esc(err?.message || '')}</div>`;
  }
}

/* ============================================================================
   Overview
   ============================================================================ */

async function renderOverview(el){
  const [notices, news, dates, albums, docs] = await Promise.all([
    api.get('/api/admin/content/notice'), api.get('/api/admin/content/news'),
    api.get('/api/admin/content/term_date'), api.get('/api/admin/content/album'),
    api.get('/api/admin/documents'),
  ]);
  const count = (r, key, pred) => (r.data[key] || []).filter(pred || (() => true)).length;
  const published = x => x.status === 'published';

  el.innerHTML = `
    <div class="metric-grid">
      <div class="metric-card"><small>Published notices</small><strong>${count(notices,'items',published)}</strong><span>${count(notices,'items')} total</span></div>
      <div class="metric-card"><small>Published news</small><strong>${count(news,'items',published)}</strong><span>${count(news,'items')} total</span></div>
      <div class="metric-card"><small>Calendar entries</small><strong>${count(dates,'items',published)}</strong><span>${count(dates,'items')} total</span></div>
      <div class="metric-card"><small>Documents</small><strong>${count(docs,'documents',published)}</strong><span>${count(docs,'documents')} total</span></div>
    </div>
    <div class="admin-card">
      <h4>Signed in as</h4>
      <p style="font-size:.85rem;color:var(--admin-muted,#6e6376)">${ME.name ? esc(ME.name) + ' · ' : ''}${esc(ME.email)} · role: <b>${esc(ME.role)}</b></p>
      <p style="font-size:.8rem;color:var(--admin-muted,#6e6376);margin-top:10px">Use the sections on the left to manage notices, term dates, news, gallery albums, documents, website pages and contact details. ${ME.role === 'SUPER_ADMIN' ? 'As Super Admin you can also manage staff and parent accounts, review the audit log, and adjust settings.' : ''}</p>
    </div>`;
}

/* ============================================================================
   Generic content section: notice / news / term_date
   ============================================================================ */

const KIND_LABELS = { opening: 'Term opening', closing: 'Term closing', holiday: 'Holiday', event: 'Event', reminder: 'Reminder' };

function contentFormHTML(cfg, editing){
  const v = editing || {};
  return `
    <form id="contentForm" class="admin-form">
      <input type="hidden" name="id" value="${esc(v.id || '')}"/>
      <div class="form-row-2">
        <label>Title<input name="title" required value="${esc(v.title || '')}" placeholder="e.g. ${cfg.label === 'calendar entry' ? 'Term 4 begins' : 'Title'}"/></label>
        <label>Category<input name="category" value="${esc(v.category || '')}" placeholder="Optional"/></label>
      </div>
      ${cfg.hasKind ? `<label>Type<select name="kind">${Object.entries(KIND_LABELS).map(([k,l]) => `<option value="${k}" ${v.kind===k?'selected':''}>${l}</option>`).join('')}</select></label>` : ''}
      ${cfg.hasDates ? `<div class="form-row-2"><label>Start date<input type="date" name="startDate" value="${esc((v.start_date||'').slice(0,10))}"/></label><label>End date <span class="optional">(optional)</span><input type="date" name="endDate" value="${esc((v.end_date||'').slice(0,10))}"/></label></div>` : ''}
      <label>Summary<textarea name="summary" rows="2" placeholder="Short summary shown in lists">${esc(v.summary || '')}</textarea></label>
      ${cfg.hasBody ? `<label>Full content<textarea name="body" rows="5" placeholder="Full text — basic formatting only, no raw HTML">${esc(v.body || '')}</textarea></label>` : ''}
      <label>Visibility<select name="visibility"><option value="public" ${v.visibility==='public'?'selected':''}>Public — anyone on the website</option><option value="parents" ${(v.visibility||cfg.defaultVisibility)==='parents'?'selected':''}>Parents only — requires sign-in</option></select></label>
      <div class="admin-actions">
        <button type="submit" class="admin-btn primary">${v.id ? 'Save changes' : 'Create draft'}</button>
        ${v.id ? '<button type="button" class="admin-btn" id="cancelEditBtn">Cancel</button>' : ''}
      </div>
      <p class="form-status" id="contentFormStatus"></p>
    </form>`;
}

async function renderContentSection(el, type, cfg, editing){
  const res = await api.get(`/api/admin/content/${type}`);
  if (!res.ok) { el.innerHTML = `<div class="admin-card">${esc(apiErrorMessage(res))}</div>`; return; }
  const items = res.data.items || [];

  el.innerHTML = `
    <div class="admin-view-head"><h3>${editing ? 'Edit ' + cfg.label : 'Add a new ' + cfg.label}</h3></div>
    <div class="admin-card">${contentFormHTML(cfg, editing)}</div>
    <div class="admin-card">
      <table class="data-table"><thead><tr><th>Title</th>${cfg.hasKind ? '<th>Type</th>' : ''}${cfg.hasDates ? '<th>Dates</th>' : ''}<th>Status</th><th>Visibility</th><th>Updated</th><th>Actions</th></tr></thead>
      <tbody>${items.length ? items.map(i => `<tr>
        <td><b>${esc(i.title)}</b>${i.category ? `<br><small>${esc(i.category)}</small>` : ''}</td>
        ${cfg.hasKind ? `<td>${esc(KIND_LABELS[i.kind] || i.kind || '—')}</td>` : ''}
        ${cfg.hasDates ? `<td>${fmtDate(i.start_date)}${i.end_date ? ' – ' + fmtDate(i.end_date) : ''}</td>` : ''}
        <td>${statusPill(i.status)}</td>
        <td>${i.visibility === 'public' ? 'Public' : 'Parents only'}</td>
        <td>${fmtDate(i.published_at || i.archived_at)}</td>
        <td class="row-actions">
          <button class="admin-btn" data-edit="${i.id}">Edit</button>
          ${i.status !== 'published' ? `<button class="admin-btn" data-publish="${i.id}">Publish</button>` : `<button class="admin-btn" data-unpublish="${i.id}">Unpublish</button>`}
          ${i.status !== 'archived' ? `<button class="admin-btn" data-archive="${i.id}">Archive</button>` : ''}
        </td>
      </tr>`).join('') : `<tr><td colspan="6" class="empty-state">No ${cfg.label}s yet.</td></tr>`}</tbody></table>
    </div>`;

  $('#contentForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const id = fd.get('id');
    const body = { title: fd.get('title'), category: fd.get('category'), summary: fd.get('summary'), visibility: fd.get('visibility') };
    if (cfg.hasBody) body.body = fd.get('body');
    if (cfg.hasKind) body.kind = fd.get('kind');
    if (cfg.hasDates) { body.startDate = fd.get('startDate'); body.endDate = fd.get('endDate'); }

    const result = id ? await api.patch(`/api/admin/content/item/${id}`, body) : await api.post(`/api/admin/content/${type}`, body);
    const statusEl = $('#contentFormStatus');
    if (!result.ok) { statusEl.textContent = apiErrorMessage(result, 'Please check the form and try again.'); return; }
    showToast(id ? 'Saved' : 'Draft created — remember to publish it');
    renderContentSection(el, type, cfg);
  });

  if (editing) $('#cancelEditBtn')?.addEventListener('click', () => renderContentSection(el, type, cfg));

  $$('[data-edit]').forEach(b => b.addEventListener('click', () => {
    const item = items.find(i => i.id === b.dataset.edit);
    renderContentSection(el, type, cfg, item);
  }));
  $$('[data-publish]').forEach(b => b.addEventListener('click', async () => {
    const r = await api.post(`/api/admin/content/item/${b.dataset.publish}/publish`);
    if (!r.ok) return showToast(apiErrorMessage(r));
    showToast('Published'); renderContentSection(el, type, cfg);
  }));
  $$('[data-unpublish]').forEach(b => b.addEventListener('click', async () => {
    const r = await api.post(`/api/admin/content/item/${b.dataset.unpublish}/unpublish`);
    if (!r.ok) return showToast(apiErrorMessage(r));
    showToast('Moved back to draft'); renderContentSection(el, type, cfg);
  }));
  $$('[data-archive]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Archive this item? It will be hidden from the website but not deleted.')) return;
    const r = await api.post(`/api/admin/content/item/${b.dataset.archive}/archive`);
    if (!r.ok) return showToast(apiErrorMessage(r));
    showToast('Archived'); renderContentSection(el, type, cfg);
  }));
}

/* ============================================================================
   Gallery: albums (content_items type=album) + photos within an album
   ============================================================================ */

async function renderAlbums(el, openAlbumId){
  if (openAlbumId) return renderAlbumPhotos(el, openAlbumId);

  const res = await api.get('/api/admin/content/album');
  const items = res.ok ? res.data.items : [];

  el.innerHTML = `
    <div class="admin-view-head"><h3>Create a new album</h3></div>
    <div class="admin-card">${contentFormHTML({ label: 'album', defaultVisibility: 'parents' })}</div>
    <div class="admin-card">
      <table class="data-table"><thead><tr><th>Album</th><th>Status</th><th>Visibility</th><th>Actions</th></tr></thead>
      <tbody>${items.length ? items.map(i => `<tr>
        <td><b>${esc(i.title)}</b></td><td>${statusPill(i.status)}</td><td>${i.visibility==='public'?'Public':'Parents only'}</td>
        <td class="row-actions">
          <button class="admin-btn" data-open="${i.id}">Manage photos →</button>
          ${i.status !== 'published' ? `<button class="admin-btn" data-publish="${i.id}">Publish</button>` : `<button class="admin-btn" data-unpublish="${i.id}">Unpublish</button>`}
          ${i.status !== 'archived' ? `<button class="admin-btn" data-archive="${i.id}">Archive</button>` : ''}
        </td>
      </tr>`).join('') : '<tr><td colspan="4" class="empty-state">No albums yet.</td></tr>'}</tbody></table>
    </div>`;

  $('#contentForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const result = await api.post('/api/admin/content/album', { title: fd.get('title'), category: fd.get('category'), summary: fd.get('summary'), visibility: fd.get('visibility') });
    if (!result.ok) { $('#contentFormStatus').textContent = apiErrorMessage(result); return; }
    showToast('Album created — add photos, then publish it'); renderAlbums(el);
  });
  $$('[data-open]').forEach(b => b.addEventListener('click', () => renderAlbumPhotos(el, b.dataset.open)));
  $$('[data-publish]').forEach(b => b.addEventListener('click', async () => { await api.post(`/api/admin/content/item/${b.dataset.publish}/publish`); showToast('Published'); renderAlbums(el); }));
  $$('[data-unpublish]').forEach(b => b.addEventListener('click', async () => { await api.post(`/api/admin/content/item/${b.dataset.unpublish}/unpublish`); showToast('Moved back to draft'); renderAlbums(el); }));
  $$('[data-archive]').forEach(b => b.addEventListener('click', async () => { if(!confirm('Archive this album?')) return; await api.post(`/api/admin/content/item/${b.dataset.archive}/archive`); showToast('Archived'); renderAlbums(el); }));
}

async function renderAlbumPhotos(el, albumId){
  const res = await api.get(`/api/admin/albums/${albumId}/photos`);
  const photos = res.ok ? res.data.photos : [];

  el.innerHTML = `
    <div class="admin-view-head"><h3>Album photos</h3><button class="admin-btn" id="backToAlbums">← Back to albums</button></div>
    <div class="admin-card">
      <form id="photoUploadForm" class="admin-form">
        <label>Add a photo<input type="file" name="file" accept="image/jpeg,image/png,image/webp" required/></label>
        <label>Caption <span class="optional">(optional)</span><input name="caption" placeholder="e.g. Sports day 2026"/></label>
        <label>Visibility<select name="visibility"><option value="parents">Parents only</option><option value="public">Public</option></select></label>
        <div class="admin-actions"><button type="submit" class="admin-btn primary">Upload photo</button></div>
        <p class="form-status" id="photoFormStatus"></p>
      </form>
    </div>
    <div class="gallery-grid">${photos.length ? photos.map(p => `
      <div class="gallery-thumb ${p.status !== 'published' ? 'is-draft' : ''}">
        <img src="/api/files/${p.asset_id}" alt="${esc(p.caption || '')}" loading="lazy"/>
        <div class="gallery-thumb-meta">
          <small>${esc(p.caption || 'No caption')}</small>
          <div class="row-actions">
            ${p.status !== 'published' ? `<button class="admin-btn" data-photo-publish="${p.id}">Publish</button>` : `<button class="admin-btn" data-photo-unpublish="${p.id}">Unpublish</button>`}
            <button class="admin-btn" data-photo-remove="${p.id}">Remove</button>
          </div>
        </div>
      </div>`).join('') : '<p class="empty-state">No photos in this album yet.</p>'}</div>`;

  $('#backToAlbums').addEventListener('click', () => renderAlbums(el));

  $('#photoUploadForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const upFd = new FormData();
    upFd.append('file', fd.get('file'));
    upFd.append('visibility', fd.get('visibility'));
    const upRes = await api.upload('/api/admin/media', upFd);
    if (!upRes.ok) { $('#photoFormStatus').textContent = apiErrorMessage(upRes); return; }
    const addRes = await api.post(`/api/admin/albums/${albumId}/photos`, { assetId: upRes.data.asset.id, caption: fd.get('caption') });
    if (!addRes.ok) { $('#photoFormStatus').textContent = apiErrorMessage(addRes); return; }
    showToast('Photo added'); renderAlbumPhotos(el, albumId);
  });

  $$('[data-photo-publish]').forEach(b => b.addEventListener('click', async () => { await api.post(`/api/admin/albums/${albumId}/photos/${b.dataset.photoPublish}/status`, { status: 'published' }); renderAlbumPhotos(el, albumId); }));
  $$('[data-photo-unpublish]').forEach(b => b.addEventListener('click', async () => { await api.post(`/api/admin/albums/${albumId}/photos/${b.dataset.photoUnpublish}/status`, { status: 'draft' }); renderAlbumPhotos(el, albumId); }));
  $$('[data-photo-remove]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Remove this photo from the album?')) return;
    await api.post(`/api/admin/albums/${albumId}/photos/${b.dataset.photoRemove}/soft-delete`);
    showToast('Photo removed'); renderAlbumPhotos(el, albumId);
  }));
}

/* ============================================================================
   Documents
   ============================================================================ */

async function renderDocuments(el){
  const res = await api.get('/api/admin/documents');
  const docs = res.ok ? res.data.documents : [];

  el.innerHTML = `
    <div class="admin-view-head"><h3>Upload a new document</h3></div>
    <div class="admin-card">
      <form id="docForm" class="admin-form">
        <div class="form-row-2">
          <label>Title<input name="title" required placeholder="e.g. Parent Handbook"/></label>
          <label>Category<input name="category" placeholder="e.g. Handbook"/></label>
        </div>
        <label>Description<textarea name="description" rows="2"></textarea></label>
        <div class="form-row-2">
          <label>Date<input type="date" name="docDate"/></label>
          <label>Visibility<select name="visibility"><option value="parents">Parents only</option><option value="public">Public</option></select></label>
        </div>
        <label>PDF file<input type="file" name="file" accept="application/pdf" required/></label>
        <div class="admin-actions"><button type="submit" class="admin-btn primary">Upload document</button></div>
        <p class="form-status" id="docFormStatus"></p>
      </form>
    </div>
    <div class="admin-card">
      <table class="data-table"><thead><tr><th>Document</th><th>Status</th><th>Visibility</th><th>Actions</th></tr></thead>
      <tbody>${docs.length ? docs.map(d => `<tr>
        <td><b>${esc(d.title)}</b>${d.category ? `<br><small>${esc(d.category)}</small>` : ''}</td>
        <td>${statusPill(d.status)}</td>
        <td>${d.visibility === 'public' ? 'Public' : 'Parents only'}</td>
        <td class="row-actions">
          ${d.status !== 'published' ? `<button class="admin-btn" data-doc-publish="${d.id}">Publish</button>` : `<button class="admin-btn" data-doc-unpublish="${d.id}">Unpublish</button>`}
          ${d.status !== 'archived' ? `<button class="admin-btn" data-doc-archive="${d.id}">Archive</button>` : ''}
          <label class="admin-btn replace-file-btn">Replace file<input type="file" accept="application/pdf" data-doc-replace="${d.id}" hidden/></label>
        </td>
      </tr>`).join('') : '<tr><td colspan="4" class="empty-state">No documents uploaded yet. The six original placeholder PDFs remain unpublished — see CONTENT-CHECKLIST.md.</td></tr>'}</tbody></table>
    </div>`;

  $('#docForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const upFd = new FormData(); upFd.append('file', fd.get('file')); upFd.append('visibility', fd.get('visibility'));
    const upRes = await api.upload('/api/admin/media', upFd);
    if (!upRes.ok) { $('#docFormStatus').textContent = apiErrorMessage(upRes); return; }
    const verRes = await api.post('/api/admin/documents/versions', {
      title: fd.get('title'), category: fd.get('category'), description: fd.get('description'),
      docDate: fd.get('docDate'), visibility: fd.get('visibility'), assetId: upRes.data.asset.id,
    });
    if (!verRes.ok) { $('#docFormStatus').textContent = apiErrorMessage(verRes); return; }
    showToast('Document uploaded — remember to publish it'); renderDocuments(el);
  });

  $$('[data-doc-publish]').forEach(b => b.addEventListener('click', async () => { await api.post(`/api/admin/documents/${b.dataset.docPublish}/status`, { status: 'published' }); showToast('Published'); renderDocuments(el); }));
  $$('[data-doc-unpublish]').forEach(b => b.addEventListener('click', async () => { await api.post(`/api/admin/documents/${b.dataset.docUnpublish}/status`, { status: 'draft' }); showToast('Moved back to draft'); renderDocuments(el); }));
  $$('[data-doc-archive]').forEach(b => b.addEventListener('click', async () => { if(!confirm('Archive this document?')) return; await api.post(`/api/admin/documents/${b.dataset.docArchive}/status`, { status: 'archived' }); showToast('Archived'); renderDocuments(el); }));
  $$('[data-doc-replace]').forEach(input => input.addEventListener('change', async () => {
    const file = input.files[0]; if (!file) return;
    const documentId = input.dataset.docReplace;
    const upFd = new FormData(); upFd.append('file', file); upFd.append('visibility', 'parents');
    const upRes = await api.upload('/api/admin/media', upFd);
    if (!upRes.ok) return showToast(apiErrorMessage(upRes));
    const verRes = await api.post('/api/admin/documents/versions', { documentId, assetId: upRes.data.asset.id, note: 'Replaced from dashboard' });
    if (!verRes.ok) return showToast(apiErrorMessage(verRes));
    showToast('New version uploaded — previous version kept in history'); renderDocuments(el);
  }));
}

/* ============================================================================
   Website pages (structured fields only — no raw HTML editor)
   ============================================================================ */

const PAGE_FIELDS = [
  { key: 'home.announcement', label: 'Homepage announcement banner', type: 'text' },
  { key: 'home.hero.headline', label: 'Homepage hero headline', type: 'text' },
  { key: 'home.hero.body', label: 'Homepage hero supporting text', type: 'textarea' },
  { key: 'about.body', label: 'About page', type: 'textarea' },
  { key: 'admissions.body', label: 'Admissions information', type: 'textarea' },
];

async function renderPages(el){
  const res = await api.get('/api/admin/site-content');
  const content = res.ok ? res.data.content : {};

  el.innerHTML = `
    <div class="admin-view-head"><h3>Edit structured page content</h3></div>
    <p style="font-size:.8rem;color:var(--admin-muted,#6e6376);margin:-6px 0 18px">These fields override specific parts of the homepage and pages. There is no raw-HTML editor — only plain text fields, sanitised on save.</p>
    ${PAGE_FIELDS.map(f => `
      <div class="admin-card">
        <form class="admin-form page-field-form" data-key="${f.key}">
          <label>${esc(f.label)}${f.type === 'textarea'
            ? `<textarea name="value" rows="4">${esc(content[f.key] || '')}</textarea>`
            : `<input name="value" value="${esc(content[f.key] || '')}"/>`}</label>
          <div class="admin-actions"><button type="submit" class="admin-btn primary">Save</button></div>
          <p class="form-status"></p>
        </form>
      </div>`).join('')}`;

  $$('.page-field-form').forEach(form => form.addEventListener('submit', async e => {
    e.preventDefault();
    const value = new FormData(e.target).get('value');
    const result = await api.post(`/api/admin/site-content/${form.dataset.key}`, { value });
    const statusEl = form.querySelector('.form-status');
    statusEl.textContent = result.ok ? 'Saved ✓' : apiErrorMessage(result);
  }));
}

/* ============================================================================
   Contacts & school information (the one delegable capability: contacts.edit)
   ============================================================================ */

async function renderContacts(el){
  const res = await api.get('/api/admin/site-content');
  const details = (res.ok && res.data.content['contact.details']) || {};

  el.innerHTML = `
    <div class="admin-view-head"><h3>Contact details shown on the website</h3></div>
    ${ME.role === 'STAFF_ADMIN' ? '<p style="font-size:.8rem;color:var(--admin-muted,#6e6376);margin:-6px 0 18px">Editing contact details requires a permission grant from a Super Admin. You can still view the current values below.</p>' : ''}
    <div class="admin-card">
      <form id="contactForm" class="admin-form">
        <div class="form-row-2">
          <label>Phone<input name="phone" value="${esc(details.phone || '')}"/></label>
          <label>WhatsApp number<input name="whatsapp" value="${esc(details.whatsapp || '')}"/></label>
        </div>
        <div class="form-row-2">
          <label>Email<input name="email" value="${esc(details.email || '')}"/></label>
          <label>Office hours<input name="hours" value="${esc(details.hours || '')}"/></label>
        </div>
        <label>Address<input name="address" value="${esc(details.address || '')}"/></label>
        <div class="admin-actions"><button type="submit" class="admin-btn primary">Save contact details</button></div>
        <p class="form-status" id="contactFormStatus"></p>
      </form>
    </div>
    <p style="font-size:.78rem;color:var(--admin-muted,#6e6376)">Note: this is the CMS record of contact details. The live website currently reads its numbers from <code>src/siteConfig.js</code> until that file is switched to read from here.</p>`;

  $('#contactForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const value = { phone: fd.get('phone'), whatsapp: fd.get('whatsapp'), email: fd.get('email'), hours: fd.get('hours'), address: fd.get('address') };
    const result = await api.post('/api/admin/site-content/contact.details', { value });
    $('#contactFormStatus').textContent = result.ok ? 'Saved ✓' : apiErrorMessage(result, 'You do not have permission to edit contacts — ask a Super Admin to grant this.');
  });
}

/* ============================================================================
   Accounts: parents and staff
   ============================================================================ */

function accountsTableHTML(users, isParent){
  return `<table class="data-table"><thead><tr><th>Name</th><th>Email</th>${!isParent ? '<th>Role</th>' : ''}<th>Status</th><th>Last sign-in</th><th>Actions</th></tr></thead>
      <tbody>${users.length ? users.map(u => `<tr>
        <td><b>${esc(u.name || '—')}</b></td><td>${esc(u.email)}</td>
        ${!isParent ? `<td>${u.role === 'SUPER_ADMIN' ? 'Super Admin' : 'Staff Admin'}</td>` : ''}
        <td>${statusPill(u.status)}</td><td>${fmtDate(u.lastLoginAt)}</td>
        <td class="row-actions">
          ${u.status === 'active'
            ? (u.id === ME.id ? '' : `<button class="admin-btn" data-deactivate="${u.id}">Deactivate</button>`)
            : `<button class="admin-btn" data-reactivate="${u.id}">Reactivate</button>`}
          ${!isParent && ME.role === 'SUPER_ADMIN' && u.role === 'STAFF_ADMIN' ? `<button class="admin-btn" data-grant-contacts="${u.id}">Grant contacts edit</button><button class="admin-btn" data-revoke-contacts="${u.id}">Revoke</button>` : ''}
        </td>
      </tr>`).join('') : `<tr><td colspan="6" class="empty-state">No ${isParent ? 'parent' : 'staff'} accounts yet.</td></tr>`}</tbody></table>`;
}

function bindAccountRowActions(tableEl, kind){
  $$('[data-deactivate]', tableEl).forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Deactivate this account? They will be signed out immediately.')) return;
    const r = await api.post(`/api/admin/accounts/${b.dataset.deactivate}/status`, { status: 'deactivated' });
    if (!r.ok) return showToast(apiErrorMessage(r));
    showToast('Account deactivated'); refreshAccountsTable(tableEl, kind);
  }));
  $$('[data-reactivate]', tableEl).forEach(b => b.addEventListener('click', async () => {
    const r = await api.post(`/api/admin/accounts/${b.dataset.reactivate}/status`, { status: 'active' });
    if (!r.ok) return showToast(apiErrorMessage(r));
    showToast('Account reactivated'); refreshAccountsTable(tableEl, kind);
  }));
  $$('[data-grant-contacts]', tableEl).forEach(b => b.addEventListener('click', async () => {
    const r = await api.post(`/api/admin/accounts/permission/${b.dataset.grantContacts}`, { capability: 'contacts.edit', grant: true });
    showToast(r.ok ? 'Permission granted' : apiErrorMessage(r));
  }));
  $$('[data-revoke-contacts]', tableEl).forEach(b => b.addEventListener('click', async () => {
    const r = await api.post(`/api/admin/accounts/permission/${b.dataset.revokeContacts}`, { capability: 'contacts.edit', grant: false });
    showToast(r.ok ? 'Permission revoked' : apiErrorMessage(r));
  }));
}

async function refreshAccountsTable(tableEl, kind){
  const isParent = kind === 'PARENT';
  const res = await api.get(isParent ? '/api/admin/parents' : '/api/admin/staff');
  tableEl.innerHTML = accountsTableHTML(res.ok ? res.data.users : [], isParent);
  bindAccountRowActions(tableEl, kind);
}

async function renderAccounts(el, kind){
  const isParent = kind === 'PARENT';
  const invitePath = isParent ? '/api/admin/parents/invite' : '/api/admin/staff/invite';
  const res = await api.get(isParent ? '/api/admin/parents' : '/api/admin/staff');
  const users = res.ok ? res.data.users : [];

  el.innerHTML = `
    <div class="admin-view-head"><h3>Invite a ${isParent ? 'parent' : 'staff member'}</h3></div>
    <div class="admin-card">
      <form id="inviteForm" class="admin-form">
        <div class="form-row-2">
          <label>Email<input type="email" name="email" required/></label>
          <label>Name <span class="optional">(optional)</span><input name="name"/></label>
        </div>
        ${!isParent && ME.role === 'SUPER_ADMIN' ? `<label>Role<select name="role"><option value="STAFF_ADMIN">Staff Admin / Editor</option><option value="SUPER_ADMIN">Super Admin</option></select></label>` : ''}
        <div class="admin-actions"><button type="submit" class="admin-btn primary">Send invitation</button></div>
        <p class="form-status" id="inviteFormStatus"></p>
        <div id="inviteLinkBox" hidden></div>
      </form>
    </div>
    <div class="admin-card" id="accountsTable">${accountsTableHTML(users, isParent)}</div>`;

  bindAccountRowActions($('#accountsTable'), kind);

  $('#inviteForm').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = { email: fd.get('email'), name: fd.get('name') };
    if (!isParent) body.role = fd.get('role') || 'STAFF_ADMIN';
    const result = await api.post(invitePath, body);
    const statusEl = $('#inviteFormStatus'), linkBox = $('#inviteLinkBox');
    if (!result.ok) { statusEl.textContent = apiErrorMessage(result); linkBox.hidden = true; return; }
    statusEl.textContent = '';
    const link = `${location.origin}/accept-invitation.html?token=${encodeURIComponent(result.data.invitationToken)}`;
    linkBox.hidden = false;
    linkBox.innerHTML = `<p class="form-status">Invitation created. Since email delivery is not configured yet, send this link to them yourself over a channel they control — it expires ${fmtDate(result.data.expiresAt)}.</p><input readonly value="${esc(link)}" onclick="this.select()"/>`;
    // Refresh only the table below — replacing the whole view here would wipe
    // the invite link before anyone could read or copy it.
    refreshAccountsTable($('#accountsTable'), kind);
  });
}

/* ============================================================================
   Audit log
   ============================================================================ */

async function renderAudit(el, cursor){
  const res = await api.get(`/api/admin/audit${cursor ? `?cursor=${cursor}` : ''}`);
  if (!res.ok) { el.innerHTML = `<div class="admin-card">${esc(apiErrorMessage(res))}</div>`; return; }
  const { entries, nextCursor } = res.data;

  el.innerHTML = `
    <div class="admin-view-head"><h3>Audit log</h3></div>
    <div class="admin-card">
      <table class="data-table"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Record</th><th>Details</th></tr></thead>
      <tbody>${entries.length ? entries.map(a => `<tr>
        <td>${new Date(a.created_at).toLocaleString()}</td>
        <td>${esc(a.actor_email || 'system')}</td>
        <td>${esc(a.action)}</td>
        <td>${a.entity_type ? `${esc(a.entity_type)} · <small>${esc(a.entity_id || '')}</small>` : '—'}</td>
        <td><small>${esc(a.summary || '')}</small></td>
      </tr>`).join('') : '<tr><td colspan="5" class="empty-state">No entries yet.</td></tr>'}</tbody></table>
      ${nextCursor ? `<div class="admin-actions"><button class="admin-btn" id="auditMoreBtn">Load older entries</button></div>` : ''}
    </div>`;
  $('#auditMoreBtn')?.addEventListener('click', () => renderAudit(el, nextCursor));
}

/* ============================================================================
   Settings (minimal — most configuration lives in Cloudflare/Wrangler)
   ============================================================================ */

async function renderSettings(el){
  const health = await (await fetch('/api/health')).json().catch(() => ({}));
  el.innerHTML = `
    <div class="admin-view-head"><h3>System status</h3></div>
    <div class="admin-card">
      <table class="data-table">
        <tbody>
          <tr><td>Accounts database</td><td>${health.accountsConfigured ? statusPill('active') : statusPill('deactivated')}</td></tr>
          <tr><td>Media storage</td><td>${health.mediaConfigured ? statusPill('active') : statusPill('deactivated')}</td></tr>
          <tr><td>Enquiry email delivery</td><td>${health.emailConfigured ? statusPill('active') : statusPill('deactivated')}</td></tr>
          <tr><td>Spam protection (Turnstile)</td><td>${health.turnstileConfigured ? statusPill('active') : statusPill('deactivated')}</td></tr>
        </tbody>
      </table>
      <p style="font-size:.78rem;color:var(--admin-muted,#6e6376);margin-top:14px">Sensitive settings (secrets, database and storage bindings) are configured in Cloudflare, not in this dashboard — see DEPLOYMENT.md and ACCOUNT-SYSTEM-PLAN.md.</p>
    </div>`;
}

/* ============================================================================
   Content checklist (unchanged from the pre-launch content-safety pass)
   ============================================================================ */

function renderChecklist(el){
  el.innerHTML = checklistView();
}
const CONTENT_CHECKLIST=[
 {group:'Documents',note:'The six PDFs were ~850-byte placeholders. They are no longer published, and each card on the homepage opens a request dialog instead of downloading a file.',items:[
  {t:'School prospectus',d:'Supply the real PDF, then re-enable its download card.',done:false},
  {t:'Fee structure',d:'Supply the real PDF, then re-enable its download card.',done:false},
  {t:'Application form',d:'Supply the real PDF, then re-enable its download card.',done:false},
  {t:'School calendar',d:'Supply the real PDF, then re-enable its download card.',done:false},
  {t:'Uniform guide',d:'Supply the real PDF, then re-enable its download card.',done:false},
  {t:'Parent handbook',d:'Supply the real PDF, then re-enable its download card.',done:false}]},
 {group:'Dates',note:'No term dates, event dates or application deadlines are published, because none were confirmed.',items:[
  {t:'Term start and end dates',d:'The events card shows "Term dates are being confirmed" until these arrive.',done:false},
  {t:'Open day / school tour dates',d:'Four unconfirmed events were removed.',done:false},
  {t:'Application deadline',d:'A countdown to 1 September 2026 was removed. Confirm whether a deadline exists.',done:false},
  {t:'News article publication dates',d:'The two article dates were invented and have been removed.',done:false}]},
 {group:'School facts',note:'Removed because no source exists for them. Supply only figures the school can stand behind in writing.',items:[
  {t:'Number of enrichment programmes',d:'"6+ Enrichments" removed.',done:false},
  {t:'Teacher-to-pupil ratio',d:'"1:12 Teacher ratio" removed.',done:false},
  {t:'Replacement for "100% Curiosity"',d:'Now reads "Curiosity encouraged every day." Editable in src/legacyMarkup.js.',done:true}]},
 {group:'Contact details',note:'All contact details come from one file — src/siteConfig.js. Edit there and the whole site updates together.',items:[
  {t:'WhatsApp +48 791 753 077',d:'Confirmed by the site owner as the parent-enquiry number.',done:true},
  {t:'Phone +263 773 072 639',d:'On the school banner and in the site structured data. Used by "Call the office".',done:true},
  {t:'Phone +48 572 630 737',d:'Unconfirmed — remove from siteConfig.js if not in use.',done:false},
  {t:'Email jeretarisaibee@gmail.com',d:'Unconfirmed — remove from siteConfig.js if not in use.',done:false},
  {t:'Office hours Mon-Fri 07:00-16:30',d:'Unconfirmed — please verify.',done:false}]},
 {group:'Accounts and sign-in',note:'Real server-side authentication now exists (hashed passwords, HttpOnly sessions, real permission checks) — but nothing works until D1/R2 exist and the Super Admin account is bootstrapped. See ACCOUNT-SYSTEM-PLAN.md.',items:[
  {t:'Real sign-in is built and tested',d:'PBKDF2 password hashing, HttpOnly session cookies, per-role permission checks — 95 automated tests pass locally. Not yet deployed.',done:true},
  {t:'Create the D1 database and R2 bucket',d:'npx wrangler d1 create / r2 bucket create, then uncomment the bindings in wrangler.toml.',done:false},
  {t:'Bootstrap the Super Admin account',d:'One-time procedure for the configured SUPER_ADMIN_EMAIL — see ACCOUNT-SYSTEM-PLAN.md section 9. No account exists yet.',done:false},
  {t:'Invite staff and parent accounts',d:'Invite-only. Nobody can self-register.',done:false}]},
 {group:'Before enquiries can reach the school',note:'The enquiry forms send nothing right now, by instruction, and say so honestly rather than faking a success message. The API endpoint exists and is tested — it is switched off until these are set.',items:[
  {t:'Confirm the official admissions inbox',d:'BLOCKING. Set ENQUIRY_TO to a mailbox someone checks daily. Every website enquiry would go there.',done:false},
  {t:'Verify a sending domain with Resend',d:'Add the SPF, DKIM and DMARC records, then set ENQUIRY_FROM. See DEPLOYMENT.md section 4.',done:false},
  {t:'Add the Resend API key as a Worker secret',d:'wrangler secret put RESEND_API_KEY. Never commit it.',done:false},
  {t:'Turn on Cloudflare Turnstile',d:'Spam verification is skipped until TURNSTILE_SECRET_KEY is set.',done:false},
  {t:'Send one real test enquiry end to end',d:'Confirm it arrives, check the spam folder, and reply to test the reply-to address.',done:false}]}];

function checklistView(){
  const all=CONTENT_CHECKLIST.flatMap(g=>g.items),done=all.filter(i=>i.done).length,left=all.length-done;
  const badge=document.getElementById('checklistCount');if(badge)badge.textContent=left||'';
  return `<div class="admin-card checklist-intro"><h4>${left} item${left===1?'':'s'} still need real school content</h4>
    <p>Each item below was removed, disabled or made non-specific before launch because it could not be verified. Nothing is broken &mdash; the site simply does not claim anything the school has not confirmed. The full version of this list is in <code>CONTENT-CHECKLIST.md</code>.</p></div>`
    +CONTENT_CHECKLIST.map(g=>`<div class="admin-card"><h4>${g.group} <span class="checklist-progress">${g.items.filter(i=>i.done).length}/${g.items.length} done</span></h4>
      ${g.note?`<p class="checklist-note">${g.note}</p>`:''}
      <ul class="checklist">${g.items.map(i=>`<li class="${i.done?'is-done':''}"><span class="checklist-box" aria-hidden="true">${i.done?'\u2713':''}</span><div><b>${i.t}</b><small>${i.d}</small></div></li>`).join('')}</ul></div>`).join('');
}

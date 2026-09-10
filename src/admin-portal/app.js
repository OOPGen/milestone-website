/* Super Admin portal — minimal secure content editor.

   Auth: Supabase Auth (email + password). Data: direct table reads/writes
   with the Super Admin's own JWT, gated by the RLS policies already applied
   (supabase/policies/*). No custom backend, no Edge Function, no
   service-role key. Every write is audited by the database trigger in
   supabase/migrations/20260101000011_content_audit_trigger.sql.

   This file is a Phase 2 entry (admin-portal.html) and is NOT part of the
   Phase 1 public build (vite.config.phase1.js does not list it). */

import { getSupabaseClient } from '../supabase/client.js';
import { evaluateAccess, accessMessage } from './auth.js';
import {
  CONTENT_TYPES, CONTENT_TYPE_KEYS, buildRow,
  publishPatch, unpublishPatch, archivePatch, softDeletePatch,
  kvPublishPatch, kvUnpublishPatch,
} from './content.js';

const supabase = getSupabaseClient();
const root = document.getElementById('app');

const state = {
  view: 'loading',      // loading | login | dashboard
  session: null,
  profile: null,
  error: '',
  notice: '',
  busy: false,
  activeType: CONTENT_TYPE_KEYS[0],
  rows: [],
  editing: null,        // null | {} (new) | existing row
  showAudit: false,
  audit: [],
};

/* ---- tiny DOM helper ------------------------------------------------- */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/* ---- lifecycle ---------------------------------------------------------- */
async function init() {
  if (!supabase) {
    state.view = 'login';
    state.error = 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local, then rebuild.';
    return render();
  }
  supabase.auth.onAuthStateChange((_event, session) => { refresh(session); });
  const { data } = await supabase.auth.getSession();
  await refresh(data?.session ?? null);
}

async function refresh(session) {
  state.session = session;
  state.editing = null;
  state.showAudit = false;
  if (!session) {
    state.view = 'login';
    state.profile = null;
    return render();
  }
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id,email,name,role,status')
    .eq('id', session.user.id)
    .maybeSingle();
  state.profile = profile ?? null;
  const access = evaluateAccess({ session, profile: state.profile });
  if (!access.allowed) {
    state.error = accessMessage(access.reason) + (error ? ` (${error.message})` : '');
    await supabase.auth.signOut();   // triggers onAuthStateChange -> refresh(null)
    return;
  }
  state.view = 'dashboard';
  state.error = '';
  await loadList();
}

/* ---- data ------------------------------------------------------------- */
async function loadList() {
  const type = CONTENT_TYPES[state.activeType];
  state.busy = true; render();
  const { data, error } = await supabase
    .from(type.table)
    .select('*')
    .order(type.orderBy.column, { ascending: type.orderBy.ascending });
  state.rows = data ?? [];
  state.error = error ? error.message : '';
  state.busy = false;
  render();
}

async function loadAudit() {
  state.busy = true; render();
  const { data, error } = await supabase
    .from('audit_log')
    .select('created_at,actor_email,action,entity_type,entity_id,summary')
    .order('created_at', { ascending: false })
    .limit(50);
  state.audit = data ?? [];
  state.error = error ? error.message : '';
  state.busy = false;
  render();
}

async function write(fn) {
  state.busy = true; state.error = ''; state.notice = ''; render();
  const { error } = await fn();
  state.busy = false;
  if (error) { state.error = error.message; render(); return false; }
  state.notice = 'Saved.';
  state.editing = null;
  await loadList();
  return true;
}

function saveRow(formValues) {
  const type = CONTENT_TYPES[state.activeType];
  let row;
  try { row = buildRow(state.activeType, formValues); }
  catch (e) { state.error = e.message; render(); return; }

  if (type.shape === 'kv') {
    if (state.editing && state.editing[type.idColumn]) {
      write(() => supabase.from(type.table).update(row).eq(type.idColumn, state.editing[type.idColumn]));
    } else {
      write(() => supabase.from(type.table).upsert(row, { onConflict: type.idColumn }));
    }
    return;
  }
  if (state.editing && state.editing.id) {
    write(() => supabase.from(type.table).update(row).eq('id', state.editing.id));
  } else {
    write(() => supabase.from(type.table).insert(row));
  }
}

function transition(row, patch) {
  const type = CONTENT_TYPES[state.activeType];
  write(() => supabase.from(type.table).update(patch).eq(type.idColumn, row[type.idColumn]));
}

function hardDelete(row) {
  const type = CONTENT_TYPES[state.activeType];
  if (!window.confirm(`Permanently delete this ${type.label.replace(/s$/, '').toLowerCase()}? This cannot be undone.`)) return;
  write(() => supabase.from(type.table).delete().eq(type.idColumn, row[type.idColumn]));
}

/* ---- views ---------------------------------------------------------- */
function render() {
  root.textContent = '';
  if (state.view === 'loading') { root.append(h('p', { class: 'muted', text: 'Loading…' })); return; }
  root.append(state.view === 'login' ? loginView() : dashboardView());
}

function loginView() {
  const wrap = h('div', { class: 'card login' });
  wrap.append(h('h1', { text: 'Super Admin portal' }));
  if (state.error) wrap.append(h('p', { class: 'error', text: state.error }));
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      state.error = '';
      state.busy = true; render();
      const email = form.email.value.trim();
      const password = form.password.value;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      state.busy = false;
      if (error) { state.error = error.message; render(); }
      // success -> onAuthStateChange -> refresh()
    },
  });
  form.append(
    h('label', {}, 'Email', h('input', { name: 'email', type: 'email', required: true, autocomplete: 'username' })),
    h('label', {}, 'Password', h('input', { name: 'password', type: 'password', required: true, autocomplete: 'current-password' })),
    h('button', { type: 'submit', disabled: state.busy || !supabase }, state.busy ? 'Signing in…' : 'Sign in'),
  );
  wrap.append(form);
  return wrap;
}

function dashboardView() {
  const wrap = h('div', { class: 'dash' });
  wrap.append(
    h('header', { class: 'topbar' },
      h('strong', { text: 'Super Admin portal' }),
      h('span', { class: 'muted', text: state.profile?.email ?? '' }),
      h('button', { class: 'linkbtn', onclick: () => supabase.auth.signOut() }, 'Sign out'),
    ),
  );

  const nav = h('nav', { class: 'tabs' });
  for (const key of CONTENT_TYPE_KEYS) {
    nav.append(h('button', {
      class: (!state.showAudit && key === state.activeType) ? 'tab active' : 'tab',
      onclick: () => { state.activeType = key; state.showAudit = false; state.editing = null; loadList(); },
    }, CONTENT_TYPES[key].label));
  }
  nav.append(h('button', {
    class: state.showAudit ? 'tab active' : 'tab',
    onclick: () => { state.showAudit = true; state.editing = null; loadAudit(); },
  }, 'Activity log'));
  wrap.append(nav);

  if (state.error) wrap.append(h('p', { class: 'error', text: state.error }));
  if (state.notice) wrap.append(h('p', { class: 'ok', text: state.notice }));
  if (state.busy) wrap.append(h('p', { class: 'muted', text: 'Working…' }));

  if (state.showAudit) { wrap.append(auditView()); return wrap; }
  if (state.editing) { wrap.append(formView()); return wrap; }
  wrap.append(listView());
  return wrap;
}

function statusBadge(row) {
  const s = row.deleted_at ? 'deleted' : (row.status ?? '—');
  return h('span', { class: `badge badge-${s}`, text: s });
}

function listView() {
  const type = CONTENT_TYPES[state.activeType];
  const box = h('section', { class: 'list' });
  box.append(h('div', { class: 'listhead' },
    h('h2', { text: type.label }),
    h('button', { class: 'primary', onclick: () => { state.editing = {}; state.error = ''; render(); } }, `New ${type.label.replace(/s$/, '')}`),
  ));
  if (!state.rows.length) box.append(h('p', { class: 'muted', text: 'Nothing here yet.' }));
  for (const row of state.rows) {
    const title = type.shape === 'kv' ? row.key : (row.title || '(untitled)');
    const actions = h('div', { class: 'rowactions' });
    actions.append(h('button', { onclick: () => { state.editing = row; state.error = ''; render(); } }, 'Edit'));
    if (type.canPublish) {
      const published = row.status === 'published';
      if (type.shape === 'kv') {
        actions.append(h('button', { onclick: () => transition(row, published ? kvUnpublishPatch() : kvPublishPatch()) }, published ? 'Unpublish' : 'Publish'));
      } else {
        actions.append(h('button', { onclick: () => transition(row, published ? unpublishPatch() : publishPatch()) }, published ? 'Unpublish' : 'Publish'));
      }
    }
    if (type.canArchive && row.status !== 'archived') actions.append(h('button', { onclick: () => transition(row, archivePatch()) }, 'Archive'));
    if (type.canSoftDelete && !row.deleted_at) actions.append(h('button', { onclick: () => transition(row, softDeletePatch()) }, 'Remove'));
    if (type.canHardDelete) actions.append(h('button', { class: 'danger', onclick: () => hardDelete(row) }, 'Delete'));
    box.append(h('div', { class: 'rowcard' },
      h('div', { class: 'rowmain' }, h('span', { class: 'rowtitle', text: String(title) }), statusBadge(row)),
      actions,
    ));
  }
  return box;
}

function formView() {
  const type = CONTENT_TYPES[state.activeType];
  const editing = state.editing && Object.keys(state.editing).length ? state.editing : null;
  const box = h('section', { class: 'card form' });
  box.append(h('h2', { text: `${editing ? 'Edit' : 'New'} ${type.label.replace(/s$/, '')}` }));
  const form = h('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const values = {};
      for (const field of type.fields) values[field.name] = form.elements[field.name]?.value ?? '';
      saveRow(values);
    },
  });
  for (const field of type.fields) {
    const disabled = editing && field.immutableOnEdit;
    let current = editing ? editing[field.name] : '';
    if (field.kind === 'json' && current != null && typeof current !== 'string') {
      current = JSON.stringify(current, null, 2);
    }
    let control;
    if (field.kind === 'select') {
      control = h('select', { name: field.name, disabled });
      for (const opt of field.options) {
        const o = h('option', { value: opt, text: opt });
        if (String(current || field.options[0]) === opt) o.selected = true;
        control.append(o);
      }
    } else if (field.kind === 'textarea' || field.kind === 'json') {
      control = h('textarea', { name: field.name, rows: field.kind === 'json' ? 8 : 4, disabled });
      control.value = current ?? '';
    } else {
      control = h('input', { name: field.name, type: field.kind === 'date' ? 'date' : 'text', disabled, required: field.required || false });
      control.value = current ?? '';
    }
    form.append(h('label', {}, field.name + (field.required ? ' *' : ''), control));
  }
  form.append(h('div', { class: 'formactions' },
    h('button', { type: 'submit', class: 'primary', disabled: state.busy }, 'Save'),
    h('button', { type: 'button', onclick: () => { state.editing = null; state.error = ''; render(); } }, 'Cancel'),
  ));
  box.append(form);
  return box;
}

function auditView() {
  const box = h('section', { class: 'list' });
  box.append(h('h2', { text: 'Activity log (latest 50)' }));
  if (!state.audit.length) box.append(h('p', { class: 'muted', text: 'No audit entries yet.' }));
  for (const a of state.audit) {
    box.append(h('div', { class: 'rowcard' },
      h('div', { class: 'rowmain' },
        h('span', { class: 'rowtitle', text: `${a.action} · ${a.entity_type}` }),
        h('span', { class: 'muted', text: new Date(a.created_at).toLocaleString() }),
      ),
      h('div', { class: 'muted', text: `${a.actor_email ?? 'system'} — ${a.summary ?? ''}` }),
    ));
  }
  return box;
}

init();

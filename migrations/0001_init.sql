-- Milestone Junior Level Up Academy — initial schema
--
-- SCOPE: a school WEBSITE with a small CMS and a read-only parent portal.
-- There is deliberately NO learner entity. No table here stores attendance,
-- marks, reports, fees, payments, medical, discipline or transport data, and
-- none should be added without a separate decision.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL,
  email_lower       TEXT NOT NULL UNIQUE,      -- lookups are case-insensitive
  name              TEXT NOT NULL DEFAULT '',
  role              TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN','STAFF_ADMIN','PARENT')),
  status            TEXT NOT NULL DEFAULT 'invited'
                      CHECK (status IN ('invited','active','deactivated')),
  -- PBKDF2 only, format: pbkdf2$sha256$<iterations>$<salt-b64url>$<hash-b64url>
  -- NULL until the user accepts an invitation and chooses a password.
  password_hash     TEXT,
  -- JSON array of extra capability grants, e.g. ["contacts.edit"]
  extra_permissions TEXT NOT NULL DEFAULT '[]',
  created_by        TEXT REFERENCES users(id),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  last_login_at     TEXT
);

CREATE INDEX idx_users_role   ON users(role);
CREATE INDEX idx_users_status ON users(status);

-- Invitations. The raw token is shown once and never stored.
CREATE TABLE invitations (
  id          TEXT PRIMARY KEY,
  email_lower TEXT NOT NULL,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN','STAFF_ADMIN','PARENT')),
  token_hash  TEXT NOT NULL UNIQUE,            -- sha256(raw token)
  expires_at  TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at  TEXT,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_invitations_email ON invitations(email_lower);

-- Sessions. Only the hash of the session token is stored, so a database leak
-- cannot be replayed as a live session.
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip           TEXT,
  user_agent   TEXT
);

CREATE INDEX idx_sessions_user    ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Login attempts, for rate limiting and for the audit trail.
CREATE TABLE login_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email_lower TEXT,
  ip          TEXT,
  ok          INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_attempts_email ON login_attempts(email_lower, created_at);
CREATE INDEX idx_attempts_ip    ON login_attempts(ip, created_at);

-- ---------------------------------------------------------------------------
-- Media
-- ---------------------------------------------------------------------------

-- Every uploaded object. Parent-only assets are NEVER served from a public URL;
-- they are streamed through /api/files/:id after an authorisation check.
CREATE TABLE assets (
  id           TEXT PRIMARY KEY,
  r2_key       TEXT NOT NULL UNIQUE,
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  width        INTEGER,
  height       INTEGER,
  visibility   TEXT NOT NULL DEFAULT 'parents' CHECK (visibility IN ('public','parents')),
  checksum     TEXT,
  created_by   TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL,
  deleted_at   TEXT
);

CREATE INDEX idx_assets_visibility ON assets(visibility);

-- ---------------------------------------------------------------------------
-- Content
-- ---------------------------------------------------------------------------

-- One table for every editorial item, discriminated by `type`.
--   notice     — parent announcements
--   news       — news article (public or parents)
--   event      — calendar event
--   term_date  — opening / closing / holiday / reminder (see `kind`)
--   album      — gallery album; its photos live in gallery_photos
CREATE TABLE content_items (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL CHECK (type IN ('notice','news','event','term_date','album')),
  kind         TEXT CHECK (kind IN ('opening','closing','holiday','event','reminder')),
  title        TEXT NOT NULL,
  slug         TEXT,
  summary      TEXT NOT NULL DEFAULT '',
  body         TEXT NOT NULL DEFAULT '',       -- sanitised rich text, never raw HTML from the client
  category     TEXT NOT NULL DEFAULT '',
  start_date   TEXT,                            -- ISO date for events / term dates
  end_date     TEXT,
  cover_asset_id TEXT REFERENCES assets(id),
  status       TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','published','archived')),
  visibility   TEXT NOT NULL DEFAULT 'parents'
                 CHECK (visibility IN ('public','parents')),
  created_by   TEXT REFERENCES users(id),
  updated_by   TEXT REFERENCES users(id),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  published_at TEXT,
  archived_at  TEXT,
  deleted_at   TEXT                             -- soft delete
);

CREATE INDEX idx_content_type      ON content_items(type, status, visibility);
CREATE INDEX idx_content_published ON content_items(published_at);
CREATE INDEX idx_content_dates     ON content_items(start_date);

CREATE TABLE gallery_photos (
  id         TEXT PRIMARY KEY,
  album_id   TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  asset_id   TEXT NOT NULL REFERENCES assets(id),
  caption    TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'published'
               CHECK (status IN ('draft','published','archived')),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX idx_photos_album ON gallery_photos(album_id, status);

-- ---------------------------------------------------------------------------
-- Documents (PDF only in v1)
-- ---------------------------------------------------------------------------

CREATE TABLE documents (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  category           TEXT NOT NULL DEFAULT '',
  description        TEXT NOT NULL DEFAULT '',
  doc_date           TEXT,
  visibility         TEXT NOT NULL DEFAULT 'parents'
                       CHECK (visibility IN ('public','parents')),
  status             TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','published','archived')),
  current_version_id TEXT,
  created_by         TEXT REFERENCES users(id),
  updated_by         TEXT REFERENCES users(id),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  published_at       TEXT,
  archived_at        TEXT,
  deleted_at         TEXT
);

CREATE INDEX idx_documents_status ON documents(status, visibility);

-- Replacing a document adds a version; older versions are retained for audit.
CREATE TABLE document_versions (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  asset_id    TEXT NOT NULL REFERENCES assets(id),
  version     INTEGER NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  uploaded_by TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL,
  UNIQUE (document_id, version)
);

-- ---------------------------------------------------------------------------
-- Structured page content and settings
-- ---------------------------------------------------------------------------

-- Structured fields only. There is no raw-HTML editor: `value_json` holds
-- typed fields, and any rich text is sanitised before storage.
CREATE TABLE site_content (
  key        TEXT PRIMARY KEY,                  -- e.g. 'home.hero.headline'
  value_json TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'published'
               CHECK (status IN ('draft','published','archived')),
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

-- Append-only. There is deliberately no column that could hold a password,
-- token, session value or API key, and the writer strips secret-looking fields.
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    TEXT REFERENCES users(id),
  actor_email TEXT,
  action      TEXT NOT NULL,                    -- e.g. 'auth.login', 'content.publish'
  entity_type TEXT,
  entity_id   TEXT,
  summary     TEXT NOT NULL DEFAULT '',
  ip          TEXT,
  user_agent  TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_audit_created ON audit_log(created_at);
CREATE INDEX idx_audit_actor   ON audit_log(actor_id);
CREATE INDEX idx_audit_action  ON audit_log(action);

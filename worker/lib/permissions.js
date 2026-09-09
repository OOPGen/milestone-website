/* The ONLY place roles are interpreted.

   Routes declare the capability they need; nothing anywhere else should test
   `role === 'SUPER_ADMIN'`. Default is deny: a capability that is not listed
   for a role is refused. */

export const ROLES = ['SUPER_ADMIN', 'STAFF_ADMIN', 'PARENT'];

const PARENT = [
  'content.read.public',
  'content.read.parent',
  'documents.download.parent',
  'profile.self.edit',
];

const STAFF_ADMIN = [
  ...PARENT,
  'content.create',
  'content.update',
  'content.publish',
  'content.archive',
  'media.upload',
  'media.archive',
  'documents.manage',
  'pages.edit',
  'parents.manage',
  // NOT: staff.manage, roles.assign, audit.read, settings.manage,
  //      content.delete.hard, contacts.edit (per-user grant only)
];

const SUPER_ADMIN = [
  ...STAFF_ADMIN,
  'contacts.edit',
  'content.delete.hard',
  'staff.manage',
  'roles.assign',
  'audit.read',
  'settings.manage',
];

const MATRIX = {
  SUPER_ADMIN: new Set(SUPER_ADMIN),
  STAFF_ADMIN: new Set(STAFF_ADMIN),
  PARENT: new Set(PARENT),
};

/* Capabilities a Staff Admin may hold only when explicitly granted per user.
   Nothing that touches accounts, roles, security or the audit trail may ever
   be granted this way. */
const GRANTABLE = new Set(['contacts.edit']);

export function capabilitiesFor(user) {
  if (!user || user.status !== 'active') return new Set();
  const base = MATRIX[user.role];
  if (!base) return new Set();
  const caps = new Set(base);
  let extra = [];
  try { extra = JSON.parse(user.extra_permissions || '[]'); } catch { extra = []; }
  if (Array.isArray(extra)) {
    for (const cap of extra) if (GRANTABLE.has(cap)) caps.add(cap);
  }
  return caps;
}

export function can(user, capability) {
  return capabilitiesFor(user).has(capability);
}

export function isGrantable(capability) {
  return GRANTABLE.has(capability);
}

/* Account-management guards that are not expressible as a single capability. */

/** Staff Admins may never create, edit, or affect a Super Admin. */
export function canManageUser(actor, targetRole) {
  if (targetRole === 'SUPER_ADMIN') return can(actor, 'staff.manage');
  if (targetRole === 'STAFF_ADMIN') return can(actor, 'staff.manage');
  if (targetRole === 'PARENT') return can(actor, 'parents.manage');
  return false;
}

/** Nobody may assign a role they are not allowed to manage. */
export function canAssignRole(actor, role) {
  if (!ROLES.includes(role)) return false;
  return canManageUser(actor, role);
}

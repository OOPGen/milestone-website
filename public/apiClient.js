/* Shared API client for login.js, admin.js and parent.js.

   The session lives ONLY in the __Host-mjla_session HttpOnly cookie the
   server sets — this file never reads, writes, or touches localStorage for
   anything auth-related. `credentials:'include'` is required on every call
   so the cookie is actually sent; without it every request looks logged out. */

/* Wrapped in an IIFE deliberately: this file and every page that uses it
   (login.js, admin.js, parent.js, accept-invitation.js) are loaded as classic
   <script> tags, which — unlike ES modules — all share ONE global lexical
   scope. A bare top-level `const api` here would collide with the `const api`
   each consumer destructures from window.MJLA_API and throw
   "Identifier 'api' has already been declared". Keeping everything inside
   this function avoids leaking any binding but the one intended export. */
(function () {
  async function apiCall(path, { method = 'GET', body, isForm = false } = {}) {
    const res = await fetch(path, {
      method,
      credentials: 'include',
      headers: isForm ? {} : (body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      body: isForm ? body : (body !== undefined ? JSON.stringify(body) : undefined),
    });
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    return { status: res.status, ok: res.ok, data: data || {} };
  }

  const api = {
    get: path => apiCall(path),
    post: (path, body) => apiCall(path, { method: 'POST', body }),
    patch: (path, body) => apiCall(path, { method: 'PATCH', body }),
    del: path => apiCall(path, { method: 'DELETE' }),
    upload: (path, formData) => apiCall(path, { method: 'POST', body: formData, isForm: true }),
  };

  /** Generic message for any non-2xx response that isn't field-level validation. */
  function apiErrorMessage(result, fallback) {
    if (result.data?.error === 'not_configured')
      return 'Accounts are not connected yet. Please contact the school office.';
    return result.data?.message || fallback || 'Something went wrong. Please try again.';
  }

  window.MJLA_API = { api, apiErrorMessage };
})();

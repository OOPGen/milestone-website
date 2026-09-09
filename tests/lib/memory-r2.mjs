/* Minimal in-memory stand-in for an R2 bucket binding: put/get by key. */

export function createMemoryR2() {
  const store = new Map();
  return {
    async put(key, value, options = {}) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      store.set(key, { bytes, httpMetadata: options.httpMetadata || {} });
      return { key };
    },
    async get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      return {
        body: entry.bytes,
        httpMetadata: entry.httpMetadata,
        async arrayBuffer() { return entry.bytes.buffer; },
      };
    },
    async delete(key) {
      store.delete(key);
    },
    _size() { return store.size; },
  };
}

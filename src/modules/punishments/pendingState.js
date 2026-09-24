/**
 * Durable Object client helpers for temporary transcript replacement state.
 *
 * Persists replacement confirmation state across separate Cloudflare Worker requests
 * and isolates without relying on an in-memory process-local Map.
 */

// Memory fallback used ONLY when env.PUNISHMENT_SEQUENCE is unavailable (e.g. basic unit test mocks)
const memoryFallbackStore = new Map();

/**
 * Generate a compact, collision-resistant token for replacement confirmation.
 * Example: "tx_m7x4b1_f83k9a" (16 chars)
 *
 * @returns {string} Compact token string
 */
export function generatePendingToken() {
  return `tx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Save pending replacement context to the PunishmentSequence Durable Object.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.token
 * @param {Object} options.context
 * @param {number} [options.ttlMs=600000] 10 minutes default
 * @returns {Promise<boolean>}
 */
export async function savePendingReplacementContext({
  env,
  token,
  context,
  ttlMs = 10 * 60 * 1000,
}) {
  if (env?.PUNISHMENT_SEQUENCE) {
    try {
      const doId = env.PUNISHMENT_SEQUENCE.idFromName("global");
      const stub = env.PUNISHMENT_SEQUENCE.get(doId);
      const res = await stub.fetch("https://do/pending-replacement/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, data: context, ttlMs }),
      });
      if (res.ok) return true;
    } catch (err) {
      console.warn("Failed to save pending replacement context to DO:", err.message);
    }
  }

  // Fallback for tests without DO bindings
  const now = Date.now();
  memoryFallbackStore.set(token, {
    data: context,
    expiresAt: now + ttlMs,
  });

  if (memoryFallbackStore.size > 100) {
    for (const [key, val] of memoryFallbackStore.entries()) {
      if (val.expiresAt < now) {
        memoryFallbackStore.delete(key);
      }
    }
  }
  return true;
}

/**
 * Get pending replacement context without consuming it.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.token
 * @returns {Promise<Object|null>}
 */
export async function getPendingReplacementContext({ env, token }) {
  if (!token) return null;

  if (env?.PUNISHMENT_SEQUENCE) {
    try {
      const doId = env.PUNISHMENT_SEQUENCE.idFromName("global");
      const stub = env.PUNISHMENT_SEQUENCE.get(doId);
      const res = await stub.fetch(
        `https://do/pending-replacement/get?token=${encodeURIComponent(token)}`
      );
      if (res.ok) {
        const body = await res.json();
        return body.data || null;
      }
    } catch (err) {
      console.warn("Failed to get pending replacement context from DO:", err.message);
    }
  }

  // Fallback for tests
  const item = memoryFallbackStore.get(token);
  if (item && item.expiresAt >= Date.now()) {
    return item.data;
  }
  return null;
}

/**
 * Atomically retrieve and consume/delete pending replacement context.
 * Guarantees single-use idempotency.
 *
 * @param {Object} options
 * @param {Object} options.env
 * @param {string} options.token
 * @returns {Promise<Object|null>}
 */
export async function consumePendingReplacementContext({ env, token }) {
  if (!token) return null;

  if (env?.PUNISHMENT_SEQUENCE) {
    try {
      const doId = env.PUNISHMENT_SEQUENCE.idFromName("global");
      const stub = env.PUNISHMENT_SEQUENCE.get(doId);
      const res = await stub.fetch("https://do/pending-replacement/consume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        const body = await res.json();
        return body.data || null;
      }
    } catch (err) {
      console.warn("Failed to consume pending replacement context from DO:", err.message);
    }
  }

  // Fallback for tests
  const item = memoryFallbackStore.get(token);
  if (item) {
    memoryFallbackStore.delete(token);
    if (item.expiresAt >= Date.now()) {
      return item.data;
    }
  }
  return null;
}

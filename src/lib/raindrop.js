// Authenticated Raindrop.io REST client.
//
// Covers token check, collections, raindrop create/list/update/delete.
// Edge-owned writes only ever send link/title/collection (plus pleaseParse on
// create). Never send empty tags/notes — that would clear Raindrop-rich fields.
//
// Two error types let the drain react correctly:
//   AuthError      -> token bad/expired: halt deletions, keep jobs queued.
//   RateLimitError -> HTTP 429: back off until `retryAt`, keep jobs queued.

import { RAINDROP_API, RATE_LIMIT_FALLBACK_MS } from "./constants.js";

export class AuthError extends Error {}
export class RateLimitError extends Error {
  constructor(retryAt) {
    super("Raindrop rate limit (HTTP 429)");
    this.retryAt = retryAt;
  }
}
export class RaindropError extends Error {}

export class RaindropClient {
  constructor(token) {
    this.token = token;
  }

  async request(method, path, body) {
    const res = await fetch(`${RAINDROP_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 || res.status === 403) {
      throw new AuthError(`Raindrop rejected the token (HTTP ${res.status})`);
    }
    if (res.status === 429) {
      throw new RateLimitError(Date.now() + this.#retryAfterMs(res));
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new RaindropError(`Raindrop ${method} ${path} failed: ${res.status} ${text}`);
    }
    // DELETE may return an empty body.
    if (res.status === 204) return {};
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  #retryAfterMs(res) {
    const retryAfter = res.headers.get("Retry-After");
    if (retryAfter && !Number.isNaN(Number(retryAfter))) {
      return Number(retryAfter) * 1000;
    }
    const reset = res.headers.get("X-RateLimit-Reset");
    if (reset && !Number.isNaN(Number(reset))) {
      const ms = Number(reset) * 1000 - Date.now();
      if (ms > 0) return ms;
    }
    return RATE_LIMIT_FALLBACK_MS;
  }

  // Confirms the token works and returns the account user object.
  async getUser() {
    const data = await this.request("GET", "/user");
    return data.user;
  }

  // Top-level (root) collections.
  async getRootCollections() {
    const data = await this.request("GET", "/collections");
    return data.items ?? [];
  }

  // All nested (child) collections across the account.
  async getChildCollections() {
    const data = await this.request("GET", "/collections/childrens");
    return data.items ?? [];
  }

  // Create a collection. Pass parentId = null for a root-level collection.
  async createCollection(title, parentId) {
    const body = { title };
    if (parentId != null) body.parent = { $id: parentId };
    const data = await this.request("POST", "/collection", body);
    return data.item;
  }

  // Create a raindrop (bookmark) inside a collection. `pleaseParse` asks
  // Raindrop to enrich metadata (cover, excerpt) from the link. Rich fields
  // are intentionally omitted so we never clear tags/notes/highlights.
  async createRaindrop({ link, title, collectionId }) {
    const body = {
      link,
      title: title || link,
      collection: { $id: collectionId },
      pleaseParse: {},
    };
    const data = await this.request("POST", "/raindrop", body);
    return data.item;
  }

  /**
   * List raindrops in a collection (paginated).
   * @param {number|string} collectionId
   * @param {{ page?: number, perPage?: number, nested?: boolean }} [opts]
   */
  async listRaindrops(collectionId, { page = 0, perPage = 50, nested = false } = {}) {
    const params = new URLSearchParams({
      page: String(page),
      perpage: String(Math.min(perPage, 50)),
    });
    if (nested) params.set("nested", "true");
    const data = await this.request("GET", `/raindrops/${collectionId}?${params}`);
    return {
      items: data.items ?? [],
      count: data.count ?? data.items?.length ?? 0,
    };
  }

  async getRaindrop(id) {
    const data = await this.request("GET", `/raindrop/${id}`);
    return data.item;
  }

  /**
   * Field-selective update for Edge-owned fields only.
   * Never pass tags/notes/highlights/cover/excerpt — empty values clear them.
   */
  async updateRaindrop(id, { link, title, collectionId } = {}) {
    const body = {};
    if (link != null) body.link = link;
    if (title != null) body.title = title;
    if (collectionId != null) body.collection = { $id: collectionId };
    if (Object.keys(body).length === 0) return null;
    const data = await this.request("PUT", `/raindrop/${id}`, body);
    return data.item;
  }

  /** Soft-delete: moves the raindrop to Trash (not permanent). */
  async deleteRaindrop(id) {
    await this.request("DELETE", `/raindrop/${id}`);
  }
}

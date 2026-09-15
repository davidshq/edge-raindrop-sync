// Authenticated Raindrop.io REST client.
//
// Covers token check, collections, raindrop create/list/update/delete.
// Edge-owned writes only ever send link/title/collection (plus pleaseParse on
// create). Never send empty tags/notes — that would clear Raindrop-rich fields.
//
// Two error types let the drain react correctly:
//   AuthError      -> token bad/expired: halt deletions, keep jobs queued.
//   RateLimitError -> HTTP 429 *or* remaining budget exhausted: back off until
//                     `retryAt`, keep jobs queued. Prefer pausing before 429.

import {
  RAINDROP_API,
  RATE_LIMIT_FALLBACK_MS,
  RATE_LIMIT_RESERVE,
} from "./constants.js";

export class AuthError extends Error {}
export class RateLimitError extends Error {
  /**
   * @param {number} retryAt epoch ms when Raindrop work may resume
   * @param {{ proactive?: boolean }} [opts]
   */
  constructor(retryAt, { proactive = false } = {}) {
    super(
      proactive
        ? "Raindrop rate limit budget low; pausing before 429"
        : "Raindrop rate limit (HTTP 429)"
    );
    this.retryAt = retryAt;
    this.proactive = proactive;
  }
}
export class RaindropError extends Error {}

export class RaindropClient {
  constructor(token) {
    this.token = token;
    /** @type {number|null} */
    this._remaining = null;
    /** @type {number|null} epoch ms from X-RateLimit-Reset */
    this._resetAt = null;
  }

  /**
   * True when the last response left little quota — callers should stop the
   * current tick and wait for `pauseUntil()` rather than risk a hard 429.
   */
  shouldPause() {
    return this._remaining != null && this._remaining <= RATE_LIMIT_RESERVE;
  }

  /** Epoch ms to wait until after a soft (header) pause. */
  pauseUntil() {
    if (this._resetAt != null && this._resetAt > Date.now()) return this._resetAt;
    return Date.now() + RATE_LIMIT_FALLBACK_MS;
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

    this.#noteRateHeaders(res);

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

  #noteRateHeaders(res) {
    const remaining = res.headers.get("X-RateLimit-Remaining");
    if (remaining != null && !Number.isNaN(Number(remaining))) {
      this._remaining = Number(remaining);
    }
    const reset = res.headers.get("X-RateLimit-Reset");
    if (reset != null && !Number.isNaN(Number(reset))) {
      // Raindrop spike: reset is epoch seconds.
      const resetSec = Number(reset);
      this._resetAt = resetSec > 1e12 ? resetSec : resetSec * 1000;
    }
  }

  #retryAfterMs(res) {
    const retryAfter = res.headers.get("Retry-After");
    if (retryAfter && !Number.isNaN(Number(retryAfter))) {
      return Number(retryAfter) * 1000;
    }
    const reset = res.headers.get("X-RateLimit-Reset");
    if (reset && !Number.isNaN(Number(reset))) {
      const resetSec = Number(reset);
      const resetAt = resetSec > 1e12 ? resetSec : resetSec * 1000;
      const ms = resetAt - Date.now();
      if (ms > 0) return ms;
    }
    return RATE_LIMIT_FALLBACK_MS;
  }

  /** Throw RateLimitError when headers say we should stop making more calls. */
  throwIfShouldPause() {
    if (!this.shouldPause()) return;
    throw new RateLimitError(this.pauseUntil(), { proactive: true });
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
    const data = await this.request("POST", "/raindrop", {
      link,
      title: title || link,
      collection: { $id: collectionId },
      pleaseParse: {},
    });
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

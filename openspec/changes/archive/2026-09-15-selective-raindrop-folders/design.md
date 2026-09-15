## Context

Users found a Settings “Selected” mode + picker confusing. They want discovery and choice of Raindrop-only collections in the same place as folder thinking: at the bottom of **Folder policies**, in an expandable section.

Existing `raindropFolderMode` (`existing-only` / `create-as-needed` / `mirror-all`) stays as-is for global defaults. The expandable allowlist is the selective opt-in for Raindrop-only collections.

## Goals / Non-Goals

**Goals:**
- Expandable under Folder policies: “Choose Raindrop-only collections to sync”
- Persist allowlist by Raindrop collection id; new collections unchecked
- Gate Raindrop-only folder create / pull on allowlist; Edge-existing paths bypass
- Allowlisted empties get Edge folders on reconcile
- No fourth dropdown mode

**Non-Goals:**
- Mixing Raindrop rows into the Edge folder-policy tree (separate expandable)
- Per-child deny under an allowed parent (v1 parent includes descendants)

**Note:** The picker lists Raindrop-only collections account-wide (not only under
the sync root). Checking an outside-root collection pulls it into Edge under
`Other favorites / Raindrop / <collection path>`. Edge→Raindrop uploads from that
landing zone map back to the account-level collection (not under the sync root).
Empty allowlist still limits *automatic* folder-mode sync to the configured root only.

## Decisions

### D1. Placement: expandable under Folder policies
**Choice:** Collapsed by default. Label: **Choose Raindrop-only collections to sync**. Visible only when sync mode is bidirectional. Contains list + Refresh; saves with folder-policy Save **or** a small Save on the expandable (prefer same **Save folder policies** draft pattern so Edge overrides + allowlist draft together — see D6).
**Why:** Matches user mental model; avoids a fourth Settings mode.
**Alternatives considered:** Settings picker under Raindrop→Edge folders — rejected as confusing.

### D2. No `selected` mode
**Choice:** Do not add `RAINDROP_FOLDER_MODE.SELECTED`. Three modes unchanged.
**Why:** Selection lives in the allowlist UI, not a mode name.

### D3. How allowlist interacts with modes
**Choice:**
- **`existing-only`:** Raindrop-only paths sync **only** if allowlisted (this is the primary selective workflow). Edge-existing paths still pull as today.
- **`create-as-needed` / `mirror-all`:** Keep current sync-all-under-root behavior (ignore allowlist for gating). Expandable still lists Raindrop-only collections for awareness; copy explains that mode already syncs all—switch to Existing only + check collections to be selective.  
  **Simpler alternate (preferred if we want less mode confusion):** Always gate Raindrop-only creation on allowlist; `create-as-needed`/`mirror-all` only affect *how* allowlisted paths sync (items vs empties), and “sync all” = check-all control in the expandable.  

**Recommendation for v1:** Prefer the **simpler alternate**: Raindrop-only ⇒ allowlist only. Add **Sync all / Clear** in the expandable. Modes: `existing-only` = no auto empty ensure except allowlisted; allowlisted with items always create-as-needed; `mirror-all` additionally ensures empties for allowlisted; `create-as-needed` does not ensure empties unless allowlisted collection has items (empty allowlisted folder still ensured if user checked it—user checked an empty folder, create it). Even simpler: checking a collection always means “bring this folder into Edge (and its items)”; modes only affect non-allowlisted behavior…  

**Lock for v1:**  
1. Raindrop-only collection appears in Edge iff allowlisted (or already in Edge).  
2. `create-as-needed` / `mirror-all` / `existing-only` apply only to **automatic** behavior when allowlist is empty (today’s behavior preserved for existing users).  
3. When allowlist is **non-empty**, Raindrop-only paths use allowlist only (selective); Edge-existing bypass remains.  

**Why:** Empty allowlist = no behavior change for current installs; checking anything switches you into selective Raindrop-only opt-in without renaming modes. Fully mirrored allowlist ids stay until **Clear selection** — auto-pruning them would empty the allowlist and undo selective mode (disastrous with `existing-only`).

### D4. Allowlist storage
**Choice:** `{ [collectionId: string]: { path: string } }` on config or dedicated storage key; draft with folder policies until Save.
**Why:** Id-stable; path for display.

### D5. Membership + Edge bypass
**Choice:** Allowed if collection id or ancestor under root is allowlisted. If `mirrorPathExists`, pull allowed without allowlist. No catch-all.
**Why:** Same as prior design.

### D6. Draft-until-save
**Choice:** Allowlist edits are a draft with folder-policy overrides; **Save folder policies** persists both; Discard reverts both.
**Why:** One save affordance in that section; matches existing Folder policies UX.

### D7. List contents
**Choice:** Show collections under root that are Raindrop-only or empty (not fully in Edge). Optionally show “already in Edge” as disabled/info rows. Don’t show pure Edge-origin paths that have no Raindrop-only story.
**Why:** Section title is Raindrop-only focused.

## Risks / Trade-offs

- **Mode + allowlist interaction is subtle** → Copy under expandable when mode is create-as-needed/mirror-all and allowlist empty: “This mode syncs all Raindrop folders automatically. To choose specific ones, switch to Existing Edge folders only and check collections below—or check collections to override into selective mode.” With D3 lock (non-empty allowlist ⇒ selective), say: “Once you check any collection, only checked Raindrop-only collections sync.”
- **Stale ids/paths** → Refresh; ignore missing ids in engine.
- **Draft couples allowlist to policy save** → Acceptable; document.
- **Rate limits** → Outside-root listing + delete-confirm `GET /raindrop/{id}` can multiply API calls. Mitigated by a global `rateLimitedUntil` gate, shared page budget for root/outside-root, and capped alive-checks per tick (see engine constants).

## Migration Plan

1. Allowlist default `{}` — existing users unchanged under create-as-needed/mirror-all.
2. Rollback: hide expandable; ignore allowlist key.

## Open Questions

None blocking if D3 lock is accepted: non-empty allowlist enables selective Raindrop-only gating.

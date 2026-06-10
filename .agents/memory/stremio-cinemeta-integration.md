---
name: Stremio addon Cinemeta integration
description: How the Jellyfin addon makes its streams appear on Stremio's default (Cinemeta) IMDb-based catalog entries
---

# Stremio addon ↔ Cinemeta integration

To have a custom Stremio addon supply streams for items shown by Stremio's
default Cinemeta catalog, the addon's `/manifest.json` must list `"tt"` in
`idPrefixes` (alongside any custom prefix). `idPrefixes` is what gates which
content ids Stremio routes to the addon's stream handler — without `"tt"`,
Cinemeta's IMDb ids never reach the addon.

**Why:** Cinemeta items use IMDb ids (`ttXXXXXXX`), not the addon's own ids.
A manifest that only declares a custom prefix will never be queried for those
items, so the addon appears to "do nothing" on normal Stremio browsing.

**Stremio stream id formats:**
- Movie: `ttXXXXXXX`
- Series episode: `ttXXXXXXX:season:episode` (series-level IMDb id + S/E numbers)

**Resolving IMDb id → Jellyfin item (do NOT use `AnyProviderIdEquals`):**
On modern Jellyfin (verified broken on 10.11.11) the `AnyProviderIdEquals`
query filter is **silently ignored** — the server returns arbitrary items (the
first N by sort order) as if no filter were applied, even for a bogus id. This
produces wrong streams that *look* like they work (the first library item gets
attached to every Cinemeta entry). Provider-id resolution cannot be done
server-side.

Working approach instead:
1. Translate the IMDb id → title + year via Cinemeta
   (`https://v3-cinemeta.strem.io/meta/<movie|series>/<ttid>.json` →
   `meta.name`, `meta.year`; series year is a range like `2019–2020`, take the
   first 4 digits).
2. Search each enabled library by title: `/Users/{userId}/Items?ParentId=<lib>&
   Recursive=true&IncludeItemTypes=Movie|Series&SearchTerm=<name>&
   Fields=ProviderIds,ProductionYear`. `SearchTerm` DOES filter correctly.
3. Disambiguate candidates: (a) exact `ProviderIds.Imdb` match wins (normalize
   by stripping the `tt` prefix on both sides — handles franchises like "The
   Matrix" vs "Reloaded" precisely); (b) else release-year match; (c) else a
   single result. Return null otherwise (better no stream than a wrong one).
Scope per enabled library via `ParentId` to respect the user's toggles.

**Resolving an episode:** find the series item first, then
`/Shows/{seriesId}/Episodes?userId=&season=N` and match BOTH
`ParentIndexNumber === season && IndexNumber === episode` (don't match episode
number alone — multi-season responses can collide).

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

**Resolving IMDb id → Jellyfin item:** query
`/Users/{userId}/Items?Recursive=true&IncludeItemTypes=Movie|Series&AnyProviderIdEquals=imdb.<id>`.
Jellyfin usually stores the IMDb id WITH the `tt` prefix, but some libraries
store the bare numeric form — try `imdb.tt1234567` then fall back to
`imdb.1234567`. Scope the search per enabled library via `ParentId` to respect
the user's library toggles.

**Resolving an episode:** find the series item first, then
`/Shows/{seriesId}/Episodes?userId=&season=N` and match BOTH
`ParentIndexNumber === season && IndexNumber === episode` (don't match episode
number alone — multi-season responses can collide).

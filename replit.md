# Jellyfin Stremio Addon

A Stremio addon that streams content directly from a Jellyfin media server — no transcoding, direct play only.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required env: `DATABASE_URL` — Postgres connection string (not used currently; no DB needed)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM (provisioned but schema is empty — config is URL-encoded, no DB needed)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — API contract (Jellyfin auth + libraries endpoints)
- `artifacts/api-server/src/routes/jellyfin.ts` — Jellyfin proxy routes (auth + libraries)
- `artifacts/api-server/src/routes/addon.ts` — Stremio addon protocol routes (manifest, catalog, stream, meta)
- `artifacts/jellyfin-addon/src/App.tsx` — 3-step configuration wizard (connect → select libraries → copy manifest URL)

## Architecture decisions

- **Config is URL-encoded**: Jellyfin credentials + enabled libraries are base64url-encoded JSON embedded in the manifest URL path. No server-side session storage needed. Each user's URL is unique and self-contained.
- **Stremio addon routes at `/addon`**: The Stremio addon endpoints (`/addon/:config/manifest.json`, etc.) are served by the same Express API server, registered as an additional path in `artifact.toml`.
- **Direct play only**: Streams are generated as direct Jellyfin URLs (`/Videos/:id/stream?static=true&api_key=...`). No transcoding or proxy — Stremio fetches video directly from Jellyfin.
- **Only movies and tvshows**: Library filtering excludes music, photos, and other collection types not supported by Stremio.
- **CORS headers on addon routes**: All `/addon/*` responses include `Access-Control-Allow-Origin: *` so Stremio can reach them from any client.

## Product

Users visit the configuration page, enter their Jellyfin server URL and credentials, authenticate, toggle which libraries to expose, and receive a manifest URL to paste into Stremio. The addon then serves their Jellyfin content as Stremio catalogs with direct-play streams.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Orval auto-generates `<OperationIdPascal>Response` Zod schemas in `api.ts`. Component schemas in `openapi.yaml` must NOT use those names (e.g. `JellyfinAuthResponse` for operationId `jellyfinAuth`) or TS2308 collisions occur in the `api-zod` barrel.
- The `dark` CSS class cannot be used with `@apply` in Tailwind v4 — it's a variant, not a utility.
- The `queryKey` option is required when passing `query` options to generated hooks.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

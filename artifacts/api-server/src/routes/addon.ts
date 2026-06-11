import { Router } from "express";
import { logger } from "../lib/logger";

const router = Router();

interface AddonConfig {
  serverUrl: string;
  userId: string;
  accessToken: string;
  enabledLibraries: Array<{ id: string; name: string; collectionType: string }>;
}

function decodeConfig(raw: string): AddonConfig | null {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf-8");
    return JSON.parse(json) as AddonConfig;
  } catch {
    return null;
  }
}

function jellyfinHeaders(accessToken: string) {
  return {
    "X-Emby-Authorization": `MediaBrowser Client="Stremio Jellyfin Addon", Device="Stremio", DeviceId="stremio-jellyfin-addon", Version="1.0.0", Token="${accessToken}"`,
    "Content-Type": "application/json",
  };
}

function collectionTypeToStremio(collectionType: string): "movie" | "series" | null {
  if (collectionType === "movies") return "movie";
  if (collectionType === "tvshows") return "series";
  return null;
}

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/:config/manifest.json", (req, res) => {
  const config = decodeConfig(req.params.config);
  if (!config) {
    res.status(400).json({ error: "Invalid config" });
    return;
  }

  const catalogs: Array<{
    type: string;
    id: string;
    name: string;
    extra?: Array<{ name: string; isRequired?: boolean }>;
  }> = [];

  for (const lib of config.enabledLibraries) {
    const stremioType = collectionTypeToStremio(lib.collectionType);
    if (!stremioType) continue;
    catalogs.push({
      type: stremioType,
      id: `jellyfin-${lib.id}`,
      name: `Jellyfin: ${lib.name}`,
      extra: [{ name: "skip" }],
    });
  }

  const types = [...new Set(catalogs.map((c) => c.type))];

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.json({
    id: "community.jellyfin.direct",
    version: "1.0.0",
    name: "Jellyfin Direct",
    description: "Stream content directly from your Jellyfin server",
    logo: "https://jellyfin.org/images/logo.svg",
    catalogs,
    resources: ["catalog", "stream", "meta"],
    types,
    idPrefixes: ["jellyfin:", "tt"],
    behaviorHints: {
      configurable: false,
      configurationRequired: false,
    },
  });
});

router.get("/:config/catalog/:type/:id.json", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  const config = decodeConfig(req.params.config);
  if (!config) {
    res.status(400).json({ error: "Invalid config" });
    return;
  }

  const { type, id } = req.params;
  const skip = parseInt((req.query["extra"] as string)?.match(/skip=(\d+)/)?.[1] ?? "0") || 0;

  const libraryId = id.replace("jellyfin-", "");
  const library = config.enabledLibraries.find((l) => l.id === libraryId);
  if (!library) {
    res.json({ metas: [] });
    return;
  }

  const itemType = type === "movie" ? "Movie" : "Series";
  const baseUrl = config.serverUrl;

  try {
    const params = new URLSearchParams({
      ParentId: libraryId,
      IncludeItemTypes: itemType,
      Recursive: "true",
      Fields: "PrimaryImageAspectRatio,Overview,Genres,ProductionYear",
      StartIndex: String(skip),
      Limit: "100",
      SortBy: "SortName",
      SortOrder: "Ascending",
    });

    const response = await fetch(`${baseUrl}/Users/${config.userId}/Items?${params}`, {
      headers: jellyfinHeaders(config.accessToken),
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, "Jellyfin catalog fetch failed");
      res.json({ metas: [] });
      return;
    }

    const data = (await response.json()) as {
      Items?: Array<{
        Id: string;
        Name: string;
        ProductionYear?: number;
        Overview?: string;
        Genres?: string[];
        ImageTags?: { Primary?: string };
        BackdropImageTags?: string[];
      }>;
    };

    const metas = (data?.Items ?? []).map((item) => {
      const meta: Record<string, unknown> = {
        id: `jellyfin:${item.Id}`,
        type,
        name: item.Name,
      };

      if (item.ProductionYear) meta.year = item.ProductionYear;
      if (item.Overview) meta.description = item.Overview;
      if (item.Genres?.length) meta.genres = item.Genres;

      if (item.ImageTags?.Primary) {
        meta.poster = `${baseUrl}/Items/${item.Id}/Images/Primary?api_key=${config.accessToken}&quality=90`;
      }

      if (item.BackdropImageTags?.length) {
        meta.background = `${baseUrl}/Items/${item.Id}/Images/Backdrop?api_key=${config.accessToken}&quality=90`;
      }

      return meta;
    });

    res.json({ metas });
  } catch (err) {
    logger.error({ err }, "Catalog fetch error");
    res.json({ metas: [] });
  }
});

router.get("/:config/meta/:type/:id.json", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  const config = decodeConfig(req.params.config);
  if (!config) {
    res.status(400).json({ error: "Invalid config" });
    return;
  }

  const { type, id } = req.params;
  if (!id.startsWith("jellyfin:")) {
    res.json({ meta: null });
    return;
  }

  const itemId = id.replace("jellyfin:", "");
  const baseUrl = config.serverUrl;

  try {
    const response = await fetch(
      `${baseUrl}/Users/${config.userId}/Items/${itemId}?Fields=Overview,Genres,ProductionYear,RunTimeTicks,ExternalUrls`,
      { headers: jellyfinHeaders(config.accessToken) }
    );

    if (!response.ok) {
      res.json({ meta: null });
      return;
    }

    const item = (await response.json()) as {
      Id: string;
      Name: string;
      Type: string;
      ProductionYear?: number;
      Overview?: string;
      Genres?: string[];
      RunTimeTicks?: number;
      ImageTags?: { Primary?: string; Logo?: string };
      BackdropImageTags?: string[];
      ExternalUrls?: Array<{ Name: string; Url: string }>;
      SeriesId?: string;
      SeasonId?: string;
    };

    const meta: Record<string, unknown> = {
      id: `jellyfin:${item.Id}`,
      type,
      name: item.Name,
    };

    if (item.ProductionYear) meta.year = item.ProductionYear;
    if (item.Overview) meta.description = item.Overview;
    if (item.Genres?.length) meta.genres = item.Genres;

    if (item.RunTimeTicks) {
      meta.runtime = `${Math.round(item.RunTimeTicks / 600000000)} min`;
    }

    if (item.ImageTags?.Primary) {
      meta.poster = `${baseUrl}/Items/${item.Id}/Images/Primary?api_key=${config.accessToken}&quality=90`;
    }

    if (item.BackdropImageTags?.length) {
      meta.background = `${baseUrl}/Items/${item.Id}/Images/Backdrop?api_key=${config.accessToken}&quality=90`;
    }

    if (item.ImageTags?.Logo) {
      meta.logo = `${baseUrl}/Items/${item.Id}/Images/Logo?api_key=${config.accessToken}`;
    }

    if (type === "series") {
      const seasonsResp = await fetch(
        `${baseUrl}/Shows/${item.Id}/Seasons?userId=${config.userId}&Fields=Overview,ProductionYear,ImageTags`,
        { headers: jellyfinHeaders(config.accessToken) }
      );

      if (seasonsResp.ok) {
        const seasonsData = (await seasonsResp.json()) as {
          Items?: Array<{ Id: string; Name: string; IndexNumber?: number; ProductionYear?: number; ImageTags?: { Primary?: string } }>;
        };

        const videos: Array<Record<string, unknown>> = [];

        for (const season of seasonsData?.Items ?? []) {
          const epsResp = await fetch(
            `${baseUrl}/Shows/${item.Id}/Episodes?seasonId=${season.Id}&userId=${config.userId}&Fields=Overview,RunTimeTicks`,
            { headers: jellyfinHeaders(config.accessToken) }
          );

          if (!epsResp.ok) continue;

          const epsData = (await epsResp.json()) as {
            Items?: Array<{
              Id: string;
              Name: string;
              IndexNumber?: number;
              ParentIndexNumber?: number;
              Overview?: string;
              RunTimeTicks?: number;
              ImageTags?: { Primary?: string };
            }>;
          };

          for (const ep of epsData?.Items ?? []) {
            videos.push({
              id: `jellyfin:${ep.Id}`,
              title: ep.Name,
              season: ep.ParentIndexNumber,
              episode: ep.IndexNumber,
              overview: ep.Overview,
              runtime: ep.RunTimeTicks ? Math.round(ep.RunTimeTicks / 600000000) : undefined,
              thumbnail: ep.ImageTags?.Primary
                ? `${baseUrl}/Items/${ep.Id}/Images/Primary?api_key=${config.accessToken}`
                : undefined,
            });
          }
        }

        meta.videos = videos;
      }
    }

    res.json({ meta });
  } catch (err) {
    logger.error({ err }, "Meta fetch error");
    res.json({ meta: null });
  }
});

function formatSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${bytes} B`;
}

function resolutionLabel(width?: number, height?: number): string | null {
  if (!height) return null;
  if (height >= 2160 || (width && width >= 3840)) return "4K";
  if (height >= 1080) return "1080p";
  if (height >= 720) return "720p";
  if (height >= 480) return "480p";
  return `${height}p`;
}

function audioLabel(codec?: string, channels?: number): string | null {
  if (!codec) return null;
  const name = codec.toUpperCase();
  if (!channels) return name;
  const layout =
    channels === 8 ? "7.1" :
    channels === 7 ? "6.1" :
    channels === 6 ? "5.1" :
    channels === 3 ? "2.1" :
    channels === 2 ? "Stereo" :
    channels === 1 ? "Mono" :
    `${channels}ch`;
  return `${name} ${layout}`;
}

async function buildStreams(
  baseUrl: string,
  config: AddonConfig,
  itemId: string
): Promise<Array<Record<string, unknown>>> {
  const streams: Array<Record<string, unknown>> = [];

  try {
    const infoResp = await fetch(`${baseUrl}/Items/${itemId}/PlaybackInfo`, {
      method: "POST",
      headers: jellyfinHeaders(config.accessToken),
      body: JSON.stringify({
        UserId: config.userId,
        DeviceProfile: {
          MaxStaticBitrate: 140000000,
          MaxStreamingBitrate: 140000000,
          DirectPlayProfiles: [{ Type: "Video" }, { Type: "Audio" }, { Type: "Photo" }],
          TranscodingProfiles: [],
          ContainerProfiles: [],
          CodecProfiles: [],
          SubtitleProfiles: [],
        },
      }),
    });

    if (infoResp.ok) {
      const playbackInfo = (await infoResp.json()) as {
        PlaySessionId?: string;
        MediaSources?: Array<{
          Id: string;
          Name?: string;
          Container?: string;
          Size?: number;
          Bitrate?: number;
          SupportsDirectPlay?: boolean;
          SupportsDirectStream?: boolean;
          MediaStreams?: Array<{
            Type: string;
            Codec?: string;
            DisplayTitle?: string;
            Width?: number;
            Height?: number;
            Channels?: number;
          }>;
        }>;
      };

      for (const source of playbackInfo?.MediaSources ?? []) {
        const directUrl = `${baseUrl}/Videos/${itemId}/stream?static=true&mediaSourceId=${source.Id}&api_key=${config.accessToken}`;

        const videoStream = source.MediaStreams?.find((s) => s.Type === "Video");
        const audioStream = source.MediaStreams?.find((s) => s.Type === "Audio");

        const resolution = resolutionLabel(videoStream?.Width, videoStream?.Height);
        const audio = audioLabel(audioStream?.Codec, audioStream?.Channels);
        const size = source.Size ? formatSize(source.Size) : null;
        const container = source.Container?.toUpperCase();

        const details = [resolution, audio, size].filter(Boolean).join(" · ");
        const title = `${container ?? "Direct Play"}${details ? `\n${details}` : ""}`;

        streams.push({
          url: directUrl,
          title,
          name: "Jellyfin",
          behaviorHints: {
            notWebReady: false,
            bingeGroup: `jellyfin-${itemId}`,
          },
        });
      }
    }
  } catch (err) {
    logger.error({ err }, "buildStreams error");
  }

  if (streams.length === 0) {
    streams.push({
      url: `${baseUrl}/Videos/${itemId}/stream?static=true&api_key=${config.accessToken}`,
      title: "Direct Play",
      name: "Jellyfin",
    });
  }

  return streams;
}

const CINEMETA_BASE = "https://v3-cinemeta.strem.io";

function normalizeImdb(id: string): string {
  return id.replace(/^tt/i, "");
}

// Translate a Cinemeta IMDb id to a human title + release year. Stremio only
// hands the addon the IMDb id, so this is how we learn what to search Jellyfin
// for. Returns null if Cinemeta has no entry or is unreachable.
async function imdbToTitle(
  type: "movie" | "series",
  imdbId: string
): Promise<{ name: string; year: number | null } | null> {
  try {
    const resp = await fetch(`${CINEMETA_BASE}/meta/${type}/${imdbId}.json`);
    if (!resp.ok) return null;
    const data = (await resp.json()) as { meta?: { name?: string; year?: string } };
    const name = data?.meta?.name;
    if (!name) return null;
    const yearMatch = data?.meta?.year?.match(/\d{4}/);
    return { name, year: yearMatch ? parseInt(yearMatch[0], 10) : null };
  } catch (err) {
    logger.error({ err }, "imdbToTitle (Cinemeta) error");
    return null;
  }
}

async function findItemIdByImdb(
  baseUrl: string,
  config: AddonConfig,
  imdbId: string,
  itemType: "Movie" | "Series",
  libraryIds: string[]
): Promise<string | null> {
  // Respect the user's enabled-library toggles: only search within the
  // libraries they exposed. No enabled libraries of this type -> no match.
  if (libraryIds.length === 0) return null;

  // Jellyfin's `AnyProviderIdEquals` filter is silently ignored on modern
  // servers (10.11.x returns arbitrary items as if the filter weren't there),
  // so provider-id resolution cannot be done server-side. Instead translate the
  // IMDb id to a title via Cinemeta, search each enabled library by that title,
  // and confirm the match by the item's stored IMDb provider id.
  const stremioType = itemType === "Series" ? "series" : "movie";
  const meta = await imdbToTitle(stremioType, imdbId);
  if (!meta) return null;

  const wantedImdb = normalizeImdb(imdbId);

  // Search each enabled library concurrently (keeps library-toggle scoping
  // intact) and gather all candidates before deciding.
  const lookups = libraryIds.map(async (parentId) => {
    const params = new URLSearchParams({
      ParentId: parentId,
      Recursive: "true",
      IncludeItemTypes: itemType,
      SearchTerm: meta.name,
      Fields: "ProviderIds,ProductionYear",
      Limit: "25",
    });

    try {
      const resp = await fetch(`${baseUrl}/Users/${config.userId}/Items?${params}`, {
        headers: jellyfinHeaders(config.accessToken),
      });
      if (!resp.ok) return [];

      const data = (await resp.json()) as {
        Items?: Array<{
          Id: string;
          ProductionYear?: number;
          ProviderIds?: Record<string, string>;
        }>;
      };
      return data?.Items ?? [];
    } catch (err) {
      logger.error({ err }, "findItemIdByImdb search error");
      return [];
    }
  });

  const candidates = (await Promise.all(lookups)).flat();
  if (candidates.length === 0) return null;

  // 1) An exact IMDb provider-id match is authoritative.
  const exact = candidates.find((c) => {
    const cImdb = c.ProviderIds?.Imdb ?? c.ProviderIds?.imdb;
    return cImdb && normalizeImdb(cImdb) === wantedImdb;
  });
  if (exact) return exact.Id;

  // 2) Fall back to a release-year match. Avoids picking the wrong entry from a
  // franchise (e.g. "The Matrix" vs "The Matrix Reloaded") when an item has no
  // stored IMDb id.
  if (meta.year !== null) {
    const byYear = candidates.find((c) => c.ProductionYear === meta.year);
    if (byYear) return byYear.Id;
  }

  // 3) A single, unambiguous title result is trustworthy on its own.
  if (candidates.length === 1) return candidates[0].Id;

  return null;
}

async function findEpisodeId(
  baseUrl: string,
  config: AddonConfig,
  seriesItemId: string,
  season: number,
  episode: number
): Promise<string | null> {
  const params = new URLSearchParams({
    userId: config.userId,
    season: String(season),
  });

  try {
    const resp = await fetch(`${baseUrl}/Shows/${seriesItemId}/Episodes?${params}`, {
      headers: jellyfinHeaders(config.accessToken),
    });
    if (!resp.ok) return null;

    const data = (await resp.json()) as {
      Items?: Array<{ Id: string; IndexNumber?: number; ParentIndexNumber?: number }>;
    };

    const ep = data?.Items?.find(
      (e) => e.IndexNumber === episode && e.ParentIndexNumber === season
    );
    return ep?.Id ?? null;
  } catch (err) {
    logger.error({ err }, "findEpisodeId error");
    return null;
  }
}

router.get("/:config/stream/:type/:id.json", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  const config = decodeConfig(req.params.config);
  if (!config) {
    res.status(400).json({ error: "Invalid config" });
    return;
  }

  const { type, id } = req.params;
  const baseUrl = config.serverUrl;

  try {
    let itemId: string | null = null;

    if (id.startsWith("jellyfin:")) {
      // The addon's own catalog items map directly to Jellyfin item ids.
      itemId = id.replace("jellyfin:", "");
    } else if (id.startsWith("tt")) {
      // Cinemeta IMDb ids. Movie: ttXXXXXXX. Series: ttXXXXXXX:season:episode
      const parts = id.split(":");
      const imdbId = parts[0];

      const movieLibIds = config.enabledLibraries
        .filter((l) => l.collectionType === "movies")
        .map((l) => l.id);
      const seriesLibIds = config.enabledLibraries
        .filter((l) => l.collectionType === "tvshows")
        .map((l) => l.id);

      if (type === "series" && parts.length >= 3) {
        const season = parseInt(parts[1], 10);
        const episode = parseInt(parts[2], 10);
        const seriesId = await findItemIdByImdb(baseUrl, config, imdbId, "Series", seriesLibIds);
        if (seriesId && Number.isFinite(season) && Number.isFinite(episode)) {
          itemId = await findEpisodeId(baseUrl, config, seriesId, season, episode);
        }
      } else {
        itemId = await findItemIdByImdb(baseUrl, config, imdbId, "Movie", movieLibIds);
      }
    }

    if (!itemId) {
      res.json({ streams: [] });
      return;
    }

    const streams = await buildStreams(baseUrl, config, itemId);
    res.json({ streams });
  } catch (err) {
    logger.error({ err }, "Stream fetch error");
    res.json({ streams: [] });
  }
});

export default router;

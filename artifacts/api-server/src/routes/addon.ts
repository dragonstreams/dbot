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
    idPrefixes: ["jellyfin:"],
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

router.get("/:config/stream/:type/:id.json", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  const config = decodeConfig(req.params.config);
  if (!config) {
    res.status(400).json({ error: "Invalid config" });
    return;
  }

  const { id } = req.params;
  if (!id.startsWith("jellyfin:")) {
    res.json({ streams: [] });
    return;
  }

  const itemId = id.replace("jellyfin:", "");
  const baseUrl = config.serverUrl;

  try {
    const infoResp = await fetch(
      `${baseUrl}/Items/${itemId}/PlaybackInfo`,
      {
        method: "POST",
        headers: jellyfinHeaders(config.accessToken),
        body: JSON.stringify({
          UserId: config.userId,
          DeviceProfile: {
            MaxStaticBitrate: 140000000,
            MaxStreamingBitrate: 140000000,
            DirectPlayProfiles: [
              { Type: "Video" },
              { Type: "Audio" },
              { Type: "Photo" },
            ],
            TranscodingProfiles: [],
            ContainerProfiles: [],
            CodecProfiles: [],
            SubtitleProfiles: [],
          },
        }),
      }
    );

    const streams: Array<Record<string, unknown>> = [];

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
          }>;
        }>;
      };

      for (const source of playbackInfo?.MediaSources ?? []) {
        const directUrl = `${baseUrl}/Videos/${itemId}/stream?static=true&mediaSourceId=${source.Id}&api_key=${config.accessToken}`;

        const videoStream = source.MediaStreams?.find((s) => s.Type === "Video");
        const resolution = videoStream?.Width && videoStream?.Height
          ? `${videoStream.Width}x${videoStream.Height}`
          : null;

        const title = [
          "Direct Play",
          source.Container?.toUpperCase(),
          resolution,
        ]
          .filter(Boolean)
          .join(" · ");

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

    if (streams.length === 0) {
      const fallbackUrl = `${baseUrl}/Videos/${itemId}/stream?static=true&api_key=${config.accessToken}`;
      streams.push({
        url: fallbackUrl,
        title: "Direct Play",
        name: "Jellyfin",
      });
    }

    res.json({ streams });
  } catch (err) {
    logger.error({ err }, "Stream fetch error");
    res.json({ streams: [] });
  }
});

export default router;

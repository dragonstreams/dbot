const API_BASE = "http://localhost:80/api";

export interface AuthResult {
  userId: string;
  accessToken: string;
  serverUrl: string;
  username: string;
}

export interface Library {
  id: string;
  name: string;
  collectionType: string;
}

export async function jellyfinAuth(
  serverUrl: string,
  username: string,
  password: string
): Promise<AuthResult> {
  const res = await fetch(`${API_BASE}/jellyfin/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ serverUrl, username, password }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Auth failed (${res.status})`);
  }

  return res.json() as Promise<AuthResult>;
}

export async function jellyfinLibraries(
  serverUrl: string,
  userId: string,
  accessToken: string
): Promise<Library[]> {
  const params = new URLSearchParams({ serverUrl, userId, accessToken });
  const res = await fetch(`${API_BASE}/jellyfin/libraries?${params}`);

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Libraries fetch failed (${res.status})`);
  }

  const data = (await res.json()) as { libraries: Library[] };
  return data.libraries;
}

const EMBY_AUTH = (token: string) =>
  `MediaBrowser Client="Stremio Jellyfin Addon", Device="Discord Bot", DeviceId="discord-bot", Version="1.0.0", Token="${token}"`;

export interface ActiveSession {
  id: string;
  userName: string;
  client: string;
  deviceName: string;
  nowPlayingTitle: string | null;
  nowPlayingType: string | null;
  isPaused: boolean;
}

export async function getActiveSessions(
  serverUrl: string,
  accessToken: string
): Promise<ActiveSession[]> {
  const res = await fetch(`${serverUrl}/Sessions?ActiveWithinSeconds=300`, {
    headers: {
      "X-Emby-Authorization": EMBY_AUTH(accessToken),
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { Message?: string };
    throw new Error(body.Message ?? `Failed to fetch sessions (${res.status})`);
  }

  const sessions = (await res.json()) as Array<{
    Id: string;
    UserName?: string;
    Client?: string;
    DeviceName?: string;
    NowPlayingItem?: { Name?: string; Type?: string; SeriesName?: string };
    PlayState?: { IsPaused?: boolean };
  }>;

  return sessions
    .filter((s) => s.NowPlayingItem != null)
    .map((s) => ({
      id: s.Id,
      userName: s.UserName ?? "Unknown",
      client: s.Client ?? "Unknown",
      deviceName: s.DeviceName ?? "Unknown",
      nowPlayingTitle:
        s.NowPlayingItem?.SeriesName
          ? `${s.NowPlayingItem.SeriesName} — ${s.NowPlayingItem.Name ?? ""}`
          : (s.NowPlayingItem?.Name ?? null),
      nowPlayingType: s.NowPlayingItem?.Type ?? null,
      isPaused: s.PlayState?.IsPaused ?? false,
    }));
}

export async function terminateSession(
  serverUrl: string,
  accessToken: string,
  sessionId: string
): Promise<void> {
  const res = await fetch(`${serverUrl}/Sessions/${sessionId}/Playing/Stop`, {
    method: "POST",
    headers: { "X-Emby-Authorization": EMBY_AUTH(accessToken) },
  });
  // Jellyfin returns 204 on success; some versions return 200 or 404 for idle sessions
  if (!res.ok && res.status !== 404) {
    throw new Error(`Could not terminate session (${res.status})`);
  }
}

export interface CreateUserResult {
  userId: string;
  username: string;
}

export async function createJellyfinUser(
  serverUrl: string,
  adminToken: string,
  newUsername: string,
  newPassword: string
): Promise<CreateUserResult> {
  // Step 1 — create the account
  const createRes = await fetch(`${serverUrl}/Users/New`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Emby-Authorization": EMBY_AUTH(adminToken),
    },
    body: JSON.stringify({ Name: newUsername }),
  });

  if (!createRes.ok) {
    const body = (await createRes.json().catch(() => ({}))) as { Message?: string };
    throw new Error(body.Message ?? `User creation failed (${createRes.status})`);
  }

  const created = (await createRes.json()) as { Id: string; Name: string };

  // Step 2 — set the password
  const pwRes = await fetch(`${serverUrl}/Users/${created.Id}/Password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Emby-Authorization": EMBY_AUTH(adminToken),
    },
    body: JSON.stringify({ NewPw: newPassword, ResetPassword: false }),
  });

  if (!pwRes.ok) {
    throw new Error(`User created but password could not be set (${pwRes.status})`);
  }

  return { userId: created.Id, username: created.Name };
}

export function encodeConfig(config: {
  serverUrl: string;
  userId: string;
  accessToken: string;
  enabledLibraries: Library[];
  maxStreams?: number;
}): string {
  return Buffer.from(JSON.stringify(config)).toString("base64url");
}

export function getManifestUrl(config: {
  serverUrl: string;
  userId: string;
  accessToken: string;
  enabledLibraries: Library[];
  maxStreams?: number;
}): string {
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  if (!domain) throw new Error("REPLIT_DOMAINS not set");
  const encoded = encodeConfig(config);
  return `https://${domain}/addon/${encoded}/manifest.json`;
}

// ==================== Media Server (Emby/Jellyfin) Watch History Transfer ====================

export interface MediaAuthResult {
  userId: string;
  accessToken: string;
  serverUrl: string;
  username: string;
}

function getMediaBase(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, "");
}

export async function mediaAuthenticate(
  serverUrl: string,
  username: string,
  password: string
): Promise<MediaAuthResult> {
  const base = getMediaBase(serverUrl);
  const clientInfo = 'MediaBrowser Client="Discord Media Transfer", Device="DiscordBot", DeviceId="discord-media-transfer-bot", Version="1.0.0"';

  // Support both Emby (often /emby) and Jellyfin (usually no prefix)
  const candidates = [
    `${base}/emby/Users/AuthenticateByName`,
    `${base}/Users/AuthenticateByName`,
    `${base}/Users/AuthenticateByName`  // Jellyfin default
  ];

  let lastErr: any;

  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "X-Emby-Authorization": clientInfo,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ Username: username, Pw: password }),
      });

      if (res.ok) {
        const data = await res.json() as any;
        return {
          userId: data.User.Id,
          accessToken: data.AccessToken,
          serverUrl: base,
          username: data.User.Name,
        };
      }
      lastErr = await res.text().catch(() => res.statusText);
    } catch (e) {
      lastErr = e;
    }
  }

  throw new Error(`Failed to authenticate with Emby/Jellyfin: ${lastErr}`);
}

export interface MediaItem {
  Id: string;
  Name: string;
  Type: "Movie" | "Series" | "Episode" | "AudioBook" | "Book" | string;
  ProductionYear?: number;
  SeriesName?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  AlbumArtist?: string;
  Artists?: string[];
  ProviderIds?: Record<string, string>;
  UserData?: {
    Played?: boolean;
    PlayCount?: number;
    PlaybackPositionTicks?: number;
    LastPlayedDate?: string;
    IsFavorite?: boolean;
  };
}

export async function getMediaUserData(
  serverUrl: string,
  accessToken: string,
  userId: string
): Promise<{ watched: MediaItem[]; favorites: MediaItem[] }> {
  const base = getMediaBase(serverUrl);
  const authHeader = `MediaBrowser Client="Discord Media Transfer", Device="DiscordBot", DeviceId="discord-media-transfer-bot", Version="1.0.0", Token="${accessToken}"`;

  const allItems: MediaItem[] = [];
  let startIndex = 0;
  const limit = 1000;

  // Try both /emby and root paths for compatibility
  const itemPaths = [`${base}/emby/Users/${userId}/Items`, `${base}/Users/${userId}/Items`];

  for (const baseUrl of itemPaths) {
    try {
      while (true) {
        const params = new URLSearchParams({
          Recursive: "true",
          IncludeItemTypes: "Movie,Series,Episode,AudioBook,Book",
          Fields: "ProviderIds,UserData,Name,ProductionYear,SeriesName,ParentIndexNumber,IndexNumber,Type,AlbumArtist,Artists",
          StartIndex: startIndex.toString(),
          Limit: limit.toString(),
        });

        const url = `${baseUrl}?${params.toString()}`;
        const res = await fetch(url, {
          headers: { "X-Emby-Authorization": authHeader },
        });

        if (!res.ok) {
          throw new Error(`Failed to fetch items (${res.status})`);
        }

        const data = (await res.json()) as { Items: MediaItem[]; TotalRecordCount: number };
        allItems.push(...(data.Items || []));

        if (allItems.length >= (data.TotalRecordCount || 0) || (data.Items || []).length === 0) {
          return {
            watched: allItems.filter((i) => i.UserData?.Played),
            favorites: allItems.filter((i) => i.UserData?.IsFavorite),
          };
        }
        startIndex += limit;
        if (startIndex > 50000) break;
      }
    } catch (e) {
      // try next path
      continue;
    }
  }

  // Fallback return
  return {
    watched: allItems.filter((i) => i.UserData?.Played),
    favorites: allItems.filter((i) => i.UserData?.IsFavorite),
  };
}

export function findMatchingMediaItem(source: MediaItem, targets: MediaItem[]): MediaItem | null {
  const sIds = source.ProviderIds || {};

  // Provider ID matches (strongest)
  for (const t of targets) {
    const tIds = t.ProviderIds || {};
    if (sIds.Imdb && tIds.Imdb && sIds.Imdb === tIds.Imdb) return t;
    if (sIds.Tmdb && tIds.Tmdb && sIds.Tmdb === tIds.Tmdb) return t;
    if (sIds.Tvdb && tIds.Tvdb && sIds.Tvdb === tIds.Tvdb) return t;
    if (sIds.ASIN && tIds.ASIN && sIds.ASIN === tIds.ASIN) return t; // Audiobooks
  }

  // Fallback: name + year + type (and season/ep for episodes, author for audiobooks)
  const sYear = source.ProductionYear;
  const sName = source.Name?.toLowerCase().trim();

  for (const t of targets) {
    if (t.Type !== source.Type) continue;

    const tName = t.Name?.toLowerCase().trim();
    const tYear = t.ProductionYear;

    if (tName !== sName) continue;
    if (sYear && tYear && sYear !== tYear) continue;

    if (source.Type === "Episode") {
      if ((source.SeriesName || "").toLowerCase() !== (t.SeriesName || "").toLowerCase()) continue;
      if (source.ParentIndexNumber !== t.ParentIndexNumber) continue;
      if (source.IndexNumber !== t.IndexNumber) continue;
    }

    if (source.Type === "AudioBook" || source.Type === "Book") {
      const sAuthor = (source.AlbumArtist || (source.Artists && source.Artists[0]) || "").toLowerCase().trim();
      const tAuthor = (t.AlbumArtist || (t.Artists && t.Artists[0]) || "").toLowerCase().trim();
      if (sAuthor && tAuthor && sAuthor !== tAuthor) continue;
    }

    return t;
  }

  return null;
}

export async function updateMediaUserData(
  serverUrl: string,
  accessToken: string,
  userId: string,
  itemId: string,
  data: {
    Played?: boolean;
    PlayCount?: number;
    PlaybackPositionTicks?: number;
    LastPlayedDate?: string;
    IsFavorite?: boolean;
  }
): Promise<void> {
  const base = getMediaBase(serverUrl);
  const authHeader = `MediaBrowser Client="Discord Media Transfer", Device="DiscordBot", DeviceId="discord-media-transfer-bot", Version="1.0.0", Token="${accessToken}"`;

  const userDataRes = await fetch(`${base}/Users/${userId}/Items/${itemId}/UserData`, {
    method: "POST",
    headers: {
      "X-Emby-Authorization": authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      Played: data.Played,
      PlayCount: data.PlayCount,
      PlaybackPositionTicks: data.PlaybackPositionTicks,
      LastPlayedDate: data.LastPlayedDate,
      IsFavorite: data.IsFavorite,
    }),
  });

  if (!userDataRes.ok && userDataRes.status !== 204) {
    console.error(`Failed to update UserData for ${itemId}: ${userDataRes.status}`);
  }

  const favUrl = `${base}/Users/${userId}/FavoriteItems/${itemId}`;
  if (data.IsFavorite) {
    await fetch(favUrl, { method: "POST", headers: { "X-Emby-Authorization": authHeader } }).catch(() => {});
  } else if (data.IsFavorite === false) {
    await fetch(favUrl, { method: "DELETE", headers: { "X-Emby-Authorization": authHeader } }).catch(() => {});
  }

  if (data.Played) {
    let playedUrl = `${base}/Users/${userId}/PlayedItems/${itemId}`;
    if (data.LastPlayedDate) {
      playedUrl += `?DatePlayed=${encodeURIComponent(data.LastPlayedDate)}`;
    }
    await fetch(playedUrl, { method: "POST", headers: { "X-Emby-Authorization": authHeader } }).catch(() => {});
  }
}

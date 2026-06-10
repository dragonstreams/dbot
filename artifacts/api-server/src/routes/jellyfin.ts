import { Router } from "express";
import { JellyfinAuthBody, GetJellyfinLibrariesQueryParams } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router = Router();

const JELLYFIN_CLIENT_HEADER =
  'MediaBrowser Client="Stremio Jellyfin Addon", Device="Server", DeviceId="stremio-jellyfin-addon-server", Version="1.0.0"';

router.post("/jellyfin/auth", async (req, res) => {
  const parsed = JellyfinAuthBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", message: parsed.error.message });
    return;
  }

  const { serverUrl, username, password } = parsed.data;
  const baseUrl = serverUrl.replace(/\/$/, "");

  try {
    const response = await fetch(`${baseUrl}/Users/AuthenticateByName`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Emby-Authorization": JELLYFIN_CLIENT_HEADER,
      },
      body: JSON.stringify({ Username: username, Pw: password }),
    });

    if (response.status === 401) {
      res.status(401).json({ error: "unauthorized", message: "Invalid username or password" });
      return;
    }

    if (!response.ok) {
      req.log.warn({ status: response.status }, "Jellyfin auth failed");
      res.status(502).json({ error: "jellyfin_error", message: "Jellyfin server returned an error" });
      return;
    }

    const data = (await response.json()) as {
      User?: { Id?: string; Name?: string };
      AccessToken?: string;
    };

    const userId = data?.User?.Id;
    const accessToken = data?.AccessToken;

    if (!userId || !accessToken) {
      res.status(502).json({ error: "invalid_response", message: "Unexpected response from Jellyfin server" });
      return;
    }

    res.json({
      userId,
      accessToken,
      serverUrl: baseUrl,
      username: data?.User?.Name ?? username,
    });
  } catch (err) {
    logger.error({ err }, "Failed to reach Jellyfin server");
    res.status(502).json({ error: "unreachable", message: "Could not reach Jellyfin server" });
  }
});

router.get("/jellyfin/libraries", async (req, res) => {
  const parsed = GetJellyfinLibrariesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", message: parsed.error.message });
    return;
  }

  const { serverUrl, userId, accessToken } = parsed.data;
  const baseUrl = serverUrl.replace(/\/$/, "");

  try {
    const response = await fetch(`${baseUrl}/Users/${userId}/Views`, {
      headers: {
        "X-Emby-Authorization": `${JELLYFIN_CLIENT_HEADER}, Token="${accessToken}"`,
      },
    });

    if (response.status === 401) {
      res.status(401).json({ error: "unauthorized", message: "Invalid or expired access token" });
      return;
    }

    if (!response.ok) {
      res.status(502).json({ error: "jellyfin_error", message: "Jellyfin server returned an error" });
      return;
    }

    const data = (await response.json()) as {
      Items?: Array<{ Id: string; Name: string; CollectionType?: string }>;
    };

    const supported = new Set(["movies", "tvshows"]);
    const libraries = (data?.Items ?? [])
      .filter((item) => item.CollectionType && supported.has(item.CollectionType))
      .map((item) => ({
        id: item.Id,
        name: item.Name,
        collectionType: item.CollectionType ?? "unknown",
      }));

    res.json({ libraries });
  } catch (err) {
    logger.error({ err }, "Failed to reach Jellyfin server for libraries");
    res.status(502).json({ error: "unreachable", message: "Could not reach Jellyfin server" });
  }
});

export default router;

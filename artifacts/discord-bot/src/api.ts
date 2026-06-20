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

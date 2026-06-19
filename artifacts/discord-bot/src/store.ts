export interface Library {
  id: string;
  name: string;
  collectionType: string;
}

export interface UserSession {
  serverUrl: string;
  userId: string;
  accessToken: string;
  username: string;
  enabledLibraries: Library[];
  allLibraries: Library[];
}

const sessions = new Map<string, UserSession>();

export function getSession(discordUserId: string): UserSession | undefined {
  return sessions.get(discordUserId);
}

export function setSession(discordUserId: string, session: UserSession): void {
  sessions.set(discordUserId, session);
}

export function deleteSession(discordUserId: string): boolean {
  return sessions.delete(discordUserId);
}

export function updateEnabledLibraries(discordUserId: string, enabled: Library[]): boolean {
  const session = sessions.get(discordUserId);
  if (!session) return false;
  session.enabledLibraries = enabled;
  return true;
}

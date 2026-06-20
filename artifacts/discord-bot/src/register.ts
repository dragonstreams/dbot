import { REST, Routes } from "discord.js";
import { commandDefinitions } from "./commands.js";

const token = process.env["DISCORD_TOKEN"];
const clientId = process.env["DISCORD_CLIENT_ID"];
const guildId = process.env["DISCORD_GUILD_ID"];

if (!token || !clientId) {
  console.error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID env vars");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);
const body = commandDefinitions.map((c) => c.toJSON());

if (guildId) {
  console.log(`Registering commands to guild ${guildId} (instant)…`);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
  console.log("Guild commands registered successfully.");
} else {
  console.log("Registering commands globally (may take up to 1 hour to propagate)…");
  await rest.put(Routes.applicationCommands(clientId), { body });
  console.log("Global commands registered successfully.");
}

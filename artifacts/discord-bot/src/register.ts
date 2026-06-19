import { REST, Routes } from "discord.js";
import { commandDefinitions } from "./commands.js";

const token = process.env["DISCORD_TOKEN"];
const clientId = process.env["DISCORD_CLIENT_ID"];

if (!token || !clientId) {
  console.error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID env vars");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

console.log("Registering slash commands globally...");

try {
  await rest.put(Routes.applicationCommands(clientId), {
    body: commandDefinitions.map((c) => c.toJSON()),
  });
  console.log("Slash commands registered successfully.");
} catch (err) {
  console.error("Failed to register commands:", err);
  process.exit(1);
}

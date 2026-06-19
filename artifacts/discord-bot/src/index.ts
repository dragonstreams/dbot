import { Client, Events, GatewayIntentBits, type ChatInputCommandInteraction } from "discord.js";
import { handleCommand } from "./commands.js";

const token = process.env["DISCORD_TOKEN"];
const clientId = process.env["DISCORD_CLIENT_ID"];

if (!token) {
  console.error("DISCORD_TOKEN environment variable is not set. Exiting.");
  process.exit(1);
}

if (!clientId) {
  console.error("DISCORD_CLIENT_ID environment variable is not set. Exiting.");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
  console.log(`Discord bot ready! Logged in as ${c.user.tag}`);
  console.log(`Bot invite URL: https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=2048&scope=bot%20applications.commands`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    await handleCommand(interaction as ChatInputCommandInteraction);
  } catch (err) {
    console.error("Error handling command:", err);
    const msg = { content: "An error occurred while executing this command.", ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(msg).catch(console.error);
    } else {
      await interaction.reply(msg).catch(console.error);
    }
  }
});

await client.login(token);

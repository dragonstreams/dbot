import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  EmbedBuilder,
  ComponentType,
  type StringSelectMenuInteraction,
} from "discord.js";
import {
  getSession,
  setSession,
  deleteSession,
  updateEnabledLibraries,
  type Library,
} from "./store.js";
import { jellyfinAuth, jellyfinLibraries, getManifestUrl } from "./api.js";

const JELLYFIN_ICON = "https://jellyfin.org/images/logo.svg";

function errorEmbed(message: string): EmbedBuilder {
  return new EmbedBuilder().setColor(0xe74c3c).setDescription(`❌ ${message}`);
}

function successEmbed(title: string, description?: string): EmbedBuilder {
  const e = new EmbedBuilder().setColor(0x2ecc71).setTitle(title);
  if (description) e.setDescription(description);
  return e;
}

async function handleConnect(i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply({ ephemeral: true });

  const serverUrl = i.options.getString("server_url", true).replace(/\/$/, "");
  const username = i.options.getString("username", true);
  const password = i.options.getString("password", true);

  try {
    const auth = await jellyfinAuth(serverUrl, username, password);
    const libraries = await jellyfinLibraries(auth.serverUrl, auth.userId, auth.accessToken);

    setSession(i.user.id, {
      serverUrl: auth.serverUrl,
      userId: auth.userId,
      accessToken: auth.accessToken,
      username: auth.username,
      enabledLibraries: libraries,
      allLibraries: libraries,
    });

    const libList = libraries.map((l) => `• **${l.name}** (${l.collectionType})`).join("\n");

    await i.editReply({
      embeds: [
        successEmbed(
          "✅ Connected to Jellyfin",
          `Logged in as **${auth.username}** on \`${serverUrl}\`\n\n` +
            `**Libraries found (${libraries.length}):**\n${libList || "No supported libraries"}\n\n` +
            `All libraries are enabled by default. Use \`/jellyfin libraries\` to choose which ones to include.`
        ),
      ],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await i.editReply({ embeds: [errorEmbed(`Connection failed: ${msg}`)] });
  }
}

async function handleLibraries(i: ChatInputCommandInteraction): Promise<void> {
  const session = getSession(i.user.id);
  if (!session) {
    await i.reply({
      embeds: [errorEmbed("You are not connected. Use `/jellyfin connect` first.")],
      ephemeral: true,
    });
    return;
  }

  if (session.allLibraries.length === 0) {
    await i.reply({
      embeds: [errorEmbed("No supported libraries found on your Jellyfin server.")],
      ephemeral: true,
    });
    return;
  }

  const enabledIds = new Set(session.enabledLibraries.map((l) => l.id));

  const options = session.allLibraries.map((lib) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(lib.name)
      .setValue(lib.id)
      .setDescription(lib.collectionType === "movies" ? "Movies" : "TV Shows")
      .setEmoji(lib.collectionType === "movies" ? "🎬" : "📺")
      .setDefault(enabledIds.has(lib.id))
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId("library_select")
    .setPlaceholder("Select libraries to include in Stremio")
    .setMinValues(0)
    .setMaxValues(session.allLibraries.length)
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  const reply = await i.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle("📚 Select Libraries")
        .setDescription(
          "Choose which Jellyfin libraries to expose in Stremio. Currently enabled are pre-selected."
        ),
    ],
    components: [row],
    ephemeral: true,
  });

  try {
    const selection = (await reply.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      time: 60_000,
    })) as StringSelectMenuInteraction;

    const chosen: Library[] = session.allLibraries.filter((l) =>
      selection.values.includes(l.id)
    );
    updateEnabledLibraries(i.user.id, chosen);

    const names =
      chosen.length > 0 ? chosen.map((l) => `• **${l.name}**`).join("\n") : "_None selected_";

    await selection.update({
      embeds: [
        successEmbed(
          "✅ Libraries Updated",
          `Enabled libraries:\n${names}\n\nRun \`/jellyfin manifest\` to get your updated Stremio URL.`
        ),
      ],
      components: [],
    });
  } catch {
    await i.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x95a5a6)
          .setDescription("⏱️ Selection timed out. No changes made."),
      ],
      components: [],
    });
  }
}

async function handleManifest(i: ChatInputCommandInteraction): Promise<void> {
  const session = getSession(i.user.id);
  if (!session) {
    await i.reply({
      embeds: [errorEmbed("You are not connected. Use `/jellyfin connect` first.")],
      ephemeral: true,
    });
    return;
  }

  if (session.enabledLibraries.length === 0) {
    await i.reply({
      embeds: [
        errorEmbed(
          "No libraries are enabled. Use `/jellyfin libraries` to select at least one library."
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  try {
    const url = getManifestUrl({
      serverUrl: session.serverUrl,
      userId: session.userId,
      accessToken: session.accessToken,
      enabledLibraries: session.enabledLibraries,
    });

    const libNames = session.enabledLibraries.map((l) => `• ${l.name}`).join("\n");

    await i.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x9b59b6)
          .setTitle("🎬 Your Stremio Manifest URL")
          .setDescription(
            `**Copy this URL and paste it into Stremio:**\n\`\`\`\n${url}\n\`\`\`\n` +
              `**Included libraries:**\n${libNames}\n\n` +
              `In Stremio: go to **Addons → Community Addons → Install from URL** and paste the URL above.`
          )
          .setFooter({ text: "Keep this URL private — it contains your Jellyfin access token." }),
      ],
      ephemeral: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await i.reply({ embeds: [errorEmbed(msg)], ephemeral: true });
  }
}

async function handleStatus(i: ChatInputCommandInteraction): Promise<void> {
  const session = getSession(i.user.id);
  if (!session) {
    await i.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x95a5a6)
          .setDescription("Not connected. Use `/jellyfin connect` to get started."),
      ],
      ephemeral: true,
    });
    return;
  }

  const enabled =
    session.enabledLibraries.length > 0
      ? session.enabledLibraries.map((l) => `• ${l.name}`).join("\n")
      : "_None selected_";

  await i.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("📡 Jellyfin Status")
        .addFields(
          { name: "Server", value: `\`${session.serverUrl}\``, inline: false },
          { name: "Username", value: session.username, inline: true },
          {
            name: "Libraries",
            value: `${session.allLibraries.length} total`,
            inline: true,
          },
          { name: "Enabled in Stremio", value: enabled, inline: false }
        ),
    ],
    ephemeral: true,
  });
}

async function handleDisconnect(i: ChatInputCommandInteraction): Promise<void> {
  const deleted = deleteSession(i.user.id);
  if (deleted) {
    await i.reply({
      embeds: [successEmbed("✅ Disconnected", "Your Jellyfin session has been cleared.")],
      ephemeral: true,
    });
  } else {
    await i.reply({
      embeds: [new EmbedBuilder().setColor(0x95a5a6).setDescription("You were not connected.")],
      ephemeral: true,
    });
  }
}

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("jellyfin")
    .setDescription("Jellyfin Stremio Addon commands")
    .addSubcommand((sub) =>
      sub
        .setName("connect")
        .setDescription("Connect your Jellyfin server")
        .addStringOption((o) =>
          o
            .setName("server_url")
            .setDescription("Your Jellyfin server URL (e.g. https://jellyfin.example.com)")
            .setRequired(true)
        )
        .addStringOption((o) =>
          o.setName("username").setDescription("Your Jellyfin username").setRequired(true)
        )
        .addStringOption((o) =>
          o.setName("password").setDescription("Your Jellyfin password").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("libraries")
        .setDescription("Choose which Jellyfin libraries to include in Stremio")
    )
    .addSubcommand((sub) =>
      sub.setName("manifest").setDescription("Get your Stremio manifest URL")
    )
    .addSubcommand((sub) =>
      sub.setName("status").setDescription("Show your current Jellyfin connection status")
    )
    .addSubcommand((sub) =>
      sub.setName("disconnect").setDescription("Clear your Jellyfin session")
    ),
];

export async function handleCommand(i: ChatInputCommandInteraction): Promise<void> {
  if (i.commandName !== "jellyfin") return;

  const sub = i.options.getSubcommand();
  switch (sub) {
    case "connect":
      await handleConnect(i);
      break;
    case "libraries":
      await handleLibraries(i);
      break;
    case "manifest":
      await handleManifest(i);
      break;
    case "status":
      await handleStatus(i);
      break;
    case "disconnect":
      await handleDisconnect(i);
      break;
    default:
      await i.reply({ content: "Unknown subcommand.", ephemeral: true });
  }
}

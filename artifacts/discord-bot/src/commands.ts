import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ComponentType,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import {
  getSession,
  setSession,
  deleteSession,
  updateEnabledLibraries,
  type Library,
} from "./store.js";
import { jellyfinAuth, jellyfinLibraries, getManifestUrl } from "./api.js";

const COLOR_BRAND = 0x00a4dc; // Jellyfin blue
const COLOR_SUCCESS = 0x2ecc71;
const COLOR_ERROR = 0xe74c3c;
const COLOR_NEUTRAL = 0x95a5a6;

function errorEmbed(msg: string): EmbedBuilder {
  return new EmbedBuilder().setColor(COLOR_ERROR).setDescription(`❌ ${msg}`);
}

async function showLibraryStep(
  i: ButtonInteraction | ModalSubmitInteraction,
  discordUserId: string,
  edit: boolean
): Promise<void> {
  const session = getSession(discordUserId);
  if (!session) return;

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
    .setCustomId("lib_select")
    .setPlaceholder("Pick libraries to include in Stremio…")
    .setMinValues(0)
    .setMaxValues(session.allLibraries.length)
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  const embed = new EmbedBuilder()
    .setColor(COLOR_BRAND)
    .setTitle("📚 Step 2 — Select Libraries")
    .setDescription(
      `Connected as **${session.username}** on \`${session.serverUrl}\`\n\n` +
        `Toggle which libraries should appear in Stremio, then click **Done** to get your manifest URL.`
    );

  const payload = { embeds: [embed], components: [row] };
  const reply = edit
    ? await (i as ButtonInteraction).update(payload)
    : await i.reply({ ...payload, fetchReply: true, ephemeral: true });

  const msg = edit ? await (i as ButtonInteraction).fetchReply() : reply;

  try {
    const sel = (await msg.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      time: 120_000,
    })) as StringSelectMenuInteraction;

    const chosen: Library[] = session.allLibraries.filter((l) =>
      sel.values.includes(l.id)
    );
    updateEnabledLibraries(discordUserId, chosen);

    await showManifestStep(sel, discordUserId);
  } catch {
    await i.editReply({
      embeds: [new EmbedBuilder().setColor(COLOR_NEUTRAL).setDescription("⏱️ Timed out — run `/jellyfin` again to continue.")],
      components: [],
    });
  }
}

async function showManifestStep(
  i: StringSelectMenuInteraction,
  discordUserId: string
): Promise<void> {
  const session = getSession(discordUserId);
  if (!session) return;

  if (session.enabledLibraries.length === 0) {
    const noLibRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("back_to_libs")
        .setLabel("← Back to Libraries")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("disconnect_btn")
        .setLabel("Disconnect")
        .setStyle(ButtonStyle.Danger)
    );
    const msg = await i.update({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR_NEUTRAL)
          .setTitle("No Libraries Selected")
          .setDescription("Select at least one library to generate a manifest URL."),
      ],
      components: [noLibRow],
    });
    try {
      const btn = (await msg.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: 120_000,
      })) as ButtonInteraction;
      if (btn.customId === "back_to_libs") {
        await showLibraryStep(btn, discordUserId, true);
      } else {
        deleteSession(discordUserId);
        await btn.update({
          embeds: [new EmbedBuilder().setColor(COLOR_NEUTRAL).setDescription("Session cleared.")],
          components: [],
        });
      }
    } catch { /* timed out */ }
    return;
  }

  let url: string;
  try {
    url = getManifestUrl({
      serverUrl: session.serverUrl,
      userId: session.userId,
      accessToken: session.accessToken,
      enabledLibraries: session.enabledLibraries,
    });
  } catch (err) {
    await i.update({
      embeds: [errorEmbed(err instanceof Error ? err.message : "Could not generate URL")],
      components: [],
    });
    return;
  }

  const libNames = session.enabledLibraries.map((l) =>
    `${l.collectionType === "movies" ? "🎬" : "📺"} ${l.name}`
  ).join("\n");

  const doneRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("back_to_libs")
      .setLabel("← Change Libraries")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("disconnect_btn")
      .setLabel("Disconnect")
      .setStyle(ButtonStyle.Danger)
  );

  const msg = await i.update({
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR_SUCCESS)
        .setTitle("✅ Step 3 — Your Stremio Manifest URL")
        .setDescription(
          `**Paste this into Stremio:**\n\`\`\`\n${url}\n\`\`\`\n` +
            `**Libraries included:**\n${libNames}\n\n` +
            `In Stremio: **Addons → Community Addons → Install from URL**`
        )
        .setFooter({ text: "Keep this URL private — it contains your Jellyfin access token." }),
    ],
    components: [doneRow],
  });

  try {
    const btn = (await msg.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: 300_000,
    })) as ButtonInteraction;

    if (btn.customId === "back_to_libs") {
      await showLibraryStep(btn, discordUserId, true);
    } else {
      deleteSession(discordUserId);
      await btn.update({
        embeds: [new EmbedBuilder().setColor(COLOR_NEUTRAL).setDescription("Session cleared. Run `/jellyfin` to start again.")],
        components: [],
      });
    }
  } catch { /* timed out */ }
}

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("jellyfin")
    .setDescription("Set up your Jellyfin Stremio addon"),
];

export async function handleCommand(i: ChatInputCommandInteraction): Promise<void> {
  if (i.commandName !== "jellyfin") return;

  const session = getSession(i.user.id);

  if (session) {
    // Already connected — show status with action buttons
    const libNames =
      session.enabledLibraries.length > 0
        ? session.enabledLibraries.map((l) => `${l.collectionType === "movies" ? "🎬" : "📺"} ${l.name}`).join("\n")
        : "_None selected yet_";

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("go_to_libs")
        .setLabel("Manage Libraries")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("go_to_manifest")
        .setLabel("Get Manifest URL")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("disconnect_btn")
        .setLabel("Disconnect")
        .setStyle(ButtonStyle.Danger)
    );

    const reply = await i.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR_BRAND)
          .setTitle("📡 Already Connected")
          .addFields(
            { name: "Server", value: `\`${session.serverUrl}\``, inline: false },
            { name: "Username", value: session.username, inline: true },
            { name: "Enabled Libraries", value: libNames, inline: false }
          ),
      ],
      components: [row],
      ephemeral: true,
      fetchReply: true,
    });

    try {
      const btn = (await reply.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: 120_000,
      })) as ButtonInteraction;

      if (btn.customId === "go_to_libs") {
        await showLibraryStep(btn, i.user.id, true);
      } else if (btn.customId === "go_to_manifest") {
        if (session.enabledLibraries.length === 0) {
          await showLibraryStep(btn, i.user.id, true);
        } else {
          let url: string;
          try {
            url = getManifestUrl({
              serverUrl: session.serverUrl,
              userId: session.userId,
              accessToken: session.accessToken,
              enabledLibraries: session.enabledLibraries,
            });
          } catch (err) {
            await btn.update({
              embeds: [errorEmbed(err instanceof Error ? err.message : "Could not generate URL")],
              components: [],
            });
            return;
          }
          const libNamesForManifest = session.enabledLibraries
            .map((l) => `${l.collectionType === "movies" ? "🎬" : "📺"} ${l.name}`)
            .join("\n");
          await btn.update({
            embeds: [
              new EmbedBuilder()
                .setColor(COLOR_SUCCESS)
                .setTitle("✅ Your Stremio Manifest URL")
                .setDescription(
                  `**Paste this into Stremio:**\n\`\`\`\n${url}\n\`\`\`\n**Libraries included:**\n${libNamesForManifest}\n\nIn Stremio: **Addons → Community Addons → Install from URL**`
                )
                .setFooter({ text: "Keep this URL private — it contains your Jellyfin access token." }),
            ],
            components: [],
          });
        }
      } else {
        deleteSession(i.user.id);
        await btn.update({
          embeds: [new EmbedBuilder().setColor(COLOR_NEUTRAL).setDescription("Session cleared. Run `/jellyfin` to start again.")],
          components: [],
        });
      }
    } catch { /* timed out */ }

    return;
  }

  // Not connected — show welcome + connect button
  const connectRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("open_connect_modal")
      .setLabel("Connect Jellyfin")
      .setEmoji("🔗")
      .setStyle(ButtonStyle.Primary)
  );

  const reply = await i.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR_BRAND)
        .setTitle("🎬 Jellyfin → Stremio Setup")
        .setDescription(
          "Stream your Jellyfin library directly in Stremio.\n\n" +
            "**How it works:**\n" +
            "1. Connect your Jellyfin server\n" +
            "2. Choose which libraries to expose\n" +
            "3. Paste the generated URL into Stremio\n\n" +
            "Click below to get started."
        ),
    ],
    components: [connectRow],
    ephemeral: true,
    fetchReply: true,
  });

  let connectBtn: ButtonInteraction;
  try {
    connectBtn = (await reply.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: 120_000,
    })) as ButtonInteraction;
  } catch {
    await i.editReply({ embeds: [new EmbedBuilder().setColor(COLOR_NEUTRAL).setDescription("⏱️ Timed out.")], components: [] });
    return;
  }

  // Show modal for credentials
  const modal = new ModalBuilder()
    .setCustomId("jellyfin_connect_modal")
    .setTitle("Connect to Jellyfin")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("server_url")
          .setLabel("Server URL")
          .setPlaceholder("https://jellyfin.example.com")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("username")
          .setLabel("Username")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("password")
          .setLabel("Password")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );

  await connectBtn.showModal(modal);

  let modalSubmit: ModalSubmitInteraction;
  try {
    modalSubmit = await connectBtn.awaitModalSubmit({ time: 120_000 });
  } catch {
    await i.editReply({ embeds: [new EmbedBuilder().setColor(COLOR_NEUTRAL).setDescription("⏱️ Timed out.")], components: [] });
    return;
  }

  await modalSubmit.deferReply({ ephemeral: true });

  const serverUrl = modalSubmit.fields.getTextInputValue("server_url").replace(/\/$/, "");
  const username = modalSubmit.fields.getTextInputValue("username");
  const password = modalSubmit.fields.getTextInputValue("password");

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

    await modalSubmit.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR_SUCCESS)
          .setDescription(`✅ Connected as **${auth.username}** — loading libraries…`),
      ],
    });

    // Delete the deferReply message then hand off to library step via a fresh interaction
    // We need to send a new followUp-style message for the library step since deferReply is already consumed
    const libEnableIds = new Set(libraries.map((l) => l.id));
    const options = libraries.map((lib) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(lib.name)
        .setValue(lib.id)
        .setDescription(lib.collectionType === "movies" ? "Movies" : "TV Shows")
        .setEmoji(lib.collectionType === "movies" ? "🎬" : "📺")
        .setDefault(libEnableIds.has(lib.id))
    );

    if (options.length === 0) {
      await modalSubmit.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR_NEUTRAL)
            .setTitle("No Supported Libraries")
            .setDescription("No movie or TV show libraries found on your Jellyfin server."),
        ],
      });
      return;
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId("lib_select_post_connect")
      .setPlaceholder("Pick libraries to include in Stremio…")
      .setMinValues(0)
      .setMaxValues(libraries.length)
      .addOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

    const libMsg = await modalSubmit.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR_BRAND)
          .setTitle("📚 Step 2 — Select Libraries")
          .setDescription(
            `Choose which libraries to expose in Stremio.\nAll ${libraries.length} supported ${libraries.length === 1 ? "library is" : "libraries are"} pre-selected.`
          ),
      ],
      components: [row],
    });

    const sel = (await libMsg.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      time: 120_000,
    })) as StringSelectMenuInteraction;

    const chosen: Library[] = libraries.filter((l) => sel.values.includes(l.id));
    updateEnabledLibraries(i.user.id, chosen);

    if (chosen.length === 0) {
      await sel.update({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR_NEUTRAL)
            .setDescription("No libraries selected. Run `/jellyfin` and use **Manage Libraries** to enable some."),
        ],
        components: [],
      });
      return;
    }

    const finalSession = getSession(i.user.id)!;
    const url = getManifestUrl({
      serverUrl: finalSession.serverUrl,
      userId: finalSession.userId,
      accessToken: finalSession.accessToken,
      enabledLibraries: chosen,
    });

    const libNames = chosen.map((l) => `${l.collectionType === "movies" ? "🎬" : "📺"} ${l.name}`).join("\n");

    await sel.update({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR_SUCCESS)
          .setTitle("✅ Step 3 — Your Stremio Manifest URL")
          .setDescription(
            `**Paste this into Stremio:**\n\`\`\`\n${url}\n\`\`\`\n` +
              `**Libraries included:**\n${libNames}\n\n` +
              `In Stremio: **Addons → Community Addons → Install from URL**`
          )
          .setFooter({ text: "Keep this URL private — it contains your Jellyfin access token." }),
      ],
      components: [],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await modalSubmit.editReply({ embeds: [errorEmbed(`Connection failed: ${msg}`)], components: [] });
  }
}

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
import { jellyfinAuth, jellyfinLibraries, getManifestUrl, createJellyfinUser, getActiveSessions, terminateSession } from "./api.js";

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
      maxStreams: session.maxStreams,
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

async function handleAddUser(i: ChatInputCommandInteraction): Promise<void> {
  // If the user already has a connected session, pre-fill server URL from it
  const session = getSession(i.user.id);

  const openRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("open_adduser_modal")
      .setLabel("Create Jellyfin User")
      .setEmoji("👤")
      .setStyle(ButtonStyle.Primary)
  );

  const reply = await i.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR_BRAND)
        .setTitle("👤 Create a New Jellyfin User")
        .setDescription(
          "Creates a new account on your Jellyfin server.\n\n" +
            "**Requirements:** You must provide admin credentials.\n" +
            (session ? `Your connected server is \`${session.serverUrl}\` — you can use the same URL below.` : "")
        ),
    ],
    components: [openRow],
    ephemeral: true,
    fetchReply: true,
  });

  let btn: ButtonInteraction;
  try {
    btn = (await reply.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: 120_000,
    })) as ButtonInteraction;
  } catch {
    await i.editReply({ embeds: [new EmbedBuilder().setColor(COLOR_NEUTRAL).setDescription("⏱️ Timed out.")], components: [] });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId("adduser_modal")
    .setTitle("Create Jellyfin User")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("server_url")
          .setLabel("Server URL")
          .setPlaceholder(session?.serverUrl ?? "https://jellyfin.example.com")
          .setValue(session?.serverUrl ?? "")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("admin_username")
          .setLabel("Admin Username")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("admin_password")
          .setLabel("Admin Password")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("new_username")
          .setLabel("New Username")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("new_password")
          .setLabel("New User Password")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );

  await btn.showModal(modal);

  let modalSubmit: ModalSubmitInteraction;
  try {
    modalSubmit = await btn.awaitModalSubmit({ time: 120_000 });
  } catch {
    await i.editReply({ embeds: [new EmbedBuilder().setColor(COLOR_NEUTRAL).setDescription("⏱️ Timed out.")], components: [] });
    return;
  }

  await modalSubmit.deferReply({ ephemeral: true });

  const serverUrl = modalSubmit.fields.getTextInputValue("server_url").replace(/\/$/, "");
  const adminUsername = modalSubmit.fields.getTextInputValue("admin_username");
  const adminPassword = modalSubmit.fields.getTextInputValue("admin_password");
  const newUsername = modalSubmit.fields.getTextInputValue("new_username");
  const newPassword = modalSubmit.fields.getTextInputValue("new_password");

  try {
    // Authenticate admin first to get their token
    const auth = await jellyfinAuth(serverUrl, adminUsername, adminPassword);
    // Create the new user
    const result = await createJellyfinUser(serverUrl, auth.accessToken, newUsername, newPassword);

    await modalSubmit.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR_SUCCESS)
          .setTitle("✅ User Created")
          .addFields(
            { name: "Username", value: result.username, inline: true },
            { name: "Server", value: `\`${serverUrl}\``, inline: false }
          )
          .setDescription("The account is ready. Share the username and password with the new user."),
      ],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await modalSubmit.editReply({ embeds: [errorEmbed(`Failed: ${msg}`)] });
  }
}

function typeEmoji(type: string | null): string {
  if (type === "Movie") return "🎬";
  if (type === "Episode") return "📺";
  return "▶️";
}

async function handleStreams(i: ChatInputCommandInteraction): Promise<void> {
  const session = getSession(i.user.id);

  // If already connected, skip straight to fetching sessions
  if (session) {
    await showStreams(i, session.serverUrl, session.accessToken, false);
    return;
  }

  // Not connected — ask for admin credentials via modal
  const openRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("open_streams_modal")
      .setLabel("View Active Streams")
      .setEmoji("📡")
      .setStyle(ButtonStyle.Primary)
  );

  const reply = await i.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR_BRAND)
        .setTitle("📡 Active Streams")
        .setDescription("You're not connected yet. Enter your Jellyfin credentials to view active streams."),
    ],
    components: [openRow],
    ephemeral: true,
    fetchReply: true,
  });

  let btn: ButtonInteraction;
  try {
    btn = (await reply.awaitMessageComponent({ componentType: ComponentType.Button, time: 120_000 })) as ButtonInteraction;
  } catch {
    await i.editReply({ embeds: [new EmbedBuilder().setColor(COLOR_NEUTRAL).setDescription("⏱️ Timed out.")], components: [] });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId("streams_modal")
    .setTitle("Jellyfin — View Streams")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("server_url").setLabel("Server URL").setPlaceholder("https://jellyfin.example.com").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("username").setLabel("Username (admin recommended)").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("password").setLabel("Password").setStyle(TextInputStyle.Short).setRequired(true)
      )
    );

  await btn.showModal(modal);

  let modalSubmit: ModalSubmitInteraction;
  try {
    modalSubmit = await btn.awaitModalSubmit({ time: 120_000 });
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
    await showStreams(modalSubmit, auth.serverUrl, auth.accessToken, true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await modalSubmit.editReply({ embeds: [errorEmbed(`Auth failed: ${msg}`)] });
  }
}

async function showStreams(
  i: ChatInputCommandInteraction | ModalSubmitInteraction,
  serverUrl: string,
  accessToken: string,
  deferred: boolean
): Promise<void> {
  if (!deferred) await i.deferReply({ ephemeral: true });

  let sessions;
  try {
    sessions = await getActiveSessions(serverUrl, accessToken);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    await i.editReply({ embeds: [errorEmbed(`Could not fetch sessions: ${msg}`)] });
    return;
  }

  if (sessions.length === 0) {
    await i.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR_NEUTRAL)
          .setTitle("📡 Active Streams")
          .setDescription("No active streams right now."),
      ],
    });
    return;
  }

  const lines = sessions.map((s, idx) =>
    `**${idx + 1}.** ${typeEmoji(s.nowPlayingType)} **${s.nowPlayingTitle ?? "Unknown"}**\n` +
    `┗ 👤 ${s.userName} · 📱 ${s.client} (${s.deviceName})${s.isPaused ? " · ⏸ Paused" : ""}`
  );

  const embed = new EmbedBuilder()
    .setColor(COLOR_BRAND)
    .setTitle(`📡 Active Streams — ${sessions.length} playing`)
    .setDescription(lines.join("\n\n"))
    .setFooter({ text: `Server: ${serverUrl}` });

  // Build terminate select only if there are streams to kill
  const selectOptions = sessions.map((s, idx) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`Stop: ${s.userName} — ${s.nowPlayingTitle?.slice(0, 50) ?? "Unknown"}`)
      .setValue(s.id)
      .setDescription(`${s.client} · ${s.deviceName}`)
      .setEmoji(idx % 2 === 0 ? "🛑" : "🔴")
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId("terminate_stream_select")
    .setPlaceholder("Select a stream to stop…")
    .setMinValues(1)
    .setMaxValues(sessions.length)
    .addOptions(selectOptions);

  const refreshRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("refresh_streams").setLabel("Refresh").setEmoji("🔄").setStyle(ButtonStyle.Secondary)
  );
  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  const msg = await i.editReply({ embeds: [embed], components: [selectRow, refreshRow] });

  try {
    const action = await msg.awaitMessageComponent({ time: 120_000 });

    if (action.customId === "refresh_streams") {
      await (action as ButtonInteraction).deferUpdate();
      await showStreams(i, serverUrl, accessToken, true);
    } else {
      const sel = action as StringSelectMenuInteraction;
      await sel.deferUpdate();

      const results = await Promise.allSettled(
        sel.values.map((id) => terminateSession(serverUrl, accessToken, id))
      );

      const stopped = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;

      const lines: string[] = [];
      if (stopped > 0) lines.push(`✅ Stopped **${stopped}** stream${stopped !== 1 ? "s" : ""}`);
      if (failed > 0) lines.push(`❌ Failed to stop **${failed}** stream${failed !== 1 ? "s" : ""}`);

      await i.editReply({
        embeds: [new EmbedBuilder().setColor(stopped > 0 ? COLOR_SUCCESS : COLOR_ERROR).setDescription(lines.join("\n"))],
        components: [],
      });
    }
  } catch { /* timed out */ }
}

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("jellyfin")
    .setDescription("Set up your Jellyfin Stremio addon"),
  new SlashCommandBuilder()
    .setName("jellyfin-adduser")
    .setDescription("Create a new user account on your Jellyfin server"),
  new SlashCommandBuilder()
    .setName("jellyfin-streams")
    .setDescription("View and manage active streams on your Jellyfin server"),
];

export async function handleCommand(i: ChatInputCommandInteraction): Promise<void> {
  if (i.commandName === "jellyfin-adduser") {
    await handleAddUser(i);
    return;
  }
  if (i.commandName === "jellyfin-streams") {
    await handleStreams(i);
    return;
  }
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
            { name: "Max Streams", value: session.maxStreams === 0 ? "Unlimited" : `${session.maxStreams}`, inline: true },
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
              maxStreams: session.maxStreams,
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
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("max_streams")
          .setLabel("Max Concurrent Streams (0 = unlimited)")
          .setPlaceholder("0")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
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
  const maxStreamsRaw = modalSubmit.fields.getTextInputValue("max_streams").trim();
  const maxStreams = maxStreamsRaw === "" ? 0 : Math.max(0, parseInt(maxStreamsRaw, 10) || 0);

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
      maxStreams,
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
      maxStreams: finalSession.maxStreams,
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

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');

const {
  ActionRowBuilder,
  AuditLogEvent,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ContainerBuilder,
  Events,
  ActivityType,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  RoleSelectMenuBuilder,
  Routes,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder,
} = require('discord.js');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const configuredLogChannelId = process.env.LOG_CHANNEL_ID;
const configuredGuildId = process.env.GUILD_ID;
const botOwnerId = process.env.BOT_OWNER_ID || null;
const configFilePath = path.join(__dirname, '..', 'data', 'guild-configs.json');

if (!token) {
  throw new Error('DISCORD_TOKEN est manquant dans le fichier .env.');
}

const sensitivePermissions = new Map([
  [PermissionFlagsBits.Administrator, 'Administrateur'],
  [PermissionFlagsBits.BanMembers, 'Bannir des membres'],
  [PermissionFlagsBits.KickMembers, 'Expulser des membres'],
  [PermissionFlagsBits.ManageRoles, 'Gérer les rôles'],
  [PermissionFlagsBits.ManageChannels, 'Gérer les salons'],
  [PermissionFlagsBits.ManageGuild, 'Gérer le serveur'],
  [PermissionFlagsBits.ModerateMembers, 'Exclure temporairement'],
  [PermissionFlagsBits.ManageMessages, 'Gérer les messages'],
  [PermissionFlagsBits.MentionEveryone, 'Mentionner \\@everyone et \\@here'],
  [PermissionFlagsBits.ManageWebhooks, 'Gérer les webhooks'],
  [PermissionFlagsBits.ManageNicknames, 'Gérer les pseudonymes'],
  [PermissionFlagsBits.ViewAuditLog, "Voir l'audit log"],
]);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

function ensureConfigFile() {
  fs.mkdirSync(path.dirname(configFilePath), { recursive: true });
  if (!fs.existsSync(configFilePath)) {
    fs.writeFileSync(configFilePath, '{}', 'utf8');
  }
}

function loadGuildConfigs() {
  ensureConfigFile();
  try {
    const raw = fs.readFileSync(configFilePath, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.error('Impossible de lire le fichier de configuration des guildes:', error);
    return {};
  }
}

function saveGuildConfigs(configs) {
  ensureConfigFile();
  fs.writeFileSync(configFilePath, JSON.stringify(configs, null, 2), 'utf8');
}

function getGuildConfig(guildIdValue) {
  const configs = loadGuildConfigs();
  const guildConfig = configs[guildIdValue] || {};

  return {
    enabled: guildConfig.enabled ?? true,
    dangerousRoleIds: Array.isArray(guildConfig.dangerousRoleIds) ? guildConfig.dangerousRoleIds : [],
    logChannelId: guildConfig.logChannelId || configuredLogChannelId || null,
  };
}

function saveGuildConfig(guildIdValue, nextConfig) {
  const configs = loadGuildConfigs();
  configs[guildIdValue] = nextConfig;
  saveGuildConfigs(configs);
}

function getAddedRoles(oldMember, newMember) {
  return newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id));
}

function getSensitivePermissions(role) {
  return [...sensitivePermissions.entries()]
    .filter(([permission]) => role.permissions.has(permission))
    .map(([, label]) => label);
}

function buildPanelSummary(guild, config) {
  const roleNames = config.dangerousRoleIds
    .map((roleId) => guild.roles.cache.get(roleId)?.name || `ID ${roleId}`)
    .join(', ');

  return `Panneau de configuration des rôles dangereux\nStatut: ${config.enabled ? 'actif' : 'désactivé'}\nRôles surveillés: ${roleNames || 'aucun'}`;
}

function buildPanelComponents(guild, config) {
  const roleMenu = new RoleSelectMenuBuilder()
    .setCustomId('dangerous-role-panel')
    .setPlaceholder('Sélectionner les rôles dangereux')
    .setMinValues(0)
    .setMaxValues(25)
    .setDefaultRoles(config.dangerousRoleIds.filter((roleId) => guild.roles.cache.has(roleId)));

  const toggleButton = new ButtonBuilder()
    .setCustomId('dangerous-toggle')
    .setStyle(config.enabled ? ButtonStyle.Secondary : ButtonStyle.Success)
    .setLabel(config.enabled ? 'Désactiver le contrôle' : 'Activer le contrôle');

  const clearButton = new ButtonBuilder()
    .setCustomId('dangerous-clear')
    .setStyle(ButtonStyle.Danger)
    .setLabel('Vider la liste');

  return [
    new ActionRowBuilder().addComponents(roleMenu),
    new ActionRowBuilder().addComponents(toggleButton, clearButton),
  ];
}

function buildPanelMessage(guild, config, isOwner) {
  const roleNames = config.dangerousRoleIds
    .map((roleId) => guild.roles.cache.get(roleId)?.name || `ID ${roleId}`)
    .join(', ') || 'aucun';

  const accessText = isOwner
    ? 'Accès: propriétaire du bot - modification autorisée.'
    : 'Accès: lecture seule - réservé au propriétaire du bot.';

  const panelContainer = new ContainerBuilder()
    .setAccentColor(0x808080)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('## Panneau de sécurité'),
      new TextDisplayBuilder().setContent(
        `**Serveur**\n${guild.name}\n\n**Statut**\n${config.enabled ? 'Actif' : 'Désactivé'}\n\n**Rôles surveillés**\n${roleNames}\n\n**${accessText}**`,
      ),
    );

  const chunks = [panelContainer];
  if (isOwner) {
    chunks.push(...buildPanelComponents(guild, config));
  }

  return {
    components: chunks,
    flags: MessageFlags.IsComponentsV2,
  };
}

async function registerSlashCommands() {
  if (!clientId || !guildId) {
    console.warn('DISCORD_CLIENT_ID ou DISCORD_GUILD_ID manquant. /panel ne sera pas enregistré.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(token);
  const commands = [
    new SlashCommandBuilder()
      .setName('panel')
      .setDescription('Ouvre le panneau de configuration des rôles dangereux')
      .toJSON(),
  ];

  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log('Commande slash /panel enregistrée.');
  } catch (error) {
    console.error('Erreur lors de l’enregistrement de /panel:', error);
  }
}

async function findRoleAuthor(guild, member) {
  try {
    const auditLogs = await guild.fetchAuditLogs({
      type: AuditLogEvent.MemberRoleUpdate,
      limit: 10,
    });

    const entry = auditLogs.entries.find((candidate) => {
      const targetMatches = candidate.target?.id === member.id;
      const recentEnough = Date.now() - candidate.createdTimestamp < 15_000;
      return targetMatches && recentEnough;
    });

    return entry?.executor ?? null;
  } catch (error) {
    console.error(`Impossible de lire l'audit log de ${guild.name}:`, error);
    return null;
  }
}

async function getLogChannel(guild, guildConfig) {
  const channelId = guildConfig.logChannelId || configuredLogChannelId || guild.systemChannelId;
  if (!channelId) return null;

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return null;
  return channel;
}

function buildLogMessage({ guild, recipient, author, roles }) {
  const roleLines = roles
    .map(({ role, permissions }) => {
      const permissionLines = permissions.map((permission) => `- ${permission}`).join('\n');
      return `### ${role.name} (ID: ${role.id})\n${permissionLines}`;
    })
    .join('\n\n');

  const authorText = author ? `${author.username}#${author.discriminator} (${author.id})` : 'Inconnu (audit log indisponible)';
  const recipientText = `${recipient.username}#${recipient.discriminator} (${recipient.id})`;
  const timestamp = Math.floor(Date.now() / 1000);

  const container = new ContainerBuilder()
    .setAccentColor(0x808080)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('## ROLE SENSIBLE AJOUTE'),
      new TextDisplayBuilder().setContent(
        `**Serveur**\n${guild.name}\n\n**Role(s) attribue(s)**\n${roleLines}`,
      ),
      new TextDisplayBuilder().setContent(
        `**Membre qui les a recus**\n${recipientText}\n\n**Utilisateur qui les a donnes**\n${authorText}\n\n<t:${timestamp}:F>`,
      ),
    );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
  };
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Connecte en tant que ${readyClient.user.tag}`);
  console.log(`Serveurs surveilles : ${readyClient.guilds.cache.size}`);
  if (!botOwnerId && readyClient.application?.owner) {
    console.log(`Propriétaire du bot détecté : ${readyClient.application.owner.id}`);
  }

  await readyClient.user.setPresence({
    activities: [
      {
        name: '.gg/sansappel-x',
        type: ActivityType.Streaming,
        url: 'https://discord.gg/sansappel-x',
      },
    ],
    status: 'streaming',
  });

  await registerSlashCommands();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.guild) return;

  if (interaction.isChatInputCommand() && interaction.commandName === 'panel') {
    const guildConfig = getGuildConfig(interaction.guild.id);
    const isOwner = !!botOwnerId && interaction.user.id === botOwnerId;
    const panel = buildPanelMessage(interaction.guild, guildConfig, isOwner);

    await interaction.reply(panel);
    return;
  }

  if (interaction.isRoleSelectMenu() && interaction.customId === 'dangerous-role-panel') {
    if (!botOwnerId || interaction.user.id !== botOwnerId) {
      await interaction.reply({
        content: 'Accès refusé. Seul le propriétaire du bot peut modifier la configuration.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildConfig = getGuildConfig(interaction.guild.id);
    guildConfig.dangerousRoleIds = interaction.values;
    saveGuildConfig(interaction.guild.id, guildConfig);

    await interaction.update(buildPanelMessage(interaction.guild, guildConfig, true));
    return;
  }

  if (interaction.isButton()) {
    if (!botOwnerId || interaction.user.id !== botOwnerId) {
      await interaction.reply({
        content: 'Accès refusé. Seul le propriétaire du bot peut modifier la configuration.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildConfig = getGuildConfig(interaction.guild.id);

    if (interaction.customId === 'dangerous-toggle') {
      guildConfig.enabled = !guildConfig.enabled;
      saveGuildConfig(interaction.guild.id, guildConfig);
    }

    if (interaction.customId === 'dangerous-clear') {
      guildConfig.dangerousRoleIds = [];
      saveGuildConfig(interaction.guild.id, guildConfig);
    }

    await interaction.update(buildPanelMessage(interaction.guild, guildConfig, true));
  }
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (configuredGuildId && newMember.guild.id !== configuredGuildId) return;

  const guildConfig = getGuildConfig(newMember.guild.id);
  if (!guildConfig.enabled) return;

  const dangerousRoleIds = new Set(guildConfig.dangerousRoleIds);
  const addedRoles = getAddedRoles(oldMember, newMember);

  const sensitiveRoles = addedRoles
    .map((role) => {
      const permissions = getSensitivePermissions(role);
      const isMarkedDangerous = dangerousRoleIds.has(role.id);

      if (!permissions.length && !isMarkedDangerous) {
        return null;
      }

      return {
        role,
        permissions: permissions.length ? permissions : ['Rôle marqué comme dangereux dans le panneau'],
      };
    })
    .filter(Boolean);

  if (sensitiveRoles.length === 0) return;

  const [author, logChannel] = await Promise.all([
    findRoleAuthor(newMember.guild, newMember),
    getLogChannel(newMember.guild, guildConfig),
  ]);

  if (!logChannel) {
    console.error(`Aucun salon de logs textuel disponible pour ${newMember.guild.name}.`);
    return;
  }

  await logChannel.send(buildLogMessage({
    guild: newMember.guild,
    recipient: newMember.user,
    author,
    roles: sensitiveRoles,
  })).catch((error) => {
    console.error(`Impossible d'envoyer le log dans ${logChannel.name}:`, error);
  });
});

client.on(Events.Error, (error) => console.error('Erreur Discord:', error));

client.login(token);

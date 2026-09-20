# Oeil Sauron

Bot Discord JavaScript qui journalise l'attribution de roles possedant des permissions sensibles.

## Installation

1. Installe Node.js 18.17 ou plus recent.
2. Execute `npm install`.
3. Copie `.env.example` vers `.env`.
4. Renseigne `DISCORD_TOKEN` et, si besoin, `LOG_CHANNEL_ID`.
5. Invite le bot avec les scopes `bot` et `applications.commands`, et au minimum les permissions `View Audit Log`, `View Channels` et `Send Messages`.
6. Lance le bot avec `npm start`.

Le bot surveille notamment `Administrator`, `Ban Members`, `Kick Members`, `Manage Roles`, `Manage Channels`, `Manage Guild`, `Moderate Members`, `Manage Messages`, `Mention Everyone`, `Manage Webhooks`, `Manage Nicknames` et `View Audit Log`.

Le compte du bot doit pouvoir voir les roles concernes et lire l'audit log. Discord ne permet pas de recuperer l'auteur d'une attribution de role sans la permission `View Audit Log`.

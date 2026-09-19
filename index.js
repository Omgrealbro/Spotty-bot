process.env.FFMPEG_PATH = require('ffmpeg-static');
require('dotenv').config();
const http = require('http');
const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');
const { Player } = require('discord-player');
const { DefaultExtractors } = require('@discord-player/extractor');

// Keep Render Web Service active
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Spotty Bot is running!');
}).listen(PORT, () => {
    console.log(`HTTP Web Server listening on port ${PORT}`);
});

// Initialize Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Initialize Player
const player = new Player(client);

// Slash Commands Definition
const commands = [
    {
        name: 'play',
        description: 'Play music from YouTube, Spotify, or URL',
        options: [
            {
                name: 'query',
                type: 3,
                description: 'Song name or URL',
                required: true
            }
        ]
    },
    { name: 'join', description: 'Joins your current voice channel' },
    { name: 'leave', description: 'Leaves the voice channel' },
    { name: 'musiclist', description: 'Shows the current queue' },
    { name: 'musicboard', description: 'Controls music playback' },
    { name: 'help', description: 'Shows all available commands' }
];

// Ready Event
client.once('ready', async () => {
    console.log(`🎵 Logged in as ${client.user.tag}!`);
    await player.extractors.loadMulti(DefaultExtractors);

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        console.log('✅ Successfully registered slash commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
});

// Interaction Handler
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, member, guild, channel } = interaction;

    if (commandName === 'play') {
        const query = interaction.options.getString('query');
        const voiceChannel = member.voice.channel;

        if (!voiceChannel) {
            return interaction.reply({ content: 'You need to join a voice channel first!', ephemeral: true });
        }

        await interaction.deferReply();

        try {
            const result = await player.search(query, {
                requestedBy: interaction.user
            });

            if (!result || !result.tracks.length) {
                return interaction.editReply('No results found!');
            }

            const { track } = await player.play(voiceChannel, result, {
                nodeOptions: {
                    metadata: channel
                }
            });

            return interaction.editReply(`🎶 Added to queue: **${track.title}**`);
        } catch (error) {
            console.error('Play error:', error);
            return interaction.editReply('Failed to play the track!');
        }
    }

    if (commandName === 'join') {
        const voiceChannel = member.voice.channel;
        if (!voiceChannel) {
            return interaction.reply({ content: 'You need to join a voice channel first!', ephemeral: true });
        }
        await interaction.reply('Joined Voice Channel!');
    }

    if (commandName === 'leave') {
        const queue = player.nodes.get(guild.id);
        if (queue) queue.delete();
        await interaction.reply('Left Voice Channel!');
    }
});

client.login(process.env.TOKEN);

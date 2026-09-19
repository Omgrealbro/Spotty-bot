process.env.FFMPEG_PATH = require('ffmpeg-static');
require('dotenv').config();
const { 
    Client, GatewayIntentBits, REST, Routes, 
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField 
} = require('discord.js');
const { Player } = require('discord-player');
const { DefaultExtractors } = require('@discord-player/extractor');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Low-CPU audio buffer configuration for Termux / mobile hardware
const player = new Player(client, {
    ytdlOptions: {
        quality: 'lowestaudio',
        filter: 'audioonly',
        highWaterMark: 1 << 24
    }
});

const commands = [
    {
        name: 'play',
        description: 'Play music from YouTube, Spotify, or by search',
        options: [{ name: 'query', type: 3, description: 'Song name or URL', required: true }]
    },
    { name: 'join', description: 'Joins your current voice channel' },
    { name: 'leave', description: 'Leaves the voice channel and stops music' },
    { name: 'musiclist', description: 'Shows the current music queue' },
    { name: 'musicboard', description: 'Controller board for music (Admins Only)' },
    { name: 'help', description: 'Shows all available bot commands' }
];

client.once('ready', async () => {
    console.log(`🎵 Logged in as ${client.user.tag}!`);
    await player.extractors.loadDefault((ext) => ext !== 'YouTubeExtractor');
    
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Successfully registered slash commands!');
    } catch (error) {
        console.error('Error registering slash commands:', error);
    }
});

client.on('guildCreate', async guild => {
    const defaultChannel = guild.systemChannel || guild.channels.cache.find(
        channel => channel.isTextBased() && 
        channel.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages)
    );

    if (!defaultChannel) return;

    const welcomeEmbed = new EmbedBuilder()
        .setColor('#01F9C6')
        .setTitle('👋 Hello!')
        .setDescription("Hello its me Spotty! Im a music bot, thank you for choosing me\n\nUse `/help` to view my commands :3")
        .setThumbnail(client.user.displayAvatarURL());

    defaultChannel.send({ embeds: [welcomeEmbed] }).catch(() => {});
});

client.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ Only Administrators can use the board.', ephemeral: true });
        }

        const queue = player.nodes.get(interaction.guildId);
        if (!queue || !queue.isPlaying()) {
            return interaction.reply({ content: 'No music is currently playing.', ephemeral: true });
        }

        await interaction.deferUpdate();

        switch (interaction.customId) {
            case 'pause_play':
                queue.node.setPaused(!queue.node.isPaused());
                break;
            case 'skip':
                queue.node.skip();
                break;
            case 'vol_up':
                queue.node.setVolume(Math.min(queue.node.volume + 10, 100));
                break;
            case 'vol_down':
                queue.node.setVolume(Math.max(queue.node.volume - 10, 0));
                break;
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    const memberVC = interaction.member.voice.channel;
    if (['play', 'join', 'leave', 'musicboard'].includes(commandName) && !memberVC) {
        return interaction.reply({ 
            embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ You must be in a Voice Channel first!')]
        });
    }

    if (commandName === 'join') {
        const queue = player.nodes.create(interaction.guild, {
            metadata: { channel: interaction.channel }
        });
        await queue.connect(memberVC);
        
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Joined Voice Channel')
            .setDescription(`Successfully bound to **${memberVC.name}**.`);
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'play') {
        await interaction.deferReply();
        let query = interaction.options.getString('query');

        if (query.includes('music.youtube.com')) {
            query = query.replace('music.youtube.com', 'www.youtube.com');
        }

        try {
            const { track } = await player.play(memberVC, query, {
                nodeOptions: { 
                    metadata: { channel: interaction.channel }, 
                    volume: 50,
                    inlineVolume: false,      // Disables CPU-heavy software volume matrix
                    disableResampler: true,  // Disables CPU-heavy audio resampling
                    bufferingTimeout: 30000,
                    leaveOnEmpty: true,
                    leaveOnEmptyCooldown: 300000
                },
                requestedBy: interaction.user
            });

            const embed = new EmbedBuilder()
                .setColor('#01F9C6')
                .setTitle('🎶 Added to Queue')
                .setDescription(`**[${track.title}](${track.url})** has been added!`)
                .setThumbnail(track.thumbnail)
                .setFooter({ text: `Added by ${interaction.user.tag}` });

            return interaction.followUp({ embeds: [embed] });
        } catch (e) {
            return interaction.followUp(`❌ Something went wrong: ${e.message}`);
        }
    }

    if (commandName === 'leave') {
        const queue = player.nodes.get(interaction.guildId);
        if (queue) queue.delete();
        
        const embed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('👋 Left Voice Channel')
            .setDescription('Stopped the music and cleared the queue.');
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'musiclist') {
        const queue = player.nodes.get(interaction.guildId);
        if (!queue || !queue.tracks.size) {
            return interaction.reply({ 
                embeds: [new EmbedBuilder().setColor('#0000FF').setDescription('The queue is currently empty.')] 
            });
        }

        const tracksString = queue.tracks.toArray().map((t, i) => `**${i + 1}.** ${t.title}`).join('\n').slice(0, 2048);
        
        const embed = new EmbedBuilder()
            .setColor('#0000FF')
            .setTitle('📜 Current Music Queue')
            .setDescription(tracksString);
        return interaction.reply({ embeds: [embed] });
    }

    if (commandName === 'musicboard') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ 
                embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('❌ You need **Administrator** permission to spawn the board.')],
                ephemeral: true 
            });
        }

        const queue = player.nodes.get(interaction.guildId);
        if (!queue || !queue.currentTrack) {
            return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FF0000').setDescription('No music is currently playing.')] });
        }

        const track = queue.currentTrack;

        const embed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('🎛️ Music Controller Board')
            .setDescription(`**Now Playing:**\n[${track.title}](${track.url})`)
            .setThumbnail(track.thumbnail)
            .setFooter({ text: `Track added by ${track.requestedBy?.tag || 'Unknown'}` });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('vol_down').setLabel('🔉 Vol -').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('pause_play').setLabel('⏯️ Play/Pause').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('skip').setLabel('⏭️ Next').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('vol_up').setLabel('🔊 Vol +').setStyle(ButtonStyle.Secondary)
        );

        return interaction.reply({ embeds: [embed], components: [row] });
    }

    if (commandName === 'help') {
        const embed = new EmbedBuilder()
            .setColor('#800080')
            .setTitle('🤖 Spotty Commands')
            .addFields(
                { name: '🎵 `/play [song/link]`', value: 'Play music from YT, Spotify, or name' },
                { name: '📥 `/join`', value: 'Make the bot join your VC' },
                { name: '📤 `/leave`', value: 'Stop music and leave VC' },
                { name: '📜 `/musiclist`', value: 'View the upcoming song queue' },
                { name: '🎛️ `/musicboard`', value: 'Spawn the admin controller board' },
                { name: '❓ `/help`', value: 'Show this message' }
            )
            .setFooter({ text: 'Enjoy the music with Spotty!' });
        return interaction.reply({ embeds: [embed] });
    }
});

client.login(process.env.TOKEN);
require('http').createServer((_, r) => r.end('OK')).listen(process.env.PORT || 3000);


        require('dotenv').config();
        const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, ActivityType } = require('discord.js');
        const express = require('express');
        const ms = require('ms');

        
  		const client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMessageReactions
            ]
        });

        const activeGiveaways = new Map();
        const endedGiveaways = new Map();

        // Slash commands
        const commands = [
            {
                name: 'start',
                description: 'Start a new giveaway',
                options: [
                    { name: 'channel', type: 7, description: 'Channel to start giveaway in', required: true },
                    { name: 'duration', type: 3, description: 'Duration (e.g., 1d, 2h)', required: true },
                    { name: 'prize', type: 3, description: 'Prize to win', required: true },
                    { name: 'winners', type: 4, description: 'Number of winners', required: true }
                ]
            },
            {
                name: 'end',
                description: 'End a giveaway early',
                options: [
                    { name: 'message_id', type: 3, description: 'Giveaway message ID', required: true }
                ]
            },
            {
                name: 'reroll',
                description: 'Reroll an ended giveaway',
                options: [
                    { name: 'message_id', type: 3, description: 'Ended giveaway message ID', required: true }
                ]
            },
            {
                name: 'stats',
                description: 'Show bot statistics'
            },
            {
                name: 'help',
                description: 'Show help information'
            }
        ];

        const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

        (async () => {
            try {
                console.log('Registering slash commands...');
                await rest.put(
                    Routes.applicationCommands(process.env.CLIENT_ID),
                    { body: commands }
                );
                console.log('Slash commands registered successfully!');
            } catch (error) {
                console.error('Error registering commands:', error);
            }
        })();

        client.on('ready', () => {
            console.log(`Logged in as ${client.user.tag}`);
        });

        // Helper function to create giveaway embed
        function createGiveawayEmbed(duration, prize, winners) {
            return new EmbedBuilder()
                .setTitle('🎉 GIVEAWAY 🎉')
                .setDescription(
                    `**Prize:** ${prize}\n` +
                    `**Duration:** ${duration}\n` +
                    `**Winners:** ${winners}\n\n` +
                    'React with 🎉 to enter!'
                )
                .setColor('#FFD700')
                .setFooter({ text: `${client.user.username} Giveaway System` })
                .setTimestamp();
        }

        // Helper function to end giveaway
        async function endGiveaway(messageId, channel) {
            if (!activeGiveaways.has(messageId)) return false;

            const giveaway = activeGiveaways.get(messageId);
            clearTimeout(giveaway.timeout);
            activeGiveaways.delete(messageId);

            const message = await channel.messages.fetch(messageId).catch(() => null);
            if (!message) return false;

            const reactions = await message.reactions.cache.get('🎉').users.fetch();
            const participants = reactions.filter(user => !user.bot).map(user => user.id);

            let winners = [];
            for (let i = 0; i < giveaway.winners && participants.length > 0; i++) {
                const winnerIndex = Math.floor(Math.random() * participants.length);
                winners.push(`<@${participants[winnerIndex]}>`);
                participants.splice(winnerIndex, 1);
            }

            const winnerText = winners.length > 0 ? winners.join(', ') : 'No valid participants';

            const endEmbed = new EmbedBuilder()
                .setTitle('🎉 GIVEAWAY ENDED 🎉')
                .setDescription(
                    `**Prize:** ${giveaway.prize}\n` +
                    `**Winners:** ${winnerText}`
                )
                .setColor('#FF0000')
                .setFooter({ text: `${client.user.username} Giveaway System` })
                .setTimestamp();

            const endMessage = await channel.send({ embeds: [endEmbed] });

            endedGiveaways.set(messageId, {
                channelId: channel.id,
                prize: giveaway.prize,
                winners: giveaway.winners,
                endedAt: new Date(),
                endMessageId: endMessage.id
            });

            return true;
        }

        // Helper function to reroll giveaway
        async function rerollGiveaway(messageId) {
            if (!endedGiveaways.has(messageId)) return null;

            const giveaway = endedGiveaways.get(messageId);
            const channel = await client.channels.fetch(giveaway.channelId);
            const originalMessage = await channel.messages.fetch(messageId).catch(() => null);
            if (!originalMessage) return null;

            const reactions = await originalMessage.reactions.cache.get('🎉').users.fetch();
            const participants = reactions.filter(user => !user.bot).map(user => user.id);

            let newWinners = [];
            for (let i = 0; i < giveaway.winners && participants.length > 0; i++) {
                const winnerIndex = Math.floor(Math.random() * participants.length);
                newWinners.push(`<@${participants[winnerIndex]}>`);
                participants.splice(winnerIndex, 1);
            }

            return {
                prize: giveaway.prize,
                winners: newWinners,
                channel,
                endMessageId: giveaway.endMessageId
            };
        }

        // Slash commands
        client.on('interactionCreate', async interaction => {
            if (!interaction.isCommand()) return;

            const { commandName, options } = interaction;

            if (commandName === 'start') {
                if (!interaction.memberPermissions.has('ManageMessages')) {
                    return interaction.reply({ content: 'You need the Manage Messages permission to start giveaways.', ephemeral: true });
                }

                const channel = options.getChannel('channel');
                const duration = options.getString('duration');
                const prize = options.getString('prize');
                const winners = options.getInteger('winners');

                const embed = createGiveawayEmbed(duration, prize, winners);
                const giveawayMessage = await channel.send({ embeds: [embed] });
                await giveawayMessage.react('🎉');

                const timeout = setTimeout(async () => {
                    await endGiveaway(giveawayMessage.id, channel);
                }, ms(duration));

                activeGiveaways.set(giveawayMessage.id, {
                    channelId: channel.id,
                    prize,
                    winners,
                    timeout
                });

                await interaction.reply({ content: `Giveaway started in ${channel}! ${client.user.username} will handle the rest!`, ephemeral: true });
            }

            if (commandName === 'end') {
                if (!interaction.memberPermissions.has('ManageMessages')) {
                    return interaction.reply({ content: 'You need the Manage Messages permission to end giveaways.', ephemeral: true });
                }

                const messageId = options.getString('message_id');
                const success = await endGiveaway(messageId, interaction.channel);

                if (!success) {
                    return interaction.reply({ content: 'Could not find an active giveaway with that ID.', ephemeral: true });
                }

                await interaction.reply({ content: `${client.user.username} ended the giveaway successfully!`, ephemeral: true });
            }

            if (commandName === 'reroll') {
                if (!interaction.memberPermissions.has('ManageMessages')) {
                    return interaction.reply({ content: 'You need the Manage Messages permission to reroll giveaways.', ephemeral: true });
                }

                const messageId = options.getString('message_id');
                const result = await rerollGiveaway(messageId);

                if (!result) {
                    return interaction.reply({ content: 'Could not find an ended giveaway with that ID.', ephemeral: true });
                }

                const winnerText = result.winners.length > 0 ? result.winners.join(', ') : 'No valid participants';

                const rerollEmbed = new EmbedBuilder()
                    .setTitle('🎉 GIVEAWAY REROLLED 🎉')
                    .setDescription(
                        `**Prize:** ${result.prize}\n` +
                        `**New Winners:** ${winnerText}`
                    )
                    .setColor('#00FF00')
                    .setFooter({ text: `${client.user.username} Giveaway System` })
                    .setTimestamp();

                const endMessage = await result.channel.messages.fetch(result.endMessageId).catch(() => null);
                if (endMessage) {
                    await endMessage.edit({ embeds: [rerollEmbed] });
                } else {
                    await result.channel.send({ embeds: [rerollEmbed] });
                }

                await interaction.reply({ content: `${client.user.username} rerolled the giveaway successfully!`, ephemeral: true });
            }

            if (commandName === 'stats') {
                const embed = new EmbedBuilder()
                    .setTitle(`${client.user.username} Statistics`)
                    .addFields(
                        { name: 'Servers', value: client.guilds.cache.size.toString(), inline: true },
                        { name: 'Users', value: client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0).toString(), inline: true },
                        { name: 'Active Giveaways', value: activeGiveaways.size.toString(), inline: true },
                        { name: 'Ended Giveaways', value: endedGiveaways.size.toString(), inline: true }
                    )
                    .setColor('#7289DA')
                    .setFooter({ text: `${client.user.username} Giveaway System` })
                    .setTimestamp();

                await interaction.reply({ embeds: [embed] });
            }

            if (commandName === 'help') {
                const embed = new EmbedBuilder()
                    .setTitle(`${client.user.username} Commands`)
                    .setDescription(`Here are all the available commands for ${client.user.username}:`)
                    .addFields(
                        { name: '/start channel duration prize winners', value: 'Start a new giveaway' },
                        { name: '/end message_id', value: 'End a giveaway early' },
                        { name: '/reroll message_id', value: 'Reroll an ended giveaway' },
                        { name: '/stats', value: 'Show bot statistics' },
                        { name: '/help', value: 'Show this help message' }
                    )
                    .setColor('#7289DA')
                    .setFooter({ text: `${client.user.username} Giveaway System` })
                    .setTimestamp();

                await interaction.reply({ embeds: [embed] });
            }
        });

        client.login(process.env.TOKEN)
            .catch(err => {
                console.error('Failed to login:', err);
                process.exit(1);
            });

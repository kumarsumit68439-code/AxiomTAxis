import { Events, EmbedBuilder, MessageFlags, ChannelType } from 'discord.js';
import { getSettings, saveSettings, MANAGE } from './util.js';

export const commands = [
  { name: 'meme', description: 'Random meme', dm_permission: false },
  {
    name: 'memes',
    description: 'Auto memes every N seconds (locked source/country/type)',
    default_member_permissions: MANAGE,
    dm_permission: false,
    options: [
      {
        name: 'set',
        description: 'Enable auto memes — posts start and keep repeating',
        type: 1,
        options: [
          { name: 'channel', description: 'Memes channel', type: 7, required: true, channel_types: [ChannelType.GuildText] },
          {
            name: 'source',
            description: 'Media source (locked)',
            type: 3,
            required: true,
            choices: [
              { name: 'YouTube videos only', value: 'youtube' },
              { name: 'Reddit images/videos only', value: 'reddit' },
              { name: 'Google-style images only', value: 'google' },
              { name: 'All sources mixed', value: 'all' }
            ]
          },
          {
            name: 'country',
            description: 'Country / region (locked)',
            type: 3,
            required: true,
            choices: [
              { name: 'India', value: 'india' },
              { name: 'USA', value: 'usa' },
              { name: 'UK', value: 'uk' },
              { name: 'Global (all countries)', value: 'global' }
            ]
          },
          {
            name: 'type',
            description: 'Kaunsi video search kare (lock ho jayega)',
            type: 3,
            required: true,
            choices: [
              { name: 'Free Fire tung tung sahur funny', value: 'freefire' },
              { name: 'Gali wali memes', value: 'gali' },
              { name: 'CID + gali memes', value: 'cidgali' },
              { name: 'CID / crime show memes', value: 'cid' },
              { name: 'Funny / comedy', value: 'funny' },
              { name: 'Roast / dank', value: 'roast' },
              { name: 'All mixed', value: 'any' }
            ]
          },
          {
            name: 'seconds',
            description: 'Seconds between posts (default 20, min 15)',
            type: 4,
            required: false,
            min_value: 15,
            max_value: 3600
          }
        ]
      },
      { name: 'off', description: 'Stop auto memes', type: 1 },
      { name: 'status', description: 'Show settings', type: 1 }
    ]
  }
];

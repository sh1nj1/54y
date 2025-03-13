import { App } from '@slack/bolt';
import dotenv from 'dotenv';

dotenv.config();

// Define a target channel to get members from
// The bot will DM all members of this channel
const TARGET_CHANNEL = '54y-dev';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

// Command handler for '/54y'
app.command('/54y', async ({ command, ack, say, client }) => {
  // Acknowledge command request
  await ack();
  
  const { text } = command;
  const args = text.trim().split(' ');
  const action = args[0]?.toLowerCase();
  
  try {
    if (action === 'send') {
      // Format: /54y send #channel message
      const channelName = args[1];
      const message = args.slice(2).join(' ');
      
      if (!channelName || !message) {
        await client.chat.postEphemeral({
          channel: command.channel_id,
          user: command.user_id,
          text: 'Usage: /54y send #channel message'
        });
        return;
      }
      
      // Extract channel ID from channel name
      const channelId = channelName.startsWith('#') 
        ? channelName.substring(1) 
        : channelName;
      
      // Post anonymous message
      await client.chat.postMessage({
        channel: channelId,
        text: message,
        username: 'Anonymous',
      });
      
      // Confirm to user with ephemeral message
      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: `Your anonymous message was sent to ${channelName}`
      });
    } 
    else if (action === 'reply') {
      // Format: /54y reply message_ts message
      const messageTs = args[1];
      const message = args.slice(2).join(' ');
      
      if (!messageTs || !message) {
        await client.chat.postEphemeral({
          channel: command.channel_id,
          user: command.user_id,
          text: 'Usage: /54y reply message_ts message'
        });
        return;
      }
      
      // Post anonymous reply in thread
      await client.chat.postMessage({
        channel: command.channel_id,
        text: message,
        thread_ts: messageTs,
        username: 'Anonymous',
      });
      
      // Confirm to user with ephemeral message
      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: `Your anonymous reply was posted in the thread`
      });
    }
    else {
      // Unknown command
      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: 'Available commands: `/54y send #channel message` or `/54y reply message_ts message`'
      });
    }
  } catch (error) {
    console.error(error);
    // Send error message to user
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: `Error: ${error instanceof Error ? error.message : 'Something went wrong'}`
    });
  }
});

// Handle direct messages to the bot - broadcast to all channel members
app.message(async ({ message, client, logger }) => {
  // Properly type the message
  const msg = message as any;
  
  // Only process direct messages (im) that aren't from bots
  if (msg.channel_type === 'im' && !msg.subtype) {
    logger.info(`Received DM: ${msg.text?.substring(0, 20)}...`);
    
    try {
      // Find the target channel
      const channelsResponse = await client.conversations.list({
        types: 'public_channel,private_channel'
      });
      
      const targetChannel = channelsResponse.channels?.find(
        (channel: any) => channel.name === TARGET_CHANNEL
      );
      
      if (!targetChannel || !targetChannel.id) {
        await client.chat.postMessage({
          channel: msg.channel,
          text: `I couldn't find the #${TARGET_CHANNEL} channel. Please make sure I'm invited to it.`
        });
        return;
      }
      
      // Get members of the target channel
      const membersResponse = await client.conversations.members({
        channel: targetChannel.id
      });
      
      if (!membersResponse.members || membersResponse.members.length === 0) {
        await client.chat.postMessage({
          channel: msg.channel,
          text: `No members found in #${TARGET_CHANNEL} channel.`
        });
        return;
      }
      
      // Get sender info to exclude them from broadcast
      const senderId = msg.user;
      
      // Format message with "Anonymous" prefix
      const messageText = `*Anonymous*: ${msg.text || ''}`;
      
      // Counter for successful messages
      let successCount = 0;
      let botCount = 0;
      
      // Send DM to each member except the sender
      for (const memberId of membersResponse.members) {
        // Skip sending to the original sender
        if (memberId === senderId) {
          continue;
        }
        
        try {
          // Check if member is a bot before trying to DM them
          const userInfoResponse = await client.users.info({
            user: memberId
          });
          
          // Skip bots to avoid "cannot_dm_bot" error
          if (userInfoResponse.user?.is_bot) {
            logger.info(`Skipping bot user: ${memberId}`);
            botCount++;
            continue;
          }
          
          // Open DM channel with the user
          const dmResponse = await client.conversations.open({
            users: memberId
          });
          
          if (dmResponse.channel?.id) {
            // Send the anonymous message
            await client.chat.postMessage({
              channel: dmResponse.channel.id,
              text: messageText,
              mrkdwn: true
            });
            successCount++;
          }
        } catch (dmError) {
          logger.error(`Failed to DM user ${memberId}:`, dmError);
          // Continue with other users even if one fails
        }
      }
      
      // Confirm to the original sender
      await client.chat.postMessage({
        channel: msg.channel,
        text: `Your anonymous message was sent to ${successCount} members of #${TARGET_CHANNEL}.`
      });
      
      logger.info(`Broadcast anonymous message to ${successCount} members in #${targetChannel.name}. Skipped ${botCount} bots.`);
    } catch (error) {
      logger.error('Error processing DM:', error);
      
      // Notify the user of the error
      await client.chat.postMessage({
        channel: msg.channel,
        text: `Error: ${error instanceof Error ? error.message : 'Something went wrong'}`
      });
    }
  }
});

// Simple ping-pong test handler for debugging
app.message('ping', async ({ message, say }) => {
  await say('pong');
});

// Start the app
(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log(`⚡️ 54y Slack bot is running on port ${port}`);
})();
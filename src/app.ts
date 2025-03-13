import { App } from '@slack/bolt';
import dotenv from 'dotenv';

dotenv.config();

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

// Start the app
(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log(`⚡️ 54y Slack bot is running on port ${port}`);
})();
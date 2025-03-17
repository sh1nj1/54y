import { App } from '@slack/bolt';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

// Define a target channel to get members from
// The bot will DM all members of this channel
const TARGET_CHANNEL = '54y-dev';

// In-memory data structures for tracking message and thread relationships
// Map of conversation ID to a map of user IDs to their thread timestamps
// This allows us to link messages across different users' DM channels
const messageThreadMap = new Map<string, Map<string, string>>();

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

// Generate a unique conversation ID (shorter version - 4 bytes/8 hex chars)
function generateConversationId(): string {
  return crypto.randomBytes(4).toString('hex');
}

// Extract conversation ID from message text if it exists
function extractConversationId(text: string): string | null {
  const match = text.match(/\[Anonymous:([a-f0-9]{8})\]/);
  return match ? match[1] : null;
}

// Extract conversation ID from thread messages, including bot's "Conversation ID" messages
function extractConversationIdFromThread(messages: any[]): string | null {
  // First try to find any message with [Anonymous:id] format
  for (const message of messages) {
    if (typeof message.text === 'string') {
      const idFromAnon = extractConversationId(message.text);
      if (idFromAnon) {
        return idFromAnon;
      }
      
      // Check for "_Conversation ID: XXXXXXXX_" format (italicized)
      const idMatch = message.text.match(/_Conversation ID: ([a-f0-9]{8})_/);
      if (idMatch) {
        return idMatch[1];
      }
    }
  }
  return null;
}

// Format message with conversation ID at the beginning
function formatMessageWithId(text: string, conversationId: string): string {
  return `[Anonymous:${conversationId}] ${text}`;
}

// Format reply message with conversation ID at the beginning
function formatReplyWithId(text: string, conversationId: string): string {
  return `[Anonymous] ${text}`;
}

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
    logger.info(`Received DM: ${msg.text?.substring(0, 20)}...`, msg);
    
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
      
      // Check if the message is a thread reply
      const isThreadReply = msg.thread_ts !== undefined;
      const threadTs = msg.thread_ts || msg.ts;
      
      // Extract conversation ID from message text if it's a reply to a previous anonymous message
      // Or generate a new one if it's a new conversation
      let conversationId: string;
      
      if (isThreadReply) {
        // Try to get the conversation ID from the message text
        // We need to look up the previous message in the thread to extract its ID
        try {
          const threadHistory = await client.conversations.replies({
            channel: msg.channel,
            ts: msg.thread_ts
          });
          
          // Get bot ID safely
          const authResponse = await client.auth.test();
          const botUserId = authResponse.user_id;
          logger.info("thradHIstory=", threadHistory);
          
          // First try to extract conversation ID from any message in the thread
          let extractedId = null;
          if (threadHistory.messages && threadHistory.messages.length > 0) {
            extractedId = extractConversationIdFromThread(threadHistory.messages);
          }
          
          if (extractedId) {
            conversationId = extractedId;
            logger.info(`Found existing conversation ID: ${conversationId}`);
          } else {
            // Filter for messages from the bot that contain thread ID as fallback
            const botMessages = threadHistory.messages?.filter(
              (m: any) => m.user === botUserId && typeof m.text === 'string' && m.text.includes('[Anonymous:')
            );
            
            if (botMessages && botMessages.length > 0 && typeof botMessages[0].text === 'string') {
              // Extract conversation ID from the most recent bot message
              const messageText = botMessages[0].text;
              extractedId = extractConversationId(messageText);
              if (extractedId) {
                conversationId = extractedId;
                logger.info(`Found existing conversation ID from bot message: ${conversationId}`);
              } else {
                // Fallback - generate new ID
                conversationId = generateConversationId();
                logger.info(`Generated new conversation ID (fallback): ${conversationId}`);
              }
            } else {
              // No bot message found with ID, generate a new one
              conversationId = generateConversationId();
              logger.info(`Generated new conversation ID (no bot message): ${conversationId}`);
            }
          }
        } catch (error) {
          // If we can't get thread history, generate a new ID
          conversationId = generateConversationId();
          logger.error(`Error getting thread history, generated new ID: ${conversationId}`, error);
        }
      } else {
        // New conversation, generate a new ID
        conversationId = generateConversationId();
        logger.info(`Generated new conversation ID: ${conversationId}`);
      }
      
      // Initialize thread map for this conversation if it doesn't exist
      if (!messageThreadMap.has(conversationId)) {
        messageThreadMap.set(conversationId, new Map<string, string>());
      }
      
      // Get thread map for this conversation
      const threadMap = messageThreadMap.get(conversationId)!;
      
      // Format the message with conversation ID at the beginning
      const messageText = isThreadReply 
        ? formatReplyWithId(msg.text || '', conversationId)
        : formatMessageWithId(msg.text || '', conversationId);
      
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
            // If this is a thread reply and we have a thread mapping for this user
            const userThreadTs = threadMap.get(memberId);
            
            if (isThreadReply && userThreadTs) {
              try {
                // Send as reply to the correct thread for this user
                const response = await client.chat.postMessage({
                  channel: dmResponse.channel.id,
                  text: messageText,
                  thread_ts: userThreadTs,
                  mrkdwn: true
                });
                
                successCount++;
              } catch (threadError) {
                // If posting to thread fails, send as regular message
                logger.warn(`Couldn't post to thread for user ${memberId}, sending as regular message: ${threadError}`);
                
                // Send as new message and store the new thread reference
                const response = await client.chat.postMessage({
                  channel: dmResponse.channel.id,
                  text: messageText,
                  mrkdwn: true
                });
                
                // Update the thread mapping with new timestamp
                threadMap.set(memberId, response.ts as string);
                successCount++;
              }
            } else {
              // Send as regular message
              const response = await client.chat.postMessage({
                channel: dmResponse.channel.id,
                text: messageText,
                mrkdwn: true
              });
              
              // Store this message's timestamp for this user
              threadMap.set(memberId, response.ts as string);
              successCount++;
            }
          }
        } catch (dmError) {
          logger.error(`Failed to DM user ${memberId}:`, dmError);
          // Continue with other users even if one fails
        }
      }
      
      // Add a threaded reply with the conversation ID (only for new messages, not replies)
      if (!isThreadReply) {
        await client.chat.postMessage({
          channel: msg.channel,
          text: `_Conversation ID: ${conversationId}_`,
          thread_ts: msg.ts,
          mrkdwn: true
        });
      }
      
      // Store the sender's thread timestamp too
      if (!isThreadReply) {
        threadMap.set(senderId, msg.ts);
      } else {
        // Update the sender's thread timestamp if needed
        if (!threadMap.has(senderId)) {
          threadMap.set(senderId, msg.thread_ts as string);
        }
      }
      
      logger.info(`Broadcast anonymous ${isThreadReply ? 'thread reply' : 'message'} to ${successCount} members. Conversation ID: ${conversationId}`);
      
      // Clean up old conversation maps (keep only the last 100)
      if (messageThreadMap.size > 100) {
        // Get the oldest keys and delete them
        const keysToDelete = [...messageThreadMap.keys()].slice(0, messageThreadMap.size - 100);
        for (const key of keysToDelete) {
          messageThreadMap.delete(key);
        }
        logger.info(`Cleaned up ${keysToDelete.length} old conversation maps`);
      }
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
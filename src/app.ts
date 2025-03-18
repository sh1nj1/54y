import { App } from '@slack/bolt';
import dotenv from 'dotenv';
import { Logger, LogLevel } from '@slack/logger';
import {
  encodeTimestampToZeroWidth
} from './zero-width-encoding';

// Load environment variables
dotenv.config();

// Configuration constants
const MAX_CONVERSATION_HISTORY = 100; // Maximum number of conversations to keep in memory

// Types for better type safety
interface ThreadMap extends Map<string, string> {}
interface MessageThreadMap extends Map<string, ThreadMap> {}

// In-memory data structure for tracking message and thread relationships
// Map of conversation ID to a map of user IDs to their thread timestamps
const messageThreadMap: MessageThreadMap = new Map();

// Initialize the Slack app
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  // Add custom logging level if needed
  logLevel: (process.env.LOG_LEVEL as LogLevel) || LogLevel.INFO,
});

// Extract logger for use throughout the app
const logger = app.logger as Logger;

// Keep track of the channel we'll use for anonymity
let anonymousChannel: any = null;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get a conversation ID based on the message timestamp
 * This ensures uniqueness and eliminates the need for separate threaded replies
 */
function getConversationIdFromTs(ts: string): string {
  // Convert the timestamp to a hex string for consistency
  // Remove periods and convert to hex
  const tsWithoutPeriod = ts.replace('.', '');
  
  return encodeTimestampToZeroWidth(tsWithoutPeriod);
}

/**
 * Extract conversation ID from message text in [Anonymous:id] format
 */
function extractConversationId(text: string): string | null {
  const match = text.match(/\[Anonymous:(.+?)\]/);
  return match ? match[1] : null;
}

/**
 * Extract conversation ID from thread messages, including bot's "Conversation ID" messages
 */
function extractConversationIdFromThread(messages: any[]): string | null {
  // First try to find any message with [Anonymous:id] format
  for (const message of messages) {
    if (typeof message.text === 'string') {
      const idFromAnon = extractConversationId(message.text);
      if (idFromAnon) {
        return idFromAnon;
      }
      
      // Check for "_Conversation ID: XXXXXXXX_" format (italicized) - for backward compatibility
      const idMatch = message.text.match(/_Conversation ID: ([a-f0-9]{8})_/);
      if (idMatch) {
        return idMatch[1];
      }
    }
  }
  return null;
}

/**
 * Format message with conversation ID at the beginning
 */
function formatMessageWithId(text: string, conversationId: string): string {
  return `[Anonymous:${conversationId}] ${text}`;
}

/**
 * Format reply message with conversation ID
 */
function formatReplyWithId(text: string, conversationId: string): string {
  return `[Anonymous] ${text}`;
}

/**
 * Clean up old conversation maps to prevent memory leaks
 */
function cleanupOldConversations() {
  if (messageThreadMap.size > MAX_CONVERSATION_HISTORY) {
    // Get the oldest keys and delete them
    const keysToDelete = [...messageThreadMap.keys()].slice(0, messageThreadMap.size - MAX_CONVERSATION_HISTORY);
    for (const key of keysToDelete) {
      messageThreadMap.delete(key);
    }
    logger.info(`Cleaned up ${keysToDelete.length} old conversation maps`);
  }
}

/**
 * Send a message in a thread safely (with error handling)
 */
async function sendThreadedMessage(client: any, channel: string, text: string, threadTs: string) {
  try {
    return await client.chat.postMessage({
      channel,
      text,
      thread_ts: threadTs,
      mrkdwn: true
    });
  } catch (error) {
    logger.error(`Error posting thread reply to ${channel}:`, error);
    return null;
  }
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Find the first channel that the bot is a member of to use as the anonymous channel
 * This is called at startup and whenever we need to find a channel
 */
async function findAnonymousChannel(client: any): Promise<any> {
  try {
    // If we already have an anonymous channel cached, return it
    if (anonymousChannel) {
      return anonymousChannel;
    }

    // Get the bot's user ID
    const authResponse = await client.auth.test();
    const botUserId = authResponse.user_id;
    
    // List channels with pagination handling
    let allChannels: any[] = [];
    let cursor: string | undefined;
    
    do {
      // Get page of channels
      const channelsResponse = await client.conversations.list({
        types: 'public_channel,private_channel',
        exclude_archived: true,
        limit: 200, // Maximum allowed by Slack API
        cursor: cursor
      });
      
      if (!channelsResponse.channels || channelsResponse.channels.length === 0) {
        break;
      }
      
      // Add this page of channels to our collection
      allChannels = allChannels.concat(channelsResponse.channels);
      
      // Get cursor for next page (if any)
      cursor = channelsResponse.response_metadata?.next_cursor;
    } while (cursor);
    
    if (allChannels.length === 0) {
      logger.warn("No channels found for the bot to use. Please add the bot to at least one channel.");
      return null;
    }
    
    logger.info(`Found ${allChannels.length} total channels to check`);
    
    // For each channel, check if the bot is a member
    for (const channel of allChannels) {
      try {
        const membersResponse = await client.conversations.members({
          channel: channel.id
        });
        
        if (membersResponse.members && membersResponse.members.includes(botUserId)) {
          logger.info(`Found anonymous channel: #${channel.name}`);
          anonymousChannel = channel;
          return channel;
        }
      } catch (error) {
        // If we can't check members, try the next channel
        logger.warn(`Couldn't check members of #${channel.name}:`, error);
        continue;
      }
    }
    
    logger.warn("Bot is not a member of any channels. Please add the bot to a channel.");
    logger.info(`Checked ${allChannels.length} channels, but bot is not a member of any of them.`);
    return null;
  } catch (error) {
    logger.error("Error finding anonymous channel:", error);
    return null;
  }
}

/**
 * Get a conversation ID from thread history or generate a new one
 */
async function getOrCreateConversationId(client: any, msg: any, isThreadReply: boolean): Promise<string> {
  // If not a thread reply, create ID from the message timestamp
  if (!isThreadReply) {
    const newId = getConversationIdFromTs(msg.ts);
    logger.info(`Created conversation ID from timestamp: ${newId}`);
    return newId;
  }
  
  // For thread replies, try to extract from history
  try {
    const threadHistory = await client.conversations.replies({
      channel: msg.channel,
      ts: msg.thread_ts
    });
    
    // Get bot ID
    const authResponse = await client.auth.test();
    const botUserId = authResponse.user_id;
    
    // Try to extract ID from any message in thread first
    if (threadHistory.messages && threadHistory.messages.length > 0) {
      const extractedId = extractConversationIdFromThread(threadHistory.messages);
      if (extractedId) {
        logger.info(`Found existing conversation ID: ${extractedId}`);
        return extractedId;
      }
      
      // Fallback to bot messages
      const botMessages = threadHistory.messages.filter(
        (m: any) => m.user === botUserId && typeof m.text === 'string' && m.text.includes('[Anonymous:')
      );
      
      if (botMessages.length > 0 && typeof botMessages[0].text === 'string') {
        const messageText = botMessages[0].text;
        const extractedId = extractConversationId(messageText);
        if (extractedId) {
          logger.info(`Found existing conversation ID from bot message: ${extractedId}`);
          return extractedId;
        }
      }
      
      // If no ID found and we have the parent message's ts, use that
      if (threadHistory.messages[0] && threadHistory.messages[0].ts) {
        const idFromParentTs = getConversationIdFromTs(threadHistory.messages[0].ts);
        logger.info(`Created conversation ID from parent message timestamp: ${idFromParentTs}`);
        return idFromParentTs;
      }
    }
    
    // If all extraction attempts fail, generate from thread_ts
    const newId = getConversationIdFromTs(msg.thread_ts);
    logger.info(`Created conversation ID from thread timestamp: ${newId}`);
    return newId;
    
  } catch (error) {
    // If we can't get thread history, generate from thread_ts
    const newId = getConversationIdFromTs(msg.thread_ts);
    logger.error(`Error getting thread history, created ID from thread timestamp: ${newId}`, error);
    return newId;
  }
}

/**
 * Find the target channel for broadcasting
 */
async function findTargetChannel(client: any): Promise<any> {
  return await findAnonymousChannel(client);
}

/**
 * Get members of a channel
 */
async function getChannelMembers(client: any, channelId: string): Promise<string[]> {
  const membersResponse = await client.conversations.members({
    channel: channelId
  });
  
  return membersResponse.members || [];
}

/**
 * Broadcast message to all members except sender
 */
async function broadcastToMembers(
  client: any, 
  members: string[], 
  senderId: string, 
  messageText: string, 
  threadMap: ThreadMap, 
  isThreadReply: boolean
): Promise<{successCount: number; botCount: number; eligibleRecipients: number}> {
  let successCount = 0;
  let botCount = 0;
  let eligibleRecipients = 0;
  
  for (const memberId of members) {
    // Skip sending to the original sender
    if (memberId === senderId) {
      continue;
    }
    
    eligibleRecipients++;
    
    try {
      // Check if member is a bot before trying to DM them
      const userInfoResponse = await client.users.info({
        user: memberId
      });
      
      // Skip bots to avoid "cannot_dm_bot" error
      if (userInfoResponse.user?.is_bot) {
        logger.info(`Skipping bot user: ${memberId}`);
        botCount++;
        eligibleRecipients--; // Decrement eligible recipients since bots aren't counted
        continue;
      }
      
      // Open DM channel with the user
      const dmResponse = await client.conversations.open({
        users: memberId
      });
      
      if (!dmResponse.channel?.id) {
        continue;
      }
      
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
    } catch (dmError) {
      logger.error(`Failed to DM user ${memberId}:`, dmError);
      // Continue with other users even if one fails
    }
  }
  
  return { successCount, botCount, eligibleRecipients };
}

// ============================================================================
// Command Handlers
// ============================================================================

/**
 * Handle '/54y send' command
 */
async function handleSendCommand(client: any, command: any, args: string[]) {
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
  
  try {
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
  } catch (error) {
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: `Error: ${error instanceof Error ? error.message : 'Could not send message'}`
    });
  }
}

/**
 * Handle '/54y reply' command
 */
async function handleReplyCommand(client: any, command: any, args: string[]) {
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
  
  try {
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
  } catch (error) {
    await client.chat.postEphemeral({
      channel: command.channel_id,
      user: command.user_id,
      text: `Error: ${error instanceof Error ? error.message : 'Could not post reply'}`
    });
  }
}

// ============================================================================
// Event Handlers
// ============================================================================

// Command handler for '/54y'
app.command('/54y', async ({ command, ack, client }) => {
  // Acknowledge command request
  await ack();
  
  const { text } = command;
  const args = text.trim().split(' ');
  const action = args[0]?.toLowerCase();
  
  try {
    if (action === 'send') {
      await handleSendCommand(client, command, args);
    } 
    else if (action === 'reply') {
      await handleReplyCommand(client, command, args);
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
app.message(async ({ message, client }) => {
  // Properly type the message
  const msg = message as any;
  
  // Only process direct messages (im) that aren't from bots
  if (msg.channel_type !== 'im' || msg.subtype) {
    return;
  }
  
  logger.info(`Received DM: ${msg.text?.substring(0, 20)}...`, msg);
  
  try {
    // Find the target channel
    const targetChannel = await findTargetChannel(client);
    
    if (!targetChannel || !targetChannel.id) {
      await client.chat.postEphemeral({
        channel: msg.channel,
        user: msg.user,
        text: `I couldn't find a channel to use for anonymous messaging. Please add me to a channel first.`
      });
      return;
    }
    
    // Get members of the target channel
    const members = await getChannelMembers(client, targetChannel.id);
    
    // Get sender info to exclude them from broadcast
    const senderId = msg.user;
    
    // Check if the message is a thread reply
    const isThreadReply = msg.thread_ts !== undefined;
    
    // Get or create conversation ID
    const conversationId = await getOrCreateConversationId(client, msg, isThreadReply);
    
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
    
    // Broadcast to all members
    const { successCount, botCount, eligibleRecipients } = await broadcastToMembers(
      client, 
      members, 
      senderId, 
      messageText, 
      threadMap, 
      isThreadReply
    );
    
    // Notify user if no one received their message
    if (eligibleRecipients === 0) {
      await client.chat.postEphemeral({
        channel: msg.channel,
        user: msg.user,
        text: `Your message wasn't delivered to anyone. All other members in #${targetChannel.name} are bots or couldn't be reached.`
      });
    } else if (successCount === 0) {
      await client.chat.postEphemeral({
        channel: msg.channel,
        user: msg.user,
        text: `Your message couldn't be delivered to any members in #${targetChannel.name}. There might be an issue with DM permissions.`
      });
    } else if (successCount < eligibleRecipients) {
      await client.chat.postEphemeral({
        channel: msg.channel,
        user: msg.user,
        text: `Your message was delivered to ${successCount} out of ${eligibleRecipients} members in #${targetChannel.name}.`
      });
    }
    
    // Store the sender's thread timestamp too (removed the threaded reply with conversation ID)
    if (!isThreadReply) {
      threadMap.set(senderId, msg.ts);
    } else if (!threadMap.has(senderId)) {
      // Update the sender's thread timestamp if needed
      threadMap.set(senderId, msg.thread_ts as string);
    }
    
    logger.info(`Broadcast anonymous ${isThreadReply ? 'thread reply' : 'message'} to ${successCount} members. Channel: #${targetChannel.name}, Conversation ID: ${conversationId}`);
    
    // Clean up old conversation maps
    cleanupOldConversations();
    
  } catch (error) {
    logger.error('Error processing DM:', error);
    
    // Notify the user of the error
    await client.chat.postEphemeral({
      channel: msg.channel,
      user: msg.user,
      text: `Error: ${error instanceof Error ? error.message : 'Something went wrong'}`
    });
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
  
  // Try to find the anonymous channel at startup
  try {
    const channel = await findAnonymousChannel(app.client);
    if (channel) {
      console.log(`✅ Using #${channel.name} as the anonymous channel`);
    } else {
      console.log(`⚠️ No channel found for anonymous messaging. Please add the bot to a channel.`);
    }
  } catch (error) {
    console.error(`❌ Error finding anonymous channel at startup:`, error);
  }
})();
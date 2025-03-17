import { App } from '@slack/bolt';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { Logger, LogLevel } from '@slack/logger';

// Load environment variables
dotenv.config();

// Configuration constants
const TARGET_CHANNEL = '54y-dev';
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

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique conversation ID (4 bytes/8 hex chars)
 */
function generateConversationId(): string {
  return crypto.randomBytes(4).toString('hex');
}

/**
 * Extract conversation ID from message text in [Anonymous:id] format
 */
function extractConversationId(text: string): string | null {
  const match = text.match(/\[Anonymous:([a-f0-9]{8})\]/);
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
      
      // Check for "_Conversation ID: XXXXXXXX_" format (italicized)
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
 * Get a conversation ID from thread history or generate a new one
 */
async function getOrCreateConversationId(client: any, msg: any, isThreadReply: boolean): Promise<string> {
  // If not a thread reply, generate a new ID
  if (!isThreadReply) {
    const newId = generateConversationId();
    logger.info(`Generated new conversation ID: ${newId}`);
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
    }
    
    // If all extraction attempts fail, generate new ID
    const newId = generateConversationId();
    logger.info(`Generated new conversation ID (no existing ID found): ${newId}`);
    return newId;
    
  } catch (error) {
    // If we can't get thread history, generate a new ID
    const newId = generateConversationId();
    logger.error(`Error getting thread history, generated new ID: ${newId}`, error);
    return newId;
  }
}

/**
 * Find the target channel for broadcasting
 */
async function findTargetChannel(client: any): Promise<any> {
  const channelsResponse = await client.conversations.list({
    types: 'public_channel,private_channel'
  });
  
  return channelsResponse.channels?.find(
    (channel: any) => channel.name === TARGET_CHANNEL
  );
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
): Promise<number> {
  let successCount = 0;
  let botCount = 0;
  
  for (const memberId of members) {
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
  
  return successCount;
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
      await client.chat.postMessage({
        channel: msg.channel,
        text: `I couldn't find the #${TARGET_CHANNEL} channel. Please make sure I'm invited to it.`
      });
      return;
    }
    
    // Get members of the target channel
    const members = await getChannelMembers(client, targetChannel.id);
    
    if (members.length === 0) {
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
    const successCount = await broadcastToMembers(
      client, 
      members, 
      senderId, 
      messageText, 
      threadMap, 
      isThreadReply
    );
    
    // Add a threaded reply with the conversation ID (only for new messages, not replies)
    if (!isThreadReply) {
      try {
        await client.chat.postMessage({
          channel: msg.channel,
          text: `_Conversation ID: ${conversationId}_`,
          thread_ts: msg.ts,
          mrkdwn: true
        });
      } catch (threadError) {
        logger.error('Error posting thread reply with conversation ID:', threadError);
        // Continue execution even if thread reply fails
      }
    }
    
    // Store the sender's thread timestamp too
    if (!isThreadReply) {
      threadMap.set(senderId, msg.ts);
    } else if (!threadMap.has(senderId)) {
      // Update the sender's thread timestamp if needed
      threadMap.set(senderId, msg.thread_ts as string);
    }
    
    logger.info(`Broadcast anonymous ${isThreadReply ? 'thread reply' : 'message'} to ${successCount} members. Conversation ID: ${conversationId}`);
    
    // Clean up old conversation maps
    cleanupOldConversations();
    
  } catch (error) {
    logger.error('Error processing DM:', error);
    
    // Notify the user of the error
    await client.chat.postMessage({
      channel: msg.channel,
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
})();
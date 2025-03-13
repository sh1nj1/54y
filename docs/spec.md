# Slack Anonymous Bot Design & Feasibility

## 🔶 Summary of Requirements
1. **Anonymous messages** sent to a channel (without user identity exposed).
2. **Replying to existing anonymous messages** (as threads).
3. Ability to send to **private channels** — even if the user is not a member.
4. A **command-like interaction** (e.g., `/anon send Hello everyone!`).

---

## 🔷 Feasibility Check

### 1. Anonymous Messaging:
- ✅ **Possible** — When a user sends a DM/command to the bot, the bot can post a message on behalf of itself (hiding the user's identity).
- The message in the channel will look like it came **from the bot**, not tied to any user.

### 2. Replying to Anonymous Messages:
- ✅ **Possible** — The bot can manage threads if:
  - It knows the timestamp of the parent message.
  - Maintains some mapping (e.g., user to message) privately if needed for advanced logic.
- Thread replies will also appear as from the bot (anonymous).

### 3. Sending to Private Channels:
- ⚠️ **Direct User-to-Private-Channel via Bot is NOT possible if user is not a member**.
- **Solution**:
  - **Bot must be a member** of the private channel.
  - Users **cannot** normally post to a private channel they are not in, but since the **bot is a member**, the bot can post there on behalf of anyone.
  - So, **users will DM the bot**, and the **bot will post into the channel** — making it **appear anonymous**.

---

## 🔶 Finalized Flow / Architecture Design

### 🧭 Flow: Anonymous Message
```
User (via DM or slash command)  --->  Bot  --->  Channel (public or private)
```
- User sends `/anon send [message]`.
- Bot posts to target channel as itself.

### 🧭 Flow: Anonymous Reply to a Thread
```
User (via DM with reference)  --->  Bot  --->  Thread reply in channel
```
- User sends `/anon reply [message ID] [reply message]`.
- Bot uses message ID (timestamp) to post reply in that thread.

---

## 🔷 Bot Features / Commands (Specification)

| Command                                 | Description                                               | Example                                      |
|-----------------------------------------|-----------------------------------------------------------|----------------------------------------------|
| `/anon send [#channel] [message]`        | Send anonymous message to a public/private channel        | `/anon send #random Hello everyone!`        |
| `/anon reply [message_ts] [message]`    | Reply to an existing anonymous message in a thread       | `/anon reply 1707748394.126200 I agree!`    |

---

## 🔷 Bot Capabilities Needed (Slack App Features)

| Capability                        | Purpose                                                   |
|----------------------------------|----------------------------------------------------------|
| **Bot Token**                     | To interact with Slack API                               |
| `chat:write`                      | Send messages in channels                                |
| `channels:join`                   | Join public channels if needed                          |
| `groups:write`                    | Write to private channels (bot must be added)           |
| `commands`                        | To support slash commands                               |
| `chat:write.public` (optional)    | Write to channels without being explicitly invited     |
| `app_mentions:read` (optional)    | Handle @mentions if needed                              |

---

## 🔷 Possible Bot Design (Architecture)

### **Actors**:
- **User**: Human sending anonymous message via bot
- **Bot**: Slack App bot user with necessary permissions

### **Main Components**:
| Component                   | Description                                        |
|----------------------------|---------------------------------------------------|
| **Command Handler**         | Receives slash commands, parses them              |
| **Message Router**          | Sends to appropriate channel / thread             |
| **Thread Manager**          | Keeps track of threads (e.g., timestamps)         |
| **Storage (Optional)**      | To store mappings if needed (e.g., thread metadata)|
| **Security Layer (Optional)**| Prevent spam or abuse                             |

---

## ✅ Conclusion of Feasibility and Design

| Requirement                               | Feasible? | Notes                                                                          |
|-------------------------------------------|-----------|--------------------------------------------------------------------------------|
| Send anonymous messages                   | ✅        | User sends DM or command, bot posts to channel                                 |
| Reply anonymously to threads              | ✅        | Bot can reply in threads with known timestamp                                  |
| Send to private channels w/o user inside  | ⚠️ Yes (via bot) | User can't directly post, but bot can if it's a member                         |
| Prevent identity leakage                  | ✅        | Bot never reveals the user's identity in posted messages                      |

---

## 🔷 Next Steps

1. **Define detailed UX (optional)** — How users will interact: error handling, feedback, etc.
2. **Slack App setup**: Basic Slack App creation, bot token scopes.
3. **Implement command parsing** (e.g., `/anon send`, `/anon reply`).
4. **Posting logic** (with thread handling).
5. (Optional) **Thread/message tracking system** for managing reply references.
6. (Optional) **Moderation/Abuse handling** — in case people spam it.

---

💬 **Questions for You**:
- Do you want to **add more commands or behaviors**?
- Do you want to **support attachments, images, or only text**?
- Should we proceed to **coding phase**, or refine this more?



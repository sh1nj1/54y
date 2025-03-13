# Setting Up Your Slack Anonymous Bot

## Step-by-Step Instructions

1. **Create a Slack App**
   - Go to the [Slack API Console](https://api.slack.com/apps)
   - Click "Create New App" and choose "From scratch"
   - Name your app "54y" and select your workspace

2. **Configure Bot Permissions**
   - In the left sidebar, navigate to "OAuth & Permissions"
   - Under "Bot Token Scopes", add the following permissions:
     - `channels:join` (Join public channels in a workspace)
     - `channels:read` (View basic information about public channels)
     - `chat:write` (Send messages as the app)
     - `commands` (Add shortcuts and slash commands)
     - `groups:read` (View basic information about private channels)
     - `groups:write` (Manage private channels and create new ones)
     - `im:history` (View messages in direct messages)
     - `im:read` (View basic information about direct messages)
     - `im:write` (Start direct messages with people)
     - `users:read` (View people in a workspace)

3. **Create Slash Command**
   - In the left sidebar, navigate to "Slash Commands"
   - Click "Create New Command"
   - Set the command to `/54y`
   - Add a short description: "Send anonymous messages"
   - Set the URL to your app's hostname (where your bot will be deployed)
   - Save the command

4. **Configure App Home**
   - In the left sidebar, navigate to "App Home"
   - Under "Show Tabs", enable the "Messages Tab"
   - Check "Allow users to send Slash commands and messages from the messages tab"
   - This allows users to send direct messages to your bot

5. **Enable Socket Mode**
   - In the left sidebar, navigate to "Socket Mode"
   - Toggle "Enable Socket Mode" to On
   - Generate an app-level token with the `connections:write` scope
   - Save this token for your `.env` file

6. **Install the App**
   - In the left sidebar, navigate to "Install App"
   - Click "Install to Workspace"
   - Review the permissions and click "Allow"

7. **Gather Credentials**
   - Bot Token: Find under "OAuth & Permissions" > "Bot User OAuth Token"
   - Signing Secret: Find under "Basic Information" > "App Credentials"
   - App Token: The token you generated when enabling Socket Mode

8. **Initialize the Project**
   - Add these tokens to your `.env` file
   - Run `npm install` to install dependencies
   - Start the bot with `npm run dev`

## Testing Your Bot

Once your bot is running, you can test it with:

- **Direct Message**: Send a DM to the bot and it will anonymously broadcast your message to all members of the target channel
- **Thread Replies**: Reply to a message thread in your DM with the bot, and it will maintain the thread context for all recipients
- **Conversation Tracking**: Each conversation has a unique ID that's discreetly embedded in messages to maintain thread continuity

The bot includes these additional features:

- **Anonymous Identity**: Messages are sent with an "Anonymous" prefix
- **Thread Continuity**: Reply threads are preserved across all recipients
- **Invisible IDs**: Conversation IDs are embedded with invisible characters to minimize visual clutter
- **Sender Exclusion**: Senders don't receive their own anonymous messages
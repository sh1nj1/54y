# Setting Up Your Slack Anonymous Bot

## Step-by-Step Instructions

1. **Create a Slack App**
   - Go to the [Slack API Console](https://api.slack.com/apps)
   - Click "Create New App" and choose "From scratch"
   - Name your app "54y" and select your workspace

2. **Configure Bot Permissions**
   - In the left sidebar, navigate to "OAuth & Permissions"
   - Under "Bot Token Scopes", add the following permissions:
     - `chat:write` (Send messages as the app)
     - `commands` (Add slash commands to the app)
     - `channels:join` (Join public channels)
     - `groups:write` (Post to private channels)

3. **Create Slash Command**
   - In the left sidebar, navigate to "Slash Commands"
   - Click "Create New Command"
   - Set the command to `/54y`
   - Add a short description: "Send anonymous messages"
   - Set the URL to your app's hostname (where your bot will be deployed)
   - Save the command

4. **Enable Socket Mode**
   - In the left sidebar, navigate to "Socket Mode"
   - Toggle "Enable Socket Mode" to On
   - Generate an app-level token with the `connections:write` scope
   - Save this token for your `.env` file

5. **Install the App**
   - In the left sidebar, navigate to "Install App"
   - Click "Install to Workspace"
   - Review the permissions and click "Allow"

6. **Gather Credentials**
   - Bot Token: Find under "OAuth & Permissions" > "Bot User OAuth Token"
   - Signing Secret: Find under "Basic Information" > "App Credentials"
   - App Token: The token you generated when enabling Socket Mode

7. **Initialize the Project**
   - Add these tokens to your `.env` file
   - Run `npm install` to install dependencies
   - Start the bot with `npm run dev`

## Testing Your Bot

Once your bot is running, you can test it with:

- `/54y send #general Hello world!` - Send an anonymous message to #general
- `/54y reply 1707748394.126200 I agree!` - Reply anonymously to a thread
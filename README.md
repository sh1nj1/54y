# 54y - Anonymous Slack Bot

A Slack bot that allows users to send anonymous messages to channels and reply anonymously to threads.

## Features
- Send anonymous messages to channels
- Reply anonymously to message threads
- Works with private channels (bot must be a member)

## Setup
1. Create a Slack App in the [Slack API Console](https://api.slack.com/apps)
2. Add the following Bot Token Scopes:
   - `chat:write`
   - `commands`
   - `channels:join`
   - `groups:write`
3. Create a slash command `/54y`
4. Install the app to your workspace
5. Copy the Bot Token, Signing Secret, and App-Level Token to your `.env` file
6. Run `npm install` and `npm run dev`

For detailed setup instructions with screenshots, see [Setting Up Your Slack Anonymous Bot](docs/create-slack-bot.md).

## Usage
- Send anonymous message: `/54y send #channel Your message here`
- Reply anonymously: `/54y reply 1707748394.126200 Your reply here`
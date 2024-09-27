import { App } from '@slack/bolt';
import { OpenAI } from 'openai';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as lockfile from 'proper-lockfile';

dotenv.config();

// Set up environment variables
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN!;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET!;
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN!;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;
const PORT = process.env.PORT || 3000;

// Initialize OpenAI API
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// Initialize Slack app
const app = new App({
  token: SLACK_BOT_TOKEN,
  signingSecret: SLACK_SIGNING_SECRET,
  appToken: SLACK_APP_TOKEN,
  socketMode: true,
});

// Path to the leaderboard file
const LEADERBOARD_FILE = 'leaderboard.json';
// Path to the chat history file
const CHAT_HISTORY_FILE = 'chat_history.json';
const MAX_CHAT_HISTORY = 1000;

// Function to read the leaderboard from the file
async function readLeaderboard(): Promise<{ [key: string]: number }> {
  try {
    // Lock the file for reading
    await lockfile.lock(LEADERBOARD_FILE, { retries: 5 });

    if (!fs.existsSync(LEADERBOARD_FILE)) {
      // If file doesn't exist, return an empty leaderboard
      return {};
    }

    const data = fs.readFileSync(LEADERBOARD_FILE, 'utf8');
    const leaderboard = JSON.parse(data);
    return leaderboard;
  } catch (error) {
    console.error(`Error reading leaderboard: ${error}`);
    return {};
  } finally {
    // Unlock the file
    await lockfile.unlock(LEADERBOARD_FILE).catch((err) => {
      console.error(`Error unlocking leaderboard file: ${err}`);
    });
  }
}

// Function to write the leaderboard to the file
async function writeLeaderboard(leaderboard: { [key: string]: number }): Promise<void> {
  try {
    // Lock the file for writing
    await lockfile.lock(LEADERBOARD_FILE, { retries: 5 });

    const data = JSON.stringify(leaderboard, null, 2);
    fs.writeFileSync(LEADERBOARD_FILE, data, 'utf8');
  } catch (error) {
    console.error(`Error writing leaderboard: ${error}`);
  } finally {
    // Unlock the file
    await lockfile.unlock(LEADERBOARD_FILE).catch((err) => {
      console.error(`Error unlocking leaderboard file: ${err}`);
    });
  }
}

// Function to read the chat history from the file
async function readChatHistory(): Promise<any[]> {
  try {
    // Lock the file for reading
    await lockfile.lock(CHAT_HISTORY_FILE, { retries: 5 });

    if (!fs.existsSync(CHAT_HISTORY_FILE)) {
      // If file doesn't exist, return an empty array
      return [];
    }

    const data = fs.readFileSync(CHAT_HISTORY_FILE, 'utf8');
    const chatHistory = JSON.parse(data);
    return chatHistory;
  } catch (error) {
    console.error(`Error reading chat history: ${error}`);
    return [];
  } finally {
    // Unlock the file
    await lockfile.unlock(CHAT_HISTORY_FILE).catch((err) => {
      console.error(`Error unlocking chat history file: ${err}`);
    });
  }
}

// Function to write the chat history to the file
async function writeChatHistory(chatHistory: any[]): Promise<void> {
  try {
    // Lock the file for writing
    await lockfile.lock(CHAT_HISTORY_FILE, { retries: 5 });

    const data = JSON.stringify(chatHistory, null, 2);
    fs.writeFileSync(CHAT_HISTORY_FILE, data, 'utf8');
  } catch (error) {
    console.error(`Error writing chat history: ${error}`);
  } finally {
    // Unlock the file
    await lockfile.unlock(CHAT_HISTORY_FILE).catch((err) => {
      console.error(`Error unlocking chat history file: ${err}`);
    });
  }
}

// Function to parse user messages using OpenAI with function calling
async function parseMessage(messageText: string, chatHistory: any[]): Promise<any> {
  const messages = [
    ...chatHistory,
    { role: 'user' as const, content: messageText },
  ];

  // Define the functions for OpenAI to use
  const functions = [
    {
      name: 'show_leaderboard',
      description: 'Retrieve and display the current leaderboard',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
    {
      name: 'record_game',
      description: 'Record the outcome of a game',
      parameters: {
        type: 'object',
        properties: {
          players: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of player names',
          },
          winner: {
            type: 'string',
            description: 'Name of the winning player',
          },
        },
        required: ['players', 'winner'],
      },
    },
  ];

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: 200,
      temperature: 0,
      functions,
      function_call: 'auto',
    });

    const assistantMessage = response.choices[0].message;

    // Add assistant's message to chat history
    if (assistantMessage) {
      chatHistory.push(assistantMessage);
    }

    // Save updated chat history (limit to last 1000 messages)
    if (chatHistory.length > MAX_CHAT_HISTORY) {
      chatHistory.splice(0, chatHistory.length - MAX_CHAT_HISTORY);
    }
    await writeChatHistory(chatHistory);

    if (assistantMessage && assistantMessage.function_call) {
      return assistantMessage.function_call;
    } else {
      return null;
    }
  } catch (error) {
    console.error(`Error parsing OpenAI response: ${error}`);
    return null;
  }
}

// Function to handle the assistant's function call
async function handleFunctionCall(functionCall: any, say: any) {
  const functionName = functionCall.name;
  const functionArgs = JSON.parse(functionCall.arguments);

  if (functionName === 'show_leaderboard') {
    // Show the leaderboard with formatting
    const leaderboard = await readLeaderboard();
    if (Object.keys(leaderboard).length > 0) {
      const sortedLeaderboard = Object.entries(leaderboard).sort(
        (a, b) => b[1] - a[1]
      );

      // Get the highest score to identify top players
      const highestScore = sortedLeaderboard[0][1];

      const leaderboardText = sortedLeaderboard
        .map(([player, wins]) => {
          const isTopPlayer = wins === highestScore;
          const bulletEmoji = isTopPlayer ? ':crown:' : ':star:';
          return `${bulletEmoji} *${player}*: ${wins} win${wins !== 1 ? 's' : ''}`;
        })
        .join('\n');

      await say(`*Leaderboard:*\n${leaderboardText}`);
    } else {
      await say('The leaderboard is currently empty.');
    }
  } else if (functionName === 'record_game') {
    const players: string[] = functionArgs.players;
    const winner: string = functionArgs.winner;

    if (!players || !winner) {
      await say("Sorry, I couldn't find the players or winner in your request.");
      return;
    }
    if (!players.includes(winner)) {
      await say(`The winner *${winner}* is not among the list of players: ${players.join(', ')}.`);
      return;
    }
    // Update the leaderboard
    const leaderboard = await readLeaderboard();
    players.forEach((player) => {
      if (!(player in leaderboard)) {
        leaderboard[player] = 0;
      }
    });
    leaderboard[winner] += 1;
    await writeLeaderboard(leaderboard);
    await say(`:trophy: Game recorded! *${winner}* won the game among ${players.join(', ')}.`);
  } else {
    // Do nothing if the function name is not recognized
    return;
  }
}

// Event listener for messages
app.message(async ({ message, say }) => {
  // Ignore messages from bots
  if ((message as any).subtype === 'bot_message') return;

  const text = (message as any).text;
  if (text) {
    // Read chat history
    let chatHistory = await readChatHistory();

    // Add user's message to chat history
    chatHistory.push({ role: 'user', content: text });

    // Limit chat history to last MAX_CHAT_HISTORY messages
    if (chatHistory.length > MAX_CHAT_HISTORY) {
      chatHistory.splice(0, chatHistory.length - MAX_CHAT_HISTORY);
    }

    // Save updated chat history
    await writeChatHistory(chatHistory);

    const functionCall = await parseMessage(text, chatHistory);
    if (functionCall) {
      await handleFunctionCall(functionCall, say);
    }
    // If there's no function call, the bot remains silent
  } else {
    // Optionally, handle messages with no text
  }
});

(async () => {
  // Start the app
  await app.start(Number(PORT));
  console.log('⚡️ Bolt app is running!');
})();

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

// Function to parse user messages using OpenAI
async function parseMessage(messageText: string): Promise<any> {
  const systemPrompt = `
You are an assistant that extracts intents and entities from user messages related to a Magic: The Gathering leaderboard.
The possible intents are:

- ShowLeaderboard
- RecordGame

For RecordGame, the entities are:
- players: list of player names
- winner: name of the winning player

Given a user's message, extract the intent and entities in JSON format.

Response format (in JSON):

{
  "intent": "ShowLeaderboard" or "RecordGame",
  "players": ["player1", "player2", ...],  // only for RecordGame
  "winner": "winner_name"  // only for RecordGame
}

If any information is missing or unclear, set the value to null.

Important: Only output the JSON object and nothing else.
`;

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: `Message: "${messageText}"` },
  ];

  try {
    const response = await openai.chat.completions.create({
      model: '4o-mini',
      messages,
      max_tokens: 200,
      temperature: 0,
    });

    const assistantResponse = response.choices[0].message?.content?.trim();

    // Try to parse the response as JSON
    if (assistantResponse) {
      const parsedResponse = JSON.parse(assistantResponse);
      return parsedResponse;
    } else {
      return null;
    }
  } catch (error) {
    console.error(`Error parsing OpenAI response: ${error}`);
    return null;
  }
}

// Event listener for messages
app.message(async ({ message, say }) => {
  // Ignore messages from bots
  if ((message as any).subtype === 'bot_message') return;

  const text = (message as any).text;
  if (text) {
    const parsed = await parseMessage(text);
    if (!parsed) {
      await say("Sorry, I couldn't understand your request.");
      return;
    }

    const intent = parsed.intent;
    if (intent === 'ShowLeaderboard') {
      // Show the leaderboard
      const leaderboard = await readLeaderboard();
      if (Object.keys(leaderboard).length > 0) {
        const sortedLeaderboard = Object.entries(leaderboard).sort(
          (a, b) => b[1] - a[1]
        );
        const leaderboardText = sortedLeaderboard
          .map(([player, wins]) => `${player}: ${wins} wins`)
          .join('\n');
        await say(`Leaderboard:\n${leaderboardText}`);
      } else {
        await say('The leaderboard is currently empty.');
      }
    } else if (intent === 'RecordGame') {
      const players: string[] = parsed.players;
      const winner: string = parsed.winner;
      if (!players || !winner) {
        await say("Sorry, I couldn't find the players or winner in your request.");
        return;
      }
      if (!players.includes(winner)) {
        await say(`The winner ${winner} is not among the list of players ${players}.`);
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
      await say(`Game recorded. ${winner} won the game among ${players.join(', ')}.`);
    } else {
      await say("Sorry, I didn't understand your intent.");
    }
  } else {
    await say('Please send a message containing your request.');
  }
});

(async () => {
  // Start the app
  await app.start(Number(PORT));
  console.log('⚡️ Bolt app is running!');
})();

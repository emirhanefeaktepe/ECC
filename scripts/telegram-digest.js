#!/usr/bin/env node
'use strict';

/**
 * Telegram university digest - organizes course group messages into
 * assignments, exams, schedule changes and important announcements.
 *
 * Sources:
 *   --export <result.json>   Telegram Desktop "Export chat history" JSON
 *   --bot                    Pull new messages via Bot API (TELEGRAM_BOT_TOKEN)
 *
 * Options:
 *   --chats "Fizik,Mat 101"  Only chats whose name contains one of these
 *   --days 14                Only messages from the last N days (default 30)
 *   --out digest.md          Write Markdown digest to a file (default stdout)
 *   --json                   Print the digest as JSON instead of Markdown
 *   --send                   Send the digest to TELEGRAM_DIGEST_CHAT_ID via the bot
 *
 * Bot mode stores seen messages in $TELEGRAM_DIGEST_HOME
 * (default ~/.ecc/telegram-digest) because the Bot API only keeps updates
 * for 24 hours - run it on a schedule (cron) so nothing is missed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeFileAtomic } = require('./lib/atomic-write');
const {
  buildDigest,
  chunkMessage,
  mergeRecords,
  normalizeBotUpdates,
  parseTelegramExport,
  renderDigest,
} = require('./lib/telegram-digest');

const API_BASE = 'https://api.telegram.org';
const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;
const CHAT_ID_RE = /^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/;
const MAX_STORED = 5000;

function usage() {
  return [
    'Usage: node scripts/telegram-digest.js (--export <result.json> | --bot) [options]',
    '',
    '  --export <file>   Telegram Desktop JSON export (result.json)',
    '  --bot             Fetch new messages with TELEGRAM_BOT_TOKEN',
    '  --chats <list>    Comma-separated chat name filters',
    '  --days <n>        Look back N days (default 30, 0 = all)',
    '  --out <file>      Write Markdown to file',
    '  --json            Output JSON',
    '  --send            Send digest to TELEGRAM_DIGEST_CHAT_ID',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { days: 30, chats: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === '--export') args.export = next();
    else if (arg === '--bot') args.bot = true;
    else if (arg === '--chats') args.chats = next().split(',').map(s => s.trim()).filter(Boolean);
    else if (arg === '--days') {
      args.days = Number(next());
      if (!Number.isInteger(args.days) || args.days < 0) throw new Error('--days must be a non-negative integer');
    } else if (arg === '--out') args.out = next();
    else if (arg === '--json') args.json = true;
    else if (arg === '--send') args.send = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function requireToken() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!TOKEN_RE.test(token)) throw new Error('TELEGRAM_BOT_TOKEN is missing or malformed (get one from @BotFather)');
  return token;
}

async function callBotApi(token, method, params) {
  const response = await fetch(`${API_BASE}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params || {}),
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) {
    // Never echo the URL: it contains the bot token.
    throw new Error(`Telegram ${method} failed: ${body.description || response.status}`);
  }
  return body.result;
}

function stateFile() {
  const home = process.env.TELEGRAM_DIGEST_HOME || path.join(os.homedir(), '.ecc', 'telegram-digest');
  return path.join(home, 'state.json');
}

function loadState(file) {
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { offset: Number(state.offset) || 0, records: Array.isArray(state.records) ? state.records : [] };
  } catch (_error) {
    return { offset: 0, records: [] };
  }
}

async function fetchBotRecords(token) {
  const file = stateFile();
  const state = loadState(file);
  let offset = state.offset;
  let records = state.records;
  for (let page = 0; page < 20; page++) {
    const updates = await callBotApi(token, 'getUpdates', {
      offset,
      limit: 100,
      timeout: 0,
      allowed_updates: ['message', 'channel_post', 'edited_message', 'edited_channel_post'],
    });
    if (!updates.length) break;
    records = mergeRecords(records, normalizeBotUpdates(updates));
    offset = updates[updates.length - 1].update_id + 1;
  }
  records = records.slice(-MAX_STORED);
  writeFileAtomic(file, JSON.stringify({ offset, records }, null, 2), { mode: 0o600 });
  return records;
}

function sinceDate(days) {
  if (!days) return null;
  const date = new Date(Date.now() - days * 86400000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function todayIso() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help || (!args.export && !args.bot)) {
    console.log(usage());
    return args.help ? 0 : 1;
  }

  let records = [];
  if (args.export) {
    records = records.concat(parseTelegramExport(JSON.parse(fs.readFileSync(args.export, 'utf8'))));
  }
  if (args.bot) {
    records = mergeRecords(records, await fetchBotRecords(requireToken()));
  }

  const digest = buildDigest(records, { today: todayIso(), since: sinceDate(args.days), chats: args.chats });
  const output = args.json ? `${JSON.stringify(digest, null, 2)}\n` : renderDigest(digest, { format: 'markdown' });

  if (args.out) {
    writeFileAtomic(args.out, output, { mode: 0o600 });
    console.error(`[telegram-digest] wrote ${args.out}`);
  } else {
    process.stdout.write(output);
  }

  if (args.send) {
    const chatId = String(process.env.TELEGRAM_DIGEST_CHAT_ID || '').trim();
    if (!CHAT_ID_RE.test(chatId)) throw new Error('TELEGRAM_DIGEST_CHAT_ID is missing or malformed');
    const token = requireToken();
    for (const chunk of chunkMessage(renderDigest(digest, { format: 'text' }))) {
      await callBotApi(token, 'sendMessage', { chat_id: chatId, text: chunk, disable_web_page_preview: true });
    }
    console.error('[telegram-digest] digest sent to Telegram');
  }
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then(code => process.exit(code))
    .catch(error => {
      console.error(`[telegram-digest] ${error.message}`);
      process.exit(1);
    });
}

module.exports = { main, parseArgs };

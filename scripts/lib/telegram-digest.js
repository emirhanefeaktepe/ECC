'use strict';

/**
 * Telegram university digest core.
 *
 * Turns Telegram messages (Telegram Desktop JSON export or Bot API updates)
 * into an organized digest: assignments, exams, schedule changes, important
 * announcements and course materials, with deadlines extracted from Turkish
 * and English text. Pure functions only - no I/O, no network.
 */

const CATEGORY_ORDER = ['exam', 'assignment', 'schedule', 'important', 'material'];

const CATEGORY_LABELS = {
  assignment: 'Ödevler ve Teslimler',
  exam: 'Sınavlar',
  schedule: 'Ders Değişiklikleri',
  important: 'Önemli Duyurular',
  material: 'Ders Materyalleri',
};

const CATEGORY_ICONS = {
  assignment: '📚',
  exam: '📝',
  schedule: '🔄',
  important: '📢',
  material: '📎',
};

// Keywords are matched on ASCII-folded, lowercased text at a word start, so
// "ödevinizi", "Ödev" and "odev" all hit "odev".
const CATEGORY_KEYWORDS = {
  exam: [
    'sinav', 'vize', 'final', 'butunleme', 'but sinav', 'ara sinav', 'kisa sinav',
    'quiz', 'midterm', 'exam',
  ],
  assignment: [
    'odev', 'teslim', 'proje', 'lab raporu', 'deney raporu', 'rapor teslim',
    'homework', 'assignment', 'submission', 'due', 'deadline', 'yuklen', 'yukleyin',
  ],
  schedule: [
    'iptal', 'ertelen', 'telafi', 'derslik degis', 'sinif degis', 'saat degis',
    'ders yapilmayacak', 'ders olmayacak', 'online yapilacak', 'uzaktan yapilacak',
    'cancelled', 'canceled', 'postponed', 'rescheduled', 'makeup class',
  ],
  important: [
    'duyuru', 'onemli', 'dikkat', 'zorunlu', 'son gun', 'son tarih', 'kayit',
    'ders secim', 'ekle birak', 'danisman', 'burs', 'staj', 'harc', 'devamsizlik',
    'yoklama', 'mezuniyet', 'akademik takvim', 'announcement', 'important', 'urgent',
    'mandatory', 'registration',
  ],
  material: [
    'slayt', 'slide', 'ders notu', 'ders notlari', 'sunum', 'kaynak kitap',
    'lecture notes', 'materyal', 'kayit linki', 'ders kaydi',
  ],
};

const MONTHS = {
  ocak: 1, subat: 2, mart: 3, nisan: 4, mayis: 5, haziran: 6,
  temmuz: 7, agustos: 8, eylul: 9, ekim: 10, kasim: 11, aralik: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const MONTH_NAMES_TR = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

const WEEKDAY_NAMES_TR = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

// JS getUTCDay() index (0 = Sunday).
const WEEKDAYS = [
  { pattern: 'pazartesi', day: 1 },
  { pattern: 'sali', day: 2 },
  { pattern: 'carsamba', day: 3 },
  { pattern: 'persembe', day: 4 },
  { pattern: 'cumartesi', day: 6 },
  { pattern: 'cuma(?!rtesi)', day: 5 },
  { pattern: 'pazar(?!tesi)', day: 0 },
];

const MAX_SNIPPET = 280;

/** Lowercase with Turkish casing rules, then fold diacritics to ASCII. */
function foldText(value) {
  return String(value || '')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase()
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/[âà]/g, 'a')
    .replace(/[îì]/g, 'i')
    .replace(/[ûù]/g, 'u');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordRegex(keyword) {
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(keyword)}`);
}

const COMPILED_KEYWORDS = Object.fromEntries(
  Object.entries(CATEGORY_KEYWORDS).map(([category, words]) => [category, words.map(keywordRegex)])
);

// Control characters, zero-width marks and bidi overrides that can hide or
// reorder text. Built from code points to keep the source ASCII-only.
const UNSAFE_CHARS = new RegExp(
  `[${[[0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x7f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069]]
    .map(([from, to]) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`)
    .join('')}]`,
  'g'
);

/** Strip control characters (except newlines/tabs) from untrusted text. */
function sanitizeText(value) {
  return String(value || '').replace(UNSAFE_CHARS, '');
}

/**
 * Classify a message. Returns { category, categories, matched }.
 * category is the highest-priority match (see CATEGORY_ORDER) or 'other'.
 */
function classifyMessage(text) {
  const folded = foldText(text);
  const categories = [];
  const matched = [];
  for (const category of CATEGORY_ORDER) {
    const regexes = COMPILED_KEYWORDS[category];
    let hit = false;
    for (let i = 0; i < regexes.length; i++) {
      if (regexes[i].test(folded)) {
        hit = true;
        matched.push(CATEGORY_KEYWORDS[category][i]);
      }
    }
    if (hit) categories.push(category);
  }
  // "final" alone is common in English chatter; require a second exam signal
  // or a date before treating it as an exam.
  if (categories[0] === 'exam' && matched.every(word => word === 'final' || word === 'due')) {
    const hasDate = extractDeadlines(text, { y: 2000, m: 1, d: 1 }).length > 0;
    if (!hasDate) categories.shift();
  }
  return { category: categories[0] || 'other', categories, matched };
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function toUtc(date) {
  return Date.UTC(date.y, date.m - 1, date.d);
}

function fromUtc(ms) {
  const date = new Date(ms);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

function addDays(date, days) {
  return fromUtc(toUtc(date) + days * 86400000);
}

function isValidDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const check = fromUtc(Date.UTC(y, m - 1, d));
  return check.y === y && check.m === m && check.d === d;
}

function isoDate(date) {
  return `${date.y}-${pad2(date.m)}-${pad2(date.d)}`;
}

function parseIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** Pick the year for a day/month without a year, relative to the message date. */
function inferYear(ref, month, day) {
  let year = ref.y;
  if (!isValidDate(year, month, day)) return null;
  // A date well before the message date most likely means next year
  // (e.g. "15 Ocak" written in December).
  if (toUtc({ y: year, m: month, d: day }) < toUtc(ref) - 60 * 86400000) year += 1;
  return isValidDate(year, month, day) ? year : null;
}

function extractTime(folded) {
  const regex = /(?:saat\s*)?\b([01]?\d|2[0-3])[:.]([0-5]\d)\b(?!\s*[./-]\s*\d)/g;
  let match;
  while ((match = regex.exec(folded)) !== null) {
    // Without "saat" or a colon, "12.10" is more likely a date than a time.
    if (/saat|:/.test(match[0])) return `${pad2(match[1])}:${match[2]}`;
  }
  return null;
}

/**
 * Extract candidate dates from text, relative to the message date `ref`
 * ({y,m,d}). Returns an array of { date: 'YYYY-MM-DD', index } ordered by
 * position in the text.
 */
function extractDeadlines(text, ref) {
  const folded = foldText(text);
  const found = [];
  const push = (date, index) => {
    if (date) found.push({ date: isoDate(date), index });
  };

  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  let match;
  while ((match = iso.exec(folded)) !== null) {
    const date = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
    if (isValidDate(date.y, date.m, date.d)) push(date, match.index);
  }

  const numeric = /(^|[^\d:.,/-])(\d{1,2})([./-])(\d{1,2})(?:[./-](\d{4}|\d{2}))?(?![\d:])/g;
  while ((match = numeric.exec(folded)) !== null) {
    const day = Number(match[2]);
    const month = Number(match[4]);
    // "3.5" or "Bölüm 2.1" are not dates; a bare day/month needs a two-digit
    // month ("5.10") or a slash ("5/1").
    if (!match[5] && match[4].length < 2 && match[3] !== '/') continue;
    let year = match[5] ? Number(match[5]) : null;
    if (year !== null && year < 100) year += 2000;
    // "saat 17.00" is a time, not a date.
    const before = folded.slice(Math.max(0, match.index - 6), match.index + match[1].length);
    if (/saat\s*$/.test(before)) continue;
    if (year === null) year = inferYear(ref, month, day);
    if (year !== null && isValidDate(year, month, day)) {
      push({ y: year, m: month, d: day }, match.index + match[1].length);
    }
  }

  const monthNames = Object.keys(MONTHS).join('|');
  const named = new RegExp(`\\b(\\d{1,2})\\s+(${monthNames})[a-z]*(?:\\s+(\\d{4}))?`, 'g');
  while ((match = named.exec(folded)) !== null) {
    const day = Number(match[1]);
    const month = MONTHS[match[2]];
    const year = match[3] ? Number(match[3]) : inferYear(ref, month, day);
    if (year !== null && isValidDate(year, month, day)) push({ y: year, m: month, d: day }, match.index);
  }

  const relative = [
    { regex: /(^|[^a-z])bugun/, days: 0 },
    { regex: /(^|[^a-z])bu aksam/, days: 0 },
    { regex: /(^|[^a-z])yarin/, days: 1 },
    { regex: /(^|[^a-z])(obur gun|ertesi gun)/, days: 2 },
    { regex: /(^|[^a-z])(today|tonight)/, days: 0 },
    { regex: /(^|[^a-z])tomorrow/, days: 1 },
  ];
  for (const { regex, days } of relative) {
    const hit = regex.exec(folded);
    if (hit) push(addDays(ref, days), hit.index + hit[1].length);
  }

  const refWeekday = new Date(toUtc(ref)).getUTCDay();
  for (const { pattern, day } of WEEKDAYS) {
    const hit = new RegExp(`(^|[^a-z])(haftaya\\s+)?${pattern}(?:ya|ye|a|e|\\s+gunu|\\s+gunune)?\\b`).exec(folded);
    if (!hit) continue;
    let delta = (day - refWeekday + 7) % 7;
    if (hit[2]) {
      // "haftaya salı" = that weekday in the next Monday-based calendar week.
      const toNextMonday = ((8 - refWeekday) % 7) || 7;
      delta = toNextMonday + ((day + 6) % 7);
    }
    push(addDays(ref, delta), hit.index + hit[1].length);
  }

  found.sort((a, b) => a.index - b.index);
  const seen = new Set();
  return found.filter(item => (seen.has(item.date) ? false : seen.add(item.date)));
}

/** Flatten Telegram export `text` (string or array of strings/entities). */
function flattenExportText(text) {
  if (typeof text === 'string') return text;
  if (!Array.isArray(text)) return '';
  return text.map(part => (typeof part === 'string' ? part : (part && part.text) || '')).join('');
}

function exportMessageToRecord(message, chat) {
  if (!message || message.type !== 'message') return null;
  const text = sanitizeText(flattenExportText(message.text)).trim();
  const attachment = message.file_name || (message.media_type ? message.media_type : (message.photo ? 'photo' : null));
  if (!text && !attachment) return null;
  return {
    id: `${chat.id}:${message.id}`,
    chat: sanitizeText(chat.name || 'Adsız sohbet'),
    from: sanitizeText(message.from || message.author || ''),
    date: String(message.date || ''),
    text,
    attachment: attachment ? sanitizeText(attachment) : null,
  };
}

/**
 * Parse a Telegram Desktop JSON export (either a single-chat export or the
 * full "chats.list" export) into normalized message records.
 */
function parseTelegramExport(data) {
  if (!data || typeof data !== 'object') throw new Error('Telegram export must be a JSON object');
  let chats;
  if (Array.isArray(data.messages)) {
    chats = [data];
  } else if (data.chats && Array.isArray(data.chats.list)) {
    chats = data.chats.list.concat(data.left_chats && Array.isArray(data.left_chats.list) ? data.left_chats.list : []);
  } else {
    throw new Error('Unrecognized Telegram export: expected "messages" or "chats.list"');
  }
  const records = [];
  for (const chat of chats) {
    if (!chat || !Array.isArray(chat.messages)) continue;
    for (const message of chat.messages) {
      const record = exportMessageToRecord(message, { id: chat.id, name: chat.name });
      if (record) records.push(record);
    }
  }
  return records;
}

function localIsoFromUnix(seconds) {
  const date = new Date(Number(seconds) * 1000);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** Normalize Bot API getUpdates results into message records. */
function normalizeBotUpdates(updates) {
  const records = [];
  for (const update of Array.isArray(updates) ? updates : []) {
    const message = update && (update.message || update.channel_post || update.edited_message || update.edited_channel_post);
    if (!message || !message.chat) continue;
    const text = sanitizeText(message.text || message.caption || '').trim();
    const attachment = message.document ? (message.document.file_name || 'document') : (message.photo ? 'photo' : null);
    if (!text && !attachment) continue;
    const chat = message.chat;
    const from = message.from
      ? [message.from.first_name, message.from.last_name].filter(Boolean).join(' ')
      : (message.author_signature || '');
    records.push({
      id: `${chat.id}:${message.message_id}`,
      chat: sanitizeText(chat.title || chat.username || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || String(chat.id)),
      from: sanitizeText(from),
      date: localIsoFromUnix(message.edit_date || message.date),
      text,
      attachment: attachment ? sanitizeText(attachment) : null,
    });
  }
  return records;
}

/** Merge record lists, newest version of each id wins. */
function mergeRecords(existing, incoming) {
  const byId = new Map();
  for (const record of existing || []) byId.set(record.id, record);
  for (const record of incoming || []) byId.set(record.id, record);
  return Array.from(byId.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function snippet(text) {
  const single = String(text).replace(/\s+/g, ' ').trim();
  return single.length > MAX_SNIPPET ? `${single.slice(0, MAX_SNIPPET - 1)}…` : single;
}

/**
 * Build the digest.
 * options: { today: 'YYYY-MM-DD', since: 'YYYY-MM-DD', chats: [substrings] }
 */
function buildDigest(records, options = {}) {
  const today = parseIsoDate(options.today) || fromUtc(Date.now());
  const since = options.since ? String(options.since) : null;
  const chatFilters = (options.chats || []).map(foldText).filter(Boolean);

  const sections = Object.fromEntries(CATEGORY_ORDER.map(category => [category, []]));
  const seenText = new Map();
  let scanned = 0;
  let other = 0;

  for (const record of records) {
    if (since && String(record.date).slice(0, 10) < since) continue;
    if (chatFilters.length && !chatFilters.some(filter => foldText(record.chat).includes(filter))) continue;
    scanned++;

    const classifyInput = [record.text, record.attachment].filter(Boolean).join(' ');
    const { category, categories } = classifyMessage(classifyInput);
    if (category === 'other') {
      other++;
      continue;
    }

    const dedupeKey = `${category}:${foldText(record.text).replace(/\s+/g, ' ').trim()}`;
    if (record.text && seenText.has(dedupeKey)) {
      const previous = seenText.get(dedupeKey);
      if (!previous.chats.includes(record.chat)) previous.chats.push(record.chat);
      continue;
    }

    const ref = parseIsoDate(record.date) || today;
    const deadlines = extractDeadlines(record.text, ref);
    const deadline = deadlines.length ? deadlines[0].date : null;
    const item = {
      id: record.id,
      category,
      tags: categories.slice(1),
      chats: [record.chat],
      from: record.from,
      date: record.date,
      text: snippet(record.text || `[${record.attachment}]`),
      attachment: record.attachment,
      deadline,
      time: deadline ? extractTime(foldText(record.text)) : null,
      overdue: deadline ? deadline < isoDate(today) : false,
    };
    sections[category].push(item);
    if (record.text) seenText.set(dedupeKey, item);
  }

  const byDeadline = (a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? 1 : -1;
    if (a.deadline && b.deadline && a.deadline !== b.deadline) {
      return a.overdue ? b.deadline.localeCompare(a.deadline) : a.deadline.localeCompare(b.deadline);
    }
    if (a.deadline && !b.deadline) return -1;
    if (!a.deadline && b.deadline) return 1;
    return String(b.date).localeCompare(String(a.date));
  };
  const byDateDesc = (a, b) => String(b.date).localeCompare(String(a.date));

  for (const category of CATEGORY_ORDER) {
    sections[category].sort(category === 'exam' || category === 'assignment' || category === 'schedule' ? byDeadline : byDateDesc);
  }

  const upcoming = CATEGORY_ORDER
    .filter(category => category !== 'material')
    .flatMap(category => sections[category])
    .filter(item => item.deadline && !item.overdue)
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
    .slice(0, 10);

  return {
    generatedAt: isoDate(today),
    scanned,
    other,
    sections,
    upcoming,
  };
}

function formatDateTr(iso, time) {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  const weekday = WEEKDAY_NAMES_TR[new Date(toUtc(date)).getUTCDay()];
  return `${date.d} ${MONTH_NAMES_TR[date.m - 1]} ${weekday}${time ? ` ${time}` : ''}`;
}

function daysUntil(iso, todayIso) {
  const date = parseIsoDate(iso);
  const today = parseIsoDate(todayIso);
  if (!date || !today) return null;
  return Math.round((toUtc(date) - toUtc(today)) / 86400000);
}

function relativeLabel(days) {
  if (days === null) return '';
  if (days === 0) return 'bugün';
  if (days === 1) return 'yarın';
  if (days > 1) return `${days} gün kaldı`;
  return 'geçti';
}

function escapeMarkdown(value) {
  return String(value).replace(/([\\`*_[\]<>|#])/g, '\\$1');
}

/**
 * Render the digest. format: 'markdown' (file/Claude) or 'text' (Telegram
 * message, no markup so untrusted text cannot break formatting).
 */
function renderDigest(digest, options = {}) {
  const markdown = (options.format || 'markdown') === 'markdown';
  const esc = markdown ? escapeMarkdown : value => String(value);
  const bold = value => (markdown ? `**${value}**` : value);
  const lines = [];

  lines.push(markdown ? '# 🎓 Üniversite Telegram Özeti' : '🎓 Üniversite Telegram Özeti');
  lines.push('');
  lines.push(`${formatDateTr(digest.generatedAt)} · ${digest.scanned} mesaj tarandı · ${digest.other} alakasız mesaj atlandı`);

  if (digest.upcoming.length) {
    lines.push('');
    lines.push(markdown ? '## ⏰ Yaklaşan Tarihler' : '⏰ YAKLAŞAN TARİHLER');
    for (const item of digest.upcoming) {
      const days = relativeLabel(daysUntil(item.deadline, digest.generatedAt));
      lines.push(`- ${bold(formatDateTr(item.deadline, item.time))} (${days}) ${CATEGORY_ICONS[item.category]} ${esc(item.chats[0])}: ${esc(item.text.slice(0, 90))}`);
    }
  }

  for (const category of CATEGORY_ORDER) {
    const items = digest.sections[category];
    if (!items.length) continue;
    lines.push('');
    const heading = `${CATEGORY_ICONS[category]} ${CATEGORY_LABELS[category]} (${items.length})`;
    lines.push(markdown ? `## ${heading}` : heading.toLocaleUpperCase('tr-TR'));
    for (const item of items) {
      const when = item.deadline
        ? `${bold(formatDateTr(item.deadline, item.time))} (${relativeLabel(daysUntil(item.deadline, digest.generatedAt))}) — `
        : '';
      const posted = String(item.date).slice(0, 10);
      const source = `${esc(item.chats.join(', '))}${item.from ? `, ${esc(item.from)}` : ''}, ${posted}`;
      lines.push(`- ${when}${esc(item.text)}${markdown ? ` _(${source})_` : ` (${source})`}`);
    }
  }

  const total = CATEGORY_ORDER.reduce((sum, category) => sum + digest.sections[category].length, 0);
  if (!total) {
    lines.push('');
    lines.push('Seçilen aralıkta ödev, sınav veya önemli duyuru bulunamadı.');
  }
  return `${lines.join('\n')}\n`;
}

/** Split text into chunks under Telegram's 4096-char message limit. */
function chunkMessage(text, limit = 4000) {
  const chunks = [];
  let current = '';
  for (const line of String(text).split('\n')) {
    const piece = line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
    if (current.length + piece.length + 1 > limit) {
      if (current) chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n${piece}` : piece;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

module.exports = {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  buildDigest,
  chunkMessage,
  classifyMessage,
  extractDeadlines,
  foldText,
  mergeRecords,
  normalizeBotUpdates,
  parseTelegramExport,
  renderDigest,
  sanitizeText,
};

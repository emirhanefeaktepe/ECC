/**
 * Tests for scripts/lib/telegram-digest.js and scripts/telegram-digest.js
 *
 * Run with: node tests/lib/telegram-digest.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
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
} = require('../../scripts/lib/telegram-digest');
const { parseArgs } = require('../../scripts/telegram-digest');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

// Thursday, 24 September 2026
const REF = { y: 2026, m: 9, d: 24 };
const dates = text => extractDeadlines(text, REF).map(item => item.date);

const SAMPLE_EXPORT = {
  chats: {
    list: [
      {
        name: 'Fizik 101 - 2026 Güz',
        type: 'private_supergroup',
        id: 111,
        messages: [
          { id: 1, type: 'service', date: '2026-09-20T09:00:00', action: 'join_group_by_link' },
          {
            id: 2,
            type: 'message',
            date: '2026-09-21T10:00:00',
            from: 'Dr. Yılmaz',
            text: ['ÖDEV 2 yayınlandı. Son teslim ', { type: 'bold', text: '05.10.2026 saat 23:59' }, '.'],
          },
          { id: 3, type: 'message', date: '2026-09-22T11:00:00', from: 'Ali', text: 'Günaydın arkadaşlar' },
          { id: 4, type: 'message', date: '2026-09-23T12:00:00', from: 'Dr. Yılmaz', text: 'Vize sınavı 12 Kasım Perşembe, B201.' },
          { id: 5, type: 'message', date: '2026-09-23T13:00:00', from: 'Dr. Yılmaz', text: 'Yarınki ders iptal edildi, telafi cumartesi.' },
          { id: 6, type: 'message', date: '2026-09-23T14:00:00', from: 'Dr. Yılmaz', text: '', file_name: 'hafta3_slayt.pdf', media_type: 'document' },
        ],
      },
      {
        name: 'Bölüm Duyuruları',
        type: 'public_channel',
        id: 222,
        messages: [
          { id: 7, type: 'message', date: '2026-09-22T08:00:00', text: 'ÖNEMLİ: Ders seçimi için son gün 30 Eylül.' },
          { id: 8, type: 'message', date: '2026-09-10T08:00:00', text: 'Duyuru: burs başvuruları 15.09 tarihinde kapandı.' },
          { id: 9, type: 'message', date: '2026-09-21T10:05:00', text: 'ÖDEV 2 yayınlandı. Son teslim 05.10.2026 saat 23:59.' },
        ],
      },
    ],
  },
};

function run() {
  console.log('\n=== Testing telegram-digest ===\n');
  let passed = 0;
  let failed = 0;
  const check = (name, fn) => (test(name, fn) ? passed++ : failed++);

  check('foldText applies Turkish casing and folds diacritics', () => {
    assert.strictEqual(foldText('ÖDEV İÇİN SINAV Şubat Çarşamba'), 'odev icin sinav subat carsamba');
  });

  check('sanitizeText strips control and bidi override characters', () => {
    assert.strictEqual(sanitizeText('a\u0007b‮c​d\ne'), 'abcd\ne');
  });

  check('classifyMessage detects Turkish assignment, exam, schedule and important', () => {
    assert.strictEqual(classifyMessage('Ödevinizi Moodle üzerinden yükleyin').category, 'assignment');
    assert.strictEqual(classifyMessage('Bütünleme sınavı tarihleri açıklandı').category, 'exam');
    assert.strictEqual(classifyMessage('Bugünkü ders iptal').category, 'schedule');
    assert.strictEqual(classifyMessage('ÖNEMLİ: devamsızlık listesi').category, 'important');
    assert.strictEqual(classifyMessage('ders notları eklendi').category, 'material');
    assert.strictEqual(classifyMessage('Günaydın herkese').category, 'other');
  });

  check('classifyMessage prefers exam over assignment when both match', () => {
    const result = classifyMessage('Vize yerine proje teslim edilecek');
    assert.strictEqual(result.category, 'exam');
    assert.ok(result.categories.includes('assignment'));
  });

  check('classifyMessage ignores a bare "final" without a date', () => {
    assert.strictEqual(classifyMessage('final answer is 42').category, 'other');
    assert.strictEqual(classifyMessage('final 12.01 tarihinde').category, 'exam');
  });

  check('extractDeadlines parses numeric, ISO and named-month dates', () => {
    assert.deepStrictEqual(dates('Son teslim 05.10.2026'), ['2026-10-05']);
    assert.deepStrictEqual(dates('Teslim 5/10'), ['2026-10-05']);
    assert.deepStrictEqual(dates('Sınav 2026-11-12 günü'), ['2026-11-12']);
    assert.deepStrictEqual(dates('12 Kasım 2026'), ['2026-11-12']);
    assert.deepStrictEqual(dates('due 3 October'), ['2026-10-03']);
  });

  check('extractDeadlines rolls year forward for early-year dates', () => {
    assert.deepStrictEqual(extractDeadlines('Final 15 Ocak', { y: 2026, m: 12, d: 20 }).map(i => i.date), ['2027-01-15']);
  });

  check('extractDeadlines handles relative Turkish dates', () => {
    assert.deepStrictEqual(dates('Yarın quiz var'), ['2026-09-25']);
    assert.deepStrictEqual(dates('bugün son gün'), ['2026-09-24']);
    assert.deepStrictEqual(dates('cuma günü teslim'), ['2026-09-25']);
    assert.deepStrictEqual(dates('cumartesi telafi'), ['2026-09-26']);
    assert.deepStrictEqual(dates('pazartesiye kadar'), ['2026-09-28']);
    assert.deepStrictEqual(dates('haftaya salı'), ['2026-09-29']);
  });

  check('extractDeadlines ignores times, decimals and invalid dates', () => {
    assert.deepStrictEqual(dates('saat 17.00 da'), []);
    assert.deepStrictEqual(dates('Bölüm 3.5 okuyun'), []);
    assert.deepStrictEqual(dates('31.02 tarihinde'), []);
    assert.deepStrictEqual(dates('salih geldi mi'), []);
  });

  check('parseTelegramExport reads full exports and skips service messages', () => {
    const records = parseTelegramExport(SAMPLE_EXPORT);
    assert.strictEqual(records.length, 8);
    assert.strictEqual(records[0].chat, 'Fizik 101 - 2026 Güz');
    assert.strictEqual(records[0].text, 'ÖDEV 2 yayınlandı. Son teslim 05.10.2026 saat 23:59.');
    assert.strictEqual(records.find(r => r.id === '111:6').attachment, 'hafta3_slayt.pdf');
  });

  check('parseTelegramExport reads single-chat exports and rejects junk', () => {
    const records = parseTelegramExport(SAMPLE_EXPORT.chats.list[1]);
    assert.strictEqual(records.length, 3);
    assert.throws(() => parseTelegramExport({ foo: 1 }), /Unrecognized/);
    assert.throws(() => parseTelegramExport(null), /JSON object/);
  });

  check('normalizeBotUpdates maps messages, channel posts and captions', () => {
    const records = normalizeBotUpdates([
      { update_id: 1, message: { message_id: 10, date: 1790000000, chat: { id: -100, title: 'Mat 101' }, from: { first_name: 'Ayşe', last_name: 'K' }, text: 'Ödev yarın' } },
      { update_id: 2, channel_post: { message_id: 11, date: 1790000000, chat: { id: -200, title: 'Duyurular' }, caption: 'Önemli', photo: [{}] } },
      { update_id: 3, my_chat_member: {} },
      { update_id: 4, message: { message_id: 12, date: 1790000000, chat: { id: -100, title: 'Mat 101' }, sticker: {} } },
    ]);
    assert.strictEqual(records.length, 2);
    assert.strictEqual(records[0].id, '-100:10');
    assert.strictEqual(records[0].from, 'Ayşe K');
    assert.strictEqual(records[1].attachment, 'photo');
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(records[0].date));
  });

  check('mergeRecords dedupes by id with newest winning', () => {
    const merged = mergeRecords(
      [{ id: 'a', date: '2026-09-01', text: 'old' }],
      [{ id: 'a', date: '2026-09-01', text: 'new' }, { id: 'b', date: '2026-08-01', text: 'b' }]
    );
    assert.deepStrictEqual(merged.map(r => r.text), ['b', 'new']);
  });

  check('buildDigest groups, dedupes forwards and flags overdue items', () => {
    const digest = buildDigest(parseTelegramExport(SAMPLE_EXPORT), { today: '2026-09-24' });
    assert.strictEqual(digest.scanned, 8);
    assert.strictEqual(digest.other, 1);
    const assignment = digest.sections.assignment;
    assert.strictEqual(assignment.length, 1);
    assert.strictEqual(assignment[0].deadline, '2026-10-05');
    assert.strictEqual(assignment[0].time, '23:59');
    assert.deepStrictEqual(assignment[0].chats, ['Fizik 101 - 2026 Güz', 'Bölüm Duyuruları']);
    assert.strictEqual(digest.sections.exam[0].deadline, '2026-11-12');
    assert.strictEqual(digest.sections.schedule[0].deadline, '2026-09-24');
    assert.strictEqual(digest.sections.material.length, 1);
    const important = digest.sections.important;
    assert.strictEqual(important.length, 2);
    assert.ok(important.find(i => i.deadline === '2026-09-15').overdue);
    assert.deepStrictEqual(digest.upcoming.map(i => i.deadline), ['2026-09-24', '2026-09-30', '2026-10-05', '2026-11-12']);
  });

  check('buildDigest applies chat and since filters', () => {
    const records = parseTelegramExport(SAMPLE_EXPORT);
    const onlyFizik = buildDigest(records, { today: '2026-09-24', chats: ['fizik'] });
    assert.strictEqual(onlyFizik.scanned, 5);
    const recent = buildDigest(records, { today: '2026-09-24', since: '2026-09-15' });
    assert.strictEqual(recent.scanned, 7);
  });

  check('renderDigest produces Turkish markdown and escaped text output', () => {
    const digest = buildDigest(parseTelegramExport(SAMPLE_EXPORT), { today: '2026-09-24' });
    const markdown = renderDigest(digest);
    assert.ok(markdown.startsWith('# 🎓 Üniversite Telegram Özeti'));
    assert.ok(markdown.includes('## 📚 Ödevler ve Teslimler (1)'));
    assert.ok(markdown.includes('**5 Ekim Pazartesi 23:59** (11 gün kaldı)'));
    assert.ok(markdown.includes('(geçti)'));
    const text = renderDigest(digest, { format: 'text' });
    assert.ok(!text.includes('**'));
    assert.ok(text.includes('ÖDEVLER VE TESLİMLER (1)'));
  });

  check('renderDigest escapes markdown in untrusted message text', () => {
    const digest = buildDigest([{ id: 'x', chat: 'C', from: '', date: '2026-09-24', text: 'Ödev [link](http://evil) *bold*' }], { today: '2026-09-24' });
    const markdown = renderDigest(digest);
    assert.ok(markdown.includes('\\[link\\](http://evil) \\*bold\\*'));
  });

  check('renderDigest reports an empty digest', () => {
    const markdown = renderDigest(buildDigest([], { today: '2026-09-24' }));
    assert.ok(markdown.includes('bulunamadı'));
  });

  check('chunkMessage keeps chunks under the limit', () => {
    const chunks = chunkMessage(Array.from({ length: 50 }, (_, i) => `line ${i} ${'x'.repeat(100)}`).join('\n'), 1000);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.every(chunk => chunk.length <= 1000));
  });

  check('parseArgs validates options', () => {
    assert.deepStrictEqual(parseArgs(['--export', 'a.json', '--chats', 'A, B', '--days', '7']).chats, ['A', 'B']);
    assert.throws(() => parseArgs(['--days', '-1']), /non-negative/);
    assert.throws(() => parseArgs(['--export']), /requires a value/);
    assert.throws(() => parseArgs(['--nope']), /Unknown argument/);
  });

  check('CLI renders a digest from an export file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-digest-'));
    try {
      const exportFile = path.join(dir, 'result.json');
      const outFile = path.join(dir, 'digest.md');
      fs.writeFileSync(exportFile, JSON.stringify(SAMPLE_EXPORT));
      const result = spawnSync(process.execPath, [
        path.join(__dirname, '..', '..', 'scripts', 'telegram-digest.js'),
        '--export', exportFile, '--days', '0', '--out', outFile,
      ], { encoding: 'utf8' });
      assert.strictEqual(result.status, 0, result.stderr);
      const markdown = fs.readFileSync(outFile, 'utf8');
      assert.ok(markdown.includes('Ödevler ve Teslimler'));
      assert.ok(markdown.includes('Sınavlar'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  check('CLI fails clearly when bot token is missing', () => {
    const env = { ...process.env, TELEGRAM_DIGEST_HOME: os.tmpdir() };
    delete env.TELEGRAM_BOT_TOKEN;
    const result = spawnSync(process.execPath, [
      path.join(__dirname, '..', '..', 'scripts', 'telegram-digest.js'), '--bot',
    ], { encoding: 'utf8', env });
    assert.strictEqual(result.status, 1);
    assert.ok(result.stderr.includes('TELEGRAM_BOT_TOKEN'));
  });

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

run();

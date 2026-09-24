# Telegram Üniversite Özeti

Üniversite Telegram gruplarındaki ve kanallarındaki mesajları tarar ve düzenli bir özet çıkarır:

- 📝 **Sınavlar**: vize, final, bütünleme, quiz
- 📚 **Ödevler ve Teslimler**: ödev, proje, rapor, son teslim tarihleri
- 🔄 **Ders Değişiklikleri**: iptal, erteleme, telafi, derslik değişikliği
- 📢 **Önemli Duyurular**: ders seçimi, kayıt, burs, staj, devamsızlık
- 📎 **Ders Materyalleri**: slaytlar, ders notları, paylaşılan dosyalar

Tarihleri Türkçe metinden okur ("05.10.2026", "12 Kasım", "yarın", "cuma günü",
"haftaya salı", "saat 23:59") ve en üstte **Yaklaşan Tarihler** listesini son tarihe göre sıralar.
Aynı duyuru birden fazla gruba iletildiyse tek maddede birleştirir. Tarihi geçen maddeler
"(geçti)" olarak işaretlenir.

Ek bağımlılık gerekmez; Node.js 18 veya üzeri yeterlidir.

## Yöntem 1: Telegram Desktop dışa aktarma (en kolay, tüm gruplar)

Bot kurmadan, üye olduğun tüm gruplarda çalışır.

1. Telegram Desktop'ı aç → **Ayarlar → Gelişmiş → Telegram verisini dışa aktar**
   (tek bir grup için: grubun menüsü → **Sohbet geçmişini dışa aktar**).
2. Biçim olarak **Makine tarafından okunabilir JSON** seç. Medya dosyalarını seçmen gerekmez.
3. Oluşan `result.json` ile özeti çıkar:

```bash
node scripts/telegram-digest.js --export ~/Downloads/Telegram\ Desktop/DataExport/result.json \
  --chats "Fizik,Matematik,Bölüm Duyuru" --days 30 --out universite-ozet.md
```

## Yöntem 2: Telegram botu (otomatik, sürekli)

Bot, yalnızca eklendiği gruplardaki mesajları görebilir.

1. Telegram'da **@BotFather** → `/newbot` ile bir bot oluştur, token'ı al.
2. BotFather'da `/setprivacy` → botunu seç → **Disable**. Yoksa bot gruptaki mesajları göremez.
3. Botu ders gruplarına ekle. Kanallarda botu yönetici yapman gerekir.
4. Özetin gönderileceği sohbeti belirle: bota özelden bir mesaj at, sonra
   `https://api.telegram.org/bot<TOKEN>/getUpdates` adresinde `chat.id` değerini bul.
5. Ortam değişkenlerini ayarla. Token'ı asla repoya ekleme:

```bash
export TELEGRAM_BOT_TOKEN="123456789:ABC..."
export TELEGRAM_DIGEST_CHAT_ID="123456789"
node scripts/telegram-digest.js --bot --days 14 --send
```

Bot API mesajları sadece 24 saat saklar. Araç görülen mesajları
`~/.ecc/telegram-digest/state.json` dosyasında biriktirir (konumu `TELEGRAM_DIGEST_HOME` ile değiştirebilirsin).
Bu yüzden aracı düzenli çalıştır. Örneğin her sabah 08:00'de özeti Telegram'a göndermek için:

```bash
# crontab -e
0 * * * * cd /yol/ECC && node scripts/telegram-digest.js --bot --days 0 > /dev/null
0 8 * * * cd /yol/ECC && node scripts/telegram-digest.js --bot --days 14 --send > /dev/null
```

## Seçenekler

| Seçenek | Açıklama |
|---------|----------|
| `--export <dosya>` | Telegram Desktop JSON dışa aktarması |
| `--bot` | Bot API ile yeni mesajları çek (`TELEGRAM_BOT_TOKEN`) |
| `--chats "A,B"` | Sadece adında bu ifadelerden biri geçen sohbetler |
| `--days <n>` | Son N gün (varsayılan 30, `0` = hepsi) |
| `--out <dosya>` | Markdown özeti dosyaya yaz |
| `--json` | JSON çıktı (başka araçlara veya Claude'a vermek için) |
| `--send` | Özeti `TELEGRAM_DIGEST_CHAT_ID` sohbetine gönder |

## Claude ile daha akıllı özet

Anahtar kelime tabanlı sınıflandırma hızlıdır ve gizlilik dostudur, ancak her mesajı yakalamayabilir.
Daha ayrıntılı bir özet için JSON çıktısını Claude Code'a ver:

```bash
node scripts/telegram-digest.js --export result.json --json --out ozet.json
# Claude Code'da: "ozet.json'daki ödevleri derslere göre grupla ve bu haftanın planını çıkar"
```

## Gizlilik

- Mesajlar yalnızca yerel olarak işlenir. Bot modu sadece `api.telegram.org` ile konuşur.
- Durum ve çıktı dosyaları `0600` izinleriyle yazılır.
- `result.json`, `state.json` ve bot token'ını git'e ekleme.

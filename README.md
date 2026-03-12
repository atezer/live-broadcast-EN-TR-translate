# Live Turkish Subtitle – Chrome Extension

Tarayıcı sekmesindeki veya mikrofondaki İngilizce konuşmayı gerçek zamanlı olarak Türkçe altyazıya çeviren Chrome eklentisi.

## Özellikler

- **İki ses kaynağı** – Mikrofon veya sekme (tab) sesi desteği
- **Gerçek zamanlı transkripsiyon** – Mikrofonda Web Speech API, sekme sesinde Groq Whisper API
- **Otomatik çeviri** – Google Translate ve MyMemory API ile İngilizce → Türkçe
- **Akıllı önbellekleme** – Kelime/cümle bazlı çeviri cache'i (500 kayıt limiti)
- **Özelleştirilebilir altyazı** – Konum (üst/orta/alt), yazı boyutu (14–36 px), otomatik gizleme
- **İngilizce metin gösterimi** – Orijinal metni altyazının üstünde gösterme/gizleme
- **Klavye kısayolu** – `Alt+S` ile hızlı durdurma

## Teknolojiler

| Alan | Teknoloji |
|------|-----------|
| Platform | Chrome Extension (Manifest V3) |
| Konuşma → Metin | Web Speech API · Groq Whisper API |
| Çeviri | Google Translate API · MyMemory API |
| Ses İşleme | Web Audio API · MediaRecorder · Tab Capture API |
| Depolama | `chrome.storage.local` |
| Arayüz | Vanilla JS · HTML · CSS |

## Kurulum

1. Bu repoyu klonlayın:
   ```bash
   git clone https://github.com/atezer/live-broadcast-EN-TR-translate.git
   ```
2. Chrome'da `chrome://extensions/` adresine gidin.
3. Sağ üstten **Geliştirici modu**'nu açın.
4. **Paketlenmemiş öğe yükle** butonuna tıklayıp proje klasörünü seçin.

## Kullanım

1. Araç çubuğundaki eklenti simgesine tıklayın.
2. **Ses kaynağı** seçin:
   - **Mikrofon** – Ek API anahtarı gerekmez.
   - **Hoparlör (Tab)** – [Groq API anahtarı](https://console.groq.com/keys) gereklidir.
3. İsterseniz altyazı konumunu ve yazı boyutunu ayarlayın.
4. **Altyazıyı Başlat** butonuna tıklayın.
5. Durdurmak için **Durdur** butonunu veya `Alt+S` kısayolunu kullanın.

## Proje Yapısı

```
├── manifest.json      # Chrome Extension manifest (v3)
├── popup.html         # Eklenti popup arayüzü
├── popup.js           # Popup mantığı ve kontroller
├── content.js         # Sayfa içi altyazı overlay scripti
├── content.css        # İçerik stilleri
├── background.js      # Service worker
├── offscreen.html     # Offscreen document (tab ses yakalama)
├── offscreen.js       # Tab ses yakalama + Whisper transkripsiyon
└── icons/             # Eklenti simgeleri
```

## Gereksinimler

- Chrome 116 veya üzeri
- Tab ses kaynağı için [Groq API anahtarı](https://console.groq.com/keys)

## İzinler

Eklenti aşağıdaki Chrome izinlerini kullanır:

- `activeTab` – Aktif sekmeye erişim
- `scripting` – İçerik scripti enjeksiyonu
- `storage` – Ayarların saklanması
- `tabs` – Sekme bilgisine erişim
- `offscreen` – Offscreen document oluşturma
- `tabCapture` – Sekme ses yakalama

## Lisans

MIT

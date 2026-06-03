# 📱 ADB File Manager

> File manager berbasis web untuk **browse, preview, dan download** file dari HP Android ke komputer lewat **ADB** — cepat, ringan, tanpa aplikasi MTP yang rewel.

![Node](https://img.shields.io/badge/Node-%E2%89%A516-339933?logo=node.js&logoColor=white)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-informational)

Dibuat dengan Node.js murni (**tanpa `npm install`** — cuma pakai modul bawaan `http` & `child_process`). Cukup satu file `server.js`.

---

## ✨ Fitur

- 📁 **Browse** seluruh penyimpanan HP — breadcrumb navigasi + shortcut cepat (Camera, DCIM, Movies, Pictures, Download, sdcard)
- 🔃 **Sorting** — klik header kolom untuk urutkan berdasarkan **Nama / Ukuran / Tanggal** (toggle naik–turun, folder selalu di atas)
- 👁 **Preview langsung di browser** — video, foto, dan audio tanpa perlu download dulu
- ⬇ **Download** — streaming langsung dari HP via `adb exec-out cat` (tanpa file salinan sementara)
- 📊 Info **ukuran & tanggal** tiap file
- 🔒 Hanya bind ke `localhost` — aman, tidak terbuka ke jaringan

---

## 📦 Syarat

| Kebutuhan | Keterangan |
|-----------|------------|
| **ADB** | `brew install android-platform-tools` (macOS) |
| **Node.js** | versi 16 atau lebih baru |
| **USB Debugging** | aktif di HP & sudah ditekan **Allow** saat dicolok |

### Mengaktifkan USB Debugging di HP
1. **Settings → About phone** → ketuk **Build number** 7× untuk membuka *Developer options*
2. **Settings → Developer options → USB debugging** → aktifkan
3. Colok HP via USB → muncul popup **"Allow USB debugging?"** → centang *Always allow* → **OK**

Cek HP sudah terbaca:
```bash
adb devices
```
Harus muncul serial + status `device`.

---

## 🚀 Menjalankan

```bash
node server.js
```
Lalu buka **http://localhost:8765**

Ganti port bila perlu:
```bash
PORT=9000 node server.js
```

---

## 🛠 Cara Kerja

| Aksi | Perintah ADB di balik layar |
|------|------------------------------|
| List folder | `adb shell ls -lap '<path>'` |
| Download / preview | `adb exec-out cat '<path>'` (di-*stream* ke browser) |
| Deteksi device | `adb devices -l` |

Path device selalu dalam bentuk `/sdcard/...` (storage internal — penamaan lama Android, bukan SD card fisik).

> **Keamanan:** semua path di-*single-quote* untuk shell di perangkat, jadi nama file berspasi aman dan tidak ada celah command injection.

---

## ❓ Troubleshooting

| Masalah | Solusi |
|---------|--------|
| Device tidak terbaca | Pastikan kabel **data** (bukan charge-only) & USB Debugging sudah *Allow* |
| Status `unauthorized` | Cek popup di layar HP, tekan *Allow* |
| `adb: command not found` | Install platform-tools & pastikan ada di `PATH` |
| Folder kosong/error | Sebagian folder sistem butuh izin root — coba folder di `/sdcard/` |

---

## 📄 Lisensi

MIT — bebas dipakai & dimodifikasi.

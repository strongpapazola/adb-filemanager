# ADB File Manager

File manager web sederhana untuk browse & download file dari HP Android lewat ADB.

## Syarat
- `adb` terpasang (`brew install android-platform-tools`)
- USB Debugging aktif di HP, dan sudah "Allow" saat dicolok
- Node.js

## Jalankan
```bash
node server.js
```
Lalu buka http://localhost:8765

Ganti port kalau perlu:
```bash
PORT=9000 node server.js
```

## Fitur
- Browse folder HP (breadcrumb + shortcut Camera/DCIM/Movies/dll)
- Lihat ukuran & tanggal file
- Preview video / foto / audio langsung di browser (tombol 👁 Lihat)
- Download file (streaming langsung dari HP, tanpa salin sementara)

## Catatan
- Hanya bind ke localhost; aman dipakai di komputer sendiri.
- Path device pakai `/sdcard/...` (storage internal).

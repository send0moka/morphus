# Alur Sistem Plugin Morphus

Dokumen ini menjelaskan alur dari user memasukkan HTML di plugin sampai user menerima output berupa frame di Figma Design.

## Alur Singkat

```mermaid
flowchart TD
  A[User buka plugin Morphus di Figma] --> B[User paste HTML atau upload file HTML]
  B --> C[Plugin validasi input HTML]
  C --> D[User pilih viewport width atau custom viewport]
  D --> E[User klik Convert & Build]
  E --> F[Plugin cek server Hugging Face]
  F --> G[Plugin kirim HTML dan viewport ke server converter]
  G --> H[Server render HTML dan convert ke JSON Figma-ready]
  H --> I[Plugin menerima hasil conversion]
  I --> J[Plugin preload font dan buat local styles]
  J --> K[Plugin build node/frame di Figma]
  K --> L[User menerima output frame di Figma Design]
```

## Alur Detail

```mermaid
flowchart TD
  A["User buka plugin Morphus di Figma"] --> B{"User pilih cara input"}

  B --> C["Paste HTML ke area Paste HTML"]
  B --> D["Upload file HTML"]

  D --> E{"File valid?"}
  E -->|Tidak| F["Plugin tampilkan error: pilih file .html"]
  E -->|Ya| G["Plugin baca isi file"]
  G --> H{"Isi terlihat seperti HTML?"}
  H -->|Tidak| I["Plugin tampilkan error: file tidak terlihat seperti HTML"]
  H -->|Ya| J["Isi file otomatis masuk ke area Paste HTML"]

  C --> K["User bisa edit HTML"]
  J --> K

  K --> L["User pilih viewport width"]
  L --> M{"Viewport yang dipakai"}
  M --> N["Preset viewport"]
  M --> O["Custom viewport width"]
  M --> P["Beberapa viewport sekaligus"]

  N --> Q["User klik Convert & Build"]
  O --> Q
  P --> Q

  Q --> R{"Input siap diproses?"}
  R -->|Tidak| S["Plugin tampilkan error input"]
  R -->|Ya| T["Plugin buat payload HTML, source name, viewport, dan daftar viewport"]

  T --> U["UI plugin kirim pesan CONVERT_AND_BUILD"]
  U --> V["Main thread plugin menerima payload"]

  V --> W["Plugin cek server Hugging Face /health"]
  W --> X{"Server siap?"}
  X -->|Tidak| Y["Plugin tampilkan error server tidak bisa dijangkau"]
  X -->|Ya| Z["Plugin kirim HTML dan viewport ke /jobs"]

  Z --> AA["Server membuat job conversion"]
  AA --> AB["Server kirim jobId ke plugin"]
  AB --> AC["Plugin polling status ke /jobs/:jobId"]

  AC --> AD{"Status job"}
  AD -->|Running| AE["Plugin update indikator progress"]
  AE --> AC
  AD -->|Error| AF["Plugin tampilkan error conversion"]
  AD -->|Done| AG["Server kirim JSON Figma-ready"]

  AG --> AH["Plugin baca hasil JSON"]
  AH --> AI["Plugin pastikan halaman Figma siap"]
  AI --> AJ["Plugin preload font"]
  AJ --> AK["Plugin buat local styles jika ada"]
  AK --> AL["Plugin build node dari JSON"]

  AL --> AM["Membuat frame"]
  AL --> AN["Membuat text node"]
  AL --> AO["Membuat image atau SVG node"]
  AL --> AP["Menyusun layer sesuai struktur"]

  AM --> AQ["Frame ditambahkan ke canvas Figma"]
  AN --> AQ
  AO --> AQ
  AP --> AQ

  AQ --> AR{"Ada beberapa viewport?"}
  AR -->|Ya| AS["Plugin ulangi proses build untuk viewport berikutnya"]
  AS --> AL
  AR -->|Tidak| AT["Plugin tampilkan Done, jumlah node, dan jumlah viewport"]

  AT --> AU["User menerima output frame di Figma Design"]
```

1. User membuka plugin Morphus di Figma.

2. User memasukkan HTML melalui salah satu cara:
   - paste langsung ke area Paste HTML
   - upload file `.html` atau `.htm`

3. Jika user upload file, plugin melakukan validasi:
   - file harus berupa HTML
   - isi file harus terlihat seperti struktur HTML
   - jika valid, isi file otomatis masuk ke area Paste HTML

4. User masih bisa mengedit isi HTML di area Paste HTML sebelum diproses.

5. User memilih viewport:
   - bisa pilih viewport width yang sudah tersedia
   - bisa memakai custom viewport width
   - bisa memilih beberapa viewport sekaligus

6. User klik tombol `Convert & Build`.

7. Plugin melakukan validasi ulang:
   - HTML tidak boleh kosong
   - HTML harus terlihat valid
   - minimal satu viewport harus dipilih

8. Plugin membuat payload berisi:
   - isi HTML
   - nama sumber HTML
   - viewport utama
   - daftar viewport yang dipilih

9. Plugin mengirim pesan dari UI ke main thread Figma plugin dengan tipe `CONVERT_AND_BUILD`.

10. Main thread plugin menggunakan server converter Hugging Face:
    - server: `https://jehian-tempelhtml.hf.space`
    - health check: `https://jehian-tempelhtml.hf.space/health`

11. Plugin mengecek koneksi server melalui endpoint `/health`.

12. Jika server siap, plugin mengirim HTML dan viewport ke endpoint `/jobs`.

13. Server membuat job conversion dan mengembalikan `jobId` ke plugin.

14. Plugin melakukan polling ke endpoint `/jobs/:jobId` untuk membaca status conversion.

15. Selama proses berjalan, plugin menampilkan indikator progress ke user.

16. Di server, HTML diproses menjadi data Figma-ready:
    - HTML dirender sesuai viewport
    - style, layout, ukuran, teks, warna, gambar, dan struktur halaman dibaca
    - hasilnya diubah menjadi JSON yang bisa dibangun ulang di Figma

17. Setelah conversion selesai, server mengirim hasil JSON ke plugin.

18. Plugin membaca hasil JSON tersebut.

19. Plugin menyiapkan kebutuhan Figma sebelum build:
    - memastikan halaman Figma siap dipakai
    - preload font
    - membuat local styles jika dibutuhkan

20. Plugin membangun desain di canvas Figma:
    - membuat frame
    - membuat text node
    - membuat image/SVG node jika ada
    - menyusun layer sesuai struktur hasil conversion

21. Jika user memilih beberapa viewport, plugin mengulang proses build untuk setiap viewport dan memberi label pada hasilnya.

22. Setelah selesai, plugin menampilkan status `Done`, jumlah node yang dibuat, dan jumlah viewport jika lebih dari satu.

23. User menerima output berupa frame yang sudah muncul di Figma Design dan bisa diedit.

## Output Akhir Untuk User

- Frame muncul langsung di canvas Figma.
- Teks, warna, ukuran, layout, dan elemen visual sudah dibangun dari HTML.
- Hasil bisa diedit seperti desain Figma biasa.
- Jika beberapa viewport dipilih, setiap viewport dibuat sebagai hasil terpisah.

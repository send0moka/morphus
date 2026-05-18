# Morphus Done Checklist

Checklist ini hanya berisi bagian yang sudah tersedia dan relevan untuk server Hugging Face serta plugin Figma.

## Hugging Face Server

- [x] Konfigurasi Hugging Face Space sudah tersedia.
- [x] Link health server Hugging Face tersedia: `https://jehian-tempelhtml.hf.space/health`.
- [x] Server Hugging Face sudah aktif dan health check mengembalikan status OK.
- [x] Server disiapkan untuk berjalan sebagai service di Hugging Face.
- [x] Port aplikasi Hugging Face sudah diset ke `7860`.
- [x] Server converter sudah bisa menerima proses convert dari plugin.
- [x] Server sudah punya pengecekan koneksi untuk memastikan plugin bisa terhubung.

## Figma Plugin

- [x] Plugin Figma sudah tersedia.
- [x] Plugin sudah punya tampilan untuk memasukkan HTML.
- [x] Plugin sudah punya tombol untuk convert dan build desain.
- [x] Plugin sudah bisa terhubung ke server converter.
- [x] Plugin sudah menampilkan status/progress saat proses berjalan.

## Kelebihan Plugin

- [x] Ada switch theme untuk mengganti tampilan plugin.
- [x] Ada akses ke benchmark visual melalui `https://figmaeval.vercel.app`.
- [x] Input file sudah divalidasi agar hanya menerima file HTML.
- [x] Saat file HTML diinput, isi HTML otomatis masuk ke area paste HTML.
- [x] HTML yang sudah masuk ke area paste tetap bisa diedit sebelum convert.
- [x] Pengguna bisa memilih viewport width.
- [x] Pengguna bisa memakai custom viewport width.
- [x] Plugin bisa langsung `Convert & Build`.
- [x] Plugin bisa convert dan build untuk beberapa viewport.
- [x] Ada indikator progress saat proses convert dan build berjalan.

## Distribusi Sementara Plugin

- [x] Plugin belum perlu dipublish dulu ke Figma Community.
- [x] File plugin sementara sudah disiapkan dalam bentuk ZIP: `C:\Users\jehia\Desktop\figma-plugin.zip`.
- [x] ZIP plugin bisa dibagikan lewat Slack.
- [x] Setiap pengguna bisa download ZIP di laptop masing-masing.
- [x] Setiap pengguna bisa extract ZIP tersebut.
- [x] Di Figma, pengguna bisa pilih import plugin dari manifest.
- [x] Manifest diarahkan ke file `manifest.json` yang ada di folder hasil extract.

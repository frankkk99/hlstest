# HLS Test Lab

เครื่องมือทดสอบ HLS แบบ server-side สำหรับกรณีที่ upstream ต้องการ `Origin`, `Referer`, User-Agent หรือใช้ signed URL.

## ความสามารถ

- ตรวจ HTTP status / Content-Type / latency
- ตรวจว่า response เป็น HLS จริง (`#EXTM3U`)
- แสดง VOD / target duration / จำนวน segment / variant
- อ่าน expiry จาก `e`, `expires`, หรือ `x`
- ตรวจ hint ของ IP / browser / signature / session binding จาก query string
- ตรวจ segment แรกด้วย Range request
- แสดง CORS, `X-Request-Id`, `X-U18-Cache`, `X-U18-Guard`
- รองรับ Upload18/helvid.com ผ่าน allowlist เริ่มต้น
- Preview ผ่าน HLS.js + local stream proxy (ปิดไว้โดยค่าเริ่มต้น)
- Player Extractor ที่ `/player-extractor` สำหรับอ่าน URL หน้าเว็บ/HTML, ถอด JavaScript packer และทดสอบ `.m3u8` / `.mp4`

## รัน Local

```bash
npm install
cp .env.example .env.local
npm run dev
```

เปิด `http://localhost:3000`

หากต้องการ Preview ให้แก้ `.env.local`:

```env
ALLOWED_HLS_HOSTS=helvid.com,surrit.com,fourhoi.com

# ใช้กับหน้า Player Extractor ตอนใส่ URL หน้าเว็บ
ALLOWED_SOURCE_PAGE_HOSTS=missav123.com,missav.com,fourhoi.com,upload18.org

# ใช้เพิ่ม media host ที่อนุญาตให้ extractor ยิงทดสอบ
ALLOWED_EXTRACT_MEDIA_HOSTS=surrit.com,fourhoi.com
ENABLE_STREAM_PROXY=true
```

แล้ว restart `npm run dev`.

> สำหรับ signed URL ที่ผูก IP ควรรัน local บนเครื่อง/เครือข่ายเดียวกับที่ได้ URL เพราะ request จาก Vercel หรือ VPS จะใช้อีก public IP และอาจถูก upstream ปฏิเสธ.

## Deploy

ใช้งานบน Vercel/Node ได้สำหรับ diagnostic probe. แนะนำให้คง:

```env
ENABLE_STREAM_PROXY=false
```

บน public deployment เพื่อไม่ให้ระบบกลายเป็น streaming proxy และไม่ให้เกิด bandwidth สูง.

ตั้ง `ALLOWED_HLS_HOSTS` ให้แคบที่สุด เช่น:

```env
ALLOWED_HLS_HOSTS=helvid.com
```

หากต้องการทดสอบ host อื่น ให้เพิ่มแบบ comma-separated เฉพาะ host ที่ได้รับอนุญาตให้ทดสอบเท่านั้น.

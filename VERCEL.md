# Deploy P9 Bio Analytics to Vercel

โปรเจกต์นี้รองรับ Vercel แล้ว โดยใช้ Vercel Functions ในโฟลเดอร์ `api/` และเก็บสถิติใน Upstash Redis ผ่าน REST API

## สิ่งที่ต้องมี

1. บัญชี Vercel
2. GitHub repository ที่อัปโหลดโฟลเดอร์นี้
3. Upstash Redis database หรือ Redis integration ใน Vercel Marketplace

## Environment Variables ที่ต้องตั้งใน Vercel

ตั้งใน Vercel Project > Settings > Environment Variables

```text
UPSTASH_REDIS_REST_URL=ใส่ REST URL จาก Upstash
UPSTASH_REDIS_REST_TOKEN=ใส่ REST TOKEN จาก Upstash
DASHBOARD_USER=admin
DASHBOARD_PASSWORD=รหัสผ่านแดชบอร์ดที่ต้องการ
SESSION_SECRET=สุ่มข้อความยาว ๆ สำหรับเซ็น cookie
```

ถ้าใช้ Vercel Redis/Upstash integration ที่ให้ชื่อ env แบบเก่า โปรเจกต์นี้รองรับชื่อเหล่านี้ด้วย:

```text
KV_REST_API_URL
KV_REST_API_TOKEN
```

## ขั้นตอน Deploy

1. อัปโหลดไฟล์ทั้งหมดในโฟลเดอร์ `p9-bio` ขึ้น GitHub
2. เข้า Vercel > Add New > Project
3. Import GitHub repository
4. Framework Preset เลือก `Other`
5. Build Command ปล่อยว่างได้
6. Output Directory ปล่อยว่างได้
7. ตั้ง Environment Variables ตามรายการด้านบน
8. กด Deploy

หลัง deploy:

- หน้า Bio: `https://ชื่อโปรเจกต์.vercel.app/`
- Dashboard: `https://ชื่อโปรเจกต์.vercel.app/dashboard.html`

## ทดสอบหลัง Deploy

1. เปิดหน้า Bio
2. กดปุ่ม `โปรโมชั่น` 1 ครั้ง
3. เปิด `/dashboard.html`
4. login ด้วย user/password ที่ตั้งไว้
5. ตรวจว่าสถิติเพิ่มขึ้น

## หมายเหตุ

- Vercel ไม่เหมาะกับการเก็บไฟล์ `data/click-stats.json` เพราะ Functions มี filesystem แบบ read-only และ `/tmp` เป็นพื้นที่ชั่วคราว
- โค้ด Vercel ชุดนี้จึงใช้ Upstash Redis แทนไฟล์ JSON
- `server.js` ยังใช้ได้สำหรับรัน local หรือ deploy บน Render แต่ Vercel จะใช้ไฟล์ใน `api/`

# Deploy P9 Bio Analytics

## Vercel

โปรเจกต์นี้รองรับ Vercel แล้ว แต่ Vercel ต้องใช้ Redis/Database สำหรับเก็บสถิติ ไม่ใช่ไฟล์ JSON ในเครื่อง

ดูขั้นตอนเต็มใน `VERCEL.md`

## แนะนำ: Render

เหมาะกับโปรเจกต์นี้เพราะรัน Node.js ได้และเพิ่ม Persistent Disk ได้ ทำให้ไฟล์ `click-stats.json` ไม่หายตอน redeploy/restart

1. สร้าง GitHub repository ใหม่
2. อัปโหลดไฟล์ทั้งหมดในโฟลเดอร์ `p9-bio` ขึ้น repo
3. เข้า Render แล้วเลือก New > Blueprint
4. เลือก repo ที่อัปโหลดไว้
5. Render จะอ่าน `render.yaml` และสร้าง Web Service พร้อม disk
6. ใส่ค่า `DASHBOARD_PASSWORD` ตอน Render ถาม
7. Deploy

หลัง deploy:

- หน้า Bio: `https://ชื่อ-service.onrender.com/`
- Dashboard: `https://ชื่อ-service.onrender.com/dashboard.html`

ค่า default:

- `DASHBOARD_USER=admin`
- `DASHBOARD_PASSWORD` ให้ตั้งเองใน Render
- `DATA_DIR=/var/data`

## Railway

ใช้ได้เช่นกัน แต่ต้องเพิ่ม Volume ให้ service

1. อัปโหลดโฟลเดอร์ `p9-bio` ขึ้น GitHub
2. สร้าง Project ใน Railway จาก GitHub repo
3. เพิ่ม Volume ให้ service
4. ตั้ง Environment Variables:
   - `DASHBOARD_USER=admin`
   - `DASHBOARD_PASSWORD=รหัสที่ต้องการ`
5. Railway จะส่ง `RAILWAY_VOLUME_MOUNT_PATH` ให้แอปอัตโนมัติ และ server จะใช้ path นี้เก็บข้อมูล

## คำสั่งรัน local

```bash
npm start
```

เปิด:

- `http://localhost:8787/`
- `http://localhost:8787/dashboard.html`

## หมายเหตุ

อย่าเปิดเว็บด้วย `file:///...` เมื่อต้องการเก็บสถิติจริง เพราะการส่งสถิติต้องผ่าน backend URL เช่น `https://...` หรือ `http://localhost:8787`

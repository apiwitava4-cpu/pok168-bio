# Next Steps: GitHub + Render

สถานะตอนนี้:

- โฟลเดอร์นี้เป็น git repo แล้ว
- branch คือ `main`
- commit ล่าสุดพร้อม push แล้ว
- ยังไม่มี GitHub remote
- ไฟล์ `data/` ถูก ignore ไม่ติดขึ้น GitHub

## 1. สร้าง GitHub repo

เข้า GitHub แล้วสร้าง repo ใหม่ เช่น:

```text
p9-bio
```

ไม่ต้องติ๊กเพิ่ม README, .gitignore หรือ license เพราะโฟลเดอร์นี้มีไฟล์แล้ว

## 2. เพิ่ม remote และ push

หลังสร้าง repo แล้ว GitHub จะให้ URL ประมาณนี้:

```text
https://github.com/YOUR_USERNAME/p9-bio.git
```

ใช้คำสั่ง:

```bash
git remote add origin https://github.com/YOUR_USERNAME/p9-bio.git
git push -u origin main
```

ถ้า GitHub ถามให้ login ให้ login ด้วยบัญชีของคุณ

## 3. Deploy ด้วย Render Blueprint

1. เข้า Render
2. เลือก New > Blueprint
3. Connect GitHub repo `p9-bio`
4. Render จะอ่าน `render.yaml`
5. ตั้งค่า `DASHBOARD_PASSWORD`
6. Deploy

หลัง deploy:

- หน้า Bio: `https://ชื่อ-service.onrender.com/`
- Dashboard: `https://ชื่อ-service.onrender.com/dashboard.html`

## สำคัญ

ระบบสถิติบน Render ใช้ persistent disk ที่ `/var/data` ตาม `render.yaml`

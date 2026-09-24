/*
สารบัญการทำงานของไฟล์นี้
1. บรรทัด 15: รายชื่อชุดข้อมูลจาก data.go.th
2. บรรทัด 25-28: ที่เก็บข้อมูลชั่วคราว และการสร้าง Express
3. บรรทัด 31: อ่านข้อมูลสำรองจาก backup.json
4. บรรทัด 42: ขอข้อมูลจาก API และเลือก cache หรือ backup เมื่อ API ล่ม
5. บรรทัด 64: Express รับคำขอ รวมข้อมูล และส่ง JSON ให้หน้าเว็บ
6. บรรทัด 101: ส่ง Express ให้ Vercel ใช้งาน
*/

import fs from "node:fs/promises";
import path from "node:path";
import express from "express";

const RESOURCES = {
  north: "1184397a-7abf-4f5a-a528-5b74861c134c",
  central: "14ef5da4-f002-45b2-95b0-57f6a3395a39",
  northeast: "f0a7c7ef-6b36-4a27-99b8-f5840ca65050",
  south: "e0791839-d2d7-4cf2-9e7d-bc1ddfb15138",
  west: "807b3e4d-2cd2-44bc-8e89-b1acf3ebcf75",
  visitors: "1d1e76a8-48a1-48d7-b56a-3f1813f8e539"
};

// Cache ข้อมูลที่ดึงสำเร็จไว้ใน memory ของ serverless instance เพื่อลดการเรียก API ซ้ำ
const memoryCache = Object.create(null);

// สร้างแอป Express เพื่อรับคำขอจากหน้าเว็บ
const app = express();

// อ่านข้อมูลสำรองจาก backup.json เมื่อ data.go.th ใช้งานไม่ได้
async function readBackup() {
  const backupPath = path.join(process.cwd(), "backup.json");
  try {
    const text = await fs.readFile(backupPath, "utf8");
    return JSON.parse(text);
  } catch (error) {
    return { resources: {} };
  }
}

// ดึง resource เดียว โดยเลือก API ก่อน แล้วจึงใช้ cache หรือ backup ตามลำดับ
async function loadResource(resourceId, backup) {
  const targetUrl = `https://data.go.th/api/3/action/datastore_search?resource_id=${resourceId}&limit=1000`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(targetUrl, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const records = data && data.result && Array.isArray(data.result.records)
      ? data.result.records : [];
    memoryCache[resourceId] = records;
    return { records, source: "api" };
  } catch (error) {
    if (memoryCache[resourceId]) return { records: memoryCache[resourceId], source: "cache" };
    const backupRecords = backup.resources && backup.resources[resourceId];
    if (Array.isArray(backupRecords)) return { records: backupRecords, source: "backup" };
    throw error;
  }
}

// รวมข้อมูลสวนทั้ง 5 ภาคและสถิติผู้เข้าชมให้หน้าเว็บเรียกครั้งเดียว
app.use(async (req, res) => {
  // อ่าน resourceId จาก URL ที่หน้าเว็บส่งมา
  const requestedId = req.query && req.query.resourceId;
  // อ่านไฟล์สำรองเตรียมไว้ เผื่อ API หลักใช้งานไม่ได้
  const backup = await readBackup();
  // ถ้าขอ resource เดียว ให้โหลดเฉพาะตัวนั้น
  // ถ้าขอ all ให้โหลดข้อมูลสวนห้าภาคและข้อมูลผู้เข้าชม
  const ids = requestedId && requestedId !== "all"
    ? [requestedId]
    : [RESOURCES.north, RESOURCES.central, RESOURCES.northeast, RESOURCES.south, RESOURCES.west, RESOURCES.visitors];
  // เตรียมกล่องคำตอบที่จะแจกกลับไปให้หน้าเว็บ
  const response = { resources: {}, sources: {}, resourceIds: RESOURCES };
  // จำไว้ว่ามีชุดข้อมูลใดดึงจาก API ไม่สำเร็จหรือไม่
  let hasFailure = false;
  // เดินผ่าน resource ทีละตัวเพื่อควบคุมลำดับและ fallback ได้ชัดเจน
  for (let index = 0; index < ids.length; index += 1) {
    try {
      // ขอข้อมูลจาก API หรือ cache หรือ backup ตามลำดับ
      const result = await loadResource(ids[index], backup);
      // เก็บแถวข้อมูลของ resource นี้ไว้ในคำตอบ
      response.resources[ids[index]] = result.records;
      // บอกหน้าเว็บว่าข้อมูลมาจาก API, cache หรือ backup
      response.sources[ids[index]] = result.source;
    } catch (error) {
      // ถ้าทุกทางล้มเหลว ให้หน้าเว็บยังตอบกลับได้ด้วยรายการว่าง
      hasFailure = true;
      response.resources[ids[index]] = [];
      response.sources[ids[index]] = "unavailable";
    }
  }
  // ใส่ข้อความเตือนเมื่อมีบางชุดข้อมูลไม่ได้มาจาก API สด
  response.warning = hasFailure ? "บางชุดข้อมูลใช้ cache หรือ backup" : "";
  // ส่งคำตอบกลับในรูปแบบ JSON
  return res.status(200).json(response);
});

// ส่งแอป Express ให้ Vercel ใช้เป็น Serverless Function
export default app;
import fs from "node:fs/promises";
import path from "node:path";

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
export default async function handler(req, res) {
  const requestedId = req.query && req.query.resourceId;
  const backup = await readBackup();
  const ids = requestedId && requestedId !== "all"
    ? [requestedId]
    : [RESOURCES.north, RESOURCES.central, RESOURCES.northeast, RESOURCES.south, RESOURCES.west, RESOURCES.visitors];
  const response = { resources: {}, sources: {}, resourceIds: RESOURCES };
  let hasFailure = false;
  for (let index = 0; index < ids.length; index += 1) {
    try {
      const result = await loadResource(ids[index], backup);
      response.resources[ids[index]] = result.records;
      response.sources[ids[index]] = result.source;
    } catch (error) {
      hasFailure = true;
      response.resources[ids[index]] = [];
      response.sources[ids[index]] = "unavailable";
    }
  }
  response.warning = hasFailure ? "บางชุดข้อมูลใช้ cache หรือ backup" : "";
  return res.status(200).json(response);
}
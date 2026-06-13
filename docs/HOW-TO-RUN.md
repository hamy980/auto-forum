# Hướng dẫn chạy Scripts

## Bước 1: Khởi động các service nền

```powershell
cd "C:\Users\MYPC\Documents\New project"
npm install            # lần đầu
npm run browser:start  # start browser service (port 19995)
```

Mở GPM Login (desktop app) → các profile GPM phải ready.

## Bước 2: Chạy campaign (3 cách)

### Cách A — Wizard (khuyên dùng, mới tạo)

```powershell
node scripts/run-quick.js
```

Hỏi lần lượt:

1. **Domain** (forum): `massagevua.net`, `forum4travel.com`, `thiendia.vip`, `sample-forum` — load `config/forums/<domain>.json` + match GPM group
2. **Member list file path**: relative (`data/members/x.txt`) hoặc absolute Windows (`C:\...\x.txt`)
3. **Content file path**: `.json` với `contents: [{title, body}, ...]` (mỗi recipient pick 1 variant)
4. **Profile selection** (scoped tới GPM group match domain): `Enter` = tất cả trong group, `N` = N đầu, hoặc comma-separated UUIDs/names
5. Confirm → tạo `campaigns/quick-<timestamp>.json` + chạy `runner.js`

### Cách B — Campaign có sẵn

```powershell
node scripts/runner.js --campaign massagevua-greet
node scripts/runner.js --campaign massagevua-greet4 --resume
node scripts/runner.js --campaign sample-campaign --profiles <id1>,<id2>
```

`--resume` đọc state của **từng profile** từ `runtime/<campaignId>/<profileId>-state.json` (queue còn lại + index). Profiles nào có state thì resume từ queue đó; profiles nào chưa có state (mới thêm vào campaign) thì được gán lại từ full member list (round-robin với các profile "mới"). Không duplicate send.

### Cách C — Tạo campaign thủ công

Tạo `campaigns/<id>.json` theo schema, rồi chạy cách B.

## Bước 3: Reply / Harvest / Followup

```powershell
# Check inbox
node scripts/reply-harvest.js --forum massagevua.net --profile <profile-id>

# AI reply
node scripts/ai-reply.js --forum massagevua.net --dry-run
node scripts/ai-reply.js --forum massagevua.net

# Send reply
node scripts/reply-send.js --forum massagevua.net --profile <id> --url <conv-url> --content "text"

# Polling reply loop
node scripts/runner-reply.js --forum massagevua.net --profile <id> --ai --max-replies 10

# Follow-up check
node scripts/followup-check.js --forum massagevua.net --profile <id> --campaign massagevua-greet
```

## Bước 4: Quản lý profile

```powershell
npm run gpm:list -- --groups
npm run gpm:list -- --profiles --search massagevua
node scripts/check-results.js --campaign massagevua-greet --watch
```

## Bước 5: Watch campaign realtime

Vì CDP chạy ở background, browser không hiện UI. Dùng `watch-campaign.js` poll summary files mỗi N giây:

```powershell
node scripts/watch-campaign.js <campaign-id> [intervalSec]
# vi du:
node scripts/watch-campaign.js quick-20260613-193047 3
```

Output (mỗi tick):
```
=== quick-20260613-193047 @ 8:18:48 PM ===
profile                               | sent | errs | lastStatus     | lastSeen
--------------------------------------|------|------|----------------|--------
36414da6-e10f-4d9b-b5b0-179e7085bb24 |    9 |    3 | sent           | 1s ago
37f46b12-98a3-460a-9243-6cea26af3393 |    6 |    4 | sent           | 56s ago
519de894-bf66-405b-b45e-d0ec87ca0476 |   13 |    5 | sent           | 1m16s ago
54445eae-c380-4d2d-a140-464f29e8ffa5 |   19 |    1 | sent           | 32s ago
edfc0483-bb5f-4590-aef3-b1a14ca5f318 |   13 |    6 | sent           | 19s ago
--------------------------------------|------|------|----------------|--------
TOTAL sent=60  errors=19  rate=29.7/min
```

Qua `run.bat` chọn **11**.

## Điều kiện cần trước khi chạy

1. `config/forums/<forumId>.json` phải tồn tại (4 cái có sẵn: `sample-forum`, `massagevua.net`, `forum4travel.com`, `thiendia.vip`)
2. `data/members/<file>.txt` phải có member list
3. GPM profile IDs phải lấy từ `gpm:list`
4. Có thể cần `npm install` lần đầu

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

1. Member file path (vd: `data/members/massagevua-test.txt`)
2. Forum ID (tự list: `forum4travel.com`, `massagevua.net`, `thiendia.vip`, `sample-forum`)
3. Content file (`.json` với `titleTemplates`+`bodyTemplates`, hoặc `.txt` mỗi dòng 1 body)
4. Profile IDs (Enter = auto-fetch từ GPM)
5. Confirm → tạo `campaigns/quick-<timestamp>.json` + chạy `runner.js`

### Cách B — Campaign có sẵn

```powershell
node scripts/runner.js --campaign massagevua-greet
node scripts/runner.js --campaign massagevua-greet4 --resume
node scripts/runner.js --campaign sample-campaign --profiles <id1>,<id2>
```

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

## Điều kiện cần trước khi chạy

1. `config/forums/<forumId>.json` phải tồn tại (4 cái có sẵn: `sample-forum`, `massagevua.net`, `forum4travel.com`, `thiendia.vip`)
2. `data/members/<file>.txt` phải có member list
3. GPM profile IDs phải lấy từ `gpm:list`
4. Có thể cần `npm install` lần đầu

# Content samples

File content cho wizard (`scripts/run-quick.js`) — định dạng JSON `contents[]` chứa nhiều biến thể, mỗi recipient pick 1 ngẫu nhiên.

## Cú pháp

```json
{
  "contents": [
    { "title": "...", "body": "..." },
    { "title": "...", "body": "..." }
  ]
}
```

## Biến có sẵn

| Biến | Nguồn |
|---|---|
| `{member_name}` | Tên member từ URL `?to={member_name}` |
| `{first_name}` | Từ đầu tiên của `{member_name}` (vd: "John" từ "John Doe") |
| `{recipient_name}` | Full member name |
| `{domain}` | Domain forum (vd: `gvn.co`) |
| `{campaign_id}` | ID campaign |
| `{sequence}` | Số thứ tự |
| `{profile_name}` | Tên GPM profile |

## Spin syntax

Dùng `{a|b|c}` trong title/body để random mỗi lần gửi:

```
"body": "Chào {member_name}! {Mình hy vọng|Mong rằng} chúng ta có thể {trao đổi|giao lưu} thêm nhé!"
```

→ 2 × 2 = 4 biến thể mỗi lần gửi.

## Ví dụ

- `vi.json` — 10 biến thể tiếng Việt
- `en.json` — 10 biến thể tiếng Anh

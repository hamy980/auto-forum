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

## Lý do dùng `<<var>>` thay vì `{var}`

Dấu `{` `}` xung đột với cú pháp JSON (object/array). Dùng `<<var>>` để:
- File JSON hợp lệ mà không cần escape
- Dễ đọc, dễ phân biệt với JSON structure
- Regex đơn giản: `<<([a-zA-Z0-9_]+)>>`

## Biến có sẵn

| Biến | Nguồn |
|---|---|
| `<<member_name>>` | Tên member từ URL `?to={member_name}` |
| `<<first_name>>` | Từ đầu tiên của member_name (vd: "John" từ "John Doe") |
| `<<recipient_name>>` | Full member name |
| `<<domain>>` | Domain forum (vd: `gvn.co`) |
| `<<campaign_id>>` | ID campaign |
| `<<sequence>>` | Số thứ tự |
| `<<profile_name>>` | Tên GPM profile |

## Spin syntax

Dùng `<<a|b|c>>` trong title/body để random mỗi lần gửi:

```
"body": "Chào <<member_name>>! <<Mình hy vọng|Mong rằng>> chúng ta có thể <<trao đổi|giao lưu>> thêm nhé!"
```

→ 2 × 2 = 4 biến thể mỗi lần gửi.

## Ví dụ

- `vi.json` — 10 biến thể tiếng Việt
- `en.json` — 10 biến thể tiếng Anh

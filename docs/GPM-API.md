# GPM API Reference

Base URL configured in `config/gpm.json` → `baseUrl` (default: `http://127.0.0.1:19995`).

All endpoints return JSON. Successful responses have `success: true` and a `data` field.
Failed responses have `success: false` and a `message` field.

Client wrapper: `scripts/lib/gpm-client.js` (`GpmClient`).

---

## Endpoints

### List Groups

```
GET /api/v3/groups
```

Returns all GPM profile groups.

**Response `data`**: array of group objects.

| Field       | Type   | Description        |
|-------------|--------|--------------------|
| `id`        | number | Group ID           |
| `name`      | string | Group display name |
| `sort`      | number | Sort order         |
| `created_by`| number | Creator user ID    |
| `created_at`| string | ISO timestamp      |
| `updated_at`| string | ISO timestamp      |

**CLI**: `npm run gpm:list -- --groups`

---

### List Profiles

```
GET /api/v3/profiles?search=&group_id=&per_page=&page=
```

**Query parameters** (all optional):

| Param       | Type   | Default | Description              |
|-------------|--------|---------|--------------------------|
| `search`    | string | `""`    | Filter by name           |
| `group_id`  | number | —       | Filter by group ID        |
| `per_page`  | number | `100`   | Results per page          |
| `page`      | number | `1`     | Page number               |

**Response `data`**: array of profile objects.

| Field            | Type   | Description                    |
|------------------|--------|--------------------------------|
| `id`             | string | Profile UUID                   |
| `name`           | string | Profile display name           |
| `raw_proxy`      | string | Proxy string (socks5/http)     |
| `profile_path`   | string | Browser profile directory name |
| `browser_type`   | string | e.g. `"Chrome"`               |
| `browser_version`| string | e.g. `"139.0.7258.139"`      |
| `note`           | string | User note (nullable)          |
| `group_id`       | number | Group this profile belongs to  |
| `created_at`     | string | ISO timestamp                 |

**CLI**: `npm run gpm:list -- --profiles --search massagevua --group-id 33`

---

### Get Profile

```
GET /api/v3/profiles/:profileId
```

Returns a single profile object (same fields as list item above).

**Used by**: `start-profile` task to resolve profile name before starting.

---

### Start Profile

```
GET /api/v3/profiles/start/:profileId?win_scale=0.8
```

Starts a GPM browser profile and returns connection info.

**Query parameters** (optional, from `config/gpm.json` → `startOptions`):

| Param        | Type   | Description           |
|--------------|--------|-----------------------|
| `win_scale`  | string | Browser window scale  |

**Response `data`**:

| Field                      | Type   | Description                            |
|----------------------------|--------|----------------------------------------|
| `remote_debugging_address`  | string | CDP endpoint, e.g. `"127.0.0.1:54321"` |

The pipeline then connects via `chromium.connectOverCDP("http://" + remote_debugging_address)`.

**Error**: if `remote_debugging_address` is missing, the task throws.

---

### Close Profile

```
GET /api/v3/profiles/close/:profileId
```

Closes a GPM browser profile.

**Used by**: `stop-profile` task when `lifecycle.closeProfile !== false`.

---

## Error Handling

`GpmClient.request()` checks:
- `response.ok` (HTTP status)
- `payload.success === false` (application-level error)

On failure, throws `Error(payload.message || "GPM request failed: " + pathname)`.

In tasks, `stop-profile` catches close errors (`.catch(() => {})`) to ensure local Playwright cleanup always runs.

---

## Config Reference

`config/gpm.json`:

```json
{
  "baseUrl": "http://127.0.0.1:19995",
  "concurrency": 2,
  "startOptions": {
    "win_scale": "0.8"
  },
  "delayMs": {
    "min": 70000,
    "max": 95000
  }
}
```

| Field          | Type   | Description                           |
|----------------|--------|---------------------------------------|
| `baseUrl`      | string | GPM API endpoint                      |
| `concurrency`  | number | Max parallel profiles (for campaigns) |
| `startOptions` | object | Query params for start profile        |
| `delayMs.min`  | number | Minimum delay between sends (ms)     |
| `delayMs.max`  | number | Maximum delay between sends (ms)      |

---

## Task Usage

| Task              | API calls                                    |
|-------------------|----------------------------------------------|
| `list-groups`     | `GET /api/v3/groups`                         |
| `list-profiles`   | `GET /api/v3/profiles?...`                    |
| `start-profile`   | `GET /api/v3/profiles/:id` → `GET /api/v3/profiles/start/:id` |
| `attach-running`  | None (uses pre-provided CDP address)        |
| `stop-profile`    | `GET /api/v3/profiles/close/:id`             |

---

## Lifecycle Model

Two separate lifecycles must be distinguished:

1. **Local Playwright CDP session** — always closed at command end via `browser.close()`
2. **GPM browser profile** — remains open by default; only closed when `lifecycle.closeProfile` is explicitly set

The pipeline never assumes that closing Playwright also closes the GPM profile.
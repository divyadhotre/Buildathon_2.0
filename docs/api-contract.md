# API Contract — target

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Health check (implemented) |
| POST | `/api/requests` | Create request |
| GET | `/api/requests` | List requests |
| GET | `/api/requests/{request_id}` | Request details |
| POST | `/api/requests/{request_id}/documents` | Upload new version |
| POST | `/api/documents/{document_id}/process` | Process document |
| PATCH | `/api/requests/{request_id}/fields` | Save corrections |
| POST | `/api/requests/{request_id}/decisions` | Human decision |
| GET | `/api/requests/{request_id}/history` | Audit/version history |
| GET | `/api/dashboard/summary` | Dashboard metrics |
| POST | `/api/requests/{request_id}/explanation` | Grounded explanation |

Only `/health` exists in the initial scaffold. Keep this contract updated as routes are implemented.

# jira-cursor-bridge

`jira-cursor-bridge` is a small Node.js webhook service that receives Jira webhook payloads and triggers a `repository_dispatch` event in a target GitHub repository.

## Features

- `GET /healthz` returns a health check response.
- `POST /jira-webhook` validates `x-jira-bridge-secret` using timing-safe comparison.
- Supports either:
  - raw Jira issue payloads (`body.issue.fields...`), or
  - simplified JSON payloads with normalized fields.
- Validates required fields (`issueKey`, `summary`).
- Dispatches GitHub Actions event type `jira_ticket_assigned`.
- Includes production-friendly logging and error handling.

## Requirements

- Node.js 20+
- A GitHub token with access to trigger `repository_dispatch` on the target repo.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy environment file:

   ```bash
   cp .env.example .env
   ```

   On Windows PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Set environment variables in `.env`.

## Environment Variables

- `PORT` - Port for this service (default `3000`)
- `WEBHOOK_SECRET` - Shared secret expected in `x-jira-bridge-secret` header
- `GITHUB_OWNER` - Target GitHub repository owner
- `GITHUB_REPO` - Target GitHub repository name
- `GITHUB_TOKEN` - GitHub token used to call `repository_dispatch`
- `JIRA_BASE_URL` - Default Jira base URL (used when not provided in webhook body)

## Run Locally

```bash
npm start
```

Server starts on `http://localhost:3000` by default.

## Test Commands

### Health check

```bash
curl http://localhost:3000/healthz
```

Expected:

```json
{"ok":true}
```

### Jira webhook (simplified payload)

```bash
curl -X POST http://localhost:3000/jira-webhook \
  -H "Content-Type: application/json" \
  -H "x-jira-bridge-secret: your-secret" \
  -d '{
    "issueKey": "PROJ-123",
    "summary": "Fix login flow",
    "description": "Users are redirected incorrectly after login.",
    "assigneeDisplayName": "Jane Doe",
    "assigneeEmail": "jane@example.com",
    "projectKey": "PROJ",
    "issueType": "Bug",
    "status": "In Progress",
    "priority": "High",
    "jiraBaseUrl": "https://your-company.atlassian.net",
    "repoFullName": "your-org/your-repo"
  }'
```

Expected responses:

- `202`:
  - `{"ok":true,"message":"workflow dispatched","issueKey":"PROJ-123"}`
- `401` when secret is invalid.
- `400` when `issueKey` or `summary` is missing.
- `502` when GitHub dispatch fails.
- `500` for unexpected server errors.

## Workflow Location

Place this workflow in the target repository at:

`/.github/workflows/jira-cursor-agent.yml`

It listens for `repository_dispatch` event type `jira_ticket_assigned` and runs the Cursor-based automation flow.

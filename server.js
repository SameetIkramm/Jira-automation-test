import crypto from "node:crypto";
import dotenv from "dotenv";
import express from "express";

dotenv.config({ override: true });

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ""), "utf8");
  const right = Buffer.from(String(b ?? ""), "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function validateSecret(receivedSecret, expectedSecret) {
  if (!receivedSecret || !expectedSecret) {
    return false;
  }
  return safeEqual(receivedSecret, expectedSecret);
}

function normalizeJiraPayload(body, env) {
  const issue = body?.issue ?? {};
  const fields = issue?.fields ?? {};
  const assignee = fields?.assignee ?? {};
  const project = fields?.project ?? {};
  const issueType = fields?.issuetype ?? {};
  const status = fields?.status ?? {};
  const priority = fields?.priority ?? {};

  const issueKey = body?.issueKey ?? issue?.key ?? null;
  const summary = body?.summary ?? fields?.summary ?? null;
  const description =
    body?.description ??
    fields?.description ??
    body?.issue?.renderedFields?.description ??
    null;
  const assigneeDisplayName =
    body?.assigneeDisplayName ?? assignee?.displayName ?? null;
  const assigneeEmail = body?.assigneeEmail ?? assignee?.emailAddress ?? null;
  const projectKey = body?.projectKey ?? project?.key ?? null;
  const normalizedIssueType = body?.issueType ?? issueType?.name ?? null;
  const normalizedStatus = body?.status ?? status?.name ?? null;
  const normalizedPriority = body?.priority ?? priority?.name ?? null;
  const jiraBaseUrl =
    body?.jiraBaseUrl ?? body?.jira?.baseUrl ?? env.JIRA_BASE_URL ?? null;
  const repoFullName =
    body?.repoFullName ??
    (env.GITHUB_OWNER && env.GITHUB_REPO
      ? `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`
      : null);

  return {
    issueKey,
    summary,
    description,
    assigneeDisplayName,
    assigneeEmail,
    projectKey,
    issueType: normalizedIssueType,
    status: normalizedStatus,
    priority: normalizedPriority,
    jiraBaseUrl,
    repoFullName
  };
}

async function dispatchToGitHub(payload, env) {
  const owner = requireEnv("GITHUB_OWNER");
  const repo = requireEnv("GITHUB_REPO");
  const token = requireEnv("GITHUB_TOKEN");

  const clientPayload = {
    issueKey: payload.issueKey,
    summary: payload.summary,
    description: payload.description,
    assignee: {
      displayName: payload.assigneeDisplayName,
      email: payload.assigneeEmail
    },
    project: {
      key: payload.projectKey
    },
    issue: {
      type: payload.issueType,
      status: payload.status,
      priority: payload.priority
    },
    jiraBaseUrl: payload.jiraBaseUrl,
    repo: {
      fullName: payload.repoFullName
    }
  };

  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/dispatches`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "jira-cursor-bridge/1.0"
    },
    body: JSON.stringify({
      event_type: "jira_ticket_assigned",
      client_payload: clientPayload
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    const err = new Error(`GitHub dispatch failed with status ${response.status}`);
    err.status = response.status;
    err.responseBody = errorBody;
    throw err;
  }
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.post("/jira-webhook", async (req, res) => {
  const requestId = crypto.randomUUID();
  const start = Date.now();
  try {
    const expectedSecret = requireEnv("WEBHOOK_SECRET");
    const incomingSecret = req.get("x-jira-bridge-secret");

    if (!validateSecret(incomingSecret, expectedSecret)) {
      console.warn(`[${requestId}] Unauthorized webhook attempt`);
      return res.status(401).json({ ok: false, error: "invalid secret" });
    }

    const payload = normalizeJiraPayload(req.body, process.env);
    if (!payload.issueKey || !payload.summary) {
      console.warn(
        `[${requestId}] Validation failed: missing issueKey or summary`
      );
      return res.status(400).json({
        ok: false,
        error: "missing required fields: issueKey and summary"
      });
    }

    await dispatchToGitHub(payload, process.env);
    console.info(
      `[${requestId}] Dispatched workflow for ${payload.issueKey} in ${Date.now() - start}ms`
    );
    return res.status(202).json({
      ok: true,
      message: "workflow dispatched",
      issueKey: payload.issueKey
    });
  } catch (error) {
    if (typeof error?.status === "number") {
      console.error(`[${requestId}] GitHub dispatch error`, {
        status: error.status,
        responseBody: error.responseBody
      });
      return res.status(502).json({ ok: false, error: "github dispatch failed" });
    }

    console.error(`[${requestId}] Unexpected error`, error);
    return res.status(500).json({ ok: false, error: "internal server error" });
  }
});

app.use((error, _req, res, next) => {
  if (
    error instanceof SyntaxError &&
    Object.prototype.hasOwnProperty.call(error, "status") &&
    error.status === 400 &&
    "body" in error
  ) {
    return res.status(400).json({ ok: false, error: "invalid json body" });
  }
  return next(error);
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  console.log(`jira-cursor-bridge listening on port ${port}`);
});


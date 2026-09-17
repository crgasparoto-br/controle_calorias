type SmokeResult = {
  status: number;
  ok: boolean;
  processed: number | null;
  deduplicated: boolean | null;
  runtimeCommit: string | null;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function sanitizeCommit(value: string | null) {
  return value?.match(/^[0-9a-f]{7,40}$/iu)?.[0] ?? null;
}

function buildPayload(messageId: string, text: string, phoneNumberId: string) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "issue-1097-smoke-business",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "redacted",
                phone_number_id: phoneNumberId,
              },
              messages: [
                {
                  from: required("ISSUE_1097_TEST_PHONE"),
                  id: messageId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

async function post(
  url: string,
  payload: unknown,
  expectedCommit: string
): Promise<SmokeResult> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const runtimeCommit = sanitizeCommit(
    response.headers.get("x-runtime-commit")
  );
  if (!response.ok || body.ok !== true) {
    throw new Error(`Smoke request failed with status=${response.status}`);
  }
  if (!runtimeCommit || !expectedCommit.startsWith(runtimeCommit)) {
    throw new Error(
      "Published runtime is not correlated to the candidate commit"
    );
  }
  return {
    status: response.status,
    ok: body.ok === true,
    processed: typeof body.processed === "number" ? body.processed : null,
    deduplicated:
      typeof body.deduplicated === "boolean" ? body.deduplicated : null,
    runtimeCommit,
  };
}

const webhookUrl = required("ISSUE_1097_WEBHOOK_URL");
const expectedCommit = required("ISSUE_1097_EXPECTED_COMMIT").toLowerCase();
const phoneNumberId = required("ISSUE_1097_CHANNEL_PHONE_NUMBER_ID");
const phone = required("ISSUE_1097_TEST_PHONE");
if (!/^[0-9a-f]{7,40}$/u.test(expectedCommit))
  throw new Error("ISSUE_1097_EXPECTED_COMMIT must be a hexadecimal SHA");
if (!/^\d{8,20}$/u.test(phone))
  throw new Error("ISSUE_1097_TEST_PHONE must be digits only");
if (!/^\d{8,80}$/u.test(phoneNumberId)) {
  throw new Error("ISSUE_1097_CHANNEL_PHONE_NUMBER_ID must be digits only");
}

const cases = [
  {
    label: "panco",
    messageId: "issue-1097-smoke-panco",
    text: "1 fatia de pão de forma Panco Premium",
  },
  {
    label: "commercial_non_panco",
    messageId: "issue-1097-smoke-wickbold",
    text: "1 fatia de pão integral Wickbold",
  },
] as const;
const results: Array<SmokeResult & { label: string }> = [];

for (const smokeCase of cases) {
  const first = await post(
    webhookUrl,
    buildPayload(smokeCase.messageId, smokeCase.text, phoneNumberId),
    expectedCommit
  );
  const replay = await post(
    webhookUrl,
    buildPayload(smokeCase.messageId, smokeCase.text, phoneNumberId),
    expectedCommit
  );
  if (replay.deduplicated !== true && replay.processed !== 0) {
    throw new Error(`Replay was not idempotent for ${smokeCase.label}`);
  }
  results.push({ label: smokeCase.label, ...first });
}

console.log(
  JSON.stringify({
    schemaVersion: 1,
    issue: 1097,
    smoke: "post-deploy",
    webhook: "POST /api/whatsapp/webhook",
    testPhone: "opaque",
    cases: results.map(result => ({
      label: result.label,
      status: result.status,
      ok: result.ok,
      processed: result.processed,
      deduplicated: result.deduplicated,
      runtimeCommit: result.runtimeCommit,
    })),
    replayChecked: true,
  })
);

#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const eventName = process.argv[2] ?? "unknown";
const input = await readStdin();
const payload = input ? JSON.parse(input) : {};
const sessionId = payload.sessionId ?? payload.session_id ?? "unknown-session";
const dataDirectory = process.env.COPILOT_COST_DATA_DIR
  ?? path.join(os.homedir(), ".copilot", "plugin-data", "copilot-cli-cost");

fs.mkdirSync(dataDirectory, { recursive: true });
fs.appendFileSync(
  path.join(dataDirectory, `${sessionId}.events.jsonl`),
  `${JSON.stringify({ eventName, recordedAt: new Date().toISOString(), payload })}\n`
);

async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return data.trim();
}


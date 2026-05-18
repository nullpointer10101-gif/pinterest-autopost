#!/usr/bin/env node
require('dotenv').config();

const igRepostService = require('../services/igRepostService');

function readArg(name) {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!hit) return '';
  return hit.slice(name.length + 3).trim();
}

async function main() {
  const mode = process.env.IG_REPOST_MODE || readArg('mode') || 'scan';
  const username = process.env.IG_REPOST_USERNAME || readArg('username') || '';
  const reason = process.env.IG_REPOST_REASON || readArg('reason') || '';

  console.log(`[IG-Repost] Starting pipeline. mode=${mode}${username ? ` username=@${username}` : ''}`);

  const result = await igRepostService.runPipeline({
    mode,
    username,
    source: process.env.GITHUB_ACTIONS === 'true' ? 'github_actions' : 'local',
    reason,
  });

  console.log('[IG-Repost] Result:');
  console.log(JSON.stringify(result, null, 2));

  if (!result.success) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[IG-Repost] Fatal error:', err.message);
  process.exit(1);
});

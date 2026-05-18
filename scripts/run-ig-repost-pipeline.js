#!/usr/bin/env node
require('dotenv').config();

const igRepostService = require('../services/igRepostService');
const igTrackerService = require('../services/igTrackerService');

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

  const result = ['sync-avatars', 'avatar-sync', 'avatars'].includes(String(mode).toLowerCase())
    ? await syncChannelAvatars({ username })
    : await igRepostService.runPipeline({
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

async function syncChannelAvatars({ username = '' } = {}) {
  const requestedUsername = igTrackerService.normalizeUsername(username);
  const accounts = requestedUsername
    ? [{ username: requestedUsername }]
    : await igRepostService.listChannels();

  const items = [];

  for (const account of accounts) {
    const cleanUsername = igTrackerService.normalizeUsername(account?.username || account);
    if (!cleanUsername) continue;

    try {
      const profilePicUrl = await igTrackerService.ensureChannelProfilePic(cleanUsername, {
        forceRefresh: true,
        allowApify: true,
      });

      if (profilePicUrl) {
        await igRepostService.setChannelProfilePic(cleanUsername, profilePicUrl);
        items.push({ username: cleanUsername, synced: true, profilePicUrl });
      } else {
        items.push({ username: cleanUsername, synced: false, error: 'profile picture unavailable' });
      }
    } catch (err) {
      items.push({ username: cleanUsername, synced: false, error: err.message });
    }
  }

  return {
    success: items.some((item) => item.synced),
    mode: 'sync-avatars',
    attempted: items.length,
    synced: items.filter((item) => item.synced).length,
    failed: items.filter((item) => !item.synced).length,
    items,
  };
}

main().catch((err) => {
  console.error('[IG-Repost] Fatal error:', err.message);
  process.exit(1);
});

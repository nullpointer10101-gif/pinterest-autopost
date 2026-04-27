const axios = require('axios');

async function triggerAutomation() {
  const token = process.env.GITHUB_TOKEN;
  const repo = 'pinterest-autopost';
  const owner = 'nullpointer10101-gif';

  if (!token) {
    console.warn('[GitHub] No GITHUB_TOKEN configured. Manual trigger skipped.');
    return { success: false, error: 'GITHUB_TOKEN missing' };
  }

  try {
    console.log(`[GitHub] Triggering workflow for ${owner}/${repo}...`);
    const res = await axios.post(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/hourly-automation.yml/dispatches`,
      { ref: 'main' },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    console.log('[GitHub] Workflow trigger sent successfully.');
    return { success: true };
  } catch (err) {
    console.error('[GitHub] Failed to trigger workflow:', err.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

async function triggerInstantMission() {
  const token = process.env.GITHUB_TOKEN;
  const repo = 'pinterest-autopost';
  const owner = 'nullpointer10101-gif';

  if (!token) {
    console.warn('[GitHub] No GITHUB_TOKEN configured. Instant mission skipped.');
    return { success: false, error: 'GITHUB_TOKEN missing' };
  }

  try {
    console.log(`[GitHub] Triggering INSTANT workflow for ${owner}/${repo}...`);
    const res = await axios.post(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/instant-mission.yml/dispatches`,
      { ref: 'main' },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    console.log('[GitHub] Instant Workflow trigger sent successfully.');
    return { success: true };
  } catch (err) {
    console.error('[GitHub] Failed to trigger instant workflow:', err.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

async function triggerInstantEngagement() {
  const token = process.env.GITHUB_TOKEN;
  const repo = 'pinterest-autopost';
  const owner = 'nullpointer10101-gif';

  if (!token) {
    console.warn('[GitHub] No GITHUB_TOKEN configured. Instant engagement skipped.');
    return { success: false, error: 'GITHUB_TOKEN missing' };
  }

  try {
    console.log(`[GitHub] Triggering INSTANT ENGAGEMENT for ${owner}/${repo}...`);
    const res = await axios.post(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/instant-engagement.yml/dispatches`,
      { ref: 'main' },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    console.log('[GitHub] Instant Engagement trigger sent successfully.');
    return { success: true };
  } catch (err) {
    console.error('[GitHub] Failed to trigger instant engagement:', err.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { triggerAutomation, triggerInstantMission, triggerInstantEngagement };

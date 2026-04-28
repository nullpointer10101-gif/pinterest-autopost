const axios = require('axios');

const REPO = 'pinterest-autopost';
const OWNER = 'nullpointer10101-gif';

function getHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function dispatchWorkflow(workflowFile, label) {
  const headers = getHeaders();
  if (!headers) {
    console.warn(`[GitHub] No GITHUB_TOKEN configured. ${label} skipped.`);
    return { success: false, error: 'GITHUB_TOKEN missing' };
  }

  try {
    console.log(`[GitHub] 🚀 Triggering ${label} (${workflowFile})...`);
    await axios.post(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${workflowFile}/dispatches`,
      { ref: 'main' },
      { headers }
    );
    console.log(`[GitHub] ✅ ${label} triggered successfully.`);
    return { success: true };
  } catch (err) {
    console.error(`[GitHub] ❌ Failed to trigger ${label}:`, err.response?.data || err.message);
    return { success: false, error: err.message };
  }
}

// 🚀 NEW: Dedicated fast-post workflow — no automation overhead
async function triggerFirePost() {
  return dispatchWorkflow('fire-post.yml', 'Fire Post');
}

// Legacy: Full hourly automation (posts + engagement)
async function triggerAutomation() {
  return dispatchWorkflow('hourly-automation.yml', 'Hourly Automation');
}

// Legacy: Old instant mission (runs full automation with 1 post limit)
async function triggerInstantMission() {
  // Now points to the new fire-post workflow for speed
  return dispatchWorkflow('fire-post.yml', 'Instant Mission → Fire Post');
}

async function triggerInstantEngagement() {
  return dispatchWorkflow('instant-engagement.yml', 'Instant Engagement');
}

module.exports = { triggerFirePost, triggerAutomation, triggerInstantMission, triggerInstantEngagement };

const axios = require('axios');

const REPO = 'pinterest-autopost';
const OWNER = 'nullpointer10101-gif';

function getHeaders() {
  // Use GH_PAT_TOKEN if available, otherwise fallback to GITHUB_TOKEN
  const token = process.env.GH_PAT_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function dispatchWorkflow(workflowFile, label, inputs = {}) {
  const headers = getHeaders();
  if (!headers) {
    console.warn(`[GitHub] No GITHUB_TOKEN configured. ${label} skipped.`);
    return { success: false, error: 'GITHUB_TOKEN missing' };
  }

  try {
    console.log(`[GitHub] 🚀 Triggering ${label} (${workflowFile})...`);
    console.log(`[GitHub] Inputs:`, JSON.stringify(inputs, null, 2));
    
    const body = { ref: 'main' };
    if (Object.keys(inputs).length > 0) {
      body.inputs = inputs;
    }
    
    const response = await axios.post(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${workflowFile}/dispatches`,
      body,
      { headers }
    );
    
    console.log(`[GitHub] ✅ ${label} response: ${response.status} ${response.statusText}`);
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

async function triggerInstantEngagement(count = 3, niche = 'all') {
  return dispatchWorkflow('instant-engagement.yml', 'Instant Engagement', { 
    count: String(count), 
    niche: String(niche) 
  });
}

// X Automation Triggers
async function triggerXFirePost() {
  return dispatchWorkflow('x-fire-post.yml', 'X Fire Post');
}

async function triggerXAutomation() {
  return dispatchWorkflow('x-hourly-automation.yml', 'X Hourly Automation');
}

async function triggerXInstantEngagement(count = 3) {
  return dispatchWorkflow('x-instant-engagement.yml', 'X Instant Engagement', { count: String(count) });
}

module.exports = { 
  triggerFirePost, 
  triggerAutomation, 
  triggerInstantMission, 
  triggerInstantEngagement,
  triggerXFirePost,
  triggerXAutomation,
  triggerXInstantEngagement
};

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

// Dedicated fast-post workflow with no hourly automation overhead.
async function triggerFirePost() {
  return dispatchWorkflow('fire-post.yml', 'Fire Post');
}

// Full hourly automation (queue + engagement).
async function triggerAutomation() {
  return dispatchWorkflow('hourly-automation.yml', 'Hourly Automation');
}

// Compatibility alias for older callers. This now dispatches FirePost directly.
async function triggerInstantMission() {
  return dispatchWorkflow('fire-post.yml', 'Instant Mission → Fire Post');
}

async function triggerInstantEngagement(options = {}) {
  const likeTarget = Math.max(1, Number.parseInt(options.likeTarget ?? options.likesTarget ?? '5', 10) || 5);
  const commentTarget = Math.max(0, Number.parseInt(options.commentTarget ?? options.commentsTarget ?? '3', 10) || 3);
  const niche = String(options.niche || 'mens_outfits').trim() || 'mens_outfits';

  return dispatchWorkflow('instant-engagement.yml', 'Instant Engagement', {
    like_target: String(likeTarget),
    comment_target: String(commentTarget),
    niche: niche,
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

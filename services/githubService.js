const axios = require('axios');

const REPO = 'pinterest-autopost';
const OWNER = 'nullpointer10101-gif';

function getHeaders() {
  // Keep token support aligned across every GitHub workflow dispatcher.
  const token = process.env.GH_PAT_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function resolveRepo() {
  const fromEnv = String(process.env.GITHUB_REPOSITORY || '').trim();
  if (fromEnv.includes('/')) {
    const [owner, repo] = fromEnv.split('/');
    if (owner && repo) return { owner, repo };
  }

  return {
    owner: process.env.GH_REPO_OWNER || OWNER,
    repo: process.env.GH_REPO_NAME || REPO,
  };
}

function resolveRef() {
  return process.env.GH_REPO_REF || process.env.VERCEL_GIT_COMMIT_REF || 'main';
}

async function dispatchWorkflow(workflowFile, label, inputs = {}) {
  const headers = getHeaders();
  if (!headers) {
    console.warn(`[GitHub] No GitHub token configured. ${label} skipped.`);
    return { success: false, error: 'GitHub token missing' };
  }

  try {
    console.log(`[GitHub] 🚀 Triggering ${label} (${workflowFile})...`);
    console.log(`[GitHub] Inputs:`, JSON.stringify(inputs, null, 2));
    
    const { owner, repo } = resolveRepo();
    const body = { ref: resolveRef() };
    if (Object.keys(inputs).length > 0) {
      body.inputs = inputs;
    }
    
    const response = await axios.post(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`,
      body,
      { headers, timeout: 20000 }
    );
    
    console.log(`[GitHub] ✅ ${label} response: ${response.status} ${response.statusText}`);
    return { success: true };
  } catch (err) {
    console.error(`[GitHub] ❌ Failed to trigger ${label}:`, err.response?.data || err.message);
    return { success: false, error: err.response?.data?.message || err.message };
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

module.exports = { 
  triggerFirePost, 
  triggerAutomation, 
  triggerInstantMission, 
  triggerInstantEngagement
};

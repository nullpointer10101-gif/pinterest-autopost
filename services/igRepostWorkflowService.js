const axios = require('axios');

function getHeaders() {
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
    owner: process.env.GH_REPO_OWNER || 'nullpointer10101-gif',
    repo: process.env.GH_REPO_NAME || 'pinterest-autopost',
  };
}

async function dispatchWorkflow(inputs = {}) {
  const headers = getHeaders();
  if (!headers) {
    return { success: false, error: 'GitHub token missing' };
  }

  const { owner, repo } = resolveRepo();
  const body = {
    ref: process.env.GH_REPO_REF || 'main',
    inputs,
  };

  try {
    await axios.post(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/ig-repost-pipeline.yml/dispatches`,
      body,
      { headers, timeout: 20000 }
    );
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err.response?.data?.message || err.message,
    };
  }
}

async function triggerValidation(username) {
  return dispatchWorkflow({
    mode: 'validate',
    username: String(username || '').trim(),
    reason: 'new_account_validation',
  });
}

async function triggerScheduledScan() {
  return dispatchWorkflow({
    mode: 'scan',
    reason: 'manual_dispatch',
  });
}

async function triggerQueueOnly() {
  return dispatchWorkflow({
    mode: 'process-queue',
    reason: 'manual_queue_process',
  });
}

async function triggerAvatarSync(username = '') {
  return dispatchWorkflow({
    mode: 'sync-avatars',
    username: String(username || '').trim(),
    reason: 'avatar_sync',
  });
}

module.exports = {
  triggerValidation,
  triggerScheduledScan,
  triggerQueueOnly,
  triggerAvatarSync,
};

const axios = require('axios');
const historyService = require('./historyService');

// Read config dynamically so token refreshes take effect immediately
async function getToken() {
  const tokens = await historyService.getTokens();
  return tokens?.access_token || process.env.PINTEREST_ACCESS_TOKEN;
}

function isSandbox() {
  return process.env.PINTEREST_SANDBOX === 'true';
}

function getBaseUrl() {
  return isSandbox()
    ? 'https://api-sandbox.pinterest.com/v5'
    : 'https://api.pinterest.com/v5';
}

// ─── HTTP Client ──────────────────────────────────────────────────────────────
async function pinterestClient() {
  const token = await getToken();
  if (!token) throw new Error('No Pinterest access token configured');
  return axios.create({
    baseURL: getBaseUrl(),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000, // Pinterest video pins can take up to 30s to process
  });
}

// ─── Error Handler ────────────────────────────────────────────────────────────
function handlePinterestError(err) {
  const status = err?.response?.status;
  const msg = err?.response?.data?.message || err.message;
  if (status === 401) throw new Error('Pinterest token invalid or expired. Please reconnect via Settings.');
  if (status === 403) throw new Error('Pinterest permission denied. Ensure pins:write and boards:read scopes are granted.');
  if (status === 429) throw new Error('Pinterest rate limit reached. Please wait a moment and try again.');
  if (status === 400) throw new Error(`Pinterest API error: ${msg}`);
  throw new Error(`Pinterest API error (${status}): ${msg}`);
}

// ─── Mock Data (demo mode) ────────────────────────────────────────────────────
const MOCK_BOARDS = [
  { id: 'demo_board_1', name: 'Travel & Adventure', description: 'Beautiful travel destinations', privacy: 'PUBLIC', isDemoMode: true },
  { id: 'demo_board_2', name: 'Lifestyle Inspiration', description: 'Daily motivation and lifestyle', privacy: 'PUBLIC', isDemoMode: true },
  { id: 'demo_board_3', name: 'Food & Recipes', description: 'Delicious food content', privacy: 'PUBLIC', isDemoMode: true },
  { id: 'demo_board_4', name: 'Fashion & Style', description: 'Trending fashion and outfits', privacy: 'PUBLIC', isDemoMode: true },
];

// ─── Get Account Status ───────────────────────────────────────────────────────
async function getStatus() {
  const token = await getToken();
  const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);

  if (!token) {
    return {
      connected: false,
      username: null,
      profileImage: null,
      isDemoMode: true,
      message: isServerless
        ? 'Vercel Cloud detected. Please click "Connect Pinterest" (OAuth) to enable direct dashboard posting.'
        : 'No PINTEREST_ACCESS_TOKEN set — running in demo mode',
    };
  }

  try {
    const client = await pinterestClient();
    const res = await client.get('/user_account');
    const data = res.data;
    return {
      connected: true,
      username: data.username,
      profileImage: data.profile_image,
      displayName: data.business_name || data.username,
      isDemoMode: false,
    };
  } catch (err) {
    const status = err?.response?.status;
    return {
      connected: false,
      username: null,
      isDemoMode: false,
      message: status === 401
        ? 'Pinterest API Token expired. Please click "Connect Pinterest" again.'
        : `Pinterest API error: ${err.message}`,
    };
  }
}

// ─── Get Boards ───────────────────────────────────────────────────────────────
async function getBoards() {
  const token = await getToken();
  if (!token) {
    console.warn('[Pinterest] No token — returning demo boards');
    return MOCK_BOARDS;
  }

  try {
    const client = await pinterestClient();
    const res = await client.get('/boards', { params: { page_size: 50 } });
    const items = res.data.items || [];
    return items.map(b => ({
      id: b.id,
      name: b.name,
      description: b.description || '',
      privacy: b.privacy || 'PUBLIC',
      pinCount: b.pin_count || 0,
    }));
  } catch (err) {
    handlePinterestError(err);
  }
}

// ─── Create Pin ──────────────────────────────────────────────────────────────
async function createPin({ title, description, altText = '', hashtags = [], mediaUrl, link }) {
  const token = await getToken();
  // Hard-enforce Pinterest character limits (defence-in-depth)
  const safeTitle = String(title || '').substring(0, 100);
  const hashtagString = Array.isArray(hashtags) ? hashtags.join(' ') : '';
  const combined = description ? `${description}\n\n${hashtagString}`.trim() : hashtagString.trim();
  const safeDescription = combined.substring(0, 800);
  const safeAltText = String(altText || '').substring(0, 500);

  if (!token) {
    console.warn('[Pinterest] No token — simulating pin creation (demo mode)');
    return {
      id: `demo_pin_${Date.now()}`,
      url: `https://www.pinterest.com/pin/demo_${Date.now()}/`,
      isDemoMode: true,
    };
  }

  const payload = {
    title: safeTitle,
    description: safeDescription,
    alt_text: safeAltText || undefined,
    media_source: {
      source_type: (mediaUrl || '').toLowerCase().includes('.mp4') ? 'video_url' : 'image_url',
      url: mediaUrl,
    },
    link: link || undefined,
  };

  console.log('[Pinterest] Creating pin payload:', JSON.stringify({ ...payload, media_source: { source_type: payload.media_source.source_type, url: '...' } }));

  try {
    const client = await pinterestClient();
    const res = await client.post('/pins', payload);
    const pin = res.data;
    return {
      id: pin.id,
      url: `https://www.pinterest.com/pin/${pin.id}/`,
      isDemoMode: false,
    };
  } catch (err) {
    handlePinterestError(err);
  }
}

module.exports = { getStatus, getBoards, createPin };

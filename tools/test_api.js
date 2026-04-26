const KEY = process.env.RAPIDAPI_KEY;
const HOST = 'instagram-downloader38.p.rapidapi.com';
const BASE = `https://${HOST}`;
const TEST_URL = 'https://www.instagram.com/p/CxLWFNksXOE/';

const headers = {
  'x-rapidapi-key': KEY,
  'x-rapidapi-host': HOST,
  'Content-Type': 'application/json',
};

const endpoints = [
  '/media', '/fetch', '/get', '/info', '/reel', '/post',
  '/v1/media', '/api/media', '/convert', '/dl', '/download-reel',
  '/instagram', '/getMedia', '/get-media', '/fetch-media',
  '/download'
];

async function test() {
  console.log('Testing all endpoints...\n');
  for (const ep of endpoints) {
    try {
      const r = await axios.get(BASE + ep, {
        params: { url: TEST_URL },
        headers,
        timeout: 8000,
      });
      console.log(`✅ ${ep} → ${JSON.stringify(r.data).substring(0, 150)}`);
    } catch (e) {
      const status = e.response?.status;
      const body = JSON.stringify(e.response?.data || '').substring(0, 80);
      console.log(`❌ ${ep} → ${status} ${body}`);
    }
  }
}

test();

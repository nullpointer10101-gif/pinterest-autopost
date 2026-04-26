const KEY = process.env.RAPIDAPI_KEY;
const HOST = 'instagram-downloader38.p.rapidapi.com';
const TEST_URL = 'https://www.instagram.com/p/CxLWFNksXOE/';

const endpointsToTest = [
  // Method 1: URL in query param
  { path: '/proxy/download', paramType: 'url' },
  { path: '/server_api/download', paramType: 'url' },
  { path: '/api/download', paramType: 'url' },
  { path: '/instagram/download', paramType: 'url' },
  { path: '/get', paramType: 'url' },
  { path: '/', paramType: 'url' },
  { path: '/api/v1/download', paramType: 'url' },
  // Method 2: Shortcode in query param
  { path: '/api/ig/reel', paramType: 'shortcode' },
  { path: '/api/ig/post', paramType: 'shortcode' },
  { path: '/media/info', paramType: 'url' }
];

async function check() {
  const headers = { 'x-rapidapi-key': KEY, 'x-rapidapi-host': HOST };
  console.log('Testing potential endpoints for instagram-downloader38...');

  for (const ep of endpointsToTest) {
    const params = ep.paramType === 'url' ? { url: TEST_URL } : { shortcode: 'CxLWFNksXOE' };
    try {
      const res = await axios.get(`https://${HOST}${ep.path}`, { params, headers, timeout: 5000 });
      console.log(`✅ SUCCESS on ${ep.path}: `, Object.keys(res.data));
      // Break early if we find a working one
      return; 
    } catch (e) {
      if (e.response?.status !== 404) {
         console.log(`❌ ${ep.path} -> ${e.response?.status} : ${JSON.stringify(e.response?.data)}`);
      }
    }
  }
}

check();

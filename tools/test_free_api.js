const axios = require('axios');
const qs = require('qs');

async function testFreeAPIs(url) {
  const apis = [
    // Cobalt API format
    async () => {
      const res = await axios.post('https://api.cobalt.tools/api/json', {
        url: url,
        filenamePattern: 'nerd'
      }, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      return { source: 'cobalt', url: res.data.url };
    },
    // Another public API 
    async () => {
      const res = await axios.post('https://v3.igdownloader.app/api/ajaxSearch', qs.stringify({ q: url, t: 'media', lang: 'en' }), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Accept': '*/* '
        }
      });
      return { source: 'igdownloader', data: res.data };
    }
  ];

  for (const api of apis) {
    try {
      const result = await api();
      console.log(`✅ Success with ${result.source}`);
      return result;
    } catch (e) {
      console.log(`❌ Failed:`, e.message);
    }
  }
}

testFreeAPIs('https://www.instagram.com/p/CxLWFNksXOE/');

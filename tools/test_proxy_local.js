const axios = require('axios');
const fs = require('fs');

async function testProxy() {
  const testUrl = 'https://www.instagram.com/reels/CxLWFNksXOE/'; // Placeholder
  // We need a real video URL from the extractor first.
  // Let's just mock what the app does.
  const proxyUrl = 'http://localhost:3000/api/proxy?url=' + encodeURIComponent('https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=800');
  
  try {
    const res = await axios.get(proxyUrl, { responseType: 'stream' });
    console.log("Status:", res.status);
    console.log("Headers:", res.headers['content-type']);
    res.data.pipe(fs.createWriteStream('test_proxy_output.jpg'));
    console.log("Write started...");
  } catch (e) {
    console.log("Error:", e.message);
  }
}
testProxy();

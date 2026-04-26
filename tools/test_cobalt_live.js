const axios = require('axios');

async function testCobalt(url) {
  try {
    const res = await axios.post('https://api.cobalt.tools/api/json', {
      url: url,
    }, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      }
    });
    console.log("Success:", res.data);
  } catch (err) {
    console.error("Error:", err.response ? err.response.data : err.message);
  }
}

testCobalt('https://www.instagram.com/reel/DWOBjQoCdJN/');

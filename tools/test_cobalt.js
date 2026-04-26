const axios = require('axios');

async function testCobalt() {
  try {
    const res = await axios.post('https://api.cobalt.tools/', {
      url: 'https://www.instagram.com/p/CxLWFNksXOE/'
    }, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    console.log("Cobalt Success:", JSON.stringify(res.data, null, 2));
  } catch(e) {
    if (e.response) {
      console.log("Cobalt Error:", e.response.status, e.response.data);
    } else {
      console.log("Cobalt Error:", e.message);
    }
  }
}

testCobalt();

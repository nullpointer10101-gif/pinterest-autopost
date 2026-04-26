const axios = require('axios');
async function test() {
  try {
    const res = await axios.get('https://api.microlink.io/?url=https://www.instagram.com/reels/CxLWFNksXOE/&video=true');
    console.log("Video URL:", res.data.data.video?.url);
    console.log("Image URL:", res.data.data.image?.url);
  } catch (e) {
    console.log("Error:", e.message);
  }
}
test();

const fetch = require('node-fetch');

async function testHTML() {
  try {
    const res = await fetch('https://www.instagram.com/p/CxLWFNksXOE/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const html = await res.text();
    
    // Check for og:title or description
    const titleMatch = html.match(/<meta property="og:title" content="(.*?)"/);
    const descMatch = html.match(/<meta property="og:description" content="(.*?)"/);
    const imageMatch = html.match(/<meta property="og:image" content="(.*?)"/);
    
    console.log("Title:", titleMatch ? titleMatch[1] : "Not found");
    console.log("Desc:", descMatch ? descMatch[1] : "Not found");
    console.log("Image:", imageMatch ? imageMatch[1] : "Not found");
    
  } catch(e) {
    console.error(e);
  }
}

testHTML();

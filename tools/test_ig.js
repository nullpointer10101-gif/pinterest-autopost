const ig = require('instagram-url-direct');

async function test() {
  try {
    const res = await ig.igdl('https://www.instagram.com/p/CxLWFNksXOE/');
    console.log("Success:", JSON.stringify(res, null, 2));
  } catch (e) {
    console.log("Error:", e.message);
  }
}
test();

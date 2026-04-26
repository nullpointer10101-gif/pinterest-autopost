const axios = require('axios');
axios.get('https://api.microlink.io/?url=https://www.instagram.com/p/CxLWFNksXOE/&video=true').then(r => console.log(JSON.stringify(r.data, null, 2))).catch(e => console.log(e.message));

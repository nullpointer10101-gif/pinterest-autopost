const axios = require('axios');
axios.get('https://api.microlink.io/?url=https://www.instagram.com/p/CxLWFNksXOE/').then(r => console.log(r.data)).catch(e => console.log(e.message));

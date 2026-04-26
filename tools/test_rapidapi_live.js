const axios = require('axios');
require('dotenv').config();

const url = 'https://www.instagram.com/reel/DWOBjQoCdJN/';
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

async function testRapidAPI() {
  const services = [
    { host: 'instagram-downloader-download-instagram-stories-videos4.p.rapidapi.com', endpoint: 'https://instagram-downloader-download-instagram-stories-videos4.p.rapidapi.com/convert', paramMap: u => ({ url: u }) },
    { host: 'instagram-extractor.p.rapidapi.com', endpoint: 'https://instagram-extractor.p.rapidapi.com/api/v1/ig/post', paramMap: u => ({ url: u }) },
  ];

  for (const svc of services) {
    try {
      console.log(`Testing ${svc.host}...`);
      const res = await axios.get(svc.endpoint, {
        params: svc.paramMap(url),
        headers: { 'x-rapidapi-key': RAPIDAPI_KEY, 'x-rapidapi-host': svc.host },
        timeout: 10000,
      });
      console.log(`Success ${svc.host}:`, res.data);
    } catch (e) {
      console.log(`Failed ${svc.host}:`, e.response ? e.response.data : e.message);
    }
  }
}

testRapidAPI();

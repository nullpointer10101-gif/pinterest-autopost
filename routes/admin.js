const express = require('express');
const router = express.Router();
const leadStorageService = require('../services/leadStorageService');

// Admin dashboard to view leads
router.get('/leads', async (req, res) => {
  const leads = await leadStorageService.getLeads();
  
  // Sort leads newest first
  leads.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const rows = leads.map(lead => `
    <tr>
      <td>${new Date(lead.timestamp).toLocaleString()}</td>
      <td><strong>${lead.email}</strong></td>
      <td><a href="/bridge/${lead.pinId}" target="_blank">${lead.pinId}</a></td>
      <td><a href="${lead.targetUrl}" target="_blank">Target Link</a></td>
    </tr>
  `).join('');

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Admin - Leads Dashboard</title>
      <style>
        body {
          font-family: 'Inter', -apple-system, sans-serif;
          background: #f4f7f6;
          color: #333;
          padding: 40px;
        }
        .container {
          max-width: 1000px;
          margin: 0 auto;
          background: #fff;
          padding: 30px;
          border-radius: 12px;
          box-shadow: 0 4px 15px rgba(0,0,0,0.05);
        }
        h1 { margin-top: 0; }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 20px;
        }
        th, td {
          padding: 12px 15px;
          text-align: left;
          border-bottom: 1px solid #ddd;
        }
        th {
          background: #f9fafb;
          font-weight: 600;
          color: #555;
        }
        tr:hover { background: #fdfdfd; }
        a { color: #2563eb; text-decoration: none; }
        a:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Captured Email Leads</h1>
        <p>Total Leads: <strong>${leads.length}</strong></p>
        <table>
          <thead>
            <tr>
              <th>Date Captured</th>
              <th>Email Address</th>
              <th>Source Pin ID</th>
              <th>Target URL</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="4">No leads captured yet.</td></tr>'}
          </tbody>
        </table>
      </div>
    </body>
    </html>
  `;
  
  res.send(html);
});

module.exports = router;

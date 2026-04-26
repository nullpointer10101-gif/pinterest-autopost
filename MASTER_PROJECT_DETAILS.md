# 🚀 Pinterest Autopost — Master Project Details

This file contains all the critical information for your 24/7 Pinterest Automation project. **Keep this file safe and do not share it.**

---

## 🌐 1. Hosting & Repository
- **GitHub Repository**: [https://github.com/nullpointer10101-gif/pinterest-autopost](https://github.com/nullpointer10101-gif/pinterest-autopost)
- **Vercel Dashboard**: (Check your Vercel account for the live URL)
- **Automation Status**: Active (Runs every hour via GitHub Actions)

---

## 🔑 2. API Keys & Secrets
These values must be set in **both** GitHub Secrets and Vercel Environment Variables:

| Secret Name | Purpose / Source |
| :--- | :--- |
| **AI_API_KEY** | Your Gemini or OpenAI key from Google AI Studio / OpenAI. |
| **AI_BASE_URL** | (Optional) Custom endpoint if using a proxy or different provider. |
| **AI_MODEL** | The model name (e.g., `gemini-1.5-flash`). |
| **RAPIDAPI_KEY** | Your key from RapidAPI (for Instagram data extraction). |
| **PINTEREST_APP_ID** | Your Pinterest Developer App ID. |
| **PINTEREST_SESSION_COOKIE** | Your `_pinterest_sess` cookie value for bot mode. |
| **PINTEREST_ACCESS_TOKEN** | Your OAuth access token for API mode. |

### Database (Upstash Redis)
This project uses Upstash Redis for serverless state persistence.
- **REST URL**: `https://...upstash.io`
- **REST TOKEN**: `[REDACTED]`

---

## 🛠️ 4. Maintenance & Monitoring
1. **To see the bot working**: Go to your GitHub Repo -> **Actions** tab. You can see the "Hourly Automation" logs there.
2. **To add new posts**: Use your Vercel URL. Paste a Reel URL, generate content, and "Add to Queue".
3. **If posting fails**: Check your Pinterest Session Cookie. They sometimes expire after a few weeks. If the dashboard says "Demo Mode", you need to update the cookie.

---

**Project setup complete by Antigravity AI.**

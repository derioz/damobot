# Git Upload & Cloudflare Worker Deployment Protocol

This rule applies at the completion of ANY coding task, feature refactor, bug fix, or completed set of changes in DamoBot.

---

## 1. Mandatory End-of-Task Questions

Whenever you finish a coding task or set of changes, you MUST ALWAYS explicitly ask the user:
1. **"Would you like to upload these changes to Git / GitHub?"**
2. **"Would you like to deploy/update the live Cloudflare Worker?"**

Do not skip asking these two questions.

---

## 2. Standard Terminal Commands

Always provide the copy-pasteable commands formatted in clean code blocks:

### Upload to Git / GitHub
Repository: `https://github.com/derioz/damobot`
```powershell
git add .
git commit -m "release: <concise summary of changes>"
git push -u origin main
```

### Update Cloudflare Worker Live
```powershell
npm run deploy:live
```
Explain briefly that `npm run deploy:live` will automatically:
1. Increment the version number in `src/config.js` (`DAMO_BOT_VERSION`).
2. Run the full test suite (`npm test`) to guarantee 100% pass rate.
3. Deploy the updated worker live to Cloudflare (`npx wrangler deploy`).

### Full Combined Pipeline (Deploy & Push)
```powershell
npm run deploy:live
git add .
git commit -m "release: update worker and sync repository"
git push origin main
```

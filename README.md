# Relay — AI triage copilot (clickable prototype)

Zero-dependency static prototype: vanilla HTML/CSS/JS, synthetic data, no build step.
This folder is a deploy-ready site root.

## Publish on GitHub Pages (5 min)

1. [github.com/new](https://github.com/new) → create a **public** repo named `relay-prototype` (no README/.gitignore).
2. Push this folder:
   ```bash
   cd relay-prototype
   git init && git add -A && git commit -m "Relay prototype"
   git branch -M main
   git remote add origin https://github.com/<your-username>/relay-prototype.git
   git push -u origin main
   ```
   (No git? In the repo page click **uploading an existing file** and drag the whole folder in.)
3. Repo → **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main` / `/ (root)` → Save.
4. Live in ~1 min at: **https://\<your-username\>.github.io/relay-prototype/**

`.nojekyll` is included so Pages serves the files as-is.

## Or: Netlify Drop (no account setup, 30 sec)

Zip this folder (or drag the folder itself) onto [app.netlify.com/drop](https://app.netlify.com/drop) → instant URL.

## After deploying

Add the URL to the Medium case study (meta block + conclusion) and to
`relay/CASE-STUDY.md`, e.g. “Hosted clickable prototype: <url>”.

## Contents

- `index.html` — the app shell (queue · drawer · audit · insights · policies · case-study view)
- `css/styles.css` — design tokens + components (light & dark themes)
- `js/data.js` — synthetic ticket dataset & gate logic
- `js/app.js` — interactions
- `js/casestudy.js` — in-app case-study section

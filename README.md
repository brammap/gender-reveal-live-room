# Gender Reveal Live Room

Local and deploy-ready live room for a gender reveal with:

- host camera on/off
- guest join links
- countdown reveal
- confetti and celebratory sound
- recording download

## Local run

```powershell
npm start
```

Then open:

```text
http://localhost:3000/?room=test1
```

Guest link:

```text
http://localhost:3000/?room=test1&guest=1
```

## Deploy on Render

This is the recommended public hosting option.

### 1. Put the code on GitHub

Create a GitHub repo and push this project to it.

### 2. Create a Render service

In Render, choose **New Web Service** and connect the repo.

Or use the included `render.yaml` blueprint.

### 3. Use these settings

- Build command: `npm install`
- Start command: `npm start`
- Environment: Node

### 4. Deploy

Render will give you a public HTTPS URL like:

```text
https://your-app.onrender.com
```

Use these links:

- Host: `https://your-app.onrender.com/?room=test1`
- Guest: `https://your-app.onrender.com/?room=test1&guest=1`

## Requirements

This app needs a Node host that supports:

- long-lived HTTP connections for server-sent events
- HTTPS in production

## Notes

- `file://` will not work for camera access.
- Guests can join from another browser, another tab, or another device once deployed.

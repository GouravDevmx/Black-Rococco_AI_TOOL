# Black Rococo - Free Deployment Guide

This project is ready for Node.js hosting such as Render, Railway, Koyeb, or a small VPS.

## Recommended for quick public testing: Render

1. Create a GitHub repository, for example `black-rococo-functional-site`.
2. Upload all files from this folder to that repository.
3. Go to Render Dashboard > New > Web Service.
4. Connect your GitHub repository.
5. Use these settings:
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Health Check Path: `/api/health`
6. Add environment variables:
   - `ADMIN_EMAIL` = your admin email
   - `ADMIN_PASSWORD` = a strong password
   - `NODE_ENV` = `production`
7. Deploy and share the Render URL with your friend.

## Railway option

This project includes `railway.json`. Railway can detect the Node.js app and run `npm start`.

CLI flow:

```powershell
npm.cmd install -g @railway/cli
railway login
cd "$env:USERPROFILE\Downloads\black_rococo_functional_site"
railway init
railway up
```

In Railway dashboard, generate a public domain for the service and share that URL.

## Important limitation for demo hosting

This MVP stores bookings in `data/db.json` and uploaded images in `public/uploads`. On free/demo cloud hosting, local file storage can be temporary. It is okay for testing, but for real launch use Supabase/Postgres for appointments and Supabase Storage or Cloudinary for image uploads.

## Local check before deploying

```powershell
cd "$env:USERPROFILE\Downloads\black_rococo_functional_site"
npm.cmd install
npm.cmd start
```

Open: `http://localhost:3000`

Health check: `http://localhost:3000/api/health`

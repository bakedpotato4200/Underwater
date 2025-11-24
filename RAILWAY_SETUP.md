# Railway Deployment - Data Persistence Fix

## Problem
Railway uses ephemeral containers - local data in `/data/` is lost on redeploy.

## Solution
Your local data is safe! Here's how to restore it on Railway:

### Step 1: Add Volume to Railway
1. Go to your Railway project dashboard
2. Go to your "Underwater" service
3. Click **Settings** → **Data** 
4. Add a new Volume:
   - **Mount Path:** `/app/data`
   - This creates persistent storage

### Step 2: Redeploy
After adding the volume, Railway will redeploy. Push code to trigger it:
```bash
git add .
git commit -m "Add Railway data persistence setup"
git push
```

### Step 3: Manually Restore Data (First Time Only)
Since we can't auto-sync files to Railway, you have two options:

**Option A: Re-import your transactions**
- Log in as demo@example.com / demo
- Go to Dashboard
- Upload your Capital One PDFs again
- The app will categorize them with AI

**Option B: Contact support**
- Send the demo_user data folder to the dev team
- They'll initialize it on your Railway database

## Why This Happens
- **Replit:** Uses persistent local storage ✅
- **Railway (ephemeral):** Fresh container each deploy ❌
- **Railway (with volume):** Persistent storage like Replit ✅

## Going Forward
With the volume added, all your data will persist between deployments!


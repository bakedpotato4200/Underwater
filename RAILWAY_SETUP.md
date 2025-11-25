# Railway Deployment - MongoDB Configuration

## ✅ MongoDB Migration Complete
Your app now uses MongoDB Atlas for all data persistence. **NO local volumes needed on Railway!**

## Critical: Environment Variables on Railway

### Backend (Node.js) - MUST SET THESE:

1. **MONGO_URI** (Required - or the backend will crash)
   - Your MongoDB connection string
   - Format: `mongodb+srv://username:password@cluster.mongodb.net/database?appName=...`
   - Get this from MongoDB Atlas → Connect → Connection String

2. **PORT** (Optional)
   - Defaults to 3000

### Frontend (Vercel)
- Frontend automatically detects production and uses Railway backend URL

## How to Fix Production Right Now:

### Step 1: Set MONGO_URI on Railway
1. Go to Railway dashboard → Backend service
2. Click **Variables**
3. Add: `MONGO_URI` = your MongoDB connection string
4. Click Deploy → New Deployment

### Step 2: Verify Backend Health
- Open Railway service logs to see if backend starts
- Look for: "✅ MongoDB Connected"

### Step 3: Test Production
1. Visit your Vercel frontend
2. Login: `demo@example.com / demo`
3. Dashboard should load with data

## Troubleshooting

**"Connection refused" errors?**
- ❌ MONGO_URI not set on Railway
- ✅ Set it in Railway Variables and redeploy

**"Invalid token" on login?**
- JWT_SECRET hardcoded (same in dev and prod) - this is OK for now

**Data missing after deploy?**
- Check MongoDB Atlas - all data lives there, not in Railway
- Run a query in MongoDB Atlas to verify collections exist
- **Railway (with volume):** Persistent storage like Replit ✅

## Going Forward
With the volume added, all your data will persist between deployments!


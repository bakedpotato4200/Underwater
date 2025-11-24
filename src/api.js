import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import pdfParse from 'pdf-parse';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const app = express();
const JWT_SECRET = 'underwater-secret-key-change-in-production';

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 })
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.error('❌ MongoDB Error:', err.message));

// === MONGOOSE SCHEMAS ===
const UserSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true, lowercase: true },
  hashedPassword: { type: String, required: true },
  userId: { type: String, unique: true, required: true },
  createdAt: { type: Date, default: Date.now },
  migrated: { type: Boolean, default: false }
});

const TransactionSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  id: { type: Number, required: true },
  date: { type: String, required: true },
  amount: { type: Number, required: true },
  category: { type: String, default: 'Other' },
  description: { type: String, required: true },
  type: { type: String, enum: ['income', 'expense'], required: true },
  excluded: { type: Boolean, default: false },
  note: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

const RecurringBillSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  id: { type: String, required: true },
  name: { type: String, required: true },
  amount: { type: Number, required: true },
  frequency: { type: Number, required: true },
  startDate: { type: String, required: true },
  type: { type: String, enum: ['income', 'expense'], default: 'expense' },
  createdAt: { type: Date, default: Date.now }
});

const DebtSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  id: { type: String, required: true },
  creditor: { type: String, required: true },
  balance: { type: Number, required: true },
  minPayment: { type: Number, required: true },
  interestRate: { type: Number, default: 0 },
  dueDate: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

const GoalSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  id: { type: String, required: true },
  name: { type: String, required: true },
  targetAmount: { type: Number, required: true },
  currentAmount: { type: Number, default: 0 },
  dueDate: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

const ExclusionRuleSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  type: { type: String, enum: ['merchant', 'category'], required: true },
  pattern: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const LearnedPatternSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true, unique: true },
  merchants: { type: mongoose.Schema.Types.Mixed, default: {} },
  exclusions: { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedAt: { type: Date, default: Date.now }
});

const SettingsSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true, unique: true },
  theme: { type: String, default: 'light' },
  paycheckAmount: { type: Number, default: 0 },
  paycheckFrequencyDays: { type: Number, default: 14 },
  startingBalance: { type: Number, default: 0 },
  startingBalanceDate: { type: String, default: '' },
  bankBalance: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now }
});

// Create models
const User = mongoose.model('User', UserSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);
const RecurringBill = mongoose.model('RecurringBill', RecurringBillSchema);
const Debt = mongoose.model('Debt', DebtSchema);
const Goal = mongoose.model('Goal', GoalSchema);
const ExclusionRule = mongoose.model('ExclusionRule', ExclusionRuleSchema);
const LearnedPattern = mongoose.model('LearnedPattern', LearnedPatternSchema);
const Settings = mongoose.model('Settings', SettingsSchema);

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Auth middleware
function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.use(express.static(path.join(__dirname, '..')));

// Setup uploads
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

// === BUSINESS LOGIC FUNCTIONS ===
function categorizeTransaction(description) {
  const desc = description.toLowerCase();
  if (desc.match(/transfer|from account|to account|xfer|move|deposit to|acct|internal|between accounts/i)) return 'Transfer';
  if (desc.match(/starbucks|coffee|cafe|restaurant|food|dining|uber eats|doordash|grubhub|pizza|burger|taco|harps|inola|sinclair/)) return 'Food & Dining';
  if (desc.match(/whole foods|safeway|kroger|trader joe|grocery|costco|walmart|supercenter|wm super/)) return 'Groceries';
  if (desc.match(/electric|gas|water|internet|phone|utility|comcast|verizon|at&t|harley|davidson|car payment|motorcycle|wells fargo|chase|capital one|amex|discover|autopay|crcardpmt|crunch|fit|payment/)) return 'Utilities';
  if (desc.match(/netflix|hulu|spotify|disney|prime|subscription|gym|apple|xbox/)) return 'Entertainment';
  if (desc.match(/shell|chevron|exxon|bp|gas|fuel|parking|metro|transit|lyft|qt|murphy|carwash|armstrong|bank/)) return 'Transportation';
  if (desc.match(/amazon|target|mall|clothing|shoes|fashion|best buy|store|walgreens|dollar general|staxx/)) return 'Shopping';
  if (desc.match(/doctor|hospital|pharmacy|health|cvs|walgreens|medical|ctlp|foto/)) return 'Health & Fitness';
  if (desc.match(/salary|paycheck|deposit|income|bonus|interest|cash app/)) return 'Income';
  return 'Other';
}

function detectRecurring(userTransactions = []) {
  const merchants = {};
  userTransactions.forEach(t => {
    const merchant = t.description.split(' ')[0];
    if (!merchants[merchant]) merchants[merchant] = [];
    merchants[merchant].push(t);
  });
  return Object.entries(merchants).filter(([m, txns]) => txns.length >= 2).map(([m, txns]) => {
    const sorted = txns.sort((a, b) => new Date(a.date) - new Date(b.date));
    const intervals = [];
    for (let i = 1; i < sorted.length; i++) {
      const d1 = new Date(sorted[i].date);
      const d2 = new Date(sorted[i-1].date);
      intervals.push(Math.round((d1 - d2) / (1000 * 60 * 60 * 24)));
    }
    const avgInterval = intervals.length > 0 ? Math.round(intervals.reduce((a, b) => a + b) / intervals.length) : 30;
    const nextDue = new Date(sorted[sorted.length - 1].date);
    nextDue.setDate(nextDue.getDate() + avgInterval);
    return {
      merchant: m,
      count: txns.length,
      avgAmount: Math.abs(txns.reduce((s, t) => s + t.amount, 0) / txns.length),
      isRecurring: intervals.length > 0,
      nextDueDate: nextDue.toISOString().split('T')[0],
      avgInterval
    };
  });
}

function generateBillCalendar(months = 3, userTransactions = [], userBills = []) {
  const calendar = {};
  const today = new Date();
  const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
  const endDate = new Date(today.getFullYear(), today.getMonth() + months, 0);
  
  if (Array.isArray(userBills)) {
    userBills.forEach(bill => {
      const startDateBill = new Date(bill.startDate);
      let checkDate = new Date(startDateBill);
      
      while (checkDate <= endDate) {
        if (checkDate >= startDate) {
          const dateKey = checkDate.toISOString().split('T')[0];
          if (!calendar[dateKey]) calendar[dateKey] = [];
          calendar[dateKey].push({
            merchant: bill.name,
            amount: bill.type === 'income' ? Math.abs(bill.amount) : bill.amount,
            type: bill.type || 'expense',
            daysUntilDue: Math.ceil((checkDate - today) / (1000 * 60 * 60 * 24)),
            frequency: bill.frequency
          });
        }
        checkDate.setDate(checkDate.getDate() + bill.frequency);
      }
    });
  }
  
  return Object.entries(calendar).filter(([_, bills]) => bills.length > 0).reduce((acc, [date, bills]) => {
    acc[date] = bills;
    return acc;
  }, {});
}

function calculateCashFlow(months = 6, userTransactions = []) {
  const projection = {};
  const today = new Date();
  const recurring = detectRecurring(userTransactions).filter(r => r.isRecurring);
  const totalIncome = userTransactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const avgDailyExpense = userTransactions.filter(t => t.type === 'expense').length > 0 
    ? userTransactions.filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0) / Math.max(userTransactions.filter(t => t.type === 'expense').length, 1)
    : 0;

  for (let m = 0; m < months; m++) {
    const month = new Date(today.getFullYear(), today.getMonth() + m, 1).toISOString().slice(0, 7);
    let balance = totalIncome;
    let billsThisMonth = 0;

    recurring.forEach(bill => {
      const monthBills = Math.floor(30 / bill.avgInterval);
      balance -= bill.avgAmount * monthBills;
      billsThisMonth += bill.avgAmount * monthBills;
    });

    balance -= avgDailyExpense * 30;
    projection[month] = { balance, billsThisMonth, expenses: avgDailyExpense * 30, income: totalIncome };
  }

  return projection;
}

function calculateSpendingVelocity(userTransactions = []) {
  if (userTransactions.length === 0) return { daily: 0, weekly: 0, monthly: 0, trend: 'stable' };
  
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  
  const last30 = userTransactions.filter(t => new Date(t.date) >= thirtyDaysAgo && t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0);
  const prev30 = userTransactions.filter(t => new Date(t.date) >= sixtyDaysAgo && new Date(t.date) < thirtyDaysAgo && t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0);
  
  const trend = last30 > prev30 ? 'increasing' : last30 < prev30 ? 'decreasing' : 'stable';
  const trendPercent = prev30 > 0 ? Math.round(((last30 - prev30) / prev30) * 100) : 0;
  
  return {
    daily: (last30 / 30).toFixed(2),
    weekly: (last30 / 4.29).toFixed(2),
    monthly: last30.toFixed(2),
    trend,
    trendPercent
  };
}

function detectAnomalies(userTransactions = []) {
  if (userTransactions.length < 10) return [];
  const expenses = userTransactions.filter(t => t.type === 'expense');
  const amounts = expenses.map(t => Math.abs(t.amount)).sort((a, b) => a - b);
  const q1 = amounts[Math.floor(amounts.length * 0.25)];
  const q3 = amounts[Math.floor(amounts.length * 0.75)];
  const iqr = q3 - q1;
  const upper = q3 + 1.5 * iqr;
  return expenses.filter(t => Math.abs(t.amount) > upper);
}

function generateAlerts(userTransactions = [], userBills = [], userDebts = []) {
  const alerts = [];
  const recurring = detectRecurring(userTransactions).filter(r => r.isRecurring);
  const velocity = calculateSpendingVelocity(userTransactions);
  const totalIncome = userTransactions.filter(t => t.type === 'income' && !t.excluded).reduce((s, t) => s + t.amount, 0);
  const totalExpense = userTransactions.filter(t => t.type === 'expense' && !t.excluded).reduce((s, t) => s + Math.abs(t.amount), 0);
  const anomalies = detectAnomalies(userTransactions);

  if (anomalies.length > 0) {
    const anomaly = anomalies[0];
    alerts.push({ type: 'warning', title: 'Unusual Transaction', message: `${anomaly.description} ($${Math.abs(anomaly.amount).toFixed(2)}) seems unusual for ${anomaly.category}` });
  }

  if (velocity.trend === 'increasing' && parseFloat(velocity.trendPercent) > 10) {
    alerts.push({ type: 'warning', title: 'Spending Increasing', message: `Your spending is up ${velocity.trendPercent}% vs last month. Monitor budget!` });
  }

  if (totalExpense > totalIncome * 0.9) {
    alerts.push({ type: 'alert', title: 'High Expense Ratio', message: `You're spending ${(totalExpense / totalIncome * 100).toFixed(0)}% of income. Reduce spending!` });
  }

  const nextBill = recurring.sort((a, b) => new Date(a.nextDueDate) - new Date(b.nextDueDate))[0];
  if (nextBill) {
    const days = Math.ceil((new Date(nextBill.nextDueDate) - new Date()) / (1000 * 60 * 60 * 24));
    if (days <= 7 && days > 0) {
      alerts.push({ type: 'info', title: `${nextBill.merchant} Due Soon`, message: `${nextBill.merchant} ($${nextBill.avgAmount.toFixed(2)}) due in ${days} days` });
    }
  }

  if (recurring.length > 10) {
    const totalRecurring = recurring.reduce((s, r) => s + r.avgAmount, 0) * 12;
    alerts.push({ type: 'info', title: 'High Recurring Costs', message: `You have ${recurring.length} recurring bills costing ~$${totalRecurring.toFixed(0)}/year` });
  }

  if (userDebts.length > 0) {
    const totalDebt = userDebts.reduce((s, d) => s + d.balance, 0);
    if (totalDebt > totalIncome * 3) {
      alerts.push({ type: 'alert', title: 'High Debt Ratio', message: `Your debt (${(totalDebt / totalIncome).toFixed(1)}x income) is very high. Focus on payoff!` });
    }
  }

  return alerts.slice(0, 5);
}

function getSmartRecommendations(userTransactions = []) {
  const recs = [];
  const categories = {};
  
  userTransactions.filter(t => !t.excluded).forEach(t => {
    if (t.category !== 'Transfer' && t.category !== 'Income') {
      categories[t.category] = (categories[t.category] || 0) + Math.abs(t.amount);
    }
  });
  
  const totalIncome = userTransactions.filter(t => t.type === 'income' && !t.excluded).reduce((s, t) => s + t.amount, 0);
  const totalExpense = Object.values(categories).reduce((s, t) => s + t, 0);
  const savingsRate = totalIncome > 0 ? (totalIncome - totalExpense) / totalIncome : 0;
  
  const sorted = Object.entries(categories).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0) {
    const topCat = sorted[0];
    const percent = ((topCat[1] / totalExpense) * 100).toFixed(0);
    const savings = (topCat[1] * 0.15).toFixed(2);
    recs.push({ 
      title: `Optimize ${topCat[0]}`, 
      desc: `${topCat[0]} is ${percent}% of spending ($${topCat[1].toFixed(0)}). Cut 15% and save $${savings} monthly` 
    });
  }
  
  const recurring = detectRecurring(userTransactions).filter(r => r.isRecurring);
  if (recurring.length > 0) {
    const yearlyRecurring = recurring.reduce((s, r) => s + r.avgAmount, 0) * 12;
    const potentialSavings = yearlyRecurring * 0.2;
    recs.push({ 
      title: 'Audit Recurring Bills', 
      desc: `${recurring.length} recurring bills cost $${yearlyRecurring.toFixed(0)}/year. Eliminate 20% could save $${potentialSavings.toFixed(0)}` 
    });
  }
  
  if (savingsRate > 0) {
    const monthlySavings = totalIncome - totalExpense;
    if (monthlySavings > 500) {
      recs.push({ 
        title: '50/30/20 Rule', 
        desc: `Allocate: 50% needs, 30% wants, 20% savings. You save ${(savingsRate*100).toFixed(0)}% – excellent track record` 
      });
    }
  }
  
  return recs.slice(0, 5);
}

function extractTransactions(text) {
  const transactions = [];
  const monthMap = { 'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
                    'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12' };
  
  let id = 1;
  const seen = new Set();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthPattern = months.join('|');
  const regex = new RegExp(`(${monthPattern})\\s+(\\d{1,2})([^]*?)(?=(?:${monthPattern})\\s+\\d{1,2}|$)`, 'g');
  
  let match;
  while ((match = regex.exec(text)) !== null) {
    const monthStr = match[1];
    const dayStr = match[2];
    const month = monthMap[monthStr];
    const day = dayStr.padStart(2, '0');
    const chunk = match[3];
    const amountMatch = chunk.match(/([-+]\s*\$[\d,]+\.?\d{0,2})/);
    if (!amountMatch) continue;
    
    const amountStr = amountMatch[1].trim();
    const amountValue = parseFloat(amountStr.replace(/[\$,\s]/g, ''));
    if (!amountValue || amountValue === 0 || Math.abs(amountValue) > 100000) continue;
    
    const amountIndex = chunk.indexOf(amountStr);
    let description = chunk.substring(0, amountIndex).trim();
    description = description.replace(/\s*(Debit|Credit|Transfer)\s*/gi, ' ').replace(/Opening Balance|Closing Balance|Monthly Interest/gi, '').replace(/Withdrawal for.*was Rejected/gi, '').replace(/\s+/g, ' ').trim();
    if (!description || description.length < 2) continue;
    if (description.match(/^(Opening|Closing|Monthly|DATE|DESCRIPTION|AMOUNT|CATEGORY|Fees|Interest|APY|Total)/i)) continue;
    
    let type = 'expense';
    let finalAmount = Math.abs(amountValue);
    if (amountStr.includes('+')) {
      type = 'income';
    } else {
      type = 'expense';
      finalAmount = -finalAmount;
    }
    
    const date = `2025-${month}-${day}`;
    const category = categorizeTransaction(description);
    const key = `${date}|${finalAmount}|${description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    
    transactions.push({
      id: id++,
      date,
      amount: finalAmount,
      category,
      description: description.substring(0, 100),
      type
    });
  }
  
  console.log(`Extracted ${transactions.length} transactions`);
  return transactions;
}

// === AUTH ENDPOINTS ===
app.post('/api/auth/signup', express.json(), async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = email.replace(/[^a-zA-Z0-9]/g, '_');
    
    const user = new User({
      email: email.toLowerCase(),
      hashedPassword,
      userId,
      createdAt: new Date()
    });
    await user.save();
    
    // Create default settings
    const settings = new Settings({
      userId,
      theme: 'light',
      paycheckAmount: 0,
      paycheckFrequencyDays: 14,
      startingBalance: 0,
      bankBalance: 0
    });
    await settings.save();
    
    // Create learned patterns
    const patterns = new LearnedPattern({
      userId,
      merchants: {},
      exclusions: {}
    });
    await patterns.save();
    
    const token = jwt.sign({ email: email.toLowerCase(), userId }, JWT_SECRET, { expiresIn: '30d' });
    console.log(`✅ New user registered: ${email} (${userId})`);
    res.json({ token, userId, email: email.toLowerCase() });
  } catch (e) {
    console.error('Signup error:', e.message);
    res.status(500).json({ error: 'Signup failed: ' + e.message });
  }
});

app.post('/api/auth/login', express.json(), async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    const match = await bcrypt.compare(password, user.hashedPassword);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    const token = jwt.sign({ email: email.toLowerCase(), userId: user.userId }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, userId: user.userId, email: email.toLowerCase() });
  } catch (e) {
    res.status(500).json({ error: 'Login failed: ' + e.message });
  }
});

app.get('/api/auth/verify', verifyToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// === TRANSACTION ENDPOINTS ===
app.post('/api/upload-statement', verifyToken, upload.single('file'), async (req, res) => {
  try {
    const userId = req.user.userId;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    const pdfBuffer = fs.readFileSync(req.file.path);
    const pdfData = await pdfParse(pdfBuffer);
    const text = pdfData.text;
    const parsedTransactions = extractTransactions(text);
    
    const userTxns = await Transaction.find({ userId });
    const nextId = userTxns.length > 0 ? Math.max(...userTxns.map(t => t.id || 0)) + 1 : 1;
    
    parsedTransactions.forEach((t, idx) => {
      t.id = nextId + idx;
      t.excluded = false;
      t.userId = userId;
    });
    
    const seen = new Set();
    userTxns.forEach(t => {
      seen.add(`${t.date}|${t.amount}|${t.description}`);
    });
    
    const newTransactions = [];
    parsedTransactions.forEach(t => {
      if (t.type === 'income') return;
      const key = `${t.date}|${t.amount}|${t.description}`;
      if (!seen.has(key)) {
        newTransactions.push(t);
        seen.add(key);
      }
    });
    
    if (newTransactions.length > 0) {
      await Transaction.insertMany(newTransactions);
    }
    
    fs.unlink(req.file.path, (err) => { if (err) console.error('Error deleting file:', err); });
    
    const totalTxns = await Transaction.countDocuments({ userId });
    res.json({ success: true, transactions: totalTxns, message: `Loaded ${totalTxns} total transactions (${newTransactions.length} new)` });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed: ' + error.message });
  }
});

app.get('/api/transactions', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const txns = await Transaction.find({ userId }).lean();
    res.json(txns);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/transactions', verifyToken, express.json(), async (req, res) => {
  try {
    const userId = req.user.userId;
    const userTxns = await Transaction.find({ userId });
    const newId = userTxns.length > 0 ? Math.max(...userTxns.map(t => t.id || 0)) + 1 : 1;
    
    const txn = new Transaction({
      userId,
      id: newId,
      ...req.body,
      date: new Date().toISOString().split('T')[0],
      excluded: false
    });
    await txn.save();
    res.json(txn);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/transactions/:id/toggle-exclude', verifyToken, express.json(), async (req, res) => {
  try {
    const userId = req.user.userId;
    const txnId = parseInt(req.params.id);
    
    const txn = await Transaction.findOne({ userId, id: txnId });
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    
    txn.excluded = !txn.excluded;
    await txn.save();
    res.json(txn);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/transactions/:id/note', verifyToken, express.json(), async (req, res) => {
  try {
    const userId = req.user.userId;
    const txnId = parseInt(req.params.id);
    const { note } = req.body;
    
    const txn = await Transaction.findOne({ userId, id: txnId });
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    
    txn.note = note;
    await txn.save();
    res.json(txn);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/transactions/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const txnId = parseInt(req.params.id);
    
    await Transaction.deleteOne({ userId, id: txnId });
    const txns = await Transaction.find({ userId });
    res.json(txns);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/transactions/:id/category', verifyToken, express.json(), async (req, res) => {
  try {
    const userId = req.user.userId;
    const txnId = parseInt(req.params.id);
    const { category } = req.body;
    
    const txn = await Transaction.findOne({ userId, id: txnId });
    if (!txn) return res.status(404).json({ error: 'Transaction not found' });
    
    txn.category = category;
    await txn.save();
    
    // Update learned patterns
    let patterns = await LearnedPattern.findOne({ userId });
    if (!patterns) {
      patterns = new LearnedPattern({ userId, merchants: {}, exclusions: {} });
    }
    patterns.merchants[txn.description] = category;
    await patterns.save();
    
    res.json(txn);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === EXCLUSION RULES ===
app.get('/api/exclusion-rules', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const rules = await ExclusionRule.find({ userId });
    res.json(rules);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/exclusion-rules/:index', verifyToken, express.json(), async (req, res) => {
  try {
    const userId = req.user.userId;
    const ruleId = req.params.index;
    
    await ExclusionRule.deleteOne({ userId, _id: ruleId });
    const rules = await ExclusionRule.find({ userId });
    res.json(rules);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === ANALYTICS ===
app.get('/api/spending-trends', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const txns = await Transaction.find({ userId }).lean();
    
    const trends = {};
    const excludedAmounts = {};
    const months = {};
    
    txns.forEach(t => {
      const monthKey = t.date.substring(0, 7);
      if (t.excluded) {
        excludedAmounts[monthKey] = (excludedAmounts[monthKey] || 0) + Math.abs(t.amount);
      } else {
        if (t.category !== 'Transfer' && t.category !== 'Income') {
          if (!months[monthKey]) months[monthKey] = {};
          if (!months[monthKey][t.category]) months[monthKey][t.category] = 0;
          months[monthKey][t.category] += Math.abs(t.amount);
        }
      }
    });
    
    const allCategories = new Set();
    Object.values(months).forEach(m => Object.keys(m).forEach(cat => allCategories.add(cat)));
    
    const sorted = Object.keys(months).sort();
    sorted.forEach(month => {
      trends[month] = {};
      allCategories.forEach(cat => {
        trends[month][cat] = months[month][cat] || 0;
      });
    });
    
    res.json({ trends, excludedAmounts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/bill-buffer', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const bills = await RecurringBill.find({ userId });
    
    const days = parseInt(req.query.days) || 30;
    const today = new Date();
    const cutoffDate = new Date(today.getTime() + days * 24 * 60 * 60 * 1000);
    
    const billsWithDates = [];
    bills.forEach(bill => {
      if (bill.type === 'income') return;
      
      const startDate = new Date(bill.startDate);
      let currentDate = new Date(startDate);
      
      while (currentDate <= cutoffDate) {
        if (currentDate >= today) {
          billsWithDates.push({
            date: new Date(currentDate),
            merchant: bill.name,
            amount: bill.amount,
            daysUntilDue: Math.ceil((currentDate - today) / (1000 * 60 * 60 * 24))
          });
        }
        currentDate = new Date(currentDate.getTime() + bill.frequency * 24 * 60 * 60 * 1000);
      }
    });
    
    billsWithDates.sort((a, b) => a.date - b.date);
    const billsInPeriod = billsWithDates.filter(b => b.date <= cutoffDate);
    
    const totalBillsNeeded = billsInPeriod.reduce((sum, bill) => sum + bill.amount, 0);
    const desiredBuffer = totalBillsNeeded * 0.2;
    const requiredBalance = totalBillsNeeded + desiredBuffer;
    
    res.json({
      days,
      nextBills: billsInPeriod.map(b => ({
        merchant: b.merchant,
        amount: b.amount,
        daysUntilDue: b.daysUntilDue,
        date: b.date.toISOString().split('T')[0]
      })),
      billCount: billsInPeriod.length,
      totalBillsAmount: totalBillsNeeded,
      recommendedBuffer: desiredBuffer,
      requiredBalance: requiredBalance,
      leftoverAfterBills: desiredBuffer
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/categories', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const txns = await Transaction.find({ userId });
    const categories = {};
    txns.forEach(t => {
      if (t.type === 'expense' && t.category !== 'Income' && !t.excluded) {
        categories[t.category] = (categories[t.category] || 0) + Math.abs(t.amount);
      }
    });
    res.json(categories);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/balance', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const txns = await Transaction.find({ userId });
    const totalIncome = txns.filter(t => t.type === 'income' && !t.excluded).reduce((sum, t) => sum + t.amount, 0);
    const totalExpense = txns.filter(t => t.type === 'expense' && !t.excluded).reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const excluded = txns.filter(t => t.excluded).length;
    res.json({ income: totalIncome, expenses: totalExpense, balance: totalIncome - totalExpense, transactionCount: txns.length, excluded });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/summary', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const txns = await Transaction.find({ userId });
    const totalIncome = txns.filter(t => t.type === 'income' && !t.excluded).reduce((sum, t) => sum + t.amount, 0);
    const totalExpenses = txns.filter(t => t.type === 'expense' && !t.excluded).reduce((sum, t) => s + Math.abs(t.amount), 0);
    res.json({ totalIncome, totalExpenses, balance: totalIncome - totalExpenses });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/daily-breakdown', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const txns = await Transaction.find({ userId });
    const daily = {};
    txns.forEach(t => {
      daily[t.date] = (daily[t.date] || 0) + t.amount;
    });
    res.json(daily);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/recurring-calendar', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const txns = await Transaction.find({ userId });
    const bills = await RecurringBill.find({ userId });
    res.json(generateBillCalendar(3, txns, bills));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/cash-flow', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const txns = await Transaction.find({ userId });
    res.json(calculateCashFlow(6, txns));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/spending-velocity', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const txns = await Transaction.find({ userId });
    res.json(calculateSpendingVelocity(txns));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/alerts', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const txns = await Transaction.find({ userId });
    const bills = await RecurringBill.find({ userId });
    const debts = await Debt.find({ userId });
    res.json(generateAlerts(txns, bills, debts));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/insights', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const txns = await Transaction.find({ userId });
    const debts = await Debt.find({ userId });
    const recurring = detectRecurring(txns);
    const velocity = calculateSpendingVelocity(txns);
    const totalIncome = txns.filter(t => t.type === 'income' && !t.excluded).reduce((sum, t) => sum + t.amount, 0);
    const totalExpenses = txns.filter(t => t.type === 'expense' && !t.excluded).reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const savingsRate = totalIncome > 0 ? ((totalIncome - totalExpenses) / totalIncome * 100) : 0;
    const debtTotal = debts.reduce((s, d) => s + d.balance, 0);
    const debtRatio = totalIncome > 0 ? (debtTotal / totalIncome) : 0;
    const anomalies = detectAnomalies(txns);
    
    let score = 40;
    if (savingsRate >= 30) score += 30;
    else if (savingsRate >= 20) score += 25;
    else if (savingsRate >= 15) score += 20;
    else if (savingsRate >= 10) score += 15;
    else if (savingsRate >= 5) score += 10;
    else if (savingsRate > 0) score += 5;
    
    if (velocity.trend === 'decreasing') score += 20;
    else if (velocity.trend === 'stable') score += 10;
    
    if (debtRatio === 0) score += 20;
    else if (debtRatio < 0.5) score += 15;
    else if (debtRatio < 1) score += 10;
    else if (debtRatio < 2) score += 5;
    
    if (anomalies.length === 0) score += 15;
    else if (anomalies.length <= 2) score += 10;
    else if (anomalies.length <= 4) score += 5;
    
    const recurringMonthly = recurring.filter(r => r.isRecurring).reduce((s, r) => s + r.avgAmount, 0);
    const recurringPercent = totalIncome > 0 ? (recurringMonthly / totalIncome) * 100 : 0;
    if (recurringPercent < 20) score += 15;
    else if (recurringPercent < 30) score += 10;
    else if (recurringPercent < 40) score += 5;
    
    res.json({
      score: Math.min(100, score),
      savingsRate: savingsRate.toFixed(1),
      spendingTrend: velocity.trend,
      debts: debts.length,
      recurringBills: recurring.filter(r => r.isRecurring).length,
      recommendations: getSmartRecommendations(txns)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === DEBTS ===
app.post('/api/debts', verifyToken, express.json(), async (req, res) => {
  try {
    const userId = req.user.userId;
    const debts = await Debt.find({ userId });
    const debtId = `debt_${Date.now()}`;
    
    const debt = new Debt({
      userId,
      id: debtId,
      ...req.body
    });
    await debt.save();
    res.json(debt);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/debts', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const debts = await Debt.find({ userId });
    res.json(debts);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/debts/:id', verifyToken, express.json(), async (req, res) => {
  try {
    const userId = req.user.userId;
    const debtId = req.params.id;
    
    const debt = await Debt.findOne({ userId, id: debtId });
    if (!debt) return res.status(404).json({ error: 'Debt not found' });
    
    Object.assign(debt, req.body);
    await debt.save();
    res.json(debt);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/debts/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const debtId = req.params.id;
    
    await Debt.deleteOne({ userId, id: debtId });
    const debts = await Debt.find({ userId });
    res.json(debts);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === GOALS ===
app.post('/api/goals', verifyToken, express.json(), async (req, res) => {
  try {
    const userId = req.user.userId;
    const goalId = `goal_${Date.now()}`;
    
    const goal = new Goal({
      userId,
      id: goalId,
      ...req.body
    });
    await goal.save();
    res.json(goal);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/goals', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const goals = await Goal.find({ userId });
    res.json(goals);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === RECURRING BILLS ===
app.get('/api/recurring-bills', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const bills = await RecurringBill.find({ userId });
    res.json(bills);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/recurring-bills', verifyToken, express.json(), async (req, res) => {
  try {
    const userId = req.user.userId;
    const billId = `bill_${Date.now()}`;
    
    const bill = new RecurringBill({
      userId,
      id: billId,
      ...req.body
    });
    await bill.save();
    res.json(bill);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/recurring-bills/:id', verifyToken, express.json(), async (req, res) => {
  try {
    const userId = req.user.userId;
    const billId = req.params.id;
    
    const bill = await RecurringBill.findOne({ userId, id: billId });
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    
    Object.assign(bill, req.body);
    await bill.save();
    res.json(bill);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/recurring-bills/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const billId = req.params.id;
    
    await RecurringBill.deleteOne({ userId, id: billId });
    const bills = await RecurringBill.find({ userId });
    res.json(bills);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === SETTINGS ===
app.get('/api/paycheck-settings', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    let settings = await Settings.findOne({ userId });
    if (!settings) settings = { paycheckAmount: 0, paycheckFrequencyDays: 14 };
    
    res.json({
      amount: settings.paycheckAmount || 0,
      frequencyDays: settings.paycheckFrequencyDays || 14
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/paycheck-settings', verifyToken, express.json(), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { amount, frequencyDays } = req.body;
    if (amount === undefined || frequencyDays === undefined) {
      return res.status(400).json({ error: 'amount and frequencyDays required' });
    }
    
    let settings = await Settings.findOne({ userId });
    if (!settings) settings = new Settings({ userId });
    
    settings.paycheckAmount = parseFloat(amount);
    settings.paycheckFrequencyDays = parseInt(frequencyDays);
    await settings.save();
    
    res.json({
      amount: settings.paycheckAmount,
      frequencyDays: settings.paycheckFrequencyDays
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/starting-balance', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    let settings = await Settings.findOne({ userId });
    if (!settings) settings = { startingBalance: 0 };
    
    const today = new Date();
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const defaultDate = firstOfMonth.toISOString().split('T')[0];
    
    res.json({
      balance: settings.startingBalance || 0,
      date: settings.startingBalanceDate || defaultDate
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/starting-balance', verifyToken, express.json(), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { balance, date } = req.body;
    if (balance === undefined || !date) {
      return res.status(400).json({ error: 'balance and date required' });
    }
    
    let settings = await Settings.findOne({ userId });
    if (!settings) settings = new Settings({ userId });
    
    settings.startingBalance = parseFloat(balance);
    settings.startingBalanceDate = date;
    await settings.save();
    
    res.json({
      balance: settings.startingBalance,
      date: settings.startingBalanceDate
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === BILL CALCULATOR ===
app.get('/api/bills-calculator', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const settings = await Settings.findOne({ userId });
    const bills = await RecurringBill.find({ userId });
    
    const paycheckAmount = settings?.paycheckAmount || 0;
    const frequencyDays = settings?.paycheckFrequencyDays || 14;
    const incomeBills = bills.filter(b => b.type === 'income');
    
    let totalMonthlyIncome = (paycheckAmount / frequencyDays) * 30;
    incomeBills.forEach(b => {
      const monthlyFrequency = (30 / b.frequency);
      totalMonthlyIncome += b.amount * monthlyFrequency;
    });
    
    const expenseBills = bills.filter(b => b.type === 'expense' || !b.type);
    let totalMonthlyExpense = 0;
    const distribution = {};
    
    expenseBills.forEach(b => {
      const monthlyFrequency = (30 / b.frequency);
      const monthlyAmount = b.amount * monthlyFrequency;
      totalMonthlyExpense += monthlyAmount;
      distribution[b.name] = monthlyAmount;
    });
    
    const breakdown = [];
    let running = 0;
    
    for (let day = 1; day <= 30; day++) {
      let dayIncrement = 0;
      const dayBills = [];
      
      for (const bill of expenseBills) {
        const billDay = parseInt(bill.startDate.split('-')[2]);
        if (billDay === day || (billDay > 30 && day === 30)) {
          dayBills.push(bill.name);
          dayIncrement += bill.amount;
        }
      }
      
      for (const bill of incomeBills) {
        const billDay = parseInt(bill.startDate.split('-')[2]);
        if (billDay === day || (billDay > 30 && day === 30)) {
          dayBills.push(`+ ${bill.name}`);
          dayIncrement += bill.amount;
        }
      }
      
      const paycheckDay = parseInt(bill.startDate?.split('-')[2]) || 15;
      if (day === paycheckDay || (day === 14 && paycheckDay > 14 && paycheckDay <= 15)) {
        dayBills.push(`+ Paycheck`);
        dayIncrement += paycheckAmount;
      }
      
      running += dayIncrement;
      if (dayBills.length > 0) {
        breakdown.push({
          day,
          bills: dayBills,
          change: dayIncrement,
          running: running.toFixed(2)
        });
      }
    }
    
    res.json({
      totalMonthlyIncome: totalMonthlyIncome.toFixed(2),
      totalMonthlyExpense: totalMonthlyExpense.toFixed(2),
      monthlyBalance: (totalMonthlyIncome - totalMonthlyExpense).toFixed(2),
      distribution,
      breakdown
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === PAYOFF STRATEGY ===
app.post('/api/payoff-strategy', verifyToken, express.json(), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { strategy } = req.body;
    const debts = await Debt.find({ userId });
    
    let sorted;
    if (strategy === 'avalanche') {
      sorted = [...debts].sort((a, b) => (b.interestRate || 0) - (a.interestRate || 0));
    } else {
      sorted = [...debts].sort((a, b) => b.balance - a.balance);
    }
    
    const payoffPlan = sorted.map((d, idx) => ({
      priority: idx + 1,
      creditor: d.creditor,
      balance: d.balance,
      minPayment: d.minPayment,
      interestRate: d.interestRate,
      order: strategy === 'avalanche' ? 'Pay highest rate first' : 'Pay largest balance first'
    }));
    
    res.json({ strategy, payoffPlan });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Log initial data count
  setTimeout(async () => {
    try {
      const txnCount = await Transaction.countDocuments();
      const debtCount = await Debt.countDocuments();
      const goalCount = await Goal.countDocuments();
      console.log(`Loaded ${txnCount} transactions, ${debtCount} debts, ${goalCount} goals`);
    } catch (e) {
      console.error('Error counting documents:', e.message);
    }
  }, 1000);
});

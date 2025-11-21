import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import pdfParse from 'pdf-parse';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 5000;
const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, '..')));

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ dest: uploadDir });

let transactions = [];
let debts = [];
let subscriptions = [];
let goals = [];
let budgets = {};

function categorizeTransaction(description) {
  const desc = description.toLowerCase();
  if (desc.match(/starbucks|coffee|cafe|restaurant|food|dining|uber eats|doordash|grubhub|pizza|burger|taco|harps|inola|sinclair/)) return 'Food & Dining';
  if (desc.match(/whole foods|safeway|kroger|trader joe|grocery|costco|walmart|supercenter|wm super/)) return 'Groceries';
  if (desc.match(/electric|gas|water|internet|phone|utility|comcast|verizon|at&t|harley|davidson|car payment|motorcycle|wells fargo|chase|capital one|amex|discover|autopay|crcardpmt|crunch|fit/)) return 'Utilities';
  if (desc.match(/netflix|hulu|spotify|disney|prime|subscription|gym|apple|xbox/)) return 'Entertainment';
  if (desc.match(/shell|chevron|exxon|bp|gas|fuel|parking|metro|transit|lyft|qt|murphy|carwash|armstrong|bank/)) return 'Transportation';
  if (desc.match(/amazon|target|mall|clothing|shoes|fashion|best buy|store|walgreens|dollar general|staxx/)) return 'Shopping';
  if (desc.match(/doctor|hospital|pharmacy|health|cvs|walgreens|medical|ctlp|foto/)) return 'Health & Fitness';
  if (desc.match(/salary|paycheck|deposit|transfer|income|bonus|interest|cash app/)) return 'Income';
  return 'Other';
}

function detectRecurring() {
  const merchants = {};
  transactions.forEach(t => {
    const merchant = t.description.split(' ')[0];
    if (!merchants[merchant]) merchants[merchant] = [];
    merchants[merchant].push(t);
  });
  return Object.entries(merchants).filter(([m, txns]) => txns.length >= 3).map(([m, txns]) => ({
    merchant: m, count: txns.length, avgAmount: txns.reduce((s, t) => s + Math.abs(t.amount), 0) / txns.length, category: txns[0].category
  }));
}

function calculateFinancialScore() {
  if (transactions.length === 0) return 0;
  const income = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expenses = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0);
  const savingsRate = income > 0 ? ((income - expenses) / income) * 100 : 0;
  const debtRatio = debts.length > 0 ? debts.reduce((s, d) => s + d.balance, 0) / (income || 1) : 0;
  let score = 50;
  if (savingsRate > 20) score += 25;
  if (savingsRate > 10) score += 15;
  if (debtRatio < 0.5) score += 25;
  else if (debtRatio < 2) score += 10;
  return Math.min(100, Math.max(0, score));
}

function getSpendingTrends() {
  const trends = {};
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    trends[dateStr] = transactions.filter(t => t.date === dateStr && t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0);
  }
  return trends;
}

function getSavingsOpportunities() {
  const categories = {};
  transactions.filter(t => t.type === 'expense').forEach(t => {
    categories[t.category] = (categories[t.category] || 0) + Math.abs(t.amount);
  });
  return Object.entries(categories).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([cat, amt]) => ({
    category: cat, amount: amt, potential: Math.round(amt * 0.1)
  }));
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
  
  console.log(`✅ Extracted ${transactions.length} transactions`);
  return transactions;
}

app.post('/api/upload-statement', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const pdfBuffer = fs.readFileSync(req.file.path);
    const pdfData = await pdfParse(pdfBuffer);
    const text = pdfData.text;
    const parsedTransactions = extractTransactions(text);
    if (parsedTransactions.length > 0) {
      transactions = parsedTransactions;
    } else {
      transactions = [{ id: 1, date: '2025-10-02', amount: -1400, category: 'Utilities', description: 'Electric Bill Payment', type: 'expense' }];
    }
    fs.unlink(req.file.path, (err) => { if (err) console.error('Error deleting file:', err); });
    res.json({ success: true, transactions: transactions.length, message: `Loaded ${transactions.length} transactions` });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed: ' + error.message });
  }
});

app.get('/api/transactions', (req, res) => res.json(transactions));
app.post('/api/transactions', express.json(), (req, res) => {
  const newTransaction = { id: Math.max(...transactions.map(t => t.id || 0), 0) + 1, ...req.body, date: new Date().toISOString().split('T')[0] };
  transactions.push(newTransaction);
  res.json(newTransaction);
});

app.get('/api/categories', (req, res) => {
  const categories = {};
  transactions.forEach(t => {
    if (t.type === 'expense' && t.category !== 'Income') {
      categories[t.category] = (categories[t.category] || 0) + Math.abs(t.amount);
    }
  });
  res.json(categories);
});

app.get('/api/balance', (req, res) => {
  const totalIncome = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  const totalExpense = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + Math.abs(t.amount), 0);
  res.json({ income: totalIncome, expenses: totalExpense, balance: totalIncome - totalExpense, transactionCount: transactions.length });
});

app.get('/api/summary', (req, res) => {
  const totalIncome = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  const totalExpenses = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + Math.abs(t.amount), 0);
  res.json({ totalIncome, totalExpenses, balance: totalIncome - totalExpenses });
});

app.get('/api/daily-breakdown', (req, res) => {
  const daily = {};
  transactions.forEach(t => {
    daily[t.date] = (daily[t.date] || 0) + t.amount;
  });
  res.json(daily);
});

app.get('/api/insights', (req, res) => {
  const recurring = detectRecurring();
  const score = calculateFinancialScore();
  const trends = getSpendingTrends();
  const savings = getSavingsOpportunities();
  const totalIncome = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  const totalExpenses = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const savingsRate = totalIncome > 0 ? ((totalIncome - totalExpenses) / totalIncome * 100).toFixed(1) : 0;
  const avgDailySpend = transactions.filter(t => t.type === 'expense').length > 0 ? (totalExpenses / transactions.filter(t => t.type === 'expense').length).toFixed(2) : 0;
  
  res.json({
    financialScore: score,
    savingsRate,
    recurringTransactions: recurring,
    spendingTrends: trends,
    savingsOpportunities: savings,
    avgDailySpend,
    totalTransactions: transactions.length,
    debtTotal: debts.reduce((s, d) => s + d.balance, 0)
  });
});

app.post('/api/goals', express.json(), (req, res) => {
  const newGoal = { id: Math.max(...goals.map(g => g.id || 0), 0) + 1, ...req.body, createdAt: new Date() };
  goals.push(newGoal);
  res.json(newGoal);
});

app.get('/api/goals', (req, res) => res.json(goals));

app.post('/api/debts', express.json(), (req, res) => {
  const newDebt = { id: Math.max(...debts.map(d => d.id || 0), 0) + 1, ...req.body };
  debts.push(newDebt);
  res.json(newDebt);
});

app.get('/api/debts', (req, res) => res.json(debts));

function calculateDebtPayoff(debtList, strategy, extraPayment = 0) {
  const debts = JSON.parse(JSON.stringify(debtList));
  let totalPaid = 0, totalInterest = 0, months = 0;
  const timeline = [];
  
  if (strategy === 'avalanche') {
    debts.sort((a, b) => (b.interestRate || 0) - (a.interestRate || 0));
  } else {
    debts.sort((a, b) => a.balance - b.balance);
  }

  while (debts.some(d => d.balance > 0) && months < 600) {
    let monthPayment = extraPayment;
    debts.forEach(d => {
      if (d.balance > 0) {
        const minPay = d.minPayment || 50;
        monthPayment += minPay;
      }
    });

    let paid = 0;
    for (let d of debts) {
      if (d.balance <= 0) continue;
      const minPay = d.minPayment || 50;
      const interest = (d.balance * (d.interestRate || 0)) / 100 / 12;
      d.balance += interest;
      totalInterest += interest;

      if (d === debts[0] && monthPayment > 0) {
        d.balance -= Math.min(monthPayment, d.balance);
        paid = Math.min(monthPayment, d.balance + interest);
        totalPaid += paid;
      } else if (d.balance > 0) {
        d.balance -= minPay;
        totalPaid += minPay;
      }
    }

    months++;
    if (months <= 12 || months % 6 === 0 || debts.some(d => d.balance <= 0)) {
      timeline.push({
        month: months,
        totalBalance: debts.reduce((s, d) => s + Math.max(0, d.balance), 0),
        totalInterest: totalInterest,
        debtsPaid: debts.filter(d => d.balance <= 0).length
      });
    }
  }

  const totalBalance = debts.reduce((s, d) => s + d.balance, 0);
  return {
    months,
    totalInterest: Math.round(totalInterest),
    totalBalance: Math.max(0, totalBalance),
    payoffDate: new Date(Date.now() + months * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    timeline,
    debts: debts.map(d => ({ ...d, balance: Math.max(0, d.balance) }))
  };
}

app.post('/api/payoff-strategy', express.json(), (req, res) => {
  const { strategy, extraPayment } = req.body;
  const extra = extraPayment || 0;
  
  const avalanche = calculateDebtPayoff(debts, 'avalanche', extra);
  const snowball = calculateDebtPayoff(debts, 'snowball', extra);
  
  const selected = strategy === 'avalanche' ? avalanche : snowball;
  const other = strategy === 'avalanche' ? snowball : avalanche;
  
  const interestSaved = other.totalInterest - selected.totalInterest;
  const monthsSaved = other.months - selected.months;
  
  res.json({
    strategy: strategy.toUpperCase(),
    recommendation: strategy === 'avalanche' 
      ? `Save $${interestSaved.toLocaleString()} and finish ${monthsSaved} months faster` 
      : `Save $${interestSaved.toLocaleString()} and finish ${monthsSaved} months faster`,
    payoff: selected,
    comparison: {
      avalanche: { months: avalanche.months, interest: avalanche.totalInterest },
      snowball: { months: snowball.months, interest: snowball.totalInterest }
    }
  });
});

app.post('/api/subscriptions', express.json(), (req, res) => {
  const newSub = { id: Math.max(...subscriptions.map(s => s.id || 0), 0) + 1, ...req.body };
  subscriptions.push(newSub);
  res.json(newSub);
});

app.get('/api/subscriptions', (req, res) => res.json(subscriptions));
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

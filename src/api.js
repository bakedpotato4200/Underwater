import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import pdfParse from 'pdf-parse';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 5000;
const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Cache control - prevent stale data in iframe
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

app.use(express.static(path.join(__dirname, '..')));

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const upload = multer({ dest: uploadDir });

// Data files
const transactionsFile = path.join(dataDir, 'transactions.json');
const debtsFile = path.join(dataDir, 'debts.json');
const subscriptionsFile = path.join(dataDir, 'subscriptions.json');
const goalsFile = path.join(dataDir, 'goals.json');
const exclusionRulesFile = path.join(dataDir, 'exclusion-rules.json');
const learnedPatternsFile = path.join(dataDir, 'learned-patterns.json');
const recurringBillsFile = path.join(dataDir, 'recurring-bills.json');
const bankBalanceFile = path.join(dataDir, 'bank-balance.json');

// Load/Save functions
function loadData(file) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    console.error(`Error loading ${file}:`, e.message);
  }
  return [];
}

function saveData(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`Error saving ${file}:`, e.message);
  }
}

// Initialize data from files
let transactions = loadData(transactionsFile);

// Function to get fresh transaction data
function getTransactions() {
  transactions = loadData(transactionsFile);
  return transactions;
}
let debts = loadData(debtsFile);
let subscriptions = loadData(subscriptionsFile);
let bankBalance = loadData(bankBalanceFile) || { balance: 0 };
let goals = loadData(goalsFile);
let exclusionRules = loadData(exclusionRulesFile);
let learnedPatterns = loadData(learnedPatternsFile) || { merchants: {}, exclusions: {} };
let recurringBills = loadData(recurringBillsFile);

function shouldExcludeByRule(txn) {
  if (!Array.isArray(exclusionRules)) return false;
  return exclusionRules.some(rule => {
    if (rule.type === 'merchant') {
      return txn.description.toLowerCase().includes(rule.pattern.toLowerCase());
    }
    if (rule.type === 'category') {
      return txn.category === rule.pattern;
    }
    return false;
  });
}

function applyExclusionRules() {
  transactions.forEach(txn => {
    if (!txn.excluded && shouldExcludeByRule(txn)) {
      txn.excluded = true;
    }
  });
}

console.log(`Loaded ${transactions.length} transactions, ${debts.length} debts, ${goals.length} goals`);

function categorizeTransaction(description) {
  const desc = description.toLowerCase();
  
  // Check learned patterns first (highest priority)
  for (const [pattern, category] of Object.entries(learnedPatterns.merchants || {})) {
    if (desc.includes(pattern.toLowerCase())) return category;
  }
  
  // Fall back to hardcoded patterns
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

function detectRecurring() {
  const merchants = {};
  transactions.forEach(t => {
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
    return {
      merchant: m,
      count: txns.length,
      avgAmount: Math.abs(txns.reduce((s, t) => s + t.amount, 0) / txns.length),
      category: txns[0].category,
      avgInterval,
      lastTransaction: txns[txns.length - 1].date,
      isRecurring: txns.length >= 2,
      nextDueDate: new Date(new Date(txns[txns.length - 1].date).getTime() + avgInterval * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    };
  });
}

function generateBillCalendar(months = 3) {
  const recurring = detectRecurring().filter(r => r.isRecurring);
  const calendar = {};
  const today = new Date();

  for (let m = 0; m < months; m++) {
    for (let d = 1; d <= 31; d++) {
      const date = new Date(today.getFullYear(), today.getMonth() + m, d);
      if (date.getMonth() !== (today.getMonth() + m) % 12) break;
      const dateStr = date.toISOString().split('T')[0];
      calendar[dateStr] = [];

      // Add income transactions
      transactions.forEach(t => {
        if (t.type === 'income' && t.date === dateStr && !t.excluded) {
          calendar[dateStr].push({
            merchant: t.description,
            amount: Math.abs(t.amount),
            category: t.category || 'Income',
            type: 'income',
            daysUntilDue: Math.ceil((date - today) / (1000 * 60 * 60 * 24))
          });
        }
      });

      recurring.forEach(bill => {
        const lastDate = new Date(bill.lastTransaction);
        const nextDate = new Date(lastDate.getTime() + bill.avgInterval * 24 * 60 * 60 * 1000);
        
        if (date.getDate() === nextDate.getDate() && date.getMonth() === nextDate.getMonth()) {
          calendar[dateStr].push({
            merchant: bill.merchant,
            amount: bill.avgAmount,
            category: bill.category,
            type: 'expense',
            daysUntilDue: Math.ceil((date - today) / (1000 * 60 * 60 * 24)),
            frequency: bill.avgInterval
          });
        }
      });

      // Add manually added recurring bills
      if (Array.isArray(recurringBills)) {
        recurringBills.forEach(bill => {
          const startDate = new Date(bill.startDate);
          const checkDate = new Date(startDate);
          while (checkDate <= date) {
            const checkStr = checkDate.toISOString().split('T')[0];
            if (checkStr === dateStr) {
              calendar[dateStr].push({
                merchant: bill.name,
                amount: bill.type === 'income' ? Math.abs(bill.amount) : bill.amount,
                type: bill.type || 'expense',
                daysUntilDue: Math.ceil((date - today) / (1000 * 60 * 60 * 24)),
                frequency: bill.frequency
              });
            }
            checkDate.setDate(checkDate.getDate() + bill.frequency);
          }
        });
      }
    }
  }

  return Object.entries(calendar).filter(([_, bills]) => bills.length > 0).reduce((acc, [date, bills]) => {
    acc[date] = bills;
    return acc;
  }, {});
}

function calculateCashFlow(months = 6) {
  const projection = {};
  const today = new Date();
  const recurring = detectRecurring().filter(r => r.isRecurring);
  const totalIncome = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const avgDailyExpense = transactions.filter(t => t.type === 'expense').length > 0 
    ? transactions.filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0) / Math.max(transactions.filter(t => t.type === 'expense').length, 1)
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

function calculateSpendingVelocity() {
  if (transactions.length === 0) return { daily: 0, weekly: 0, monthly: 0, trend: 'stable' };

  const today = new Date();
  const last7 = transactions.filter(t => {
    const d = new Date(t.date);
    return (today - d) / (1000 * 60 * 60 * 24) <= 7;
  }).filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0);

  const last30 = transactions.filter(t => {
    const d = new Date(t.date);
    return (today - d) / (1000 * 60 * 60 * 24) <= 30;
  }).filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0);

  const prev30 = transactions.filter(t => {
    const d = new Date(t.date);
    const days = (today - d) / (1000 * 60 * 60 * 24);
    return days > 30 && days <= 60;
  }).filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0);

  return {
    daily: (last7 / 7).toFixed(2),
    weekly: (last7).toFixed(2),
    monthly: (last30).toFixed(2),
    trend: last30 > prev30 ? 'increasing' : last30 < prev30 ? 'decreasing' : 'stable',
    trendPercent: prev30 > 0 ? (((last30 - prev30) / prev30) * 100).toFixed(1) : 0
  };
}

function detectAnomalies() {
  if (transactions.length < 3) return [];
  const anomalies = [];
  
  // Category-based anomalies
  const categories = {};
  transactions.filter(t => t.type === 'expense' && !t.excluded && t.category !== 'Transfer').forEach(t => {
    if (!categories[t.category]) categories[t.category] = [];
    categories[t.category].push(Math.abs(t.amount));
  });
  
  // Z-score based outlier detection per category
  Object.entries(categories).forEach(([cat, amounts]) => {
    if (amounts.length < 3) return;
    const mean = amounts.reduce((a, b) => a + b) / amounts.length;
    const stdDev = Math.sqrt(amounts.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / amounts.length);
    
    transactions.filter(t => t.category === cat && t.type === 'expense' && !t.excluded).forEach(t => {
      const zScore = stdDev > 0 ? Math.abs((Math.abs(t.amount) - mean) / stdDev) : 0;
      if (zScore > 2.5) anomalies.push({...t, zScore, reason: 'Category outlier'});
    });
  });
  
  // Spike detection: compare to last 7 day average
  const last7Days = transactions.filter(t => {
    const d = new Date(t.date);
    return (new Date() - d) / (1000 * 60 * 60 * 24) <= 7 && t.type === 'expense' && !t.excluded;
  });
  const avg7 = last7Days.length > 0 ? last7Days.reduce((s, t) => s + Math.abs(t.amount), 0) / last7Days.length : 0;
  
  last7Days.forEach(t => {
    if (Math.abs(t.amount) > avg7 * 3 && avg7 > 0) {
      anomalies.push({...t, reason: 'Spending spike', ratio: (Math.abs(t.amount) / avg7).toFixed(1)});
    }
  });
  
  return anomalies.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 5);
}

function getSmartRecommendations() {
  const recs = [];
  const expenses = transactions.filter(t => t.type === 'expense' && !t.excluded && t.category !== 'Transfer');
  const categories = {};
  
  expenses.forEach(t => {
    if (t.category !== 'Transfer' && t.category !== 'Income') {
      categories[t.category] = (categories[t.category] || 0) + Math.abs(t.amount);
    }
  });
  
  const totalIncome = transactions.filter(t => t.type === 'income' && !t.excluded).reduce((s, t) => s + t.amount, 0);
  const totalExpense = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);
  const savingsRate = totalIncome > 0 ? (totalIncome - totalExpense) / totalIncome : 0;
  
  // 1. Spending optimization per category
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
  
  // 2. Recurring bills audit
  const recurring = detectRecurring().filter(r => r.isRecurring);
  if (recurring.length > 0) {
    const yearlyRecurring = recurring.reduce((s, r) => s + r.avgAmount, 0) * 12;
    const potentialSavings = yearlyRecurring * 0.2;
    recs.push({ 
      title: 'Audit Recurring Bills', 
      desc: `${recurring.length} recurring bills cost $${yearlyRecurring.toFixed(0)}/year. Eliminate 20% could save $${potentialSavings.toFixed(0)}` 
    });
  }
  
  // 3. Savings strategy
  if (savingsRate > 0) {
    const monthlySavings = totalIncome - totalExpense;
    const yearEnd = monthlySavings * 12;
    if (monthlySavings > 500) {
      recs.push({ 
        title: '50/30/20 Rule', 
        desc: `Allocate: 50% needs, 30% wants, 20% savings. You save ${(savingsRate*100).toFixed(0)}% – excellent track record` 
      });
    } else {
      recs.push({ 
        title: `Boost Savings to ${(yearEnd * 1.5).toFixed(0)}/year`, 
        desc: `Target 20% savings rate. Current: ${(savingsRate*100).toFixed(0)}% ($${monthlySavings.toFixed(0)}/mo). Increase by ${((yearEnd * 0.2 - monthlySavings) / 10 * 12).toFixed(0)}%` 
      });
    }
  }
  
  // 4. Category-specific insights
  if (sorted.length > 1) {
    const foodIdx = sorted.findIndex(([cat]) => cat === 'Food & Dining');
    if (foodIdx !== -1 && sorted[foodIdx][1] > totalExpense * 0.12) {
      recs.push({ 
        title: 'Meal Planning', 
        desc: `Food & Dining: $${sorted[foodIdx][1].toFixed(0)}/month. Meal prep 2x/week saves 10-20%` 
      });
    }
  }
  
  // 5. Spending trend warning
  const velocity = calculateSpendingVelocity();
  if (velocity.trend === 'increasing') {
    recs.push({ 
      title: `Reverse ${velocity.trendPercent}% Spending Rise`, 
      desc: `Monthly spend up ${velocity.trendPercent}%. Set category budgets to lock spending at current baseline` 
    });
  }
  
  return recs.slice(0, 5);
}

function generateAlerts() {
  const alerts = [];
  const recurring = detectRecurring().filter(r => r.isRecurring);
  const velocity = calculateSpendingVelocity();
  const totalIncome = transactions.filter(t => t.type === 'income' && !t.excluded).reduce((s, t) => s + t.amount, 0);
  const totalExpense = transactions.filter(t => t.type === 'expense' && !t.excluded).reduce((s, t) => s + Math.abs(t.amount), 0);
  const anomalies = detectAnomalies();

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

  if (debts.length > 0) {
    const totalDebt = debts.reduce((s, d) => s + d.balance, 0);
    if (totalDebt > totalIncome * 3) {
      alerts.push({ type: 'alert', title: 'High Debt Ratio', message: `Your debt (${(totalDebt / totalIncome).toFixed(1)}x income) is very high. Focus on payoff!` });
    }
  }

  return alerts.slice(0, 5);
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

app.post('/api/upload-statement', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const pdfBuffer = fs.readFileSync(req.file.path);
    const pdfData = await pdfParse(pdfBuffer);
    const text = pdfData.text;
    
    // Extract transactions from new PDF
    const parsedTransactions = extractTransactions(text);
    
    // Get next ID based on existing transactions
    const nextId = transactions.length > 0 ? Math.max(...transactions.map(t => t.id || 0)) + 1 : 1;
    
    // Reassign IDs to new transactions to avoid conflicts
    parsedTransactions.forEach((t, idx) => {
      t.id = nextId + idx;
      t.excluded = false;
    });
    
    // Merge new transactions with existing ones, avoiding duplicates
    const seen = new Set();
    transactions.forEach(t => {
      const key = `${t.date}|${t.amount}|${t.description}`;
      seen.add(key);
    });
    
    const newTransactions = [];
    parsedTransactions.forEach(t => {
      const key = `${t.date}|${t.amount}|${t.description}`;
      if (!seen.has(key)) {
        newTransactions.push(t);
        seen.add(key);
      }
    });
    
    // Add new transactions to existing array
    transactions.push(...newTransactions);
    
    // If no transactions at all, add sample
    if (transactions.length === 0) {
      transactions = [{ id: 1, date: '2025-10-02', amount: -1400, category: 'Utilities', description: 'Electric Bill Payment', type: 'expense', excluded: false }];
    }
    
    saveData(transactionsFile, transactions);
    fs.unlink(req.file.path, (err) => { if (err) console.error('Error deleting file:', err); });
    res.json({ success: true, transactions: transactions.length, message: `Loaded ${transactions.length} total transactions (${newTransactions.length} new)` });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed: ' + error.message });
  }
});

app.get('/api/transactions', (req, res) => {
  const fresh = getTransactions();
  res.json(fresh);
});
app.post('/api/transactions', express.json(), (req, res) => {
  const newTransaction = { id: Math.max(...transactions.map(t => t.id || 0), 0) + 1, ...req.body, date: new Date().toISOString().split('T')[0], excluded: false };
  transactions.push(newTransaction);
  saveData(transactionsFile, transactions);
  res.json(newTransaction);
});

app.post('/api/transactions/:id/toggle-exclude', express.json(), (req, res) => {
  const txn = transactions.find(t => t.id == req.params.id);
  if (txn) {
    txn.excluded = !txn.excluded;
    
    if (txn.excluded && req.body.learnRule) {
      const merchant = txn.description.split(' ')[0];
      const existingRule = exclusionRules.find(r => r.pattern === merchant);
      if (!existingRule) {
        exclusionRules.push({ type: 'merchant', pattern: merchant });
        saveData(exclusionRulesFile, exclusionRules);
      }
    }
    
    saveData(transactionsFile, transactions);
    res.json({ success: true, excluded: txn.excluded });
  } else {
    res.status(404).json({ error: 'Transaction not found' });
  }
});

app.get('/api/exclusion-rules', (req, res) => {
  res.json(exclusionRules);
});

app.delete('/api/exclusion-rules/:index', express.json(), (req, res) => {
  const idx = parseInt(req.params.index);
  if (idx >= 0 && idx < exclusionRules.length) {
    const removed = exclusionRules.splice(idx, 1);
    saveData(exclusionRulesFile, exclusionRules);
    transactions.forEach(txn => {
      if (txn.excluded && shouldExcludeByRule(txn) === false && removed[0].type === 'merchant') {
        const merchant = txn.description.split(' ')[0];
        if (merchant.toLowerCase() === removed[0].pattern.toLowerCase()) {
          txn.excluded = false;
        }
      }
    });
    saveData(transactionsFile, transactions);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Rule not found' });
  }
});

app.post('/api/transactions/:id/note', express.json(), (req, res) => {
  const txn = transactions.find(t => t.id == req.params.id);
  if (txn) {
    txn.note = req.body.note || '';
    saveData(transactionsFile, transactions);
    res.json({ success: true, note: txn.note });
  } else {
    res.status(404).json({ error: 'Transaction not found' });
  }
});

app.delete('/api/transactions/:id', express.json(), (req, res) => {
  const index = transactions.findIndex(t => t.id == req.params.id);
  if (index !== -1) {
    transactions.splice(index, 1);
    saveData(transactionsFile, transactions);
    res.json({ success: true, message: 'Transaction deleted' });
  } else {
    res.status(404).json({ error: 'Transaction not found' });
  }
});

app.post('/api/transactions/:id/category', express.json(), (req, res) => {
  const txn = transactions.find(t => t.id == req.params.id);
  if (txn) {
    const newCategory = (req.body.category || txn.category).trim();
    
    // Normalize category: check for existing similar categories (case-insensitive exact match)
    const existingCategory = transactions
      .map(t => t.category)
      .filter(cat => cat && cat.toLowerCase() === newCategory.toLowerCase())
      .find(cat => cat); // Get the first exact match (case-insensitive)
    
    // Use existing category if found, otherwise use the new one
    const finalCategory = existingCategory || newCategory;
    
    // Update this transaction
    txn.category = finalCategory;
    
    // Consolidate: if there are other transactions with different case variations, update them too
    const oldCategory = req.body.category;
    if (oldCategory && oldCategory !== finalCategory) {
      transactions.forEach(t => {
        if (t.category && t.category.toLowerCase() === oldCategory.toLowerCase()) {
          t.category = finalCategory;
        }
      });
    }
    
    saveData(transactionsFile, transactions);
    res.json({ success: true, category: finalCategory });
  } else {
    res.status(404).json({ error: 'Transaction not found' });
  }
});

app.get('/api/spending-trends', (req, res) => {
  const fresh = getTransactions();
  const trends = {};
  const months = {};
  const excludedAmounts = {};
  
  fresh.forEach(t => {
    const date = new Date(t.date);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    
    if (!excludedAmounts[monthKey]) excludedAmounts[monthKey] = 0;
    
    if (t.type === 'expense' && t.category !== 'Transfer') {
      if (t.excluded) {
        // Track excluded amounts separately
        excludedAmounts[monthKey] += Math.abs(t.amount);
      } else {
        // Include non-excluded expenses
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
});

app.get('/api/bill-buffer', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const today = new Date();
  const cutoffDate = new Date(today.getTime() + days * 24 * 60 * 60 * 1000);
  
  // Only use manually added recurring bills to avoid duplicates
  const billsWithDates = [];
  if (Array.isArray(recurringBills)) {
    recurringBills.forEach(bill => {
      if (bill.type === 'income') return; // Skip income bills
      
      const startDate = new Date(bill.startDate);
      let currentDate = new Date(startDate);
      
      // Generate all occurrences within the period
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
  }
  
  billsWithDates.sort((a, b) => a.date - b.date);
  const billsInPeriod = billsWithDates.filter(b => b.date <= cutoffDate);
  
  const totalBillsNeeded = billsInPeriod.reduce((sum, bill) => sum + bill.amount, 0);
  const desiredBuffer = totalBillsNeeded * 0.2;
  const requiredBalance = totalBillsNeeded + desiredBuffer;
  
  res.json({
    days: days,
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
});

app.get('/api/categories', (req, res) => {
  const categories = {};
  transactions.forEach(t => {
    if (t.type === 'expense' && t.category !== 'Income' && !t.excluded) {
      categories[t.category] = (categories[t.category] || 0) + Math.abs(t.amount);
    }
  });
  res.json(categories);
});

app.get('/api/balance', (req, res) => {
  const totalIncome = transactions.filter(t => t.type === 'income' && !t.excluded).reduce((sum, t) => sum + t.amount, 0);
  const totalExpense = transactions.filter(t => t.type === 'expense' && !t.excluded).reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const excluded = transactions.filter(t => t.excluded).length;
  res.json({ income: totalIncome, expenses: totalExpense, balance: totalIncome - totalExpense, transactionCount: transactions.length, excluded });
});

app.get('/api/summary', (req, res) => {
  const totalIncome = transactions.filter(t => t.type === 'income' && !t.excluded).reduce((sum, t) => sum + t.amount, 0);
  const totalExpenses = transactions.filter(t => t.type === 'expense' && !t.excluded).reduce((sum, t) => sum + Math.abs(t.amount), 0);
  res.json({ totalIncome, totalExpenses, balance: totalIncome - totalExpenses });
});

app.get('/api/daily-breakdown', (req, res) => {
  const daily = {};
  transactions.forEach(t => {
    daily[t.date] = (daily[t.date] || 0) + t.amount;
  });
  res.json(daily);
});

app.get('/api/recurring-calendar', (req, res) => res.json(generateBillCalendar(3)));
app.get('/api/cash-flow', (req, res) => res.json(calculateCashFlow(6)));
app.get('/api/spending-velocity', (req, res) => res.json(calculateSpendingVelocity()));
app.get('/api/alerts', (req, res) => res.json(generateAlerts()));

app.get('/api/insights', (req, res) => {
  const recurring = detectRecurring();
  const velocity = calculateSpendingVelocity();
  const totalIncome = transactions.filter(t => t.type === 'income' && !t.excluded).reduce((sum, t) => sum + t.amount, 0);
  const totalExpenses = transactions.filter(t => t.type === 'expense' && !t.excluded).reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const savingsRate = totalIncome > 0 ? ((totalIncome - totalExpenses) / totalIncome * 100) : 0;
  const debtTotal = debts.reduce((s, d) => s + d.balance, 0);
  const debtRatio = totalIncome > 0 ? (debtTotal / totalIncome) : 0;
  const anomalies = detectAnomalies();
  
  // Advanced Financial Health Score
  let score = 40;
  
  // Savings rate scoring (0-30 points)
  if (savingsRate >= 30) score += 30;
  else if (savingsRate >= 20) score += 25;
  else if (savingsRate >= 15) score += 20;
  else if (savingsRate >= 10) score += 15;
  else if (savingsRate >= 5) score += 10;
  else if (savingsRate > 0) score += 5;
  
  // Spending trend (0-20 points)
  if (velocity.trend === 'decreasing') score += 20;
  else if (velocity.trend === 'stable') score += 10;
  
  // Debt management (0-20 points)
  if (debtRatio === 0) score += 20;
  else if (debtRatio < 0.5) score += 15;
  else if (debtRatio < 1) score += 10;
  else if (debtRatio < 2) score += 5;
  
  // Expense stability (0-15 points)
  if (anomalies.length === 0) score += 15;
  else if (anomalies.length <= 2) score += 10;
  else if (anomalies.length <= 4) score += 5;
  
  // Recurring bill management (0-15 points)
  const recurringMonthly = recurring.filter(r => r.isRecurring).reduce((s, r) => s + r.avgAmount, 0);
  const recurringPercent = totalIncome > 0 ? (recurringMonthly / totalIncome) * 100 : 0;
  if (recurringPercent < 20) score += 15;
  else if (recurringPercent < 30) score += 10;
  else if (recurringPercent < 40) score += 5;
  
  res.json({
    financialScore: Math.min(100, Math.round(score)),
    savingsRate: savingsRate.toFixed(1),
    debtRatio,
    recurringTransactions: recurring,
    velocity,
    avgDailySpend: velocity.daily,
    totalTransactions: transactions.length,
    excludedTransactions: transactions.filter(t => t.excluded).length,
    debtTotal,
    anomalies,
    recommendations: getSmartRecommendations()
  });
});

app.post('/api/goals', express.json(), (req, res) => {
  const newGoal = { id: Math.max(...goals.map(g => g.id || 0), 0) + 1, ...req.body, createdAt: new Date() };
  goals.push(newGoal);
  saveData(goalsFile, goals);
  res.json(newGoal);
});

app.get('/api/goals', (req, res) => res.json(goals));

app.post('/api/debts', express.json(), (req, res) => {
  const newDebt = { id: Math.max(...debts.map(d => d.id || 0), 0) + 1, ...req.body };
  debts.push(newDebt);
  saveData(debtsFile, debts);
  res.json(newDebt);
});

app.get('/api/debts', (req, res) => res.json(debts));

app.post('/api/payoff-strategy', express.json(), (req, res) => {
  const { strategy, extraPayment } = req.body;
  const extra = extraPayment || 0;
  
  const calculatePayoff = (debtList, strat, extra) => {
    const debts = JSON.parse(JSON.stringify(debtList));
    if (strat === 'avalanche') debts.sort((a, b) => (b.interestRate || 0) - (a.interestRate || 0));
    else debts.sort((a, b) => a.balance - b.balance);
    
    let months = 0, interest = 0;
    while (debts.some(d => d.balance > 0) && months < 600) {
      debts.forEach(d => {
        if (d.balance > 0) {
          const i = (d.balance * (d.interestRate || 0)) / 100 / 12;
          d.balance += i;
          interest += i;
          d.balance -= Math.min(d.minPayment || 50, d.balance);
        }
      });
      months++;
    }
    return { months, interest: Math.round(interest) };
  };
  
  const aval = calculatePayoff(debts, 'avalanche', extra);
  const snow = calculatePayoff(debts, 'snowball', extra);
  const selected = strategy === 'avalanche' ? aval : snow;
  const other = strategy === 'avalanche' ? snow : aval;
  
  res.json({
    strategy: strategy.toUpperCase(),
    recommendation: `Save $${(other.interest - selected.interest).toLocaleString()} and finish ${other.months - selected.months} months faster`,
    payoff: selected,
    comparison: { avalanche: aval, snowball: snow }
  });
});

// AI Debt Advisor - the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
app.post('/api/ai-debt-advisor', express.json(), async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: 'OpenAI API key not configured' });
    }
    
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    
    // Get income info
    const totalIncome = transactions.filter(t => t.type === 'income' && !t.excluded).reduce((sum, t) => sum + t.amount, 0);
    const totalSpending = Math.abs(transactions.filter(t => t.type === 'expense' && !t.excluded).reduce((sum, t) => sum + t.amount, 0));
    const availableForPayoff = totalIncome - totalSpending;
    
    // Build debt summary
    const debtSummary = debts.map(d => `- ${d.name || 'Debt'}: $${d.balance} at ${d.interestRate || 0}% interest, ${d.minPayment || 'no'} min payment`).join('\n');
    
    const prompt = `You are a financial advisor. Based on this financial situation, provide specific debt payoff strategy recommendations:

FINANCIAL SITUATION:
- Monthly Income: $${totalIncome.toFixed(0)}
- Monthly Spending: $${totalSpending.toFixed(0)}
- Available for Extra Payments: $${availableForPayoff.toFixed(0)}

DEBTS:
${debtSummary || 'No debts'}

Provide:
1. Recommended payoff strategy (avalanche or snowball) with reasoning
2. Suggested extra monthly payment amount
3. Estimated time to debt freedom
4. Specific action steps for this month
5. Quick win opportunities

Keep it practical and actionable.`;

    const message = await client.chat.completions.create({
      model: 'gpt-5',
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 2000
    });
    
    res.json({ advice: message.choices[0].message.content });
  } catch (error) {
    console.error('AI Advisor error:', error);
    res.status(500).json({ error: 'Failed to get advice: ' + error.message });
  }
});

app.post('/api/subscriptions', express.json(), (req, res) => {
  const newSub = { id: Math.max(...subscriptions.map(s => s.id || 0), 0) + 1, ...req.body };
  subscriptions.push(newSub);
  saveData(subscriptionsFile, subscriptions);
  res.json(newSub);
});

app.get('/api/subscriptions', (req, res) => res.json(subscriptions));

app.get('/api/recurring-bills', (req, res) => res.json(Array.isArray(recurringBills) ? recurringBills : []));

app.post('/api/recurring-bills', express.json(), (req, res) => {
  const { name, amount, frequency, startDate } = req.body;
  if (!name || !amount || !frequency || !startDate) {
    return res.status(400).json({ error: 'name, amount, frequency, and startDate required' });
  }
  
  const bill = {
    id: Date.now(),
    name,
    amount: parseFloat(amount),
    frequency: parseInt(frequency),
    startDate
  };
  
  if (!Array.isArray(recurringBills)) recurringBills = [];
  recurringBills.push(bill);
  saveData(recurringBillsFile, recurringBills);
  
  res.json(bill);
});

app.put('/api/recurring-bills/:id', express.json(), (req, res) => {
  const id = parseInt(req.params.id);
  const { name, amount, type, frequency, startDate } = req.body;
  if (!name || amount === undefined || !frequency || !startDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  if (!Array.isArray(recurringBills)) recurringBills = [];
  const bill = recurringBills.find(b => b.id === id);
  if (!bill) {
    return res.status(404).json({ error: 'Bill not found' });
  }
  
  bill.name = name;
  bill.amount = parseFloat(amount);
  bill.type = type;
  bill.frequency = parseInt(frequency);
  bill.startDate = startDate;
  
  saveData(recurringBillsFile, recurringBills);
  res.json(bill);
});

app.delete('/api/recurring-bills/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!Array.isArray(recurringBills)) recurringBills = [];
  recurringBills = recurringBills.filter(b => b.id !== id);
  saveData(recurringBillsFile, recurringBills);
  res.json({ success: true });
});

// Convert a transaction to a recurring bill
app.post('/api/transaction-to-recurring', express.json(), (req, res) => {
  const { merchant, amount, frequency } = req.body;
  if (!merchant || !amount || !frequency) {
    return res.status(400).json({ error: 'merchant, amount, and frequency required' });
  }
  
  const bill = {
    id: Date.now(),
    name: merchant,
    amount: Math.abs(parseFloat(amount)),
    frequency: parseInt(frequency),
    startDate: new Date().toISOString().split('T')[0]
  };
  
  if (!Array.isArray(recurringBills)) recurringBills = [];
  recurringBills.push(bill);
  saveData(recurringBillsFile, recurringBills);
  
  res.json(bill);
});

// Bills Calculator endpoint
app.get('/api/bills-calculator', (req, res) => {
  try {
    // Reload bills from disk to ensure we have the latest
    const freshBills = loadData(recurringBillsFile);
    
    // Calculate total monthly bills from recurring bills
    let totalMonthlyBills = 0;
    let paycheckAmount = 0;
    let paycheckFrequency = 30;
    
    // Get all recurring bills (only manually added ones, not detected historical)
    if (Array.isArray(freshBills) && freshBills.length > 0) {
      freshBills.forEach(bill => {
        if (bill.type === 'income') {
          paycheckAmount = parseFloat(bill.amount) || 0;
          paycheckFrequency = parseInt(bill.frequency) || 30;
        } else if (!bill.type || bill.type === 'expense') {
          const freq = parseInt(bill.frequency) || 30;
          const amt = parseFloat(bill.amount) || 0;
          const occurrencesPerMonth = 30 / freq;
          totalMonthlyBills += amt * occurrencesPerMonth;
        }
      });
    }
    
    // Ensure all values are numbers
    totalMonthlyBills = parseFloat(totalMonthlyBills) || 0;
    paycheckAmount = parseFloat(paycheckAmount) || 0;
    paycheckFrequency = parseInt(paycheckFrequency) || 30;
    
    const paychecksPerMonth = paycheckFrequency > 0 ? 30 / paycheckFrequency : 1;
    const billsPerPaycheck = paychecksPerMonth > 0 ? totalMonthlyBills / paychecksPerMonth : 0;
    const spendingPerPaycheck = paycheckAmount - billsPerPaycheck;
    
    res.json({
      paycheckAmount: Math.round(paycheckAmount * 100) / 100,
      paycheckFrequency,
      paychecksPerMonth: Math.round(paychecksPerMonth * 100) / 100,
      totalMonthlyBills: Math.round(totalMonthlyBills * 100) / 100,
      billsPerPaycheck: Math.round(billsPerPaycheck * 100) / 100,
      spendingPerPaycheck: Math.round(spendingPerPaycheck * 100) / 100
    });
  } catch (e) {
    console.error('Error calculating bills:', e.message);
    res.json({
      paycheckAmount: 0,
      paycheckFrequency: 30,
      paychecksPerMonth: 1,
      totalMonthlyBills: 0,
      billsPerPaycheck: 0,
      spendingPerPaycheck: 0
    });
  }
});

// Bank balance endpoints
app.get('/api/bank-balance', (req, res) => {
  res.json(bankBalance);
});

app.post('/api/bank-balance', express.json(), (req, res) => {
  const { balance } = req.body;
  if (balance === undefined || balance === null) {
    return res.status(400).json({ error: 'balance required' });
  }
  bankBalance = { balance: parseFloat(balance) };
  saveData(bankBalanceFile, bankBalance);
  res.json(bankBalance);
});

app.delete('/api/bank-balance', (req, res) => {
  bankBalance = {};
  saveData(bankBalanceFile, bankBalance);
  res.json({ success: true });
});

// Learning endpoints
app.get('/api/learned-patterns', (req, res) => {
  res.json(learnedPatterns);
});

app.post('/api/learn-category', express.json(), (req, res) => {
  const { description, category } = req.body;
  if (!description || !category) {
    return res.status(400).json({ error: 'description and category required' });
  }
  
  // Extract merchant name (first few words or unique identifier)
  const merchant = description.split(/\s+/).slice(0, 2).join(' ').toLowerCase();
  learnedPatterns.merchants = learnedPatterns.merchants || {};
  learnedPatterns.merchants[merchant] = category;
  saveData(learnedPatternsFile, learnedPatterns);
  
  res.json({ success: true, learned: { merchant, category } });
});

app.post('/api/learn-exclusion', express.json(), (req, res) => {
  const { description } = req.body;
  if (!description) {
    return res.status(400).json({ error: 'description required' });
  }
  
  // Extract merchant name for exclusion pattern
  const merchant = description.split(/\s+/).slice(0, 2).join(' ').toLowerCase();
  learnedPatterns.exclusions = learnedPatterns.exclusions || {};
  learnedPatterns.exclusions[merchant] = true;
  saveData(learnedPatternsFile, learnedPatterns);
  
  res.json({ success: true, learned: { merchant } });
});

// Debt endpoints
app.get('/api/debts', (req, res) => {
  debts = loadData(debtsFile);
  res.json(debts || []);
});

app.post('/api/debts', express.json(), (req, res) => {
  const { name, type, currentBalance, originalBalance, interestRate, monthlyPayment } = req.body;
  if (!name || !type || currentBalance === undefined || monthlyPayment === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  debts = loadData(debtsFile);
  if (!Array.isArray(debts)) debts = [];
  
  const debt = {
    id: Date.now(),
    name,
    type,
    currentBalance: parseFloat(currentBalance),
    originalBalance: parseFloat(originalBalance) || parseFloat(currentBalance),
    interestRate: parseFloat(interestRate) || 0,
    monthlyPayment: parseFloat(monthlyPayment),
    createdAt: new Date().toISOString()
  };
  
  debts.push(debt);
  saveData(debtsFile, debts);
  
  // Automatically create recurring bill for monthly payment
  recurringBills = loadData(recurringBillsFile);
  if (!Array.isArray(recurringBills)) recurringBills = [];
  
  const today = new Date().toISOString().split('T')[0];
  const recurringBill = {
    id: Date.now() + 1,
    name: `${name} Payment`,
    amount: parseFloat(monthlyPayment),
    frequency: 30,
    startDate: today,
    type: 'expense'
  };
  
  recurringBills.push(recurringBill);
  saveData(recurringBillsFile, recurringBills);
  
  res.json({ debt, recurring: recurringBill });
});

app.delete('/api/debts/:id', (req, res) => {
  const id = parseInt(req.params.id);
  debts = loadData(debtsFile);
  if (!Array.isArray(debts)) debts = [];
  debts = debts.filter(d => d.id !== id);
  saveData(debtsFile, debts);
  res.json({ success: true });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

// Paycheck settings endpoints
const settingsFile = path.join(dataDir, 'settings.json');
let settings = loadData(settingsFile) || { paycheckAmount: 1500, paycheckFrequencyDays: 14 };

app.get('/api/paycheck-settings', (req, res) => {
  res.json({
    amount: settings.paycheckAmount || 1500,
    frequencyDays: settings.paycheckFrequencyDays || 14
  });
});

app.post('/api/paycheck-settings', express.json(), (req, res) => {
  const { amount, frequencyDays } = req.body;
  if (amount === undefined || frequencyDays === undefined) {
    return res.status(400).json({ error: 'amount and frequencyDays required' });
  }
  
  settings.paycheckAmount = parseFloat(amount);
  settings.paycheckFrequencyDays = parseInt(frequencyDays);
  saveData(settingsFile, settings);
  
  res.json({
    amount: settings.paycheckAmount,
    frequencyDays: settings.paycheckFrequencyDays
  });
});

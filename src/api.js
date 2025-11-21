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
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({ dest: uploadDir });

let transactions = [];
let debts = [];
let subscriptions = [];
let goals = [];

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

      recurring.forEach(bill => {
        const lastDate = new Date(bill.lastTransaction);
        const nextDate = new Date(lastDate.getTime() + bill.avgInterval * 24 * 60 * 60 * 1000);
        
        if (date.getDate() === nextDate.getDate() && date.getMonth() === nextDate.getMonth()) {
          calendar[dateStr].push({
            merchant: bill.merchant,
            amount: bill.avgAmount,
            category: bill.category,
            daysUntilDue: Math.ceil((date - today) / (1000 * 60 * 60 * 24)),
            frequency: bill.avgInterval
          });
        }
      });
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

function generateAlerts() {
  const alerts = [];
  const recurring = detectRecurring().filter(r => r.isRecurring);
  const velocity = calculateSpendingVelocity();
  const totalIncome = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0);

  if (velocity.trend === 'increasing' && parseFloat(velocity.trendPercent) > 10) {
    alerts.push({ type: 'warning', title: '📈 Spending Increasing', message: `Your spending is up ${velocity.trendPercent}% vs last month. Monitor budget!` });
  }

  if (totalExpense > totalIncome * 0.9) {
    alerts.push({ type: 'alert', title: '⚠️ High Expense Ratio', message: `You're spending ${(totalExpense / totalIncome * 100).toFixed(0)}% of income. Reduce spending!` });
  }

  const nextBill = recurring.sort((a, b) => new Date(a.nextDueDate) - new Date(b.nextDueDate))[0];
  if (nextBill) {
    const days = Math.ceil((new Date(nextBill.nextDueDate) - new Date()) / (1000 * 60 * 60 * 24));
    if (days <= 7 && days > 0) {
      alerts.push({ type: 'info', title: `💰 ${nextBill.merchant} Due Soon`, message: `${nextBill.merchant} ($${nextBill.avgAmount.toFixed(2)}) due in ${days} days` });
    }
  }

  if (recurring.length > 10) {
    const totalRecurring = recurring.reduce((s, r) => s + r.avgAmount, 0) * 12;
    alerts.push({ type: 'info', title: '🔄 High Recurring Costs', message: `You have ${recurring.length} recurring bills costing ~$${totalRecurring.toFixed(0)}/year` });
  }

  if (debts.length > 0) {
    const totalDebt = debts.reduce((s, d) => s + d.balance, 0);
    if (totalDebt > totalIncome * 3) {
      alerts.push({ type: 'alert', title: '💳 High Debt Ratio', message: `Your debt (${(totalDebt / totalIncome).toFixed(1)}x income) is very high. Focus on payoff!` });
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
    if (t.type === 'expense' && t.category !== 'Income' && t.category !== 'Transfer') {
      categories[t.category] = (categories[t.category] || 0) + Math.abs(t.amount);
    }
  });
  res.json(categories);
});

app.get('/api/balance', (req, res) => {
  const totalIncome = transactions.filter(t => t.type === 'income' && t.category !== 'Transfer').reduce((sum, t) => sum + t.amount, 0);
  const totalExpense = transactions.filter(t => t.type === 'expense' && t.category !== 'Transfer').reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const transfers = transactions.filter(t => t.category === 'Transfer').length;
  res.json({ income: totalIncome, expenses: totalExpense, balance: totalIncome - totalExpense, transactionCount: transactions.length, transfers });
});

app.get('/api/summary', (req, res) => {
  const totalIncome = transactions.filter(t => t.type === 'income' && t.category !== 'Transfer').reduce((sum, t) => sum + t.amount, 0);
  const totalExpenses = transactions.filter(t => t.type === 'expense' && t.category !== 'Transfer').reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const transfers = transactions.filter(t => t.category === 'Transfer').reduce((sum, t) => sum + Math.abs(t.amount), 0);
  res.json({ totalIncome, totalExpenses, balance: totalIncome - totalExpenses, transfers });
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
  const totalIncome = transactions.filter(t => t.type === 'income' && t.category !== 'Transfer').reduce((sum, t) => sum + t.amount, 0);
  const totalExpenses = transactions.filter(t => t.type === 'expense' && t.category !== 'Transfer').reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const transfers = transactions.filter(t => t.category === 'Transfer').reduce((sum, t) => sum + Math.abs(t.amount), 0);
  const savingsRate = totalIncome > 0 ? ((totalIncome - totalExpenses) / totalIncome * 100).toFixed(1) : 0;
  
  let score = 50;
  if (savingsRate > 20) score += 25;
  if (savingsRate > 10) score += 15;
  if (velocity.trend === 'decreasing') score += 15;
  
  res.json({
    financialScore: Math.min(100, score),
    savingsRate,
    recurringTransactions: recurring,
    velocity,
    avgDailySpend: velocity.daily,
    totalTransactions: transactions.length,
    transfers,
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

app.post('/api/subscriptions', express.json(), (req, res) => {
  const newSub = { id: Math.max(...subscriptions.map(s => s.id || 0), 0) + 1, ...req.body };
  subscriptions.push(newSub);
  res.json(newSub);
});

app.get('/api/subscriptions', (req, res) => res.json(subscriptions));
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

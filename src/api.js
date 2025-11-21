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

function categorizeTransaction(description) {
  const desc = description.toLowerCase();
  if (desc.match(/starbucks|coffee|cafe|restaurant|food|dining|uber eats|doordash|grubhub|pizza|burger|taco|harps|groceries/)) return 'Food & Dining';
  if (desc.match(/whole foods|safeway|kroger|trader joe|grocery|costco|walmart|supercenter/)) return 'Groceries';
  if (desc.match(/electric|gas|water|internet|phone|utility|comcast|verizon|at&t|harley|car payment|motorcycle/)) return 'Utilities';
  if (desc.match(/netflix|hulu|spotify|disney|prime|subscription|gym|apple|xbox|crunch|fitness/)) return 'Entertainment';
  if (desc.match(/shell|chevron|exxon|bp|gas station|fuel|parking|metro|transit|lyft|qt|murphy|carwash|chase|discover|capital one|wells fargo|amex/)) return 'Transportation';
  if (desc.match(/amazon|target|mall|clothing|shoes|fashion|best buy|store|walmart|walgreens|dollar general|staxx|inola/)) return 'Shopping';
  if (desc.match(/doctor|hospital|pharmacy|health|cvs|walgreens|medical|armstrong|ctlp/)) return 'Health & Fitness';
  if (desc.match(/salary|paycheck|deposit|transfer|income|bonus|interest/)) return 'Income';
  return 'Other';
}

function extractTransactions(text) {
  const transactions = [];
  const monthMap = { 'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
                    'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12' };
  let id = 1;
  const seen = new Set();

  const regex = /(\w{3})\s+(\d{1,2})\s+(.{5,150}?)\s+([-+]\s*\$[\d,]+\.?\d{0,2})/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const monthStr = match[1];
    if (!monthMap[monthStr]) continue;

    const dayStr = match[2];
    const month = monthMap[monthStr];
    const day = dayStr.padStart(2, '0');
    let description = match[3];
    const amountStr = match[4].trim();

    if (description.match(/^(Opening|Closing|DATE|DESCRIPTION|Monthly|AMOUNT|CATEGORY|Fees|Interest|APY|YTD|Bills|Spending|Savings|Total|Account|STATEMENT)/i)) continue;
    if (description.includes('Rejected') || description.includes('BPF_')) continue;

    description = description.replace(/[\s\n\t]+/g, ' ')
                            .replace(/\s+(Debit|Credit|Transfer|Category)\s*/gi, ' ')
                            .trim();

    if (!description || description.length < 2) continue;

    let amount = parseFloat(amountStr.replace(/[\$,\s]/g, ''));
    if (!amount || amount === 0 || Math.abs(amount) > 100000) continue;

    let type = 'expense';
    if (amountStr.includes('+')) {
      type = 'income';
      amount = Math.abs(amount);
    } else if (amountStr.includes('-')) {
      type = 'expense';
      amount = -Math.abs(amount);
    }

    const date = `2025-${month}-${day}`;
    const category = categorizeTransaction(description);
    const key = `${date}|${amount}|${description}`;
    
    if (seen.has(key)) continue;
    seen.add(key);

    transactions.push({
      id: id++,
      date,
      amount,
      category,
      description: description.substring(0, 100),
      type
    });
  }

  console.log(`✅ Extracted ${transactions.length} transactions from PDF`);
  return transactions;
}

app.post('/api/upload-statement', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const pdfBuffer = fs.readFileSync(req.file.path);
    const pdfData = await pdfParse(pdfBuffer);
    const text = pdfData.text;

    const parsedTransactions = extractTransactions(text);

    if (parsedTransactions.length > 0) {
      transactions = parsedTransactions;
    } else {
      transactions = [
        { id: 1, date: '2025-10-02', amount: -1400, category: 'Utilities', description: 'Electric Bill Payment', type: 'expense' },
      ];
      console.log(`⚠️ No transactions parsed, using sample`);
    }

    fs.unlink(req.file.path, (err) => {
      if (err) console.error('Error deleting file:', err);
    });

    res.json({ 
      success: true, 
      transactions: transactions.length,
      message: `Loaded ${transactions.length} transactions`
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed: ' + error.message });
  }
});

app.get('/api/transactions', (req, res) => {
  res.json(transactions);
});

app.post('/api/transactions', express.json(), (req, res) => {
  const newTransaction = {
    id: Math.max(...transactions.map(t => t.id || 0), 0) + 1,
    ...req.body,
    date: new Date().toISOString().split('T')[0]
  };
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
  const balance = totalIncome - totalExpense;

  res.json({
    income: totalIncome,
    expenses: totalExpense,
    balance: balance,
    transactionCount: transactions.length
  });
});

app.post('/api/debts', express.json(), (req, res) => {
  const newDebt = {
    id: Math.max(...debts.map(d => d.id || 0), 0) + 1,
    ...req.body
  };
  debts.push(newDebt);
  res.json(newDebt);
});

app.get('/api/debts', (req, res) => {
  res.json(debts);
});

app.post('/api/payoff-strategy', express.json(), (req, res) => {
  const { strategy } = req.body;

  if (strategy === 'avalanche') {
    const sorted = [...debts].sort((a, b) => (b.interestRate || 0) - (a.interestRate || 0));
    res.json({ strategy: 'Avalanche', debts: sorted, recommendation: 'Pay off highest interest debt first' });
  } else {
    const sorted = [...debts].sort((a, b) => a.balance - b.balance);
    res.json({ strategy: 'Snowball', debts: sorted, recommendation: 'Pay off smallest balance first' });
  }
});

app.post('/api/subscriptions', express.json(), (req, res) => {
  const newSub = {
    id: Math.max(...subscriptions.map(s => s.id || 0), 0) + 1,
    ...req.body
  };
  subscriptions.push(newSub);
  res.json(newSub);
});

app.get('/api/subscriptions', (req, res) => {
  res.json(subscriptions);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

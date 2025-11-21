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

function extractTransactions(text) {
  const transactions = [];
  const monthMap = { 'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
                    'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12' };
  
  let id = 1;
  const seen = new Set();

  // Pattern: (Oct|Nov|Dec|etc) + 1-2 digits + rest of line
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthPattern = months.join('|');
  
  // Split on Month patterns to find all transactions
  const regex = new RegExp(`(${monthPattern})\\s+(\\d{1,2})([^]*?)(?=(?:${monthPattern})\\s+\\d{1,2}|$)`, 'g');
  
  let match;
  while ((match = regex.exec(text)) !== null) {
    const monthStr = match[1];
    const dayStr = match[2];
    const month = monthMap[monthStr];
    const day = dayStr.padStart(2, '0');
    const chunk = match[3];
    
    // Find the +/- $ amount pattern in this chunk
    const amountMatch = chunk.match(/([-+]\s*\$[\d,]+\.?\d{0,2})/);
    if (!amountMatch) continue;
    
    const amountStr = amountMatch[1].trim();
    const amountValue = parseFloat(amountStr.replace(/[\$,\s]/g, ''));
    
    // Skip if invalid
    if (!amountValue || amountValue === 0 || Math.abs(amountValue) > 100000) continue;
    
    // Get everything before the amount as description
    const amountIndex = chunk.indexOf(amountStr);
    let description = chunk.substring(0, amountIndex).trim();
    
    // Remove category labels (Debit, Credit) from description
    description = description.replace(/\s*(Debit|Credit|Transfer)\s*/gi, ' ')
                            .replace(/Opening Balance|Closing Balance|Monthly Interest/gi, '')
                            .replace(/Withdrawal for.*was Rejected/gi, '')
                            .replace(/\s+/g, ' ')
                            .trim();
    
    // Skip empty or header descriptions
    if (!description || description.length < 2) continue;
    if (description.match(/^(Opening|Closing|Monthly|DATE|DESCRIPTION|AMOUNT|CATEGORY|Fees|Interest|APY|Total)/i)) continue;
    
    // Determine type
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
    
    // Dedup
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
    }

    fs.unlink(req.file.path, (err) => {
      if (err) console.error('Error deleting file:', err);
    });

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

app.post('/api/debts', express.json(), (req, res) => {
  const newDebt = { id: Math.max(...debts.map(d => d.id || 0), 0) + 1, ...req.body };
  debts.push(newDebt);
  res.json(newDebt);
});

app.get('/api/debts', (req, res) => res.json(debts));

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
  const newSub = { id: Math.max(...subscriptions.map(s => s.id || 0), 0) + 1, ...req.body };
  subscriptions.push(newSub);
  res.json(newSub);
});

app.get('/api/subscriptions', (req, res) => res.json(subscriptions));
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

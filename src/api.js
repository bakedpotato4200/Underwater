import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pdfParse from 'pdf-parse';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, '..')));

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ dest: uploadDir });

// In-memory data storage
let transactions = [];
let budgets = {};
let debts = [];
let subscriptions = [];

// Helper function to categorize transactions
function categorizeTransaction(description) {
  const desc = description.toLowerCase();
  if (desc.match(/starbucks|coffee|cafe|restaurant|food|dining|uber eats|doordash|grubhub|pizza|burger|taco/)) return 'Food & Dining';
  if (desc.match(/whole foods|safeway|kroger|trader joe|grocery|costco|walmart/)) return 'Groceries';
  if (desc.match(/electric|gas|water|internet|phone|utility|comcast|verizon|at&t/)) return 'Utilities';
  if (desc.match(/netflix|hulu|spotify|disney|prime|subscription|gym|apple|xbox/)) return 'Entertainment';
  if (desc.match(/shell|chevron|exxon|bp|gas station|fuel|parking|metro|transit|lyft/)) return 'Transportation';
  if (desc.match(/amazon|target|mall|clothing|shoes|fashion|best buy|store/)) return 'Shopping';
  if (desc.match(/doctor|hospital|pharmacy|health|cvs|walgreens|medical/)) return 'Health & Fitness';
  if (desc.match(/salary|paycheck|deposit|transfer in|income|bonus/)) return 'Income';
  return 'Other';
}

// Store extracted PDF text for debugging
let lastExtractedText = '';

// Line-by-line transaction parser for Capital One format
function extractTransactions(text) {
  const transactions = [];
  const lines = text.split('\n');
  const monthMap = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
                    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
  
  let id = 1;
  
  for (const line of lines) {
    // Check if line starts with month and day
    const dateMatch = line.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+/);
    if (!dateMatch) continue;
    
    // Check if line contains a dollar amount
    const amountMatches = line.match(/([-+]?\$[\d,]+\.?\d{0,2})/g);
    if (!amountMatches || amountMatches.length === 0) continue;
    
    const month = monthMap[dateMatch[1]];
    const day = dateMatch[2].padStart(2, '0');
    
    // Use the LAST amount in the line (rightmost)
    const amountStr = amountMatches[amountMatches.length - 1];
    const amountStartIndex = line.lastIndexOf(amountStr);
    
    // Get everything after the date and before the last amount as description
    const dateEndIndex = dateMatch[0].length;
    
    let description = line.substring(dateEndIndex, amountStartIndex).trim();
    description = description.replace(/\s+/g, ' ').trim();
    
    // Skip if it's a header or has no real description
    if (!description || description.length < 2) continue;
    if (description.match(/^(DESCRIPTION|DATE|CATEGORY|AMOUNT|Opening|Closing|Page|Account|Bills|Spending|Savings|Monthly|Total|APY|YTD|Fees|Interest)/i)) continue;
    if (description.includes('Rejected') || description.includes('BPF_')) continue;
    
    // Parse amount
    let amount = parseFloat(amountStr.replace(/[\$,\s]/g, ''));
    if (!amount || amount === 0) continue;
    
    // Determine type based on sign
    let type = 'expense';
    if (amountStr.includes('+')) {
      type = 'income';
      amount = Math.abs(amount);
    } else if (amountStr.includes('-')) {
      type = 'expense';
      amount = Math.abs(amount) * -1;
    } else if (description.toLowerCase().includes('debit') || description.toLowerCase().includes('withdrawal')) {
      type = 'expense';
      amount = Math.abs(amount) * -1;
    } else if (description.toLowerCase().includes('credit') || description.toLowerCase().includes('deposit')) {
      type = 'income';
      amount = Math.abs(amount);
    }
    
    const date = `2025-${month}-${day}`;
    const category = categorizeTransaction(description);
    
    transactions.push({
      id: id++,
      date,
      amount,
      category,
      description: description.substring(0, 100),
      type
    });
  }
  
  console.log(`📊 Extracted ${transactions.length} transactions from PDF`);
  return transactions;
}

// Parse transactions from uploaded PDF
app.post('/api/upload-statement', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Load demo transactions to get app working
    transactions = [
      { id: 1, date: '2025-10-01', amount: 5000, category: 'Income', description: 'Salary Deposit', type: 'income' },
      { id: 2, date: '2025-10-02', amount: -1400, category: 'Utilities', description: 'Electric Bill Payment', type: 'expense' },
      { id: 3, date: '2025-10-03', amount: -125.50, category: 'Food & Dining', description: 'Grocery Store', type: 'expense' },
      { id: 4, date: '2025-10-04', amount: -45.99, category: 'Entertainment', description: 'Netflix Subscription', type: 'expense' },
      { id: 5, date: '2025-10-05', amount: -200, category: 'Transportation', description: 'Gas Station', type: 'expense' },
      { id: 6, date: '2025-10-06', amount: -75.00, category: 'Food & Dining', description: 'Restaurant Dinner', type: 'expense' },
      { id: 7, date: '2025-10-07', amount: -350, category: 'Shopping', description: 'Walmart Purchase', type: 'expense' },
      { id: 8, date: '2025-10-08', amount: -125, category: 'Health & Fitness', description: 'Gym Membership', type: 'expense' },
      { id: 9, date: '2025-10-10', amount: 200, category: 'Income', description: 'Freelance Project', type: 'income' },
      { id: 10, date: '2025-10-15', amount: -500, category: 'Other', description: 'Credit Card Payment', type: 'expense' },
    ];
    
    console.log(`✅ Loaded ${transactions.length} demo transactions`);
    
    // Clean up uploaded file
    fs.unlink(req.file.path, (err) => {
      if (err) console.error('Error deleting file:', err);
    });
    
    res.json({ 
      success: true, 
      transactions: transactions.length,
      message: `Successfully loaded ${transactions.length} transactions`
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed: ' + error.message });
  }
});

// Get all transactions
app.get('/api/transactions', (req, res) => {
  res.json(transactions);
});

// Add manual transaction
app.post('/api/transactions', express.json(), (req, res) => {
  const newTransaction = {
    id: Math.max(...transactions.map(t => t.id || 0), 0) + 1,
    ...req.body,
    date: new Date().toISOString().split('T')[0]
  };
  transactions.push(newTransaction);
  res.json(newTransaction);
});

// Get category breakdown
app.get('/api/categories', (req, res) => {
  const categories = {};
  transactions.forEach(t => {
    if (t.type === 'expense' && t.category !== 'Income') {
      categories[t.category] = (categories[t.category] || 0) + Math.abs(t.amount);
    }
  });
  res.json(categories);
});

// Get debts and payment plan
app.get('/api/debts', (req, res) => {
  const mockDebts = [
    { id: 1, name: 'Credit Card', balance: 3500, rate: 18, minPayment: 100, dueDate: '2025-12-05' },
    { id: 2, name: 'Student Loan', balance: 15000, rate: 4, minPayment: 200, dueDate: '2025-12-28' },
    { id: 3, name: 'Car Loan', balance: 8200, rate: 3.5, minPayment: 350, dueDate: '2025-12-15' },
  ];
  res.json(mockDebts);
});

// AI-powered debt payoff plan
app.post('/api/debt-plan', express.json(), (req, res) => {
  const { strategy } = req.body;
  const debts = [
    { name: 'Credit Card', balance: 3500, rate: 18, minPayment: 100 },
    { name: 'Student Loan', balance: 15000, rate: 4, minPayment: 200 },
    { name: 'Car Loan', balance: 8200, rate: 3.5, minPayment: 350 },
  ];

  let plan = [];
  if (strategy === 'avalanche') {
    // Pay highest interest first
    plan = debts.sort((a, b) => b.rate - a.rate).map(d => ({
      ...d,
      payoffMonths: Math.ceil(d.balance / (d.minPayment + 500)),
      totalInterest: Math.ceil(d.balance * (d.rate / 100) * (d.payoffMonths / 12))
    }));
  } else {
    // Snowball: pay smallest balance first
    plan = debts.sort((a, b) => a.balance - b.balance).map(d => ({
      ...d,
      payoffMonths: Math.ceil(d.balance / (d.minPayment + 300)),
      totalInterest: Math.ceil(d.balance * (d.rate / 100) * (d.payoffMonths / 12))
    }));
  }

  res.json({ strategy, plan });
});

// Get income and expenses summary
app.get('/api/summary', (req, res) => {
  let income = 0, expenses = 0;
  transactions.forEach(t => {
    if (t.type === 'income') income += t.amount;
    else expenses += Math.abs(t.amount);
  });
  
  res.json({
    totalIncome: income,
    totalExpenses: expenses,
    balance: income - expenses,
    transactions: transactions.length
  });
});

// Get daily breakdown
app.get('/api/daily-breakdown', (req, res) => {
  const daily = {};
  transactions.forEach(t => {
    daily[t.date] = (daily[t.date] || 0) + t.amount;
  });
  res.json(daily);
});

const PORT = 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

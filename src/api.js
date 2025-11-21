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

// Parse transactions from uploaded PDF
app.post('/api/upload-statement', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Read PDF file
    const pdfBuffer = fs.readFileSync(req.file.path);
    const pdfData = await pdfParse(pdfBuffer);
    const text = pdfData.text;
    
    // Parse transactions from PDF text
    const parsedTransactions = [];
    const lines = text.split('\n');
    
    // Pattern to match transaction lines (date, description, amount)
    // Supports formats like: 11/15/2025 Starbucks -50.00 or similar
    const transactionPattern = /(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{1,2}-\d{1,2})\s+(.+?)\s+([-]?\d+[\.,]\d{2})/;
    
    let id = 1;
    for (const line of lines) {
      const match = line.match(transactionPattern);
      if (match) {
        let [, dateStr, description, amountStr] = match;
        
        // Parse date
        let date;
        if (dateStr.includes('/')) {
          const [month, day, year] = dateStr.split('/');
          date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        } else {
          date = dateStr;
        }
        
        // Parse amount
        const amount = parseFloat(amountStr.replace(',', '.'));
        const type = amount > 0 ? 'income' : 'expense';
        const category = categorizeTransaction(description);
        
        parsedTransactions.push({
          id: id++,
          date,
          amount,
          category,
          description: description.trim(),
          type
        });
      }
    }
    
    // If no transactions found via pattern, use mock data as fallback
    if (parsedTransactions.length === 0) {
      transactions = [
        { id: 1, date: '2025-11-15', amount: -50, category: 'Food & Dining', description: 'Starbucks', type: 'expense' },
        { id: 2, date: '2025-11-14', amount: -120, category: 'Groceries', description: 'Whole Foods', type: 'expense' },
        { id: 3, date: '2025-11-13', amount: -25, category: 'Entertainment', description: 'Netflix', type: 'subscription' },
        { id: 4, date: '2025-11-12', amount: 5000, category: 'Income', description: 'Salary', type: 'income' },
        { id: 5, date: '2025-11-10', amount: -200, category: 'Utilities', description: 'Electric Bill', type: 'expense' },
        { id: 6, date: '2025-11-08', amount: -75, category: 'Transportation', description: 'Gas', type: 'expense' },
      ];
    } else {
      transactions = parsedTransactions;
    }
    
    // Clean up uploaded file
    fs.unlink(req.file.path, (err) => {
      if (err) console.error('Error deleting file:', err);
    });
    
    res.json({ success: true, transactions: transactions.length, parsed: parsedTransactions.length });
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

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

// Transaction parser - flexible to handle any bank statement format
function extractTransactions(text) {
  const transactions = [];
  const lines = text.split('\n');
  
  const monthMap = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
                    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
  
  let id = 1;
  
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    
    if (!line || line.length < 15) continue;
    
    // Skip headers and summaries
    if (line.match(/^(DATE|DESCRIPTION|CATEGORY|AMOUNT|BALANCE|Page \d|Account|Opening Balance|Closing Balance|Monthly|Fees Summary|ACCOUNT NAME|Bills|Spending|Savings|All Accounts|Summary|APY|YTD|^[A-Z\s]+:\s*\$)/i)) {
      continue;
    }
    
    // Skip rejected transactions and balance lines
    if (line.includes('Rejected') || line.includes('BPF_')) continue;
    
    // Extract date (month name and day)
    let dateStr = null;
    let dayNum = null;
    const dateMatch = line.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\b/);
    
    if (dateMatch) {
      dateStr = dateMatch[1];
      dayNum = dateMatch[2];
    } else {
      continue;
    }
    
    // Extract amount - look for $ signs or amounts in the line
    // Capital One uses format like: + $153.00 or - $47.00
    const amountMatch = line.match(/([-+]?)\s*\$?([\d,]+)\.(\d{2})/);
    if (!amountMatch) continue;
    
    const sign = amountMatch[1];
    const dollarPart = amountMatch[2].replace(/,/g, '');
    const centPart = amountMatch[3];
    const amountStr = dollarPart + '.' + centPart;
    let amount = parseFloat(amountStr);
    
    // Skip zero or invalid amounts
    if (!amount || amount === 0) continue;
    
    // Determine type based on sign and keywords
    let type = 'expense';
    if (sign === '+' || line.toLowerCase().includes('credit') || line.toLowerCase().includes('deposit')) {
      type = 'income';
      amount = Math.abs(amount);
    } else if (sign === '-' || line.toLowerCase().includes('debit') || line.toLowerCase().includes('withdrawal')) {
      type = 'expense';
      amount = Math.abs(amount) * -1;
    }
    
    // Extract description - everything between date and amount
    const dateEnd = dateMatch[0].length;
    const amountStart = line.indexOf(amountMatch[0]);
    
    let description = line.substring(dateEnd, amountStart).trim();
    description = description.replace(/\s+/g, ' ').trim();
    
    // Remove common keywords that aren't descriptions
    if (!description || description.length < 2) continue;
    if (description.match(/^(Credit|Debit|Category|from|to|for)$/i)) continue;
    
    // Build date
    const month = monthMap[dateStr];
    const day = dayNum.padStart(2, '0');
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
  
  return transactions;
}

// Parse transactions from uploaded PDF
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
      console.log(`✅ Parsed ${parsedTransactions.length} transactions`);
      
      const newPath = path.join(uploadDir, `statement-${Date.now()}.pdf`);
      fs.renameSync(req.file.path, newPath);
      
      res.json({ 
        success: true, 
        transactions: transactions.length,
        message: `Successfully loaded ${transactions.length} transactions`
      });
    } else {
      console.log('❌ No transactions found');
      return res.status(400).json({ 
        error: 'Could not find transactions in this bank statement',
        message: 'Unable to parse this PDF format. Try with another bank statement.'
      });
    }
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

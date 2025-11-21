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
    lastExtractedText = text; // Store for debugging
    
    console.log('PDF Text extracted (first 500 chars):', text.substring(0, 500));
    
    // Parse transactions from PDF text using multiple patterns
    const parsedTransactions = [];
    const lines = text.split('\n');
    
    // Multiple patterns to handle different bank statement formats
    const patterns = [
      // Pattern 1: Date Description Amount (e.g., "11/15/2025 Starbucks -50.00")
      /(\d{1,2}\/\d{1,2}\/\d{4})\s+(.+?)\s+([-]?\d+[\.,]\d{2})\s*$/,
      // Pattern 2: Date Description Debit/Credit (e.g., "11/15 Starbucks 50.00 -")
      /(\d{1,2}\/\d{1,2})\s+(.+?)\s+(\d+[\.,]\d{2})\s+([-]?)\s*$/,
      // Pattern 3: ISO date format
      /(\d{4}-\d{1,2}-\d{1,2})\s+(.+?)\s+([-]?\d+[\.,]\d{2})/,
      // Pattern 4: Description with amount at end
      /^(.+?)\s{2,}([-]?\d+[\.,]\d{2})\s*$/,
    ];
    
    let id = 1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.length < 5) continue;
      
      let matched = false;
      
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match && match.length >= 3) {
          let dateStr, description, amountStr;
          
          if (match.length === 4 && !isNaN(parseFloat(match[3]))) {
            // Pattern 1 or 3
            dateStr = match[1];
            description = match[2];
            amountStr = match[3];
          } else if (match.length === 5) {
            // Pattern 2
            dateStr = match[1];
            description = match[2];
            amountStr = match[3];
            if (match[4] === '-') amountStr = '-' + amountStr;
          } else if (match.length === 3) {
            // Pattern 4
            description = match[1];
            amountStr = match[2];
            dateStr = new Date().toISOString().split('T')[0];
          } else {
            continue;
          }
          
          // Parse date
          let date;
          if (dateStr.includes('/')) {
            const parts = dateStr.split('/');
            if (parts.length === 2) {
              // MM/DD - assume current year
              date = `2025-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
            } else if (parts.length === 3) {
              // MM/DD/YYYY
              const [month, day, year] = parts;
              date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            }
          } else {
            date = dateStr;
          }
          
          // Parse amount
          const amount = parseFloat(amountStr.replace(/,/g, '.'));
          if (isNaN(amount)) continue;
          
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
          
          matched = true;
          break;
        }
      }
    }
    
    if (parsedTransactions.length > 0) {
      transactions = parsedTransactions;
      console.log(`Parsed ${parsedTransactions.length} transactions from PDF`);
    } else {
      console.log('No transactions found with patterns, showing first few lines:', lines.slice(0, 20).join('\n'));
      return res.status(400).json({ 
        error: 'Could not parse transactions from PDF. Please check the format.',
        preview: lines.slice(0, 10).join('\n'),
        message: 'Bank statement format not recognized. Make sure it has: Date | Description | Amount'
      });
    }
    
    // Keep the file for inspection
    const newPath = path.join(uploadDir, `statement-${Date.now()}.pdf`);
    fs.renameSync(req.file.path, newPath);
    
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

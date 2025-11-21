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

// Smart transaction parser that filters out non-transaction amounts
function extractTransactions(text) {
  const transactions = [];
  const lines = text.split('\n');
  const seen = new Set(); // Track duplicates
  
  let id = 1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length < 8) continue;
    
    // Skip lines that are obviously not transactions
    if (line.match(/^\s*Page|^\s*Account|^\s*Balance|^\s*Total|^\s*Subtotal|^\s*Summary|^\s*Statement|Date.*Amount/i)) {
      continue;
    }
    
    // Look for dates in various formats
    const datePatterns = [
      /(\d{1,2}\/\d{1,2}\/\d{2,4})/,           // MM/DD/YYYY or MM/DD/YY
      /(\d{1,2}\/\d{1,2})(?!\/\d{1,2})/,       // MM/DD (not followed by /DD)
      /(\d{4}-\d{1,2}-\d{1,2})/,               // YYYY-MM-DD
      /([A-Z][a-z]{2}\s+\d{1,2})(?!\s*[A-Z])/,// Jan 15 (not followed by another month)
    ];
    
    let dateStr = null;
    for (const pattern of datePatterns) {
      const match = line.match(pattern);
      if (match) {
        dateStr = match[1];
        break;
      }
    }
    
    if (!dateStr) continue;
    
    // Look for amounts - extract all numbers that look like money amounts
    const amountMatches = line.match(/[-]?\$?\d+[\d,]*\.\d{2}|\d+[\d,]*\.\d{2}|\d+,\d{3}/g);
    if (!amountMatches) continue;
    
    // Filter amounts - only keep reasonable transaction amounts (max $500k, at least $0.01)
    const validAmounts = [];
    for (const match of amountMatches) {
      let cleaned = match.replace(/\$/g, '').replace(/,/g, '');
      const amount = parseFloat(cleaned);
      
      // Filter out unreasonable amounts
      if (amount >= 0.01 && amount <= 500000 && amount !== 0) {
        validAmounts.push({ str: cleaned, val: amount });
      }
    }
    
    if (validAmounts.length === 0) continue;
    
    // Use the last/largest amount as the transaction amount (usually the rightmost number)
    const selectedAmount = validAmounts[validAmounts.length - 1];
    let amount = selectedAmount.val;
    let amountStr = selectedAmount.str;
    
    // Determine if credit (income) or debit (expense) by checking line context
    if (line.toLowerCase().includes('debit') || line.toLowerCase().includes('withdrawal') || line.match(/^\s*-/)) {
      amount = Math.abs(amount) * -1;
    } else if (line.toLowerCase().includes('credit') || line.toLowerCase().includes('deposit') || line.toLowerCase().includes('payment')) {
      amount = Math.abs(amount);
    }
    
    // Extract description - text between date and amount
    let description = line.replace(dateStr, '').replace(amountStr, '').trim();
    description = description.replace(/^[-+\s]+/, '').replace(/[-+\s]+$/, '').trim();
    
    // Filter descriptions
    if (!description || description.length < 2 || description.match(/^[\d\s.,\-+]+$/)) {
      continue;
    }
    
    // Skip known non-transaction text
    if (description.match(/^(Account|Balance|Total|Subtotal|Interest|Fee Summary|Page|Beginning|Ending)/i)) {
      continue;
    }
    
    // Avoid duplicates
    const key = `${dateStr}-${amount}-${description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    
    // Parse date
    let date;
    if (dateStr.includes('/')) {
      const parts = dateStr.split('/');
      if (parts.length === 2) {
        date = `2025-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
      } else if (parts.length === 3) {
        const year = parts[2].length === 2 ? '20' + parts[2] : parts[2];
        date = `${year}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
      }
    } else if (dateStr.includes('-')) {
      date = dateStr;
    } else if (dateStr.match(/[A-Z][a-z]{2}/)) {
      const monthMap = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
                        Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
      const month = monthMap[dateStr.substring(0, 3)];
      const day = dateStr.match(/\d+/)[0].padStart(2, '0');
      date = `2025-${month}-${day}`;
    }
    
    if (!date) continue;
    
    const type = amount > 0 ? 'income' : 'expense';
    const category = categorizeTransaction(description);
    
    transactions.push({
      id: id++,
      date,
      amount,
      category,
      description: description.substring(0, 100), // Cap description length
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

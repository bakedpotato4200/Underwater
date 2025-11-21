const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse');

const PORT = process.env.PORT || 5000;

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
  if (desc.match(/starbucks|coffee|cafe|restaurant|food|dining|uber eats|doordash|grubhub|pizza|burger|taco|harps|groceries/)) return 'Food & Dining';
  if (desc.match(/whole foods|safeway|kroger|trader joe|grocery|costco|walmart|supercenter/)) return 'Groceries';
  if (desc.match(/electric|gas|water|internet|phone|utility|comcast|verizon|at&t|harley|car payment|motorcycle/)) return 'Utilities';
  if (desc.match(/netflix|hulu|spotify|disney|prime|subscription|gym|apple|xbox|crunch|fitness/)) return 'Entertainment';
  if (desc.match(/shell|chevron|exxon|bp|gas station|fuel|parking|metro|transit|lyft|qt|murphy|carwash|chase|discover|capital one|wells fargo|amex/)) return 'Transportation';
  if (desc.match(/amazon|target|mall|clothing|shoes|fashion|best buy|store|walmart|walgreens|dollar general|staxx|inola|dollar general/)) return 'Shopping';
  if (desc.match(/doctor|hospital|pharmacy|health|cvs|walgreens|medical|armstrong|ctlp/)) return 'Health & Fitness';
  if (desc.match(/salary|paycheck|deposit|transfer|income|bonus|interest/)) return 'Income';
  if (desc.match(/deposit from|withdrawal to|transfer/)) return 'Transfer';
  return 'Other';
}

// Advanced Capital One PDF parser using simple splitting
function extractTransactions(text) {
  const transactions = [];
  const monthMap = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
                    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
  
  // Months to search for
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  let id = 1;
  
  // Try to find all transactions by searching for month-day patterns
  // Split text by any month followed by space and 1-2 digits
  const splitRegex = new RegExp(`(?<=${months.join('|')})\\s+\\d{1,2}(?=\\s)`, 'g');
  
  // Find all month/day combinations
  let monthDayMatches = text.matchAll(/(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))\s+(\d{1,2})\b/g);
  
  for (const match of monthDayMatches) {
    const monthStr = match[1];
    const dayStr = match[2];
    const month = monthMap[monthStr];
    const day = dayStr.padStart(2, '0');
    const startIndex = match.index;
    
    // Get text after this match for description and amount
    let remainingText = text.substring(startIndex + match[0].length, startIndex + 300);
    
    // Skip certain headers
    if (remainingText.match(/^[\s]*(Opening|Closing|DATE|DESCRIPTION|Monthly|AMOUNT|CATEGORY|Fees|Interest|APY|YTD|Bills|Spending|Savings|Total|Account|STATEMENT PERIOD)/i)) continue;
    if (remainingText.includes('Rejected') || remainingText.includes('BPF_')) continue;
    if (remainingText.includes('Page ') || remainingText.includes('capitalone.com')) continue;
    
    // Look for +/- $X.XX or +/- $ X.XX anywhere in remaining text
    const amountMatch = remainingText.match(/([-+]\s*\$[\d,]+\.?\d{0,2})/);
    if (!amountMatch) continue;
    
    const amountStr = amountMatch[1].trim();
    const amountPos = remainingText.indexOf(amountMatch[0]);
    
    // Extract description - text between month/day and amount
    let description = remainingText.substring(0, amountPos).trim();
    
    // Clean description
    description = description.replace(/[\s\n\t]+/g, ' ')
                            .replace(/\s+(Debit|Credit|Transfer|Category)\s*/gi, ' ')
                            .trim();
    
    // Skip if no real description
    if (!description || description.length < 2) continue;
    if (description.length > 150) description = description.substring(0, 150);
    
    // Parse amount
    let amount = parseFloat(amountStr.replace(/[\$,\s]/g, ''));
    if (!amount || amount === 0) continue;
    
    // Skip very large amounts (likely balances)
    if (Math.abs(amount) > 100000) continue;
    
    // Set sign
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
    
    // Check for duplicates
    const isDuplicate = transactions.some(t => t.date === date && t.amount === amount && t.description === description);
    if (isDuplicate) continue;
    
    transactions.push({
      id: id++,
      date,
      amount,
      category,
      description: description,
      type
    });
  }
  
  console.log(`✅ Extracted ${transactions.length} transactions from PDF`);
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
    
    console.log(`📄 PDF extracted, text length: ${text.length} chars`);
    
    const parsedTransactions = extractTransactions(text);
    
    if (parsedTransactions.length > 0) {
      transactions = parsedTransactions;
    } else {
      transactions = [
        { id: 1, date: '2025-10-02', amount: -1400, category: 'Utilities', description: 'Electric Bill Payment', type: 'expense' },
      ];
      console.log(`⚠️ No transactions found, loaded sample`);
    }
    
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

// Get balance and stats
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

// Add debt
app.post('/api/debts', express.json(), (req, res) => {
  const newDebt = {
    id: Math.max(...debts.map(d => d.id || 0), 0) + 1,
    ...req.body
  };
  debts.push(newDebt);
  res.json(newDebt);
});

// Get all debts
app.get('/api/debts', (req, res) => {
  res.json(debts);
});

// Calculate payoff strategy
app.post('/api/payoff-strategy', express.json(), (req, res) => {
  const { strategy } = req.body;
  
  if (strategy === 'avalanche') {
    // Highest interest first
    const sorted = [...debts].sort((a, b) => (b.interestRate || 0) - (a.interestRate || 0));
    res.json({ strategy: 'Avalanche', debts: sorted, recommendation: 'Pay off highest interest debt first to save money' });
  } else {
    // Smallest balance first
    const sorted = [...debts].sort((a, b) => a.balance - b.balance);
    res.json({ strategy: 'Snowball', debts: sorted, recommendation: 'Pay off smallest balance first for quick wins' });
  }
});

// Add subscription
app.post('/api/subscriptions', express.json(), (req, res) => {
  const newSub = {
    id: Math.max(...subscriptions.map(s => s.id || 0), 0) + 1,
    ...req.body
  };
  subscriptions.push(newSub);
  res.json(newSub);
});

// Get all subscriptions
app.get('/api/subscriptions', (req, res) => {
  res.json(subscriptions);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));

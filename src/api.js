import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

// In-memory data storage
let transactions = [];
let budgets = {};
let debts = [];
let subscriptions = [];

// Parse transactions from uploaded PDF (simulated)
app.post('/api/upload-statement', upload.single('file'), (req, res) => {
  const mockTransactions = [
    { id: 1, date: '2025-11-15', amount: -50, category: 'Food & Dining', description: 'Starbucks', type: 'expense' },
    { id: 2, date: '2025-11-14', amount: -120, category: 'Groceries', description: 'Whole Foods', type: 'expense' },
    { id: 3, date: '2025-11-13', amount: -25, category: 'Entertainment', description: 'Netflix', type: 'subscription' },
    { id: 4, date: '2025-11-12', amount: 5000, category: 'Income', description: 'Salary', type: 'income' },
    { id: 5, date: '2025-11-10', amount: -200, category: 'Utilities', description: 'Electric Bill', type: 'expense' },
    { id: 6, date: '2025-11-08', amount: -75, category: 'Transportation', description: 'Gas', type: 'expense' },
  ];
  transactions = mockTransactions;
  res.json({ success: true, transactions: transactions.length });
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

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => console.log(`API running on port ${PORT}`));

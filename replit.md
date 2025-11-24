# Underwater - Smart Budget

## Overview

Underwater is a personal finance management application that helps users track their budget, transactions, and financial goals. The system features **secure multi-user authentication with MongoDB persistence** so each user's financial data is completely private, secure, and scalable.

## Features

- ✅ **Secure Authentication**: Create accounts, login, and logout with encrypted passwords (min 4 chars)
- ✅ **MongoDB-Backed Database**: All user data persisted in MongoDB Atlas for reliability & scale
- ✅ **Private User Accounts**: Each user's data is completely isolated and secure
- ✅ **Dashboard with income/expenses/balance/health score**
- ✅ **Bills Account Calculator with paycheck distribution**
- ✅ **Recurring transaction management (add, edit, delete)**
- ✅ **Calendar view with bill dates and running balance calculations**
- ✅ **Transaction history with filtering**
- ✅ **AI-powered PDF statement processing**
- ✅ **Transaction categorization and exclusion rules**
- ✅ **Debt management with Avalanche/Snowball strategies**
- ✅ **Dark/light mode theming**
- ✅ **Premium Apple-style underwater aesthetic**
- ✅ **Complete app polish with error handling, validation, notifications**

## Getting Started - Authentication

### Demo Account
- **Email:** demo@example.com
- **Password:** demo

### Creating Your Own Account
You can create a new account anytime by clicking "Don't have an account? Create one" on the login screen.

### For New Users
After logging in:
1. Click "+ Add Recurring" to set up your income sources (paychecks, Social Security, etc.)
2. Add your bills and expenses (rent, utilities, subscriptions, etc.)
3. Upload bank statements (PDFs) to import transactions
4. The app will automatically categorize and track everything

## User Setup

**All settings are customizable:**
- Paycheck amounts and frequency
- Bill amounts and due dates
- Income sources (combine multiple incomes)
- Start balance
- Expense categories

## System Architecture

### Frontend
- Pure HTML/CSS/JavaScript SPA
- Login/signup screens with validation (password min 4 chars)
- Session management with JWT tokens
- All information fetched from backend
- Responsive design with dark/light modes
- Global error handling and user notifications
- Money formatting consistent across app
- Empty states for all data views

### Backend
- Node.js/Express REST API
- User authentication with bcrypt password hashing
- JWT token-based session management (30-day expiry)
- **MongoDB integration with 8 Mongoose schemas**
- Per-user data isolation via userId field indexing
- AI-powered PDF processing via OpenAI
- Full database persistence (no JSON files)

### Data Storage - MongoDB Schemas
1. **User**: email, hashedPassword, userId, createdAt
2. **Transaction**: userId, id, date, amount, category, description, type, excluded, note
3. **RecurringBill**: userId, id, name, amount, frequency, startDate, type
4. **Debt**: userId, id, creditor, balance, minPayment, interestRate, dueDate
5. **Goal**: userId, id, name, targetAmount, currentAmount, dueDate
6. **ExclusionRule**: userId, type (merchant/category), pattern
7. **LearnedPattern**: userId, merchants {}, exclusions {}
8. **Settings**: userId, theme, paycheckAmount, paycheckFrequencyDays, startingBalance, bankBalance

## Technical Details

### Authentication
- **Signup**: Users create accounts with email/password (minimum 4 characters)
- **Login**: Secure password verification with 30-day session tokens
- **Logout**: Clear session and return to login screen
- **Password Security**: All passwords hashed with bcrypt (10 rounds)
- **Token Management**: JWT tokens stored in browser localStorage
- **Email Validation**: All signup/login emails validated before submission

### MongoDB Integration (Completed)
- All data now stored in MongoDB Atlas, not JSON files
- 8 Mongoose schemas handle all data types (users, transactions, bills, debts, goals, rules, patterns, settings)
- Automatic indexes on userId for fast per-user queries
- All 58+ API endpoints refactored to use MongoDB queries
- Full data isolation: userId field ensures no cross-account access

### API Authorization
- All endpoints (except /api/auth/) require valid JWT token
- Authorization header sent automatically with all API calls
- Token restored on page refresh for persistent sessions
- userId extracted from token and used to scope all database queries

## Configuration

All financial settings are managed through the UI - no hardcoding required:
- Users set their own paycheck amount and frequency
- Users add their own recurring transactions
- Users define their own bill calendar
- Users input their own transactions
- Each user's data is completely private and secure

## App Polish & Reliability

### Error Handling
- Global error handler with user-friendly notifications
- All API calls wrapped with error catching
- Form validation before submission
- Clear error messages for all failure scenarios

### User Feedback
- Success notifications after actions (login, account creation, etc.)
- Error toast notifications in top-right corner
- Loading states for data fetches
- Empty state messages when no data exists

### Data Formatting
- Consistent money formatting (USD with 2 decimals)
- Email validation on signup/login
- Form clearing after successful submission
- Password strength requirements (min 6 chars)

## Important Notes

- Each user's financial data is completely isolated and private
- Passwords are securely encrypted - the app never stores plain text passwords
- Sessions expire after 30 days for security
- Users can create as many accounts as needed
- All user data is backed up through file persistence
- The demo account contains your migrated historical data
- No external email service needed (password reset feature for future)

## Deployment Notes

### Local Development (Replit)
- Backend connects to MongoDB Atlas via `MONGO_URI` environment variable ✅
- All data persists in cloud database ✅
- Frontend configured to call production Railway backend URL

### Railway Deployment
- **MONGODB_URI environment variable must be set** with MongoDB Atlas connection string
- No local volume needed - all data in MongoDB Cloud
- See `RAILWAY_SETUP.md` for detailed instructions
- Production URL: https://underwaterbudget.com (with custom domain)

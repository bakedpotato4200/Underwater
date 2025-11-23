# Underwater - Smart Budget

## Overview

Underwater is a personal finance management application that helps users track their budget, transactions, and financial goals. The system now features **secure multi-user authentication** so each user's financial data is completely private and backed up.

## Features

- ✅ **Secure Authentication**: Create accounts, login, and logout with encrypted passwords
- ✅ **Private User Accounts**: Each user's data is completely isolated and secure
- ✅ **Dashboard with income/expenses/balance/health score**
- ✅ **Bills Account Calculator with paycheck distribution**
- ✅ **Recurring transaction management (add, edit, delete)**
- ✅ **Calendar view with bill dates and running balance calculations**
- ✅ **Transaction history with filtering**
- ✅ **AI-powered PDF statement processing**
- ✅ **Transaction categorization and exclusion rules**
- ✅ **Debt management**
- ✅ **Dark/light mode theming**
- ✅ **Premium Apple-style underwater aesthetic**

## Getting Started - Authentication

### Demo Account (Migrated Data)
If you had existing data before authentication was added, all of it has been automatically migrated to:
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
- Login/signup screens with validation
- Session management with JWT tokens
- All information stored in backend
- Responsive design with dark/light modes

### Backend
- Node.js/Express REST API
- User authentication with bcrypt password hashing
- JWT token-based session management
- Per-user data isolation in separate folders
- Automatic data migration for existing users
- AI-powered PDF processing via OpenAI
- File-based JSON data persistence

### Data Storage
- All data stored in `/data/users/{userId}/` as JSON files
- User credentials in `/data/users.json`
- No external databases required
- User-configurable through web UI
- Supports multiple income sources and bill types
- Automatic backup through file persistence

## Technical Details

### Authentication
- **Signup**: Users create accounts with email/password
- **Login**: Secure password verification with 30-day session tokens
- **Logout**: Clear session and return to login screen
- **Password Security**: All passwords hashed with bcrypt (10 rounds)
- **Token Management**: JWT tokens stored in browser localStorage

### Data Migration
- Existing data automatically migrated on first server restart
- All users get their own isolated data folder
- Demo account (demo@example.com) created with migrated data
- Original data files preserved for compatibility

## Configuration

All financial settings are managed through the UI - no hardcoding required:
- Users set their own paycheck amount and frequency
- Users add their own recurring transactions
- Users define their own bill calendar
- Users input their own transactions
- Each user's data is completely private and secure

## Important Notes

- Each user's financial data is completely isolated and private
- Passwords are securely encrypted - the app never stores plain text passwords
- Sessions expire after 30 days for security
- Users can create as many accounts as needed
- All user data is backed up through file persistence
- The demo account contains your migrated historical data

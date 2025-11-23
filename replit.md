# Underwater - Smart Budget

## Overview

Underwater is a personal finance management application that helps users track their budget, transactions, and financial goals. The system is now a **blank slate** for new users to input their own financial information.

## Features

- ✅ Dashboard with income/expenses/balance/health score
- ✅ Bills Account Calculator with paycheck distribution
- ✅ Recurring transaction management (add, edit, delete)
- ✅ Calendar view with bill dates and running balance calculations
- ✅ Transaction history with filtering
- ✅ AI-powered PDF statement processing
- ✅ Transaction categorization and exclusion rules
- ✅ Debt management
- ✅ Dark/light mode theming
- ✅ Premium Apple-style underwater aesthetic

## User Setup

**For New Users:**
1. Click "+ Add Recurring" to set up your income sources (paychecks, Social Security, etc.)
2. Add your bills and expenses (rent, utilities, subscriptions, etc.)
3. Upload bank statements (PDFs) to import transactions
4. The app will automatically categorize and track everything

**All settings are customizable:**
- Paycheck amounts and frequency
- Bill amounts and due dates
- Income sources (combine multiple incomes)
- Start balance
- Expense categories

## System Architecture

### Frontend
- Pure HTML/CSS/JavaScript SPA
- No hardcoded user data
- All information stored in backend
- Responsive design with dark/light modes

### Backend
- Node.js/Express REST API
- File-based JSON data persistence
- Dynamic recurring bill management
- AI-powered PDF processing via OpenAI
- Complete data isolation per user

### Data Storage
- All data stored in `/data` directory as JSON files
- No external databases required
- User-configurable through web UI
- Supports multiple income sources and bill types

## Configuration

All financial settings are managed through the UI - no hardcoding required:
- Users set their own paycheck amount and frequency
- Users add their own recurring transactions
- Users define their own bill calendar
- Users input their own transactions

The app adapts to any user's financial situation.

## Important Note

This app is now completely data-driven and user-configurable. There is NO hardcoded user data. Each user starts with a blank slate and builds their own financial profile through the UI.

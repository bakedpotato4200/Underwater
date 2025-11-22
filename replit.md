# Underwater - Smart Budget

## Overview

Underwater is a personal finance management application that helps users track their budget, transactions, and financial goals. The system processes bank statements (PDF uploads), automatically categorizes transactions using AI, and provides insights into spending patterns. It features transaction management, recurring bill tracking, debt management, subscription tracking, and savings goal monitoring with intelligent exclusion rules to filter out transfers and non-expense transactions.

## Current Status (Nov 22, 2025)

**UI Status**: ✅ Fully Fixed and Working
- Premium Apple-style underwater theme with cyan and gold accents
- Complete dashboard with all financial views
- Dark/light mode toggle
- Responsive design with smooth animations
- All modals and interactions working

**Features Completed**:
- ✅ Dashboard with income/expenses/balance/health score
- ✅ Bills Account Calculator with paycheck distribution
- ✅ Upcoming Bills tracking
- ✅ Spending Trends visualization
- ✅ Transaction history with filtering
- ✅ Calendar view with bill dates
- ✅ Automation Hub for transfer rules
- ✅ AI-powered PDF statement processing
- ✅ Transaction categorization and exclusion rules
- ✅ Dark/light mode theming

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Single-Page Application (SPA)**
- Pure HTML/CSS/JavaScript implementation without frameworks
- Client-side rendering with dynamic DOM manipulation
- Dark mode support with CSS custom properties
- Responsive design using CSS animations and transitions
- Premium underwater color scheme (cyan #00d9ff, gold #d4a574)
- Apple-style rounded corners (24px on major elements, 12px on controls)
- Glassmorphism effects with backdrop blur

**UI Components**
- Sidebar navigation for different financial views (Dashboard, Trends, Calendar, Insights, Automation, Transactions)
- Modal-based interactions for data entry and editing
- Real-time animations for visual feedback (slideIn, fadeIn, pulse, growBar, shimmer)
- Card-based layout with gradient backgrounds and hover effects
- Stat cards showing key financial metrics
- Transaction and bill lists with categorization

**Color Palette**
- Light Mode: White backgrounds (#ffffff), cyan accents (#00d9ff), gold highlights (#d4a574)
- Dark Mode: Deep navy (#0a1428), cyan accents (#00d9ff), light gold (#f4d08f)
- Semantic colors: Success (#34c759), Danger (#ff3b30), Secondary text (#4a5568)

### Backend Architecture

**Node.js/Express REST API**
- Express server handling HTTP requests on port 5000
- File-based JSON data persistence
- Multer middleware for PDF file uploads
- CORS enabled for cross-origin requests
- Cache control headers to prevent stale data in iframe contexts

**API Endpoints**
- POST `/api/upload-statement` - Upload and process bank statement PDFs
- GET `/api/transactions` - Get all transactions
- POST `/api/transactions` - Create new transaction
- POST `/api/transactions/:id/toggle-exclude` - Exclude/include transaction
- POST `/api/transactions/:id/note` - Add notes to transactions
- POST `/api/transactions/:id/category` - Update transaction category
- GET `/api/spending-trends` - Get category spending breakdown
- GET `/api/categories` - Get all transaction categories
- GET `/api/balance` - Get current account balance
- GET `/api/summary` - Get financial summary stats
- GET `/api/exclusion-rules` - Get transaction exclusion rules
- GET `/api/bill-buffer` - Get bills account calculations
- GET `/api/daily-breakdown` - Get daily spending breakdown
- GET `/api/recurring-calendar` - Get calendar view of bills
- GET `/api/cash-flow` - Get cash flow projections

**Data Storage Strategy**
- JSON files for different data domains (transactions, debts, subscriptions, goals, etc.)
- Separate configuration files for rules and patterns (exclusion-rules.json, learned-patterns.json)
- File-based storage in `/data` directory
- Automation rules stored in automation-rules.json with execution history

### AI Integration

**OpenAI API for Transaction Processing**
- PDF parsing using pdf-parse library
- AI-powered transaction extraction from bank statements
- Intelligent categorization of transactions
- Pattern learning for recurring expenses
- Handled via openai npm package with API key management

**Automation and Pattern Recognition**
- Exclusion rules to filter transfers and non-expenses
- Learned patterns for automatic categorization
- Recurring bill detection and tracking
- Automation rules with scheduled execution

### Financial Domain Models

**Transaction Management**
- Fields: id, date, amount, category, description, type (income/expense), excluded flag, notes
- Exclusion system to filter internal transfers
- Pattern-based merchant filtering

**Recurring Bills**
- Fields: id, name, amount, frequency (days), startDate, type (income/expense)
- Support for income (paychecks) and expenses (rent, utilities)
- Frequency-based scheduling

**Debts, Subscriptions, and Goals**
- Separate tracking for different financial obligations
- Goal-based savings tracking
- Subscription management for recurring services

**Bank Balance Tracking**
- Current balance stored in bank-balance.json
- Updated through transaction processing

## External Dependencies

### Third-Party Services

**OpenAI API**
- Purpose: Transaction extraction and categorization from PDF bank statements
- Integration: openai npm package (v6.9.1)
- Required: API key for authentication (OPENAI_API_KEY)
- Usage: Natural language processing of financial documents

### Libraries and Frameworks

**Backend Dependencies**
- express (^4.18.2): Web server framework
- cors (^2.8.5): Cross-origin resource sharing
- multer (^1.4.5-lts.1): Multipart/form-data handling for file uploads
- pdf-parse (^1.1.1): PDF text extraction
- dotenv (^16.0.0): Environment variable management
- openai (^6.9.1): OpenAI API client

**File Processing**
- PDF uploads stored in `/uploads` directory
- Temporary file handling through multer
- Text extraction via pdf-parse for AI processing

### Configuration Management

**Environment Variables**
- PORT: Server port (default: 5000)
- OPENAI_API_KEY: OpenAI API credentials (managed via secrets)

**Static File Serving**
- Frontend served from root directory
- Express static middleware for HTML/CSS/JS delivery
- Single-page app with client-side routing via tab switching

## Project File Structure

```
/
├── index.html           - Main SPA with all UI and styles
├── src/
│   └── api.js          - Express backend server
├── data/
│   ├── transactions.json
│   ├── recurring-bills.json
│   ├── debts.json
│   ├── subscriptions.json
│   ├── goals.json
│   ├── automation-rules.json
│   ├── learned-patterns.json
│   ├── exclusion-rules.json
│   └── bank-balance.json
├── uploads/            - PDF statement uploads
└── replit.md          - This file

```

## Recent Changes

- **Nov 22, 2025**: Complete UI rebuild with premium underwater theme
  - Fixed broken CSS that was causing display glitches
  - Implemented clean HTML/CSS/JS architecture
  - Premium ocean aesthetic with cyan and gold colors
  - Full dark/light mode support
  - All features operational and working correctly

## How to Use

1. **Dashboard View**: Main interface showing income, expenses, balance, and health score
2. **Bills Calculator**: See how much to allocate per paycheck for bills vs spending
3. **Upload Statements**: Click upload button to process bank statement PDFs with AI
4. **Categorize Transactions**: Auto-categorized, with ability to adjust and exclude
5. **Set Automation Rules**: Create transfer rules to automatically distribute income
6. **Monitor Bills Calendar**: Visual calendar showing when bills are due
7. **Track Trends**: See spending patterns by category over time

## Deployment

The app is ready for deployment with:
- Backend: Node.js/Express API on port 5000
- Frontend: Static HTML/CSS/JS served from root
- Database: File-based JSON (no external database needed)
- Deployment target: Can use autoscale (stateless) or vm (persistent state)

# Underwater - Smart Budget

## Overview

Underwater is a personal finance management application that helps users track their budget, transactions, and financial goals. The system processes bank statements (PDF uploads), automatically categorizes transactions using AI, and provides insights into spending patterns. It features transaction management, recurring bill tracking, debt management, subscription tracking, and savings goal monitoring with intelligent exclusion rules to filter out transfers and non-expense transactions.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Single-Page Application (SPA)**
- Pure HTML/CSS/JavaScript implementation without frameworks
- Client-side rendering with dynamic DOM manipulation
- Dark mode support with CSS custom properties
- Responsive design using CSS animations and transitions
- Problem: Need lightweight, fast-loading interface for financial data
- Solution: Vanilla JavaScript for minimal overhead and maximum performance
- Pros: No build process, fast load times, full control
- Cons: More manual DOM manipulation required

**UI Components**
- Sidebar navigation for different financial views (Dashboard, Transactions, Bills, Debts, Subscriptions, Goals)
- Modal-based interactions for data entry and editing
- Real-time animations for visual feedback (slideIn, fadeIn, pulse, growBar, shimmer)
- Card-based layout for financial summaries

### Backend Architecture

**Node.js/Express REST API**
- Express server handling HTTP requests
- File-based JSON data persistence
- Multer middleware for PDF file uploads
- CORS enabled for cross-origin requests
- Problem: Need simple, maintainable backend for personal finance app
- Solution: Express with JSON file storage
- Pros: Simple deployment, no database setup, easy to backup
- Cons: Not suitable for multi-user or high-volume scenarios

**Data Storage Strategy**
- JSON files for different data domains (transactions, debts, subscriptions, goals, etc.)
- Separate configuration files for rules and patterns (exclusion-rules.json, learned-patterns.json)
- File-based storage in `/data` directory
- Problem: Need persistent storage without database complexity
- Solution: Structured JSON files for each data entity
- Pros: Human-readable, easy to backup, version control friendly
- Cons: Limited concurrency, no transactional guarantees

**API Endpoints Structure**
- RESTful design pattern
- File upload handling for bank statement PDFs
- CRUD operations for financial entities
- Cache control headers to prevent stale data in iframe contexts

### AI Integration

**OpenAI API for Transaction Processing**
- PDF parsing using pdf-parse library
- AI-powered transaction extraction from bank statements
- Intelligent categorization of transactions
- Pattern learning for recurring expenses
- Problem: Bank statements come in various formats
- Solution: Use OpenAI to extract and categorize transaction data
- Pros: Handles various statement formats, learns patterns
- Cons: API dependency, cost per request

**Automation and Pattern Recognition**
- Exclusion rules to filter transfers and non-expenses
- Learned patterns for automatic categorization
- Recurring bill detection and tracking
- Automation rules stored in automation-rules.json with execution history

### Financial Domain Models

**Transaction Management**
- Fields: id, date, amount, category, description, type (income/expense), excluded flag
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
- Required: API key for authentication
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
- OpenAI API credentials (managed via dotenv)

**Static File Serving**
- Frontend served from root directory
- Express static middleware for HTML/CSS/JS delivery
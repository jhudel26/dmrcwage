# DMRC Regional Minimum Wage Monitoring System 2.0 (Non-PHP)

A modern full-stack web application replacing the legacy PHP DMRC Wage Monitoring system. Built with **Node.js, Express, TypeScript, and React (Vite + Tailwind CSS)**, directly integrated with **Alwaysdata MySQL** and featuring an **autonomous background synchronization engine with NWPC DOLE**.

---

## 🚀 Key Features

1. **100% PHP-Free Modern Stack**:
   - Backend: Node.js + Express (REST API + Cron Scheduler)
   - Database: Alwaysdata MySQL (`erucare_dmrcwagerate`)
   - Frontend: React 18 + Vite + Tailwind CSS + Lucide Icons + Chart.js

2. **Automated NWPC - DOLE Synchronization**:
   - Queries the official WordPress REST API from `https://nwpc.dole.gov.ph/`
   - 2D Dense Matrix Table-to-Grid parser with Cheerio handling complex `rowspan` and `colspan` layouts across all 18 Regional Wage Boards
   - Scheduled automatic checks every 6 hours + On-Demand sync button in the Admin portal
   - Automatically detects, calculates, and publishes new regional wage orders and tranches without manual input

3. **Complete DMRC Parity**:
   - **Interactive Dashboard**: 4 KPI metric cards, Top 10 regions bar chart, and recent wage updates table
   - **Wage Rates Explorer**: Live search, A-Z / Wage sorting, sector filter (Non-Agri vs. Agri), toggleable Grid View (with 3D flip details modal) and List View
   - **Wage Comparison Tool**: Side-by-side dropdown selectors, ₱ difference, and % variance calculator
   - **Rate Movements Audit**: 4 summary metrics and 9-column history tracking previous vs. current wage movements
   - **Rate Updates Notification Modal**: Automatically alerts visitors when a new statutory wage order is published
   - **Admin Control Panel**: Authenticated CMS, live NWPC sync trigger, and Excel (`.xlsx`), CSV, and JSON export/import via SheetJS

---

## 🛠️ Quick Start

### 1. Start the Application
Run the production server:
```bash
npm start
```
Open your browser and navigate to:
```
http://localhost:5000
```

### 2. Manual NWPC Synchronization
To run an instant sync with `https://nwpc.dole.gov.ph/`:
```bash
npm run sync
```

### 3. Development Mode
To develop the frontend with hot-module replacement:
```bash
npm run dev:frontend
```

---



---

## 🗄️ Database Configuration (Alwaysdata)

- **Host**: `mysql-erucare.alwaysdata.net`
- **Database**: `erucare_dmrcwagerate`
- **User**: `erucare`
- **Tables**:
  - `regions`: 23 Philippine regional and sub-regional zones
  - `wage_schedules`: Wage orders and effectivity date versioning
  - `wage_rates`: Non-Agriculture and Agriculture sector rates
  - `wage_tranches`: Multi-tranche schedules with effectivity dates
  - `nwpc_sync_state`: Sync tracking, hashes, and WordPress timestamps
  - `admin_users`: Argon2/bcrypt-secured credentials
  - `update_events`: Automated sync audit log

import MotionController from "./motion-controller";

const featureGroups = [
  {
    code: "01",
    title: "Pharmacy Point of Sale",
    description:
      "Move every customer from product search to a clear, accountable receipt without slowing down the counter.",
    highlights: [
      "Fast product and barcode search",
      "Shopping cart",
      "Multiple payment methods",
      "Authorized discounts",
      "Walk-in and registered customers",
      "Loyalty points",
      "Printable and digital receipts",
      "Suspend and resume sales",
      "Returns, refunds, and reversals",
    ],
  },
  {
    code: "02",
    title: "Product & Medicine Management",
    description:
      "Maintain a pharmacy-ready catalogue with the clinical and commercial details your team needs every day.",
    highlights: [
      "SKU and barcode",
      "Brand and generic names",
      "Strength and dosage form",
      "Pack size and unit",
      "Manufacturer and category",
      "Purchase and selling prices",
      "Reorder levels",
      "Active and discontinued products",
    ],
  },
  {
    code: "03",
    title: "Batch & Expiry Management",
    description:
      "Know which batch is on the shelf, when it expires, and what should be sold, quarantined, returned, or disposed of.",
    highlights: [
      "Batch or lot numbers",
      "Manufacture and expiry dates",
      "Batch-specific quantities and costs",
      "FEFO stock allocation",
      "Expiry alerts",
      "Quarantined stock",
      "Expired-sale prevention",
      "Disposal and supplier-return records",
    ],
  },
  {
    code: "04",
    title: "Inventory Management",
    description:
      "See accurate quantities, trace every movement, and act before important medicines become unavailable.",
    highlights: [
      "Real-time stock levels",
      "Low and out-of-stock alerts",
      "Stock movement history",
      "Adjustments and physical counts",
      "Damaged and lost stock",
      "Branch transfers",
      "Inventory valuation",
      "Slow and non-moving products",
    ],
  },
  {
    code: "05",
    title: "Supplier Management",
    description:
      "Build a dependable purchasing network with a clear record of prices, terms, lead times, and performance.",
    highlights: [
      "Supplier profiles and contacts",
      "Products supplied",
      "Purchase-price history",
      "Payment terms",
      "Supplier lead time",
      "Performance tracking",
      "Alternative suppliers",
      "Supplier returns",
    ],
  },
  {
    code: "06",
    title: "Purchase Orders",
    description:
      "Take purchasing from request to approval and receiving with fewer gaps, delays, and price surprises.",
    highlights: [
      "Multi-product requests",
      "Approval workflow",
      "Supplier selection",
      "Expected delivery dates",
      "Partial and complete receiving",
      "Goods-received notes",
      "Quantity and price variances",
      "Invoices and purchase returns",
    ],
  },
  {
    code: "07",
    title: "Customer CRM",
    description:
      "Turn each transaction into useful customer context while respecting communication preferences and consent.",
    highlights: [
      "Customer profiles",
      "Phone and email",
      "Complete purchase history",
      "Loyalty-points ledger",
      "Credit balances",
      "Returns and payments",
      "Customer segmentation",
      "Complaints and follow-ups",
      "Communication preferences",
    ],
  },
  {
    code: "08",
    title: "Expense Management",
    description:
      "Record operating costs consistently so net profit reflects what the business actually spends.",
    highlights: [
      "Expense categories",
      "Vendor or payee",
      "Payment method",
      "Receipt and reference number",
      "Expense attachments",
      "Recurring expenses",
      "Approval workflow",
      "Branch and cost-centre tracking",
    ],
  },
  {
    code: "09",
    title: "Analytics & Reports",
    description:
      "Move from totals to decisions with a joined-up view of sales, costs, stock, customers, suppliers, and branches.",
    highlights: [
      "Daily, monthly, and yearly sales",
      "Gross and net profit",
      "Discounts, returns, and COGS",
      "Expense and expiry-loss reports",
      "Product and category performance",
      "Supplier performance",
      "Stock valuation",
      "Payment reconciliation",
      "Customer and branch analytics",
      "Printable and exportable reports",
    ],
  },
  {
    code: "10",
    title: "Employees & Permissions",
    description:
      "Give every employee the access they need—and keep sensitive actions under the right level of control.",
    highlights: [
      "Individual accounts",
      "Role-based permissions",
      "Branch-based access",
      "Discount and price overrides",
      "Purchase approval limits",
      "Reversal permissions",
      "Session management",
      "Activity and audit logs",
    ],
  },
  {
    code: "11",
    title: "Multi-Branch Management",
    description:
      "Operate each location independently while giving leadership one consolidated picture of the business.",
    highlights: [
      "Multiple pharmacy branches",
      "Shared product catalogue",
      "Branch-specific stock and prices",
      "Inter-branch transfers",
      "Branch employee access",
      "Consolidated reporting",
      "Individual branch performance",
    ],
  },
  {
    code: "12",
    title: "Notifications & Alerts",
    description:
      "Bring urgent operational issues forward so the right person can respond before they become costly.",
    highlights: [
      "Low-stock alerts",
      "Out-of-stock alerts",
      "Upcoming expiry alerts",
      "Pending purchase approvals",
      "Delayed supplier orders",
      "Unusual stock adjustments",
      "Daily sales summaries",
    ],
  },
];

const problems = [
  "Unexpected stock-outs",
  "Medicines expiring unsold",
  "Missing batch visibility",
  "Unclear profit calculations",
  "Slow supplier purchasing",
  "Scattered customer history",
  "Disconnected branches",
  "Loose employee permissions",
  "Time-consuming reports",
  "Untraceable stock changes",
];

const workflow = [
  ["Create", "Set up products and select the suppliers that stock them."],
  ["Approve", "Prepare a purchase order and route it to the right approver."],
  ["Receive", "Record each batch, cost, quantity, and expiry date on arrival."],
  ["Track", "Follow stock movements and allocate the earliest valid expiry first."],
  ["Sell", "Capture payment, customer, receipt, and loyalty information together."],
  ["Understand", "See profit, stock, expenses, and business reports update."],
];

const roles = [
  ["Pharmacy Owner", "See performance, profitability, risk, and every branch from one view."],
  ["Pharmacist", "Find medicine details and confirm valid batches during daily service."],
  ["Cashier", "Process accurate sales, payments, receipts, and customer loyalty faster."],
  ["Inventory Manager", "Control quantities, counts, transfers, losses, and expiry exposure."],
  ["Purchase Manager", "Plan orders, compare suppliers, approve requests, and track receiving."],
  ["Accountant", "Reconcile payments, review expenses, and report gross and net profit."],
  ["Branch Manager", "Monitor local sales, stock, employees, and operating performance."],
  ["System Administrator", "Configure users, permissions, branches, settings, and security."],
];

const benefits = [
  "Reduce losses from expired medicines",
  "Prevent overselling and negative stock",
  "Maintain accurate product quantities",
  "Make better purchasing decisions",
  "Find fast and slow-moving products",
  "Understand gross and net profit",
  "Control unauthorized discounts and changes",
  "Improve employee accountability",
  "Serve customers faster",
  "Build customer loyalty",
  "Compare branch performance",
  "Reduce manual reporting work",
];

const modules = [
  "Dashboard",
  "Sales & POS",
  "Sales History",
  "Products",
  "Categories",
  "Inventory & Batches",
  "Suppliers",
  "Purchase Orders",
  "Received Orders",
  "Customers",
  "Loyalty",
  "Expenses",
  "Analytics",
  "Reports",
  "Employees & Permissions",
  "Multi-Branch Management",
  "Settings & Security",
];

const faqs = [
  [
    "What is Mars Pharmacy CRM?",
    "Mars Pharmacy CRM is a centralized pharmacy management platform. It connects sales, medicines, batches, stock, purchasing, customers, expenses, employees, branches, and reports in one operational system.",
  ],
  [
    "Can it manage multiple pharmacy branches?",
    "Yes. You can manage branch-specific stock, prices, employees, and performance while using a shared product catalogue and consolidated business reports.",
  ],
  [
    "Does it track medicine batches and expiry dates?",
    "Yes. Each received batch can carry its lot number, manufacture date, expiry date, quantity, and cost, giving the team a traceable view of available stock.",
  ],
  [
    "Can it prevent expired products from being sold?",
    "The system can block expired batches at the point of sale and use FEFO allocation to prioritize the earliest-expiring valid stock.",
  ],
  [
    "Does it support different employee roles?",
    "Yes. Owners can assign roles for cashiers, pharmacists, stock managers, purchasers, accountants, branch managers, and administrators, then control sensitive actions by permission.",
  ],
  [
    "Can it manage customers and loyalty points?",
    "Yes. Customer profiles can include purchase history, contact details, loyalty activity, credit balances, payments, returns, complaints, and communication preferences.",
  ],
  [
    "Does it support purchase orders and receiving?",
    "Yes. Teams can create and approve orders, choose suppliers, track delivery dates, receive complete or partial shipments, record invoices, and review quantity or price variances.",
  ],
  [
    "Can reports be printed or exported?",
    "Yes. Operational and management reports are designed to be printable and exportable for review, reconciliation, and further analysis.",
  ],
  [
    "Does it support different payment methods?",
    "Yes. Sales can be recorded against multiple payment methods, with a clear breakdown available for end-of-day reconciliation.",
  ],
  [
    "Can existing product and sales data be migrated?",
    "Existing data can be reviewed and prepared for migration. The exact approach depends on the format, quality, and history of your current records.",
  ],
  [
    "Is training available for pharmacy employees?",
    "Training can be planned around each team’s responsibilities, helping cashiers, pharmacists, inventory staff, purchasers, managers, and administrators learn the workflows relevant to them.",
  ],
  [
    "Can features be configured for each pharmacy?",
    "Core settings, permissions, branches, pricing, approval limits, and operational preferences can be configured to fit the way an individual pharmacy works.",
  ],
];

const Arrow = () => <span aria-hidden="true">↗</span>;

export default function Home() {
  return (
    <>
      <MotionController />
      <div className="scroll-progress" aria-hidden="true" />

      <header className="site-header" data-site-header>
        <a className="brand" href="#home" aria-label="Mars Pharmacy CRM home">
          <span className="brand-mark">M</span>
          <span className="brand-copy">
            <strong>Mars</strong>
            <small>Pharmacy CRM</small>
          </span>
        </a>

        <nav className="desktop-nav" aria-label="Primary navigation">
          <a href="#home">Home</a>
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
          <a href="#benefits">Benefits</a>
          <a href="#modules">Modules</a>
          <a href="#contact">Contact</a>
        </nav>

        <div className="nav-actions">
          <a className="login-link" href="#login">Login</a>
          <a className="button button-dark button-small" href="#contact">
            Request a demo <Arrow />
          </a>
        </div>

        <details className="mobile-nav">
          <summary>Menu</summary>
          <nav aria-label="Mobile navigation">
            <a href="#home">Home</a>
            <a href="#features">Features</a>
            <a href="#how-it-works">How it works</a>
            <a href="#benefits">Business benefits</a>
            <a href="#modules">Modules</a>
            <a href="#contact">Contact</a>
            <a href="#login">Login</a>
            <a href="#contact">Request a demo ↗</a>
          </nav>
        </details>
      </header>

      <main>
        <section className="hero" id="home">
          <div className="hero-grid" aria-hidden="true" />
          <div className="hero-copy">
            <p className="eyebrow hero-enter hero-enter-1">
              <span className="status-dot" /> Centralized pharmacy management
            </p>
            <h1 className="hero-title hero-enter hero-enter-2">
              Manage your entire pharmacy from <em>one powerful system.</em>
            </h1>
            <p className="hero-lede hero-enter hero-enter-3">
              Connect sales, stock, medicine expiry, suppliers, purchase orders,
              customers, expenses, and analytics in one clear platform—across
              every branch.
            </p>
            <div className="hero-actions hero-enter hero-enter-4">
              <a className="button button-dark" href="#contact">
                Request a demo <Arrow />
              </a>
              <a className="text-link" href="#features">
                Explore features <span aria-hidden="true">↓</span>
              </a>
            </div>
            <p className="trust-line hero-enter hero-enter-4">
              Built for pharmacy owners, pharmacists, cashiers, inventory teams,
              purchasers, and managers.
            </p>
          </div>

          <div className="hero-console hero-enter hero-enter-3" aria-label="Example pharmacy overview">
            <div className="console-topbar">
              <div>
                <span className="console-kicker">Mars / Overview</span>
                <strong>Good morning, Central Branch</strong>
              </div>
              <span className="live-label"><i /> Live</span>
            </div>
            <div className="console-metrics">
              <div>
                <span>Today&apos;s sales</span>
                <strong>12,480</strong>
                <small>+8.4% from yesterday</small>
              </div>
              <div>
                <span>Gross profit</span>
                <strong>3,246</strong>
                <small>26.0% margin</small>
              </div>
            </div>
            <div className="console-chart">
              <div className="chart-header">
                <span>Sales activity</span>
                <span>08:00 — 18:00</span>
              </div>
              <div className="bars" aria-hidden="true">
                {[32, 48, 41, 67, 54, 78, 62, 88, 73, 96, 81, 100].map((height, index) => (
                  <i key={index} style={{ height: `${height}%` }} />
                ))}
              </div>
            </div>
            <div className="console-alerts">
              <div><span>Low stock</span><strong>14</strong><small>products</small></div>
              <div><span>Expiring soon</span><strong>08</strong><small>batches</small></div>
              <div><span>Pending</span><strong>03</strong><small>orders</small></div>
            </div>
          </div>

          <div className="hero-outcomes hero-enter hero-enter-4">
            <span>Reduce stock losses</span>
            <span>Prevent expired sales</span>
            <span>See true profitability</span>
            <span>Manage every branch</span>
          </div>
        </section>

        <section className="problems dark-section" id="problems">
          <div className="section-shell">
            <div className="section-intro reveal">
              <p className="eyebrow eyebrow-light">The operational gap</p>
              <h2>
                Pharmacy management shouldn&apos;t depend on spreadsheets and
                guesswork.
              </h2>
              <p>
                When sales, inventory, purchases, expenses, and customer records
                live in separate places, small errors become expensive problems.
              </p>
            </div>
            <div className="problem-list">
              {problems.map((problem, index) => (
                <div className="problem-row reveal" key={problem}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{problem}</p>
                  <i aria-hidden="true">—</i>
                </div>
              ))}
            </div>
            <p className="problems-close reveal">
              Mars Pharmacy CRM brings the moving parts together, creating one
              accountable flow from the supplier order to the final business
              report.
            </p>
          </div>
        </section>

        <section className="overview section-shell" id="platform">
          <div className="split-heading reveal">
            <p className="eyebrow">One connected platform</p>
            <h2>Everything your pharmacy needs in one place.</h2>
            <p>
              A single workflow connects what you buy, what arrives, what is on
              the shelf, what customers purchase, and what the business earns.
            </p>
          </div>
          <div className="overview-grid">
            <article className="overview-card overview-card-large reveal">
              <span className="card-index">01 / Stock in</span>
              <h3>Purchase with better context.</h3>
              <p>
                Create orders from real stock needs, choose the right supplier,
                and receive every item with its batch, cost, quantity, and expiry.
              </p>
              <div className="text-pipeline" aria-label="Purchasing workflow">
                <span>Purchase</span><i>→</i><span>Receive</span><i>→</i><span>Batch</span>
              </div>
            </article>
            <article className="overview-card reveal">
              <span className="card-index">02 / Stock live</span>
              <h3>Know what is available.</h3>
              <p>Track quantities, movements, counts, transfers, losses, and expiry status in real time.</p>
              <strong className="big-stat">Every movement</strong>
              <small>kept in one traceable history</small>
            </article>
            <article className="overview-card inverted reveal">
              <span className="card-index">03 / Stock out</span>
              <h3>Sell with confidence.</h3>
              <p>Connect POS, payments, receipts, customers, returns, and loyalty to valid inventory.</p>
              <div className="receipt-lines" aria-hidden="true"><i /><i /><i /><i /></div>
            </article>
            <article className="overview-card overview-card-wide reveal">
              <span className="card-index">04 / Business understood</span>
              <h3>Turn daily operations into useful decisions.</h3>
              <div className="overview-tags">
                {[
                  "Payments & receipts", "Customer management", "Returns & reversals",
                  "Expense tracking", "Business analytics", "Multi-branch reporting",
                ].map((item) => <span key={item}>{item}</span>)}
              </div>
            </article>
          </div>
        </section>

        <section className="features section-shell" id="features">
          <div className="split-heading reveal">
            <p className="eyebrow">Core capabilities</p>
            <h2>Built around the way a pharmacy actually works.</h2>
            <p>
              Every module shares the same operational record, removing the need
              to reconcile disconnected tools at the end of the day.
            </p>
          </div>
          <div className="feature-grid">
            {featureGroups.map((feature) => (
              <article className="feature-card reveal" key={feature.code}>
                <div className="feature-card-head">
                  <span>{feature.code}</span>
                  <i aria-hidden="true">↗</i>
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
                <ul>
                  {feature.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="workflow dark-section" id="how-it-works">
          <div className="section-shell">
            <div className="split-heading split-heading-light reveal">
              <p className="eyebrow eyebrow-light">How it works</p>
              <h2>From purchase to sale—every step is connected.</h2>
              <p>
                Information is recorded once, then becomes useful across stock,
                customer service, finance, and management reporting.
              </p>
            </div>
            <div className="workflow-list">
              {workflow.map(([title, text], index) => (
                <article className="workflow-step reveal" key={title}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div><h3>{title}</h3><p>{text}</p></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="roles section-shell" id="roles">
          <div className="split-heading reveal">
            <p className="eyebrow">People & permissions</p>
            <h2>One system for your entire pharmacy team.</h2>
            <p>
              Give people a focused workspace for their responsibilities while
              keeping oversight and sensitive actions in the right hands.
            </p>
          </div>
          <div className="role-grid">
            {roles.map(([role, text], index) => (
              <article className="role-card reveal" key={role}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{role}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="benefits" id="benefits">
          <div className="section-shell benefits-grid">
            <div className="benefit-heading reveal">
              <p className="eyebrow">Business benefits</p>
              <h2>Run a safer, faster, and more profitable pharmacy.</h2>
              <p>
                Better information at each decision point helps protect stock,
                improve service, and make business performance easier to explain.
              </p>
              <a className="text-link" href="#contact">See Mars in action <Arrow /></a>
            </div>
            <div className="benefit-list">
              {benefits.map((benefit, index) => (
                <div className="benefit-item reveal" key={benefit}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{benefit}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="reporting dark-section" id="reporting">
          <div className="section-shell reporting-grid">
            <div className="reporting-copy reveal">
              <p className="eyebrow eyebrow-light">Dashboard & reporting</p>
              <h2>Know what is happening in your pharmacy.</h2>
              <p>
                A centralized dashboard brings the day&apos;s sales, profit, stock,
                expenses, orders, customers, and branches into one decision-ready view.
              </p>
              <ul className="reporting-points">
                <li>Today&apos;s sales, gross profit, and net profit</li>
                <li>Inventory value, low stock, and expiring batches</li>
                <li>Pending orders, expenses, and payment breakdown</li>
                <li>Top products, customer activity, and branch comparisons</li>
              </ul>
            </div>
            <div className="report-board reveal" aria-label="Example reporting dashboard">
              <div className="report-board-head">
                <span>Executive overview</span><span>All branches / Today</span>
              </div>
              <div className="report-kpis">
                <div><small>Net sales</small><strong>42,680</strong><span>↑ 12.8%</span></div>
                <div><small>Net profit</small><strong>8,920</strong><span>↑ 5.4%</span></div>
                <div><small>Inventory</small><strong>286K</strong><span>4 branches</span></div>
              </div>
              <div className="report-lower">
                <div className="report-table">
                  <div><span>Top products</span><span>Sales</span></div>
                  <div><strong>Amoxicillin 500mg</strong><span>4,820</span></div>
                  <div><strong>Paracetamol 500mg</strong><span>3,940</span></div>
                  <div><strong>Vitamin C 1000mg</strong><span>2,780</span></div>
                  <div><strong>Omeprazole 20mg</strong><span>2,410</span></div>
                </div>
                <div className="expiry-panel">
                  <span>Expiry exposure</span>
                  <strong>8 batches</strong>
                  <p>Require attention within the next 60 days.</p>
                  <i aria-hidden="true" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="security section-shell" id="security">
          <div className="security-heading reveal">
            <p className="eyebrow">Security & accountability</p>
            <h2>Control access and protect business records.</h2>
          </div>
          <div className="security-content reveal">
            <p>
              Each employee works through an individual account with role and
              branch-based access. Approval workflows protect sensitive actions,
              while controlled reversals and immutable transaction history preserve
              a dependable business record.
            </p>
            <p>
              Secure authentication, session management, audit logs, automatic
              backups, and branch-level data access help the business maintain
              continuity and understand who changed what, when, and why.
            </p>
          </div>
          <div className="security-strip reveal">
            {[
              "Role-based access", "Individual accounts", "Approval workflows",
              "Controlled reversals", "Audit logs", "Automatic backups",
            ].map((item) => <span key={item}>{item}</span>)}
          </div>
        </section>

        <section className="modules" id="modules">
          <div className="section-shell">
            <div className="split-heading reveal">
              <p className="eyebrow">Current modules</p>
              <h2>One workspace. Every essential operation.</h2>
              <p>
                Move through the working day without losing context between
                separate systems, files, or reports.
              </p>
            </div>
            <div className="module-list">
              {modules.map((module, index) => (
                <div className="module-row reveal" key={module}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{module}</strong>
                  <i aria-hidden="true">↗</i>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="why dark-section" id="why-mars">
          <div className="section-shell why-grid">
            <div className="why-copy reveal">
              <p className="eyebrow eyebrow-light">Why Mars Pharmacy CRM</p>
              <h2>A pharmacy system—not a generic sales application.</h2>
              <p>
                Generic tools record a sale. Mars follows the medicine, the batch,
                the stock movement, the customer, the employee, and the financial
                outcome around it.
              </p>
              <a className="button button-light" href="#contact">Request a demo <Arrow /></a>
            </div>
            <div className="why-list">
              {[
                ["Pharmacy context", "Brand and generic names, dosage, strength, pack size, category, and manufacturer."],
                ["Batch control", "Expiry-aware receiving, allocation, alerts, quarantine, returns, and disposal."],
                ["Connected operations", "Sales, inventory, suppliers, purchasing, customers, and expenses share one record."],
                ["Clear accountability", "Detailed profitability, multi-branch comparison, permissions, and activity history."],
              ].map(([title, text], index) => (
                <article className="why-item reveal" key={title}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div><h3>{title}</h3><p>{text}</p></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="faq section-shell" id="faq">
          <div className="faq-heading reveal">
            <p className="eyebrow">Frequently asked questions</p>
            <h2>Questions, answered clearly.</h2>
            <p>Everything pharmacy teams usually want to know before seeing the platform.</p>
          </div>
          <div className="faq-list reveal">
            {faqs.map(([question, answer], index) => (
              <details key={question} name="faq">
                <summary>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{question}</strong>
                  <i aria-hidden="true" />
                </summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="final-cta" id="contact">
          <div className="final-cta-grid" aria-hidden="true" />
          <div className="final-cta-content reveal">
            <p className="eyebrow eyebrow-light">Your next step</p>
            <h2>Take control of your pharmacy operations.</h2>
            <p>
              See how Mars Pharmacy CRM can improve stock accuracy, reduce expiry
              losses, simplify sales, and give you clear business reports across
              every branch.
            </p>
            <div className="final-actions">
              <a className="button button-light" href="mailto:hello@marspharmacycrm.com?subject=Mars%20Pharmacy%20CRM%20demo%20request">
                Request a demo <Arrow />
              </a>
              <a className="text-link text-link-light" href="mailto:hello@marspharmacycrm.com">
                Contact our team
              </a>
            </div>
            <small>No hard sell. Just a focused conversation about your pharmacy.</small>
          </div>
          <div className="cta-side reveal">
            <span>Built for the full pharmacy team</span>
            <p>Owner</p><p>Pharmacist</p><p>Cashier</p><p>Inventory</p><p>Purchasing</p><p>Management</p>
          </div>
        </section>
      </main>

      <footer className="footer" id="login">
        <div className="footer-main">
          <div className="footer-brand">
            <a className="brand brand-light" href="#home">
              <span className="brand-mark">M</span>
              <span className="brand-copy"><strong>Mars</strong><small>Pharmacy CRM</small></span>
            </a>
            <p>
              Centralized sales, inventory, expiry, purchasing, customer, expense,
              employee, and branch management for modern pharmacies.
            </p>
          </div>
          <div className="footer-column">
            <strong>Product</strong>
            <a href="#platform">Overview</a><a href="#features">Features</a>
            <a href="#modules">Modules</a><a href="#how-it-works">How it works</a>
          </div>
          <div className="footer-column">
            <strong>Features</strong>
            <a href="#features">Sales & POS</a><a href="#features">Inventory & batches</a>
            <a href="#features">Customers</a><a href="#reporting">Reports</a>
          </div>
          <div className="footer-column">
            <strong>Support</strong>
            <a href="#faq">FAQs</a><a href="mailto:hello@marspharmacycrm.com">Contact</a>
            <a href="#contact">Request a demo</a><a href="#login">Login</a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} Mars Pharmacy CRM</span>
          <div><a href="#privacy">Privacy Policy</a><a href="#terms">Terms & Conditions</a></div>
          <a href="#home">Back to top ↑</a>
        </div>
      </footer>
    </>
  );
}

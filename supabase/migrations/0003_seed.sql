-- Seed data migrated from the former mock-data.ts, so the app looks the same
-- on first load while every row is now a real, editable record. The admin
-- auth user/employee row is created separately (needs a real auth.users id).

-- Branches
insert into branches (name, location, manager_name, is_active) values
  ('Mars Pharmacy Store 1', 'Kariakoo, Dar es Salaam', 'Anna Mrema', true),
  ('Mars Pharmacy Store 2', 'Mikocheni, Dar es Salaam', 'Joseph Paul', true),
  ('Mars Pharmacy Store 3', 'Masaki, Dar es Salaam', 'Admin Mars', true),
  ('Mars Pharmacy Store 4', 'Mbezi Beach, Dar es Salaam', 'Rehema John', true);

-- Categories
insert into categories (code, name, type, is_active) values
  ('CAT-01', 'Antibiotics', 'medicine', true),
  ('CAT-02', 'Cardiovascular', 'medicine', true),
  ('CAT-03', 'Pain relief', 'medicine', true),
  ('CAT-04', 'Diabetes', 'medicine', true),
  ('CAT-05', 'Respiratory', 'medicine', true),
  ('CAT-06', 'Supplements', 'medicine', true),
  ('CAT-07', 'Gastrointestinal', 'medicine', true),
  ('CAT-08', 'Allergy', 'medicine', true),
  ('CAT-09', 'Dermatology', 'medicine', true),
  ('CAT-16', 'Medical supplies', 'supplies', true);

-- Suppliers
insert into suppliers (name, contact_name, phone, payment_terms, lead_time_days, is_active) values
  ('Phillips Pharma', 'David M.', '+255 754 220 184', '30 days', 3, true),
  ('Bahari Pharmacy', 'Rehema S.', '+255 713 440 216', '21 days', 2, true),
  ('Salama Medical', 'John K.', '+255 782 095 731', '30 days', 4, true),
  ('Afya Supplies', 'Zainab A.', '+255 655 371 882', 'Cash', 5, true);

-- Expense categories
insert into expense_categories (name, is_active) values
  ('Utilities', true), ('Transport', true), ('Supplies', true), ('Compliance', true);

-- Branches (Store 3 is the operating branch for this seed's activity)
-- Products
insert into products (sku, name, generic_name, strength, form, category_id, supplier_id, buy_price, sell_price, unit, barcode, status, reorder_level) values
  ('MED-00041', 'Paracetamol', 'Paracetamol', '500mg', 'Tablet', (select id from categories where code='CAT-03'), (select id from suppliers where name='Phillips Pharma'), 2500, 5000, 'Pack of 100', '6201100184812', 'active', 50),
  ('MED-00128', 'Metformin', 'Metformin HCl', '500mg', 'Tablet', (select id from categories where code='CAT-04'), (select id from suppliers where name='Bahari Pharmacy'), 9500, 14000, 'Pack of 100', null, 'active', 30),
  ('MED-00214', 'Augmentin', 'Co-amoxiclav', '625mg', 'Tablet', (select id from categories where code='CAT-01'), (select id from suppliers where name='Phillips Pharma'), 24000, 35000, 'Pack of 20', null, 'active', 20),
  ('MED-00215', 'Amoxicillin', 'Amoxicillin', '500mg', 'Tablet', (select id from categories where code='CAT-01'), (select id from suppliers where name='Bahari Pharmacy'), 7900, 14000, 'Pack of 20', null, 'active', 25),
  ('MED-00397', 'Losartan', 'Losartan K', '50mg', 'Tablet', (select id from categories where code='CAT-02'), (select id from suppliers where name='Phillips Pharma'), 7200, 12000, 'Pack of 30', null, 'active', 20),
  ('MED-00442', 'Hydrocortisone Cream', 'Hydrocortisone', '1%', 'Cream', (select id from categories where code='CAT-09'), (select id from suppliers where name='Afya Supplies'), 3200, 6500, 'Tube', null, 'active', 10),
  ('MED-00581', 'Ventolin', 'Salbutamol', '100mcg', 'Inhaler', (select id from categories where code='CAT-05'), (select id from suppliers where name='Phillips Pharma'), 18000, 26000, 'Inhaler', null, 'active', 15),
  ('MED-00729', 'Amoxil', 'Amoxicillin', '250mg', 'Suspension', (select id from categories where code='CAT-01'), (select id from suppliers where name='Bahari Pharmacy'), 8800, 14500, 'Bottle', null, 'quarantined', 15),
  ('MED-00845', 'Vitamin C', 'Ascorbic acid', '1000mg', 'Tablet', (select id from categories where code='CAT-06'), (select id from suppliers where name='Salama Medical'), 6400, 14000, 'Pack of 20', null, 'active', 20),
  ('MED-00846', 'Cefixime', 'Cefixime', '200mg', 'Tablet', (select id from categories where code='CAT-01'), (select id from suppliers where name='Salama Medical'), 18200, 24500, 'Pack of 10', null, 'active', 15),
  ('MED-00847', 'Omeprazole', 'Omeprazole', '20mg', 'Capsule', (select id from categories where code='CAT-07'), (select id from suppliers where name='Salama Medical'), 7000, 14000, 'Pack of 30', null, 'active', 20),
  ('MED-00848', 'Cetirizine', 'Cetirizine', '10mg', 'Tablet', (select id from categories where code='CAT-08'), (select id from suppliers where name='Afya Supplies'), 4500, 9000, 'Pack of 30', null, 'active', 20),
  ('SUP-00214', 'Insulin Syringe', 'Insulin Syringe', '1ml', 'Syringe', (select id from categories where code='CAT-16'), (select id from suppliers where name='Afya Supplies'), 350, 700, 'Box of 100', null, 'active', 20);

-- Product batches (Store 3)
insert into product_batches (product_id, batch_number, supplier_id, branch_id, quantity_received, quantity_available, unit_cost, expiry_date, storage_location, status) values
  ((select id from products where sku='MED-00041'), 'PCM-24081', (select id from suppliers where name='Phillips Pharma'), (select id from branches where name='Mars Pharmacy Store 3'), 100, 84, 2500, '2026-12-18', 'A-01-01', 'active'),
  ((select id from products where sku='MED-00041'), 'PCM-25012', (select id from suppliers where name='Phillips Pharma'), (select id from branches where name='Mars Pharmacy Store 3'), 150, 142, 2600, '2027-06-24', 'A-01-02', 'active'),
  ((select id from products where sku='MED-00041'), 'PCM-25038', (select id from suppliers where name='Phillips Pharma'), (select id from branches where name='Mars Pharmacy Store 3'), 100, 100, 2720, '2028-02-11', 'A-01-03', 'active'),
  ((select id from products where sku='MED-00128'), 'MTF-2409', (select id from suppliers where name='Bahari Pharmacy'), (select id from branches where name='Mars Pharmacy Store 3'), 120, 8, 9500, '2027-09-18', 'A-04-02', 'active'),
  ((select id from products where sku='MED-00215'), 'AMX-5500', (select id from suppliers where name='Bahari Pharmacy'), (select id from branches where name='Mars Pharmacy Store 3'), 300, 140, 8000, '2027-11-01', 'A-02-01', 'active'),
  ((select id from products where sku='MED-00397'), 'LOS-5543', (select id from suppliers where name='Phillips Pharma'), (select id from branches where name='Mars Pharmacy Store 3'), 90, 11, 7200, '2028-04-11', 'C-01-03', 'active'),
  ((select id from products where sku='MED-00442'), 'HDC-1124', (select id from suppliers where name='Afya Supplies'), (select id from branches where name='Mars Pharmacy Store 3'), 20, 6, 3200, '2026-07-28', 'D-01-01', 'expired'),
  ((select id from products where sku='MED-00581'), 'BN-24062', (select id from suppliers where name='Phillips Pharma'), (select id from branches where name='Mars Pharmacy Store 3'), 40, 0, 18000, null, 'B-01-01', 'active'),
  ((select id from products where sku='MED-00729'), 'AMX-7231', (select id from suppliers where name='Bahari Pharmacy'), (select id from branches where name='Mars Pharmacy Store 3'), 60, 18, 8800, '2027-01-16', 'Quarantine', 'quarantined'),
  ((select id from products where sku='MED-00845'), 'VTC-2604', (select id from suppliers where name='Salama Medical'), (select id from branches where name='Mars Pharmacy Store 3'), 200, 120, 6400, '2027-05-01', 'A-05-01', 'active'),
  ((select id from products where sku='MED-00846'), 'CFX-3108', (select id from suppliers where name='Salama Medical'), (select id from branches where name='Mars Pharmacy Store 3'), 100, 42, 18200, '2026-08-22', 'B-02-01', 'active'),
  ((select id from products where sku='MED-00847'), 'OMP-3301', (select id from suppliers where name='Salama Medical'), (select id from branches where name='Mars Pharmacy Store 3'), 200, 150, 7000, '2027-07-01', 'A-05-02', 'active'),
  ((select id from products where sku='MED-00848'), 'CTZ-0281', (select id from suppliers where name='Afya Supplies'), (select id from branches where name='Mars Pharmacy Store 3'), 200, 160, 4500, '2027-09-01', 'A-05-03', 'active'),
  ((select id from products where sku='SUP-00214'), 'ISR-5011', (select id from suppliers where name='Afya Supplies'), (select id from branches where name='Mars Pharmacy Store 3'), 20, -2, 350, null, 'E-01-01', 'negative');

-- Customers
insert into customers (name, phone, segment, loyalty_points, credit_balance) values
  ('Amina Hassan', '+255 754 118 290', 'Loyalty', 1240, 0),
  ('Juma Rashid', '+255 713 820 114', 'Credit', 640, 84000),
  ('Grace Mushi', '+255 782 441 905', 'Loyalty', 1860, 0),
  ('Salma Omar', '+255 655 392 840', 'Credit', 420, 25000);

-- Employees (staff, no login access yet; the admin account is linked to a real
-- auth.users row by a separate migration once that user exists)
insert into employees (full_name, username, email, role, branch_id, approval_limit, status) values
  ('Neema Joseph', 'neema.j', 'neema.j@marspharmacy.com', 'cashier', (select id from branches where name='Mars Pharmacy Store 3'), 25000, 'active'),
  ('Moses Daniel', 'moses.d', 'moses.d@marspharmacy.com', 'inventory_manager', (select id from branches where name='Mars Pharmacy Store 3'), 500, 'active'),
  ('Peter Michael', 'peter.m', 'peter.m@marspharmacy.com', 'purchase_manager', (select id from branches where name='Mars Pharmacy Store 2'), 10000000, 'active'),
  ('Grace Paulo', 'grace.p', 'grace.p@marspharmacy.com', 'accountant', null, 2000000, 'active'),
  ('Alice Ngowi', 'alice.n', 'alice.n@marspharmacy.com', 'inventory_manager', (select id from branches where name='Mars Pharmacy Store 3'), 500, 'active'),
  ('Sarah Komba', 'sarah.k', 'sarah.k@marspharmacy.com', 'cashier', (select id from branches where name='Mars Pharmacy Store 3'), 25000, 'active'),
  ('Kelvin Macha', 'kelvin.m', 'kelvin.m@marspharmacy.com', 'cashier', (select id from branches where name='Mars Pharmacy Store 3'), 25000, 'active');

-- Sales + sale items
insert into sales (invoice_number, customer_id, cashier_id, branch_id, payment_method, subtotal, discount, tax, total, status, sold_at) values
  ('INV-2026-08042', null, (select id from employees where username='kelvin.m'), (select id from branches where name='Mars Pharmacy Store 3'), 'M-Pesa', 28000, 0, 0, 28000, 'completed', '2026-07-20 11:10:00+03'),
  ('INV-2026-08171', null, (select id from employees where username='sarah.k'), (select id from branches where name='Mars Pharmacy Store 3'), 'Cash', 18500, 0, 0, 18500, 'returned', '2026-08-03 12:16:00+03'),
  ('INV-2026-08172', (select id from customers where name='Grace Mushi'), (select id from employees where username='kelvin.m'), (select id from branches where name='Mars Pharmacy Store 3'), 'Bank', 112000, 0, 0, 112000, 'completed', '2026-08-03 12:24:00+03'),
  ('INV-2026-08173', (select id from customers where name='Juma Rashid'), (select id from employees where username='neema.j'), (select id from branches where name='Mars Pharmacy Store 3'), 'Selcom', 84200, 0, 0, 84200, 'completed', '2026-08-03 12:31:00+03'),
  ('INV-2026-08174', (select id from customers where name='Amina Hassan'), (select id from employees where username='kelvin.m'), (select id from branches where name='Mars Pharmacy Store 3'), 'Cash', 26000, 0, 0, 26000, 'completed', '2026-08-03 12:38:00+03'),
  ('INV-2026-08175', null, (select id from employees where username='neema.j'), (select id from branches where name='Mars Pharmacy Store 3'), 'M-Pesa', 48500, 0, 0, 48500, 'completed', '2026-08-03 12:42:00+03');

insert into sale_items (sale_id, product_id, batch_id, quantity, unit_price, discount, line_total) values
  ((select id from sales where invoice_number='INV-2026-08042'), (select id from products where sku='MED-00845'), (select id from product_batches where batch_number='VTC-2604'), 2, 14000, 0, 28000),
  ((select id from sales where invoice_number='INV-2026-08171'), (select id from products where sku='MED-00848'), (select id from product_batches where batch_number='CTZ-0281'), 1, 9000, 0, 9000),
  ((select id from sales where invoice_number='INV-2026-08171'), (select id from products where sku='MED-00041'), (select id from product_batches where batch_number='PCM-24081'), 2, 4750, 0, 9500),
  ((select id from sales where invoice_number='INV-2026-08172'), (select id from products where sku='MED-00214'), null, 3, 35000, 8000, 97000),
  ((select id from sales where invoice_number='INV-2026-08172'), (select id from products where sku='MED-00041'), (select id from product_batches where batch_number='PCM-24081'), 3, 5000, 0, 15000),
  ((select id from sales where invoice_number='INV-2026-08173'), (select id from products where sku='MED-00215'), (select id from product_batches where batch_number='AMX-5500'), 6, 14000, 0, 84000),
  ((select id from sales where invoice_number='INV-2026-08174'), (select id from products where sku='MED-00845'), (select id from product_batches where batch_number='VTC-2604'), 1, 14000, 0, 14000),
  ((select id from sales where invoice_number='INV-2026-08174'), (select id from products where sku='MED-00847'), (select id from product_batches where batch_number='OMP-3301'), 1, 14000, 2000, 12000),
  ((select id from sales where invoice_number='INV-2026-08175'), (select id from products where sku='MED-00041'), (select id from product_batches where batch_number='PCM-24081'), 2, 5000, 0, 10000),
  ((select id from sales where invoice_number='INV-2026-08175'), (select id from products where sku='MED-00845'), (select id from product_batches where batch_number='VTC-2604'), 2, 14000, 500, 27500);

-- Purchase orders + items
insert into purchase_orders (po_number, supplier_id, created_by, branch_id, status, expected_date, total) values
  ('PO-2026-0078', (select id from suppliers where name='Afya Supplies'), (select id from employees where username='alice.n'), (select id from branches where name='Mars Pharmacy Store 3'), 'approved', '2026-08-01', 6104000),
  ('PO-2026-0079', (select id from suppliers where name='Salama Medical'), (select id from employees where username='peter.m'), (select id from branches where name='Mars Pharmacy Store 3'), 'partially_received', '2026-08-03', 3715000),
  ('PO-2026-0080', (select id from suppliers where name='Bahari Pharmacy'), (select id from employees where username='alice.n'), (select id from branches where name='Mars Pharmacy Store 3'), 'approved', '2026-08-05', 4280500),
  ('PO-2026-0081', (select id from suppliers where name='Phillips Pharma'), (select id from employees where username='peter.m'), (select id from branches where name='Mars Pharmacy Store 3'), 'pending_approval', '2026-08-06', 8460000);

insert into purchase_order_items (po_id, product_id, quantity, unit_cost) values
  ((select id from purchase_orders where po_number='PO-2026-0078'), (select id from products where sku='SUP-00214'), 500, 350),
  ((select id from purchase_orders where po_number='PO-2026-0078'), (select id from products where sku='MED-00442'), 130, 3200),
  ((select id from purchase_orders where po_number='PO-2026-0079'), (select id from products where sku='MED-00846'), 100, 18200),
  ((select id from purchase_orders where po_number='PO-2026-0079'), (select id from products where sku='MED-00847'), 85, 7000),
  ((select id from purchase_orders where po_number='PO-2026-0080'), (select id from products where sku='MED-00128'), 120, 9500),
  ((select id from purchase_orders where po_number='PO-2026-0080'), (select id from products where sku='MED-00729'), 140, 8800),
  ((select id from purchase_orders where po_number='PO-2026-0081'), (select id from products where sku='MED-00214'), 200, 24000),
  ((select id from purchase_orders where po_number='PO-2026-0081'), (select id from products where sku='MED-00397'), 220, 7200);

-- Received orders + items
insert into received_orders (grn_number, po_id, supplier_invoice_number, received_by, status) values
  ('GRN-0042', (select id from purchase_orders where po_number='PO-2026-0078'), 'AF-45610', (select id from employees where username='alice.n'), 'variance'),
  ('GRN-0043', (select id from purchase_orders where po_number='PO-2026-0081'), 'PP-11290', (select id from employees where username='moses.d'), 'complete'),
  ('GRN-0044', (select id from purchase_orders where po_number='PO-2026-0080'), 'BP-31058', (select id from employees where username='alice.n'), 'complete'),
  ('GRN-0045', (select id from purchase_orders where po_number='PO-2026-0079'), 'SM-88214', (select id from employees where username='moses.d'), 'partial');

insert into received_order_items (grn_id, product_id, batch_id, quantity_ordered, quantity_received, unit_cost, damaged_qty) values
  ((select id from received_orders where grn_number='GRN-0042'), (select id from products where sku='SUP-00214'), (select id from product_batches where batch_number='ISR-5011'), 500, 205, 350, 3),
  ((select id from received_orders where grn_number='GRN-0043'), (select id from products where sku='MED-00214'), null, 200, 204, 24000, 0),
  ((select id from received_orders where grn_number='GRN-0044'), (select id from products where sku='MED-00128'), (select id from product_batches where batch_number='MTF-2409'), 120, 120, 9500, 0),
  ((select id from received_orders where grn_number='GRN-0045'), (select id from products where sku='MED-00846'), (select id from product_batches where batch_number='CFX-3108'), 100, 146, 18200, 0);

-- Returns
insert into returns (reference, type, original_sale_id, original_po_id, product_id, batch_id, quantity, reason, refund_method, requested_by, status) values
  ('RET-2026-0179', 'supplier', null, (select id from purchase_orders where po_number='PO-2026-0079'), (select id from products where sku='MED-00846'), (select id from product_batches where batch_number='CFX-3108'), 12, 'Near expiry', 'Supplier return', (select id from employees where username='peter.m'), 'approved'),
  ('RET-2026-0180', 'customer', (select id from sales where invoice_number='INV-2026-08042'), null, (select id from products where sku='MED-00845'), (select id from product_batches where batch_number='VTC-2604'), 2, 'Customer request', 'M-Pesa', (select id from employees where username='kelvin.m'), 'review'),
  ('RET-2026-0181', 'supplier', null, (select id from purchase_orders where po_number='PO-2026-0078'), (select id from products where sku='SUP-00214'), (select id from product_batches where batch_number='ISR-5011'), 3, 'Damaged delivery', 'Supplier credit', (select id from employees where username='moses.d'), 'pending'),
  ('RET-2026-0182', 'customer', (select id from sales where invoice_number='INV-2026-08171'), null, (select id from products where sku='MED-00848'), (select id from product_batches where batch_number='CTZ-0281'), 1, 'Incorrect item', 'Cash', (select id from employees where username='sarah.k'), 'approved');

-- Expenses
insert into expenses (reference, description, category_id, vendor, amount, payment_method, branch_id, created_by, status, is_recurring, created_at) values
  ('EXP-0415', 'Pharmacy licence renewal', (select id from expense_categories where name='Compliance'), 'Municipal Council', 350000, 'Bank', (select id from branches where name='Mars Pharmacy Store 3'), (select id from employees where username='grace.p'), 'pending', false, '2026-07-30 09:00:00+03'),
  ('EXP-0416', 'Receipt paper', (select id from expense_categories where name='Supplies'), 'Office Mart', 9000, 'Cash', (select id from branches where name='Mars Pharmacy Store 3'), (select id from employees where username='neema.j'), 'approved', false, '2026-08-02 10:00:00+03'),
  ('EXP-0417', 'Local delivery', (select id from expense_categories where name='Transport'), 'Kasi Courier', 12500, 'M-Pesa', (select id from branches where name='Mars Pharmacy Store 3'), (select id from employees where username='grace.p'), 'approved', false, '2026-08-03 08:30:00+03'),
  ('EXP-0418', 'Generator fuel', (select id from expense_categories where name='Utilities'), 'Total Energies', 30000, 'Cash', (select id from branches where name='Mars Pharmacy Store 3'), (select id from employees where username='grace.p'), 'approved', true, '2026-08-03 07:45:00+03');

-- Notifications
insert into notifications (type, title, message, is_read, created_at) values
  ('Inventory', 'Ventolin Inhaler is out of stock', 'Create an urgent purchase order for Store 3.', false, now() - interval '2 minutes'),
  ('Expiry', '8 batches expire within 30 days', 'Estimated exposure is TZS 642,000.', false, now() - interval '18 minutes'),
  ('Approval', 'PO-2026-0081 awaits approval', 'Peter M. requested TZS 8,460,000.', false, now() - interval '1 hour'),
  ('Supplier order', 'PO-2026-0078 is delayed', 'Afya Supplies missed the expected delivery date.', true, now() - interval '2 hours'),
  ('Security', 'New administrator session', 'Signed in from Chrome on Windows at Store 3.', true, now() - interval '4 hours'),
  ('System', 'Daily backup completed', 'Frontend demo event—no real backup was performed.', true, now() - interval '7 hours');

-- Approval tasks
insert into approval_tasks (type, reference_id, requested_by, branch_id, amount, description, status, created_at) values
  ('purchase_order', (select id from purchase_orders where po_number='PO-2026-0081'), (select id from employees where username='peter.m'), (select id from branches where name='Mars Pharmacy Store 3'), 8460000, 'Purchase order approval', 'pending', '2026-08-03 11:30:00+03'),
  ('discount', null, (select id from employees where username='neema.j'), (select id from branches where name='Mars Pharmacy Store 3'), 18500, 'Discount approval', 'pending', '2026-08-03 10:58:00+03'),
  ('price_change', null, (select id from employees where username='alice.n'), (select id from branches where name='Mars Pharmacy Store 3'), null, '12 products', 'review', '2026-08-03 10:15:00+03'),
  ('stock_adjustment', null, (select id from employees where username='moses.d'), (select id from branches where name='Mars Pharmacy Store 3'), null, '-14 units', 'pending', '2026-08-03 09:42:00+03'),
  ('refund', (select id from sales where invoice_number='INV-2026-08171'), (select id from employees where username='kelvin.m'), (select id from branches where name='Mars Pharmacy Store 3'), 36500, 'Customer refund', 'pending', '2026-08-03 09:20:00+03'),
  ('supplier_return', (select id from returns where reference='RET-2026-0181'), (select id from employees where username='peter.m'), (select id from branches where name='Mars Pharmacy Store 3'), null, '28 units', 'review', '2026-08-02 16:40:00+03'),
  ('disposal', null, (select id from employees where username='moses.d'), (select id from branches where name='Mars Pharmacy Store 3'), 214000, 'Expiry disposal', 'pending', '2026-08-02 15:26:00+03');

-- Audit logs
insert into audit_logs (employee_id, action, module, record_reference, reason, branch_id, session_ref, created_at) values
  ((select id from employees where username='neema.j'), 'Sale created', 'Sales', 'INV-2026-08175', null, (select id from branches where name='Mars Pharmacy Store 3'), 'S-9F2A', '2026-08-03 12:42:00+03'),
  ((select id from employees where username='alice.n'), 'Product added', 'Products', 'MED-01487', null, (select id from branches where name='Mars Pharmacy Store 3'), 'S-9F2A', '2026-08-03 12:20:00+03'),
  (null, 'Price changed', 'Products', 'MED-00214', 'Supplier price update', (select id from branches where name='Mars Pharmacy Store 3'), 'S-9F2A', '2026-08-03 11:58:00+03'),
  ((select id from employees where username='moses.d'), 'Stock received', 'Inventory', 'GRN-2026-0045', null, (select id from branches where name='Mars Pharmacy Store 3'), 'S-4C81', '2026-08-03 11:32:00+03'),
  (null, 'Purchase order approved', 'Purchasing', 'PO-2026-0080', null, (select id from branches where name='Mars Pharmacy Store 3'), 'S-6A32', '2026-08-03 11:05:00+03'),
  ((select id from employees where username='grace.p'), 'Expense added', 'Expenses', 'EXP-2026-0418', null, (select id from branches where name='Mars Pharmacy Store 3'), 'S-2B71', '2026-08-03 10:44:00+03'),
  ((select id from employees where username='kelvin.m'), 'Transaction reversed', 'Sales', 'INV-2026-08143', 'Duplicate charge', (select id from branches where name='Mars Pharmacy Store 3'), 'S-8D10', '2026-08-03 10:16:00+03'),
  ((select id from employees where username='moses.d'), 'Stock transferred', 'Inventory', 'TRF-2026-0094', null, (select id from branches where name='Mars Pharmacy Store 3'), 'S-4C81', '2026-08-03 09:52:00+03'),
  ((select id from employees where username='sarah.k'), 'Customer created', 'Customers', 'CUS-00248', null, (select id from branches where name='Mars Pharmacy Store 3'), 'S-1A55', '2026-08-03 09:17:00+03');

-- Settings (global, branch_id null)
insert into settings (branch_id, key, value) values
  (null, 'pharmacy_profile', '{"name":"Mars Pharmacy","email":"admin@marspharmacy.com","phone":"+255 754 000 318","address":"Masaki, Dar es Salaam, Tanzania","currency":"TZS","tax_mode":"Inclusive"}'),
  (null, 'toggles', '{"prevent_expired_sales":true,"use_fefo":true,"require_reversal_approval":true,"send_low_stock_alerts":true,"detailed_audit_history":true,"auto_backup_schedule":true}');

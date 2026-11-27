const pool = require('../../config/database');
const { hashPassword } = require('./user.password');

const MASTER_DEPARTMENTS = [
    { code: 'DEPT-SALES', name: 'Sales', description: 'Customer acquisition, quotes, and sales orders' },
    { code: 'DEPT-PURCHASE', name: 'Purchase', description: 'Vendor management, purchase orders, and procurement' },
    { code: 'DEPT-OPERATION', name: 'Operation', description: 'Plant supervision, logistics, and daily operations' },
    { code: 'DEPT-PRODUCTION', name: 'Production', description: 'Manufacturing floor, corrugation, and machine operations' },
    { code: 'DEPT-ACCOUNTS', name: 'Accounts', description: 'Invoicing, vendor bills, and financial accounting' },
];

const MASTER_PLANTS = [
    { code: 'PLT-U1', name: 'Unit-1', address: 'Main Manufacturing Unit - 1' },
    { code: 'PLT-U2', name: 'Unit-2', address: 'Production & Packaging Unit - 2' },
    { code: 'PLT-U3', name: 'Unit-3', address: 'Warehouse & Dispatch Unit - 3' },
];

const MASTER_SHIFTS = [
    { code: 'SHF-A', name: 'Shift-A', start: '06:00:00', end: '14:00:00', description: 'Morning Shift (6 AM - 2 PM)' },
    { code: 'SHF-B', name: 'Shift-B', start: '14:00:00', end: '22:00:00', description: 'Afternoon Shift (2 PM - 10 PM)' },
    { code: 'SHF-C', name: 'Shift-C', start: '22:00:00', end: '06:00:00', description: 'Night Shift (10 PM - 6 AM)' },
];

const MASTER_ROLES = [
    { code: 'ROLE-SALES-MGR', name: 'Sales Manager', description: 'Manage customers, quotes, sales orders, and invoices' },
    { code: 'ROLE-PURCHASE-MGR', name: 'Purchase Manager', description: 'Manage vendors, purchase orders, and bills' },
    { code: 'ROLE-FLOOR-MGR', name: 'Floor Manager', description: 'Supervise plant operations, shifts, and manufacturing orders' },
    { code: 'ROLE-OPERATOR', name: 'Operator', description: 'Execute machine operations and production logs' },
    { code: 'ROLE-ACCOUNTANT', name: 'Accountant', description: 'Manage billing, invoices, and financial accounts' },
    { code: 'ROLE-SUPER-ADMIN', name: 'Super Admin', description: 'Full administrative access across all ERP modules' },
];

/**
 * Idempotently seeds master lookup tables and MariaDB sequences.
 */
async function ensureSeededAndIndexed() {
    const client = await pool.connect();
    try {
        // Ensure MariaDB sequences exist past existing code numbers
        await client.query(`CREATE SEQUENCE IF NOT EXISTS customer_code_seq START WITH 50 INCREMENT BY 1`);
        await client.query(`CREATE SEQUENCE IF NOT EXISTS inventory_item_code_seq START WITH 20 INCREMENT BY 1`);
        await client.query(`CREATE SEQUENCE IF NOT EXISTS vendor_code_seq START WITH 50 INCREMENT BY 1`);
        await client.query(`CREATE SEQUENCE IF NOT EXISTS invoice_id_seq START WITH 1 INCREMENT BY 1`);

        await client.query('BEGIN');

        for (const d of MASTER_DEPARTMENTS) {
            await client.query(
                `INSERT IGNORE INTO departments (department_code, department_name, description, is_active)
                 VALUES (?, ?, ?, TRUE)`,
                [d.code, d.name, d.description]
            );
        }

        for (const p of MASTER_PLANTS) {
            await client.query(
                `INSERT IGNORE INTO plants (plant_code, plant_name, plant_address, is_active)
                 VALUES (?, ?, ?, TRUE)`,
                [p.code, p.name, p.address]
            );
        }

        for (const s of MASTER_SHIFTS) {
            await client.query(
                `INSERT IGNORE INTO shifts (shift_code, shift_name, start_time, end_time, description, is_active)
                 VALUES (?, ?, ?, ?, ?, TRUE)`,
                [s.code, s.name, s.start, s.end, s.description]
            );
        }

        for (const r of MASTER_ROLES) {
            await client.query(
                `INSERT IGNORE INTO roles (role_code, role_name, role_description, is_active)
                 VALUES (?, ?, ?, TRUE)`,
                [r.code, r.name, r.description]
            );
        }

        // Seed primary Super Admin user if not already present
        const adminEmail = (process.env.ADMIN_EMAIL || process.env.SMTP_USER || 'info@dqnex.com').trim().toLowerCase();
        const existingAdmin = await client.query(
            `SELECT users_id, department_id FROM users WHERE LOWER(email) = ? LIMIT 1`,
            [adminEmail]
        );

        const deptRes = await client.query(`SELECT department_id FROM departments WHERE department_name = 'Operation' LIMIT 1`);
        const plantRes = await client.query(`SELECT plant_id FROM plants WHERE plant_name = 'Unit-1' LIMIT 1`);
        const shiftRes = await client.query(`SELECT shift_id FROM shifts WHERE shift_name = 'Shift-A' LIMIT 1`);
        const roleRes = await client.query(`SELECT role_id FROM roles WHERE role_name = 'Super Admin' LIMIT 1`);

        if (existingAdmin.rows.length === 0) {
            const defaultPassword = process.env.ADMIN_PASSWORD || 'Admin@123';
            const hashedPassword = hashPassword(defaultPassword);

            const insertedAdmin = await client.query(
                `INSERT IGNORE INTO users (
                    employee_id, first_name, last_name, username, email,
                    designation, department_id, plant_id, default_shift_id,
                    password, is_active, is_delete
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, FALSE)
                RETURNING users_id`,
                [
                    'EMP-0001',
                    'Orrnex',
                    'Administrator',
                    'admin',
                    adminEmail,
                    'System Administrator',
                    deptRes.rows[0]?.department_id || null,
                    plantRes.rows[0]?.plant_id || null,
                    shiftRes.rows[0]?.shift_id || null,
                    hashedPassword,
                ]
            );

            if (insertedAdmin.rows.length > 0 && roleRes.rows.length > 0) {
                await client.query(
                    `INSERT IGNORE INTO user_roles (users_id, role_id) VALUES (?, ?)`,
                    [insertedAdmin.rows[0].users_id, roleRes.rows[0].role_id]
                );
            }
        } else if (!existingAdmin.rows[0].department_id && deptRes.rows[0]?.department_id) {
            await client.query(
                `UPDATE users SET department_id = ? WHERE users_id = ?`,
                [deptRes.rows[0].department_id, existingAdmin.rows[0].users_id]
            );
        }

        await client.query('COMMIT');
        return { seeded: true };
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

if (require.main === module) {
    ensureSeededAndIndexed()
        .then(() => {
            console.log('MariaDB user management master tables & sequences seeded successfully.');
            return pool.end();
        })
        .catch((err) => {
            console.error('Seed failed:', err);
            pool.end();
            process.exit(1);
        });
}

module.exports = { ensureSeededAndIndexed };

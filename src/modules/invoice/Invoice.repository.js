const dbModule = require("../../config/database");
const pool = dbModule.pool || dbModule;

// ---------------------------------------------------------------
// Sales Order lookups (used when creating an invoice)
// ---------------------------------------------------------------
const getSalesOrderById = async (salesOrderId, client = pool) => {
    if (!salesOrderId) return null;

    const result = await client.query(
        `SELECT *
           FROM public.sales_order
          WHERE sales_order_id = $1
          LIMIT 1`,
        [salesOrderId]
    );

    return result.rows[0] || null;
};

const getSalesOrderItems = async (salesOrderId, client = pool) => {
    const result = await client.query(
        `SELECT *
           FROM public.sales_order_item
          WHERE sales_order_id = $1
          ORDER BY sales_order_item_id`,
        [salesOrderId]
    );

    return result.rows;
};

const getBySalesOrderId = async (salesOrderId, client = pool) => {
    const result = await client.query(
        `SELECT *
           FROM public.invoice
          WHERE sales_order_id = $1
          LIMIT 1`,
        [salesOrderId]
    );

    return result.rows[0] || null;
};

// ---------------------------------------------------------------
// List (Invoices table + sidebar). Returns the exact field names
// the frontend InvoicesTable already reads.
// ---------------------------------------------------------------
const getAll = async ({ search = "", status = "" } = {}) => {
    const values = [];
    const conditions = [];

    if (search) {
        values.push(`%${search}%`);
        const p = `$${values.length}`;
        conditions.push(`(
            i.invoice_number LIKE ${p}
            OR COALESCE(i.sales_order_number, '') LIKE ${p}
            OR COALESCE(c.display_name, '') LIKE ${p}
        )`);
    }

    if (status) {
        values.push(status.toUpperCase());
        conditions.push(`i.payment_status = $${values.length}`);
    }

    const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const result = await pool.query(
        `SELECT
            i.invoice_id                              AS id,
            DATE_FORMAT(i.invoice_date, '%d/%m/%Y')   AS date,
            i.invoice_number                          AS invoice,
            COALESCE(i.sales_order_number, '')        AS "orderNo",
            c.display_name                            AS "customerName",
            i.payment_status                          AS status,
            DATE_FORMAT(i.due_date, '%d/%m/%Y')       AS "dueDate",
            i.total_amount                            AS amount,
            i.balance_amount                          AS "balanceDue"
           FROM invoice i
           LEFT JOIN customer c
             ON c.customer_id = i.customer_id
          ${where}
          ORDER BY i.created_at DESC, i.invoice_id DESC`,
        values
    );

    return result.rows;
};

// ---------------------------------------------------------------
// Single invoice with customer + items (for the details page)
// ---------------------------------------------------------------
const getByIdWithRelations = async (id) => {
    const isNumericId = /^\d+$/.test(String(id));

    const headerResult = await pool.query(
        `SELECT
            i.*,
            c.display_name  AS customer_name,
            c.gstin         AS customer_gstin,
            c.email         AS customer_email,
            c.primary_phone AS customer_phone,
            CONCAT_WS(' ', c.primary_contact_first_name, c.primary_contact_last_name) AS customer_poc,
            DATE_FORMAT(i.invoice_date, '%d/%m/%Y') AS invoice_date_display,
            DATE_FORMAT(i.due_date, '%d/%m/%Y')     AS due_date_display,
            DATE_FORMAT(so.sale_date, '%d/%m/%Y')   AS order_date_display,
            DATEDIFF(i.due_date, i.invoice_date)    AS payment_days
           FROM public.invoice i
           LEFT JOIN public.customer c
             ON c.customer_id = i.customer_id
           LEFT JOIN public.sales_order so
             ON so.sales_order_id = i.sales_order_id
          WHERE ${isNumericId ? "i.invoice_id = $1" : "i.invoice_number = $1"}
          LIMIT 1`,
        [id]
    );

    const invoice = headerResult.rows[0];
    if (!invoice) return null;

    const itemsResult = await pool.query(
        `SELECT
            ii.*,
            soi.box_type,
            soi.paper_type,
            soi.box_size,
            soi.ply,
            soi.bf
           FROM public.invoice_item ii
           LEFT JOIN public.sales_order_item soi
             ON soi.sales_order_item_id = ii.sales_order_item_id
          WHERE ii.invoice_id = $1
          ORDER BY ii.invoice_item_id`,
        [invoice.invoice_id]
    );

    return { ...invoice, items: itemsResult.rows };
};

// ---------------------------------------------------------------
// Create invoice + items in one transaction.
// The invoice number is derived from the invoice_id sequence, so it
// is race-free (INV-00001, INV-00002, ...).
// ---------------------------------------------------------------
const create = async (header, items) => {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const seq = await client.query(
            `SELECT NEXT VALUE FOR invoice_id_seq AS id`
        );
        const invoiceId = seq.rows[0].id;
        const invoiceNumber = `INV-${String(invoiceId).padStart(5, "0")}`;

        const headerResult = await client.query(
            `INSERT INTO public.invoice (
                invoice_id, invoice_number, sales_order_id, sales_order_number,
                customer_id, customer_code, po_number,
                billing_address, shipping_address,
                invoice_date, due_date,
                item_count, item_total,
                gst_rate, gst_amount,
                discount_rate, discount_amount,
                total_amount, amount_paid, balance_amount,
                payment_status, remarks, created_by
            )
            VALUES (
                $1, $2, $3, $4,
                $5, $6, $7,
                $8, $9,
                $10, $11,
                $12, $13,
                $14, $15,
                $16, $17,
                $18, 0, $19,
                'UNPAID', $20, $21
            )
            RETURNING *`,
            [
                invoiceId,
                invoiceNumber,
                header.sales_order_id,
                header.sales_order_number,
                header.customer_id,
                header.customer_code,
                header.po_number,
                header.billing_address,
                header.shipping_address,
                header.invoice_date,
                header.due_date,
                items.length,
                header.item_total,
                header.gst_rate,
                header.gst_amount,
                header.discount_rate,
                header.discount_amount,
                header.total_amount,
                header.total_amount, // balance = total on creation
                header.remarks,
                header.created_by,
            ]
        );

        const invoice = headerResult.rows[0];
        const insertedItems = [];

        for (const item of items) {
            const itemResult = await client.query(
                `INSERT INTO public.invoice_item (
                    invoice_id, sales_order_item_id,
                    box_spec, box_description,
                    quantity, unit_rate, item_total,
                    created_by
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *`,
                [
                    invoice.invoice_id,
                    item.sales_order_item_id,
                    item.box_spec,
                    item.box_description,
                    item.quantity,
                    item.unit_rate,
                    item.item_total,
                    header.created_by,
                ]
            );

            insertedItems.push(itemResult.rows[0]);
        }

        await client.query("COMMIT");

        return { ...invoice, items: insertedItems };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

module.exports = {
    getSalesOrderById,
    getSalesOrderItems,
    getBySalesOrderId,
    getAll,
    getByIdWithRelations,
    create,
};
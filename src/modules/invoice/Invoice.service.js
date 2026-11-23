const repository = require("./invoice.repository");

// Days after the invoice date that payment is due.
// Change this (or set to 0 for "Due On Receipt").
const DEFAULT_DUE_DAYS = 30;

const httpError = (message, statusCode) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const toNumber = (value) => Number(value) || 0;

const toIsoDate = (date) => date.toISOString().slice(0, 10);

// Postgres returns numeric columns as strings; the UI wants numbers.
const formatListRow = (row) => ({
    ...row,
    amount: toNumber(row.amount),
    balanceDue: toNumber(row.balanceDue),
});

const list = async (options) => {
    const rows = await repository.getAll(options);
    return rows.map(formatListRow);
};

const getById = async (id) => {
    return repository.getByIdWithRelations(id);
};

const createFromSalesOrder = async (salesOrderId, createdBy = null) => {
    const salesOrder = await repository.getSalesOrderById(salesOrderId);

    if (!salesOrder) {
        throw httpError("Sales Order not found.", 404);
    }

    // One invoice per sales order.
    const existing = await repository.getBySalesOrderId(salesOrderId);

    if (existing) {
        throw httpError(
            `This Sales Order already has invoice ${existing.invoice_number}.`,
            409
        );
    }

    if (!salesOrder.customer_id) {
        throw httpError("Customer ID is missing from the Sales Order.", 400);
    }

    const salesItems = await repository.getSalesOrderItems(salesOrderId);

    if (!salesItems.length) {
        throw httpError("No items found for this Sales Order.", 400);
    }

    const items = salesItems.map((item) => {
        const quantity = toNumber(item.quantity);
        const unitRate = toNumber(item.unit_rate);

        return {
            sales_order_item_id: item.sales_order_item_id,
            box_spec: item.box_spec ?? null,
            box_description: item.box_description ?? null,
            quantity,
            unit_rate: unitRate,
            item_total:
                item.item_total !== null && item.item_total !== undefined
                    ? toNumber(item.item_total)
                    : quantity * unitRate,
        };
    });

    const itemTotal = toNumber(salesOrder.item_total);
    const gstAmount = toNumber(salesOrder.gst_amount);
    const totalAmount =
        salesOrder.estimated_total !== null &&
            salesOrder.estimated_total !== undefined
            ? toNumber(salesOrder.estimated_total)
            : itemTotal + gstAmount;

    const invoiceDate = new Date();
    const dueDate = new Date(invoiceDate);
    dueDate.setDate(dueDate.getDate() + DEFAULT_DUE_DAYS);

    const header = {
        sales_order_id: salesOrder.sales_order_id,
        sales_order_number: salesOrder.sales_order_number ?? null,
        customer_id: salesOrder.customer_id,
        customer_code: salesOrder.customer_code ?? null,
        po_number: salesOrder.po_number ?? null,
        billing_address: salesOrder.billing_address ?? null,
        shipping_address: salesOrder.shipping_address ?? null,
        invoice_date: toIsoDate(invoiceDate),
        due_date: toIsoDate(dueDate),
        item_total: itemTotal,
        gst_rate: toNumber(salesOrder.gst_rate),
        gst_amount: gstAmount,
        discount_rate: toNumber(salesOrder.discount_rate),
        discount_amount: toNumber(salesOrder.discount_amount),
        total_amount: totalAmount,
        remarks: "Created from Sales Order",
        created_by: createdBy,
    };

    try {
        const created = await repository.create(header, items);
        return getById(created.invoice_id);
    } catch (error) {
        // Safety net for two simultaneous clicks: the unique index on
        // invoice.sales_order_id rejects the second insert.
        if (error.code === "23505") {
            throw httpError(
                "This Sales Order already has an invoice.",
                409
            );
        }
        throw error;
    }
};

module.exports = {
    list,
    getById,
    createFromSalesOrder,
};
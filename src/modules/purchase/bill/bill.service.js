const pool = require('../../../config/database');
const repository = require('./bill.repository');

// Use camelCase if present, otherwise snake_case
const pick = (obj, camel, snake) => obj?.[camel] ?? obj?.[snake];

function normalizeItem(item) {
    return {
        reelId: pick(item, 'reelId', 'reel_id'),
        reelSpec: pick(item, 'reelSpec', 'reel_spec'),
        reelDescription: pick(item, 'reelDescription', 'reel_description'),
        quantity: pick(item, 'quantity', 'quantity'),
        unitRate: pick(item, 'unitRate', 'unit_rate'),
        totalAmount: pick(item, 'totalAmount', 'total_amount'),
        remarks: pick(item, 'remarks', 'remarks')
    };
}

function normalizeBill(data) {
    const items = Array.isArray(data.items) ? data.items : [];

    return {
        // Fallback only used if the frontend/controller doesn't send a number
        billNumber:
            pick(data, 'billNumber', 'bill_number') || `BILL-${Date.now()}`,
        purchaseOrderId: pick(data, 'purchaseOrderId', 'purchase_order_id'),
        vendorId: pick(data, 'vendorId', 'vendor_id'),
        vendorCode: pick(data, 'vendorCode', 'vendor_code'),
        billingAddress: pick(data, 'billingAddress', 'billing_address'),
        shippingAddress: pick(data, 'shippingAddress', 'shipping_address'),
        billDate: pick(data, 'billDate', 'bill_date'),
        dueDate: pick(data, 'dueDate', 'due_date'),
        deliveryStatus: pick(data, 'deliveryStatus', 'delivery_status'),
        grnStatus: pick(data, 'grnStatus', 'grn_status'),
        itemCount: pick(data, 'itemCount', 'item_count') ?? items.length,
        itemTotal: pick(data, 'itemTotal', 'item_total'),
        gstRate: pick(data, 'gstRate', 'gst_rate'),
        gstAmount: pick(data, 'gstAmount', 'gst_amount'),
        discountRate: pick(data, 'discountRate', 'discount_rate'),
        discountAmount: pick(data, 'discountAmount', 'discount_amount'),
        totalAmount: pick(data, 'totalAmount', 'total_amount'),
        remarks: pick(data, 'remarks', 'remarks'),
        createdBy: pick(data, 'createdBy', 'created_by'),
        items: items.map(normalizeItem)
    };
}

async function getAllBills() {
    return await repository.getAllBills();
}

async function getBillById(billId) {
    return await repository.getBillById(billId);
}

async function createBill(rawData) {
    const billData = normalizeBill(rawData);
    const client = await pool.connect();

    // Turns an address object into readable text for the TEXT column
    const addressToText = (a) => {
        if (!a || typeof a !== 'object') return a || null;
        return [a.attention, a.street1, a.street2, a.city, a.state,
        a.country, a.zipCode, a.phone ? `Phone: ${a.phone}` : null]
            .filter(Boolean).join('\n');
    };

    try {
        // Fill missing fields from the purchase order
        const po = await repository.getPurchaseOrderById(
            billData.purchaseOrderId,
            client
        );

        if (po) {
            billData.vendorCode = billData.vendorCode || po.vendor_code;
            billData.billingAddress = addressToText(
                billData.billingAddress || po.billing_address
            );
            billData.shippingAddress = addressToText(
                billData.shippingAddress || po.shipping_address
            );
        }
        await client.query('BEGIN');

        const bill = await repository.createBill(billData, client);

        const items = [];
        for (const item of billData.items) {
            const createdItem = await repository.createBillItem(
                {
                    ...item,
                    billId: bill.bill_id,
                    createdBy: billData.createdBy
                },
                client
            );
            items.push(createdItem);
        }

        await client.query('COMMIT');

        return { ...bill, items };

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Create Bill Service Error:', error);
        throw error;

    } finally {
        client.release();
    }
}

module.exports = {
    getAllBills,
    getBillById,
    createBill
};
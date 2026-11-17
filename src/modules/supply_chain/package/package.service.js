// src/modules/supply_chain/package/package.service.js

const pool = require('../../../config/database');

const repository = require('./package.repository');
const { PACKAGE_STATUS, PACKAGE_NUMBER_PREFIX } = require('./package.constant');

// error that carries an HTTP status code (the controller turns it into a response)
class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

// PKG-00001
const formatCode = (prefix, seq) => `${prefix}-${String(seq).padStart(5, '0')}`;

/**
 * Create package + its items in ONE transaction
 * (if anything fails, nothing is saved)
 */
const createPackage = async (data, userId) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (await repository.slipNumberExists(client, data.packageSlipNumber)) {
      throw new HttpError(409, `Package slip number ${data.packageSlipNumber} already exists`);
    }

    // packed quantity cannot be more than what is still left on the sales order item
    for (const item of data.items) {
      if (!item.salesOrderItemId) continue;

      const row = await repository.getItemRemaining(client, item.salesOrderItemId);

      if (!row) {
        throw new HttpError(400, `Sales order item ${item.salesOrderItemId} not found`);
      }
      if (String(row.customer_id) !== String(data.customerId)) {
        throw new HttpError(400, 'A sales order item belongs to a different customer');
      }
      if (item.packQuantity > Number(row.remaining_quantity)) {
        throw new HttpError(
          409,
          `Only ${Number(row.remaining_quantity)} left to pack for ${item.itemName || 'an item'}`
        );
      }
    }

    // generate PKG-00001
    await repository.lockPackageNumber(client);
    const seq = await repository.getNextPackageSeq(client);
    const packageNumber = formatCode(PACKAGE_NUMBER_PREFIX, seq);

    const createdPackage = await repository.createPackage(client, {
      ...data,
      packageNumber,
      status: data.status || PACKAGE_STATUS.DRAFT,
      userId,
    });

    const items = [];
    for (const item of data.items) {
      const createdItem = await repository.createPackageItem(
        client,
        createdPackage.package_id,
        data.customerId,
        item,
        userId
      );
      items.push(createdItem);
    }

    await client.query('COMMIT');

    return { ...createdPackage, items };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const STATUS_LABEL = {
  DRAFT: 'Draft',
  PACKED: 'Packed',
  SHIPPED: 'Shipped',
  CANCELLED: 'Cancelled',
};

const dash = (value) => (value === null || value === undefined || value === '' ? '-' : value);

/**
 * List of packages for the Packages tab (keys match the table columns)
 */
const getPackages = async () => {
  const client = await pool.connect();

  try {
    const rows = await repository.getAllPackages(client);

    return rows.map((row) => ({
      id: row.package_id,
      packageDate: dash(row.package_date),
      packageNo: dash(row.package_number),
      carrier: dash(row.carrier),
      tracking: dash(row.tracking_number),
      salesOrder: dash(row.sales_order_numbers),
      deliveryChallan: '-',
      status: STATUS_LABEL[row.package_status] || row.package_status,
      shipmentDate: dash(row.shipment_date),
      customerName: dash(row.customer_name),
      quantity:
        row.total_quantity === null ? '-' : Number(row.total_quantity).toFixed(2),
    }));
  } finally {
    client.release();
  }
};

const unique = (list) => [...new Set(list.filter(Boolean))];

const buildAddress = (row, prefix) => {
  const lines = [
    row[`${prefix}_street_1`],
    row[`${prefix}_street_2`],
    [row[`${prefix}_city`], row[`${prefix}_state`]].filter(Boolean).join(', '),
    row[`${prefix}_zip_code`],
  ].filter(Boolean);

  return { name: row.customer_name || '', lines };
};

const withUnit = (value, unit) =>
  value === null || value === undefined ? '-' : `${Number(value)} ${unit || ''}`.trim();

/**
 * Everything the package details page needs
 */
const getPackageById = async (packageId) => {
  const client = await pool.connect();

  try {
    const p = await repository.getPackageDetails(client, packageId);
    if (!p) throw new HttpError(404, 'Package not found');

    const items = await repository.getPackageDetailItems(client, packageId);
    const unit = p.quantity_unit || 'Pcs';
    const status = STATUS_LABEL[p.package_status] || p.package_status;

    const hasDimensions =
      p.dimension_length !== null && p.dimension_width !== null && p.dimension_height !== null;

    return {
      id: p.package_id,
      packageNumber: p.package_number,
      status,
      profile: {
        company: p.customer_name || '-',
        code: p.customer_code || '-',
        gstin: p.gstin || '-',
        contact: (p.contact_name || '').trim() || '-',
      },
      salesOrderNumbers: dash(unique(items.map((i) => i.sales_order_number)).join(', ')),
      salesOrderDate: dash(unique(items.map((i) => i.sale_date)).join(', ')),
      expectedShipmentDate: dash(
        p.expected_shipment_date || unique(items.map((i) => i.delivery_date)).join(', ')
      ),
      packagingStatus: status,
      totalQuantity: p.total_quantity === null ? '-' : Number(p.total_quantity).toFixed(2),
      billing: buildAddress(p, 'b'),
      shipping: buildAddress(p, 's'),
      salesOrders: items.map((i) => ({
        id: i.package_item_id,
        salesOrderNo: dash(i.sales_order_number),
        item: dash(i.item_name),
        itemDescription: i.item_description || '',
        orderDate: dash(i.item_order_date),
        totalWeight: withUnit(i.pack_weight, p.weight_unit || 'Kg'),
        quantity: Number(i.pack_quantity),
        orderedQuantity: Number(i.total_quantity),
        unit,
      })),
      packageSpecs: [
        {
          slip: dash(p.package_slip_number),
          type: dash(p.package_type),
          date: dash(p.package_date),
          dimension: hasDimensions
            ? `${Number(p.dimension_length)} x ${Number(p.dimension_width)} x ${Number(p.dimension_height)} ${p.dimension_unit || 'cm'}`
            : '-',
          totalWeight: withUnit(p.total_weight, p.weight_unit || 'Kg'),
        },
      ],
      remarks: p.remarks || '',
    };
  } finally {
    client.release();
  }
};

// ---------- dropdown lookups ----------
const getCustomers = async () => {
  const rows = await repository.getCustomers();

  return rows.map((row) => ({
    customerId: row.customer_id,
    customerName: row.display_name,
    customerCode: row.customer_code,
  }));
};

const getSalesOrdersByCustomer = async (customerId) => {
  const rows = await repository.getSalesOrdersByCustomer(customerId);

  return rows.map((row) => ({
    salesOrderId: row.sales_order_id,
    salesOrderNumber: row.sales_order_number,
    saleDate: row.sale_date,
    status: row.delivery_status,
  }));
};

const getPackableItems = async (customerId, salesOrderIds) => {
  const rows = await repository.getPackableItems(customerId, salesOrderIds);

  return rows.map((row) => ({
    salesOrderItemId: Number(row.sales_order_item_id),
    salesOrderId: Number(row.sales_order_id),
    salesOrderNumber: row.sales_order_number,
    itemOrderDate: row.item_order_date,
    itemCode: row.item_code,
    itemName: row.item_name,
    itemDescription: row.item_description,
    orderedQuantity: Number(row.ordered_quantity),
    packedQuantity: Number(row.packed_quantity),
    remainingQuantity: Number(row.remaining_quantity),
    unitWeight: Number(row.unit_weight),
  }));
};

module.exports = {
  createPackage,
  getPackages,
  getPackageById,
  getCustomers,
  getSalesOrdersByCustomer,
  getPackableItems,
};
// src/modules/supply_chain/shipment/shipment.service.js

const pool = require('../../../config/database');

const repository = require('./shipment.repository');
const { SHIPMENT_STATUS, SHIPMENT_NUMBER_PREFIX } = require('./shipment.constant');
const { PACKAGE_STATUS } = require('../package/package.constant');

// error that carries an HTTP status code (the controller turns it into a response)
class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

// SHP-00001
const formatCode = (prefix, seq) => `${prefix}-${String(seq).padStart(5, '0')}`;

/**
 * A shipment is created from ONE packed package.
 * Items are copied from the package on the server (not trusted from the browser).
 * When the shipment is saved (not a draft) the package becomes SHIPPED.
 */
const createShipment = async (data, userId) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ---------- the package being shipped ----------
    const pkg = await repository.getPackageForShipment(client, data.packageId);

    if (!pkg) {
      throw new HttpError(404, 'Package not found');
    }
    if (String(pkg.customer_id) !== String(data.customerId)) {
      throw new HttpError(400, 'This package belongs to a different customer');
    }
    if (pkg.package_status !== PACKAGE_STATUS.PACKED) {
      throw new HttpError(
        409,
        `Only PACKED packages can be shipped (this one is ${pkg.package_status})`
      );
    }

    const existing = await repository.findActiveShipmentForPackage(client, pkg.package_id);
    if (existing) {
      throw new HttpError(409, `This package is already in shipment ${existing.shipment_number}`);
    }

    const packageItems = await repository.getPackageItems(client, pkg.package_id);
    if (packageItems.length === 0) {
      throw new HttpError(400, 'This package has no items');
    }

    // ---------- status ----------
    let status = data.status || SHIPMENT_STATUS.DRAFT;
    const isDelivered = data.isDelivered && status !== SHIPMENT_STATUS.DRAFT;

    if (isDelivered) {
      status = SHIPMENT_STATUS.DELIVERED;
    }

    // ---------- number (SHP-00001) ----------
    await repository.lockShipmentNumber(client);
    const seq = await repository.getNextShipmentSeq(client);
    const shipmentNumber = formatCode(SHIPMENT_NUMBER_PREFIX, seq);

    const shipment = await repository.createShipment(client, {
      ...data,
      shipmentNumber,
      status,
      isDelivered,
      deliveredDate: isDelivered
        ? data.deliveredDate || new Date().toISOString().slice(0, 10)
        : null,
      billingAddressId: data.billingAddressId ?? pkg.billing_address_id,
      shippingAddressId: data.shippingAddressId ?? pkg.shipping_address_id,
      packageSlipNumber: pkg.package_slip_number,
      userId,
    });

    const items = [];
    for (const item of packageItems) {
      const createdItem = await repository.createShipmentItem(client, shipment, pkg, item, userId);
      items.push(createdItem);
    }

    // a saved (non-draft) shipment means the package has left
    if (status !== SHIPMENT_STATUS.DRAFT) {
      await repository.markPackageShipped(client, pkg.package_id, userId);
    }

    await client.query('COMMIT');

    return { ...shipment, items };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Packages that can be picked in the "Package Slip No" dropdown
 */
const getShippablePackages = async (customerId) => {
  const client = await pool.connect();

  try {
    const rows = await repository.getShippablePackages(client, customerId);

    return rows.map((row) => ({
      packageId: Number(row.package_id),
      packageNumber: row.package_number,
      packageSlipNumber: row.package_slip_number,
      packageDate: row.package_date,
      totalQuantity: row.total_quantity === null ? null : Number(row.total_quantity),
    }));
  } finally {
    client.release();
  }
};

// ---------- list + details ----------
const STATUS_LABEL = {
  DRAFT: 'Draft',
  SHIPPED: 'Shipped',
  IN_TRANSIT: 'In Transit',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

const dash = (value) => (value === null || value === undefined || value === '' ? '-' : value);

const unique = (list) => [...new Set(list.filter(Boolean))];

const money = (value) =>
  value === null || value === undefined ? '-' : `₹${Number(value).toFixed(2)}`;

const buildAddress = (row, prefix) => {
  const lines = [
    row[`${prefix}_street_1`],
    row[`${prefix}_street_2`],
    [row[`${prefix}_city`], row[`${prefix}_state`]].filter(Boolean).join(', '),
    row[`${prefix}_zip_code`],
  ].filter(Boolean);

  return { name: row.customer_name || '', lines };
};

/**
 * List for the Shipment tab (keys match the table columns)
 */
const getShipments = async () => {
  const client = await pool.connect();

  try {
    const rows = await repository.getAllShipments(client);

    return rows.map((row) => ({
      id: row.shipment_id,
      shipmentDate: dash(row.ship_date),
      shipmentOrder: dash(row.shipment_number),
      packageNo: dash(row.package_numbers),
      salesOrder: dash(row.sales_order_numbers),
      carrier: dash(row.carrier),
      tracking: dash(row.tracking_number),
      deliveryChallan: '-',
      trackingStatus: STATUS_LABEL[row.shipment_status] || row.shipment_status,
      customerName: dash(row.customer_name),
      quantity: `${Number(row.total_quantity)} Pcs`,
      shippingCost: money(row.shipping_charges),
    }));
  } finally {
    client.release();
  }
};

/**
 * Everything the shipment details page needs
 */
const getShipmentById = async (shipmentId) => {
  const client = await pool.connect();

  try {
    const s = await repository.getShipmentDetails(client, shipmentId);
    if (!s) throw new HttpError(404, 'Shipment not found');

    const orders = await repository.getShipmentSalesOrders(client, shipmentId);
    const status = STATUS_LABEL[s.shipment_status] || s.shipment_status;

    return {
      id: s.shipment_id,
      shipmentNumber: s.shipment_number,
      status,
      profile: {
        company: s.customer_name || '-',
        code: s.customer_code || '-',
        gstin: s.gstin || '-',
        contact: (s.contact_name || '').trim() || '-',
      },
      salesOrderNumbers: dash(unique(orders.map((o) => o.sales_order_number)).join(', ')),
      salesOrderDate: dash(unique(orders.map((o) => o.sale_date)).join(', ')),
      expectedShipmentDate: dash(unique(orders.map((o) => o.delivery_date)).join(', ')),
      shippingStatus: status,
      shipmentDate: dash(s.ship_date),
      billing: buildAddress(s, 'b'),
      shipping: buildAddress(s, 's'),
      shippingDetails: [
        {
          shipmentOrder: dash(s.shipment_number),
          carrier: dash(s.carrier),
          trackingNumber: dash(s.tracking_number),
          trackingUrl: dash(s.tracking_url),
          packageSlip: dash(s.package_slip_number),
        },
      ],
      remarks: s.remarks || '',
    };
  } finally {
    client.release();
  }
};

module.exports = { createShipment, getShippablePackages, getShipments, getShipmentById };
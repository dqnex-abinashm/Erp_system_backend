// src/modules/supply_chain/shipment/shipment-code.js

/**
 * Shipment SQL queries (tables: shipment, shipment_item)
 */

const LOCK_SHIPMENT_NUMBER = `
    SELECT pg_advisory_xact_lock(hashtext('shipment_number'));
`;

const GET_NEXT_SHIPMENT_SEQ = `
    SELECT COALESCE(
        MAX(CAST(SUBSTRING(shipment_number FROM '[0-9]+$') AS INTEGER)),
        0
    ) + 1 AS next_seq
    FROM shipment;
`;

// FOR UPDATE: nobody else can ship the same package while this runs
const GET_PACKAGE_FOR_SHIPMENT = `
    SELECT *
    FROM packaging
    WHERE package_id = $1
    FOR UPDATE;
`;

const GET_PACKAGE_ITEMS = `
    SELECT *
    FROM packaging_item
    WHERE package_id = $1
    ORDER BY package_item_id ASC;
`;

const CHECK_PACKAGE_ALREADY_SHIPPED = `
    SELECT s.shipment_number
    FROM shipment_item si
    JOIN shipment s
        ON s.shipment_id = si.shipment_id
    WHERE si.package_id = $1
      AND s.shipment_status <> 'CANCELLED'
    LIMIT 1;
`;

const CREATE_SHIPMENT = `
    INSERT INTO shipment (
        shipment_number,
        shipment_status,
        ship_date,
        shipping_charges,
        currency_code,
        customer_id,
        billing_address_id,
        shipping_address_id,
        carrier,
        tracking_number,
        tracking_url,
        is_delivered,
        delivered_date,
        send_status_notification,
        remarks,
        package_slip_number,
        created_by
    )
    VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17
    )
    RETURNING *;
`;

const CREATE_SHIPMENT_ITEM = `
    INSERT INTO shipment_item (
        shipment_id,
        package_id,
        package_number,
        package_slip_number,
        customer_id,
        sales_order_item_id,
        item_code,
        item_name,
        item_description,
        item_order_date,
        total_quantity,
        pack_quantity,
        pack_weight,
        remarks,
        created_by
    )
    VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15
    )
    RETURNING *;
`;

const MARK_PACKAGE_SHIPPED = `
    UPDATE packaging
    SET
        package_status = 'SHIPPED',
        modified_by = $2,
        modified_at = CURRENT_TIMESTAMP
    WHERE package_id = $1;
`;

// Packed packages of one customer that are not in any active shipment yet
const GET_SHIPPABLE_PACKAGES = `
    SELECT
        p.package_id,
        p.package_number,
        p.package_slip_number,
        TO_CHAR(p.package_date, 'DD/MM/YYYY') AS package_date,
        p.total_quantity
    FROM packaging p
    WHERE p.customer_id = $1
      AND p.package_status = 'PACKED'
      AND NOT EXISTS (
            SELECT 1
            FROM shipment_item si
            JOIN shipment s
                ON s.shipment_id = si.shipment_id
            WHERE si.package_id = p.package_id
              AND s.shipment_status <> 'CANCELLED'
      )
    ORDER BY p.created_at DESC, p.package_id DESC;
`;

// Shipment tab list
const GET_ALL_SHIPMENTS = `
    SELECT
        s.shipment_id,
        s.shipment_number,
        s.shipment_status,
        TO_CHAR(s.ship_date, 'DD/MM/YYYY') AS ship_date,
        s.carrier,
        s.tracking_number,
        s.shipping_charges,
        c.display_name AS customer_name,
        it.total_quantity,
        it.package_numbers,
        it.sales_order_numbers
    FROM shipment s

    LEFT JOIN customer c
        ON c.customer_id = s.customer_id

    LEFT JOIN LATERAL (
        SELECT
            COALESCE(SUM(si.pack_quantity), 0) AS total_quantity,
            STRING_AGG(DISTINCT si.package_number, ', ') AS package_numbers,
            STRING_AGG(DISTINCT so.sales_order_number, ', ') AS sales_order_numbers
        FROM shipment_item si
        LEFT JOIN sales_order_item soi
            ON soi.sales_order_item_id = si.sales_order_item_id
        LEFT JOIN sales_order so
            ON so.sales_order_id = soi.sales_order_id
        WHERE si.shipment_id = s.shipment_id
    ) it ON TRUE

    ORDER BY s.created_at DESC, s.shipment_id DESC;
`;

// Shipment details page
const GET_SHIPMENT_DETAILS = `
    SELECT
        s.shipment_id,
        s.shipment_number,
        s.shipment_status,
        TO_CHAR(s.ship_date, 'DD/MM/YYYY') AS ship_date,
        s.carrier,
        s.tracking_number,
        s.tracking_url,
        s.package_slip_number,
        s.remarks,

        c.display_name AS customer_name,
        c.customer_code,
        c.gstin,
        CONCAT_WS(' ', c.primary_contact_first_name, c.primary_contact_last_name) AS contact_name,

        ba.street_1 AS b_street_1,
        ba.street_2 AS b_street_2,
        ba.city AS b_city,
        ba.state AS b_state,
        ba.zip_code AS b_zip_code,

        sa.street_1 AS s_street_1,
        sa.street_2 AS s_street_2,
        sa.city AS s_city,
        sa.state AS s_state,
        sa.zip_code AS s_zip_code
    FROM shipment s

    LEFT JOIN customer c
        ON c.customer_id = s.customer_id

    LEFT JOIN LATERAL (
        SELECT street_1, street_2, city, state, zip_code
        FROM customer_addresses
        WHERE customer_address_id = s.billing_address_id
           OR (
                s.billing_address_id IS NULL
                AND customer_id = s.customer_id
                AND address_type = 'BILLING'
           )
        ORDER BY customer_address_id ASC
        LIMIT 1
    ) ba ON TRUE

    LEFT JOIN LATERAL (
        SELECT street_1, street_2, city, state, zip_code
        FROM customer_addresses
        WHERE customer_address_id = s.shipping_address_id
           OR (
                s.shipping_address_id IS NULL
                AND customer_id = s.customer_id
                AND address_type = 'SHIPPING'
           )
        ORDER BY customer_address_id ASC
        LIMIT 1
    ) sa ON TRUE

    WHERE s.shipment_id = $1;
`;

// sales orders behind the shipment items (for order number / dates)
const GET_SHIPMENT_SALES_ORDERS = `
    SELECT DISTINCT
        so.sales_order_number,
        TO_CHAR(so.sale_date, 'DD/MM/YYYY') AS sale_date,
        TO_CHAR(so.delivery_date, 'DD/MM/YYYY') AS delivery_date
    FROM shipment_item si
    JOIN sales_order_item soi
        ON soi.sales_order_item_id = si.sales_order_item_id
    JOIN sales_order so
        ON so.sales_order_id = soi.sales_order_id
    WHERE si.shipment_id = $1
    ORDER BY so.sales_order_number ASC;
`;

module.exports = {
    LOCK_SHIPMENT_NUMBER,
    GET_NEXT_SHIPMENT_SEQ,
    GET_PACKAGE_FOR_SHIPMENT,
    GET_PACKAGE_ITEMS,
    CHECK_PACKAGE_ALREADY_SHIPPED,
    CREATE_SHIPMENT,
    CREATE_SHIPMENT_ITEM,
    MARK_PACKAGE_SHIPPED,
    GET_SHIPPABLE_PACKAGES,
    GET_ALL_SHIPMENTS,
    GET_SHIPMENT_DETAILS,
    GET_SHIPMENT_SALES_ORDERS,
};
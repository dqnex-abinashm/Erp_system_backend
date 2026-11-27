// src/modules/supply_chain/shipment/shipment-code.js

/**
 * Shipment SQL queries (tables: shipment, shipment_item) - MariaDB compatible
 */

const LOCK_SHIPMENT_NUMBER = `
    SELECT COALESCE(MAX(shipment_id), 0) AS max_id
    FROM shipment
    FOR UPDATE;
`;

const GET_NEXT_SHIPMENT_SEQ = `
    SELECT COALESCE(
        MAX(CAST(REGEXP_SUBSTR(shipment_number, '[0-9]+$') AS UNSIGNED)),
        0
    ) + 1 AS next_seq
    FROM shipment;
`;

// FOR UPDATE: nobody else can ship the same package while this runs
const GET_PACKAGE_FOR_SHIPMENT = `
    SELECT *
    FROM packaging
    WHERE package_id = ?
    FOR UPDATE;
`;

const GET_PACKAGE_ITEMS = `
    SELECT *
    FROM packaging_item
    WHERE package_id = ?
    ORDER BY package_item_id ASC;
`;

const CHECK_PACKAGE_ALREADY_SHIPPED = `
    SELECT s.shipment_number
    FROM shipment_item si
    JOIN shipment s
        ON s.shipment_id = si.shipment_id
    WHERE si.package_id = ?
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
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?
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
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
    )
    RETURNING *;
`;

const MARK_PACKAGE_SHIPPED = `
    UPDATE packaging
    SET
        package_status = 'SHIPPED',
        modified_by = ?,
        modified_at = CURRENT_TIMESTAMP
    WHERE package_id = ?;
`;

const GET_SHIPPABLE_PACKAGES = `
    SELECT
        p.package_id,
        p.package_number,
        p.package_slip_number,
        DATE_FORMAT(p.package_date, '%d/%m/%Y') AS package_date,
        p.total_quantity
    FROM packaging p
    WHERE p.customer_id = ?
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

const GET_ALL_SHIPMENTS = `
    SELECT
        s.shipment_id,
        s.shipment_number,
        s.shipment_status,
        DATE_FORMAT(s.ship_date, '%d/%m/%Y') AS ship_date,
        s.carrier,
        s.tracking_number,
        s.shipping_charges,
        c.display_name AS customer_name,
        COALESCE(it.total_quantity, 0) AS total_quantity,
        it.package_numbers,
        it.sales_order_numbers
    FROM shipment s

    LEFT JOIN customer c
        ON c.customer_id = s.customer_id

    LEFT JOIN (
        SELECT
            si.shipment_id,
            COALESCE(SUM(si.pack_quantity), 0) AS total_quantity,
            GROUP_CONCAT(DISTINCT si.package_number SEPARATOR ', ') AS package_numbers,
            GROUP_CONCAT(DISTINCT so.sales_order_number SEPARATOR ', ') AS sales_order_numbers
        FROM shipment_item si
        LEFT JOIN sales_order_item soi
            ON soi.sales_order_item_id = si.sales_order_item_id
        LEFT JOIN sales_order so
            ON so.sales_order_id = soi.sales_order_id
        GROUP BY si.shipment_id
    ) it ON it.shipment_id = s.shipment_id

    ORDER BY s.created_at DESC, s.shipment_id DESC;
`;

const GET_SHIPMENT_DETAILS = `
    SELECT
        s.shipment_id,
        s.shipment_number,
        s.shipment_status,
        DATE_FORMAT(s.ship_date, '%d/%m/%Y') AS ship_date,
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

    LEFT JOIN customer_addresses ba
        ON ba.customer_address_id = COALESCE(
            s.billing_address_id,
            (
                SELECT customer_address_id
                FROM customer_addresses
                WHERE customer_id = s.customer_id
                  AND address_type = 'BILLING'
                ORDER BY customer_address_id ASC
                LIMIT 1
            )
        )

    LEFT JOIN customer_addresses sa
        ON sa.customer_address_id = COALESCE(
            s.shipping_address_id,
            (
                SELECT customer_address_id
                FROM customer_addresses
                WHERE customer_id = s.customer_id
                  AND address_type = 'SHIPPING'
                ORDER BY customer_address_id ASC
                LIMIT 1
            )
        )

    WHERE s.shipment_id = ?;
`;

const GET_SHIPMENT_SALES_ORDERS = `
    SELECT DISTINCT
        so.sales_order_number,
        DATE_FORMAT(so.sale_date, '%d/%m/%Y') AS sale_date,
        DATE_FORMAT(so.delivery_date, '%d/%m/%Y') AS delivery_date
    FROM shipment_item si
    JOIN sales_order_item soi
        ON soi.sales_order_item_id = si.sales_order_item_id
    JOIN sales_order so
        ON so.sales_order_id = soi.sales_order_id
    WHERE si.shipment_id = ?
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

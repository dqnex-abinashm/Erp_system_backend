// src/modules/supply_chain/package/package-code.js

/**
 * Package SQL queries (tables: packaging, packaging_item) - MariaDB compatible
 */

// Stops two users getting the same package number at the same time within a transaction
const LOCK_PACKAGE_NUMBER = `
    SELECT COALESCE(MAX(package_id), 0) AS max_id
    FROM packaging
    FOR UPDATE;
`;

const GET_NEXT_PACKAGE_SEQ = `
    SELECT COALESCE(
        MAX(CAST(REGEXP_SUBSTR(package_number, '[0-9]+$') AS UNSIGNED)),
        0
    ) + 1 AS next_seq
    FROM packaging;
`;

const CHECK_PACKAGE_SLIP_NUMBER = `
    SELECT package_id
    FROM packaging
    WHERE package_slip_number = ?;
`;

const CREATE_PACKAGE = `
    INSERT INTO packaging (
        package_number,
        package_slip_number,
        customer_id,
        billing_address_id,
        shipping_address_id,
        package_type,
        package_date,
        dimension_length,
        dimension_width,
        dimension_height,
        dimension_unit,
        total_weight,
        weight_unit,
        total_quantity,
        quantity_unit,
        package_status,
        expected_shipment_date,
        remarks,
        created_by
    )
    VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?
    )
    RETURNING *;
`;

const CREATE_PACKAGE_ITEM = `
    INSERT INTO packaging_item (
        package_id,
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
        ?, ?
    )
    RETURNING *;
`;

const GET_ALL_PACKAGES = `
    SELECT
        p.package_id,
        DATE_FORMAT(p.package_date, '%d/%m/%Y') AS package_date,
        p.package_number,
        p.package_slip_number,
        p.package_status,
        p.total_quantity,
        c.display_name AS customer_name,
        (
            SELECT GROUP_CONCAT(DISTINCT s.sales_order_number ORDER BY s.sales_order_number SEPARATOR ', ')
            FROM packaging_item pi
            JOIN sales_order_item soi
                ON soi.sales_order_item_id = pi.sales_order_item_id
            JOIN sales_order s
                ON s.sales_order_id = soi.sales_order_id
            WHERE pi.package_id = p.package_id
        ) AS sales_order_numbers,
        sh.carrier,
        sh.tracking_number,
        DATE_FORMAT(sh.ship_date, '%d/%m/%Y') AS shipment_date
    FROM packaging p

    LEFT JOIN customer c
        ON c.customer_id = p.customer_id

    LEFT JOIN shipment sh
        ON sh.shipment_id = (
            SELECT s.shipment_id
            FROM shipment_item si
            JOIN shipment s
                ON s.shipment_id = si.shipment_id
            WHERE si.package_id = p.package_id
              AND s.shipment_status <> 'CANCELLED'
            ORDER BY s.created_at DESC
            LIMIT 1
        )

    ORDER BY p.created_at DESC, p.package_id DESC;
`;

const GET_PACKAGE_DETAILS = `
    SELECT
        p.package_id,
        p.package_number,
        p.package_slip_number,
        p.package_status,
        DATE_FORMAT(p.package_date, '%d/%m/%Y') AS package_date,
        DATE_FORMAT(p.expected_shipment_date, '%d/%m/%Y') AS expected_shipment_date,
        p.package_type,
        p.dimension_length,
        p.dimension_width,
        p.dimension_height,
        p.dimension_unit,
        p.total_weight,
        p.weight_unit,
        p.total_quantity,
        p.quantity_unit,
        p.remarks,

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
    FROM packaging p

    LEFT JOIN customer c
        ON c.customer_id = p.customer_id

    LEFT JOIN customer_addresses ba
        ON ba.customer_address_id = COALESCE(
            p.billing_address_id,
            (
                SELECT customer_address_id
                FROM customer_addresses
                WHERE customer_id = p.customer_id
                  AND address_type = 'BILLING'
                ORDER BY customer_address_id ASC
                LIMIT 1
            )
        )

    LEFT JOIN customer_addresses sa
        ON sa.customer_address_id = COALESCE(
            p.shipping_address_id,
            (
                SELECT customer_address_id
                FROM customer_addresses
                WHERE customer_id = p.customer_id
                  AND address_type = 'SHIPPING'
                ORDER BY customer_address_id ASC
                LIMIT 1
            )
        )

    WHERE p.package_id = ?;
`;

const GET_PACKAGE_DETAIL_ITEMS = `
    SELECT
        pi.package_item_id,
        pi.item_name,
        pi.item_description,
        DATE_FORMAT(pi.item_order_date, '%d/%m/%Y') AS item_order_date,
        pi.total_quantity,
        pi.pack_quantity,
        pi.pack_weight,
        so.sales_order_number,
        DATE_FORMAT(so.sale_date, '%d/%m/%Y') AS sale_date,
        DATE_FORMAT(so.delivery_date, '%d/%m/%Y') AS delivery_date
    FROM packaging_item pi
    LEFT JOIN sales_order_item soi
        ON soi.sales_order_item_id = pi.sales_order_item_id
    LEFT JOIN sales_order so
        ON so.sales_order_id = soi.sales_order_id
    WHERE pi.package_id = ?
    ORDER BY pi.package_item_id ASC;
`;

const PACKED_QTY_JOIN = `
    LEFT JOIN (
        SELECT
            pi.sales_order_item_id,
            COALESCE(SUM(pi.pack_quantity), 0) AS packed_quantity
        FROM packaging_item pi
        JOIN packaging p
            ON p.package_id = pi.package_id
        WHERE p.package_status <> 'CANCELLED'
        GROUP BY pi.sales_order_item_id
    ) pk ON pk.sales_order_item_id = soi.sales_order_item_id
`;

const GET_CUSTOMERS = `
    SELECT
        customer_id,
        display_name,
        customer_code
    FROM customer
    ORDER BY display_name ASC;
`;

const GET_SALES_ORDERS_BY_CUSTOMER = `
    SELECT
        so.sales_order_id,
        so.sales_order_number,
        DATE_FORMAT(so.sale_date, '%Y-%m-%d') AS sale_date,
        so.delivery_status
    FROM sales_order so
    WHERE so.customer_id = ?
      AND EXISTS (
            SELECT 1
            FROM sales_order_item soi
            ${PACKED_QTY_JOIN}
            WHERE soi.sales_order_id = so.sales_order_id
              AND soi.quantity - COALESCE(pk.packed_quantity, 0) > 0
      )
    ORDER BY so.created_at DESC, so.sales_order_id DESC;
`;

function buildGetPackableItemsQuery(salesOrderIdsCount) {
    const placeholders = Array.from({ length: salesOrderIdsCount }, () => '?').join(', ');
    return `
        SELECT
            soi.sales_order_item_id,
            soi.sales_order_id,
            so.sales_order_number,
            DATE_FORMAT(so.sale_date, '%Y-%m-%d') AS item_order_date,
            CAST(soi.box_id AS CHAR) AS item_code,
            COALESCE(
                NULLIF(soi.box_spec, ''),
                NULLIF(soi.box_type, ''),
                'Box'
            ) AS item_name,
            COALESCE(
                NULLIF(soi.box_description, ''),
                CONCAT_WS(
                    ', ',
                    NULLIF(soi.box_type, ''),
                    NULLIF(soi.paper_type, ''),
                    NULLIF(soi.box_size, ''),
                    CASE WHEN soi.ply IS NOT NULL THEN CONCAT(soi.ply, ' Ply') END
                )
            ) AS item_description,
            soi.quantity AS ordered_quantity,
            COALESCE(pk.packed_quantity, 0) AS packed_quantity,
            (soi.quantity - COALESCE(pk.packed_quantity, 0)) AS remaining_quantity,
            COALESCE(
                soi.box_weight,
                CASE WHEN soi.quantity > 0 THEN soi.total_weight / soi.quantity END,
                0
            ) AS unit_weight
        FROM sales_order_item soi
        JOIN sales_order so
            ON so.sales_order_id = soi.sales_order_id
        ${PACKED_QTY_JOIN}
        WHERE so.customer_id = ?
          AND soi.sales_order_id IN (${placeholders})
          AND soi.quantity - COALESCE(pk.packed_quantity, 0) > 0
        ORDER BY soi.sales_order_id ASC, soi.sales_order_item_id ASC;
    `;
}

const GET_ITEM_REMAINING_QUANTITY = `
    SELECT
        soi.sales_order_item_id,
        so.customer_id,
        soi.quantity - COALESCE(pk.packed_quantity, 0) AS remaining_quantity
    FROM sales_order_item soi
    JOIN sales_order so
        ON so.sales_order_id = soi.sales_order_id
    ${PACKED_QTY_JOIN}
    WHERE soi.sales_order_item_id = ?;
`;

module.exports = {
    LOCK_PACKAGE_NUMBER,
    GET_NEXT_PACKAGE_SEQ,
    CHECK_PACKAGE_SLIP_NUMBER,
    CREATE_PACKAGE,
    CREATE_PACKAGE_ITEM,
    GET_ALL_PACKAGES,
    GET_PACKAGE_DETAILS,
    GET_PACKAGE_DETAIL_ITEMS,
    GET_CUSTOMERS,
    GET_SALES_ORDERS_BY_CUSTOMER,
    buildGetPackableItemsQuery,
    GET_ITEM_REMAINING_QUANTITY,
};

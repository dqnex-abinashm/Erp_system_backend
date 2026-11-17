// src/modules/supply_chain/package/package-code.js

/**
 * Package SQL queries (tables: packaging, packaging_item)
 */

// Stops two users getting the same package number at the same time
const LOCK_PACKAGE_NUMBER = `
    SELECT pg_advisory_xact_lock(hashtext('packaging_number'));
`;

const GET_NEXT_PACKAGE_SEQ = `
    SELECT COALESCE(
        MAX(CAST(SUBSTRING(package_number FROM '[0-9]+$') AS INTEGER)),
        0
    ) + 1 AS next_seq
    FROM packaging;
`;

const CHECK_PACKAGE_SLIP_NUMBER = `
    SELECT package_id
    FROM packaging
    WHERE package_slip_number = $1;
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
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18, $19
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
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12
    )
    RETURNING *;
`;

const GET_ALL_PACKAGES = `
    SELECT
        p.package_id,
        TO_CHAR(p.package_date, 'DD/MM/YYYY') AS package_date,
        p.package_number,
        p.package_slip_number,
        p.package_status,
        p.total_quantity,
        c.display_name AS customer_name,
        so.sales_order_numbers,
        sh.carrier,
        sh.tracking_number,
        TO_CHAR(sh.ship_date, 'DD/MM/YYYY') AS shipment_date
    FROM packaging p

    LEFT JOIN customer c
        ON c.customer_id = p.customer_id

    -- sales orders of the items inside the package
    LEFT JOIN LATERAL (
        SELECT STRING_AGG(
            DISTINCT s.sales_order_number, ', '
            ORDER BY s.sales_order_number
        ) AS sales_order_numbers
        FROM packaging_item pi
        JOIN sales_order_item soi
            ON soi.sales_order_item_id = pi.sales_order_item_id
        JOIN sales_order s
            ON s.sales_order_id = soi.sales_order_id
        WHERE pi.package_id = p.package_id
    ) so ON TRUE

    -- latest active shipment of the package (carrier, tracking, ship date)
    LEFT JOIN LATERAL (
        SELECT s.carrier, s.tracking_number, s.ship_date
        FROM shipment_item si
        JOIN shipment s
            ON s.shipment_id = si.shipment_id
        WHERE si.package_id = p.package_id
          AND s.shipment_status <> 'CANCELLED'
        ORDER BY s.created_at DESC
        LIMIT 1
    ) sh ON TRUE

    ORDER BY p.created_at DESC, p.package_id DESC;
`;

const GET_PACKAGE_DETAILS = `
    SELECT
        p.package_id,
        p.package_number,
        p.package_slip_number,
        p.package_status,
        TO_CHAR(p.package_date, 'DD/MM/YYYY') AS package_date,
        TO_CHAR(p.expected_shipment_date, 'DD/MM/YYYY') AS expected_shipment_date,
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

    -- billing address: the one saved on the package, else the customer's BILLING address
    LEFT JOIN LATERAL (
        SELECT street_1, street_2, city, state, zip_code
        FROM customer_addresses
        WHERE customer_address_id = p.billing_address_id
           OR (
                p.billing_address_id IS NULL
                AND customer_id = p.customer_id
                AND address_type = 'BILLING'
           )
        ORDER BY customer_address_id ASC
        LIMIT 1
    ) ba ON TRUE

    -- shipping address: the one saved on the package, else the customer's SHIPPING address
    LEFT JOIN LATERAL (
        SELECT street_1, street_2, city, state, zip_code
        FROM customer_addresses
        WHERE customer_address_id = p.shipping_address_id
           OR (
                p.shipping_address_id IS NULL
                AND customer_id = p.customer_id
                AND address_type = 'SHIPPING'
           )
        ORDER BY customer_address_id ASC
        LIMIT 1
    ) sa ON TRUE

    WHERE p.package_id = $1;
`;

const GET_PACKAGE_DETAIL_ITEMS = `
    SELECT
        pi.package_item_id,
        pi.item_name,
        pi.item_description,
        TO_CHAR(pi.item_order_date, 'DD/MM/YYYY') AS item_order_date,
        pi.total_quantity,
        pi.pack_quantity,
        pi.pack_weight,
        so.sales_order_number,
        TO_CHAR(so.sale_date, 'DD/MM/YYYY') AS sale_date,
        TO_CHAR(so.delivery_date, 'DD/MM/YYYY') AS delivery_date
    FROM packaging_item pi
    LEFT JOIN sales_order_item soi
        ON soi.sales_order_item_id = pi.sales_order_item_id
    LEFT JOIN sales_order so
        ON so.sales_order_id = soi.sales_order_id
    WHERE pi.package_id = $1
    ORDER BY pi.package_item_id ASC;
`;
// ---------------------------------------------------------------
// Dropdown lookups (customers, sales orders, items) for create page
// ---------------------------------------------------------------

// Quantity of a sales order item that is already inside a package (cancelled packages ignored)
const PACKED_QTY_LATERAL = `
    LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(pi.pack_quantity), 0) AS packed_quantity
        FROM packaging_item pi
        JOIN packaging p
            ON p.package_id = pi.package_id
        WHERE pi.sales_order_item_id = soi.sales_order_item_id
          AND p.package_status <> 'CANCELLED'
    ) pk ON TRUE
`;

const GET_CUSTOMERS = `
    SELECT
        customer_id,
        display_name,
        customer_code
    FROM customer
    ORDER BY display_name ASC;
`;

// Sales orders of one customer that still have something left to pack
const GET_SALES_ORDERS_BY_CUSTOMER = `
    SELECT
        so.sales_order_id,
        so.sales_order_number,
        TO_CHAR(so.sale_date, 'YYYY-MM-DD') AS sale_date,
        so.delivery_status
    FROM sales_order so
    WHERE so.customer_id = $1
      AND EXISTS (
            SELECT 1
            FROM sales_order_item soi
            ${PACKED_QTY_LATERAL}
            WHERE soi.sales_order_id = so.sales_order_id
              AND soi.quantity - pk.packed_quantity > 0
      )
    ORDER BY so.created_at DESC, so.sales_order_id DESC;
`;

// Items (with quantity left to pack) of the selected sales orders
const GET_PACKABLE_ITEMS = `
    SELECT
        soi.sales_order_item_id,
        soi.sales_order_id,
        so.sales_order_number,
        TO_CHAR(so.sale_date, 'YYYY-MM-DD') AS item_order_date,
        soi.box_id::text AS item_code,
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
                CASE WHEN soi.ply IS NOT NULL THEN soi.ply::text || ' Ply' END
            )
        ) AS item_description,
        soi.quantity AS ordered_quantity,
        pk.packed_quantity,
        (soi.quantity - pk.packed_quantity) AS remaining_quantity,
        COALESCE(
            soi.box_weight,
            CASE WHEN soi.quantity > 0 THEN soi.total_weight / soi.quantity END,
            0
        ) AS unit_weight
    FROM sales_order_item soi
    JOIN sales_order so
        ON so.sales_order_id = soi.sales_order_id
    ${PACKED_QTY_LATERAL}
    WHERE so.customer_id = $1
      AND soi.sales_order_id = ANY($2::bigint[])
      AND soi.quantity - pk.packed_quantity > 0
    ORDER BY soi.sales_order_id ASC, soi.sales_order_item_id ASC;
`;

// Used when saving a package, to make sure nobody packs more than what is left
const GET_ITEM_REMAINING_QUANTITY = `
    SELECT
        soi.sales_order_item_id,
        so.customer_id,
        soi.quantity - pk.packed_quantity AS remaining_quantity
    FROM sales_order_item soi
    JOIN sales_order so
        ON so.sales_order_id = soi.sales_order_id
    ${PACKED_QTY_LATERAL}
    WHERE soi.sales_order_item_id = $1;
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
    GET_PACKABLE_ITEMS,
    GET_ITEM_REMAINING_QUANTITY,
};
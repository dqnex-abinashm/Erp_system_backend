require('dotenv').config();
const mysql = require('mysql2/promise');
const EventEmitter = require('events');

const mysqlPool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'false' ? undefined : { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0,
    typeCast(field, next) {
        if (field.type === 'TINY' && field.length === 1) {
            const val = field.string();
            return val === null ? null : val === '1';
        }
        return next();
    },
});

/**
 * Translates PostgreSQL-style `$1, $2` parameters and `public.` schema qualifiers
 * into MariaDB `?` positional parameters while respecting string literals and comments.
 */
function translateSql(sql, params = []) {
    if (typeof sql !== 'string') return { sql, params };

    const safeParams = Array.isArray(params) ? params : [];
    const orderedParams = [];
    let hasDollarParam = false;
    let out = '';
    let i = 0;
    const len = sql.length;

    while (i < len) {
        const ch = sql[i];
        const next = sql[i + 1];

        // Single-quoted string literal
        if (ch === "'") {
            out += ch;
            i += 1;
            while (i < len) {
                const c = sql[i];
                out += c;
                if (c === '\\' && i + 1 < len) {
                    out += sql[i + 1];
                    i += 2;
                    continue;
                }
                if (c === "'" && sql[i + 1] === "'") {
                    out += "'";
                    i += 2;
                    continue;
                }
                i += 1;
                if (c === "'") break;
            }
            continue;
        }

        // Double-quoted identifier / literal
        if (ch === '"') {
            out += ch;
            i += 1;
            while (i < len) {
                const c = sql[i];
                out += c;
                i += 1;
                if (c === '"') break;
            }
            continue;
        }

        // Backtick identifier
        if (ch === '`') {
            out += ch;
            i += 1;
            while (i < len) {
                const c = sql[i];
                out += c;
                i += 1;
                if (c === '`') break;
            }
            continue;
        }

        // Line comment --
        if (ch === '-' && next === '-') {
            while (i < len && sql[i] !== '\n') {
                out += sql[i];
                i += 1;
            }
            continue;
        }

        // Block comment /* ... */
        if (ch === '/' && next === '*') {
            out += '/*';
            i += 2;
            while (i < len && !(sql[i] === '*' && sql[i + 1] === '/')) {
                out += sql[i];
                i += 1;
            }
            if (i < len) {
                out += '*/';
                i += 2;
            }
            continue;
        }

        // Strip PostgreSQL `public.` schema prefix
        if (
            (ch === 'p' || ch === 'P') &&
            sql.slice(i, i + 7).toLowerCase() === 'public.' &&
            (i === 0 || !/[a-zA-Z0-9_$]/.test(sql[i - 1]))
        ) {
            i += 7;
            continue;
        }

        // Convert $N placeholders
        if (ch === '$' && next >= '0' && next <= '9') {
            let j = i + 1;
            while (j < len && sql[j] >= '0' && sql[j] <= '9') {
                j += 1;
            }
            const idx = Number(sql.slice(i + 1, j)) - 1;
            hasDollarParam = true;
            out += '?';
            const val = idx >= 0 && idx < safeParams.length ? safeParams[idx] : null;
            orderedParams.push(val === undefined ? null : val);
            i = j;
            continue;
        }

        out += ch;
        i += 1;
    }

    const finalParams = hasDollarParam
        ? orderedParams
        : safeParams.map((v) => (v === undefined ? null : v));

    return { sql: out, params: finalParams };
}

function formatResult(rowsOrHeader) {
    if (Array.isArray(rowsOrHeader)) {
        return {
            rows: rowsOrHeader,
            rowCount: rowsOrHeader.length,
        };
    }
    return {
        rows: [],
        rowCount: rowsOrHeader && typeof rowsOrHeader.affectedRows === 'number' ? rowsOrHeader.affectedRows : 0,
        insertId: rowsOrHeader ? rowsOrHeader.insertId : undefined,
    };
}

function wrapConnection(conn) {
    let released = false;
    return {
        async query(sql, params = []) {
            const trimmed = typeof sql === 'string' ? sql.trim().replace(/;+$/, '').toUpperCase() : '';
            if (trimmed === 'BEGIN' || trimmed === 'START TRANSACTION') {
                await conn.beginTransaction();
                return { rows: [], rowCount: 0 };
            }
            if (trimmed === 'COMMIT') {
                await conn.commit();
                return { rows: [], rowCount: 0 };
            }
            if (trimmed === 'ROLLBACK') {
                await conn.rollback();
                return { rows: [], rowCount: 0 };
            }
            const translated = translateSql(sql, params);
            const [rowsOrHeader] = await conn.query(translated.sql, translated.params);
            return formatResult(rowsOrHeader);
        },
        release() {
            if (!released) {
                released = true;
                conn.release();
            }
        },
    };
}

const pool = new EventEmitter();

pool.query = async (sql, params = []) => {
    const translated = translateSql(sql, params);
    const [rowsOrHeader] = await mysqlPool.query(translated.sql, translated.params);
    return formatResult(rowsOrHeader);
};

pool.connect = (callback) => {
    const promise = mysqlPool.getConnection().then((conn) => wrapConnection(conn));
    if (typeof callback === 'function') {
        promise
            .then((client) => callback(null, client, () => client.release()))
            .catch((err) => callback(err, null, () => {}));
        return undefined;
    }
    return promise;
};

pool.end = () => mysqlPool.end();
pool.pool = pool;
pool.mysqlPool = mysqlPool;

module.exports = pool;

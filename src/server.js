const app = require('./app');
const pool = require('./config/database');

const PORT = process.env.PORT || 3000;

pool.connect((err, client, release) => {
    if (err) {
        console.error('MariaDB connection failed:', err.message);
    } else {
        console.log('MariaDB connected successfully');
        release();
    }

    app.listen(PORT, () => {
        console.log(`Backend running on port ${PORT}`);
    });
});

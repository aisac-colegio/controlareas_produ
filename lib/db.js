// se toma la librería "mysql2" y se pasa a un objeto para usarlo como funciones de una clase
const mysql = require('mysql2/promise');
require('dotenv').config();

// se crea el pool el cual es como la llave para ir a la base de datos, pero se mantiene oculta, este pool busca primero en el .env y si no encuentra el dato lo toma quemado del código
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'www.abogados.or.cr',
    user: process.env.DB_USER || 'controlareas',
    password: process.env.DB_PASSWORD || 'riosYmar42321',
    database: process.env.DB_NAME || 'controlareas',
    port: parseInt(process.env.DB_PORT || '3307'),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// se toma el pool, las funciones y se exportan y se toman en "index.js"
module.exports = pool;
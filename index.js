// librería que permite pasar datos atravez del body de las peticiones, como los datos de login o los datos del registro de visitas
const bodyParser = require('body-parser');

// librería que permite crear rutas, manejar sesiones, varios métodos HTTP en la misma ruta, rutas asíncronas para manejar queries a la base de datos, entre otras cosas
const express = require('express');

// (cookie) librería para manejar sesiones de usuario y mantenerlos logueados mientras navegan por el sitio
const session = require('express-session');

// librería para cifrar contraseñas antes de guardarlas en la base de datos, y para comparar contraseñas ingresadas con las cifradas al hacer login
const bcrypt = require('bcryptjs');

// Carga de variables de entorno desde un archivo .env, como las credenciales de la base de datos para no ponerlas en el código
require('dotenv').config();

// conjunto de funciones, métodos y credenciaes para hacer queries a la DB
const pool = require('./lib/db');

// maneja rutas estáticas para archivos o carpetas sin hacer rutas individuales para cada elemento dentro de una carpeta
const path = require('path');

// es casi que una librería CORS
const axios = require('axios');

// toma datos y los pone en un excel descargable como .xlsx por si alguien quiere meter los datos en PowerBI o algo similar
const ExcelJS = require('exceljs');

// toma la librería express y la asigna a un objeto para usarla globalmente
const app = express();

// se establece la cookie
app.use(session({
    secret: 'secret',
    resave: true,
    saveUninitialized: true
}));


// se establece que todo lo que esté dentro de la carpeta "public" es accesible para el usuario sin necesidad de hacer rutas específicas para cada archivo, como el CSS o las imágenes
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

// se establece la carpeta "public" para archivos estáticos como CSS, imágenes, etc
app.use(express.static(path.join(__dirname,'public')));

// permitir pasar datos desde formularios por el body siempre y cuando no sean mayores a 10mb
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(bodyParser.json({ limit: '10mb' }));

// función que verifica que el usuario en su cookie tenga rol de admin para permitirle entrar a ciertas áreas exclusivas para administradores
function esAdmin(req) {
    // Permite identificar acciones exclusivas de administradores.
    return Boolean(req.session && req.session.username && req.session.role === 'admin');
}

// función que verifica que el usuario en su cookie tenga rol de admin o moderador para permitirle entrar a ciertas áreas exclusivas para esos roles, como el dashboard de estadísticas
function esAdminOMod(req) {
    // Permite acciones compartidas por administradores y moderadores.
    return Boolean(req.session && req.session.username && ['admin', 'mod'].includes(req.session.role));
}

// basicamente verifica si está logueado o no porque los tres tipos de usuarios pueden hacer registros
function puedeRegistrarVisita(req) {
    // Los tres roles pueden registrar visitas, aunque no todos administran el sistema.
    return Boolean(req.session && req.session.username && ['admin', 'mod', 'user'].includes(req.session.role));
}

// traduce el rol tecnico guardado en sesion a un texto legible para mostrar en pantalla.
function datosSesion(req) {
    const roles = {
        admin: 'Administrador',
        mod: 'Moderador',
        user: 'Usuario'
    };

    return {
        username: req.session.username,
        role: roles[req.session.role] || req.session.role,
        nombre: req.session.nombre
    };
}

// establece la ruta del logo del header según el rol que esté guardado en la cookie
function rutaInicioPorRol(role) {
    const rutas = {
        admin: '/admin',
        mod: '/mod',
        user: '/user'
    };

    return rutas[String(role || '').toLowerCase()] || '/login';
}

// si no hay cookie, se manda al login; si hay cookie pero está intentando ingresar a un área fuera de su rol se avisa y vuelve a su panel
function redirigirSinPermiso(req, res) {
    // si no hay cookie o no tiene un nombre de usuario asignado se l devuelve al login ya que no tiene la suficiente información para navegar la página
    if (!req.session || !req.session.username) {
        return res.redirect('/login');
    }
    // se responde con error "403-Forbidden", se le da un alert con el mensaje y se le devuelve a su panel respectivo (toma el rol de la cookie y se le dirige)
    return res.status(403).send(`
        <script>
            alert('No tiene permiso para ingresar a esta área');
            window.location.href = '${rutaInicioPorRol(req.session.role)}';
        </script>`);
}

// landing page
app.get('/',(req,res)=>{res.render('index');});

// página de login
app.get('/login',(req,res)=>{res.render('login', { loginError: null });});

// función asincrónica para validar el login
app.post('/login', async (req, res) => {
    // aqui llegan el usuario y la clave desde el form en la variable de sesión "req"
    const { username, password } = req.body;
    //aqui se saca la nueva fecha de login ya que cada vez que se hace un login se ingresa el día en el que se logeo por ultima vez
    const ultimoLogin = formatearFecha(new Date());
    let connection;
    try {
        connection = await pool.getConnection();
        const [result] = await connection.execute('SELECT * FROM login WHERE usuario = ?', [username]);
        // consulta en la DB si el usuario existe o no
        if (result.length > 0) {
            const user = result[0];
            //console.log(user)
            // si los hash de la DB y el ingresado por el usuario coinciden se guarda la info en la cookie y se le redirige a su panel según su rol, si no coinciden se le muestra un error de login
            if (bcrypt.compareSync(password, user.clave)) {
                // guarda el rol, nombre y username en la cookie en caso de que la clave guardada y la de la DB son iguales
                const role = String(user.rol || '').toLowerCase();
                req.session.role = role;
                req.session.username = user.usuario;
                req.session.nombre = user.nombre;
                // aqui se ingresa la ultima fecha del login
                await connection.execute('UPDATE login SET ultimologin = ? WHERE usuario = ?', [ultimoLogin, user.usuario]);
                // Redirigir según rol
                if(role === 'admin' || role === 'administrador') return res.redirect('/admin');
                if(role === 'mod' || role === 'moderador') return res.redirect('/mod');
                if(role==='user' || role === 'usuario') return res.redirect("/user");
                return res.redirect('/login');
                
            } else {
                // Si la contraseña no coincide, mostrar error de login
                res.status(401).render('login', {
                    loginError: 'El login falló: usuario o contraseña incorrectos. Verifique sus datos y vuelva a intentarlo.'
                });
            }
        } else {
            // Si el usuario no existe, mostrar error de usuario inexistente
            res.status(401).render('login', {
                loginError: 'El usuario no se ha registrado. Contacte a TI para futuras indicaciones.'
            });
        }
    } catch (error) {
        // si hay error de conexión a la DB o algo inesperado, se muestra un error genérico y se loguea el error en la consola para que los desarrolladores puedan revisar qué pasó
        console.error('Error en login:', error);
        res.status(500).send('Error en login');
    } finally {
        // si el login fué exitoso se vacía la variable de pool
        if (connection) connection.release();
    } 
});

/* REGISTRO PUBLICO DESACTIVADO */
// los usuarios no se registran solos; los crea un administrador desde el CRUD de usuarios
app.get("/register",(req,res)=>{res.redirect('/login');});
app.post('/register', (req, res) => {res.redirect('/login');});

/* LOGOUT */
// cierra la sesion y limpia cookies del navegador
app.get('/logout', (req, res) => {
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
        cookieHeader.split(';').forEach((cookie) => {
            const cookieName = cookie.split('=')[0].trim();
            if (cookieName) res.clearCookie(cookieName);
        });
    }

    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/login');
    });
});

/*-----------------vista ADMIN------------------*/
// aqui se declara admin en el verbo get para facilitar los brincos entre páginas pero siempre va a pedir el nombre de usuario desde la cookie y si es algo diferente a "admin" lo devuelve al login y llega a admin desde el login y con la cookie ya puesta
app.get('/admin', (req, res) => {
    // tira la página de admin si en la cookie el usuario tiene rol de admin
    if (req.session && req.session.username && req.session.role === 'admin') {
        res.render('admin', { username: req.session.username, role: 'Administrador', nombre: req.session.nombre });
    } else {return redirigirSinPermiso(req, res);}
});

app.get("/admin/usuarios", async (req, res) => {
    // consulta y lista TODOS los usuarios existentes y permite hacer CRUD, solo para admins
    if (req.session && req.session.username && req.session.role === 'admin') {
        let connection;
        try {
            connection = await pool.getConnection();
            const [usuarios] = await connection.execute('SELECT iduser, usuario, nombre, rol, ultimologin FROM login ORDER BY usuario');
            res.render('usuarios', { username: req.session.username, role: 'Administrador', nombre: req.session.nombre, usuarios });
        } catch (error) {
            console.error('Error cargando usuarios:', error);
            res.status(500).send('Error cargando usuarios');
        } finally {
            if (connection) connection.release();
        }
    } else {return redirigirSinPermiso(req, res);}
});

// ruta POST para crear un nuevo usuario desde el formulario de admin/usuarios, solo accesible para admins, con validaciones básicas de formatos y duplicados y manejo de errores
app.post("/admin/usuarios", async (req, res) => {
    if (!req.session || !req.session.username || req.session.role !== 'admin') {
        return redirigirSinPermiso(req, res);
    }
    // tira a string los datos del formulario
    const usuario = String(req.body.usuario || '').trim();
    const nombre = String(req.body.nombre || '').trim();
    const clave = String(req.body.clave || '');
    const rol = String(req.body.rol || '').trim().toLowerCase();
    const rolesPermitidos = ['admin', 'mod', 'user'];

    // valida los datos existan y que los roles sean reales
    if (!usuario || !nombre || !clave || !rolesPermitidos.includes(rol)) {
        return res.status(400).send(`
            <script>
                alert('Complete todos los datos del usuario.');
                window.location.href = '/admin/usuarios';
            </script>`);
    }

    // crea el ID de la DB para el usuario
    // la función "Date.now()" toma el tiempo en milisegundos desde el primero de enero de 1970 hasta el momento que se llama la función
    const iduser = "user"+Date.now();
    // toma la clave y la tira a hash+sal con un factor de 10, yo no recomiendo usar más de 10 porque va a lerdear el login
    const hashedPassword = bcrypt.hashSync(clave, 10);
    let connection;

    // valida que el nombre de usuario no exista en la db para no duplicarlo
    try {
        connection = await pool.getConnection();
        const [existente] = await connection.execute('SELECT iduser FROM login WHERE usuario = ?', [usuario]);
        if (existente.length > 0) {
            return res.status(409).send(`
                <script>
                    alert('El nombre de usuario ya existe.');
                    window.location.href = '/admin/usuarios';
                </script>`);
        }
        await connection.execute('INSERT INTO login (iduser, usuario, nombre, clave, rol, ultimologin) VALUES (?, ?, ?, ?, ?, ?)', [iduser, usuario, nombre, hashedPassword, rol, '']);
        res.send(`
            <script>
                alert('Usuario creado exitosamente.');
                window.location.href = '/admin/usuarios';
            </script>`);
    } catch (error) {
        console.error('Error creando usuario:', error);
        res.status(500).send('Error creando usuario');
    } finally {
        if (connection) connection.release();
    }
});

// ruta POST para editar un usuario existente con un query UDPATE y valida antes de tirar el query
app.post("/admin/usuarios/:id/editar", async (req, res) => {
    // Actualiza usuario, nombre, rol y opcionalmente la clave.
    if (!req.session || !req.session.username || req.session.role !== 'admin') {
        return redirigirSinPermiso(req, res);
    }
    const usuario = String(req.body.usuario || '').trim();
    const nombre = String(req.body.nombre || '').trim();
    const clave = String(req.body.clave || '');
    const rol = String(req.body.rol || '').trim().toLowerCase();
    const rolesPermitidos = ['admin', 'mod', 'user'];
    if (!usuario || !nombre || !rolesPermitidos.includes(rol)) {
        return res.status(400).send(`
            <script>
                alert('Complete los datos requeridos del usuario.');
                window.location.href = '/admin/usuarios';
            </script>`);
    }
    let connection;
    try {
        connection = await pool.getConnection();
        const [usuarioActual] = await connection.execute('SELECT usuario FROM login WHERE iduser = ?', [req.params.id]);
        if (usuarioActual.length === 0) {
            return res.redirect('/admin/usuarios');
        }

        const [existente] = await connection.execute('SELECT iduser FROM login WHERE usuario = ? AND iduser <> ?', [usuario, req.params.id]);
        if (existente.length > 0) {
            return res.status(409).send(`
                <script>
                    alert('El nombre de usuario ya existe.');
                    window.location.href = '/admin/usuarios';
                </script>`);
        }

        if (clave) {
            const hashedPassword = bcrypt.hashSync(clave, 10);
            await connection.execute('UPDATE login SET usuario = ?, nombre = ?, rol = ?, clave = ? WHERE iduser = ?', [usuario, nombre, rol, hashedPassword, req.params.id]);
        } else {
            await connection.execute('UPDATE login SET usuario = ?, nombre = ?, rol = ? WHERE iduser = ?', [usuario, nombre, rol, req.params.id]);
        }

        if (req.session.username === usuarioActual[0].usuario) {
            req.session.username = usuario;
            req.session.nombre = nombre;
            req.session.role = rol;
        }

        res.send(`
            <script>
                alert('Usuario actualizado exitosamente.');
                window.location.href = '/admin/usuarios';
            </script>`);
    } catch (error) {
        console.error('Error actualizando usuario:', error);
        res.status(500).send('Error actualizando usuario');
    } finally {
        if (connection) connection.release();
    }
});

// ruta POST que toma el ID del usuario y tira un query DELETE a la DB
app.post("/admin/usuarios/:id/eliminar", async (req, res) => {
    // Elimina un usuario, pero evita borrar la cuenta actualmente conectada.
    if (!req.session || !req.session.username || req.session.role !== 'admin') {
        return redirigirSinPermiso(req, res);
    }

    let connection;
    try {
        connection = await pool.getConnection();
        const [usuario] = await connection.execute('SELECT usuario FROM login WHERE iduser = ?', [req.params.id]);
        if (usuario.length === 0) {
            return res.redirect('/admin/usuarios');
        }

        if (usuario[0].usuario === req.session.username) {
            return res.status(400).send(`
                <script>
                    alert('No puede eliminar el usuario con la sesion activa.');
                    window.location.href = '/admin/usuarios';
                </script>`);
        }

        await connection.execute('DELETE FROM login WHERE iduser = ?', [req.params.id]);
        res.send(`
            <script>
                alert('Usuario eliminado exitosamente.');
                window.location.href = '/admin/usuarios';
            </script>`);
    } catch (error) {
        console.error('Error eliminando usuario:', error);
        res.status(500).send('Error eliminando usuario');
    } finally {
        if (connection) connection.release();
    }
});

//carga vista de moderador si tiene el rol en la cookie
app.get('/mod', (req, res) => {
    // Panel del moderador: registrar visitas y consultar estadisticas.
    if (req.session && req.session.username && req.session.role === 'mod') {
        res.render('mod', { username: req.session.username, role: 'Moderador', nombre: req.session.nombre });
    } else {return redirigirSinPermiso(req, res);}
});

//carga vista de administrador si tiene el rol en la cookie
app.get('/user', (req, res) => {
    // Panel del usuario basico: registrar visitas solamente.
    if (req.session && req.session.username && req.session.role === 'user') {
        res.render('user', { username: req.session.username, role: 'Usuario', nombre: req.session.nombre });
    } else {return redirigirSinPermiso(req, res);}
});

// lista las áreas activas e inactivas para la pantalla de administracion
async function obtenerAreas() {
    let connection;
    try {
        connection = await pool.getConnection();
        const [result] = await connection.execute('SELECT idareas, nombrearea, activo FROM areas ORDER BY activo DESC, nombrearea');
        return result;
    } finally {
        if (connection) connection.release();
    }
}

// lista solo las áreas ACTIVAS
async function obtenerAreasActivas() {
    let connection;
    try {
        connection = await pool.getConnection();
        const [result] = await connection.execute('SELECT idareas, nombrearea FROM areas WHERE activo IS NOT FALSE ORDER BY nombrearea');
        return result;
    } finally {
        if (connection) connection.release();
    }
}

// carga la página de CRUD de áreas
app.get("/admin/areas", async (req, res) => {
    if (esAdmin(req)) {
        try {
            const areas = await obtenerAreas();
            res.render('areas', { ...datosSesion(req), areas });
        } catch (error) {
            console.error('Error cargando areas:', error);
            res.status(500).send('Error cargando areas');
        }
    } else {return redirigirSinPermiso(req, res);}
});

// valida, agrega un área y se refresca un área
app.post("/admin/areas", async (req, res) => {
    if (!esAdmin(req)) {
        return redirigirSinPermiso(req, res);
    }
    const idareas = "area-"+Date.now();
    const nombrearea = String(req.body.nombrearea || '').trim();
    if (!nombrearea) return res.redirect('/admin/areas');

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.execute('INSERT INTO areas (idareas, nombrearea, activo) VALUES (?, ?, true)', [idareas, nombrearea]);
        res.send(`
            <script>
                alert('Area guardada exitosamente.');
                window.location.href = '/admin/areas';
            </script>`);
    } catch (error) {
        console.error('Error creando area:', error);
        res.status(500).send('Error creando area');
    } finally {
        if (connection) connection.release();
    }
});

// edita SOLAMENTE el nombre del área con un query UPDATE
app.post("/admin/areas/:id/editar", async (req, res) => {
    if (!esAdmin(req)) {
        return redirigirSinPermiso(req, res);
    }

    const nombrearea = String(req.body.nombrearea || '').trim();
    if (!nombrearea) return res.redirect('/admin/areas');

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.execute('UPDATE areas SET nombrearea = ? WHERE idareas = ?', [nombrearea, req.params.id]);
        res.send(`
            <script>
                alert('Area actualizada exitosamente.');
                window.location.href = '/admin/areas';
            </script>`);
    } catch (error) {
        console.error('Error actualizando area:', error);
        res.status(500).send('Error actualizando area');
    } finally {
        if (connection) connection.release();
    }
});

// esto no borra el área, solamente la deshabilita, no se borra ya que el ID del área está referenciada en TODOS los registros y no se pueden dejar registros de una FK desreferenciados, al deshabilitarse se permite que no salga el área en la lista para nuevos registros y no sale como opción en las estadísticas, (tira a false el bool de la tabla), cuando se termina de refresca la página
app.post("/admin/areas/:id/eliminar", async (req, res) => {
    if (!esAdmin(req)) {
        return redirigirSinPermiso(req, res);
    }
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.execute('UPDATE areas SET activo = false WHERE idareas = ?', [req.params.id]);
        res.redirect('/admin/areas');
    } catch (error) {
        console.error('Error eliminando area:', error);
        res.status(500).send('Error eliminando area');
    } finally {
        if (connection) connection.release();
    }
});

// hace lo mismo que lo de arriba pero al revez (tira a true el bool de la tabla) y vuelve a aparecer
app.post("/admin/areas/:id/rehabilitar", async (req, res) => {
    if (!esAdmin(req)) {
        return redirigirSinPermiso(req, res);
    }
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.execute('UPDATE areas SET activo = true WHERE idareas = ?', [req.params.id]);
        res.redirect('/admin/areas');
    } catch (error) {
        console.error('Error rehabilitando area:', error);
        res.status(500).send('Error rehabilitando area');
    } finally {
        if (connection) connection.release();
    }
});

// carga la página de ingresar agremiado si está logueado con cualquier rol
app.get("/admin/ingresaragremiado", async (req,res)=>{
    if (puedeRegistrarVisita(req)) {
        try {
            const areas = await obtenerAreasActivas();
            res.render('ingresaragremiado', { ...datosSesion(req), areas });
        } catch (error) {
            console.error('Error cargando areas:', error);
            res.status(500).send('Error cargando areas');
        }
    } else {return redirigirSinPermiso(req, res);}
});

// ingresa el registro de la visita si los datos son existentes y con formato válido
app.post("/admin/ingresaragremiado", async (req,res)=>{
    if (!puedeRegistrarVisita(req)) {
        return redirigirSinPermiso(req, res);
    }
    const idregistro = "registro-"+Date.now();
    const {agremiado, nombreCompleto, area, cedula} = req.body;
    const fecha = formatearFecha(new Date());
    const usuarioregistrador = req.session.username;
    let connection;
    try {
        connection = await pool.getConnection();
        const [areaResult] = await connection.execute('SELECT idareas, nombrearea FROM areas WHERE idareas = ? AND activo IS NOT FALSE', [area]);
        if (areaResult.length === 0) {
            return res.status(400).send(`
                <script>
                    alert('Seleccione un area valida.');
                    window.location.href = '/admin/ingresaragremiado';
                </script>`);
        }

        await connection.execute('INSERT INTO registro (idregistro, agremiado, nombreCompleto, cedula, area, fechaingreso, usuarioregistrador) VALUES (?, ?, ?, ?, ?, ?, ?)', [idregistro, agremiado, nombreCompleto, cedula || '', area, fecha, usuarioregistrador]);
        res.send(`
            <script>
                alert('Agremiado registrado exitosamente.');
                window.location.href = '/admin/ingresaragremiado';
            </script>`);
    } catch (error) {
        console.error('Error registrando agremiado:', error);
        res.status(500).send('Error registrando agremiado');
    } finally {
        if (connection) connection.release();
    }
});


// carga "verdatos.ejs" si es admin o mod
app.get("/admin/verdatos", (req, res) => {
    // Dashboard de reportes y graficos para admin y moderador.
    if (esAdminOMod(req)) {
        res.render('verdatos', datosSesion(req));
    } else {return redirigirSinPermiso(req, res);}
});

// Endpoint para obtener estadísticas
app.get("/api/estadisticas", async (req, res) => {
    // Calcula metricas del dashboard segun periodo, area, carnet o cedula.
    if (!esAdminOMod(req)) {
        return res.status(401).json({ error: 'No autorizado' });
    }

    // se declaran los tipos de filtro que puede hacer el dashboard (fecha, carnet, cédula y área)
    const { filtro = 'hoy', area, mes, anio } = req.query;
    const carnetBusqueda = String(req.query.carnet || '').trim();
    const cedulaBusqueda = String(req.query.cedula || '').trim();
    const hayBusquedaPersona = carnetBusqueda !== '' || cedulaBusqueda !== '';
    const periodoOffset = parseInt(req.query.offset || '0', 10);
    let connection;
    
    try {
        connection = await pool.getConnection();
        // obtener todas las áreas disponibles
        const [areasResult] = await connection.execute('SELECT idareas, nombrearea FROM areas WHERE activo IS NOT FALSE ORDER BY nombrearea');
        const todasLasAreas = areasResult;

        // Determinar rango de fechas
        const hoy = new Date();
        let fechaInicio, fechaFin;

        // tira un string a fecha normal
        const convertirFechaStringADate = (fechaStr) => {
            const partes = fechaStr.split('-')[0].split('/');
            return new Date(partes[2], partes[1] - 1, partes[0]);
        };
        // tira la fecha a string
        const formatearFechaComparacion = (fecha) => {
            const dd = String(fecha.getDate()).padStart(2, "0");
            const mm = String(fecha.getMonth() + 1).padStart(2, "0");
            const yyyy = fecha.getFullYear();
            return `${dd}/${mm}/${yyyy}`;
        };

        // toma el mes y el anio actual
        const mesSeleccionado = parseInt(mes || String(hoy.getMonth() + 1), 10);
        const anioSeleccionado = parseInt(anio || String(hoy.getFullYear()), 10);

        // switch-case según el tipo de filtro por fecha, define fecha Inicio y Fin para definir el rango
        switch(filtro) {
            case 'hoy':
                fechaInicio = new Date(hoy);
                fechaInicio.setDate(hoy.getDate() + periodoOffset);
                fechaFin = new Date(hoy);
                fechaFin.setDate(hoy.getDate() + periodoOffset);
                break;
            case 'semanal':
                fechaInicio = new Date(hoy);
                fechaInicio.setDate(hoy.getDate() - hoy.getDay() + (periodoOffset * 7));
                fechaFin = new Date(fechaInicio);
                fechaFin.setDate(fechaInicio.getDate() + 6);
                break;
            case 'mensual':
                if (mes && anio) {
                    fechaInicio = new Date(anioSeleccionado, mesSeleccionado - 1, 1);
                    fechaFin = new Date(anioSeleccionado, mesSeleccionado, 0);
                } else {
                    fechaInicio = new Date(hoy.getFullYear(), hoy.getMonth() + periodoOffset, 1);
                    fechaFin = new Date(hoy.getFullYear(), hoy.getMonth() + periodoOffset + 1, 0);
                }
                break;
            case 'anual':
                if (anio) {
                    fechaInicio = new Date(anioSeleccionado, 0, 1);
                    fechaFin = new Date(anioSeleccionado, 11, 31);
                } else {
                    fechaInicio = new Date(hoy.getFullYear() + periodoOffset, 0, 1);
                    fechaFin = new Date(hoy.getFullYear() + periodoOffset, 11, 31);
                }
                break;
            // si no se selecciona un filtro se elige por defecto el día actual tomandolo de la computadora del cliente, NO del servidor
            default:
                fechaInicio = new Date(hoy);
                fechaInicio.setDate(hoy.getDate() + periodoOffset);
                fechaFin = new Date(hoy);
                fechaFin.setDate(hoy.getDate() + periodoOffset);
        }

        // se hace el select con el área para solo ver ciertas áreas
        const nombreAreaSql = 'COALESCE(a.nombrearea, r.area)';
        let query = `SELECT ${nombreAreaSql} as area, COUNT(*) as total FROM registro r LEFT JOIN areas a ON r.area = a.idareas OR r.area = a.nombrearea WHERE `;
        let params = [];

        // le añade rangos de fechas en caso de que se filtre por área y fecha al mismo tiempo
        const fechaInicioStr = formatearFechaComparacion(fechaInicio);
        const fechaFinStr = formatearFechaComparacion(fechaFin);
        const fechaRegistroSql = `CASE
            WHEN SUBSTRING(r.fechaingreso, 1, 10) REGEXP '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN STR_TO_DATE(SUBSTRING(r.fechaingreso, 1, 10), '%d/%m/%Y')
            WHEN SUBSTRING(r.fechaingreso, 1, 10) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN STR_TO_DATE(SUBSTRING(r.fechaingreso, 1, 10), '%Y-%m-%d')
            ELSE NULL
        END`;
        
        // distingue si es solo por fecha, fecha+área o fecha+área+persona para añadirle parámetros al query en vez de tirar 3 queries separados
        const aplicarFiltros = () => {
            if (!hayBusquedaPersona) {
                query += ` AND ${fechaRegistroSql} >= STR_TO_DATE(?, '%d/%m/%Y') AND ${fechaRegistroSql} <= STR_TO_DATE(?, '%d/%m/%Y')`;
                params.push(fechaInicioStr, fechaFinStr);
            }

            if (carnetBusqueda) {
                query += ` AND r.agremiado = ?`;
                params.push(carnetBusqueda);
            }

            if (cedulaBusqueda) {
                query += ` AND r.cedula = ?`;
                params.push(cedulaBusqueda);
            }

            if (area && !hayBusquedaPersona) {
                query += ` AND (r.area = ? OR a.idareas = ? OR a.nombrearea = ?)`;
                params.push(area, area, area);
            }
        };

        query += '1=1';
        aplicarFiltros();

        // se muestra el área en orden descendente según la cantidad de visitas totales del rango de fechas
        query += ` GROUP BY ${nombreAreaSql} ORDER BY total DESC`;

        // tira los rows del resultado a un array y despúes a un objeto JSON
        const [result] = await connection.execute(query, params);
        const estadisticas = result;

        // obtener detalle por día específico
        query = `SELECT ${fechaRegistroSql} as fecha, COUNT(*) as visitas FROM registro r LEFT JOIN areas a ON r.area = a.idareas OR r.area = a.nombrearea WHERE `;
        params = [];

        query += '1=1';
        aplicarFiltros();

        query += ` GROUP BY ${fechaRegistroSql} ORDER BY fecha`;

        const [detalleResult] = await connection.execute(query, params);
        const detallePorDia = detalleResult.map(row => ({
            fecha: row.fecha ? new Date(row.fecha).toLocaleDateString('es-CR') : 'N/A',
            visitas: parseInt(row.visitas)
        }));

        // Obtener todos los registros individuales
        query = `SELECT r.agremiado, r.cedula, ${nombreAreaSql} as area, r.fechaingreso, r.usuarioregistrador FROM registro r LEFT JOIN areas a ON r.area = a.idareas OR r.area = a.nombrearea WHERE `;
        params = [];

        query += '1=1';
        aplicarFiltros();

        query += ' ORDER BY r.fechaingreso DESC';

        const [registrosResult] = await connection.execute(query, params);
        const registros = registrosResult;

        // todo se devuelve en JSON para acomodarlo en el frontend
        res.json({
            estadisticas,
            detallePorDia,
            registros,
            todasLasAreas,
            filtroActivo: filtro,
            periodoOffset,
            fechaInicio: fechaInicioStr,
            fechaFin: fechaFinStr,
            busquedaPersona: hayBusquedaPersona,
            carnetBusqueda,
            cedulaBusqueda,
            areaFiltro: area || 'Todas'
        });

    } catch(error) {
        console.error('Error en estadísticas:', error);
        res.status(500).json({ error: 'Error al obtener estadísticas' });
    } finally {
        if (connection) connection.release();
    }
});

// API para tirar todo a Excel, el excel se genera según el filtro que tenga el dashboard, el hace sus propios filtros pero son identicos a los del dashboard físico, los datos se separan en tablas y lo tira a un archivo .xlsx para descargar, solo accesible para admin y mod
app.get("/api/exportar-excel", async (req, res) => {
    if (!esAdminOMod(req)) {
        return res.status(401).json({ error: 'No autorizado' });
    }

    const { filtro = 'hoy', area, mes, anio } = req.query;
    const carnetBusqueda = String(req.query.carnet || '').trim();
    const cedulaBusqueda = String(req.query.cedula || '').trim();
    const hayBusquedaPersona = carnetBusqueda !== '' || cedulaBusqueda !== '';
    const periodoOffset = parseInt(req.query.offset || '0', 10);
    let connection;
    
    try {
        connection = await pool.getConnection();
        
        // Obtener todas las áreas disponibles
        const [areasResult] = await connection.execute('SELECT idareas, nombrearea FROM areas WHERE activo IS NOT FALSE ORDER BY nombrearea');
        const todasLasAreas = areasResult;

        // Determinar rango de fechas
        const hoy = new Date();
        let fechaInicio, fechaFin;

        const formatearFechaComparacion = (fecha) => {
            const dd = String(fecha.getDate()).padStart(2, "0");
            const mm = String(fecha.getMonth() + 1).padStart(2, "0");
            const yyyy = fecha.getFullYear();
            return `${dd}/${mm}/${yyyy}`;
        };

        const mesSeleccionado = parseInt(mes || String(hoy.getMonth() + 1), 10);
        const anioSeleccionado = parseInt(anio || String(hoy.getFullYear()), 10);

        switch(filtro) {
            case 'hoy':
                fechaInicio = new Date(hoy);
                fechaInicio.setDate(hoy.getDate() + periodoOffset);
                fechaFin = new Date(hoy);
                fechaFin.setDate(hoy.getDate() + periodoOffset);
                break;
            case 'semanal':
                fechaInicio = new Date(hoy);
                fechaInicio.setDate(hoy.getDate() - hoy.getDay() + (periodoOffset * 7));
                fechaFin = new Date(fechaInicio);
                fechaFin.setDate(fechaInicio.getDate() + 6);
                break;
            case 'mensual':
                if (mes && anio) {
                    fechaInicio = new Date(anioSeleccionado, mesSeleccionado - 1, 1);
                    fechaFin = new Date(anioSeleccionado, mesSeleccionado, 0);
                } else {
                    fechaInicio = new Date(hoy.getFullYear(), hoy.getMonth() + periodoOffset, 1);
                    fechaFin = new Date(hoy.getFullYear(), hoy.getMonth() + periodoOffset + 1, 0);
                }
                break;
            case 'anual':
                if (anio) {
                    fechaInicio = new Date(anioSeleccionado, 0, 1);
                    fechaFin = new Date(anioSeleccionado, 11, 31);
                } else {
                    fechaInicio = new Date(hoy.getFullYear() + periodoOffset, 0, 1);
                    fechaFin = new Date(hoy.getFullYear() + periodoOffset, 11, 31);
                }
                break;
            default:
                fechaInicio = new Date(hoy);
                fechaInicio.setDate(hoy.getDate() + periodoOffset);
                fechaFin = new Date(hoy);
                fechaFin.setDate(hoy.getDate() + periodoOffset);
        }

        // Obtener datos de estadísticas
        const nombreAreaSql = 'COALESCE(a.nombrearea, r.area)';
        let query = `SELECT ${nombreAreaSql} as area, COUNT(*) as total FROM registro r LEFT JOIN areas a ON r.area = a.idareas OR r.area = a.nombrearea WHERE `;
        let params = [];

        const fechaInicioStr = formatearFechaComparacion(fechaInicio);
        const fechaFinStr = formatearFechaComparacion(fechaFin);
        const fechaRegistroSql = `CASE
            WHEN SUBSTRING(r.fechaingreso, 1, 10) REGEXP '^[0-9]{2}/[0-9]{2}/[0-9]{4}$' THEN STR_TO_DATE(SUBSTRING(r.fechaingreso, 1, 10), '%d/%m/%Y')
            WHEN SUBSTRING(r.fechaingreso, 1, 10) REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN STR_TO_DATE(SUBSTRING(r.fechaingreso, 1, 10), '%Y-%m-%d')
            ELSE NULL
        END`;
        
        const aplicarFiltros = () => {
            if (!hayBusquedaPersona) {
                query += ` AND ${fechaRegistroSql} >= STR_TO_DATE(?, '%d/%m/%Y') AND ${fechaRegistroSql} <= STR_TO_DATE(?, '%d/%m/%Y')`;
                params.push(fechaInicioStr, fechaFinStr);
            }

            if (carnetBusqueda) {
                query += ` AND r.agremiado = ?`;
                params.push(carnetBusqueda);
            }

            if (cedulaBusqueda) {
                query += ` AND r.cedula = ?`;
                params.push(cedulaBusqueda);
            }

            if (area && !hayBusquedaPersona) {
                query += ` AND (r.area = ? OR a.idareas = ? OR a.nombrearea = ?)`;
                params.push(area, area, area);
            }
        };

        query += '1=1';
        aplicarFiltros();
        query += ` GROUP BY ${nombreAreaSql} ORDER BY total DESC`;

        const [estadisticas] = await connection.execute(query, params);

        // Obtener detalles
        query = `SELECT ${fechaRegistroSql} as fecha, COUNT(*) as visitas FROM registro r LEFT JOIN areas a ON r.area = a.idareas OR r.area = a.nombrearea WHERE `;
        params = [];

        query += '1=1';
        aplicarFiltros();
        query += ` GROUP BY ${fechaRegistroSql} ORDER BY fecha`;

        const [detalleResult] = await connection.execute(query, params);
        const detallePorDia = detalleResult.map(row => ({
            fecha: row.fecha ? new Date(row.fecha).toLocaleDateString('es-CR') : 'N/A',
            visitas: parseInt(row.visitas)
        }));

        // Obtener registros individuales
        query = `SELECT r.agremiado, r.cedula, ${nombreAreaSql} as area, r.fechaingreso, r.usuarioregistrador FROM registro r LEFT JOIN areas a ON r.area = a.idareas OR r.area = a.nombrearea WHERE `;
        params = [];

        query += '1=1';
        aplicarFiltros();
        query += ' ORDER BY r.fechaingreso DESC';

        const [registrosResult] = await connection.execute(query, params);

        // crea el archivo de Excel con los datos obtenidos, se crean 3 hojas, una para el resumen general, otra para las estadísticas por área y otra para los registros detallados, se les aplican estilos para que sea más legible y se formatean los datos para que se vean bien en Excel
        const workbook = new ExcelJS.Workbook();
        const totalVisitas = estadisticas.reduce((sum, row) => sum + Number(row.total || 0), 0);

        // hoja 1: resumen general, todos los datos
        const wsResumen = workbook.addWorksheet('Resumen');
        wsResumen.columns = [
            { header: '', key: 'label', width: 25 },
            { header: '', key: 'value', width: 30 }
        ];

        // estilos visuales
        const headerStyle = { fill: { type: 'pattern', pattern: 'solid', fgColor: { rgb: 'FF374151' } }, font: { bold: true, color: { rgb: 'FFFFFFFF' } }, alignment: { horizontal: 'center', vertical: 'center' } };
        const titleStyle = { font: { size: 16, bold: true, color: { rgb: 'FF111827' } }, alignment: { horizontal: 'left', vertical: 'center' } };
        const dataStyle = { fill: { type: 'pattern', pattern: 'solid', fgColor: { rgb: 'FFF9FAFB' } }, alignment: { horizontal: 'center', vertical: 'center' } };

        // título
        wsResumen.mergeCells('A1:B1');
        const titleCell = wsResumen.getCell('A1');
        titleCell.value = 'Reporte de Estadísticas';
        titleCell.font = { size: 18, bold: true, color: { rgb: 'FF111827' } };
        titleCell.alignment = { horizontal: 'center', vertical: 'center' };
        wsResumen.getRow(1).height = 25;

        // metadata del usuario y timestamp de la creación del reporte
        wsResumen.addRow({ label: 'Generado por:', value: req.session.nombre + ' (' + req.session.username + ')' });
        wsResumen.addRow({ label: 'Período:', value: `${filtro.charAt(0).toUpperCase() + filtro.slice(1)} - Del ${fechaInicioStr} al ${fechaFinStr}` });
        wsResumen.addRow({ label: 'Fecha de generación:', value: new Date().toLocaleDateString('es-CR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) });
        wsResumen.addRow({ label: '', value: '' });

        // resumen de estadísticas generales
        wsResumen.addRow({ label: 'Total Visitas:', value: totalVisitas });
        wsResumen.addRow({ label: 'Áreas Activas:', value: todasLasAreas.length });
        wsResumen.addRow({ label: 'Promedio Diario:', value: detallePorDia.length > 0 ? (totalVisitas / detallePorDia.length).toFixed(1) : '0' });
        wsResumen.addRow({ label: 'Área Más Visitada:', value: estadisticas.length > 0 ? estadisticas[0].area : 'N/A' });

        // Aplicar estilos
        wsResumen.eachRow((row, rowNumber) => {
            if (rowNumber > 2 && rowNumber < 6) {
                row.getCell(1).font = { bold: true, color: { rgb: 'FF374151' } };
            }
        });

        // hoja 2: estadísticas por área
        const wsAreas = workbook.addWorksheet('Estadísticas por Área');
        wsAreas.columns = [
            { header: '#', key: 'numero', width: 5 },
            { header: 'Área', key: 'area', width: 40 },
            { header: 'Total Visitas', key: 'total', width: 15 },
            { header: 'Porcentaje', key: 'porcentaje', width: 15 }
        ];

        // Encabezado
        wsAreas.getRow(1).eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { rgb: 'FF374151' } };
            cell.font = { bold: true, color: { rgb: 'FFFFFFFF' } };
            cell.alignment = { horizontal: 'center', vertical: 'center' };
        });

        estadisticas.forEach((stat, index) => {
            const porcentaje = totalVisitas > 0 ? ((Number(stat.total) / totalVisitas) * 100).toFixed(1) : '0.0';
            wsAreas.addRow({
                numero: index + 1,
                area: stat.area || 'Sin área',
                total: Number(stat.total) || 0,
                porcentaje: porcentaje + '%'
            });
        });

        // Aplicar estilos a datos
        wsAreas.eachRow((row, rowNumber) => {
            if (rowNumber > 1) {
                row.eachCell((cell) => {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { rgb: rowNumber % 2 === 0 ? 'FFF9FAFB' : 'FFFFFFFF' } };
                    cell.alignment = { horizontal: rowNumber === 1 ? 'center' : (cell.col === 3 || cell.col === 4 ? 'center' : 'left'), vertical: 'center' };
                });
            }
        });

        // hoja 3: registros detallados
        const wsRegistros = workbook.addWorksheet('Registros Detallados');
        wsRegistros.columns = [
            { header: '#', key: 'numero', width: 5 },
            { header: 'Carnet', key: 'agremiado', width: 15 },
            { header: 'Cédula', key: 'cedula', width: 15 },
            { header: 'Área', key: 'area', width: 25 },
            { header: 'Fecha Ingreso', key: 'fechaingreso', width: 18 },
            { header: 'Usuario Registrador', key: 'usuarioregistrador', width: 18 }
        ];

        // Encabezado
        wsRegistros.getRow(1).eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { rgb: 'FF374151' } };
            cell.font = { bold: true, color: { rgb: 'FFFFFFFF' } };
            cell.alignment = { horizontal: 'center', vertical: 'center' };
        });

        registrosResult.forEach((reg, index) => {
            wsRegistros.addRow({
                numero: index + 1,
                agremiado: reg.agremiado || '-',
                cedula: reg.cedula || '-',
                area: (reg.area || '-').toUpperCase(),
                fechaingreso: reg.fechaingreso || '-',
                usuarioregistrador: reg.usuarioregistrador || '-'
            });
        });

        // Aplicar estilos a datos
        wsRegistros.eachRow((row, rowNumber) => {
            if (rowNumber > 1) {
                row.eachCell((cell) => {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { rgb: rowNumber % 2 === 0 ? 'FFF9FAFB' : 'FFFFFFFF' } };
                    cell.alignment = { horizontal: 'center', vertical: 'center' };
                });
            }
        });

        // hoja 4: evolución diaria
        const wsEvolucion = workbook.addWorksheet('Evolución Diaria');
        wsEvolucion.columns = [
            { header: '#', key: 'numero', width: 5 },
            { header: 'Fecha', key: 'fecha', width: 20 },
            { header: 'Visitas', key: 'visitas', width: 15 }
        ];

        // Encabezado
        wsEvolucion.getRow(1).eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { rgb: 'FF374151' } };
            cell.font = { bold: true, color: { rgb: 'FFFFFFFF' } };
            cell.alignment = { horizontal: 'center', vertical: 'center' };
        });

        detallePorDia.forEach((dia, index) => {
            wsEvolucion.addRow({
                numero: index + 1,
                fecha: dia.fecha,
                visitas: dia.visitas
            });
        });

        // Aplicar estilos a datos
        wsEvolucion.eachRow((row, rowNumber) => {
            if (rowNumber > 1) {
                row.eachCell((cell) => {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { rgb: rowNumber % 2 === 0 ? 'FFF9FAFB' : 'FFFFFFFF' } };
                    cell.alignment = { horizontal: 'center', vertical: 'center' };
                });
            }
        });

        // Generar archivo con nombre,fecha y extensión
        const filename = `reporte-estadisticas-${new Date().toISOString().split('T')[0]}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        await workbook.xlsx.write(res);
        res.end();

    } catch(error) {
        console.error('Error exportando Excel:', error);
        res.status(500).json({ error: 'Error al exportar a Excel' });
    } finally {
        if (connection) connection.release();
    }
});

// API para descargar lo mismo del excel pero en PDF (se maneja en el cliente con html2pdf.js)
// la función descargarPDF() está en la vista verdatos.ejs que maneja la generación del PDF

// función para consultar datos de agremiados por carnet o cédula
async function consultarAgremiadoJSON(valor, tipoBusqueda = 'carnet') {
    // en una variable se declaran las URLs para consultar los datos del agremiado por carnet o cédula
    const baseUrlCarnet = process.env.AGREMIADO_JSON_URL || 'https://consultacorreoscabcr.azurewebsites.net/PROXYService.svc/AgremiadoXCarnetJSON';
    const baseUrlCedula = process.env.AGREMIADO_CEDULA_JSON_URL || 'https://consultacorreoscabcr.azurewebsites.net/PROXYService.svc/AgremiadoXCedulaJSON';
    
    // se elige la URL según el tipo de búsqueda (carnet o cédula)
    const baseUrl = tipoBusqueda === 'cedula' ? baseUrlCedula : baseUrlCarnet;
    // si el link no responde en 10 segundos se cancela la consulta
    const timeout = parseInt(process.env.AGREMIADO_JSON_TIMEOUT_MS || '10000', 10);
    // se toma el valor de cédula o carnet y se le añade al final de la URL para hacer la consulta
    const url = `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(valor)}`;

    try {
        // mediante la librería axios se toma la URl y se tira la consulta tipo GET y se pasa a JSON
        const response = await axios.get(url, {
            headers: {
                'Accept': 'application/json'
            },
            timeout
        });
        // si no es un JSON o el JSON está vacío se devuelve un error diciendo que no se encontró el agremiado
        const agremiado = response.data;
        if (!agremiado || typeof agremiado !== 'object') {
            return {
                success: false,
                error: 'No se encontró el agremiado'
            };
        }

        // toma el nombre completo y el carnet del JSON y se meten en variables, si no existen se les asigna un string vacío, se les hace trim para eliminar espacios al inicio y al final
        const nombreCompleto = String(agremiado.CardName || '').trim();
        const cardCodeRespuesta = String(agremiado.CardCode || valor).trim();

        // si alguno de los dos datos está vació devuelve error
        if (!nombreCompleto || !cardCodeRespuesta) {
            return {
                success: false,
                error: 'No se encontró el agremiado'
            };
        }

        // se devuelve el estado, nombreCompleto, cédula, condición profesional y número de carnet
        return {
            success: true,
            nombreCompleto,
            cedula: agremiado.RFC ? String(agremiado.RFC).trim() : '',
            professionalStatus: agremiado.ProfessionalStatus ? String(agremiado.ProfessionalStatus).trim() : '',
            cardCode: cardCodeRespuesta
        };
    // toma los errores y los lista
    } catch (error) {
        console.error('Error consultando JSON de agremiado:', error.message);
        if (error.response) {
            console.error('Respuesta JSON de agremiado:', error.response.status, error.response.data);
        }

        const status = error.response ? `servicio respondio con estado ${error.response.status}` : error.message;
        return {
            success: false,
            error: 'Error al consultar los datos: ' + status
        };
    }
}

// API que toma el valor de búsqueda y lo tira a la función de arriba consultarAgremiadoJSON()
app.get("/api/buscar-agremiado", async (req, res) => {
    if (!puedeRegistrarVisita(req)) {
        return res.status(401).json({ error: 'No autorizado' });
    }

    const carnet = String(req.query.carnet || '').trim();
    const cedula = String(req.query.cedula || '').trim();

    if ((carnet && cedula) || (!carnet && !cedula)) {
        return res.status(400).json({ error: 'Ingrese solamente carnet o cédula' });
    }

    const resultado = carnet
        ? await consultarAgremiadoJSON(carnet, 'carnet')
        : await consultarAgremiadoJSON(cedula, 'cedula');
    res.json(resultado);
});

// hace lo mismo que la función de arriba pero SOLAMENTE con carnet, se tiene de "redundancia"
app.get("/api/buscar-agremiado/:carnet", async (req, res) => {
    if (!puedeRegistrarVisita(req)) {
        return res.status(401).json({ error: 'No autorizado' });
    }
    const { carnet } = req.params;
    if (!carnet || carnet.trim() === '') {
        return res.status(400).json({ error: 'Carnet requerido' });
    }
    const resultado = await consultarAgremiadoJSON(carnet);
    res.json(resultado);
});


// funcion para declarar fecha con formato dd/mm/aaaa ->  "const fecha = formatearFecha(new Date());" para usarlo en reportes y lo devuelve en un string
function formatearFecha(fecha) {
  const date = new Date(fecha);

  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();

  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");

  return `${dd}/${mm}/${yyyy}-${hh}:${min}`;
}
// tira el app en el puerto 80, toma el valor del puerto desde el .env y si no lo encuentra ahí lo toma de este archivo
const PORT = process.env.PORT || 80;
app.listen(PORT, () => {console.log(`Corriendo en http://localhost:${PORT}`);});

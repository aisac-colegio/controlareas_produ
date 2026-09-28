-- Esquema inicial de base de datos para el sistema de control de areas.
-- Crea la base, las tablas principales y datos iniciales para areas y administrador.

CREATE DATABASE IF NOT EXISTS controlareas;

USE controlareas;

CREATE TABLE areas (
    -- Catalogo de areas visitables. activo permite ocultar un area sin borrar historial.
    idareas VARCHAR(99) NOT NULL PRIMARY KEY,
    nombrearea VARCHAR(99),
    activo BOOLEAN DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE login (
    -- Usuarios del sistema. rol define permisos: admin, mod o user.
    iduser VARCHAR(99) NOT NULL PRIMARY KEY,
    usuario VARCHAR(99),
    clave VARCHAR(99),
    rol VARCHAR(99),
    nombre VARCHAR(99),
    ultimologin VARCHAR(99)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE registro (
    -- Historial de visitas registradas por los usuarios del sistema.
    idregistro VARCHAR(99) NOT NULL PRIMARY KEY,
    agremiado VARCHAR(99),
    area VARCHAR(99),
    fechaingreso VARCHAR(99),
    usuarioregistrador VARCHAR(99),
    nombreCompleto VARCHAR(99),
    cedula VARCHAR(99)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO areas (idareas, nombrearea, activo) VALUES
('area-1778516231253', 'Piscina General', TRUE),
('area-1778516237271', 'Sauna', TRUE),
('area-1778516252007', 'Cancha Grande', TRUE),
('area-1778516262407', 'Gimnasio Biomecánico', TRUE),
('area-1778516278217', 'Cancha Tennis', TRUE),
('area-1778516294656', 'Cancha Basquetbol', TRUE),
('area-1778516058598', 'Agua Aeróbicos', TRUE),
('area-1778516246123', 'Cancha Fut 5', TRUE);

INSERT INTO login (iduser, usuario, clave, rol, nombre, ultimologin) VALUES
('user1778186008559', 'admin', '$2b$10$TsLmsnNK/VVLi/p0gIHV7u0.h9MpoUmaznaDrSG0KEF4jQUpxGm4K', 'admin', 'Aisac El Admin', '13/05/2026-12:30');

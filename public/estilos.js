// forzar modo oscuro y el menú hamburguesa del responsive
// ============================================
// SCRIPT GLOBAL DEL FRONTEND
// Mantiene el tema oscuro y controla el menu movil del encabezado.
// ============================================

// ============================================
// TEMA OSCURO - SIN MODO CLARO
// ============================================

// Forzar modo oscuro al cargar la página
document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.remove('light');
    document.documentElement.style.colorScheme = 'dark';
});

// Remover cualquier intento de cambiar a modo claro
window.addEventListener('storage', () => {
    document.body.classList.remove('light');
    document.documentElement.style.colorScheme = 'dark';
});

// ============================================
// MENÚ MÓVIL
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    const menuButton = document.getElementById('menu-button');
    const mobileMenu = document.getElementById('mobile-menu');

    if (menuButton && mobileMenu) {
        menuButton.addEventListener('click', () => {
            mobileMenu.classList.toggle('hidden');
        });

        // Cerrar menú al hacer click en un enlace
        const mobileLinks = mobileMenu.querySelectorAll('a');
        mobileLinks.forEach(link => {
            link.addEventListener('click', () => {
                mobileMenu.classList.add('hidden');
            });
        });
    }
});

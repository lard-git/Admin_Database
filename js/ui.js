document.addEventListener('DOMContentLoaded', () => {

    // Page fade-in
    document.body.style.opacity = '0';
    document.body.style.transition = 'opacity 0.3s ease';
    requestAnimationFrame(() => { document.body.style.opacity = '1'; });

    // ── Theme Toggle ──
    const THEME_KEY = 'gym_theme';
    const themeToggle = document.getElementById('themeToggle');

    function applyTheme(theme) {
        if (theme === 'light') {
            document.body.classList.add('light-mode');
            if (themeToggle) themeToggle.textContent = 'Dark Mode';
        } else {
            document.body.classList.remove('light-mode');
            if (themeToggle) themeToggle.textContent = 'Light Mode';
        }
    }

    const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
    applyTheme(savedTheme);

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const current = localStorage.getItem(THEME_KEY) || 'dark';
            const next = current === 'dark' ? 'light' : 'dark';
            localStorage.setItem(THEME_KEY, next);
            applyTheme(next);
        });
    }

    // ── Button Ripple Effect ──
    document.addEventListener('click', e => {
        const btn = e.target.closest('button, .btn');
        if (!btn) return;

        const ripple = document.createElement('span');
        const rect = btn.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const x = e.clientX - rect.left - size / 2;
        const y = e.clientY - rect.top - size / 2;

        ripple.style.cssText = `
            position: absolute;
            width: ${size}px; height: ${size}px;
            left: ${x}px; top: ${y}px;
            border-radius: 50%;
            background: rgba(255,255,255,0.25);
            transform: scale(0);
            animation: ripple-anim 0.5s ease-out forwards;
            pointer-events: none;
        `;

        btn.style.position = 'relative';
        btn.style.overflow = 'hidden';
        btn.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
    });

    if (!document.getElementById('ripple-style')) {
        const style = document.createElement('style');
        style.id = 'ripple-style';
        style.textContent = `
            @keyframes ripple-anim { to { transform: scale(2.5); opacity: 0; } }
            .sidebar a { position: relative; overflow: hidden; }
        `;
        document.head.appendChild(style);
    }

    // Auto-highlight active sidebar link
    const currentPage = location.pathname.split('/').pop() || 'firebase_crud.html';
    document.querySelectorAll('.sidebar a').forEach(link => {
        const href = link.getAttribute('href');
        if (href && currentPage.includes(href.replace('.html', ''))) {
            link.classList.add('active');
        }
    });
});

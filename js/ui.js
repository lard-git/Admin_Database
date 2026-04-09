// Shared UI enhancements — ripple effect, fade-in, input shimmer
document.addEventListener('DOMContentLoaded', () => {

    // Page fade-in
    document.body.style.opacity = '0';
    document.body.style.transition = 'opacity 0.3s ease';
    requestAnimationFrame(() => { document.body.style.opacity = '1'; });

    // Button ripple effect
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

    // Add ripple keyframe if not present
    if (!document.getElementById('ripple-style')) {
        const style = document.createElement('style');
        style.id = 'ripple-style';
        style.textContent = `
            @keyframes ripple-anim {
                to { transform: scale(2.5); opacity: 0; }
            }
            .sidebar a { position: relative; overflow: hidden; }
        `;
        document.head.appendChild(style);
    }

    // Auto-highlight active sidebar link based on current page
    const currentPage = location.pathname.split('/').pop() || 'firebase_crud.html';
    document.querySelectorAll('.sidebar a').forEach(link => {
        const href = link.getAttribute('href');
        if (href && currentPage.includes(href.replace('.html', ''))) {
            link.classList.add('active');
        }
    });

    // Smooth number counter animation for summary cards
    document.querySelectorAll('.summary-card span[id], .stat-card span[id]').forEach(el => {
        const target = parseFloat(el.textContent);
        if (isNaN(target) || target === 0) return;
        let start = 0;
        const duration = 600;
        const step = timestamp => {
            if (!start) start = timestamp;
            const progress = Math.min((timestamp - start) / duration, 1);
            el.textContent = Math.floor(progress * target);
            if (progress < 1) requestAnimationFrame(step);
            else el.textContent = target;
        };
        requestAnimationFrame(step);
    });
});

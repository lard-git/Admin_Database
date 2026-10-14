// ui.js — themes, top navigation (icons expand on hover / stay open on active page), sign-in, ripple.
const THEME_KEY = 'gym_theme';
const THEMES = [
  { id: 'dark',      name: 'Dark',      p: ['#0d0d14', '#1c1c28', '#b78cff'] },
  { id: 'light',     name: 'Light',     p: ['#f4f3f8', '#ffffff', '#7a2fe0'] },
  { id: 'amoled',    name: 'AMOLED',    p: ['#000000', '#141414', '#ffffff'] },
  { id: 'cyberpunk', name: 'Cyberpunk', p: ['#05090c', '#101c23', '#1affa8'] },
  { id: 'ink',       name: 'Ink',       p: ['#f6f1e4', '#efe8d6', '#c4281e'] },
  { id: 'arcade',    name: 'candy',    p: ['#0b0b1a', '#1a1a3a', '#ff1f7a'] },
  { id: 'gold',      name: 'Gold',      p: ['#121212', '#282828', '#ebc069'] },
];
const NAV = [
  { href: 'firebase_crud.html', label: 'Register',  icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>' },
  { href: 'members.html',       label: 'Members',   icon: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
  { href: 'occupancy.html',     label: 'Occupancy', icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>' },
  { href: 'analytics.html',     label: 'Analytics', icon: '<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>' },
];
const LOCKED = ['firebase_crud.html', 'members.html']; // admin-only pages; Occupancy and Analytics stay open to staff
const ICON_THEME = '<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.83-.44-1.12-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.55-2.5 5.55-5.55C21.97 6.01 17.46 2 12 2z"/>';
const ICON_LOGIN = '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/>';
const svg = p => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
const root = document.documentElement;

// ── Theme ──
function applyTheme(id) {
  if (!THEMES.some(t => t.id === id)) id = 'dark';
  root.dataset.theme = id;
  root.dataset.mode = (id === 'light' || id === 'ink') ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, id);
  document.querySelectorAll('.tcard').forEach(c => c.classList.toggle('sel', c.dataset.id === id));
}
applyTheme(localStorage.getItem(THEME_KEY) || 'dark'); // runs immediately: no flash of the old look

document.addEventListener('DOMContentLoaded', () => {
  // Page fade-in
  document.body.style.opacity = '0';
  document.body.style.transition = 'opacity 0.3s ease';
  requestAnimationFrame(() => { document.body.style.opacity = '1'; });

  // ── Top nav ──
  const page = location.pathname.split('/').pop() || 'firebase_crud.html';
  const nav = document.createElement('header');
  nav.className = 'topnav';
  nav.innerHTML = `
    <a class="brand" href="firebase_crud.html"><img src="/resources/lollang.png" alt=""><b>Gym Admin</b></a>
    <nav class="navlinks">${NAV.map(n =>
      `<a class="navbtn${page === n.href ? ' active' : ''}" href="${n.href}" aria-label="${n.label}" title="${n.label}">${svg(n.icon)}<span>${n.label}</span></a>`).join('')}
    </nav>
    <div class="navgap"></div>
    <button class="iconbtn" id="themeBtn" aria-label="Change theme" title="Theme">${svg(ICON_THEME)}</button>
    <button class="signin" id="signInBtn">${svg(ICON_LOGIN)}<b>Sign In</b></button>
    <div class="themepop" id="themePop">${THEMES.map(t =>
      `<button class="tcard" data-id="${t.id}"><div class="tprev" style="background:${t.p[0]}"><i style="background:${t.p[1]}"></i><i style="background:${t.p[2]}"></i><i style="background:${t.p[2]};opacity:.55"></i><i style="background:${t.p[1]}"></i></div><b>${t.name}</b></button>`).join('')}
    </div>`;
  document.body.prepend(nav);

  const pop = nav.querySelector('#themePop');
  nav.querySelector('#themeBtn').addEventListener('click', e => { e.stopPropagation(); pop.classList.toggle('open'); });
  pop.addEventListener('click', e => { const c = e.target.closest('.tcard'); if (c) applyTheme(c.dataset.id); });
  document.addEventListener('click', e => { if (!pop.contains(e.target)) pop.classList.remove('open'); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') pop.classList.remove('open'); });
  applyTheme(root.dataset.theme);

  // ── Sign-in: one handler for every page (uses the page's own overlay, or builds one on open pages) ──
  const locked = LOCKED.includes(page);
  let overlay = document.getElementById('authOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'authOverlay';
    overlay.innerHTML = `<div id="authBox"><h3>Admin Login</h3><input id="pwdInp" type="password" placeholder="Enter password" autocomplete="off"><button id="loginBtn">Unlock</button><div class="error" id="authErr"></div></div>`;
    document.body.appendChild(overlay);
  }
  const btn = overlay.querySelector('#loginBtn'), pwd = overlay.querySelector('#pwdInp');
  const err = overlay.querySelector('#authErr'), box = overlay.querySelector('#authBox');
  // Open pages only show the box when Sign In is clicked, and it can be dismissed; locked pages stay covered until unlocked
  if (sessionStorage.getItem('gym_admin') === 'yes' || !locked) overlay.style.display = 'none';
  if (!locked) {
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') overlay.style.display = 'none'; });
  }
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = '...';
    let ok = false;
    try { ok = await (await import('./auth.js')).AUTH.login(pwd.value); } catch (e) { console.error(e); }
    btn.disabled = false; btn.textContent = 'Unlock';
    if (ok) { overlay.style.display = 'none'; }
    else { err.textContent = 'Wrong password, please try again.'; box.classList.add('shake'); setTimeout(() => box.classList.remove('shake'), 500); pwd.value = ''; pwd.focus(); }
  });
  pwd.addEventListener('keypress', e => { if (e.key === 'Enter') btn.click(); });
  const signBtn = nav.querySelector('#signInBtn');
  const refreshSign = () => {
    const on = sessionStorage.getItem('gym_admin') === 'yes';
    signBtn.classList.toggle('on', on);
    signBtn.querySelector('b').textContent = on ? 'Admin · Sign out' : 'Sign In';
  };
  signBtn.addEventListener('click', () => {
    if (sessionStorage.getItem('gym_admin') === 'yes') {
      sessionStorage.removeItem('gym_admin');
      if (locked) overlay.style.display = 'flex'; // locked pages re-lock immediately
      refreshSign();
      return;
    }
    overlay.style.display = 'flex';
    overlay.querySelector('#pwdInp')?.focus();
  });
  new MutationObserver(refreshSign).observe(overlay, { attributes: true, attributeFilter: ['style'] });
  refreshSign();

  // ── Button ripple ──
  document.addEventListener('click', e => {
    const btn = e.target.closest('button, .btn');
    if (!btn || btn.classList.contains('tcard') || btn.classList.contains('iconbtn')) return;
    const r = document.createElement('span'), rect = btn.getBoundingClientRect(), size = Math.max(rect.width, rect.height);
    r.style.cssText = `position:absolute;width:${size}px;height:${size}px;left:${e.clientX - rect.left - size / 2}px;top:${e.clientY - rect.top - size / 2}px;border-radius:50%;background:rgba(255,255,255,.25);transform:scale(0);animation:ripple-anim .5s ease-out forwards;pointer-events:none;`;
    btn.style.position = 'relative'; btn.style.overflow = 'hidden';
    btn.appendChild(r); setTimeout(() => r.remove(), 600);
  });
  if (!document.getElementById('ripple-style')) {
    const s = document.createElement('style'); s.id = 'ripple-style';
    s.textContent = '@keyframes ripple-anim{to{transform:scale(2.5);opacity:0}}';
    document.head.appendChild(s);
  }
});

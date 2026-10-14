import { db } from './database_init.js';
import { ref, get } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-database.js";

export const AUTH = {
    async login(pwd) {
        try {
            const snap = await get(ref(db, 'Admin/Acc/Pwd'));
            if (snap.exists() && snap.val() === pwd) {
                sessionStorage.setItem('gym_admin', 'yes');
                return true;
            }
        } catch (e) {
            console.error('Auth check failed:', e);
        }
        return false;
    }
};

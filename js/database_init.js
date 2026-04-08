import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getDatabase, ref, set, get, update, remove } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyB6x0Si8OoiD3UDDMjXgZTMOdfv8neMtik",
    authDomain: "gym-database-f4b61.firebaseapp.com",
    databaseURL: "https://gym-database-f4b61-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "gym-database-f4b61",
    storageBucket: "gym-database-f4b61.firebasestorage.app",
    messagingSenderId: "79575587778",
    appId: "1:79575587778:web:55b218534fde16847ad45b",
    measurementId: "G-BGPJNP62J5"
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
window.db = db;
window.firebaseMod = { getDatabase, ref, set, get, update, remove };

import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-functions.js";
window.firebaseFunctions = { getFunctions, httpsCallable };

// ============ REVENUE TRACKING HELPERS ============

// Get current month key (YYYY-MM)
export function getCurrentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// Get previous months keys
export function getPreviousMonthKeys(months = 12) {
    const keys = [];
    const now = new Date();
    for (let i = 1; i <= months; i++) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        keys.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
    }
    return keys;
}

// Add revenue to current month
export async function addRevenue(amount, type, details = {}) {
    const monthKey = getCurrentMonthKey();
    const revenueRef = ref(db, `Revenue/${monthKey}`);
    
    try {
        const snapshot = await get(revenueRef);
        let data = snapshot.exists() ? snapshot.val() : { total: 0, members: 0, walkins: 0, transactions: [] };
        
        // Update totals
        data.total = (data.total || 0) + amount;
        
        if (type === 'member') {
            data.members = (data.members || 0) + amount;
        } else if (type === 'walkin') {
            data.walkins = (data.walkins || 0) + amount;
        }
        
        // Add transaction record
        if (!data.transactions) data.transactions = [];
        data.transactions.push({
            amount: amount,
            type: type,
            details: details,
            timestamp: new Date().toISOString(),
            date: new Date().toISOString().split('T')[0]
        });
        
        // Keep only last 1000 transactions
        if (data.transactions.length > 1000) {
            data.transactions = data.transactions.slice(-1000);
        }
        
        data.last_updated = new Date().toISOString();
        
        await set(revenueRef, data);
        return true;
    } catch (error) {
        console.error('Error adding revenue:', error);
        return false;
    }
}

// Get revenue for a specific month
export async function getMonthlyRevenue(monthKey) {
    const revenueRef = ref(db, `Revenue/${monthKey}`);
    const snapshot = await get(revenueRef);
    return snapshot.exists() ? snapshot.val() : { total: 0, members: 0, walkins: 0 };
}

// Get current month revenue
export async function getCurrentMonthRevenue() {
    return await getMonthlyRevenue(getCurrentMonthKey());
}
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getDatabase, ref, onValue, update, get, set } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-database.js";

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

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// DOM Elements
const memberUidInput = document.getElementById('memberUidInput');
const checkInOutBtn = document.getElementById('checkInOutBtn');
const checkinMessage = document.getElementById('checkinMessage');
const currentOccupancy = document.getElementById('currentOccupancy');
const todayVisitors = document.getElementById('todayVisitors');
const activeMembers = document.getElementById('activeMembers');
const peakHours = document.getElementById('peakHours');
const currentMembersList = document.getElementById('currentMembersList');
const emptyOccupancy = document.getElementById('emptyOccupancy');
const activityTableBody = document.getElementById('activityTableBody');
const currentCountBadge = document.getElementById('currentCountBadge');
const activityCountBadge = document.getElementById('activityCountBadge');
const refreshActivity = document.getElementById('refreshActivity');
const clearActivity = document.getElementById('clearActivity');

let allMembers = [];
let todayActivities = [];
let currentOccupancyCount = 0;

// Initialize
function init() {
    loadMembers();
    focusOnInput();
    
    // Auto-focus on input field
    memberUidInput.focus();
    
    // Enter key support
    memberUidInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            handleCheckInOut();
        }
    });
    
    checkInOutBtn.addEventListener('click', handleCheckInOut);
    refreshActivity.addEventListener('click', updateTodayActivity);
    clearActivity.addEventListener('click', clearTodayActivity);
}

// Load all members with both old and new structure support
function loadMembers() {
    const membersRef = ref(db, 'Customers');
    
    onValue(membersRef, (snapshot) => {
        allMembers = [];
        if (snapshot.exists()) {
            snapshot.forEach(child => {
                const data = child.val();
                const member = normalizeMemberData(child.key, data);
                allMembers.push(member);
            });
            
            console.log('Loaded members:', allMembers.length); // Debug log
            updateOccupancyDisplay();
            updateTodayActivity();
            updateStats();
        } else {
            console.log('No members found in database'); // Debug log
            updateOccupancyDisplay();
            updateTodayActivity();
            updateStats();
        }
    });
}

// Normalize member data to handle Firebase structure
function normalizeMemberData(key, data) {
    console.log('Raw data for', key, ':', data); // Debug log
    
    // Extract UID 
    const uid = data.gym_data?.uid || 
                data.personal_info?.uid || 
                data.uid || 
                key;
    
    // Extract name 
    const firstname = data.personal_info?.firstname || '';
    const lastname = data.personal_info?.lastname || '';
    
    // Extract phone 
    const phone = data.personal_info?.phone || '';
    
    // Extract gym data with proper fallbacks
    const gym_data = {
        is_checked_in: data.gym_data?.is_checked_in || false,
        last_checkin: data.gym_data?.last_checkin || null,
        last_checkout: data.gym_data?.last_checkout || null,
        total_visits: data.gym_data?.total_visits || 0,
        total_time_spent: data.gym_data?.total_time_spent || 0,
        uid: uid
    };
    
    // Extract membership data with proper fallbacks
    const membership = data.membership || {
        status: 'active',
        remaining_days: 30,
        start_date: '',
        end_date: ''
    };
    
    const normalized = {
        key: key,
        uid: uid,
        firstname: firstname,
        lastname: lastname,
        phone: phone,
        membership: membership,
        gym_data: gym_data,
        attendance_history: data.attendance_history || []
    };

    console.log('Normalized member:', normalized); // Debug log
    return normalized;
}

// Handle check-in/check-out
async function handleCheckInOut() {
    const uid = memberUidInput.value.trim();
    
    console.log('Checking UID:', uid); // Debug log
    console.log('All members:', allMembers); // Debug log
    
    if (!uid) {
        showMessage('Please enter a member UID', 'error');
        return;
    }
    
    // Search for member by UID or Firebase key
    const member = allMembers.find(m => 
        m.uid === uid || 
        m.key === uid || 
        m.gym_data?.uid === uid
    );
    
    console.log('Found member:', member); // Debug log
    
    if (!member) {
        showMessage('Member not found. Please check the UID.', 'error');
        return;
    }

    // Check membership status
    const membership = member.membership;
    if (membership.status === 'expired' || (membership.remaining_days !== undefined && membership.remaining_days <= 0)) {
        showMessage('Membership expired! Please renew to check in.', 'error');
        return;
    }

    if (membership.remaining_days !== undefined && membership.remaining_days <= 7) {
        showMessage(`Warning: Membership expires in ${membership.remaining_days} days`, 'warning');
        // Continue with check-in but show warning
    }
    
    try {
        if (member.gym_data.is_checked_in) {
            await checkOutMember(member);
        } else {
            await checkInMember(member);
        }
        
        memberUidInput.value = '';
        memberUidInput.focus();
        
    } catch (error) {
        showMessage('Error: ' + error.message, 'error');
    }
}

// Check in member
async function checkInMember(member) {
    const now = new Date();
    const checkInTime = now.toISOString();
    
    const updates = {
        "gym_data/is_checked_in": true,
        "gym_data/last_checkin": checkInTime
    };
    
    // Add to attendance history
    const newVisit = {
        checkin: checkInTime,
        checkout: null,
        time_spent: null,
        date: now.toISOString().split('T')[0]
    };
    
    const history = member.attendance_history || [];
    history.unshift(newVisit);
    updates.attendance_history = history.slice(0, 100); // Keep last 100 visits
    
    await update(ref(db, `Customers/${member.key}`), updates);
    
    const membershipStatus = getMembershipStatus(member.membership);
    showMessage(`${member.firstname} ${member.lastname} checked in successfully! (${membershipStatus})`, 'success');
}

// Check out member
async function checkOutMember(member) {
    const now = new Date();
    const checkOutTime = now.toISOString();
    const lastCheckIn = member.gym_data.last_checkin ? new Date(member.gym_data.last_checkin) : new Date();
    const timeSpent = Math.round((now - lastCheckIn) / (1000 * 60)); // in minutes
    
    const updates = {
        "gym_data/is_checked_in": false,
        "gym_data/last_checkout": checkOutTime
    };
    
    // Update attendance history
    const history = member.attendance_history || [];
    if (history.length > 0 && !history[0].checkout) {
        history[0].checkout = checkOutTime;
        history[0].time_spent = timeSpent;
        updates.attendance_history = history;
    }
    
    // Update total time spent
    const currentTotal = member.gym_data.total_time_spent || 0;
    updates["gym_data/total_time_spent"] = currentTotal + timeSpent;
    
    // Update total visits
    const currentVisits = member.gym_data.total_visits || 0;
    updates["gym_data/total_visits"] = currentVisits + 1;
    
    await update(ref(db, `Customers/${member.key}`), updates);
    
    const membershipStatus = getMembershipStatus(member.membership);
    showMessage(`${member.firstname} ${member.lastname} checked out. Time spent: ${timeSpent} minutes (${membershipStatus})`, 'info');
}

// Get membership status text
function getMembershipStatus(membership) {
    if (!membership) return 'No membership';
    
    const remainingDays = membership.remaining_days;
    
    if (membership.status === 'expired' || (remainingDays !== undefined && remainingDays <= 0)) {
        return 'Expired';
    } else if (remainingDays !== undefined && remainingDays <= 7) {
        return `${remainingDays} days left`;
    } else {
        return 'Active';
    }
}

// Get membership CSS class
function getMembershipClass(membership) {
    if (!membership) return 'membership-expired';
    
    const remainingDays = membership.remaining_days;
    
    if (membership.status === 'expired' || (remainingDays !== undefined && remainingDays <= 0)) {
        return 'membership-expired';
    } else if (remainingDays !== undefined && remainingDays <= 7) {
        return 'membership-warning';
    } else {
        return 'membership-active';
    }
}

// Get days CSS class
function getDaysClass(remainingDays) {
    if (remainingDays === undefined) return 'days-safe';
    
    if (remainingDays <= 0) {
        return 'days-danger';
    } else if (remainingDays <= 7) {
        return 'days-warning';
    } else {
        return 'days-safe';
    }
}

// Update occupancy display
function updateOccupancyDisplay() {
    const checkedInMembers = allMembers.filter(m => m.gym_data.is_checked_in);
    currentOccupancyCount = checkedInMembers.length;
    
    currentOccupancy.textContent = currentOccupancyCount;
    currentCountBadge.textContent = currentOccupancyCount;
    
    if (checkedInMembers.length === 0) {
        currentMembersList.innerHTML = '';
        emptyOccupancy.style.display = 'block';
        return;
    }
    
    emptyOccupancy.style.display = 'none';
    
    currentMembersList.innerHTML = checkedInMembers.map(member => {
        const checkInTime = member.gym_data.last_checkin ? new Date(member.gym_data.last_checkin) : new Date();
        const duration = Math.round((new Date() - checkInTime) / (1000 * 60));
        const membershipClass = getMembershipClass(member.membership);
        const membershipStatus = getMembershipStatus(member.membership);
        
        return `
            <div class="member-card ${membershipClass}">
                <div class="member-info">
                    <div class="member-name">${member.firstname} ${member.lastname}</div>
                    <div class="member-uid">UID: ${member.uid}</div>
                    <div class="member-membership ${membershipClass}">${membershipStatus}</div>
                </div>
                <div class="checkin-time">
                    ${checkInTime.toLocaleTimeString()}<br>
                    (${duration}m ago)
                </div>
            </div>
        `;
    }).join('');
}

// Update today's activity
function updateTodayActivity() {
    const today = new Date().toDateString();
    let allActivities = [];
    
    allMembers.forEach(member => {
        const history = member.attendance_history || [];
        history.forEach(visit => {
            if (visit.checkin) {
                const visitDate = new Date(visit.checkin).toDateString();
                if (visitDate === today) {
                    allActivities.push({
                        member: `${member.firstname} ${member.lastname}`,
                        uid: member.uid,
                        checkin: visit.checkin,
                        checkout: visit.checkout,
                        time_spent: visit.time_spent,
                        is_current: !visit.checkout && member.gym_data.is_checked_in,
                        membership: member.membership
                    });
                }
            }
        });
    });
    
    // Sort by check-in time (newest first)
    allActivities.sort((a, b) => new Date(b.checkin) - new Date(a.checkin));
    todayActivities = allActivities;
    
    activityCountBadge.textContent = allActivities.length;
    
    activityTableBody.innerHTML = allActivities.map(activity => {
        const checkInTime = new Date(activity.checkin).toLocaleTimeString();
        const checkOutTime = activity.checkout ? new Date(activity.checkout).toLocaleTimeString() : '-';
        const timeSpent = activity.time_spent ? `${activity.time_spent}m` : '-';
        
        const membership = activity.membership || {};
        const remainingDays = membership.remaining_days;
        const statusClass = getMembershipClass(membership);
        const daysClass = getDaysClass(remainingDays);
        const statusText = getMembershipStatus(membership);
        
        const status = activity.is_current ? 
            '<span class="status-active">IN GYM</span>' : 
            `<span class="${statusClass.replace('membership-', 'status-')}">${statusText}</span>`;
        
        return `
            <tr>
                <td>${activity.member}<br><small>UID: ${activity.uid}</small></td>
                <td>${checkInTime}</td>
                <td>${checkOutTime}</td>
                <td>${timeSpent}</td>
                <td>${status}</td>
                <td class="${daysClass}">${remainingDays !== undefined ? remainingDays : 'N/A'}</td>
            </tr>
        `;
    }).join('');
}

function getActualRemainingDays(member) {
    if (!member.membership.end_date) return 0;
    
    const endDate = new Date(member.membership.end_date);
    const today = new Date();
    const remaining = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
    return Math.max(0, remaining);
}

// Clear today's activity
async function clearTodayActivity() {
    if (!confirm('Are you sure you want to clear all of today\'s activity records? This cannot be undone.')) {
        return;
    }
    
    const today = new Date().toISOString().split('T')[0];
    const updates = {};
    
    allMembers.forEach(member => {
        if (member.attendance_history && member.attendance_history.length > 0) {
            // Filter out today's activities
            const filteredHistory = member.attendance_history.filter(visit => {
                if (visit.checkin) {
                    const visitDate = new Date(visit.checkin).toISOString().split('T')[0];
                    return visitDate !== today;
                }
                return true;
            });
            
            if (filteredHistory.length !== member.attendance_history.length) {
                updates[`${member.key}/attendance_history`] = filteredHistory;
            }
        }
    });
    
    if (Object.keys(updates).length > 0) {
        try {
            await update(ref(db, "Customers"), updates);
            showMessage('Today\'s activity records cleared successfully!', 'success');
            updateTodayActivity();
        } catch (error) {
            showMessage('Error clearing activity: ' + error.message, 'error');
        }
    } else {
        showMessage('No activity records to clear for today.', 'info');
    }
}

// Update statistics
function updateStats() {
    const checkedInCount = allMembers.filter(m => m.gym_data.is_checked_in).length;
    const today = new Date().toDateString();
    
    // Count unique visitors today
    const todayVisitorIds = new Set();
    allMembers.forEach(member => {
        const history = member.attendance_history || [];
        history.forEach(visit => {
            if (visit.checkin && new Date(visit.checkin).toDateString() === today) {
                todayVisitorIds.add(member.uid);
            }
        });
    });
    
    // Count active members 
    const activeMembersCount = allMembers.filter(m => {
        const membership = m.membership;
        return membership.status !== 'expired' && 
               (membership.remaining_days === undefined || membership.remaining_days > 0);
    }).length;
    
    // Calculate peak hours (most check-ins in last hour)
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - (60 * 60 * 1000));
    const recentCheckins = todayActivities.filter(activity => 
        new Date(activity.checkin) > oneHourAgo
    ).length;
    
    currentOccupancy.textContent = checkedInCount;
    todayVisitors.textContent = todayVisitorIds.size;
    activeMembers.textContent = activeMembersCount;
    peakHours.textContent = recentCheckins > 5 ? 'Now' : '--:--';
}

// Helper functions
function showMessage(text, type) {
    checkinMessage.textContent = text;
    checkinMessage.className = `message ${type}`;
    checkinMessage.style.display = 'block';
    
    setTimeout(() => {
        checkinMessage.style.display = 'none';
    }, 5000);
}

function focusOnInput() {
    memberUidInput.focus();
}

// Update button text based on member status
function updateButtonStatus(member) {
    if (member && member.gym_data.is_checked_in) {
        checkInOutBtn.textContent = 'Check Out';
        checkInOutBtn.className = 'checked-in';
    } else {
        checkInOutBtn.textContent = 'Check In';
        checkInOutBtn.className = '';
    }
}

// Auto-update button when typing UID
memberUidInput.addEventListener('input', function() {
    const uid = this.value.trim();
    const member = allMembers.find(m => 
        m.uid === uid || 
        m.key === uid || 
        m.gym_data?.uid === uid
    );
    updateButtonStatus(member);
});

// Initialize the app
init();
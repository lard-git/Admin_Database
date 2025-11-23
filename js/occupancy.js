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
const avgTime = document.getElementById('avgTime');
const currentMembersList = document.getElementById('currentMembersList');
const emptyOccupancy = document.getElementById('emptyOccupancy');
const activityTableBody = document.getElementById('activityTableBody');

let allMembers = [];
let todayActivities = [];

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
}

// Load all members
function loadMembers() {
    const membersRef = ref(db, 'Customers');
    
    onValue(membersRef, (snapshot) => {
        allMembers = [];
        if (snapshot.exists()) {
            snapshot.forEach(child => {
                const data = child.val();
                const member = {
                    key: child.key,
                    uid: data.uid?.toString() || '',
                    firstname: data.nameofcustomer?.firstname || '',
                    lastname: data.nameofcustomer?.lastname || '',
                    phone: data.mobile || '',
                    isCheckedIn: data.isCheckedIn || false,
                    lastCheckIn: data.lastCheckIn || null,
                    lastCheckOut: data.lastCheckOut || null,
                    totalVisits: data.totalVisits || 0,
                    totalTimeSpent: data.totalTimeSpent || 0,
                    attendanceHistory: data.attendanceHistory || []
                };
                allMembers.push(member);
            });
            
            updateOccupancyDisplay();
            updateTodayActivity();
            updateStats();
        }
    });
}

// Handle check-in/check-out
async function handleCheckInOut() {
    const uid = memberUidInput.value.trim();
    
    if (!uid) {
        showMessage('Please enter a member UID', 'error');
        return;
    }
    
    const member = allMembers.find(m => m.uid === uid);
    
    if (!member) {
        showMessage('Member not found. Please check the UID.', 'error');
        return;
    }
    
    try {
        if (member.isCheckedIn) {
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
        isCheckedIn: true,
        lastCheckIn: checkInTime,
        totalVisits: (member.totalVisits || 0) + 1
    };
    
    // Add to attendance history
    const newVisit = {
        checkIn: checkInTime,
        checkOut: null,
        timeSpent: null
    };
    
    const history = member.attendanceHistory || [];
    history.unshift(newVisit);
    updates.attendanceHistory = history.slice(0, 50); // Keep last 50 visits
    
    await update(ref(db, `Customers/${member.key}`), updates);
    showMessage(`${member.firstname} ${member.lastname} checked in successfully!`, 'success');
}

// Check out member
async function checkOutMember(member) {
    const now = new Date();
    const checkOutTime = now.toISOString();
    const checkInTime = new Date(member.lastCheckIn);
    const timeSpent = Math.round((now - checkInTime) / (1000 * 60)); // in minutes
    
    const updates = {
        isCheckedIn: false,
        lastCheckOut: checkOutTime
    };
    
    // Update attendance history
    const history = member.attendanceHistory || [];
    if (history.length > 0 && !history[0].checkOut) {
        history[0].checkOut = checkOutTime;
        history[0].timeSpent = timeSpent;
        updates.attendanceHistory = history;
    }
    
    // Update total time spent
    updates.totalTimeSpent = (member.totalTimeSpent || 0) + timeSpent;
    
    await update(ref(db, `Customers/${member.key}`), updates);
    showMessage(`${member.firstname} ${member.lastname} checked out. Time spent: ${timeSpent} minutes`, 'info');
}

// Update occupancy display
function updateOccupancyDisplay() {
    const checkedInMembers = allMembers.filter(m => m.isCheckedIn);
    
    currentOccupancy.textContent = checkedInMembers.length;
    
    if (checkedInMembers.length === 0) {
        currentMembersList.innerHTML = '';
        emptyOccupancy.style.display = 'block';
        return;
    }
    
    emptyOccupancy.style.display = 'none';
    
    currentMembersList.innerHTML = checkedInMembers.map(member => {
        const checkInTime = new Date(member.lastCheckIn);
        const duration = Math.round((new Date() - checkInTime) / (1000 * 60));
        
        return `
            <div class="member-card">
                <div class="member-info">
                    <div class="member-name">${member.firstname} ${member.lastname}</div>
                    <div class="member-uid">UID: ${member.uid}</div>
                    <div class="checkin-time">Checked in: ${checkInTime.toLocaleTimeString()} (${duration}m ago)</div>
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
        const history = member.attendanceHistory || [];
        history.forEach(visit => {
            if (visit.checkIn) {
                const visitDate = new Date(visit.checkIn).toDateString();
                if (visitDate === today) {
                    allActivities.push({
                        member: `${member.firstname} ${member.lastname}`,
                        uid: member.uid,
                        checkIn: visit.checkIn,
                        checkOut: visit.checkOut,
                        timeSpent: visit.timeSpent,
                        isCurrent: !visit.checkOut && member.isCheckedIn
                    });
                }
            }
        });
    });
    
    // Sort by check-in time (newest first)
    allActivities.sort((a, b) => new Date(b.checkIn) - new Date(a.checkIn));
    todayActivities = allActivities;
    
    activityTableBody.innerHTML = allActivities.map(activity => {
        const checkInTime = new Date(activity.checkIn).toLocaleTimeString();
        const checkOutTime = activity.checkOut ? new Date(activity.checkOut).toLocaleTimeString() : '-';
        const timeSpent = activity.timeSpent ? `${activity.timeSpent}m` : '-';
        const status = activity.isCurrent ? 
            '<span class="status-in">IN GYM</span>' : 
            '<span class="status-out">CHECKED OUT</span>';
        
        return `
            <tr>
                <td>${activity.member}<br><small>UID: ${activity.uid}</small></td>
                <td>${checkInTime}</td>
                <td>${checkOutTime}</td>
                <td>${timeSpent}</td>
                <td>${status}</td>
            </tr>
        `;
    }).join('');
}

// Update statistics
function updateStats() {
    const checkedInCount = allMembers.filter(m => m.isCheckedIn).length;
    const today = new Date().toDateString();
    
    // Count unique visitors today
    const todayVisitorIds = new Set();
    allMembers.forEach(member => {
        const history = member.attendanceHistory || [];
        history.forEach(visit => {
            if (visit.checkIn && new Date(visit.checkIn).toDateString() === today) {
                todayVisitorIds.add(member.uid);
            }
        });
    });
    
    // Calculate average time today
    const todayVisits = todayActivities.filter(a => a.timeSpent);
    const avgTimeToday = todayVisits.length > 0 ? 
        Math.round(todayVisits.reduce((sum, a) => sum + a.timeSpent, 0) / todayVisits.length) : 0;
    
    currentOccupancy.textContent = checkedInCount;
    todayVisitors.textContent = todayVisitorIds.size;
    avgTime.textContent = `${avgTimeToday}m`;
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
    if (member && member.isCheckedIn) {
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
    const member = allMembers.find(m => m.uid === uid);
    updateButtonStatus(member);
});

// Initialize the app
init();
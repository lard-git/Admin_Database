import { db } from './database_init.js';
import { ref, set, get, update, onValue } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-database.js";

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
const walkinToday = document.getElementById('walkinToday');

let allMembers = [];
let allWalkins = {};
let todayActivities = [];
let currentOccupancyCount = 0;

const DAYPASS_IN = 'DAYPASS_IN';
const DAYPASS_OUT = 'DAYPASS_OUT';

function init() {
    loadMembers();
    focusOnInput();

    memberUidInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') handleCheckInOut();
    });

    checkInOutBtn.addEventListener('click', handleCheckInOut);
    refreshActivity.addEventListener('click', updateTodayActivity);
    clearActivity.addEventListener('click', clearTodayActivity);
}

function loadMembers() {
    const membersRef = ref(db, 'Customers');

    onValue(membersRef, (snapshot) => {
        allMembers = [];
        allWalkins = {};

        if (snapshot.exists()) {
            snapshot.forEach(child => {
                const key = child.key;
                const data = child.val();

                if (key.startsWith('WALKIN_')) {
                    allWalkins[key] = { key, ...data, is_walkin: true };
                } else {
                    allMembers.push(normalizeMemberData(key, data));
                }
            });
        }

        updateOccupancyDisplay();
        updateTodayActivity();
        updateStats();
    });
}

function normalizeMemberData(key, data) {
    const uid = data.gym_data?.uid || data.personal_info?.uid || data.uid || key;

    return {
        key,
        uid,
        firstname: data.personal_info?.firstname || '',
        lastname: data.personal_info?.lastname || '',
        phone: data.personal_info?.phone || '',
        membership: data.membership || { status: 'active', remaining_days: 30, start_date: '', end_date: '' },
        gym_data: {
            is_checked_in: data.gym_data?.is_checked_in || false,
            last_checkin: data.gym_data?.last_checkin || null,
            last_checkout: data.gym_data?.last_checkout || null,
            total_visits: data.gym_data?.total_visits || 0,
            total_time_spent: data.gym_data?.total_time_spent || 0,
            uid
        },
        attendance_history: data.attendance_history || []
    };
}

async function handleCheckInOut() {
    const uid = memberUidInput.value.trim();

    if (!uid) {
        showMessage('Please enter a member UID', 'error');
        return;
    }

    if (uid === DAYPASS_IN) {
        await handleDayPassIn();
        memberUidInput.value = '';
        memberUidInput.focus();
        return;
    }

    if (uid === DAYPASS_OUT) {
        await handleDayPassOut();
        memberUidInput.value = '';
        memberUidInput.focus();
        return;
    }

    const member = allMembers.find(m =>
        m.uid === uid || m.key === uid || String(m.gym_data?.uid) === uid
    );

    if (!member) {
        showMessage('Member not found. Please check the UID.', 'error');
        return;
    }

    const membership = member.membership;
    if (membership.status === 'expired' || (membership.remaining_days !== undefined && membership.remaining_days <= 0)) {
        showMessage('Membership expired! Please renew to check in.', 'error');
        return;
    }

    if (membership.remaining_days !== undefined && membership.remaining_days <= 7) {
        showMessage(`Warning: Membership expires in ${membership.remaining_days} days`, 'warning');
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

async function handleDayPassIn() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const timestamp = now.getTime();
    const walkinKey = `WALKIN_${today}_${timestamp}`;
    const walkinId = timestamp.toString().slice(-4);

    await set(ref(db, `Customers/${walkinKey}`), {
        personal_info: { firstname: "WALK-IN", lastname: `#${walkinId}`, uid: walkinKey, type: "daypass" },
        gym_data: { is_checked_in: true, last_checkin: now.toISOString(), last_checkout: null, total_visits: 1, total_time_spent: 0, uid: walkinKey },
        membership: { status: "active", remaining_days: 1, start_date: today, end_date: today },
        attendance_history: [{ checkin: now.toISOString(), checkout: null, time_spent: null, date: today }]
    });

    showMessage(`Walk-in checked IN! ID: ${walkinId}`, 'success');
}

async function handleDayPassOut() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];

    const activeWalkins = Object.entries(allWalkins)
        .filter(([key, data]) => key.includes(today) && data.gym_data?.is_checked_in === true)
        .map(([key, data]) => ({ key, data, checkinTime: new Date(data.gym_data.last_checkin).getTime() }))
        .sort((a, b) => a.checkinTime - b.checkinTime);

    if (activeWalkins.length === 0) {
        showMessage('No active walk-ins to check out', 'warning');
        return;
    }

    const oldest = activeWalkins[0];
    const timeSpent = Math.round((now - oldest.checkinTime) / (1000 * 60));
    const history = oldest.data.attendance_history || [];

    const updates = {
        "gym_data/is_checked_in": false,
        "gym_data/last_checkout": now.toISOString(),
        "gym_data/time_spent": timeSpent,
        "membership/status": "completed"
    };

    if (history.length > 0 && !history[0].checkout) {
        history[0].checkout = now.toISOString();
        history[0].time_spent = timeSpent;
        updates.attendance_history = history;
    }

    await update(ref(db, `Customers/${oldest.key}`), updates);
    showMessage(`Walk-out recorded! Time: ${timeSpent}m`, 'info');
}

async function checkInMember(member) {
    const now = new Date();
    const checkInTime = now.toISOString();
    const history = [...(member.attendance_history || [])];
    history.unshift({ checkin: checkInTime, checkout: null, time_spent: null, date: now.toISOString().split('T')[0] });

    await update(ref(db, `Customers/${member.key}`), {
        "gym_data/is_checked_in": true,
        "gym_data/last_checkin": checkInTime,
        attendance_history: history.slice(0, 100)
    });

    showMessage(`${member.firstname} ${member.lastname} checked in!`, 'success');
}

async function checkOutMember(member) {
    const now = new Date();
    const lastCheckIn = member.gym_data.last_checkin ? new Date(member.gym_data.last_checkin) : new Date();
    const timeSpent = Math.round((now - lastCheckIn) / (1000 * 60));
    const history = [...(member.attendance_history || [])];

    if (history.length > 0 && !history[0].checkout) {
        history[0].checkout = now.toISOString();
        history[0].time_spent = timeSpent;
    }

    await update(ref(db, `Customers/${member.key}`), {
        "gym_data/is_checked_in": false,
        "gym_data/last_checkout": now.toISOString(),
        "gym_data/total_time_spent": (member.gym_data.total_time_spent || 0) + timeSpent,
        "gym_data/total_visits": (member.gym_data.total_visits || 0) + 1,
        attendance_history: history
    });

    showMessage(`${member.firstname} ${member.lastname} checked out. Time: ${timeSpent}m`, 'info');
}

function updateOccupancyDisplay() {
    const checkedInMembers = allMembers.filter(m => m.gym_data.is_checked_in);
    const activeWalkinsArr = Object.values(allWalkins).filter(w => w.gym_data?.is_checked_in === true);
    const totalCount = checkedInMembers.length + activeWalkinsArr.length;
    currentOccupancyCount = totalCount;

    currentOccupancy.textContent = totalCount;
    currentCountBadge.textContent = totalCount;

    if (totalCount === 0) {
        currentMembersList.innerHTML = '';
        emptyOccupancy.style.display = 'block';
        return;
    }

    emptyOccupancy.style.display = 'none';

    let html = checkedInMembers.map(member => {
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
                <div class="checkin-time">${checkInTime.toLocaleTimeString()}<br>(${duration}m ago)</div>
            </div>`;
    }).join('');

    html += activeWalkinsArr.map(walkin => {
        const checkInTime = new Date(walkin.gym_data.last_checkin);
        const duration = Math.round((new Date() - checkInTime) / (1000 * 60));
        const walkinId = walkin.key.split('_').pop().slice(-4);

        return `
            <div class="member-card walkin-card">
                <div class="member-info">
                    <div class="member-name">Walk-in #${walkinId}</div>
                    <div class="member-uid">DAY PASS</div>
                    <div class="member-membership membership-active">Active Session</div>
                </div>
                <div class="checkin-time">${checkInTime.toLocaleTimeString()}<br>(${duration}m ago)</div>
            </div>`;
    }).join('');

    currentMembersList.innerHTML = html;
}

function updateTodayActivity() {
    const today = new Date().toDateString();
    let allActivities = [];

    allMembers.forEach(member => {
        (member.attendance_history || []).forEach(visit => {
            if (visit.checkin && new Date(visit.checkin).toDateString() === today) {
                allActivities.push({
                    type: 'member',
                    member: `${member.firstname} ${member.lastname}`,
                    uid: member.uid,
                    checkin: visit.checkin,
                    checkout: visit.checkout,
                    time_spent: visit.time_spent,
                    is_current: !visit.checkout && member.gym_data.is_checked_in,
                    membership: member.membership
                });
            }
        });
    });

    Object.values(allWalkins).forEach(walkin => {
        if (walkin.gym_data?.last_checkin && new Date(walkin.gym_data.last_checkin).toDateString() === today) {
            const walkinId = walkin.key.split('_').pop().slice(-4);
            allActivities.push({
                type: 'walkin',
                member: `Walk-in #${walkinId}`,
                uid: 'DAYPASS',
                checkin: walkin.gym_data.last_checkin,
                checkout: walkin.gym_data.last_checkout,
                time_spent: walkin.gym_data.time_spent,
                is_current: walkin.gym_data.is_checked_in,
                membership: { status: 'daypass', remaining_days: 'N/A' }
            });
        }
    });

    allActivities.sort((a, b) => new Date(b.checkin) - new Date(a.checkin));
    todayActivities = allActivities;
    activityCountBadge.textContent = allActivities.length;

    activityTableBody.innerHTML = allActivities.map(activity => {
        const checkInTime = new Date(activity.checkin).toLocaleTimeString();
        const checkOutTime = activity.checkout ? new Date(activity.checkout).toLocaleTimeString() : '—';
        const timeSpent = activity.time_spent ? `${activity.time_spent}m` : '—';

        let statusClass, statusText, daysClass;
        if (activity.type === 'walkin') {
            statusClass = activity.is_current ? 'status-active' : 'status-expired';
            statusText = activity.is_current ? 'IN GYM' : 'COMPLETED';
            daysClass = 'days-safe';
        } else {
            const membership = activity.membership || {};
            statusClass = getMembershipClass(membership).replace('membership-', 'status-');
            daysClass = getDaysClass(membership.remaining_days);
            statusText = activity.is_current ? 'IN GYM' : getMembershipStatus(membership);
        }

        return `
            <tr>
                <td>${activity.member}<br><small style="color:#6a6a6a">UID: ${activity.uid}</small></td>
                <td>${checkInTime}</td>
                <td>${checkOutTime}</td>
                <td>${timeSpent}</td>
                <td><span class="${statusClass}">${statusText}</span></td>
                <td class="${daysClass}">${activity.membership?.remaining_days !== undefined ? activity.membership.remaining_days : 'N/A'}</td>
            </tr>`;
    }).join('');
}

function updateStats() {
    const today = new Date().toDateString();
    const checkedInMembers = allMembers.filter(m => m.gym_data.is_checked_in).length;
    const activeWalkinsCount = Object.values(allWalkins).filter(w => w.gym_data?.is_checked_in === true).length;

    const todayVisitorIds = new Set();
    allMembers.forEach(member => {
        (member.attendance_history || []).forEach(visit => {
            if (visit.checkin && new Date(visit.checkin).toDateString() === today) {
                todayVisitorIds.add(member.uid);
            }
        });
        if (member.gym_data.is_checked_in) todayVisitorIds.add(member.uid);
    });

    let walkinCount = 0;
    Object.values(allWalkins).forEach(walkin => {
        if (walkin.gym_data?.last_checkin && new Date(walkin.gym_data.last_checkin).toDateString() === today) {
            walkinCount++;
            todayVisitorIds.add(walkin.key);
        }
    });

    const activeMembersCount = allMembers.filter(m => {
        const membership = m.membership;
        return membership.status !== 'expired' && (membership.remaining_days === undefined || membership.remaining_days > 0);
    }).length;

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    const recentCheckins = todayActivities.filter(a => new Date(a.checkin) > oneHourAgo).length;

    currentOccupancy.textContent = checkedInMembers + activeWalkinsCount;
    todayVisitors.textContent = todayVisitorIds.size;
    activeMembers.textContent = activeMembersCount;
    peakHours.textContent = recentCheckins > 5 ? 'Now' : '—';
    if (walkinToday) walkinToday.textContent = walkinCount;
}

async function clearTodayActivity() {
    if (!confirm('Clear all of today\'s activity?')) return;

    const today = new Date().toISOString().split('T')[0];
    const updates = {};

    allMembers.forEach(member => {
        if (member.attendance_history) {
            const filtered = member.attendance_history.filter(visit =>
                !visit.checkin || new Date(visit.checkin).toISOString().split('T')[0] !== today
            );
            if (filtered.length !== member.attendance_history.length) {
                updates[`Customers/${member.key}/attendance_history`] = filtered;
                if (member.gym_data.is_checked_in) {
                    updates[`Customers/${member.key}/gym_data/is_checked_in`] = false;
                }
            }
        }
    });

    Object.keys(allWalkins).forEach(key => {
        if (key.includes(today)) updates[`Customers/${key}`] = null;
    });

    if (Object.keys(updates).length > 0) {
        try {
            await update(ref(db), updates);
            showMessage('Today\'s records cleared!', 'success');
        } catch (error) {
            showMessage('Error: ' + error.message, 'error');
        }
    }
}

function getMembershipStatus(membership) {
    if (!membership) return 'No membership';
    if (membership.status === 'expired' || membership.remaining_days <= 0) return 'Expired';
    if (membership.remaining_days <= 7) return `${membership.remaining_days} days left`;
    return 'Active';
}

function getMembershipClass(membership) {
    if (!membership) return 'membership-expired';
    if (membership.status === 'expired' || membership.remaining_days <= 0) return 'membership-expired';
    if (membership.remaining_days <= 7) return 'membership-warning';
    return 'membership-active';
}

function getDaysClass(remainingDays) {
    if (remainingDays === undefined) return 'days-safe';
    if (remainingDays <= 0) return 'days-danger';
    if (remainingDays <= 7) return 'days-warning';
    return 'days-safe';
}

function showMessage(text, type) {
    checkinMessage.textContent = text;
    checkinMessage.className = `message ${type}`;
    checkinMessage.style.display = 'block';
    setTimeout(() => { checkinMessage.style.display = 'none'; }, 5000);
}

function focusOnInput() {
    memberUidInput.focus();
}

memberUidInput.addEventListener('input', function() {
    const uid = this.value.trim();
    if (uid === DAYPASS_IN) {
        checkInOutBtn.textContent = 'Day Pass IN';
        checkInOutBtn.classList.add('day-pass-in');
        checkInOutBtn.classList.remove('day-pass-out');
    } else if (uid === DAYPASS_OUT) {
        checkInOutBtn.textContent = 'Day Pass OUT';
        checkInOutBtn.classList.add('day-pass-out');
        checkInOutBtn.classList.remove('day-pass-in');
    } else {
        checkInOutBtn.classList.remove('day-pass-in', 'day-pass-out');
        const member = allMembers.find(m => m.uid === uid || m.key === uid);
        if (member) {
            checkInOutBtn.textContent = member.gym_data.is_checked_in ? 'Check Out' : 'Check In';
        } else {
            checkInOutBtn.textContent = 'Check In';
        }
    }
});

document.addEventListener('DOMContentLoaded', init);

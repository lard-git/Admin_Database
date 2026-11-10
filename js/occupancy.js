import { db } from './database_init.js';
import { ref, update, onValue, netState, submit, overlayPending, pendingWalkinKeys, hasPending, review } from './offline.js';
import { withLiveMembership } from './membership.js';

const memberUidInput = document.getElementById('memberUidInput');
const checkInOutBtn = document.getElementById('checkInOutBtn');
const checkinMessage = document.getElementById('checkinMessage');
const currentOccupancy = document.getElementById('currentOccupancy');
const todayVisitors = document.getElementById('todayVisitors');
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

const contextMenu = document.getElementById('contextMenu');
const ctxMemberName = document.getElementById('ctxMemberName');
const ctxCheckout = document.getElementById('ctxCheckout');
const ctxForceRemove = document.getElementById('ctxForceRemove');
let ctxTargetKey = null;
let ctxIsWalkin = false;

function init() {
    loadMembers();
    focusOnInput();

    memberUidInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') handleCheckInOut();
    });

    checkInOutBtn.addEventListener('click', handleCheckInOut);
    refreshActivity.addEventListener('click', updateTodayActivity);
    clearActivity.addEventListener('click', clearTodayActivity);

    // Right-click context menu on member cards
    const membersList = document.getElementById('currentMembersList');
    if (membersList) {
        membersList.addEventListener('contextmenu', e => {
            const card = e.target.closest('[data-member-key]');
            if (!card) return;
            e.preventDefault();
            ctxTargetKey = card.dataset.memberKey;
            ctxIsWalkin = card.dataset.isWalkin === 'true';
            const name = card.querySelector('.member-name')?.textContent || ctxTargetKey;
            if (ctxMemberName) ctxMemberName.textContent = name;
            const x = Math.min(e.clientX, window.innerWidth - 220);
            const y = Math.min(e.clientY, window.innerHeight - 120);
            contextMenu.style.left = x + 'px';
            contextMenu.style.top = y + 'px';
            contextMenu.style.display = 'block';
        });
    }

    document.addEventListener('click', () => { if (contextMenu) contextMenu.style.display = 'none'; });
    document.addEventListener('contextmenu', e => {
        if (!e.target.closest('#currentMembersList [data-member-key]')) {
            if (contextMenu) contextMenu.style.display = 'none';
        }
    });

    if (ctxCheckout) {
        ctxCheckout.addEventListener('click', async () => {
            contextMenu.style.display = 'none';
            if (!ctxTargetKey) return;
            if (ctxIsWalkin) {
                await checkOutWalkinByKey(ctxTargetKey);
            } else {
                const member = allMembers.find(m => m.key === ctxTargetKey);
                if (member) await checkOutMember(member);
            }
        });
    }

    if (ctxForceRemove) {
        ctxForceRemove.addEventListener('click', async () => {
            contextMenu.style.display = 'none';
            if (!ctxTargetKey) return;
            if (locked()) { showMessage('Force Remove needs a connection and nothing waiting to upload.', 'warning'); return; }
            if (confirm('Force remove this person from the gym? (Does not record checkout time)')) {
                try {
                    if (ctxIsWalkin) {
                        await update(ref(db, `Customers/${ctxTargetKey}`), { 'gym_data/is_checked_in': false, 'membership/status': 'force_removed' });
                    } else {
                        await update(ref(db, `Customers/${ctxTargetKey}/gym_data`), { is_checked_in: false });
                    }
                    showMessage('Removed from occupancy', 'info');
                } catch (err) {
                    showMessage('Error: ' + err.message, 'error');
                }
            }
        });
    }
}

let lastSnap = null;

function loadMembers() {
    onValue(ref(db, 'Customers'), snapshot => { lastSnap = snapshot; rebuild(); });
    window.addEventListener('gym-queue', () => { rebuild(); renderReview(); applyLock(); });
    window.addEventListener('gym-net', applyLock);
    applyLock();
    renderReview();
}

// members and walk-ins as the database has them, with the check-ins / check-outs still waiting to upload applied on top
function rebuild() {
    allMembers = [];
    allWalkins = {};
    const seen = new Set();

    if (lastSnap && lastSnap.exists()) {
        lastSnap.forEach(child => {
            const key = child.key, data = overlayPending(key, child.val());
            seen.add(key);
            if (!data) return;
            if (key.startsWith('WALKIN_')) allWalkins[key] = { key, ...data, is_walkin: true };
            else allMembers.push(normalizeMemberData(key, data));
        });
    }
    pendingWalkinKeys().filter(k => !seen.has(k)).forEach(k => {       // walk-ins scanned while offline, not in the database yet
        const data = overlayPending(k, null);
        if (data) allWalkins[k] = { key: k, ...data, is_walkin: true };
    });

    updateOccupancyDisplay();
    updateTodayActivity();
    updateStats();
}

function normalizeMemberData(key, data) {
    const uid = data.gym_data?.uid || data.personal_info?.uid || data.uid || key;

    return {
        key,
        uid,
        firstname: data.personal_info?.firstname || '',
        lastname: data.personal_info?.lastname || '',
        phone: data.personal_info?.phone || '',
        membership: withLiveMembership(data.membership),
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
    const now = new Date(), at = now.toISOString();
    const today = at.split('T')[0];
    const timestamp = now.getTime();
    const walkinKey = `WALKIN_${today}_${timestamp}`;
    const walkinId = timestamp.toString().slice(-4);

    const record = {
        personal_info: { firstname: "WALK-IN", lastname: `#${walkinId}`, uid: walkinKey, type: "daypass" },
        gym_data: { is_checked_in: true, last_checkin: at, last_checkout: null, total_visits: 1, total_time_spent: 0, uid: walkinKey },
        membership: { status: "active", remaining_days: 1, start_date: today, end_date: today },
        attendance_history: [{ checkin: at, checkout: null, time_spent: null, date: today }]
    };
    await submit({ type: 'walkin_in', key: walkinKey, at, record, label: `Walk-in #${walkinId}` });

    showMessage(`Walk-in checked IN! ID: ${walkinId}${savedNote()}`, 'success');
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
    await submit({ type: 'walkin_out', key: oldest.key, at: now.toISOString(), label: `Walk-in #${oldest.key.split('_').pop().slice(-4)}` });
    showMessage(`Walk-out recorded! Time: ${timeSpent}m${savedNote()}`, 'info');
}

async function checkInMember(member) {
    const name = `${member.firstname} ${member.lastname}`.trim();
    await submit({ type: 'member_in', key: member.key, label: name });
    showMessage(`${name} checked in!${savedNote()}`, 'success');
}

async function checkOutMember(member) {
    const now = new Date();
    const name = `${member.firstname} ${member.lastname}`.trim();
    const lastCheckIn = member.gym_data.last_checkin ? new Date(member.gym_data.last_checkin) : new Date();
    const timeSpent = Math.round((now - lastCheckIn) / (1000 * 60));
    await submit({ type: 'member_out', key: member.key, at: now.toISOString(), label: name });
    showMessage(`${name} checked out. Time: ${timeSpent}m${savedNote()}`, 'info');
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
            <div class="member-card ${membershipClass}" data-member-key="${member.key}" data-is-walkin="false" title="Right-click to checkout">
                <div class="member-info">
                    <div class="member-name">${member.firstname} ${member.lastname}</div>
                    <div class="member-uid">UID: ${member.uid}</div>
                    <div class="member-membership ${membershipClass}">${membershipStatus}</div>
                </div>
                <div class="checkin-time">${checkInTime.toLocaleTimeString()}<br>(${duration}m ago)${hasPending(member.key) ? '<br>waiting to upload' : ''}</div>
            </div>`;
    }).join('');

    html += activeWalkinsArr.map(walkin => {
        const checkInTime = new Date(walkin.gym_data.last_checkin);
        const duration = Math.round((new Date() - checkInTime) / (1000 * 60));
        const walkinId = walkin.key.split('_').pop().slice(-4);

        return `
            <div class="member-card walkin-card" data-member-key="${walkin.key}" data-is-walkin="true" title="Right-click to checkout">
                <div class="member-info">
                    <div class="member-name">Walk-in #${walkinId}</div>
                    <div class="member-uid">DAY PASS</div>
                    <div class="member-membership membership-active">Active Session</div>
                </div>
                <div class="checkin-time">${checkInTime.toLocaleTimeString()}<br>(${duration}m ago)${hasPending(walkin.key) ? '<br>waiting to upload' : ''}</div>
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
                <td>${activity.member}<br><small style="color:var(--fa)">UID: ${activity.uid}</small></td>
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

    currentOccupancy.textContent = checkedInMembers + activeWalkinsCount;
    todayVisitors.textContent = todayVisitorIds.size;
    if (walkinToday) walkinToday.textContent = walkinCount;
}

async function clearTodayActivity() {
    if (locked()) { showMessage('Clear Today needs a connection and nothing waiting to upload.', 'warning'); return; }
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
    if (membership.remaining_days <= 7) return 'Expiring';
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

const savedNote = () => netState.connected === true ? '' : ' (saved on this computer, uploads when online)';
const locked = () => netState.connected !== true || netState.pending > 0;

// Force Remove and Clear Today change or delete data in ways that can't be saved for later, so they stay locked until the
// connection is confirmed and nothing is waiting to upload
function applyLock() {
    const l = locked();
    clearActivity.disabled = l;
    clearActivity.title = l ? 'Needs a connection and nothing waiting to upload' : '';
    ctxForceRemove?.classList.toggle('ctx-locked', l);
}

// scans that could not be applied (for example the member was removed in the meantime) stay listed until dismissed
function renderReview() {
    let box = document.getElementById('syncReview');
    const items = review.list();
    if (!items.length) { box?.remove(); return; }
    if (!box) { box = document.createElement('div'); box.id = 'syncReview'; box.className = 'message warning'; checkinMessage.after(box); }
    box.replaceChildren(...items.map(it => {
        const row = document.createElement('div');
        row.textContent = it.text + ' ';
        const b = document.createElement('button');
        b.className = 'btn btn-secondary'; b.textContent = 'Dismiss';
        b.onclick = () => review.dismiss(it.id);
        row.appendChild(b);
        return row;
    }));
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

async function checkOutWalkinByKey(walkinKey) {
    if (!allWalkins[walkinKey]) { showMessage('Walk-in record not found.', 'error'); return; }
    await submit({ type: 'walkin_out', key: walkinKey, label: `Walk-in #${walkinKey.split('_').pop().slice(-4)}` });
    showMessage(`Walk-in checked out successfully!${savedNote()}`, 'success');
}

document.addEventListener('DOMContentLoaded', init);

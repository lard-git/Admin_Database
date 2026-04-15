import { db } from './database_init.js';
import { ref, get, update, remove, onValue } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-database.js";

const customersRef = ref(db, "Customers");
const tableBody = document.getElementById("memberTableBody");
const emptyState = document.getElementById("emptyState");
const memberCount = document.getElementById("memberCount");
const activeCount = document.getElementById("activeCount");
const expiringCount = document.getElementById("expiringCount");
const expiredCount = document.getElementById("expiredCount");
const revenueAmount = document.getElementById("revenueAmount");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const qrModal = document.getElementById("qrModal");
const modalQrContainer = document.getElementById("modalQrContainer");
const modalMemberInfo = document.getElementById("modalMemberInfo");
const closeModal = document.querySelector(".close");
const downloadQR = document.getElementById("downloadQR");
const editModal = document.getElementById("editModal");

let allMembers = [];
let memberWalkins = {};
let currentLargeQR = '';
let currentEditMember = null;
let totalMonthlyRevenue = 0;

document.addEventListener('DOMContentLoaded', function() {
    initEventListeners();
});

function initEventListeners() {
    if (closeModal) {
        closeModal.addEventListener('click', function() {
            if (qrModal) qrModal.style.display = 'none';
        });
    }

    const closeEditBtns = document.querySelectorAll(".close-edit");
    closeEditBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            if (editModal) editModal.style.display = 'none';
            currentEditMember = null;
        });
    });

    if (downloadQR) {
        downloadQR.addEventListener('click', function() {
            if (!currentLargeQR) return;
            const link = document.createElement('a');
            const fileName = `member-qr-${modalMemberInfo.textContent.split('UID: ')[1] || 'unknown'}.png`;
            link.download = fileName;
            link.href = currentLargeQR;
            link.click();
        });
    }

    const confirmEdit = document.getElementById("confirmEdit");
    if (confirmEdit) {
        confirmEdit.addEventListener('click', handleConfirmEdit);
    }

    if (searchBtn) {
        searchBtn.addEventListener('click', searchMembers);
    }

    if (searchInput) {
        searchInput.addEventListener('keyup', function(event) {
            if (event.key === 'Enter') searchMembers();
        });

        searchInput.addEventListener('input', function() {
            clearTimeout(this.searchTimeout);
            this.searchTimeout = setTimeout(searchMembers, 300);
        });
    }

    window.addEventListener('click', function(event) {
        if (qrModal && event.target === qrModal) {
            qrModal.style.display = 'none';
        }
        if (editModal && event.target === editModal) {
            editModal.style.display = 'none';
            currentEditMember = null;
        }
        const incomeModal = document.getElementById('incomeHistoryModal');
        if (incomeModal && event.target === incomeModal) incomeModal.style.display = 'none';
    });

    const incomeHistoryBtn = document.getElementById('incomeHistoryBtn');
    if (incomeHistoryBtn) incomeHistoryBtn.addEventListener('click', showIncomeHistory);

    const closeIncome = document.querySelector('.close-income');
    if (closeIncome) closeIncome.addEventListener('click', () => {
        const m = document.getElementById('incomeHistoryModal');
        if (m) m.style.display = 'none';
    });
}

function getCurrentEditPrice() {
    const editMembershipType = document.getElementById("editMembershipType");
    if (!editMembershipType || !editMembershipType.options) return 800;
    const selectedOption = editMembershipType.options[editMembershipType.selectedIndex];
    if (!selectedOption) return 800;
    return parseInt(selectedOption.getAttribute('data-price')) || 800;
}

function updateEditPaymentDisplay(months, currentPayment = 0, currentMonths = 0) {
    const currentPrice = getCurrentEditPrice();
    const additionalPayment = months * currentPrice;
    const newTotalPayment = currentPayment + additionalPayment;
    const newTotalMonths = currentMonths + months;

    const editMonthsDisplay = document.getElementById("editMonthsDisplay");
    const editSelectedMonths = document.getElementById("editSelectedMonths");
    const editTotalAmount = document.getElementById("editTotalAmount");

    if (editMonthsDisplay) editMonthsDisplay.textContent = months + ' month' + (months > 1 ? 's' : '');
    if (editSelectedMonths) editSelectedMonths.textContent = months;
    if (editTotalAmount) editTotalAmount.textContent = additionalPayment.toLocaleString();

    const newTotalPaymentEl = document.getElementById('newTotalPayment');
    const newTotalMonthsEl = document.getElementById('newTotalMonths');
    if (newTotalPaymentEl) newTotalPaymentEl.textContent = newTotalPayment.toLocaleString();
    if (newTotalMonthsEl) newTotalMonthsEl.textContent = newTotalMonths;
}

function setupEditModalListeners() {
    const editMembershipType = document.getElementById("editMembershipType");
    const editPayment = document.getElementById("editPayment");
    const editMonths = document.getElementById("editMonths");

    if (editMembershipType) {
        const newSelect = editMembershipType.cloneNode(true);
        editMembershipType.parentNode.replaceChild(newSelect, editMembershipType);

        const newEditMembershipType = document.getElementById("editMembershipType");

        newEditMembershipType.addEventListener('change', function() {
            const selectedOption = this.options[this.selectedIndex];
            if (!selectedOption) return;

            const price = selectedOption.getAttribute('data-price') || '800';
            const typeText = selectedOption.text.split(' - ')[0] || 'Regular';

            const editMonthlyRateDisplay = document.getElementById("editMonthlyRateDisplay");
            const editMembershipTypeDisplay = document.getElementById("editMembershipTypeDisplay");

            if (editMonthlyRateDisplay) editMonthlyRateDisplay.textContent = price;
            if (editMembershipTypeDisplay) editMembershipTypeDisplay.textContent = typeText;

            if (editPayment) {
                editPayment.min = price;
                editPayment.step = price;
                editPayment.placeholder = `${price} per month`;
            }

            const months = editMonths ? parseInt(editMonths.value) : 1;
            updateEditPaymentDisplay(months,
                currentEditMember?.membership?.payment_amount || 0,
                currentEditMember?.membership?.months_paid || 0
            );
        });
    }

    if (editPayment) {
        editPayment.addEventListener('input', function() {
            const payment = parseInt(this.value) || 0;
            const currentPrice = getCurrentEditPrice();
            const calculatedMonths = Math.floor(payment / currentPrice);
            const maxMonths = 12;

            if (calculatedMonths > 0) {
                const months = Math.min(calculatedMonths, maxMonths);
                if (editMonths) editMonths.value = months;

                const currentMembership = currentEditMember?.membership || {};
                updateEditPaymentDisplay(months,
                    currentMembership.payment_amount || 0,
                    currentMembership.months_paid || 0
                );
            }
        });
    }

    if (editMonths) {
        editMonths.addEventListener('input', function() {
            const months = parseInt(this.value);
            const currentMembership = currentEditMember?.membership || {};
            updateEditPaymentDisplay(months,
                currentMembership.payment_amount || 0,
                currentMembership.months_paid || 0
            );

            const currentPrice = getCurrentEditPrice();
            const paymentAmount = months * currentPrice;
            if (editPayment) editPayment.value = paymentAmount;
        });
    }
}

onValue(customersRef, (snapshot) => {
    allMembers = [];
    tableBody.innerHTML = "";

    if (!snapshot.exists()) {
        emptyState.style.display = 'block';
        updateSummaryCards([], 0);
        return;
    }

    emptyState.style.display = 'none';

    const now = new Date();
    const curMonth = now.getMonth();
    const curYear  = now.getFullYear();
    let walkinRevenue = 0;

    snapshot.forEach(child => {
        const data = child.val();

        if (child.key.startsWith('WALKIN_')) {
            let walkinDate = null;
            if (data.gym_data?.last_checkin) {
                walkinDate = new Date(data.gym_data.last_checkin);
            } else if (data.timestamp) {
                walkinDate = new Date(data.timestamp);
            } else {
                const parts = child.key.split('_');
                if (parts.length >= 3) {
                    const ts = parseInt(parts[parts.length - 1]);
                    if (!isNaN(ts) && ts > 1_000_000_000_000) walkinDate = new Date(ts);
                }
            }
            memberWalkins[child.key] = { ...data, _walkinDate: walkinDate };
            if (walkinDate && walkinDate.getMonth() === curMonth && walkinDate.getFullYear() === curYear) {
                walkinRevenue += (data.payment || data.payment_amount || 40);
            }
            return;
        }

        const member = {
            key: child.key,
            uid: data.personal_info?.uid || data.gym_data?.uid || child.key,
            firstname: data.personal_info?.firstname || "",
            lastname: data.personal_info?.lastname || "",
            phone: data.personal_info?.phone || "",
            membership: data.membership || {},
            personal_info: data.personal_info || {}
        };
        allMembers.push(member);
    });

    let monthlyRevenue = walkinRevenue;
    allMembers.forEach(m => {
        const startDateStr = m.membership?.start_date;
        const monthsPaid   = m.membership?.months_paid || 1;
        const paymentAmt   = m.membership?.payment_amount || 0;
        const monthlyRate  = paymentAmt > 0 ? paymentAmt / monthsPaid : (m.membership?.monthly_rate || 0);

        if (startDateStr && monthlyRate > 0) {
            const start = new Date(startDateStr);
            start.setHours(0, 0, 0, 0);
            const end = new Date(start);
            end.setMonth(end.getMonth() + monthsPaid);
            const mStart = new Date(curYear, curMonth, 1);
            const mEnd   = new Date(curYear, curMonth + 1, 0);
            if (start <= mEnd && end >= mStart) {
                monthlyRevenue += monthlyRate;
            }
        }
    });

    totalMonthlyRevenue = monthlyRevenue;
    updateSummaryCards(allMembers, totalMonthlyRevenue);
    updateDailyIncomeDisplay();
    renderMembers(allMembers);
});

function updateSummaryCards(members, revenue = totalMonthlyRevenue) {
    let active = 0;
    let expiring = 0;
    let expired = 0;

    members.forEach(m => {
        const days = getActualRemainingDays(m);
        if (days <= 0) {
            expired++;
        } else if (days <= 7) {
            expiring++;
        } else {
            active++;
        }
    });

    if (memberCount) memberCount.textContent = members.length;
    if (activeCount) activeCount.textContent = active;
    if (expiringCount) expiringCount.textContent = expiring;
    if (expiredCount) expiredCount.textContent = expired;
    if (revenueAmount) revenueAmount.textContent = revenue.toLocaleString();
}

function getActualRemainingDays(member) {
    if (member.membership?.status === 'expired') return 0;

    if (!member.membership?.end_date) {
        if (member.membership?.start_date && member.membership?.months_paid) {
            const start = new Date(member.membership.start_date);
            const end = new Date(start);
            end.setMonth(end.getMonth() + (member.membership.months_paid || 1));
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return Math.max(0, Math.ceil((end - today) / (1000 * 60 * 60 * 24)));
        }
        return member.membership?.remaining_days || 0;
    }

    try {
        const endDate = new Date(member.membership.end_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const remaining = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
        return Math.max(0, remaining);
    } catch (e) {
        return member.membership?.remaining_days || 0;
    }
}

function getStatusPriority(member) {
    const remainingDays = getActualRemainingDays(member);
    const status = member.membership?.status || 'unknown';
    if (status === 'expired' || remainingDays <= 0) return 3;
    if (remainingDays <= 7) return 1;
    return 2;
}

function renderMembers(members) {
    tableBody.innerHTML = "";

    if (members.length === 0) {
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    const sorted = [...members].sort((a, b) => {
        const pa = getStatusPriority(a);
        const pb = getStatusPriority(b);
        if (pa !== pb) return pa - pb;
        const na = `${a.firstname} ${a.lastname}`.toLowerCase();
        const nb = `${b.firstname} ${b.lastname}`.toLowerCase();
        return na.localeCompare(nb);
    });

    sorted.forEach(member => {
        const fullname = `${member.firstname} ${member.lastname}`;
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${member.uid}`;

        const membership = member.membership || {};
        const remainingDays = getActualRemainingDays(member);
        const status = membership.status || 'unknown';
        const startDate = membership.start_date || 'N/A';
        const endDate = membership.end_date || 'N/A';
        const payment = membership.payment_amount || 0;
        const months = membership.months_paid || 0;

        const membershipType = member.personal_info?.membership_type || member.membership?.plan || 'regular';
        const membershipTypeDisplay = member.membership?.plan_display ||
            (membershipType === 'student' ? 'Student' : 'Regular');
        const monthlyRate = member.membership?.monthly_rate ||
            (membershipType === 'student' ? 600 : 800);

        let statusClass = 'status-active';
        let statusText = 'Active';
        let daysClass = 'days-safe';

        if (status === 'expired' || remainingDays <= 0) {
            statusClass = 'status-expired';
            statusText = 'Expired';
            daysClass = 'days-danger';
        } else if (remainingDays <= 7) {
            statusClass = 'status-warning';
            statusText = 'Expiring';
            daysClass = 'days-warning';
        } else {
            statusText = 'Active';
            daysClass = 'days-safe';
        }

        const row = document.createElement('tr');
        if (status === 'expired' || remainingDays <= 0) row.classList.add('row-expired');
        row.innerHTML = `
            <td><strong>${member.uid}</strong></td>
            <td>${fullname}</td>
            <td>${member.phone}</td>
            <td>${membershipTypeDisplay}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td class="${daysClass}">${remainingDays}</td>
            <td>${startDate}</td>
            <td>${endDate}</td>
            <td>₱${payment.toLocaleString()}</td>
            <td>${months} month${months !== 1 ? 's' : ''}</td>
            <td>₱${monthlyRate}</td>
            <td>
                <img src="${qrUrl}" class="qr-small" alt="QR Code"
                     onclick="showQRModal('${member.uid}', '${fullname.replace(/'/g, "\\'")}')">
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-edit" onclick="openEditModal('${member.key}', '${fullname.replace(/'/g, "\\'")}', '${member.uid}')">Edit/Extend</button>
                    <button class="btn btn-delete" onclick="deleteMember('${member.key}', '${fullname.replace(/'/g, "\\'")}')">Delete</button>
                </div>
            </td>
        `;

        tableBody.appendChild(row);
    });
}

function showQRModal(uid, name) {
    const largeQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${uid}`;
    currentLargeQR = largeQrUrl;

    if (modalQrContainer) modalQrContainer.innerHTML = `<img src="${largeQrUrl}" alt="QR Code for ${name}">`;
    if (modalMemberInfo) modalMemberInfo.textContent = `${name} (UID: ${uid})`;
    if (qrModal) qrModal.style.display = 'block';
}

function openEditModal(memberKey, name, uid) {
    const member = allMembers.find(m => m.key === memberKey);
    if (!member) return;

    currentEditMember = member;
    setupEditModalListeners();

    const editFirstName = document.getElementById("editFirstName");
    const editLastName = document.getElementById("editLastName");
    const editPhone = document.getElementById("editPhone");
    const editUID = document.getElementById("editUID");
    const editPayment = document.getElementById("editPayment");
    const editMonths = document.getElementById("editMonths");
    const editMembershipType = document.getElementById("editMembershipType");

    if (editFirstName) editFirstName.value = member.firstname || '';
    if (editLastName) editLastName.value = member.lastname || '';
    if (editPhone) editPhone.value = member.phone || '';
    if (editUID) editUID.value = member.uid || '';

    const currentMembership = member.membership || {};
    const currentPayment = currentMembership.payment_amount || 0;
    const currentMonths = currentMembership.months_paid || 0;
    const currentDays = getActualRemainingDays(member);
    const currentType = currentMembership.plan || member.personal_info?.membership_type || 'regular';
    const currentTypeDisplay = currentMembership.plan_display ||
        (currentType === 'student' ? 'Student' : 'Regular');
    const currentMonthlyRate = currentMembership.monthly_rate ||
        (currentType === 'student' ? 600 : 800);

    const currentTypeDisplayEl = document.getElementById('currentMembershipTypeDisplay');
    const currentRateDisplayEl = document.getElementById('currentMonthlyRateDisplay');
    const currentDaysDisplayEl = document.getElementById('currentDaysDisplay');

    if (currentTypeDisplayEl) currentTypeDisplayEl.textContent = currentTypeDisplay;
    if (currentRateDisplayEl) currentRateDisplayEl.textContent = currentMonthlyRate;
    if (currentDaysDisplayEl) currentDaysDisplayEl.textContent = currentDays;

    if (editMembershipType) {
        editMembershipType.value = currentType;
        setTimeout(() => {
            editMembershipType.dispatchEvent(new Event('change'));
        }, 100);
    }

    if (editPayment) editPayment.value = currentMonthlyRate;
    if (editMonths) editMonths.value = 1;
    updateEditPaymentDisplay(1, currentPayment, currentMonths);

    if (editModal) editModal.style.display = 'block';
}

async function handleConfirmEdit() {
    if (!currentEditMember) return;

    const editFirstName = document.getElementById("editFirstName");
    const editLastName = document.getElementById("editLastName");
    const editPhone = document.getElementById("editPhone");
    const editPayment = document.getElementById("editPayment");
    const editMonths = document.getElementById("editMonths");
    const editMembershipType = document.getElementById("editMembershipType");

    if (!editFirstName?.value.trim() || !editLastName?.value.trim()) {
        alert("Please enter both first and last name");
        return;
    }

    const editPhoneVal = editPhone?.value.trim();
    if (!editPhoneVal) {
        alert("Please enter mobile number");
        return;
    }
    if (!/^\d{11}$/.test(editPhoneVal)) {
        alert("Mobile number must be exactly 11 digits (numbers only)");
        editPhone.focus();
        return;
    }

    const currentPrice = getCurrentEditPrice();
    if (!editPayment?.value.trim() || parseInt(editPayment.value) < currentPrice) {
        alert(`Please enter payment amount (minimum ₱${currentPrice})`);
        return;
    }

    try {
        const newPaymentAmount = parseInt(editPayment.value) || currentPrice;
        const newMonths = parseInt(editMonths?.value) || 1;
        const extensionType = editMembershipType?.value || 'regular';
        const extensionTypeText = editMembershipType ?
            editMembershipType.options[editMembershipType.selectedIndex].text.split(' - ')[0] : 'Regular';

        const memberRef = ref(db, `Customers/${currentEditMember.key}`);
        const snapshot = await get(memberRef);
        const memberData = snapshot.val();

        const currentMembership = memberData.membership || {};
        let currentEndDate;
        let currentRemainingDays = currentMembership.remaining_days || 0;

        if (currentMembership.end_date && currentRemainingDays > 0) {
            currentEndDate = new Date(currentMembership.end_date);
        } else {
            currentEndDate = new Date();
            currentRemainingDays = 0;
        }

        const newEndDate = new Date(currentEndDate);
        newEndDate.setMonth(newEndDate.getMonth() + newMonths);

        const totalRemainingDays = Math.ceil((newEndDate - new Date()) / (1000 * 60 * 60 * 24));
        const currentMonthsTotal = currentMembership.months_paid || 0;
        const totalMonths = currentMonthsTotal + newMonths;
        const currentPaymentTotal = currentMembership.payment_amount || 0;
        const totalPayment = currentPaymentTotal + newPaymentAmount;
        const newMonthlyRate = getCurrentEditPrice();

        await update(ref(db, `Customers/${currentEditMember.key}`), {
            "personal_info/firstname": editFirstName.value.trim(),
            "personal_info/lastname": editLastName.value.trim(),
            "personal_info/phone": editPhone.value.trim(),
            "personal_info/membership_type": extensionType,
            "membership/plan": extensionType,
            "membership/plan_display": extensionTypeText,
            "membership/monthly_rate": newMonthlyRate,
            "membership/payment_amount": totalPayment,
            "membership/months_paid": totalMonths,
            "membership/start_date": currentMembership.start_date || new Date().toISOString().split('T')[0],
            "membership/end_date": newEndDate.toISOString().split('T')[0],
            "membership/remaining_days": totalRemainingDays,
            "membership/last_updated": new Date().toISOString().split('T')[0],
            "membership/status": "active"
        });

        alert(`Member Updated!\nNew total: ${totalRemainingDays} days remaining`);
        if (editModal) editModal.style.display = 'none';
        currentEditMember = null;

    } catch (error) {
        alert('Error updating member: ' + error.message);
    }
}

async function deleteMember(memberKey, name) {
    if (confirm(`Are you sure you want to delete member: ${name}?\nThis action cannot be undone.`)) {
        try {
            await remove(ref(db, `Customers/${memberKey}`));
            alert(`Member ${name} deleted successfully!`);
        } catch (error) {
            alert('Error deleting member: ' + error.message);
        }
    }
}

function searchMembers() {
    const searchTerm = searchInput.value.toLowerCase().trim();
    if (!searchTerm) {
        renderMembers(allMembers);
        return;
    }
    const filtered = allMembers.filter(member => {
        const fullName = `${member.firstname} ${member.lastname}`.toLowerCase();
        const uid = (member.uid || '').toString().toLowerCase();
        const phone = (member.phone || '').toString().toLowerCase();
        return uid.includes(searchTerm) ||
            fullName.includes(searchTerm) ||
            member.firstname.toLowerCase().includes(searchTerm) ||
            member.lastname.toLowerCase().includes(searchTerm) ||
            phone.includes(searchTerm);
    });
    renderMembers(filtered);
}

async function showIncomeHistory() {
    const modal = document.getElementById('incomeHistoryModal');
    const content = document.getElementById('incomeHistoryContent');
    const totalAllEl = document.getElementById('incomeTotalAll');
    const totalMembEl = document.getElementById('incomeTotalMemberships');
    const totalWalkEl = document.getElementById('incomeTotalWalkins');
    const rangeEl = document.getElementById('incomeModalRange');
    if (!modal || !content) return;

    content.innerHTML = '<p style="color:#6a6a6a;text-align:center;padding:20px;">Loading…</p>';
    modal.style.display = 'flex';

    const snap = await get(ref(db, 'Customers'));
    const today = new Date();
    const days = [];
    for (let i = 0; i < 14; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        days.push(d.toISOString().split('T')[0]);
    }

    const membershipIncome = {};
    const walkinIncome = {};
    days.forEach(d => { membershipIncome[d] = 0; walkinIncome[d] = 0; });

    if (snap.exists()) {
        snap.forEach(child => {
            const data = child.val();
            if (child.key.startsWith('WALKIN_')) {
                let walkinDate = null;
                if (data.gym_data?.last_checkin) walkinDate = new Date(data.gym_data.last_checkin).toISOString().split('T')[0];
                else if (data.timestamp) walkinDate = new Date(data.timestamp).toISOString().split('T')[0];
                else {
                    const parts = child.key.split('_');
                    const ts = parseInt(parts[parts.length - 1]);
                    if (!isNaN(ts) && ts > 1_000_000_000_000) walkinDate = new Date(ts).toISOString().split('T')[0];
                }
                if (walkinDate && walkinIncome[walkinDate] !== undefined) {
                    walkinIncome[walkinDate] += data.payment || data.payment_amount || 40;
                }
            } else {
                const startDate = data.membership?.start_date || data.membership?.last_updated;
                if (startDate && membershipIncome[startDate] !== undefined) {
                    membershipIncome[startDate] += data.membership?.payment_amount || 0;
                }
            }
        });
    }

    let totalMemb = 0, totalWalk = 0;
    days.forEach(d => { totalMemb += membershipIncome[d]; totalWalk += walkinIncome[d]; });
    const totalAll = totalMemb + totalWalk;

    if (totalAllEl) totalAllEl.textContent = '₱' + totalAll.toLocaleString();
    if (totalMembEl) totalMembEl.textContent = '₱' + totalMemb.toLocaleString();
    if (totalWalkEl) totalWalkEl.textContent = '₱' + totalWalk.toLocaleString();
    if (rangeEl) rangeEl.textContent = `(${days[days.length - 1]} – ${days[0]})`;

    const fmt = d => {
        const dt = new Date(d + 'T00:00:00');
        return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' });
    };
    const todayStr = today.toISOString().split('T')[0];

    const rows = days.map(d => {
        const total = membershipIncome[d] + walkinIncome[d];
        const isToday = d === todayStr;
        const cls = isToday ? 'class="inc-today-row"' : '';
        return `<tr ${cls}>
            <td>${fmt(d)}${isToday ? ' <span style="color:#ebc069;font-size:10px;">(today)</span>' : ''}</td>
            <td style="color:#ebc069;">₱${membershipIncome[d].toLocaleString()}</td>
            <td style="color:#4fc3f7;">₱${walkinIncome[d].toLocaleString()}</td>
            <td style="font-weight:bold;">₱${total.toLocaleString()}</td>
        </tr>`;
    }).join('');

    content.innerHTML = `
        <table>
            <thead><tr><th>Date</th><th>Memberships</th><th>Walk-ins</th><th>Total</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
}

function computeDailyIncome(targetDateStr) {
    let income = 0;
    allMembers.forEach(m => {
        const start = m.membership?.start_date;
        const updated = m.membership?.last_updated;
        if (start === targetDateStr || updated === targetDateStr) {
            income += m.membership?.payment_amount || 0;
        }
    });
    Object.values(memberWalkins).forEach(w => {
        const d = w._walkinDate;
        if (d && d.toISOString().split('T')[0] === targetDateStr) {
            income += w.payment || w.payment_amount || 40;
        }
    });
    return income;
}

function updateDailyIncomeDisplay() {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const twoDays = new Date(today); twoDays.setDate(twoDays.getDate() - 2);

    const todayIncome = computeDailyIncome(todayStr);
    const yestIncome = computeDailyIncome(yesterday.toISOString().split('T')[0]);
    const twoDaysIncome = computeDailyIncome(twoDays.toISOString().split('T')[0]);

    const el0 = document.getElementById('dailyIncomeToday');
    const el1 = document.getElementById('dailyIncome1');
    const el2 = document.getElementById('dailyIncome2');
    if (el0) el0.textContent = todayIncome.toLocaleString();
    if (el1) el1.textContent = yestIncome.toLocaleString();
    if (el2) el2.textContent = twoDaysIncome.toLocaleString();
}

window.showQRModal = showQRModal;
window.openEditModal = openEditModal;
window.deleteMember = deleteMember;

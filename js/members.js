import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getDatabase, ref, onValue, update, remove } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-database.js";

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
const renewModal = document.getElementById("renewModal");
const closeRenewModal = document.querySelector(".close-renew");
const renewPayment = document.getElementById("renewPayment");
const renewMonths = document.getElementById("renewMonths");
const renewMonthsDisplay = document.getElementById("renewMonthsDisplay");
const renewTotal = document.getElementById("renewTotal");
const confirmRenew = document.getElementById("confirmRenew");

let allMembers = [];
let currentLargeQR = '';
let currentRenewMember = null;
let totalMonthlyRevenue = 0; // Store total revenue separately

// Realtime listener
onValue(customersRef, (snapshot) => {
    allMembers = [];
    tableBody.innerHTML = "";
    
    if (!snapshot.exists()) {
        emptyState.style.display = 'block';
        updateSummaryCards(0, 0, 0, 0, 0);
        return;
    }
    
    emptyState.style.display = 'none';
    
    snapshot.forEach(child => {
        const data = child.val();
        const member = {
            key: child.key,
            uid: data.personal_info?.uid || data.gym_data?.uid || child.key,
            firstname: data.personal_info?.firstname || "",
            lastname: data.personal_info?.lastname || "",
            phone: data.personal_info?.phone || "",
            membership: data.membership || {}
        };
        
        allMembers.push(member);
    });
    
    // Calculate total monthly revenue from ALL members
    totalMonthlyRevenue = allMembers.reduce((sum, m) => sum + (m.membership.payment_amount || 0), 0);
    
    updateSummaryCards(allMembers, totalMonthlyRevenue);
    renderMembers(allMembers);
});

// Update summary cards
function updateSummaryCards(members, revenue = totalMonthlyRevenue) {
    const active = members.filter(m => {
        const status = m.membership.status;
        const remainingDays = m.membership.remaining_days;
        return status === 'active' && remainingDays > 7;
    }).length;
    
    const expiring = members.filter(m => {
        const status = m.membership.status;
        const remainingDays = m.membership.remaining_days;
        return status === 'active' && remainingDays <= 7 && remainingDays > 0;
    }).length;
    
    const expired = members.filter(m => {
        const status = m.membership.status;
        const remainingDays = m.membership.remaining_days;
        return status === 'expired' || remainingDays <= 0;
    }).length;
    
    memberCount.textContent = members.length;
    activeCount.textContent = active;
    expiringCount.textContent = expiring;
    expiredCount.textContent = expired;
    revenueAmount.textContent = revenue.toLocaleString();
}

// Render members to table
function renderMembers(members) {
    tableBody.innerHTML = "";
    
    if (members.length === 0) {
        emptyState.style.display = 'block';
        return;
    }
    
    emptyState.style.display = 'none';
    
    members.forEach(member => {
        const fullname = `${member.firstname} ${member.lastname}`;
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${member.uid}`;
        
        // Calculate membership status and styling
        const membership = member.membership;
        const remainingDays = membership.remaining_days || 0;
        const status = membership.status || 'unknown';
        const startDate = membership.start_date || 'N/A';
        const endDate = membership.end_date || 'N/A';
        const payment = membership.payment_amount || 0;
        const months = membership.months_paid || 0;
        
        let statusClass = 'status-active';
        let statusText = 'Active';
        let daysClass = 'days-safe';
        
        if (status === 'expired' || remainingDays <= 0) {
            statusClass = 'status-expired';
            statusText = 'Expired';
            daysClass = 'days-danger';
        } else if (remainingDays <= 7) {
            statusClass = 'status-warning';
            statusText = `${remainingDays} days left`;
            daysClass = 'days-warning';
        } else {
            statusText = `${remainingDays} days left`;
            daysClass = 'days-safe';
        }
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${member.uid}</strong></td>
            <td>${fullname}</td>
            <td>${member.phone}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td class="${daysClass}">${remainingDays}</td>
            <td>${startDate}</td>
            <td>${endDate}</td>
            <td>₱${payment.toLocaleString()}</td>
            <td>${months} month${months !== 1 ? 's' : ''}</td>
            <td>
                <img src="${qrUrl}" class="qr-small" alt="QR Code" 
                     onclick="showQRModal('${member.uid}', '${fullname.replace(/'/g, "\\'")}')">
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-renew" onclick="openRenewModal('${member.key}', '${fullname.replace(/'/g, "\\'")}')">Renew</button>
                    <button class="btn btn-delete" onclick="deleteMember('${member.key}', '${fullname.replace(/'/g, "\\'")}')">Delete</button>
                </div>
            </td>
        `;
        
        tableBody.appendChild(row);
    });
}

// Search functionality
function searchMembers() {
    const searchTerm = searchInput.value.toLowerCase().trim();
    
    if (!searchTerm) {
        renderMembers(allMembers);
        // When no search, show counts for ALL members but keep total revenue
        updateSummaryCards(allMembers, totalMonthlyRevenue);
        return;
    }
    
    const filteredMembers = allMembers.filter(member => {
        const fullName = `${member.firstname} ${member.lastname}`.toLowerCase();
        const uid = (member.uid || '').toString().toLowerCase();
        const phone = (member.phone || '').toString().toLowerCase();
        const firstname = (member.firstname || '').toLowerCase();
        const lastname = (member.lastname || '').toLowerCase();
        
        return uid.includes(searchTerm) ||
               fullName.includes(searchTerm) ||
               firstname.includes(searchTerm) ||
               lastname.includes(searchTerm) ||
               phone.includes(searchTerm);
    });
    
    renderMembers(filteredMembers);
    
    // Update counts for filtered results, but keep TOTAL revenue
    const active = filteredMembers.filter(m => {
        const status = m.membership.status;
        const remainingDays = m.membership.remaining_days;
        return status === 'active' && remainingDays > 7;
    }).length;
    
    const expiring = filteredMembers.filter(m => {
        const status = m.membership.status;
        const remainingDays = m.membership.remaining_days;
        return status === 'active' && remainingDays <= 7 && remainingDays > 0;
    }).length;
    
    const expired = filteredMembers.filter(m => {
        const status = m.membership.status;
        const remainingDays = m.membership.remaining_days;
        return status === 'expired' || remainingDays <= 0;
    }).length;
    
    // Show filtered counts but keep TOTAL monthly revenue
    memberCount.textContent = filteredMembers.length;
    activeCount.textContent = active;
    expiringCount.textContent = expiring;
    expiredCount.textContent = expired;
    // revenueAmount stays with totalMonthlyRevenue - don't change it!
}

// Show QR Modal
function showQRModal(uid, name) {
    const largeQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${uid}`;
    currentLargeQR = largeQrUrl;
    
    modalQrContainer.innerHTML = `<img src="${largeQrUrl}" alt="QR Code for ${name}">`;
    modalMemberInfo.textContent = `${name} (UID: ${uid})`;
    qrModal.style.display = 'block';
}

// Open Renew Modal
function openRenewModal(memberKey, name) {
    currentRenewMember = memberKey;
    
    // Set up renew calculator
    renewPayment.value = 500;
    renewMonths.value = 1;
    updateRenewDisplay(1);
    
    renewModal.style.display = 'block';
}

// Update renew display
function updateRenewDisplay(months) {
    renewMonthsDisplay.textContent = months + ' month' + (months > 1 ? 's' : '');
    renewTotal.textContent = (months * 500).toLocaleString();
}

// Confirm renewal
confirmRenew.addEventListener('click', async function() {
    if (!currentRenewMember) return;
    
    const paymentAmount = parseInt(renewPayment.value) || 500;
    const selectedMonths = parseInt(renewMonths.value) || 1;
    
    try {
        // Calculate new dates
        const startDate = new Date();
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + selectedMonths);
        
        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];
        const remainingDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));

        await update(ref(db, `Customers/${currentRenewMember}/membership`), {
            status: "active",
            payment_amount: paymentAmount,
            months_paid: selectedMonths,
            start_date: startDateStr,
            end_date: endDateStr,
            remaining_days: remainingDays,
            last_updated: startDateStr
        });

        alert(`Membership renewed successfully!\nPayment: ₱${paymentAmount}\nDuration: ${selectedMonths} month(s)`);
        renewModal.style.display = 'none';
        currentRenewMember = null;
        
    } catch (error) {
        alert('Error renewing membership: ' + error.message);
    }
});

// Download QR Code
downloadQR.addEventListener('click', function() {
    if (!currentLargeQR) return;
    
    const link = document.createElement('a');
    const fileName = `member-qr-${modalMemberInfo.textContent.split('UID: ')[1] || 'unknown'}.png`;
    link.download = fileName;
    link.href = currentLargeQR;
    link.click();
});

// Close Modals
closeModal.addEventListener('click', function() {
    qrModal.style.display = 'none';
});

closeRenewModal.addEventListener('click', function() {
    renewModal.style.display = 'none';
    currentRenewMember = null;
});

window.addEventListener('click', function(event) {
    if (event.target === qrModal) {
        qrModal.style.display = 'none';
    }
    if (event.target === renewModal) {
        renewModal.style.display = 'none';
        currentRenewMember = null;
    }
});

// Renew calculator
renewPayment.addEventListener('input', function() {
    const payment = parseInt(this.value) || 0;
    const calculatedMonths = Math.floor(payment / 500);
    const maxMonths = 12;
    
    if (calculatedMonths > 0) {
        const months = Math.min(calculatedMonths, maxMonths);
        renewMonths.value = months;
        updateRenewDisplay(months);
    }
});

renewMonths.addEventListener('input', function() {
    const months = parseInt(this.value);
    updateRenewDisplay(months);
    
    // Auto-fill payment amount
    const paymentAmount = months * 500;
    renewPayment.value = paymentAmount;
});

// Delete member function
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

// Event Listeners
searchBtn.addEventListener('click', searchMembers);
searchInput.addEventListener('keyup', function(event) {
    if (event.key === 'Enter') {
        searchMembers();
    }
});

// Search as user types
searchInput.addEventListener('input', function() {
    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(searchMembers, 300);
});

// Clear search when clicking the X in search input
searchInput.addEventListener('search', function() {
    if (this.value === '') {
        searchMembers();
    }
});

// Make functions global for onclick attributes
window.showQRModal = showQRModal;
window.openRenewModal = openRenewModal;
window.deleteMember = deleteMember;

// Initialize renew calculator
updateRenewDisplay(1);
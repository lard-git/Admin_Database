import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getDatabase, ref, onValue, update, remove, get } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-database.js";

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

// Edit Modal Elements
const editModal = document.getElementById("editModal");
const closeEditModal = document.querySelector(".close-edit");
const editFirstName = document.getElementById("editFirstName");
const editLastName = document.getElementById("editLastName");
const editPhone = document.getElementById("editPhone");
const editUID = document.getElementById("editUID");
const editPayment = document.getElementById("editPayment");
const editMonths = document.getElementById("editMonths");
const editMonthsDisplay = document.getElementById("editMonthsDisplay");
const editSelectedMonths = document.getElementById("editSelectedMonths");
const editTotalAmount = document.getElementById("editTotalAmount");
const confirmEdit = document.getElementById("confirmEdit");

let allMembers = [];
let currentLargeQR = '';
let currentEditMember = null;
let totalMonthlyRevenue = 0;

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

function getActualRemainingDays(member) {
    if (!member.membership.end_date) return 0;
    
    const endDate = new Date(member.membership.end_date);
    const today = new Date();
    const remaining = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
    return Math.max(0, remaining);
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
        const remainingDays = getActualRemainingDays(member);
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
                    <button class="btn btn-edit" onclick="openEditModal('${member.key}', '${fullname.replace(/'/g, "\\'")}', '${member.uid}')">Edit/Extend</button>
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
    
    memberCount.textContent = filteredMembers.length;
    activeCount.textContent = active;
    expiringCount.textContent = expiring;
    expiredCount.textContent = expired;
}

// Show QR Modal
function showQRModal(uid, name) {
    const largeQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${uid}`;
    currentLargeQR = largeQrUrl;
    
    modalQrContainer.innerHTML = `<img src="${largeQrUrl}" alt="QR Code for ${name}">`;
    modalMemberInfo.textContent = `${name} (UID: ${uid})`;
    qrModal.style.display = 'block';
}

// Open Edit Modal with member data including current membership info
function openEditModal(memberKey, name, uid) {
    // Find the member data
    const member = allMembers.find(m => m.key === memberKey);
    if (!member) return;
    
    currentEditMember = member;
    
    // Fill the form with member data
    editFirstName.value = member.firstname || '';
    editLastName.value = member.lastname || '';
    editPhone.value = member.phone || '';
    editUID.value = member.uid || '';
    
    // Get current membership data
    const currentMembership = member.membership || {};
    const currentPayment = currentMembership.payment_amount || 0;
    const currentMonths = currentMembership.months_paid || 0;
    const currentDays = getActualRemainingDays(member);
    
    // Display current membership info
    document.getElementById('currentDaysDisplay').textContent = currentDays;
    document.getElementById('currentPaymentDisplay').textContent = currentPayment.toLocaleString();
    document.getElementById('currentMonthsDisplay').textContent = currentMonths;
    
    // Set up payment calculator for extension
    editPayment.value = 500;
    editMonths.value = 1;
    updateEditPaymentDisplay(1, currentPayment, currentMonths);
    
    editModal.style.display = 'block';
}

// Update edit payment display with extension calculations
function updateEditPaymentDisplay(months, currentPayment = 0, currentMonths = 0) {
    const additionalPayment = months * 500;
    const newTotalPayment = currentPayment + additionalPayment;
    const newTotalMonths = currentMonths + months;
    
    editMonthsDisplay.textContent = months + ' month' + (months > 1 ? 's' : '');
    editSelectedMonths.textContent = months;
    editTotalAmount.textContent = additionalPayment.toLocaleString();
    
    // Update the extension summary
    document.getElementById('newTotalPayment').textContent = newTotalPayment.toLocaleString();
    document.getElementById('newTotalMonths').textContent = newTotalMonths;
}

// Edit payment calculator - for extension
editPayment.addEventListener('input', function() {
    const payment = parseInt(this.value) || 0;
    const calculatedMonths = Math.floor(payment / 500);
    const maxMonths = 12;
    
    if (calculatedMonths > 0) {
        const months = Math.min(calculatedMonths, maxMonths);
        editMonths.value = months;
        
        // Get current membership data for calculations
        const currentMembership = currentEditMember?.membership || {};
        const currentPayment = currentMembership.payment_amount || 0;
        const currentMonths = currentMembership.months_paid || 0;
        
        updateEditPaymentDisplay(months, currentPayment, currentMonths);
    }
});

editMonths.addEventListener('input', function() {
    const months = parseInt(this.value);
    
    // Get current membership data for calculations
    const currentMembership = currentEditMember?.membership || {};
    const currentPayment = currentMembership.payment_amount || 0;
    const currentMonths = currentMembership.months_paid || 0;
    
    updateEditPaymentDisplay(months, currentPayment, currentMonths);
    
    // Auto-fill payment amount
    const paymentAmount = months * 500;
    editPayment.value = paymentAmount;
});

// Confirm Edit - Preserves existing membership and adds to it
confirmEdit.addEventListener('click', async function() {
    if (!currentEditMember) return;
    
    // Validate form
    if (!editFirstName.value.trim() || !editLastName.value.trim()) {
        alert("Please enter both first and last name");
        return;
    }
    
    if (!editPhone.value.trim()) {
        alert("Please enter mobile number");
        return;
    }

    if (!editPayment.value.trim() || parseInt(editPayment.value) < 500) {
        alert("Please enter payment amount (minimum ₱500)");
        return;
    }
    
    try {
        const newPaymentAmount = parseInt(editPayment.value) || 500;
        const newMonths = parseInt(editMonths.value) || 1;
        
        // Get current member data to calculate proper extension
        const memberRef = ref(db, `Customers/${currentEditMember.key}`);
        const snapshot = await get(memberRef);
        const memberData = snapshot.val();
        
        const currentMembership = memberData.membership || {};
        
        // Calculate new dates based on existing end date
        let currentEndDate;
        let currentRemainingDays = currentMembership.remaining_days || 0;
        
        if (currentMembership.end_date && currentRemainingDays > 0) {
            // Extend from existing end date
            currentEndDate = new Date(currentMembership.end_date);
        } else {
            // Start from today if expired
            currentEndDate = new Date();
            currentRemainingDays = 0;
        }
        
        // Calculate new end date by adding new months
        const newEndDate = new Date(currentEndDate);
        newEndDate.setMonth(newEndDate.getMonth() + newMonths);
        
        // Calculate total remaining days
        const totalRemainingDays = Math.ceil((newEndDate - new Date()) / (1000 * 60 * 60 * 24));
        
        // Calculate total months paid (current + new)
        const currentMonths = currentMembership.months_paid || 0;
        const totalMonths = currentMonths + newMonths;
        
        // Calculate total payment (current + new)
        const currentPayment = currentMembership.payment_amount || 0;
        const totalPayment = currentPayment + newPaymentAmount;

        await update(ref(db, `Customers/${currentEditMember.key}`), {
            "personal_info/firstname": editFirstName.value.trim(),
            "personal_info/lastname": editLastName.value.trim(),
            "personal_info/phone": editPhone.value.trim(),
            "membership/payment_amount": totalPayment,
            "membership/months_paid": totalMonths,
            "membership/start_date": currentMembership.start_date || new Date().toISOString().split('T')[0],
            "membership/end_date": newEndDate.toISOString().split('T')[0],
            "membership/remaining_days": totalRemainingDays,
            "membership/last_updated": new Date().toISOString().split('T')[0],
            "membership/status": "active"
        });

        alert(`Member Updated Successfully!\n\nPersonal info updated\nPayment added: ₱${newPaymentAmount}\nDuration added: ${newMonths} month(s)\nPrevious days: ${currentRemainingDays}\nNew total: ${totalRemainingDays} days remaining`);
        editModal.style.display = 'none';
        currentEditMember = null;
        
    } catch (error) {
        alert('Error updating member: ' + error.message);
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

// Close Modals
closeModal.addEventListener('click', function() {
    qrModal.style.display = 'none';
});

closeEditModal.addEventListener('click', function() {
    editModal.style.display = 'none';
    currentEditMember = null;
});

window.addEventListener('click', function(event) {
    if (event.target === qrModal) {
        qrModal.style.display = 'none';
    }
    if (event.target === editModal) {
        editModal.style.display = 'none';
        currentEditMember = null;
    }
});

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
window.openEditModal = openEditModal;
window.deleteMember = deleteMember;
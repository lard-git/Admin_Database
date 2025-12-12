import { db } from './database_init.js';
import { getDatabase, ref, set, get, update, remove, onValue} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-database.js";


//dom elem
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
let currentLargeQR = '';
let currentEditMember = null;
let totalMonthlyRevenue = 0;


document.addEventListener('DOMContentLoaded', function() {
    initEventListeners();
});
//modal
function initEventListeners() {
    
    if (closeModal) {
        closeModal.addEventListener('click', function() {
            if (qrModal) qrModal.style.display = 'none';
        });
    }
    
    const closeEditBtn = document.querySelector(".close-edit");
    if (closeEditBtn) {
        closeEditBtn.addEventListener('click', function() {
            if (editModal) editModal.style.display = 'none';
            currentEditMember = null;
        });
    }
    
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
    
    //closemodal
    window.addEventListener('click', function(event) {
        if (qrModal && event.target === qrModal) {
            qrModal.style.display = 'none';
        }
        if (editModal && event.target === editModal) {
            editModal.style.display = 'none';
            currentEditMember = null;
        }
    });
}

// edit price
function getCurrentEditPrice() {
    const editMembershipType = document.getElementById("editMembershipType");
    if (!editMembershipType || !editMembershipType.options) return 800;
    
    const selectedOption = editMembershipType.options[editMembershipType.selectedIndex];
    if (!selectedOption) return 800;
    
    return parseInt(selectedOption.getAttribute('data-price')) || 800;
}

//edit payment display 
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

//modallisterners
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
                const currentPayment = currentMembership.payment_amount || 0;
                const currentMonths = currentMembership.months_paid || 0;
                
                updateEditPaymentDisplay(months, currentPayment, currentMonths);
            }
        });
    }
    
    if (editMonths) {
        editMonths.addEventListener('input', function() {
            const months = parseInt(this.value);
            
           
            const currentMembership = currentEditMember?.membership || {};
            const currentPayment = currentMembership.payment_amount || 0;
            const currentMonths = currentMembership.months_paid || 0;
            
            updateEditPaymentDisplay(months, currentPayment, currentMonths);
            
            const currentPrice = getCurrentEditPrice();
            const paymentAmount = months * currentPrice;
            if (editPayment) editPayment.value = paymentAmount;
        });
    }
}

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
            membership: data.membership || {},
            personal_info: data.personal_info || {}
        };
        
        allMembers.push(member);
    });
    
    // monthlyrev
    totalMonthlyRevenue = allMembers.reduce((sum, m) => sum + (m.membership.payment_amount || 0), 0);
    
    updateSummaryCards(allMembers, totalMonthlyRevenue);
    renderMembers(allMembers);
});


function updateSummaryCards(members, revenue = totalMonthlyRevenue) {
    console.log("Updating summary cards with", members.length, "members");
    
    let active = 0;
    let expiring = 0;
    let expired = 0;
    
    members.forEach(m => {
        const status = m.membership?.status || 'active';
        const remainingDays = m.membership?.remaining_days;
        
     
        console.log(`Member: ${m.firstname} ${m.lastname}, Status: ${status}, Remaining Days: ${remainingDays}`);
        
     
        if (status === 'expired') {
            expired++;
            console.log(`  -> Counted as EXPIRED (status = expired)`);
        } 
        
        else if (remainingDays !== undefined) {
            if (remainingDays <= 0) {
                expired++;
                console.log(`  -> Counted as EXPIRED (remainingDays <= 0)`);
            } else if (remainingDays <= 7) {
                expiring++;
                console.log(`  -> Counted as EXPIRING (remainingDays <= 7)`);
            } else {
                active++;
                console.log(`  -> Counted as ACTIVE (remainingDays > 7)`);
            }
        } 
        
        else {
            active++;
            console.log(`  -> Counted as ACTIVE (no remainingDays info)`);
        }
    });
    
    console.log(`Final counts: Active=${active}, Expiring=${expiring}, Expired=${expired}`);
    
    if (memberCount) memberCount.textContent = members.length;
    if (activeCount) activeCount.textContent = active;
    if (expiringCount) expiringCount.textContent = expiring;
    if (expiredCount) expiredCount.textContent = expired;
    if (revenueAmount) revenueAmount.textContent = revenue.toLocaleString();
}

function getActualRemainingDays(member) {
    
    if (member.membership?.status === 'expired') {
        return 0;
    }
    
    if (!member.membership?.end_date) {
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
    
    //fill form with mem data
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
    
    //current mem data
    const currentMembership = member.membership || {};
    const currentPayment = currentMembership.payment_amount || 0;
    const currentMonths = currentMembership.months_paid || 0;
    const currentDays = getActualRemainingDays(member);
    const currentType = currentMembership.plan || member.personal_info?.membership_type || 'regular';
    const currentTypeDisplay = currentMembership.plan_display || 
                              (currentType === 'student' ? 'Student' : 'Regular');
    const currentMonthlyRate = currentMembership.monthly_rate || 
                             (currentType === 'student' ? 600 : 800);
    
    //displaymeminfo
    const currentTypeDisplayEl = document.getElementById('currentMembershipTypeDisplay');
    const currentRateDisplayEl = document.getElementById('currentMonthlyRateDisplay');
    const currentDaysDisplayEl = document.getElementById('currentDaysDisplay');
    const currentPaymentDisplayEl = document.getElementById('currentPaymentDisplay');
    const currentMonthsDisplayEl = document.getElementById('currentMonthsDisplay');
    
    if (currentTypeDisplayEl) currentTypeDisplayEl.textContent = currentTypeDisplay;
    if (currentRateDisplayEl) currentRateDisplayEl.textContent = currentMonthlyRate;
    if (currentDaysDisplayEl) currentDaysDisplayEl.textContent = currentDays;
    if (currentPaymentDisplayEl) currentPaymentDisplayEl.textContent = currentPayment.toLocaleString();
    if (currentMonthsDisplayEl) currentMonthsDisplayEl.textContent = currentMonths;
    
    
    if (editMembershipType) {
        editMembershipType.value = currentType;
        
        
        setTimeout(() => {
            const event = new Event('change');
            editMembershipType.dispatchEvent(event);
        }, 100);
    }
    
    if (editPayment) editPayment.value = currentMonthlyRate;
    if (editMonths) editMonths.value = 1;
    updateEditPaymentDisplay(1, currentPayment, currentMonths);
    
    if (editModal) editModal.style.display = 'block';
}

//edit
async function handleConfirmEdit() {
    if (!currentEditMember) return;
    
    
    const editFirstName = document.getElementById("editFirstName");
    const editLastName = document.getElementById("editLastName");
    const editPhone = document.getElementById("editPhone");
    const editPayment = document.getElementById("editPayment");
    const editMonths = document.getElementById("editMonths");
    const editMembershipType = document.getElementById("editMembershipType");
    
    
    if (!editFirstName || !editFirstName.value.trim() || !editLastName || !editLastName.value.trim()) {
        alert("Please enter both first and last name");
        return;
    }
    
    if (!editPhone || !editPhone.value.trim()) {
        alert("Please enter mobile number");
        return;
    }

    const currentPrice = getCurrentEditPrice();
    if (!editPayment || !editPayment.value.trim() || parseInt(editPayment.value) < currentPrice) {
        alert(`Please enter payment amount (minimum ₱${currentPrice})`);
        return;
    }
    // calculation for renew?/edit
    try {
        const newPaymentAmount = parseInt(editPayment.value) || currentPrice;
        const newMonths = parseInt(editMonths.value) || 1;
        const extensionType = editMembershipType ? editMembershipType.value : 'regular';
        const extensionTypeText = editMembershipType ? editMembershipType.options[editMembershipType.selectedIndex].text.split(' - ')[0] : 'Regular';
        
        
        const memberRef = ref(db, `Customers/${currentEditMember.key}`);
        const snapshot = await get(memberRef);
        const memberData = snapshot.val();
        
        const currentMembership = memberData.membership || {};
        
        
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
        
        // Update membership type if changed
        const newMonthlyRate = getCurrentEditPrice();
        const newPlan = extensionType;
        const newPlanDisplay = extensionTypeText;

        await update(ref(db, `Customers/${currentEditMember.key}`), {
            "personal_info/firstname": editFirstName.value.trim(),
            "personal_info/lastname": editLastName.value.trim(),
            "personal_info/phone": editPhone.value.trim(),
            "personal_info/membership_type": newPlan,
            
            "membership/plan": newPlan,
            "membership/plan_display": newPlanDisplay,
            "membership/monthly_rate": newMonthlyRate,
            "membership/payment_amount": totalPayment,
            "membership/months_paid": totalMonths,
            "membership/start_date": currentMembership.start_date || new Date().toISOString().split('T')[0],
            "membership/end_date": newEndDate.toISOString().split('T')[0],
            "membership/remaining_days": totalRemainingDays,
            "membership/last_updated": new Date().toISOString().split('T')[0],
            "membership/status": "active"
        });

        alert(`Member Updated Successfully!\n\nPersonal info updated\nNew Membership Type: ${newPlanDisplay}\nMonthly Rate: ₱${newMonthlyRate}\nPayment added: ₱${newPaymentAmount}\nDuration added: ${newMonths} month(s)\nPrevious days: ${currentRemainingDays}\nNew total: ${totalRemainingDays} days remaining`);
        if (editModal) editModal.style.display = 'none';
        currentEditMember = null;
        
    } catch (error) {
        alert('Error updating member: ' + error.message);
    }
}

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
    
    if (memberCount) memberCount.textContent = filteredMembers.length;
    if (activeCount) activeCount.textContent = active;
    if (expiringCount) expiringCount.textContent = expiring;
    if (expiredCount) expiredCount.textContent = expired;
}

window.showQRModal = showQRModal;
window.openEditModal = openEditModal;
window.deleteMember = deleteMember;

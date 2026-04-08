import { db } from './database_init.js';
import { ref, set, get, update, remove } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-database.js";

const FnameInp = document.getElementById("FnameInp");
const LnameInp = document.getElementById("LnameInp");
const MobileInp = document.getElementById("MobileInp");
const UidInp = document.getElementById("UidInp");
const PaymentInp = document.getElementById("PaymentInp");
const MonthsSlider = document.getElementById("MonthsSlider");
const MonthsDisplay = document.getElementById("monthsDisplay");
const SelectedMonthsSpan = document.getElementById("selectedMonths");
const TotalAmountSpan = document.getElementById("totalAmount");
const qrImg = document.getElementById("qrImg");

function updatePaymentDisplay(months) {
    const currentPrice = getCurrentPrice();
    MonthsDisplay.textContent = months + ' month' + (months > 1 ? 's' : '');
    SelectedMonthsSpan.textContent = months;
    TotalAmountSpan.textContent = (months * currentPrice).toLocaleString();
}

function getCurrentPrice() {
    const membershipTypeSelect = document.getElementById('membershipType');
    const selectedOption = membershipTypeSelect.options[membershipTypeSelect.selectedIndex];
    return parseInt(selectedOption.getAttribute('data-price'));
}

function initializePaymentCalculator() {
    const membershipTypeSelect = document.getElementById('membershipType');
    const monthlyRateDisplay = document.getElementById('monthlyRateDisplay');
    const membershipTypeDisplay = document.getElementById('membershipTypeDisplay');

    membershipTypeSelect.addEventListener('change', function() {
        const selectedOption = this.options[this.selectedIndex];
        const price = selectedOption.getAttribute('data-price');
        const typeText = selectedOption.text.split(' - ')[0];

        monthlyRateDisplay.textContent = price;
        membershipTypeDisplay.textContent = typeText;

        PaymentInp.min = price;
        PaymentInp.step = price;
        PaymentInp.placeholder = `${price} per month`;

        const months = parseInt(MonthsSlider.value);
        updatePaymentDisplay(months);
    });

    PaymentInp.addEventListener('input', function() {
        const payment = parseInt(this.value) || 0;
        const currentPrice = getCurrentPrice();
        const calculatedMonths = Math.floor(payment / currentPrice);
        const maxMonths = 12;

        if (calculatedMonths > 0) {
            const months = Math.min(calculatedMonths, maxMonths);
            MonthsSlider.value = months;
            updatePaymentDisplay(months);
        }
    });

    MonthsSlider.addEventListener('input', function() {
        const months = parseInt(this.value);
        updatePaymentDisplay(months);

        const currentPrice = getCurrentPrice();
        const paymentAmount = months * currentPrice;
        PaymentInp.value = paymentAmount;
    });

    updatePaymentDisplay(1);
}

function validateForm() {
    if (!FnameInp.value.trim() || !LnameInp.value.trim()) {
        alert("Please enter both first and last name");
        return false;
    }

    const phone = MobileInp.value.trim();
    if (!phone) {
        alert("Please enter mobile number");
        return false;
    }
    if (!/^\d{11}$/.test(phone)) {
        alert("Mobile number must be exactly 11 digits (numbers only)");
        MobileInp.focus();
        return false;
    }

    const currentPrice = getCurrentPrice();
    if (!PaymentInp.value.trim() || parseInt(PaymentInp.value) < currentPrice) {
        alert(`Please enter payment amount (minimum ₱${currentPrice})`);
        return false;
    }

    return true;
}

function clearForm() {
    FnameInp.value = "";
    LnameInp.value = "";
    MobileInp.value = "";
    UidInp.value = "";
    PaymentInp.value = "";
    MonthsSlider.value = "1";
    updatePaymentDisplay(1);
    qrImg.src = "";
    qrImg.alt = "QR Code will appear here";
}

function random8Digit() {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
}

async function generateUniqueUID() {
    for (let i = 0; i < 5; i++) {
        const candidate = random8Digit();
        const exists = await get(ref(db, "Customers/" + candidate));
        if (!exists.exists()) return candidate;
    }
    throw new Error("Could not generate unique UID");
}

function generateQR(uid) {
    const payload = encodeURIComponent(uid);
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${payload}`;
    qrImg.alt = `QR Code for Member ID: ${uid}`;
}

async function AddData() {
    if (!validateForm()) return;

    const addBtn = document.getElementById("AddBtn");
    addBtn.disabled = true;
    addBtn.textContent = "Adding...";

    try {
        const newUID = await generateUniqueUID();
        UidInp.value = newUID;

        const paymentAmount = parseInt(PaymentInp.value) || getCurrentPrice();
        const selectedMonths = parseInt(MonthsSlider.value) || 1;
        const membershipType = document.getElementById('membershipType').value;
        const membershipTypeText = document.getElementById('membershipType').options[document.getElementById('membershipType').selectedIndex].text.split(' - ')[0];

        const startDate = new Date();
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + selectedMonths);

        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];
        const remainingDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));

        await set(ref(db, "Customers/" + newUID), {
            personal_info: {
                firstname: FnameInp.value.trim(),
                lastname: LnameInp.value.trim(),
                phone: MobileInp.value.trim(),
                membership_type: membershipType
            },
            membership: {
                status: "active",
                plan: membershipType,
                plan_display: membershipTypeText,
                monthly_rate: getCurrentPrice(),
                payment_amount: paymentAmount,
                months_paid: selectedMonths,
                start_date: startDateStr,
                end_date: endDateStr,
                remaining_days: remainingDays,
                last_updated: startDateStr
            },
            gym_data: {
                uid: Number(newUID),
                is_checked_in: false,
                total_visits: 0,
                total_time_spent: 0
            },
            attendance_history: []
        });

        alert(`Member Added Successfully!\nType: ${membershipTypeText}\nMonthly Rate: ₱${getCurrentPrice()}\nPayment: ₱${paymentAmount}\nDuration: ${selectedMonths} month(s)\nRemaining Days: ${remainingDays}`);
        generateQR(newUID);

    } catch (err) {
        alert("Error adding member: " + err.message);
    } finally {
        addBtn.disabled = false;
        addBtn.textContent = "Add Member";
    }
}

async function ReadData() {
    if (!UidInp.value.trim()) {
        alert("Please enter a UID to find member");
        return;
    }

    try {
        const snap = await get(ref(db, "Customers/" + UidInp.value));
        if (!snap.exists()) {
            alert("No Member Found with this UID");
            return;
        }

        const data = snap.val();

        FnameInp.value = data.personal_info?.firstname || "";
        LnameInp.value = data.personal_info?.lastname || "";
        MobileInp.value = data.personal_info?.phone || "";

        if (data.membership) {
            PaymentInp.value = data.membership.payment_amount || 500;
            const months = data.membership.months_paid || 1;
            MonthsSlider.value = months;
            updatePaymentDisplay(months);
        }

        generateQR(UidInp.value);
        alert("Member data loaded successfully!");
    } catch (err) {
        alert("Error finding member: " + err.message);
    }
}

async function UpdateData() {
    if (!UidInp.value.trim()) {
        alert("Please enter a UID to update member");
        return;
    }

    if (!validateForm()) return;

    try {
        const paymentAmount = parseInt(PaymentInp.value) || 500;
        const selectedMonths = parseInt(MonthsSlider.value) || 1;

        const startDate = new Date();
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + selectedMonths);

        const startDateStr = startDate.toISOString().split('T')[0];
        const endDateStr = endDate.toISOString().split('T')[0];
        const remainingDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));

        await update(ref(db, "Customers/" + UidInp.value), {
            "personal_info/firstname": FnameInp.value.trim(),
            "personal_info/lastname": LnameInp.value.trim(),
            "personal_info/phone": MobileInp.value.trim(),
            "membership/payment_amount": paymentAmount,
            "membership/months_paid": selectedMonths,
            "membership/start_date": startDateStr,
            "membership/end_date": endDateStr,
            "membership/remaining_days": remainingDays,
            "membership/last_updated": startDateStr
        });

        alert(`Member Updated Successfully!\nPayment: ₱${paymentAmount}\nDuration: ${selectedMonths} month(s)\nRemaining Days: ${remainingDays}`);
        generateQR(UidInp.value);
    } catch (err) {
        alert("Error updating member: " + err.message);
    }
}

async function DeleteData() {
    if (!UidInp.value.trim()) {
        alert("Please enter a UID to delete member");
        return;
    }

    if (!confirm("Are you sure you want to delete this member? This action cannot be undone.")) {
        return;
    }

    try {
        await remove(ref(db, "Customers/" + UidInp.value));
        alert("Member Deleted Successfully!");
        clearForm();
    } catch (err) {
        alert("Error deleting member: " + err.message);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    initializePaymentCalculator();

    document.getElementById("AddBtn").onclick = AddData;

    const readBtn = document.getElementById("ReadBtn");
    const updateBtn = document.getElementById("UpdateBtn");
    const deleteBtn = document.getElementById("DeleteBtn");
    if (readBtn) readBtn.onclick = ReadData;
    if (updateBtn) updateBtn.onclick = UpdateData;
    if (deleteBtn) deleteBtn.onclick = DeleteData;

    [FnameInp, LnameInp, MobileInp, UidInp, PaymentInp].forEach(input => {
        if (!input) return;
        input.addEventListener("keypress", function(event) {
            if (event.key === "Enter") {
                event.preventDefault();
                AddData();
            }
        });
    });
});

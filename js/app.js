import { db } from './database_init.js';
import { ref, set, get } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-database.js";

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
const FbNameInp = document.getElementById("FbNameInp");
const GenderInp = document.getElementById("GenderInp");
const AgeInp = document.getElementById("AgeInp");
const AddressInp = document.getElementById("AddressInp");

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
        alert("Please enter cellphone number");
        return false;
    }
    if (!/^\d{11}$/.test(phone)) {
        alert("Cellphone number must be exactly 11 digits (numbers only)");
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
                membership_type: membershipType,
                fb_name: FbNameInp?.value.trim() || "",
                gender: GenderInp?.value || "",
                age: AgeInp?.value ? parseInt(AgeInp.value) : "",
                home_address: AddressInp?.value.trim() || ""
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

document.addEventListener('DOMContentLoaded', function() {
    initializePaymentCalculator();

    document.getElementById("AddBtn").onclick = AddData;

    [FnameInp, LnameInp, MobileInp, UidInp, PaymentInp, FbNameInp, AgeInp, AddressInp].forEach(input => {
        if (!input) return;
        input.addEventListener("keypress", function(event) {
            if (event.key === "Enter") {
                event.preventDefault();
                AddData();
            }
        });
    });
});

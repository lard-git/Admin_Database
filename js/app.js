
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getDatabase, ref, set, get, update, remove } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-database.js";

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
const db = getDatabase();

//dom elem
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

//payment
function initializePaymentCalculator() {
    const membershipTypeSelect = document.getElementById('membershipType');
    const monthlyRateDisplay = document.getElementById('monthlyRateDisplay');
    const membershipTypeDisplay = document.getElementById('membershipTypeDisplay');
    
    
    function getCurrentPrice() {
        const selectedOption = membershipTypeSelect.options[membershipTypeSelect.selectedIndex];
        return parseInt(selectedOption.getAttribute('data-price'));
    }
    
    // student/normal
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
    
    //months based on payment
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
    
    if (!MobileInp.value.trim()) {
        alert("Please enter mobile number");
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

//crud
async function AddData() {
    if (!validateForm()) return;
    
    try {
        const newUID = await generateUniqueUID();
        UidInp.value = newUID;

        const paymentAmount = parseInt(PaymentInp.value) || getCurrentPrice();
        const selectedMonths = parseInt(MonthsSlider.value) || 1;
        const membershipType = document.getElementById('membershipType').value;
        const membershipTypeText = document.getElementById('membershipType').options[document.getElementById('membershipType').selectedIndex].text.split(' - ')[0];
        
       //date
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
        
        //payment data
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
        
        //dates
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

//intialization
document.addEventListener('DOMContentLoaded', function() {
    
    initializePaymentCalculator();
    
    document.getElementById("AddBtn").onclick = AddData;
    document.getElementById("ReadBtn").onclick = ReadData;
    document.getElementById("UpdateBtn").onclick = UpdateData;
    document.getElementById("DeleteBtn").onclick = DeleteData;

    [FnameInp, LnameInp, MobileInp, UidInp, PaymentInp].forEach(input => {
        input.addEventListener("keypress", function(event) {
            if (event.key === "Enter") {
                event.preventDefault();
                AddData();
            }
        });
    });
});
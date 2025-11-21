// ------------------ Firebase Setup ------------------

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getDatabase, ref, child, set, get, update, remove } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-database.js";

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


// ------------------ DOM ELEMENTS ------------------

const FnameInp = document.getElementById("FnameInp");
const LnameInp = document.getElementById("LnameInp");
const MobileInp = document.getElementById("MobileInp");
const UidInp = document.getElementById("UidInp");
const qrImg = document.getElementById("qrImg");


// ------------------ UID GENERATION ------------------

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


// ------------------ QR CODE ------------------

function generateQR(uid) {
    const payload = encodeURIComponent(uid);
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${payload}`;
    qrImg.alt = `QR for ${uid}`;
}


// ------------------ CRUD OPERATIONS ------------------

async function AddData() {
    try {
        const newUID = await generateUniqueUID();
        UidInp.value = newUID;

        await set(ref(db, "Customers/" + newUID), {
            nameofcustomer: {
                firstname: FnameInp.value,
                lastname: LnameInp.value
            },
            mobile: MobileInp.value,
            uid: Number(newUID)
        });

        alert("Data Added Successfully!");
        generateQR(newUID);

    } catch (err) {
        alert("Error: " + err);
    }
}

async function ReadData() {
    const snap = await get(ref(db, "Customers/" + UidInp.value));
    if (!snap.exists()) {
        alert("No Data Found");
        return;
    }

    const data = snap.val();
    FnameInp.value = data.nameofcustomer.firstname;
    LnameInp.value = data.nameofcustomer.lastname;
    MobileInp.value = data.mobile;

    generateQR(UidInp.value);
}

async function UpdateData() {
    await update(ref(db, "Customers/" + UidInp.value), {
        nameofcustomer: {
            firstname: FnameInp.value,
            lastname: LnameInp.value
        },
        mobile: MobileInp.value
    });

    alert("Data Updated!");
}

async function DeleteData() {
    await remove(ref(db, "Customers/" + UidInp.value));
    alert("Data Deleted!");
}


// ------------------ BUTTON EVENTS ------------------

document.getElementById("AddBtn").onclick = AddData;
document.getElementById("ReadBtn").onclick = ReadData;
document.getElementById("UpdateBtn").onclick = UpdateData;
document.getElementById("DeleteBtn").onclick = DeleteData;

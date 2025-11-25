import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getDatabase, ref, onValue, remove } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-database.js";

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
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const qrModal = document.getElementById("qrModal");
const modalQrContainer = document.getElementById("modalQrContainer");
const modalMemberInfo = document.getElementById("modalMemberInfo");
const closeModal = document.querySelector(".close");
const downloadQR = document.getElementById("downloadQR");

let allMembers = [];
let currentLargeQR = '';

// Realtime listener
onValue(customersRef, (snapshot) => {
    allMembers = [];
    tableBody.innerHTML = "";
    
    if (!snapshot.exists()) {
        emptyState.style.display = 'block';
        memberCount.textContent = '0';
        return;
    }
    
    emptyState.style.display = 'none';
    
    snapshot.forEach(child => {
        const data = child.val();
        const member = {
            uid: data.uid?.toString() || "",
            firstname: data.nameofcustomer?.firstname || "",
            lastname: data.nameofcustomer?.lastname || "",
            phone: data.mobile || "",
            joinDate: data.joinDate || "N/A",
            key: child.key // Firebase key as backup
        };
        
        allMembers.push(member);
    });
    
    memberCount.textContent = allMembers.length.toString();
    renderMembers(allMembers);
});

// Render members to table
function renderMembers(members) {
    tableBody.innerHTML = "";
    
    if (members.length === 0) {
        emptyState.style.display = 'block';
        memberCount.textContent = '0';
        return;
    }
    
    emptyState.style.display = 'none';
    memberCount.textContent = members.length.toString();
    
    members.forEach(member => {
        const fullname = `${member.firstname} ${member.lastname}`;
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${member.uid}`;
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${member.uid}</strong></td>
            <td>${fullname}</td>
            <td>${member.phone}</td>
            <td>${member.joinDate}</td>
            <td>
                <img src="${qrUrl}" class="qr-small" alt="QR Code" 
                     onclick="showQRModal('${member.uid}', '${fullname.replace(/'/g, "\\'")}')">
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-view" onclick="viewMember('${member.uid}')">View</button>
                    <button class="btn btn-edit" onclick="editMember('${member.uid}')">Edit</button>
                    <button class="btn btn-delete" onclick="deleteMember('${member.uid}', '${fullname.replace(/'/g, "\\'")}')">Delete</button>
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
        return;
    }
    
    const filteredMembers = allMembers.filter(member => {
        const fullName = `${member.firstname} ${member.lastname}`.toLowerCase();
        const uid = member.uid.toLowerCase();
        const phone = member.phone.toLowerCase();
        
        return uid.includes(searchTerm) ||
               fullName.includes(searchTerm) ||
               member.firstname.toLowerCase().includes(searchTerm) ||
               member.lastname.toLowerCase().includes(searchTerm) ||
               phone.includes(searchTerm);
    });
    
    renderMembers(filteredMembers);
}

// Show QR Modal
function showQRModal(uid, name) {
    const largeQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${uid}`;
    currentLargeQR = largeQrUrl;
    
    modalQrContainer.innerHTML = `<img src="${largeQrUrl}" alt="QR Code for ${name}">`;
    modalMemberInfo.textContent = `${name} (UID: ${uid})`;
    qrModal.style.display = 'block';
}

// Download QR Code
downloadQR.addEventListener('click', function() {
    if (!currentLargeQR) return;
    
    const link = document.createElement('a');
    const fileName = `member-qr-${modalMemberInfo.textContent.split('UID: ')[1] || 'unknown'}.png`;
    link.download = fileName;
    link.href = currentLargeQR;
    link.click();
});

// Close Modal
closeModal.addEventListener('click', function() {
    qrModal.style.display = 'none';
});

window.addEventListener('click', function(event) {
    if (event.target === qrModal) {
        qrModal.style.display = 'none';
    }
});

// Action functions
function viewMember(uid) {
    const member = allMembers.find(m => m.uid === uid);
    if (member) {
        const fullName = `${member.firstname} ${member.lastname}`;
        alert(`Member Details:\n\nName: ${fullName}\nUID: ${member.uid}\nPhone: ${member.phone}\nJoin Date: ${member.joinDate}`);
    }
}

function editMember(uid) {
    // Redirect to edit page 
    window.location.href = `firebase-crud.html?edit=${uid}`;
}

function deleteMember(uid, name) {
    if (confirm(`Are you sure you want to delete member: ${name} (${uid})?\nThis action cannot be undone.`)) {
        const memberRef = ref(db, `Customers/${uid}`);
        remove(memberRef)
            .then(() => {
                alert('Member deleted successfully!');
            })
            .catch(error => {
                alert('Error deleting member: ' + error.message);
            });
    }
}


searchBtn.addEventListener('click', searchMembers);

searchInput.addEventListener('keyup', function(event) {
    if (event.key === 'Enter') {
        searchMembers();
    }
});


// Clear search when clicking the X 
searchInput.addEventListener('search', function() {
    if (this.value === '') {
        searchMembers();
    }
});

// Make functions global for onclick attributes
window.showQRModal = showQRModal;
window.viewMember = viewMember;
window.editMember = editMember;
window.deleteMember = deleteMember;


console.log('Search functionality loaded successfully');
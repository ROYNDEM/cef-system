// Initialize Firebase (auto-configured from __/firebase/init.js)
let db, auth;

function initApp() {
    db = firebase.firestore();
    auth = firebase.auth();

    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        try {
            db.settings({ host: "127.0.0.1:8081", ssl: false });
            if (auth && typeof auth.useEmulator === 'function') {
                auth.useEmulator('http://127.0.0.1:9099/');
            }
            console.log('✓ Connected to local Firebase emulators');
        } catch (e) {
            console.warn('Could not connect to emulators:', e);
        }
    }

    const form = document.getElementById('form');
    if (form) {
        form.addEventListener('submit', handleRegistration);
    }

    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        loginBtn.addEventListener('click', handleAdminLogin);
    }

    if (auth) {
        auth.onAuthStateChanged(user => {
            const dashboard = document.getElementById('dashboard');
            if (!dashboard) return;
            if (user) {
                document.getElementById('loginForm').style.display = 'none';
                document.getElementById('logoutBtn').style.display = 'inline-block';
                dashboard.style.display = 'block';
                loadUsers();
            } else {
                document.getElementById('loginForm').style.display = 'block';
                document.getElementById('logoutBtn').style.display = 'none';
                dashboard.style.display = 'none';
            }
        });
    }
}

function waitForFirebase(retries = 20) {
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        initApp();
    } else if (retries > 0) {
        setTimeout(() => waitForFirebase(retries - 1), 100);
    } else {
        console.error('Firebase failed to initialize.');
    }
}

document.addEventListener('DOMContentLoaded', () => waitForFirebase());

// ===== ACCESSIBILITY TOGGLE =====
function toggleAccessibility(show) {
    document.getElementById('accessibilityDetails').style.display = show ? 'block' : 'none';
}

// ===== REGISTRATION FORM HANDLER =====
async function handleRegistration(e) {
    e.preventDefault();

    const name         = document.getElementById('name').value.trim();
    const idNumber     = document.getElementById('idNumber').value.trim();
    const phone        = document.getElementById('phone').value.trim();
    const email        = document.getElementById('email').value.trim();
    const organization = document.getElementById('organization').value.trim();
    const designation  = document.getElementById('designation').value.trim();
    const county       = document.getElementById('county').value.trim();
    const category     = document.getElementById('category').value;
    const specialRequests = document.getElementById('specialRequests').value || '';
    const consent      = document.getElementById('consent').checked;

    // Collect accessibility needs
    const accessibilityNeeds = [];
    document.querySelectorAll('input[name="accessibility"]:checked').forEach(cb => {
        accessibilityNeeds.push(cb.value);
    });

    // Show loading state
    document.getElementById('loading').style.display = 'block';
    document.getElementById('errorMessage').style.display = 'none';

    try {
        if (!name || !idNumber || !phone || !email || !organization || !designation || !county || !category) {
            throw new Error('Please fill in all required fields.');
        }
        if (!consent) {
            throw new Error('You must consent to data usage to complete registration.');
        }

        const docRef = await db.collection('registrations').add({
            name, idNumber, phone, email,
            organization, designation, county, category,
            accessibilityNeeds, specialRequests,
            consent: true,
            status: 'pending',
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        const registrationId = docRef.id;
        console.log('✓ Registration saved:', registrationId);

        generateQRCode(registrationId, name, email);

        document.getElementById('registrationForm').style.display = 'none';
        document.getElementById('successMessage').style.display = 'block';
        document.getElementById('registrationId').textContent = `Registration ID: ${registrationId}`;

    } catch (error) {
        console.error('Registration error:', error);
        document.getElementById('errorMessage').textContent = `Error: ${error.message}`;
        document.getElementById('errorMessage').style.display = 'block';
    } finally {
        document.getElementById('loading').style.display = 'none';
    }
}

// ===== QR CODE GENERATION =====
function generateQRCode(registrationId, name, email) {
    const container = document.getElementById('qrCodeContainer');
    container.innerHTML = ''; // Clear previous

    // QR code data: combine registration ID with participant info
    const qrData = JSON.stringify({
        id: registrationId,
        name: name,
        email: email,
        timestamp: new Date().toISOString()
    });

    // Generate QR code
    new QRCode(container, {
        text: qrData,
        width: 300,
        height: 300,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
    });
}

// ===== ADMIN LOGIN =====
async function handleAdminLogin() {
    const email = document.getElementById('adminEmail').value;
    const password = document.getElementById('adminPassword').value;

    try {
        if (!email || !password) {
            throw new Error('Please enter email and password.');
        }
        
        await auth.signInWithEmailAndPassword(email, password);
        console.log('✓ Admin logged in');
    } catch (error) {
        console.error('Login error:', error);
        alert(`Login failed: ${error.message}`);
    }
}

// ===== ADMIN DASHBOARD =====
let allRegistrations = [];

function loadUsers() {
    db.collection('registrations').orderBy('timestamp', 'desc').onSnapshot(snapshot => {
        allRegistrations = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        updateStats();
        renderTable();
    }, err => console.error('Snapshot error:', err));
}

function updateStats() {
    const r = allRegistrations;
    document.getElementById('statTotal').textContent    = r.length;
    document.getElementById('statPending').textContent  = r.filter(x => x.status === 'pending').length;
    document.getElementById('statApproved').textContent = r.filter(x => x.status === 'approved').length;
    document.getElementById('statCheckedIn').textContent= r.filter(x => x.status === 'checked-in').length;
    document.getElementById('statVVIP').textContent     = r.filter(x => x.category === 'VVIP').length;
    document.getElementById('statVIP').textContent      = r.filter(x => x.category === 'VIP').length;
    document.getElementById('statDelegate').textContent = r.filter(x => x.category === 'Delegate').length;
    document.getElementById('statMedia').textContent    = r.filter(x => x.category === 'Media').length;
}

function renderTable() {
    const search   = (document.getElementById('searchInput')?.value || '').toLowerCase();
    const catFilter= document.getElementById('filterCategory')?.value || '';
    const stFilter = document.getElementById('filterStatus')?.value || '';

    const filtered = allRegistrations.filter(r => {
        const matchSearch = !search ||
            (r.name||'').toLowerCase().includes(search) ||
            (r.email||'').toLowerCase().includes(search) ||
            (r.organization||'').toLowerCase().includes(search);
        const matchCat = !catFilter || r.category === catFilter;
        const matchSt  = !stFilter  || r.status   === stFilter;
        return matchSearch && matchCat && matchSt;
    });

    const tbody = document.getElementById('regBody');
    const empty = document.getElementById('emptyMsg');
    tbody.innerHTML = '';

    if (!filtered.length) { empty.style.display = 'block'; return; }
    empty.style.display = 'none';

    const categories = ['VVIP','VIP','Delegate','Media','Staff'];

    filtered.forEach(reg => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${reg.name || ''}</td>
            <td>${reg.email || ''}</td>
            <td>${reg.organization || ''}</td>
            <td>
                <select class="cat-select" data-id="${reg.id}">
                    ${categories.map(c => `<option${c===reg.category?' selected':''}>${c}</option>`).join('')}
                </select>
            </td>
            <td><span class="status-badge status-${reg.status}">${reg.status}</span></td>
            <td class="action-btns">
                <button class="btn-approve" onclick="updateRegistration('${reg.id}',{status:'approved'})">Approve</button>
                <button class="btn-reject"  onclick="updateRegistration('${reg.id}',{status:'rejected'})">Reject</button>
            </td>`;
        tbody.appendChild(tr);
    });

    // Category change handler
    tbody.querySelectorAll('.cat-select').forEach(sel => {
        sel.addEventListener('change', e => {
            updateRegistration(e.target.dataset.id, { category: e.target.value });
        });
    });
}

async function updateRegistration(id, updates) {
    try {
        await db.collection('registrations').doc(id).update(updates);
    } catch (err) {
        console.error('Update failed:', err);
        alert('Update failed: ' + err.message);
    }
}
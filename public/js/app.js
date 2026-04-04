// Initialize Firebase (auto-configured from __/firebase/init.js)
let db, auth;

// ===== EMAILJS CONFIG =====
const EMAILJS_SERVICE_ID       = 'service_gx0vptr';
const EMAILJS_TEMPLATE_QR      = 'cef_template';      // approval email with QR code
const EMAILJS_TEMPLATE_PENDING = 'template_62q3sqm';  // registration received email
const EMAILJS_PUBLIC_KEY       = 'haR-RzgiFMa4hA3rn';

// ===== ADMIN EMAIL WHITELIST =====
// Add every authorised admin and usher email here
const ADMIN_EMAILS = [
    'admin@cef.go.ke',
    'secretariat@cef.go.ke',
    'countyenergyforum@gmail.com'
];

function initApp() {
    db = firebase.firestore();
    auth = firebase.auth();

    // Initialise EmailJS with your public key
    if (typeof emailjs !== 'undefined') {
        emailjs.init(EMAILJS_PUBLIC_KEY);
    }

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
            if (user && ADMIN_EMAILS.includes(user.email)) {
                document.getElementById('loginForm').style.display = 'none';
                document.getElementById('logoutBtn').style.display = 'inline-block';
                dashboard.style.display = 'block';
                loadUsers();
            } else if (user) {
                // Logged in but not authorised
                auth.signOut();
                document.getElementById('loginError').textContent = 'Unauthorised. Contact the system administrator.';
                document.getElementById('loginError').style.display = 'block';
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
    const submitBtn = document.querySelector('#form button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';
    document.getElementById('loading').style.display = 'block';
    document.getElementById('errorMessage').style.display = 'none';

    try {
        if (!name || !idNumber || !phone || !email || !organization || !designation || !county) {
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

        generateQRCode(registrationId);

        // Send pending confirmation — QR will be sent after admin approval
        await sendPendingEmail({ name, email, registrationId });

        document.getElementById('registrationForm').style.display = 'none';
        document.getElementById('successMessage').style.display = 'block';
        document.getElementById('registrationId').textContent = `Registration ID: ${registrationId}`;

    } catch (error) {
        console.error('Registration error:', error);
        document.getElementById('errorMessage').textContent = `Error: ${error.message}`;
        document.getElementById('errorMessage').style.display = 'block';
    } finally {
        document.getElementById('loading').style.display = 'none';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Register Now';
    }
}

// ===== QR CODE GENERATION =====
function generateQRCode(registrationId) {
    const container = document.getElementById('qrCodeContainer');
    container.innerHTML = '';

    // Store ONLY the registration ID — no personal data in the QR code
    new QRCode(container, {
        text: registrationId,
        width: 300,
        height: 300,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
    });
}

// ===== SEND PENDING EMAIL (on registration) =====
async function sendPendingEmail({ name, email, registrationId }) {
    try {
        await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_PENDING, {
            participant_name:  name,
            participant_email: email,
            registration_id:   registrationId
        });
        console.log('✓ Pending confirmation email sent');
    } catch (err) {
        console.warn('Pending email failed (registration still saved):', err);
    }
}

// ===== SEND QR EMAIL (after admin approval) =====
async function sendConfirmationEmail({ name, email, registrationId, category, organization }) {
    try {
        // Generate QR code in hidden container
        const container = document.getElementById('qrEmailContainer');
        container.innerHTML = '';
        new QRCode(container, {
            text: registrationId,
            width: 200, height: 200,
            colorDark: '#000000', colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });

        // Wait for canvas to render
        await new Promise(r => setTimeout(r, 800));
        const canvas = container.querySelector('canvas');
        const qrImage = canvas ? canvas.toDataURL('image/png') : '';

        await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_QR, {
            participant_name:  name,
            participant_email: email,
            registration_id:   registrationId,
            category:          category,
            organisation:      organization,
            qr_code_image:     qrImage
        });

        console.log('✓ QR approval email sent to', email);
        return true;
    } catch (err) {
        console.error('QR email failed:', err);
        return false;
    }
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
        const timestamp = reg.timestamp?.seconds
            ? new Date(reg.timestamp.seconds * 1000).toLocaleString()
            : '—';

        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.innerHTML = `
            <td><strong>${reg.name || ''}</strong><br><small style="color:#888">${reg.email || ''}</small></td>
            <td>${reg.phone || '—'}</td>
            <td>${reg.organization || ''}</td>
            <td>${reg.designation || '—'}</td>
            <td>${reg.county || '—'}</td>
            <td>
                <select class="cat-select" data-id="${reg.id}">
                    ${categories.map(c => `<option${c===reg.category?' selected':''}>${c}</option>`).join('')}
                </select>
            </td>
            <td><span class="status-badge status-${reg.status}">${reg.status}</span></td>
            <td style="font-size:0.8rem;color:#666">${timestamp}</td>
            <td class="action-btns">
                <button class="btn-approve" onclick="updateRegistration('${reg.id}',{status:'approved'})">Approve</button>
                <button class="btn-reject"  onclick="updateRegistration('${reg.id}',{status:'rejected'})">Reject</button>
            </td>`;

        // Expandable detail row
        const detailRow = document.createElement('tr');
        detailRow.className = 'detail-row';
        detailRow.style.display = 'none';
        const accessibility = reg.accessibilityNeeds?.length ? reg.accessibilityNeeds.join(', ') : 'None';
        detailRow.innerHTML = `
            <td colspan="9" class="detail-cell">
                <strong>ID/Passport:</strong> ${reg.idNumber || '—'} &nbsp;|
                <strong> Email:</strong> ${reg.email || '—'} &nbsp;|
                <strong> Accessibility:</strong> ${accessibility} &nbsp;|
                <strong> Special Requests:</strong> ${reg.specialRequests || 'None'}
            </td>`;

        tr.addEventListener('click', e => {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;
            detailRow.style.display = detailRow.style.display === 'none' ? 'table-row' : 'none';
        });

        tbody.appendChild(tr);
        tbody.appendChild(detailRow);
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

        // If approving, automatically send QR email
        if (updates.status === 'approved') {
            const reg = allRegistrations.find(r => r.id === id);
            if (reg) {
                await sendConfirmationEmail({
                    name:           reg.name,
                    email:          reg.email,
                    registrationId: reg.id,
                    category:       reg.category,
                    organization:   reg.organization
                });
            }
        }
    } catch (err) {
        console.error('Update failed:', err);
        alert('Update failed: ' + err.message);
    }
}

// ===== EXPORT CSV =====
function exportCSV() {
    const headers = [
        'Name', 'ID/Passport', 'Phone', 'Email',
        'Organisation', 'Designation', 'County',
        'Category', 'Status', 'Accessibility', 'Special Requests', 'Registered'
    ];

    const rows = allRegistrations.map(r => [
        r.name || '',
        r.idNumber || '',
        r.phone || '',
        r.email || '',
        r.organization || '',
        r.designation || '',
        r.county || '',
        r.category || '',
        r.status || '',
        (r.accessibilityNeeds || []).join('; '),
        r.specialRequests || '',
        r.timestamp?.seconds
            ? new Date(r.timestamp.seconds * 1000).toLocaleString()
            : ''
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `cef-registrations-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}
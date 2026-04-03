let db, auth;
let scanner = null;
let currentRegId = null;

// Authorised usher and admin emails
const ALLOWED_EMAILS = [
    'admin@cef.go.ke',
    'secretariat@cef.go.ke',
    'countyenergyforum@gmail.com',
    'usher1@cef.go.ke',
    'usher2@cef.go.ke'
];

// Badge colours matching the plan
const BADGE_COLOURS = {
    VVIP:     '#FFD700',
    VIP:      '#e53935',
    Delegate: '#1e88e5',
    Media:    '#43a047',
    Staff:    '#212121'
};

function initCheckin() {
    db   = firebase.firestore();
    auth = firebase.auth();

    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        try {
            db.settings({ host: '127.0.0.1:8081', ssl: false });
            auth.useEmulator('http://127.0.0.1:9099/');
        } catch(e) {}
    }

    document.getElementById('loginBtn').addEventListener('click', handleLogin);

    auth.onAuthStateChanged(user => {
        if (user && ALLOWED_EMAILS.includes(user.email)) {
            document.getElementById('checkinLogin').style.display    = 'none';
            document.getElementById('checkinDashboard').style.display = 'block';
            document.getElementById('logoutBtn').style.display        = 'inline-block';
            startScanner();
        } else if (user) {
            // Logged in but not authorised
            auth.signOut();
            const errEl = document.getElementById('loginError');
            errEl.textContent   = 'Unauthorised. Contact the system administrator.';
            errEl.style.display = 'block';
        } else {
            document.getElementById('checkinLogin').style.display    = 'block';
            document.getElementById('checkinDashboard').style.display = 'none';
            document.getElementById('logoutBtn').style.display        = 'none';
            stopScanner();
        }
    });
}

// ===== AUTH =====
async function handleLogin() {
    const email    = document.getElementById('adminEmail').value;
    const password = document.getElementById('adminPassword').value;
    const errEl    = document.getElementById('loginError');
    errEl.style.display = 'none';
    try {
        await auth.signInWithEmailAndPassword(email, password);
    } catch(e) {
        errEl.textContent    = 'Login failed: ' + e.message;
        errEl.style.display  = 'block';
    }
}

// ===== QR SCANNER =====
function startScanner() {
    scanner = new Html5Qrcode('qr-reader');
    scanner.start(
        { facingMode: 'environment' },          // use rear camera on tablets
        { fps: 10, qrbox: { width: 250, height: 250 } },
        onScanSuccess,
        () => {}                                 // ignore per-frame errors silently
    ).catch(err => {
        document.getElementById('scannerMsg').textContent =
            'Camera access denied. Please allow camera permissions and reload.';
        console.error('Scanner start error:', err);
    });
}

function stopScanner() {
    if (scanner) {
        scanner.stop().catch(() => {});
        scanner = null;
    }
}

// ===== ON SCAN =====
async function onScanSuccess(decodedText) {
    scanner.pause();
    document.getElementById('scannerMsg').textContent = 'Looking up participant…';

    // Handle both old JSON format {id, name, email} and new plain text ID
    let regId;
    try {
        const data = JSON.parse(decodedText);
        regId = data.id;
    } catch(e) {
        regId = decodedText.trim();
    }

    if (!regId) {
        showAlert('warning', 'Invalid QR code. Please try again.');
        scanner.resume();
        return;
    }

    currentRegId = regId;
    await lookupRegistration(regId);
}

// ===== FIRESTORE LOOKUP =====
async function lookupRegistration(id) {
    try {
        const doc = await db.collection('registrations').doc(id).get();

        if (!doc.exists) {
            showResult(null);
            return;
        }

        showResult({ id: doc.id, ...doc.data() });

    } catch(err) {
        console.error('Lookup error:', err);
        document.getElementById('scannerMsg').textContent = 'Error looking up participant.';
    }
}

// ===== DISPLAY RESULT =====
function showResult(reg) {
    const card = document.getElementById('resultCard');
    card.style.display = 'block';
    document.getElementById('scanner-container').style.display = 'none';
    document.getElementById('scannerMsg').style.display = 'none';

    if (!reg) {
        document.getElementById('resName').textContent          = 'Not Found';
        document.getElementById('resCategoryBadge').textContent = '';
        document.getElementById('resMeta').textContent          = '';
        document.getElementById('badgeStrip').className         = 'badge-strip';
        document.getElementById('badgeStrip').style.background  = '#ccc';
        document.getElementById('btnCheckIn').style.display     = 'none';
        showAlert('danger', '✗ Registration not found. Do not admit.');
        return;
    }

    // Populate fields
    document.getElementById('resName').textContent = reg.name || '—';
    document.getElementById('resMeta').innerHTML   =
        `<b>Organisation:</b> ${reg.organization || '—'}<br>
         <b>Designation:</b> ${reg.designation || '—'}<br>
         <b>County:</b> ${reg.county || '—'}<br>
         <b>ID/Passport:</b> ${reg.idNumber || '—'}<br>
         <b>Phone:</b> ${reg.phone || '—'}`;

    // Category badge
    const catBadge = document.getElementById('resCategoryBadge');
    catBadge.textContent        = reg.category || 'Unknown';
    catBadge.style.background   = BADGE_COLOURS[reg.category] || '#888';

    // Colour strip at top of card
    const strip = document.getElementById('badgeStrip');
    strip.className             = 'badge-strip';
    strip.style.background      = BADGE_COLOURS[reg.category] || '#888';

    // Status-based messaging
    const btnCheckIn = document.getElementById('btnCheckIn');

    if (reg.status === 'checked-in') {
        btnCheckIn.style.display = 'none';
        showAlert('info', `ℹ Already checked in. Admit with caution.`);

    } else if (reg.status === 'rejected') {
        btnCheckIn.style.display = 'none';
        showAlert('danger', '✗ Registration rejected. Do not admit.');

    } else if (reg.status === 'pending') {
        btnCheckIn.style.display = 'block';
        showAlert('warning', '⚠ Registration pending approval. Check with supervisor before admitting.');
        btnCheckIn.onclick = () => checkIn(reg.id);

    } else if (reg.status === 'approved') {
        btnCheckIn.style.display = 'block';
        showAlert('success', '✓ Registration approved. Ready to check in.');
        btnCheckIn.onclick = () => checkIn(reg.id);
    }
}

function showAlert(type, message) {
    const el = document.getElementById('statusAlert');
    el.className   = `alert alert-${type}`;
    el.textContent = message;
}

// ===== CHECK IN =====
async function checkIn(id) {
    try {
        await db.collection('registrations').doc(id).update({
            status: 'checked-in',
            checkedInAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        showAlert('success', '✓ Checked in successfully. Issue badge.');
        document.getElementById('btnCheckIn').style.display = 'none';
    } catch(err) {
        console.error('Check-in error:', err);
        showAlert('danger', 'Check-in failed: ' + err.message);
    }
}

// ===== RESET =====
function resetScanner() {
    currentRegId = null;
    document.getElementById('resultCard').style.display          = 'none';
    document.getElementById('scanner-container').style.display   = 'block';
    document.getElementById('scannerMsg').style.display          = 'block';
    document.getElementById('scannerMsg').textContent            = 'Point the camera at a participant\'s QR code';
    document.getElementById('statusAlert').textContent           = '';
    if (scanner) scanner.resume();
}

// ===== INIT =====
function waitForFirebase(retries = 20) {
    if (typeof firebase !== 'undefined' && firebase.apps.length > 0) {
        initCheckin();
    } else if (retries > 0) {
        setTimeout(() => waitForFirebase(retries - 1), 100);
    } else {
        console.error('Firebase failed to initialize.');
    }
}

document.addEventListener('DOMContentLoaded', () => waitForFirebase());

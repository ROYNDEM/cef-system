// ===== TOAST NOTIFICATIONS =====
function showToast(message, type = 'info', duration = 3000) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    const icons = { success: '✓', error: '✗', info: 'ℹ', warning: '⚠' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = `${icons[type] || ''} ${message}`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('hide');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

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
                document.getElementById('statsBtn').style.display = 'inline-block';
                dashboard.style.display = 'block';
                setTimeout(() => {
                    loadUsers();
                }, 300);
            } else if (user) {
                // Logged in but not authorised
                auth.signOut();
                document.getElementById('loginError').textContent = 'Unauthorised. Contact the system administrator.';
                document.getElementById('loginError').style.display = 'block';
            } else {
                document.getElementById('loginForm').style.display = 'block';
                document.getElementById('logoutBtn').style.display = 'none';
                document.getElementById('statsBtn').style.display = 'none';
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
        showToast('Registration submitted successfully!', 'success');

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
        showToast('Login failed: ' + error.message, 'error');
    }
}

// ===== ADMIN DASHBOARD =====
let allRegistrations = [];
let currentPage = 1;
const rowsPerPage = 10;
let sortField = '';
let sortAsc = true;
let selectedIds = new Set();

function loadUsers() {
    document.getElementById('tableLoader').style.display = 'block';
    db.collection('registrations').orderBy('timestamp', 'desc').onSnapshot(snapshot => {
        allRegistrations = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        document.getElementById('tableLoader').style.display = 'none';
        updateStats();
        renderTable();
    }, err => console.error('Snapshot error:', err));
}

function sortTable(field) {
    sortAsc = sortField === field ? !sortAsc : true;
    sortField = field;
    currentPage = 1;
    // Update header classes
    document.querySelectorAll('#regTable th.sortable').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (th.getAttribute('onclick') === `sortTable('${field}')`) {
            th.classList.add(sortAsc ? 'sort-asc' : 'sort-desc');
        }
    });
    renderTable();
}

function toggleSelectAll(cb) {
    document.querySelectorAll('.rowCheck').forEach(c => {
        c.checked = cb.checked;
        const id = c.dataset.id;
        if (cb.checked) selectedIds.add(id);
        else selectedIds.delete(id);
    });
    // Sync both checkboxes
    document.getElementById('selectAll').checked = cb.checked;
    document.getElementById('selectAllHeader').checked = cb.checked;
    updateSelectedCount();
}

function updateSelectedCount() {
    document.getElementById('selectedCount').textContent = `${selectedIds.size} selected`;
}

async function bulkAction(status) {
    if (!selectedIds.size) { showToast('No registrations selected', 'warning'); return; }
    const count = selectedIds.size;
    showToast(`Updating ${count} registration(s)…`, 'info');
    const promises = [...selectedIds].map(id => updateRegistration(id, { status }));
    await Promise.all(promises);
    selectedIds.clear();
    updateSelectedCount();
    showToast(`${count} registration(s) ${status}`, 'success');
}

function updateStats() {
    const r = allRegistrations;
    const vals = {
        statTotal:     r.length,
        statPending:   r.filter(x => x.status === 'pending').length,
        statApproved:  r.filter(x => x.status === 'approved').length,
        statCheckedIn: r.filter(x => x.status === 'checked-in').length,
        statVVIP:      r.filter(x => x.category === 'VVIP').length,
        statVIP:       r.filter(x => x.category === 'VIP').length,
        statDelegate:  r.filter(x => x.category === 'Delegate').length,
        statMedia:     r.filter(x => x.category === 'Media').length
    };
    Object.entries(vals).forEach(([id, newVal]) => {
        const el = document.getElementById(id);
        if (!el) return;
        const oldVal = parseInt(el.textContent) || 0;
        if (oldVal !== newVal) {
            // Count-up animation
            const duration = 600;
            const steps = 20;
            const increment = (newVal - oldVal) / steps;
            let current = oldVal;
            let step = 0;
            const timer = setInterval(() => {
                step++;
                current += increment;
                el.textContent = Math.round(current);
                if (step >= steps) {
                    el.textContent = newVal;
                    clearInterval(timer);
                }
            }, duration / steps);
            // Pulse the card
            const card = el.closest('.stat-card');
            if (card) {
                card.classList.remove('stat-pulse');
                void card.offsetWidth; // force reflow to restart animation
                card.classList.add('stat-pulse');
                setTimeout(() => card.classList.remove('stat-pulse'), 600);
            }
        }
    });
}

// ===== RIPPLE EFFECT =====
function addRipple(e) {
    const btn    = e.currentTarget;
    const circle = document.createElement('span');
    const size   = Math.max(btn.offsetWidth, btn.offsetHeight);
    const rect   = btn.getBoundingClientRect();
    circle.className = 'ripple';
    circle.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX-rect.left-size/2}px;top:${e.clientY-rect.top-size/2}px`;
    btn.appendChild(circle);
    setTimeout(() => circle.remove(), 500);
}

// ===== STATS OVERLAY =====
let chartCategory = null, chartStatus = null, chartTime = null;
let statsOpen = false;

function toggleStats() {
    const overlay = document.getElementById('statsOverlay');
    statsOpen = !statsOpen;
    overlay.style.display = statsOpen ? 'block' : 'none';
    if (statsOpen) {
        // Charts need the overlay visible before they can measure canvas size
        setTimeout(() => renderCharts(), 100);
    }
}

function renderCharts() {
    const r = allRegistrations;
    if (!r.length) return;

    // Category doughnut
    const catData = {
        labels: ['VVIP','VIP','Delegate','Media','Staff'],
        datasets: [{
            data: [
                r.filter(x => x.category === 'VVIP').length,
                r.filter(x => x.category === 'VIP').length,
                r.filter(x => x.category === 'Delegate').length,
                r.filter(x => x.category === 'Media').length,
                r.filter(x => x.category === 'Staff').length
            ],
            backgroundColor: ['#FFD700','#e53935','#1e88e5','#43a047','#212121'],
            borderWidth: 2, borderColor: '#fff'
        }]
    };
    if (chartCategory) { chartCategory.data = catData; chartCategory.update(); }
    else chartCategory = new Chart(
        document.getElementById('categoryChart').getContext('2d'),
        { type: 'doughnut', data: catData, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, cutout: '60%' } }
    );

    // Status bar
    const stData = {
        labels: ['Pending','Approved','Rejected','Checked In'],
        datasets: [{ data: [
            r.filter(x => x.status === 'pending').length,
            r.filter(x => x.status === 'approved').length,
            r.filter(x => x.status === 'rejected').length,
            r.filter(x => x.status === 'checked-in').length
        ], backgroundColor: ['#ff9800','#43a047','#e53935','#1e88e5'], borderRadius: 8 }]
    };
    if (chartStatus) { chartStatus.data = stData; chartStatus.update(); }
    else chartStatus = new Chart(
        document.getElementById('statusChart').getContext('2d'),
        { type: 'bar', data: stData, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } } }
    );

    // Time line
    const dayCounts = {};
    r.forEach(reg => {
        if (!reg.timestamp) return;
        const date = reg.timestamp.toDate ? reg.timestamp.toDate() : new Date(reg.timestamp.seconds * 1000);
        const day = date.toLocaleDateString();
        dayCounts[day] = (dayCounts[day] || 0) + 1;
    });
    const sortedDays = Object.keys(dayCounts).sort((a,b) => new Date(a) - new Date(b));
    const timeData = {
        labels: sortedDays,
        datasets: [{ label: 'Registrations', data: sortedDays.map(d => dayCounts[d]),
            borderColor: '#1b5e20', backgroundColor: 'rgba(27,94,32,0.1)',
            fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: '#43a047' }]
    };
    if (chartTime) { chartTime.data = timeData; chartTime.update(); }
    else chartTime = new Chart(
        document.getElementById('timeChart').getContext('2d'),
        { type: 'line', data: timeData, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } } }
    );
}

function renderTable() {
    const search    = (document.getElementById('searchInput')?.value || '').toLowerCase();
    const catFilter = document.getElementById('filterCategory')?.value || '';
    const stFilter  = document.getElementById('filterStatus')?.value || '';

    let filtered = allRegistrations.filter(r => {
        const matchSearch = !search ||
            (r.name||'').toLowerCase().includes(search) ||
            (r.email||'').toLowerCase().includes(search) ||
            (r.organization||'').toLowerCase().includes(search);
        const matchCat = !catFilter || r.category === catFilter;
        const matchSt  = !stFilter  || r.status   === stFilter;
        return matchSearch && matchCat && matchSt;
    });

    // Sorting
    if (sortField) {
        filtered.sort((a, b) => {
            let av = a[sortField] || '';
            let bv = b[sortField] || '';
            if (sortField === 'timestamp') {
                av = a.timestamp?.seconds || 0;
                bv = b.timestamp?.seconds || 0;
            }
            if (av < bv) return sortAsc ? -1 : 1;
            if (av > bv) return sortAsc ? 1 : -1;
            return 0;
        });
    }

    // Pagination
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / rowsPerPage));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * rowsPerPage;
    const paginated = filtered.slice(start, start + rowsPerPage);

    const pageInfo = document.getElementById('pageInfo');
    const prevBtn  = document.getElementById('prevBtn');
    const nextBtn  = document.getElementById('nextBtn');
    if (pageInfo) pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${total} total)`;
    if (prevBtn)  prevBtn.disabled  = currentPage === 1;
    if (nextBtn)  nextBtn.disabled  = currentPage === totalPages;

    const tbody = document.getElementById('regBody');
    const empty = document.getElementById('emptyMsg');

    // Smooth fade transition
    tbody.style.opacity = '0';
    setTimeout(() => {
        tbody.innerHTML = '';

        if (!paginated.length) {
            empty.style.display = 'block';
            tbody.style.opacity = '1';
            return;
        }
        empty.style.display = 'none';

        const categories = ['VVIP','VIP','Delegate','Media','Staff'];

        paginated.forEach(reg => {
            const timestamp = reg.timestamp?.seconds
                ? new Date(reg.timestamp.seconds * 1000).toLocaleString()
                : '—';

            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            if (selectedIds.has(reg.id)) tr.classList.add('row-selected');

            tr.innerHTML = `
                <td><input type="checkbox" class="rowCheck" data-id="${reg.id}" ${selectedIds.has(reg.id) ? 'checked' : ''}></td>
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
                    <button class="btn-approve" onclick="addRipple(event);updateRegistration('${reg.id}',{status:'approved'})">Approve</button>
                    <button class="btn-reject"  onclick="addRipple(event);updateRegistration('${reg.id}',{status:'rejected'})">Reject</button>
                </td>`;

            // Expandable detail row
            const detailRow = document.createElement('tr');
            detailRow.className = 'detail-row';
            detailRow.style.display = 'none';
            const accessibility = reg.accessibilityNeeds?.length ? reg.accessibilityNeeds.join(', ') : 'None';
            detailRow.innerHTML = `
                <td colspan="10" class="detail-cell">
                    <strong>ID/Passport:</strong> ${reg.idNumber || '—'} &nbsp;|
                    <strong> Email:</strong> ${reg.email || '—'} &nbsp;|
                    <strong> Accessibility:</strong> ${accessibility} &nbsp;|
                    <strong> Special Requests:</strong> ${reg.specialRequests || 'None'}
                </td>`;

            tr.addEventListener('click', e => {
                if (['BUTTON','SELECT','INPUT'].includes(e.target.tagName)) return;
                detailRow.style.display = detailRow.style.display === 'none' ? 'table-row' : 'none';
            });

            tbody.appendChild(tr);
            tbody.appendChild(detailRow);
        });

        // Checkbox change handler
        tbody.querySelectorAll('.rowCheck').forEach(cb => {
            cb.addEventListener('change', e => {
                const id = e.target.dataset.id;
                if (e.target.checked) { selectedIds.add(id); e.target.closest('tr').classList.add('row-selected'); }
                else { selectedIds.delete(id); e.target.closest('tr').classList.remove('row-selected'); }
                updateSelectedCount();
            });
        });

        // Category change handler
        tbody.querySelectorAll('.cat-select').forEach(sel => {
            sel.addEventListener('change', e => {
                updateRegistration(e.target.dataset.id, { category: e.target.value });
            });
        });

        tbody.style.opacity = '1';
    }, 150);
}

function nextPage() { currentPage++; renderTable(); }
function prevPage() { if (currentPage > 1) { currentPage--; renderTable(); } }

async function updateRegistration(id, updates) {
    try {
        await db.collection('registrations').doc(id).update(updates);

        // If approving, automatically send QR email
        if (updates.status === 'approved') {
            const reg = allRegistrations.find(r => r.id === id);
            if (reg) {
                showToast('Sending QR code email…', 'info');
                const sent = await sendConfirmationEmail({
                    name:           reg.name,
                    email:          reg.email,
                    registrationId: reg.id,
                    category:       reg.category,
                    organization:   reg.organization
                });
                showToast(sent ? 'QR code sent to ' + reg.email : 'Approval saved but email failed', sent ? 'success' : 'warning');
            }
        } else if (updates.status === 'rejected') {
            showToast('Registration rejected', 'warning');
        }
    } catch (err) {
        console.error('Update failed:', err);
        showToast('Update failed: ' + err.message, 'error');
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
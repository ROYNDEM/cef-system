const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');

admin.initializeApp();

const app = express();
app.use(express.json());

// POST /register
app.post('/register', async (req, res) => {
    try {
        const { name, email, organization } = req.body;
        const docRef = await admin.firestore().collection('registrations').add({
            name,
            email,
            organization,
            status: 'pending',
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        res.status(201).send({ id: docRef.id });
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// GET /users
app.get('/users', async (req, res) => {
    try {
        const snapshot = await admin.firestore().collection('registrations').get();
        const users = [];
        snapshot.forEach(doc => {
            users.push({ id: doc.id, ...doc.data() });
        });
        res.send(users);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

// PUT /approve
app.put('/approve/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, badge } = req.body;
        await admin.firestore().collection('registrations').doc(id).update({
            status,
            badge
        });
        res.send('Updated');
    } catch (error) {
        res.status(500).send(error.message);
    }
});

exports.api = functions.https.onRequest(app);
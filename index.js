const express = require('express')
const app = express()
const port = process.env.PORT || 5000;
const cors = require('cors');
const { MongoClient } = require('mongodb');
const ObjectId = require ('mongodb').ObjectId;
const admin = require("firebase-admin");
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_API_KEY);
const fileUpload = require('express-fileupload');
// middleware
app.use(cors());
app.use(express.json());
app.use(fileUpload());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.a6jam.mongodb.net/doctorDB?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });


const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

async function verifyToken(req, res, next) {
    if (req?.headers?.authorization.startsWith('Bearer ')) {
        const token = req.headers.authorization.split(' ')[1];
        try {
            const decodedUser = await admin.auth().verifyIdToken(token);
            req.decodedEmail = decodedUser.email;
        }
        catch {

        }
    }
    next();
}

async function run() {
    try {
        await client.connect();
        const database = client.db("doctors_portal");
        const appointmentCollection = database.collection("appointments");
        const userCollection = database.collection("users");
        const doctorsCollention = database.collection("doctors");

        // show appointments in dashboard user email and date wise
        app.get('/appointments', verifyToken, async (req, res) => {
            console.log('authorization', req.decodedEmail)
            const email = req.query.email;
            if (req.decodedEmail === email) {
                const date = req.query.date;
                const query = { email: email, date: date };
                const cursor = appointmentCollection.find(query);
                const result = await cursor.toArray();
                res.send(result);
            }
            else {
                res.status(401).send({ message: 'You are not authorized' });
            }
        })

        // get specific appointment basen on id for payment
        app.get('/appointments/:appointmentId', async (req, res)=>{
            const id = req.params.appointmentId;
            const query = {_id: ObjectId(id)};
            const result = await appointmentCollection.findOne(query);
            res.send(result);
        })

        // check if user admin or not
        app.get('/users/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email };
            const user = await userCollection.findOne(query);
            let isAdmin = false;
            if (user?.role === 'admin') {
                isAdmin = true;
            }
            res.send({ admin: isAdmin });
        })

        // set appointments for users to database
        app.post('/appointments', async (req, res) => {
            const appointment = req.body;
            const result = await appointmentCollection.insertOne(appointment);
            res.json(result);
        })

        // show doctors to UI
        app.get('/doctors', async (req,res)=>{
            const doctors = doctorsCollention.find({});
            const result = await doctors.toArray();
            res.send(result);
        })

        // save doctors to database
        app.post('/doctors', async (req, res)=>{
          const name = req.body.name;
          const email = req.body.email;
          const pic = req.files.image;
          const picData = pic.data;
          const encodedData = picData.toString('base64');
          const imageBuffer = Buffer.from(encodedData, 'base64');
          const doctor = {
              name,
              email,
              image: imageBuffer
          }
          const result = await doctorsCollention.insertOne(doctor);
            res.json(result);
        })

        // save users to database
        app.post('/users', async (req, res) => {
            const user = req.body;
            const result = await userCollection.insertOne(user);
            res.json(result);
        })

        // save users to database by google sign in
        app.put('/users', async (req, res) => {
            const user = req.body;
            const filter = { email: user.email };
            const options = { upsert: true };
            const updateDoc = { $set: user };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            res.json(result);
        })

        // make admin from users database
        app.put('/users/admin', verifyToken, async (req, res) => {
            const email = req.body.email;
            const requester = req.decodedEmail;
            if (requester) {
                const requesterAccount = await userCollection.findOne({ email: requester });
                if (requesterAccount.role === 'admin') {
                    const filter = { email };
                    const updateDoc = { $set: { role: 'admin' } };
                    const result = await userCollection.updateOne(filter, updateDoc);
                    res.json(result);
                }
            }
            else {
                res.status(403).json({ message: 'You have do not access to make an admin' });
            }

        })

        // update payment to database
        app.put('/appointments/:id', async (req, res)=>{
            const id = req.params.id;
            const paymentInfo = req.body;
            console.log(id, paymentInfo)
            const filter = {_id: ObjectId(id)};
            const updateDoc = {
                $set: {payment: paymentInfo}
            }
            const result = await appointmentCollection.updateOne(filter, updateDoc);
            res.json(result);
        })

        // stripe payment
        app.post('/create-payment-intent', async (req, res) => {
           const paymentInfo = req.body;
           const amount = paymentInfo.price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
              amount: amount,
              currency: "usd",
              payment_method_types: ['card']
            });
          
            res.json({
              clientSecret: paymentIntent.client_secret,
            });
          });
    }
    finally {
        // await client.close();
    }

}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`listenting at ${port}`)
})
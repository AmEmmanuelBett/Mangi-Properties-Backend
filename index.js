const express = require("express");
const cors = require("cors");
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const bodyParser = require("body-parser");
const fileUpload = require("express-fileupload");
const { put, list, get, remove } = require('@vercel/blob');
const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config();
const loggingMiddleware = require('./middleware');



// Apply logging middleware globally
const app = express();
const port = process.env.PORT || 3000;
const secretToken = process.env.SECRET_TOKEN_KEY
// Middleware
app.use(cors({ origin: '*' })); // Allow requests from any origin
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(fileUpload());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(loggingMiddleware);

// Firebase initialization
const firebaseConfig = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || "{}");
const firebaseDatabaseURL = process.env.FIREBASE_DATABASE_URL;

if (!firebaseConfig.project_id || !firebaseConfig.private_key || !firebaseDatabaseURL) {
  console.error('Firebase configuration is missing or incomplete.');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(firebaseConfig),
  databaseURL: firebaseDatabaseURL
});
const transporter = nodemailer.createTransport({
  service: "Gmail",
  auth: {
    user: process.env.USER_EMAIL,
    pass: process.env.USER_PASSWORD,
  },
});
// Vercel Blob settings
const vercelStoreId = process.env.V_STORE_ID;
const vercelToken = process.env.V_TOKEN;

if (!vercelStoreId || !vercelToken) {
  console.error('Vercel Blob configuration is missing or incomplete.');
  process.exit(1);
}

const vercelSettings = { storeId: vercelStoreId, token: vercelToken, access: 'public' };

// Utility function to update image path for outgoing responses
const updateImagePath = (property) => {
  if (!property || !property.imageUrl) return property;
  return {
    ...property,
    imageUrl: property.imageUrl
  };
};
// Middleware to authenticate requests
const authenticateToken = (req, res, next) => {
  let token = req.headers['authorization'];
  if (!token) return res.status(401).json({ message: 'Authorization token not found' });
  token = token.split(" ")[1]
  //console.log(token)
  jwt.verify(token, secretToken, (err, decoded) => {
    if (err) return res.status(401).json({ message: 'Invalid token' });
    req.user = decoded;
    next();
  });
};
// POST /properties - Add or update a property
app.post("/properties", authenticateToken, async (req, res) => {
  const { name, location, description, price, bedrooms, bathrooms, propertyType, period } = req.body;
  const images = req.files?.images; // Accept an array of images

  if (!images || images.length === 0) {
    return res.status(400).send('No image files were uploaded.');
  }

  const imageUrls = [];

  // Upload up to 5 images
  for (let i = 0; i < Math.min(images.length, 5); i++) {
    const imagePath = `uploads/${Date.now()}_${images[i].name}`;
    try {
      const response = await put(imagePath, images[i].data, vercelSettings);
      const imageUrl = response.url;
      imageUrls.push(imageUrl);
    } catch (err) {
      console.error('Error uploading image:', err);
      return res.status(500).send('Failed to upload images.');
    }
  }

  const propertyData = {
    name,
    location,
    description,
    price: price || 0,
    bedrooms: bedrooms || 0,
    bathrooms: bathrooms || 0,
    propertyType: propertyType || "Rent",
    period: period || "",
    imageUrls: imageUrls // Store URLs of all uploaded images
  };

  try {
    const propertyRef = admin.database().ref('properties').push();
    await propertyRef.set(propertyData);

    res.send({
      message: "Property added successfully",
      property: propertyData
    });
  } catch (err) {
    console.error('Error adding property:', err);
    res.status(500).send('Failed to add the property.');
  }
});


// GET /properties - Retrieve properties
app.get("/properties", async (req, res) => {
  try {
    const location = req.query.location;
    const snapshot = await admin.database().ref('properties').once('value');
    const properties = [];
    snapshot.forEach((childSnapshot) => {
      const property = childSnapshot.val();
      // Provide links to all uploaded images
      const propertyWithImageUrls = updateImagePath({ id: childSnapshot.key, ...property });
      properties.push(propertyWithImageUrls);
    });

    if (location) {
      const filteredProperties = properties.filter(property => property.location.toLowerCase().includes(location.toLowerCase()));
      if (filteredProperties.length === 0) {
        res.send({ properties: properties, message: `Sorry! No properties found for ${location}. Check out other great spots that you may like.` });
      } else {
        res.send({ properties: filteredProperties, message: `Here are the properties found for ${location}.` });
      }
    } else {
      res.send({ properties: properties });
    }
  } catch (error) {
    console.error('Failed to fetch properties:', error);
    res.status(500).send('Failed to fetch properties.');
  }
});

// PUT /properties/:id - Update a property
app.put("/properties/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, location, description, price, bedrooms, bathrooms, propertyType, period } = req.body;
  const images = req.files?.images; // Accept an array of images

  try {
    const propertyRef = admin.database().ref(`properties/${id}`);
    const existingPropertySnapshot = await propertyRef.once('value');
    const existingProperty = existingPropertySnapshot.val();

    if (!existingProperty) {
      return res.status(404).send({ message: "Property not found." });
    }

    const existingImageUrls = existingProperty.imageUrls || [];
    const newImageUrls = [];

    // Upload up to 5 new images
    if (images && images.length > 0) {
      for (let i = 0; i < Math.min(images.length, 5); i++) {
        const imagePath = `uploads/${Date.now()}_${images[i].name}`;
        try {
          const response = await put(imagePath, images[i].data, vercelSettings);
          const imageUrl = response.url;
          newImageUrls.push(imageUrl);
        } catch (err) {
          console.error('Error uploading image:', err);
          return res.status(500).send('Failed to upload images.');
        }
      }
    }

    const updates = {
      name: name || existingProperty.name,
      location: location || existingProperty.location,
      description: description || existingProperty.description,
      price: price || existingProperty.price,
      bedrooms: bedrooms || existingProperty.bedrooms,
      bathrooms: bathrooms || existingProperty.bathrooms,
      propertyType: propertyType || existingProperty.propertyType,
      period: period || existingProperty.period,
      imageUrls: [...existingImageUrls, ...newImageUrls] // Combine existing and new image URLs
    };

    await propertyRef.update(updates);
    res.send({
      message: "Property updated successfully.",
      property: updates
    });
  } catch (error) {
    console.error('Failed to update property:', error);
    res.status(500).send('Failed to update property.');
  }
});




// GET /properties/:id - Retrieve a single property
app.get("/properties/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const snapshot = await admin.database().ref(`properties/${id}`).once('value');
    const property = snapshot.val();
    if (!property) {
      return res.status(404).send({ message: "Property not found." });
    }
    // Provide links to all uploaded images
    const propertyWithImageUrls = updateImagePath({ id: snapshot.key, ...property });
    res.send(propertyWithImageUrls);
  } catch (error) {
    console.error('Failed to fetch property:', error);
    res.status(500).send('Failed to fetch property.');
  }
});



// DELETE /properties/:id - Delete a property
app.delete("/properties/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    // Check if the property exists
    const snapshot = await admin.database().ref(`properties/${id}`).once('value');
    const property = snapshot.val();

    if (!property) {
      return res.status(404).send({ message: "Property not found." });
    }

    const imageUrls = property.imageUrls || [];

    // Delete the property from the database
    await admin.database().ref(`properties/${id}`).remove();

    // If property had associated images, delete them
    for (const imageUrl of imageUrls) {
      await remove(imageUrl, vercelSettings);
    }

    res.send({ message: "Property deleted successfully." });
  } catch (error) {
    console.error('Failed to delete property:', error);
    res.status(500).send('Failed to delete property.');
  }
});

// Handle form submission
app.post("/submit", (req, res) => {
  //console.log(req.body);
  const formData = req.body;

  // Create the HTML email template
  const emailHTML = `
<html>
<head>
    <style>
        body {
            font-family: 'Arial', sans-serif;
            padding: 20px;
            background-color: #f9f9f9;
            color: #333;
        }
        .container {
            max-width: 600px;
            margin: auto;
            background-color: #ffffff;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }
        .header {
            background-color: #0056b3;
            color: #ffffff;
            padding: 20px 40px;
            text-align: center;
        }
        .header img {
            max-height: 50px;
            margin-bottom: 10px;
        }
        .body {
            padding: 20px 40px;
            background-color: #ffffff;
            line-height: 1.5;
        }
        h2 {
            color: #0056b3;
            margin-top: 0;
        }
        p {
            margin: 10px 0;
            color: #555;
        }
        .footer {
            font-size: 12px;
            text-align: center;
            padding: 20px;
            background-color: #f0f0f0;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>Contact Submission Details</h2>
        </div>
        <div class="body">
            <p><strong>Name:</strong> ${formData.name}</p>
            <p><strong>Telephone:</strong> ${formData.telephone}</p>
            <p><strong>Email:</strong> ${formData.email}</p>
            <p><strong>Interest Date:</strong> ${formData.travelDate}</p>
            <p><strong>Interested City:</strong> ${formData.city}</p>
            <p><strong>Number of Guests:</strong> ${formData.guests}</p>
            <p><strong>Preferred Number of Rooms:</strong> ${formData.rooms}</p>
            <p><strong>Desired House Type:</strong> ${formData.houseType}</p>
        </div>
        <div class="footer">
            Contact Form Submitted Successfully
        </div>
    </div>
</body>
</html>
`;

  // Setup email data
  const mailOptions = {
    from: "emmanuel4cheru@gmail.com",
    // to: "ally@tlink.dk,mangiproperties.consultancy@gmail.com",
    to: "emmanuel4cheru@gmail.com",
    subject: "New Contact Form Submission",
    html: emailHTML,
  };

  // Send email
  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Error sending email:", error);
      return res.sendFile(__dirname + '/error.html'); // Make sure the path is correct
    } else {
      //console.log("Email sent:", info.response);
      return res.sendFile(__dirname + '/success.html'); // Make sure the path is correct
    }
  });
});

// Dummy database to store generated OTPs
const otpDB = {};

// Middleware
app.use(bodyParser.json());

// Generate OTP and send it to the user's email
app.post('/generate-otp', (req, res) => {
  const email = process.env.USER_EMAIL
  const otp = Math.floor(100000 + Math.random() * 900000); // Generate 6-digit OTP
  otpDB[email] = otp;



  const mailOptions = {
    from: 'emmanuel4cheru@gmail.com', // Replace with your email
    // to: email + ",ally@tlink.dk,mangiproperties.consultancy@gmail.com",
    to: email,
    subject: 'OTP for Real Estate Management',
    text: `Your OTP for Real Estate Management is: ${otp}`
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error('Error sending OTP:', error);
      res.status(500).json({ message: 'Failed to send OTP' });
    } else {
      //console.log('OTP sent:', info.response);
      res.json({ message: 'OTP sent successfully' });
    }
  });
});

// Verify OTP and issue JWT token
app.post('/verify-otp', (req, res) => {
  console.log("called")
  const { otp } = req.body;
  let email = process.env.USER_EMAIL
  const storedOTP = otpDB[email];

  if (storedOTP && storedOTP.toString() === otp.toString()) {
    // OTP verification successful, issue JWT token
    const token = jwt.sign({ email }, secretToken, { expiresIn: '2h' }); // Replace with your secret key
    res.json({ token });
  } else {
    res.status(401).json({ message: 'Invalid OTP' });
  }
});

// Verify JWT token
app.post('/verify-token', (req, res) => {
  const { token } = req.body;
  jwt.verify(token, secretToken, (err, decoded) => { // Replace with your secret key
    if (err) {
      res.status(401).json({ message: 'Invalid token' });
    } else {
      // Token is valid
      res.json({ message: 'Token verified' });
    }
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
module.exports = app;

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fileUpload = require("express-fileupload");
const { put, list, get, remove } = require('@vercel/blob');
const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: '*' })); // Allow requests from any origin
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(fileUpload());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

app.post("/properties", async (req, res) => {
  const { name, location, description, price, bedrooms, bathrooms, propertyType, period } = req.body;
  const image = req.files?.image;

  if (!image) {
    return res.status(400).send('No image file was uploaded.');
  }

  const imagePath = `uploads/${Date.now()}_${image.name}`;

  try {
    const response = await put(imagePath, image.data, vercelSettings);
    const imageUrl = response.url;

    if (!imageUrl) {
      return res.status(500).send('Failed to upload the image.');
    }

    const propertyData = {
      name,
      location,
      description,
      price: price || 0,
      bedrooms: bedrooms || 0,
      bathrooms: bathrooms || 0,
      propertyType: propertyType || "Rent",
      period: period || "", // Include period field
      imageUrl: imageUrl // Store image path for later retrieval
    };

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

// Get properties
// Get properties
app.get("/properties", async (req, res) => {
  try {
    const snapshot = await admin.database().ref('properties').once('value');
    const properties = [];
    snapshot.forEach((childSnapshot) => {
      const property = childSnapshot.val();
      properties.push(updateImagePath({ id: childSnapshot.key, ...property }));
    });
    console.log(properties); // Add parentheses after console.log
    res.send(properties);
  } catch (error) {
    console.error('Failed to fetch properties:', error);
    res.status(500).send('Failed to fetch properties.');
  }
});



// Fetch a single property by ID
app.get("/properties/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const snapshot = await admin.database().ref(`properties/${id}`).once('value');
    const property = snapshot.val();
    res.send(property);
  } catch (error) {
    console.error('Failed to fetch property:', error);
    res.status(500).send('Failed to fetch property.');
  }
});



// Edit property with new fields and image handling
app.put("/properties/:id", async (req, res) => {
  const { id } = req.params;
  const { name, location, description, price, bedrooms, bathrooms, propertyType, period } = req.body;

  try {
    const image = req.files?.image;
    let imageUrl = null;

    if (image) {
      const imagePath = `uploads/${Date.now()}_${image.name}`;
      const response = await put(imagePath, image.data, vercelSettings);
      imageUrl = response.url;
    }

    const updates = {
      name,
      location,
      description,
      price: price || 0,
      bedrooms: bedrooms || 0,
      bathrooms: bathrooms || 0,
      propertyType: propertyType || "Rent",
      period: period || "", // Include period field
    };

    if (imageUrl) {
      updates.imageUrl = imageUrl;
    }

    await admin.database().ref(`properties/${id}`).update(updates);
    res.send({
      message: "Property updated successfully.",
      property: updates
    });
  } catch (error) {
    console.error('Failed to update property:', error);
    res.status(500).send('Failed to update property.');
  }
});


// Delete property
// Delete property
app.delete("/properties/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Check if the property exists
    const snapshot = await admin.database().ref(`properties/${id}`).once('value');
    const property = snapshot.val();

    if (!property) {
      return res.status(404).send({ message: "Property not found." });
    }

    // const imageUrl = property.imageUrl;

    // // If property has an associated image, delete the image
    // if (imageUrl) {
    //   await remove(imageUrl, vercelSettings);
    // }

    // Remove property from the database
    await admin.database().ref(`properties/${id}`).remove();

    res.send({ message: "Property deleted successfully." });
  } catch (error) {
    console.error('Failed to delete property:', error);
    res.status(500).send('Failed to delete property.');
  }
});



// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
module.exports = app;
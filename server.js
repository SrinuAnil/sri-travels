const express = require("express");
const http = require("http");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const axios = require("axios");
const cookieParser = require("cookie-parser");
const { Server } = require("socket.io");
const { log } = require("console");

dotenv.config();

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
app.use(cookieParser());

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

io.on("connection", (socket) => {

  console.log("Socket connected");

  socket.on("driver-online", (driverId) => {

    socket.join(driverId);

    console.log("Driver online:", driverId);

  });

});

/* ================================
   DATABASE CONNECTION
================================ */

const uri = process.env.MONGO_URI;
const PORT = process.env.PORT || 3001;

mongoose
.connect(process.env.MONGO_URI)
.then(() => {

  console.log("Connected to Sri Travels DB");

  server.listen(PORT, "0.0.0.0", () => {
    console.log("Server running on port", PORT);
  });

})
.catch(err => console.log(err));

/* ================================
   SCHEMAS
================================ */

// USERS (Customer, Admin, Director, Driver)

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  phoneNumber: { type: String, required: true, unique: true },
  password: { type: String, required: true },

  role: {
    type: String,
    enum: ["customer", "admin", "director", "driver"],
    required: true,
  },

  isActive: { type: Boolean, default: true },

  // 🚗 Driver live location
  location: {
    latitude: { type: Number },
    longitude: { type: Number },
    updatedAt: { type: Date }
  },

  driverStatus: {
    type: String,
    enum: ["available", "busy", "offline"],
    default: "offline"
  },

  createdAt: { type: Date, default: Date.now },
});

// VEHICLES

const vehicleSchema = new mongoose.Schema({
  vehicleNumber: { type: String, required: true },
  type: { type: String, required: true }, // Bus, Car, Van
  capacity: Number,
  driverId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  status: {
    type: String,
    enum: ["available", "booked", "maintenance"],
    default: "available",
  },
  createdAt: { type: Date, default: Date.now },
});

// BOOKINGS

const bookingSchema = new mongoose.Schema({

  serviceType: {
    type: String,
    enum: ["transport", "ambulance"],
    required: true
  },

  bookingType: {
    type: String,
    enum: ["self", "other"],
    required: true
  },

  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  customerName: {
    type: String,
    required: true
  },

  customerPhone: {
    type: String,
    required: true
  },

  bookingForName: {
    type: String
  },

  bookingForPhone: {
    type: String
  },

  fromLocation: {
    address: String,
    latitude: Number,
    longitude: Number
  },

  toLocation: {
    address: String,
    latitude: Number,
    longitude: Number
  },

  hospitalName: {
    type: String
  },

  vehicleType: {
    type: String // auto, car, suv, ambulance-basic, ambulance-icu etc
  },

  status: {
    type: String,
    enum: ["Pending", "Accepted", "On The Way", "Completed", "Cancelled"],
    default: "Pending"
  },

  city: {
    type: String,
    default: "Tirupati"
  },

  distance: Number,
  estimatedTime: Number,
  fare: Number,
  assignedDriver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },

  createdAt: {
    type: Date,
    default: Date.now
  }

});

const User = mongoose.model("User", userSchema);
const Vehicle = mongoose.model("Vehicle", vehicleSchema);
const Booking = mongoose.model("Booking", bookingSchema);

// Distace Calculation Function

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the Earth in km
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

//Fare Calculate Function

function calculateFare(distance, vehicleType) {
  const baseFare = {
    auto: 40,
    car: 80,
    suv: 120,
    van: 150,
    "ambulance-basic": 200,
    "ambulance-icu": 500,
  };

  const perKmRate = {
    auto: 12,
    car: 18,
    suv: 22,
    van: 28,
    "ambulance-basic": 40,
    "ambulance-icu": 60,
  };
  return baseFare[vehicleType] + (distance * perKmRate[vehicleType]);
}

//Find Nearest Driver Function
async function findNearestDriver(lat, lon) {

  const drivers = await User.find({
    role: "driver",
    // driverStatus: "available",
    isActive: true
  });

  console.log("Available drivers:", drivers, drivers);

  let nearestDriver = null;
  let minDistance = Infinity;

  for (let driver of drivers) {
    console.log("Checking driver:", driver.name, "Location:", driver.location)

    if (!driver.location) continue;

    const distance = calculateDistance(
      lat,
      lon,
      driver.location.latitude,
      driver.location.longitude
    );

    if (distance < minDistance) {

      minDistance = distance;
      nearestDriver = driver;

    }

  }

  return nearestDriver;
}


/* ================================
   AUTH MIDDLEWARE
================================ */

const authenticateToken = (req, res, next) => {

  const token =
    (req.headers.authorization &&
     req.headers.authorization.split(" ")[1]) || req.cookies.jwt_token;
  if (!token) {
    return res.status(401).json({ error: "Token missing" });
  }

  jwt.verify(token, "SRI_TRAVELS_SECRET", (err, user) => {

    if (err) return res.status(403).json({ error: "Token Expired" });
    req.user = user;
    next();
  });
};

const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Access Denied" });
    }
    next();
  };
};

/* ================================
   AUTH ROUTES
================================ */

// REGISTER (Customer Only)

app.get("/", async (req,res) => {
  return res.json({message: "Welcome to Sri Travels API"})
})

app.post("/register", async (req, res) => {
  try {
    const { name, phoneNumber, password } = req.body;

    const existing = await User.findOne({ phoneNumber });
    if (existing) return res.status(400).json({ error: "User Exists" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      name,
      phoneNumber,
      password: hashedPassword,
      role: "customer",
    });

    await newUser.save();
    res.status(201).json({ message: "Customer Registered" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// LOGIN (All Roles)

app.post("/login", async (req, res) => {
  const { phoneNumber, password } = req.body;

  const user = await User.findOne({ phoneNumber });
  if (!user) return res.status(400).json({ error: "Invalid User" });

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return res.status(400).json({ error: "Invalid Password" });

  const token = jwt.sign(
    { id: user._id, role: user.role },
    "SRI_TRAVELS_SECRET",
    { expiresIn: "7d" }
  );

  res.json({ message: "Login Success", token, user });
});

/* ================================
   CUSTOMER ROUTES
================================ */

// Create Booking

app.post(
  "/customer/create-booking",
  authenticateToken,
  authorizeRoles("customer", "admin"),
  async (req, res) => {
    try {

      const user = await User.findById(req.user.id);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      const {
        serviceType,
        bookingType,
        bookingForName,
        bookingForPhone,
        fromLocation,
        toLocation,
        hospitalName,
        vehicleType
      } = req.body;

      const distance = calculateDistance(
        fromLocation.latitude,
        fromLocation.longitude,
        toLocation.latitude,
        toLocation.longitude
      );

      const estimatedTime = Math.round((distance / 30) * 60); // assume 30km/h avg

      const fare = calculateFare(distance, vehicleType);

      const nearestDriver = await findNearestDriver(
        fromLocation.latitude,
        fromLocation.longitude
      );



      const booking = new Booking({
        serviceType,
        bookingType,
        customerId: user._id,
        customerName: user.name,
        customerPhone: user.phoneNumber,
        bookingForName,
        bookingForPhone,
        fromLocation,
        toLocation,
        hospitalName,
        vehicleType,
        city: "Tirupati",
        distance,
        estimatedTime,
        fare,
        assignedDriver: nearestDriver ? nearestDriver._id : null,
        status: nearestDriver ? "Accepted" : "Pending"
      });

      await booking.save();
      console.log("Nearest driver:", nearestDriver);

      if (nearestDriver) {
        console.log("Notifying driver:", nearestDriver.name, "about new booking:", booking);
        io.to(nearestDriver._id.toString())
          .emit("new-booking", booking);

      }

      res.status(201).json({
        message: "Booking Created Successfully",
        booking,
        assignedDriver: nearestDriver ? {
          name: nearestDriver.name,
          phoneNumber: nearestDriver.phoneNumber
        } : null,
        distance,
        estimatedTime,
        fare
      });

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

//charges estimation

app.post(
  "/customer/estimate-fare",
  authenticateToken,
  authorizeRoles("customer"),
  async (req, res) => {
    try {
      const { fromLocation, toLocation, vehicleType } = req.body;
      
      if (!fromLocation || !toLocation) {
        return res.status(400).json({ error: "Locations required" });
      }

      const origin = `${fromLocation.latitude},${fromLocation.longitude}`;
      const destination = `${toLocation.latitude},${toLocation.longitude}`

      const response = await axios.get(
        "https://maps.googleapis.com/maps/api/distancematrix/json",
        {
          params: {
            origins: origin,
            destinations: destination,
            key: process.env.GOOGLE_MAPS_API_KEY,
            mode: "driving",
          },
        }
      );

      const data = response.data;

      if (
        data.rows[0].elements[0].status !== "OK"
      ) {
        return res.status(400).json({ error: "Route not found" });
      }

      const distanceMeters =
        data.rows[0].elements[0].distance.value;

      const durationSeconds =
        data.rows[0].elements[0].duration.value;

      const distanceKm = distanceMeters / 1000;
      const durationMinutes = Math.ceil(durationSeconds / 60);

      // Fare logic
      const baseFare = {
    auto: 40,
    car: 10,
    suv: 150,
    van: 200,
    "ambulance-basic": 800,
    "ambulance-icu": 1500,
  };

  const perKm = {
    auto: 12,
    car: 18,
    suv: 22,
    van: 28,
    "ambulance-basic": 40,
    "ambulance-icu": 60,
  };

      const fare =
        baseFare[vehicleType] +
        distanceKm * perKm[vehicleType];

      res.json({
        distance: Number(distanceKm.toFixed(2)),
        estimatedTime: durationMinutes,
        fare: Math.round(fare),
      });

    } catch (err) {
      console.log("Error:", err)
      res.status(500).json({ error: err });
    }
  }
);

// View Own Bookings

app.get(
  "/customer/my-bookings",
  authenticateToken,
  authorizeRoles("customer"),
  async (req, res) => {
    try {

      const bookings = await Booking.find({
        customerId: req.user.id
      }).sort({ createdAt: -1 });

      res.json(bookings);

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

/* ================================
   DRIVER ROUTES
================================ */

app.post(
  "/driver/update-location",
  authenticateToken,
  authorizeRoles("driver"),
  async (req, res) => {
    const { latitude, longitude } = req.body;

    await User.findByIdAndUpdate(
      req.user.id,
      {
        location: {
          latitude,
          longitude,
          updatedAt: new Date()
        }
      }
    );

    res.json({ message: "Location updated" });
  }
);

app.put(
  "/driver/status",
  authenticateToken,
  authorizeRoles("driver"),
  async (req, res) => {
    const { status } = req.body;
    const response = await User.findByIdAndUpdate(
      req.user.id,
      { driverStatus: status }
    )
    console.log("Driver status update response:", response)

    res.json({ message: "Status updated" });
  })

/* ================================
   ADMIN ROUTES
================================ */

// Get All Bookings

app.get(
  "/admin/bookings",
  authenticateToken,
  authorizeRoles("admin", "director"),
  async (req, res) => {
    const bookings = await Booking.find();
    res.json(bookings);
  }
);

// Update Booking Status

app.put(
  "/admin/update-status/:id",
  authenticateToken,
  authorizeRoles("admin", "director"),
  async (req, res) => {
    const { status } = req.body;

    await Booking.findByIdAndUpdate(req.params.id, { status });

    res.json({ message: "Status Updated" });
  }
);

// Search Customer Booking by Phone

app.get(
  "/admin/search/:phone",
  authenticateToken,
  authorizeRoles("admin", "director"),
  async (req, res) => {
    const bookings = await Booking.find({
      customerPhone: req.params.phone,
    });

    res.json(bookings);
  }
);

/* ================================
   DIRECTOR ROUTES
================================ */

//CREATE ADMIN

app.post(
  "/director/create-admin",
  authenticateToken,
  authorizeRoles("director"),
  async (req, res) => {
    const { name, phoneNumber, password } = req.body;
    console.log("request: ",req.body)

    const existing = await User.findOne({ phoneNumber });
    console.log(existing)
    if (existing) {
      return res.status(400).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const admin = new User({
      name,
      phoneNumber,
      password: hashedPassword,
      role: "admin",
    });

    await admin.save();

    res.json({ message: "Admin Created Successfully" });
  }
);


// Add Vehicle

app.post(
  "/director/add-vehicle",
  authenticateToken,
  authorizeRoles("director"),
  async (req, res) => {
    const vehicle = new Vehicle(req.body);
    await vehicle.save();
    res.json({ message: "Vehicle Added" });
  }
);

// Add Driver

app.post(
  "/director/create-driver",
  authenticateToken,
  authorizeRoles("director"),
  async (req, res) => {
    const { name, phoneNumber, password } = req.body;

    const existing = await User.findOne({ phoneNumber });
    if (existing) {
      return res.status(400).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const driver = new User({
      name,
      phoneNumber,
      password: hashedPassword,
      role: "driver",
    });

    await driver.save();
    res.json({ message: "Driver Created Successfully" });
  }
);

app.get(
  "/director/revenue",
  authenticateToken,
  authorizeRoles("director"),
  async (req, res) => {
    const bookings = await Booking.find({ status: "Completed" });

    const totalRevenue = bookings.reduce(
      (sum, b) => sum + (b.amount || 0),
      0
    );

    res.json({
      totalCompletedTrips: bookings.length,
      totalRevenue
    });
  }
);

app.put(
  "/director/update-vehicle/:id",
  authenticateToken,
  authorizeRoles("director"),
  async (req, res) => {
    await Vehicle.findByIdAndUpdate(
      req.params.id,
      req.body
    );

    res.json({ message: "Vehicle Updated" });
  }
);


// Get All Users

app.get(
  "/director/all-users",
  authenticateToken,
  authorizeRoles("director"),
  async (req, res) => {
    try {
      const { page = 1, limit = 25, search = "", role = "" } = req.query;

      const query = {};

      // Search by name or phone
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: "i" } },
          { phoneNumber: { $regex: search, $options: "i" } }
        ];
      }

      // Filter by role
      if (role) {
        query.role = role;
      }

      const users = await User.find(query)
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 });

      const totalUsers = await User.countDocuments(query);

      res.json({
        users,
        totalPages: Math.ceil(totalUsers / limit),
        currentPage: Number(page)
      });

    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

app.put(
  "/director/toggle-user/:id",
  authenticateToken,
  authorizeRoles("director"),
  async (req, res) => {
    const user = await User.findById(req.params.id);

    user.isActive = !user.isActive;
    await user.save();

    res.json({ message: "User status updated" });
  }
);

//Get All Vehicles

app.get(
  "/director/vehicles",
  authenticateToken,
  authorizeRoles("director"),
  async (req, res) => {
    const vehicles = await Vehicle.find();
    res.json(vehicles);
  }
);

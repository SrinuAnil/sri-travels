const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const cookieParser = require("cookie-parser");
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());

/* ================================
   DATABASE CONNECTION
================================ */

const uri = process.env.MONGO_URI;
const PORT = process.env.PORT || 3001;

mongoose
  .connect(uri)
  .then(() => {
    console.log("Connected to Sri Travels DB");
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => console.log("Error connecting to MongoDB Atlas:", err));

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
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  customerName: String,
  customerPhone: String,
  vehicleId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Vehicle",
  },
  vehicleType: String,
  fromLocation: String,
  toLocation: String,
  travelDate: Date,
  amount: Number,
  status: {
    type: String,
    enum: ["pending", "approved", "completed", "cancelled"],
    default: "pending",
  },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);
const Vehicle = mongoose.model("Vehicle", vehicleSchema);
const Booking = mongoose.model("Booking", bookingSchema);

/* ================================
   AUTH MIDDLEWARE
================================ */

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(401).json({ error: "Invalid JWT" });

  const token =
    req.cookies.jwt_token || 
    (req.headers.authorization &&
     req.headers.authorization.split(" ")[1]);

  console.log("token: ", token)

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
  "/book",
  authenticateToken,
  authorizeRoles("customer"),
  async (req, res) => {
    try {
      const {
        vehicleId,
        vehicleType,
        fromLocation,
        toLocation,
        travelDate,
        amount,
      } = req.body;

      const user = await User.findById(req.user.id);

      const booking = new Booking({
        customerId: user._id,
        customerName: user.name,
        customerPhone: user.phoneNumber,
        vehicleId,
        vehicleType,
        fromLocation,
        toLocation,
        travelDate,
        amount,
      });

      await booking.save();
      res.status(201).json({ message: "Booking Created" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// View Own Bookings

app.get(
  "/my-bookings",
  authenticateToken,
  authorizeRoles("customer"),
  async (req, res) => {
    const bookings = await Booking.find({ customerId: req.user.id });
    res.json(bookings);
  }
);

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
    const bookings = await Booking.find({ status: "completed" });

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

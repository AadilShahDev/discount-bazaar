import { type Request, type Response } from "express";
import User from "../models/User.js";
import { UserRole as UserRoleEnum } from "../types/enums.js";
import { generateOtp, hashPassword, signToken, verifyPassword } from "../utils/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";

interface SendOtpBody {
  phoneNumber?: string;
}

interface VerifyOtpBody {
  phoneNumber?: string;
  otp?: string;
  name?: string;
}

interface B2BLoginBody {
  identifier?: string;
  password?: string;
  role?: "Admin" | "Supplier";
}

interface SupplierRegisterBody {
  businessName?: string;
  contactNumber?: string;
  email?: string;
  password?: string;
}

interface SupplierVerifyOtpBody {
  contactNumber?: string;
  otp?: string;
}

/**
 * POST /api/auth/whatsapp/send
 * Generates a WhatsApp OTP, persists it (hashed-by-select) on the prospective
 * user record, and mocks the SMS-gateway send by logging to the console.
 */
export const sendOtp = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { phoneNumber } = req.body as SendOtpBody;
  if (!phoneNumber || !/^\+?\d{10,15}$/.test(phoneNumber)) {
    res.status(400).json({ error: "A valid phoneNumber is required." });
    return;
  }

  const existing = await User.findOne({ phoneNumber }).lean();
  if (existing && existing.role !== UserRoleEnum.Buyer) {
    res.status(403).json({ error: "WhatsApp login is reserved for buyers. Use the B2B login pages." });
    return;
  }

  const { code, expiresAt } = generateOtp();

  // Upsert a lightweight record purely to carry the OTP between send and verify.
  await User.updateOne(
    { phoneNumber },
    { $set: { whatsappOtp: code, otpExpiresAt: expiresAt } },
    { upsert: true },
  );

  // Mock SMS gateway — replace with real WhatsApp API when available.
  console.info(`[otp] -> ${phoneNumber}: ${code} (expires ${expiresAt.toISOString()})`);

  // In development, return the code so the frontend can display it for testing.
  const isDev = process.env.NODE_ENV !== "production";
  res.status(200).json({
    message: "OTP sent via WhatsApp.",
    ...(isDev ? { devOtp: code } : {}),
  });
});

/**
 * POST /api/auth/whatsapp/verify
 * Validates the OTP. If the user doesn't exist yet (first verification),
 * creates one with the default Buyer role. Returns a signed JWT.
 */
export const verifyOtp = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { phoneNumber, otp, name } = req.body as VerifyOtpBody;
  if (!phoneNumber || !otp) {
    res.status(400).json({ error: "phoneNumber and otp are required." });
    return;
  }

  const user = await User.findOne({ phoneNumber }).select("+whatsappOtp +otpExpiresAt");
  if (!user || !user.whatsappOtp || !user.otpExpiresAt) {
    res.status(400).json({ error: "No active OTP for this phone number. Request a new one." });
    return;
  }
  if (user.role !== UserRoleEnum.Buyer) {
    res.status(403).json({ error: "WhatsApp login is reserved for buyers. Use the B2B login pages." });
    return;
  }
  if (user.otpExpiresAt.getTime() < Date.now()) {
    res.status(400).json({ error: "OTP expired. Request a new one." });
    return;
  }
  if (user.whatsappOtp !== otp) {
    res.status(400).json({ error: "Invalid OTP." });
    return;
  }

  // First-time verification → materialise the Buyer account if not yet set up.
  if (!user.name) {
    user.name = name?.trim() || "New Buyer";
    user.role = user.role || UserRoleEnum.Buyer;
  }

  // Clear the OTP fields so they can't be replayed.
  user.whatsappOtp = undefined;
  user.otpExpiresAt = undefined;
  await user.save();

  const token = signToken({
    userId: user._id.toString(),
    role: user.role,
  });

  res.status(200).json({
    message: "Authentication successful.",
    token,
    user: {
      id: user._id,
      phoneNumber: user.phoneNumber,
      name: user.name,
      role: user.role,
    },
  });
});

export const loginB2B = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { identifier, password, role } = req.body as B2BLoginBody;
  if (!identifier || !password || !role) {
    res.status(400).json({ error: "identifier, password, and role are required." });
    return;
  }

  console.info(`[auth] B2B login attempt role=${role} identifier=${identifier.trim()}`);

  if (role !== UserRoleEnum.Admin && role !== UserRoleEnum.Supplier) {
    res.status(400).json({ error: "role must be Admin or Supplier." });
    return;
  }

  const normalized = identifier.trim().toLowerCase();
  const lookup = normalized.includes("@") ? { email: normalized } : { phoneNumber: identifier.trim() };

  const user = await User.findOne({ ...lookup, role }).select(
    "+passwordHash +passwordSalt",
  );
  if (!user || !user.passwordHash || !user.passwordSalt) {
    res.status(401).json({ error: "Invalid credentials." });
    return;
  }
  const ok = await verifyPassword(password, user.passwordSalt, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Invalid credentials." });
    return;
  }

  const token = signToken({ userId: user._id.toString(), role: user.role });
  res.status(200).json({
    message: "Authentication successful.",
    token,
    user: {
      id: user._id.toString(),
      phoneNumber: user.phoneNumber,
      name: user.name,
      role: user.role,
      verificationStatus: user.verificationStatus,
    },
  });
});

/**
 * POST /api/auth/supplier/register
 * Step 1: Creates a supplier account with role 'Supplier' and
 * verificationStatus 'Unverified'. Stores the password hash and sends
 * an OTP to the contact number for verification.
 *
 * The account is NOT usable until the OTP is verified via
 * POST /api/auth/supplier/verify-otp.
 */
export const registerSupplierApplication = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { businessName, contactNumber, email, password } = req.body as SupplierRegisterBody;

  if (!businessName || !contactNumber || !email || !password) {
    res.status(400).json({ error: "businessName, contactNumber, email, and password are required." });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "email must be a valid email address." });
    return;
  }
  if (!/^\+?\d{10,15}$/.test(contactNumber)) {
    res.status(400).json({ error: "contactNumber must be a valid phone number." });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: "password must be at least 6 characters." });
    return;
  }

  // Check for existing supplier with same phone or email
  const exists = await User.findOne({
    $or: [{ phoneNumber: contactNumber }, { email: email.toLowerCase() }],
  }).lean();
  if (exists) {
    res.status(409).json({ error: "An account already exists for this contact number or email." });
    return;
  }

  // Hash the password
  const { salt, hash } = await hashPassword(password);

  // Generate OTP for verification
  const { code, expiresAt } = generateOtp();

  // Create the supplier account. Registration ONLY creates the account —
  // no data is sent to admin. The supplier logs in and submits business
  // verification (KYC) from their dashboard, which is what triggers the
  // admin review queue.
  const user = await User.create({
    phoneNumber: contactNumber.trim(),
    email: email.trim().toLowerCase(),
    role: UserRoleEnum.Supplier,
    name: businessName.trim(),
    businessName: businessName.trim(),
    contactNumber: contactNumber.trim(),
    verificationStatus: "Unverified",
    contactVerification: { emailVerified: false, phoneVerified: false },
    passwordHash: hash,
    passwordSalt: salt,
    whatsappOtp: code,
    otpExpiresAt: expiresAt,
    supplierDetails: {
      companyName: businessName.trim(),
      contactPerson: businessName.trim(),
      rating: 0,
      isActive: false,
      catalogs: [],
      stockAvailable: 0,
    },
  });

  // Mock SMS gateway — log the OTP
  console.info(`[supplier otp] -> ${contactNumber}: ${code} (expires ${expiresAt.toISOString()})`);

  // In development, return the code so the frontend can display it for testing.
  const isDev = process.env.NODE_ENV !== "production";
  res.status(201).json({
    message: "Account created. Verify the OTP sent to your contact number to complete registration.",
    data: {
      userId: user._id.toString(),
      contactNumber: user.phoneNumber,
    },
    ...(isDev ? { devOtp: code } : {}),
  });
});

/**
 * POST /api/auth/supplier/verify-otp
 * Step 2: Verifies the OTP sent during supplier registration.
 * Once verified, the account is fully registered and the user can log in.
 * The verificationStatus stays 'Pending' (meaning pending business/KYC
 * verification by admin), but the account is now usable for login.
 */
export const verifySupplierOtp = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { contactNumber, otp } = req.body as SupplierVerifyOtpBody;

  if (!contactNumber || !otp) {
    res.status(400).json({ error: "contactNumber and otp are required." });
    return;
  }

  const user = await User.findOne({ phoneNumber: contactNumber, role: UserRoleEnum.Supplier }).select(
    "+whatsappOtp +otpExpiresAt",
  );
  if (!user || !user.whatsappOtp || !user.otpExpiresAt) {
    res.status(400).json({ error: "No active OTP for this contact number. Request a new one." });
    return;
  }
  if (user.otpExpiresAt.getTime() < Date.now()) {
    res.status(400).json({ error: "OTP expired. Request a new one." });
    return;
  }
  if (user.whatsappOtp !== otp) {
    res.status(400).json({ error: "Invalid OTP." });
    return;
  }

  // Clear OTP fields
  user.whatsappOtp = undefined;
  user.otpExpiresAt = undefined;
  await user.save();

  res.status(200).json({
    message: "OTP verified successfully. Your supplier account is now registered. Please log in to continue.",
    data: {
      userId: user._id.toString(),
      verified: true,
    },
  });
});

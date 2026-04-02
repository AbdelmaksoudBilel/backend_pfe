// =============================================================================
// routes/auth.route.js  —  Authentification
// =============================================================================
// Base URL : /api/auth
//   POST /api/auth/register         → inscription parent
//   GET  /api/auth/verify/:token    → confirmation email
//   POST /api/auth/login            → connexion
//   POST /api/auth/logout           → déconnexion
//   GET  /api/auth/me               → profil connecté
//   POST /api/auth/forgot-password  → demande réinitialisation
//   POST /api/auth/reset-password   → nouvelle valeur mot de passe
// =============================================================================

const express = require("express");
const crypto  = require("crypto");
const jwt     = require("jsonwebtoken");
const User    = require("../models/schema_users");
const email   = require("../services/emailService");
const { protect } = require("../middleware/auth");

const router = express.Router();

const signToken = (id) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET manquant dans le fichier .env");
  return jwt.sign({ id }, secret, {
    expiresIn: process.env.JWT_EXPIRE || "7d",
  });
};

// =============================================================================
// POST /api/auth/register  →  Inscription parent
// Logique :
//   1. Compte existe + email vérifié   → 400 "déjà utilisé"
//   2. Compte existe + email NON vérifié → renvoyer un nouveau mail de vérification
//   3. Pas de compte                    → créer + envoyer mail
// =============================================================================
router.post("/register", async (req, res) => {
  try {
    const { firstName, lastName, email: userEmail, password, phone, language } = req.body;

    // ── Validation ────────────────────────────────────────────────
    if (!firstName || !lastName || !userEmail || !password)
      return res.status(400).json({ message: "Tous les champs obligatoires sont requis" });

    if (password.length < 8)
      return res.status(400).json({ message: "Le mot de passe doit contenir au moins 8 caractères" });

    // ── Étape 1 : vérifier si le compte existe ────────────────────
    const existing = await User.findOne({ email: userEmail.toLowerCase().trim() });

    if (existing) {

      // Cas A : email déjà vérifié → bloquer
      if (existing.isEmailVerified) {
        return res.status(400).json({ message: "Cette adresse email est déjà utilisée" });
      }

      // Cas B : email NON vérifié → générer nouveau token + renvoyer mail
      const newToken = crypto.randomBytes(32).toString("hex");

      await User.findByIdAndUpdate(existing._id, {
        verificationToken : newToken,
        firstName         : firstName.trim(),
        lastName          : lastName.trim(),
        phone             : phone?.trim() || existing.phone,
        language          : language || existing.language,
      });

      await email.sendVerificationEmail(existing.email, firstName.trim(), newToken);

      return res.status(200).json({
        message: "Un nouveau lien de confirmation a été envoyé à votre adresse email.",
      });
    }

    // ── Étape 2 : créer le compte ─────────────────────────────────
    const verificationToken = crypto.randomBytes(32).toString("hex");

    const user = await User.create({
      firstName      : firstName.trim(),
      lastName       : lastName.trim(),
      email          : userEmail.toLowerCase().trim(),
      password,
      phone          : phone?.trim() || undefined,
      language       : language || "fr",
      role           : "parent",
      isEmailVerified: false,
      isApproved     : false,
      isFirstLogin   : true,
      verificationToken,
    });

    await email.sendVerificationEmail(user.email, user.firstName, verificationToken);

    // Notifier admin
    const admin = await User.findOne({ role: "admin" });
    if (admin) {
      await email.sendAdminNotification(
        admin.email,
        `${user.firstName} ${user.lastName}`,
        user.email
      );
    }

    return res.status(201).json({
      message: "Inscription réussie. Vérifiez votre email puis attendez l'approbation.",
    });

  } catch (err) {
    console.error("Register error:", err.message);
    if (err.code === 11000)
      return res.status(400).json({ message: "Cette adresse email est déjà utilisée" });
    res.status(500).json({ message: "Erreur serveur. Réessayez dans quelques instants." });
  }
});

// =============================================================================
// GET /api/auth/verify/:token  →  Confirmation email
// =============================================================================
router.get("/verify/:token", async (req, res) => {
  try {
    const user = await User.findOne({ verificationToken: req.params.token }).select("+verificationToken");
    if (!user)
      return res.status(400).json({ message: "Lien invalide ou expiré" });

    user.isEmailVerified   = true;
    user.verificationToken = undefined;
    await user.save();

    res.json({ message: "Email vérifié avec succès. Votre compte sera activé après approbation." });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// POST /api/auth/login  →  Connexion + token JWT
// =============================================================================
router.post("/login", async (req, res) => {
  try {
    const { email: userEmail, password } = req.body;

    if (!userEmail || !password)
      return res.status(400).json({ message: "Email et mot de passe requis" });

    const user = await User.findOne({ email: userEmail.toLowerCase().trim() });

    if (!user || !(await user.matchPassword(password)))
      return res.status(401).json({ message: "Email ou mot de passe incorrect" });

    if (!user.isEmailVerified)
      return res.status(403).json({
        message: "Veuillez vérifier votre email avant de vous connecter",
        code: "EMAIL_NOT_VERIFIED",
      });

    if (!user.isApproved && user.role !== "admin")
      return res.status(403).json({
        message: "Votre compte est en attente d'approbation par l'équipe Ma Chance",
        code: "ACCOUNT_PENDING",
      });

    // Mettre à jour lastLogin + isFirstLogin → false après 1er login
    const isFirstLogin = user.isFirstLogin === true;
    await User.findByIdAndUpdate(user._id, {
      lastLogin   : new Date(),
      isFirstLogin: false,
    });

    const token = signToken(user._id);

    res.json({
      token,
      user: {
        _id         : user._id,
        firstName   : user.firstName,
        lastName    : user.lastName,
        email       : user.email,
        role        : user.role,
        language    : user.language,
        avatar      : user.avatar,
        isFirstLogin,   // ← frontend redirige vers /setup-child si true
      },
    });

  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ message: "Erreur serveur. Réessayez dans quelques instants." });
  }
});

// =============================================================================
// POST /api/auth/logout
// =============================================================================
router.post("/logout", protect, (req, res) => {
  res.json({ message: "Déconnexion réussie" });
});

// =============================================================================
// GET /api/auth/me  →  Profil utilisateur connecté
// =============================================================================
router.get("/me", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password -verificationToken");
    if (!user) return res.status(404).json({ message: "Utilisateur non trouvé" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// POST /api/auth/forgot-password  →  Envoi lien réinitialisation
// =============================================================================
router.post("/forgot-password", async (req, res) => {
  try {
    const { email: userEmail } = req.body;
    if (!userEmail)
      return res.status(400).json({ message: "Email requis" });

    const user = await User.findOne({ email: userEmail.toLowerCase().trim() });

    // Réponse identique qu'il existe ou non (sécurité anti-enumération)
    if (!user) {
      return res.json({ message: "Si cet email existe, un lien a été envoyé." });
    }

    const resetToken   = crypto.randomBytes(32).toString("hex");
    const resetExpires = new Date(Date.now() + 30 * 60 * 1000); // 30 min

    await User.findByIdAndUpdate(user._id, {
      passwordResetToken  : resetToken,
      passwordResetExpires: resetExpires,
    });

    await email.sendPasswordResetEmail(user.email, user.firstName, resetToken);

    res.json({ message: "Si cet email existe, un lien a été envoyé." });

  } catch (err) {
    console.error("Forgot-password error:", err.message);
    res.status(500).json({ message: "Erreur serveur. Réessayez dans quelques instants." });
  }
});

// =============================================================================
// POST /api/auth/reset-password  →  Changer le mot de passe
// =============================================================================
router.post("/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password)
      return res.status(400).json({ message: "Token et nouveau mot de passe requis" });

    if (password.length < 8)
      return res.status(400).json({ message: "Le mot de passe doit contenir au moins 8 caractères" });

    const user = await User.findOne({
      passwordResetToken  : token,
      passwordResetExpires: { $gt: new Date() },
    });

    if (!user)
      return res.status(400).json({ message: "Lien invalide ou expiré (30 minutes)" });

    user.password             = password;
    user.passwordResetToken   = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    res.json({ message: "Mot de passe réinitialisé avec succès. Connectez-vous." });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
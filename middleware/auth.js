const jwt  = require("jsonwebtoken");
const User = require("../models/schema_users");

// ── Vérifier token JWT ────────────────────────────────────────────────────────
exports.protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization?.startsWith("Bearer "))
    token = req.headers.authorization.split(" ")[1];

  if (!token)
    return res.status(401).json({ message: "Non autorisé — token manquant" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select("-password");
    if (!req.user)
      return res.status(401).json({ message: "Utilisateur introuvable" });
    next();
  } catch {
    res.status(401).json({ message: "Token invalide" });
  }
};

// ── Vérifier rôle admin ───────────────────────────────────────────────────────
exports.adminOnly = (req, res, next) => {
  if (req.user?.role !== "admin")
    return res.status(403).json({ message: "Accès réservé aux administrateurs" });
  next();
};

// ── Vérifier compte approuvé ──────────────────────────────────────────────────
exports.approved = (req, res, next) => {
  if (!req.user?.isApproved)
    return res.status(403).json({ message: "Compte en attente de validation" });
  next();
};
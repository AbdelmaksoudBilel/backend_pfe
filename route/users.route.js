const express = require("express");
const multer = require("multer");
const path = require("path");
const User = require("../models/schema_users");
const { protect, adminOnly } = require("../middleware/auth");

const router = express.Router();

// ── Upload avatar ─────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
    destination: "uploads/avatars/",
    filename: (_, file, cb) =>
        cb(null, `avatar_${Date.now()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 } }); 

// GET /api/users/me  →  son propre profil
router.get("/me", protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select("-password");
        res.json(user);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// PUT /api/users/me  →  modifier firstName, lastName, phone, language
router.put("/me", protect, async (req, res) => {
    try {
        const allowed = ["firstName", "lastName", "phone", "language"];
        const updates = {};
        allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

        const user = await User.findByIdAndUpdate(
            req.user._id,
            updates,
            { new: true, runValidators: true }
        ).select("-password");

        res.json(user);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// PUT /api/users/me/password  →  changer le mot de passe
router.put("/me/password", protect, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword)
            return res.status(400).json({ message: "Les deux mots de passe sont requis" });

        const user = await User.findById(req.user._id);
        const ok = await user.matchPassword(currentPassword);
        if (!ok) return res.status(401).json({ message: "Mot de passe actuel incorrect" });

        user.password = newPassword;   // hashé automatiquement par le pre-save hook
        await user.save();

        res.json({ message: "Mot de passe modifié avec succès" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// PUT /api/users/me/avatar  →  upload photo de profil
router.put("/me/avatar", protect, upload.single("avatar"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ message: "Aucun fichier reçu" });

        const user = await User.findByIdAndUpdate(
            req.user._id,
            { avatar: req.file.path },
            { new: true }
        ).select("-password");

        res.json(user);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// DELETE /api/users/me  →  supprimer son propre compte
router.delete("/me", protect, async (req, res) => {
    try {
        await User.findByIdAndDelete(req.user._id);
        res.json({ message: "Compte supprimé" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// GET /api/users  →  liste de tous les parents (admin)
router.get("/", protect, adminOnly, async (req, res) => {
    try {
        const { approved, page = 1, limit = 20 } = req.query;
        const filter = { role: "parent" };
        if (approved !== undefined) filter.isApproved = approved === "true";

        const users = await User.find(filter)
            .select("-password")
            .sort("-createdAt")
            .skip((page - 1) * limit)
            .limit(Number(limit));

        const total = await User.countDocuments(filter);

        res.json({ users, total, page: Number(page), pages: Math.ceil(total / limit) });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// GET /api/users/:id  →  détail d'un utilisateur (admin)
router.get("/:id", protect, adminOnly, async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select("-password");
        if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });
        res.json(user);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// PUT /api/users/:id/approve  →  approuver un parent (admin)
router.put("/:id/approve", protect, adminOnly, async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(
            req.params.id,
            { isApproved: true },
            { new: true }
        ).select("-password");
        if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });
        res.json({ message: "Parent approuvé", user });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// PUT /api/users/:id/reject  →  rejeter/bloquer un parent (admin)
router.put("/:id/reject", protect, adminOnly, async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(
            req.params.id,
            { isApproved: false },
            { new: true }
        ).select("-password");
        if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });
        res.json({ message: "Accès rejeté", user });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// DELETE /api/users/:id  →  supprimer un utilisateur (admin)
router.delete("/:id", protect, adminOnly, async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);
        if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });
        res.json({ message: "Utilisateur supprimé" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
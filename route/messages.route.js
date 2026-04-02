const express      = require("express");
const multer       = require("multer");
const path         = require("path");
const axios        = require("axios");
const FormData     = require("form-data");
const fs           = require("fs");
const Message      = require("../models/schema_messages");
const Response     = require("../models/schema_responses");
const Conversation = require("../models/schema_conversations");
const Child        = require("../models/schema_children");
const { protect, approved } = require("../middleware/auth");

const router = express.Router();

const PYTHON_API = process.env.PYTHON_API_URL || "http://localhost:8000";

// ── Upload média ──────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: "uploads/chat/",
  filename   : (_, file, cb) =>
    cb(null, `media_${Date.now()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },  // 50MB
  fileFilter: (_, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|mp4|avi|mov|mp3|wav|ogg|webm/;
    cb(null, allowed.test(path.extname(file.originalname).toLowerCase()));
  },
});

// =============================================================================
// GET /api/messages/:convId  →  historique d'une conversation
// =============================================================================
router.get("/:convId", protect, approved, async (req, res) => {
  try {
    // Vérifier appartenance de la conversation
    const conv = await Conversation.findOne({
      _id   : req.params.convId,
      userId: req.user._id,
    });
    if (!conv) return res.status(404).json({ message: "Conversation introuvable" });

    const { page = 1, limit = 50 } = req.query;

    // Récupérer messages + réponses associées en une seule passe
    const messages = await Message.find({ conversationId: req.params.convId })
      .sort("createdAt")
      .skip((page - 1) * limit)
      .limit(Number(limit));

    // Joindre les réponses IA aux messages assistant
    const msgIds   = messages.map(m => m._id);
    const responses = await Response.find({ messageId: { $in: msgIds } });
    const respMap  = {};
    responses.forEach(r => { respMap[r.messageId.toString()] = r; });

    const result = messages.map(m => ({
      ...m.toObject(),
      response: respMap[m._id.toString()] || null,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// POST /api/messages/:convId  →  message texte + réponse IA
// =============================================================================
router.post("/:convId", protect, approved, async (req, res) => {
  const startTotal = Date.now();

  try {
    const conv = await Conversation.findOne({
      _id: req.params.convId, userId: req.user._id,
    });
    if (!conv) return res.status(404).json({ message: "Conversation introuvable" });

    const child = await Child.findById(conv.childId);
    if (!child) return res.status(404).json({ message: "Enfant introuvable" });

    const { message, language } = req.body;
    if (!message?.trim()) return res.status(400).json({ message: "Message vide" });

    const sentAt = new Date();

    // 1. Sauvegarder le message parent
    const userMsg = await Message.create({
      conversationId: conv._id,
      role          : "user",
      message       : message.trim(),
      sentAt,
      deliveredAt   : new Date(),
    });

    // 2. Appeler le pipeline IA Python
    const startRag = Date.now();
    const pyRes = await axios.post(`${PYTHON_API}/chat`, {
      question       : message,
      profil         : child.prediction || "inconnu",
      profile_detecter: child.profileDetected || [],
      conversation   : conv.resume || "",
      mots_cles      : conv.motsCles || [],
      child          : {
        firstName : child.firstName,
        prediction: child.prediction,
        A1: child.A1, A2: child.A2, A3: child.A3, A4: child.A4, A5: child.A5,
        A6: child.A6, A7: child.A7, A8: child.A8, A9: child.A9, A10: child.A10,
      },
      language: language || req.user.language || "fr",
    });

    const ragDuration   = Date.now() - startRag;
    const totalDuration = Date.now() - startTotal;
    const pyData        = pyRes.data;

    // 3. Sauvegarder le message assistant
    const assistantMsg = await Message.create({
      conversationId: conv._id,
      role          : "assistant",
      message       : pyData.response || "",
      sentAt        : new Date(),
      deliveredAt   : new Date(),
      processingMs  : totalDuration,
    });

    // 4. Sauvegarder la réponse complète
    const response = await Response.create({
      messageId      : assistantMsg._id,
      reponse        : pyData.response || "",
      score          : pyData.score ?? null,
      webUsed        : pyData.web_used ?? false,
      sources        : pyData.sources ?? [],
      lang           : pyData.language || "fr",
      generatedAt    : new Date(),
      ragDurationMs  : ragDuration,
      llmDurationMs  : pyData.llm_duration_ms ?? null,
      totalDurationMs: totalDuration,
    });

    // 5. Mettre à jour mémoire de la conversation
    await Conversation.findByIdAndUpdate(conv._id, {
      resume        : pyData.resume || conv.resume,
      motsCles      : pyData.mots_cles || conv.motsCles,
      $inc          : { totalMessages: 2 },
    });

    // 6. Mettre à jour profile_detecter de l'enfant si changement détecté
    if (pyData.profile_detecter?.length) {
      await Child.findByIdAndUpdate(child._id, {
        profileDetected: pyData.profile_detecter,
      });
    }

    res.status(201).json({
      userMessage     : userMsg,
      assistantMessage: assistantMsg,
      response,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// POST /api/messages/:convId/media  →  image/vidéo/audio + réponse IA
// =============================================================================
router.post(
  "/:convId/media",
  protect, approved,
  upload.single("media"),
  async (req, res) => {
    const startTotal = Date.now();
    let   mediaPath  = null;

    try {
      const conv = await Conversation.findOne({
        _id: req.params.convId, userId: req.user._id,
      });
      if (!conv) return res.status(404).json({ message: "Conversation introuvable" });

      if (!req.file) return res.status(400).json({ message: "Fichier manquant" });

      mediaPath = req.file.path;
      const child = await Child.findById(conv.childId);

      // Déterminer le type de fichier
      const ext      = path.extname(req.file.originalname).toLowerCase();
      const isAudio  = /mp3|wav|ogg|webm/.test(ext);
      const isVideo  = /mp4|avi|mov/.test(ext);
      const fileType = isAudio ? "audio" : isVideo ? "video" : "image";

      // Envoyer le fichier au pipeline Python
      const form = new FormData();
      form.append("file",     fs.createReadStream(mediaPath));
      form.append("question", req.body.message || "");
      form.append("profil",   child.prediction || "inconnu");
      form.append("profile_detecter", JSON.stringify(child.profileDetected || []));
      form.append("conversation",     conv.resume || "");
      form.append("language",         req.body.language || req.user.language || "fr");
      form.append("child",            JSON.stringify({
        firstName : child.firstName,
        prediction: child.prediction,
      }));

      const startRag = Date.now();
      const pyRes    = await axios.post(`${PYTHON_API}/chat/media`, form, {
        headers: form.getHeaders(),
      });

      const ragDuration   = Date.now() - startRag;
      const totalDuration = Date.now() - startTotal;
      const pyData        = pyRes.data;

      // Sauvegarder message parent (avec fichier)
      const userMsg = await Message.create({
        conversationId: conv._id,
        role          : "user",
        message       : req.body.message || "",
        fileUrl       : mediaPath,
        fileType,
        isVoice       : isAudio,
        sentAt        : new Date(),
        deliveredAt   : new Date(),
      });

      // Sauvegarder message assistant
      const assistantMsg = await Message.create({
        conversationId: conv._id,
        role          : "assistant",
        message       : pyData.response || "",
        sentAt        : new Date(),
        deliveredAt   : new Date(),
        processingMs  : totalDuration,
      });

      // Sauvegarder réponse
      const response = await Response.create({
        messageId      : assistantMsg._id,
        reponse        : pyData.response || "",
        score          : pyData.score ?? null,
        webUsed        : pyData.web_used ?? false,
        sources        : pyData.sources ?? [],
        lang           : pyData.language || "fr",
        generatedAt    : new Date(),
        ragDurationMs  : ragDuration,
        llmDurationMs  : pyData.llm_duration_ms ?? null,
        totalDurationMs: totalDuration,
      });

      await Conversation.findByIdAndUpdate(conv._id, {
        resume  : pyData.resume || conv.resume,
        motsCles: pyData.mots_cles || conv.motsCles,
        $inc    : { totalMessages: 2 },
      });

      res.status(201).json({ userMessage: userMsg, assistantMessage: assistantMsg, response });
    } catch (err) {
      if (mediaPath) fs.unlink(mediaPath, () => {});
      res.status(500).json({ message: err.message });
    }
  }
);

// =============================================================================
// PUT /api/messages/:msgId/read  →  marquer un message comme lu
// =============================================================================
router.put("/:msgId/read", protect, approved, async (req, res) => {
  try {
    const msg = await Message.findByIdAndUpdate(
      req.params.msgId,
      { isRead: true },
      { new: true }
    );
    if (!msg) return res.status(404).json({ message: "Message introuvable" });
    res.json(msg);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// DELETE /api/messages/:msgId  →  supprimer un message + sa réponse
// =============================================================================
router.delete("/:msgId", protect, approved, async (req, res) => {
  try {
    const msg = await Message.findById(req.params.msgId);
    if (!msg) return res.status(404).json({ message: "Message introuvable" });

    // Vérifier que le message appartient à une conversation du parent
    const conv = await Conversation.findOne({
      _id: msg.conversationId, userId: req.user._id,
    });
    if (!conv) return res.status(403).json({ message: "Accès refusé" });

    await Response.deleteOne({ messageId: msg._id });
    await msg.deleteOne();

    res.json({ message: "Message supprimé" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
const express = require("express");
const multer = require("multer");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const Message = require("../models/schema_messages");
const Response = require("../models/schema_responses");
const Conversation = require("../models/schema_conversations");
const Child = require("../models/schema_children");
const { protect, approved } = require("../middleware/auth");

const router = express.Router();

const PYTHON_API = process.env.PYTHON_API_URL || "http://localhost:8000";

// ── Upload média ──────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: "uploads/chat/",
  filename: (_, file, cb) =>
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
      _id: req.params.convId,
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
    const msgIds = messages.map(m => m._id);
    const responses = await Response.find({ messageId: { $in: msgIds } });
    const respMap = {};
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
      role: "user",
      message: message.trim(),
      sentAt,
      deliveredAt: new Date(),
    });

    // Récupérer les 3 derniers messages (ordre chronologique)
    const lastMessages = await Message.find({ conversationId: conv._id })
      .sort({ createdAt: -1 })
      .limit(3)
      .lean();

    // Remettre dans l'ordre ancien → récent
    lastMessages.reverse();

    // Récupérer les réponses associées
    const messageIds = lastMessages.map(m => m._id);

    const responses = await Response.find({ messageId: { $in: messageIds } })
      .limit(3)
      .lean();

    // Mapper messageId → réponse
    const responseMap = {};
    responses.forEach(r => {
      responseMap[r.messageId.toString()] = r.reponse;
    });

    // Construire le format final
    let formatted = [];

    lastMessages.forEach(m => {
      formatted.push({ role: 'user', content: m.message });

      if (responseMap[m._id.toString()]) {
        formatted.push({ role: 'assistant', content: responseMap[m._id.toString()] });
      }
    });

    // Résultat final
    const lastConversation = formatted.join("\n");
    console.log(lastConversation);

    // 2. Appeler le pipeline IA Python
    const startRag = Date.now();
    const pyRes = await axios.post(`${PYTHON_API}/chat`, {
      question: message,

      profile: {
        prediction: child.prediction,
        Age_Years: new Date().getFullYear() - child.birthDate.getFullYear(),
        Sex: child.gender,
        A1: child.A1, A2: child.A2, A3: child.A3,
        A4: child.A4, A5: child.A5, A6: child.A6,
        A7: child.A7, A8: child.A8, A9: child.A9, A10: child.A10,

        // RM features si tu veux enrichir le RAG
        PR_QF1A: child.PR_QF1A,
        PR_QO1_A_COMBINE: child.PR_QO1_A_COMBINE,
        PR_QO1_C_COMBINE: child.PR_QO1_C_COMBINE,
        PR_QO1_E_COMBINE: child.PR_QO1_E_COMBINE,
        PR_QN1_G: child.PR_QN1_G,
        PR_QK1: child.PR_QK1,
        PR_QQ: child.PR_QQ,
      },

      conversation: {
        last_5_messages: formatted || [], // ⚠️ IMPORTANT (format list)
        summary: conv.resume || "",
        keywords: conv.motsCles || [],
        total_messages: conv.totalMessages || 0,
      },

      child: {
        id: child._id,
        profile_detecter: child.profileDetected || [],
      }
    });

    const ragDuration = Date.now() - startRag;
    const totalDuration = Date.now() - startTotal;
    const pyData = pyRes.data;
    console.log(pyData);

    // FIX : extraire aux deux niveaux
    const { profileDetected, resume, motsCles, reponse } = extractPythonUpdates(pyData);

    // 4. Sauvegarder la réponse complète
    const response = await Response.create({
      messageId: userMsg._id,
      reponse: pyData.answer || "",
      score: pyData.rag_score ?? null,
      webUsed: pyData.web_triggered ?? false,
      sources: pyData.sources ?? [],
      lang: pyData.parent_lang || "fr",
      generatedAt: new Date(),
      ragDurationMs: ragDuration,
      llmDurationMs: pyData.llm_duration_ms ?? null,
      totalDurationMs: totalDuration,
    });

    // FIX : même logique de sauvegarde
    const convUpdate = { $inc: { totalMessages: 2 } };
    if (resume) convUpdate.resume = resume;
    if (motsCles?.length) convUpdate.motsCles = motsCles;
    await Conversation.findByIdAndUpdate(conv._id, convUpdate);

    if (profileDetected?.length) {
      await Child.findByIdAndUpdate(child._id, { profileDetected });
    }

    res.status(201).json({
      message: userMsg,
      response: {
        _id: response._id,
        role: "assistant",
        message: response.reponse, // ⚠️ IMPORTANT
        sentAt: new Date(),
      },
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
    let mediaPath = null;

    try {
      const conv = await Conversation.findOne({
        _id: req.params.convId, userId: req.user._id,
      });
      if (!conv) return res.status(404).json({ message: "Conversation introuvable" });

      if (!req.file) return res.status(400).json({ message: "Fichier manquant" });

      mediaPath = req.file.path;
      const child = await Child.findById(conv.childId);

      // Déterminer le type de fichier
      const ext = path.extname(req.file.originalname).toLowerCase();
      const isAudio = /mp3|wav|ogg|webm/.test(ext);
      const isVideo = /mp4|avi|mov/.test(ext);
      const fileType = isAudio ? "audio" : isVideo ? "video" : "image";

      // Envoyer le fichier au pipeline Python
      const form = new FormData();

      // ✅ fichier (respecter audio OU media)
      if (isAudio) {
        form.append("audio", fs.createReadStream(mediaPath));
      } else {
        form.append("media", fs.createReadStream(mediaPath));
      }

      // ✅ texte
      form.append("question", req.body.message || "");

      // ✅ profile → JSON STRING
      form.append("profile", JSON.stringify({
        prediction: child.prediction || "inconnu"
      }));

      // ✅ conversation → JSON STRING
      form.append("conversation", JSON.stringify({
        last_5_messages: [], // (ou ton historique formaté)
        summary: conv.resume || "",
        keywords: conv.motsCles || [],
        total_messages: conv.totalMessages || 0
      }));

      // ✅ child → JSON STRING
      form.append("child", JSON.stringify({
        child: {
          id: child._id,
          profile_detecter: child.profileDetected || [],
        },
        prediction: child.prediction,
      }));

      const startRag = Date.now();
      const pyRes = await axios.post(`${PYTHON_API}/chat/media`, form, {
        headers: form.getHeaders(),
      });

      const ragDuration = Date.now() - startRag;
      const totalDuration = Date.now() - startTotal;
      const pyData = pyRes.data;
      const { profileDetected, resume, motsCles, reponse } = extractPythonUpdates(pyData);

      // Sauvegarder message parent (avec fichier)
      const userMsg = await Message.create({
        conversationId: conv._id,
        role: "user",
        message: req.body.message || "",
        fileUrl: mediaPath,
        fileType,
        isVoice: isAudio,
        sentAt: new Date(),
        deliveredAt: new Date(),
      });

      // FIX : même logique de sauvegarde
      const convUpdate = { $inc: { totalMessages: 2 } };
      if (resume) convUpdate.resume = resume;
      if (motsCles?.length) convUpdate.motsCles = motsCles;
      await Conversation.findByIdAndUpdate(conv._id, convUpdate);

      if (profileDetected?.length) {
        await Child.findByIdAndUpdate(child._id, { profileDetected });
      }
      // // Sauvegarder message assistant
      // const assistantMsg = await Message.create({
      //   conversationId: conv._id,
      //   role: "assistant",
      //   message: pyData.response || "",
      //   sentAt: new Date(),
      //   deliveredAt: new Date(),
      //   processingMs: totalDuration,
      // });

      // Sauvegarder réponse
      const response = await Response.create({
        messageId: userMsg._id,
        reponse: pyData.answer || "",
        score: pyData.rag_score ?? null,
        webUsed: pyData.web_triggered ?? false,
        sources: pyData.sources ?? [],
        lang: pyData.parent_lang || "fr",
        generatedAt: new Date(),
        ragDurationMs: ragDuration,
        llmDurationMs: pyData.llm_duration_ms ?? null,
        totalDurationMs: totalDuration,
      });

      await Conversation.findByIdAndUpdate(conv._id, {
        resume: pyData.resume || conv.resume,
        motsCles: pyData.mots_cles || conv.motsCles,
        $inc: { totalMessages: 2 },
      });

      res.status(201).json({
        message: userMsg,
        response: {
          _id: response._id,
          role: "assistant",
          message: response.reponse, // ⚠️ IMPORTANT
          sentAt: new Date(),
        },
      });
    } catch (err) {
      if (mediaPath) fs.unlink(mediaPath, () => { });
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

// ─────────────────────────────────────────────────────────────────
// Helper — Extraire les valeurs Python en lisant racine ET updates
// CORRECTION BUG 3 : Python peut retourner les données aux deux niveaux
// ─────────────────────────────────────────────────────────────────
function extractPythonUpdates(pyData) {
  const updates = pyData.updates || {};

  // FIX BUG 1 : lire profile_detecter au niveau racine d'abord
  const profileDetected =
    (pyData.profile_detecter?.length ? pyData.profile_detecter : null) ||
    (updates.profile_detecter?.length ? updates.profile_detecter : null) ||
    null;

  // FIX BUG 2 : lire resume/keywords aux deux niveaux
  const resume =
    (typeof pyData.resume === "string" && pyData.resume.trim() ? pyData.resume : null) ||
    (typeof updates.summary === "string" && updates.summary.trim() ? updates.summary : null) ||
    null;

  const motsCles =
    (pyData.mots_cles?.length ? pyData.mots_cles : null) ||
    (updates.keywords?.length ? updates.keywords : null) ||
    null;

  // La réponse texte peut être dans answer (nouveau pipeline) ou response (legacy)
  const reponse = pyData.answer || pyData.response || "";

  return { profileDetected, resume, motsCles, reponse };
}

module.exports = router;
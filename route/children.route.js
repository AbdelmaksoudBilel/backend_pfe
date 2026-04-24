// backend/root/children.route.js
// =============================================================================
// Routes enfants — avec upload photo de visage (multer) + prédiction ML/CNN
// Base URL : /api/children
// =============================================================================

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const Child = require("../models/schema_children");
const { protect, adminOnly } = require("../middleware/auth");

const router = express.Router();
const PYTHON_API = process.env.PYTHON_API_URL || "http://localhost:8000";

// ── Configuration multer (upload photos visage) ─────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "../uploads/faces");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `face_${req.user._id}_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Seules les images sont acceptées"));
  },
});

// ── Helpers : conversion form data → schema ──────────────────────
function parseFormToChild(body) {
  const toNum = v => (v !== undefined && v !== "" ? Number(v) : null);
  return {
    firstName: body.firstName,
    lastName: body.lastName,
    birthDate: body.birthDate,
    gender: body.gender,

    // Q-Chat-10 binaire
    A1: toNum(body.A1), A2: toNum(body.A2), A3: toNum(body.A3),
    A4: toNum(body.A4), A5: toNum(body.A5), A6: toNum(body.A6),
    A7: toNum(body.A7), A8: toNum(body.A8), A9: toNum(body.A9),
    A10: toNum(body.A10),
    QChatScore: toNum(body.QChatScore),

    // Réponses brutes Q-Chat
    A1_raw: toNum(body.A1_raw), A2_raw: toNum(body.A2_raw),
    A3_raw: toNum(body.A3_raw), A4_raw: toNum(body.A4_raw),
    A5_raw: toNum(body.A5_raw), A6_raw: toNum(body.A6_raw),
    A7_raw: toNum(body.A7_raw), A8_raw: toNum(body.A8_raw),
    A9_raw: toNum(body.A9_raw), A10_raw: toNum(body.A10_raw),

    // Variables comportementales
    jaundice: toNum(body.jaundice),
    familyMemWithASD: toNum(body.familyMemWithASD),
    whoCompletedTest: toNum(body.whoCompletedTest),
    socialResponsivenessScale: toNum(body.socialResponsivenessScale),
    speechDelayDisorder: toNum(body.speechDelayDisorder),
    learningDisorder: toNum(body.learningDisorder),
    geneticDisorders: toNum(body.geneticDisorders),
    depression: toNum(body.depression),
    globalDevelopmentalDelay: toNum(body.globalDevelopmentalDelay),
    socialBehaviouralIssues: toNum(body.socialBehaviouralIssues),
    anxietyDisorder: toNum(body.anxietyDisorder),
    childhoodAutismRatingScale: toNum(body.childhoodAutismRatingScale),

    // DS Survey RM
    PR_AGE1: toNum(body.PR_AGE1),
    PR_Q3D: toNum(body.PR_Q3D),
    PR_QF1A: toNum(body.PR_QF1A),
    PR_QG1A: toNum(body.PR_QG1A),
    PR_QH1A: toNum(body.PR_QH1A),
    PR_QH1B: toNum(body.PR_QH1B),
    PR_QI1: toNum(body.PR_QI1),
    PR_QJ1: toNum(body.PR_QJ1),
    PR_QK1: toNum(body.PR_QK1),
    PR_QQ: toNum(body.PR_QQ),
    PR_QN1_A: toNum(body.PR_QN1_A || 1),
    PR_QN1_B: toNum(body.PR_QN1_B),
    PR_QN1_C: toNum(body.PR_QN1_C),
    PR_QN1_D: toNum(body.PR_QN1_D),
    PR_QN1_E: toNum(body.PR_QN1_E),
    PR_QN1_F: toNum(body.PR_QN1_F),
    PR_QN1_G: toNum(body.PR_QN1_G),
    PR_QN1_H: toNum(body.PR_QN1_H),
    PR_QO1_A_COMBINE: toNum(body.PR_QO1_A_COMBINE),
    PR_QO1_B_COMBINE: toNum(body.PR_QO1_B_COMBINE),
    PR_QO1_C_COMBINE: toNum(body.PR_QO1_C_COMBINE),
    PR_QO1_D_COMBINE: toNum(body.PR_QO1_D_COMBINE),
    PR_QO1_E_COMBINE: toNum(body.PR_QO1_E_COMBINE),

    isFormComplete: true,
  };
}

// =============================================================================
// ADMIN — GET /api/children/all  ─  Tous les enfants (admin uniquement)
// =============================================================================
router.get("/all", protect, adminOnly, async (req, res) => {
  try {
    const children = await Child.find().populate("userId", "firstName lastName email").sort("-createdAt");
    res.json(children);
  } catch (err) {
    console.log(err.response?.data);
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// POST /api/children  ─  Créer un enfant (avec photo multer)
// =============================================================================
router.post("/", protect, upload.single("facePhoto"), async (req, res) => {
  try {
    const childFields = parseFormToChild(req.body);
    childFields.userId = req.user._id;

    if (req.file) {
      childFields.facePhotoPath = req.file.path;
      childFields.facePhotoUrl = `/uploads/faces/${req.file.filename}`;
    }

    const child = await Child.create(childFields);

    // Lancer la prédiction en arrière-plan si toutes les données ML sont présentes
    if (child.isFormComplete) {
      triggerPrediction(child._id).catch(err =>
        console.error("Prédiction background échouée:", err.message)
      );
    }

    res.status(201).json(child);
  } catch (err) {
    if (err.code === "LIMIT_FILE_SIZE")
      return res.status(400).json({ message: "Image trop volumineuse (max 5 MB)" });
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// GET /api/children  ─  Lister les enfants du parent connecté
// =============================================================================
router.get("/", protect, async (req, res) => {
  try {
    const children = await Child.find({ userId: req.user._id }).sort("-createdAt");
    console.log(children);
    res.json(children);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// GET /api/children/:id  ─  Récupérer un enfant
// =============================================================================
router.get("/:id", protect, async (req, res) => {
  try {
    const child = await Child.findOne({ _id: req.params.id, userId: req.user._id });
    if (!child) return res.status(404).json({ message: "Enfant non trouvé" });
    res.json(child);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// PUT /api/children/:id  ─  Mettre à jour un enfant (avec photo optionnelle)
// =============================================================================
router.put("/:id", protect, upload.single("facePhoto"), async (req, res) => {
  try {
    const child = await Child.findOne({ _id: req.params.id });
    if (!child) return res.status(404).json({ message: "Enfant non trouvé" });

    const updates = parseFormToChild({
      ...child.toObject(),
      ...req.body
    });
    
    if (req.file) {
      // Supprimer ancienne photo si elle existe
      if (child.facePhotoPath && fs.existsSync(child.facePhotoPath)) {
        fs.unlinkSync(child.facePhotoPath);
      }
      updates.facePhotoPath = req.file.path;
      updates.facePhotoUrl = `/uploads/faces/${req.file.filename}`;
    }

    const updated = await Child.findByIdAndUpdate(req.params.id, updates, { new: true });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// PUT /api/children/:id/photo  ─  Mettre à jour uniquement la photo
// =============================================================================
router.put("/:id/photo", protect, upload.single("facePhoto"), async (req, res) => {
  try {
    const child = await Child.findOne({ _id: req.params.id, userId: req.user._id });
    if (!child) return res.status(404).json({ message: "Enfant non trouvé" });
    if (!req.file) return res.status(400).json({ message: "Aucune photo fournie" });

    if (child.facePhotoPath && fs.existsSync(child.facePhotoPath)) {
      fs.unlinkSync(child.facePhotoPath);
    }

    child.facePhotoPath = req.file.path;
    child.facePhotoUrl = `/uploads/faces/${req.file.filename}`;
    await child.save();

    res.json({ facePhotoUrl: child.facePhotoUrl });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// GET /api/children/:id/predict  ─  Lancer prédiction ML + CNN + RM
// =============================================================================
router.get("/:id/predict", protect, async (req, res) => {
  try {
    const child = await Child.findOne({ _id: req.params.id, userId: req.user._id });
    if (!child) return res.status(404).json({ message: "Enfant non trouvé" });

    const result = await triggerPrediction(child._id);
    res.json(result);
  } catch (err) {
    if (err.code === "ECONNREFUSED")
      return res.status(503).json({ message: "Service IA Python indisponible" });
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// DELETE /api/children/:id
// =============================================================================
router.delete("/:id", protect, async (req, res) => {
  try {
    const child = await Child.findOneAndDelete({ _id: req.params.id });
    if (!child) return res.status(404).json({ message: "Enfant non trouvé" });
    // Supprimer la photo de visage si elle existe
    if (child.facePhotoPath && fs.existsSync(child.facePhotoPath)) {
      fs.unlinkSync(child.facePhotoPath);
    }
    res.json({ message: "Enfant supprimé" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// ── Fonction interne de prédiction ────────────────────────────────
async function triggerPrediction(childId) {
  const child = await Child.findById(childId);
  if (!child) throw new Error("Enfant non trouvé");

  // ── Appel 1 : Prédiction TSA (ML + CNN) ──────────────────────
  const tsaFeatures = [
    child.A1 ?? 0, child.A2 ?? 0, child.A3 ?? 0,
    child.A4 ?? 0, child.A5 ?? 0, child.A6 ?? 0,
    child.A7 ?? 0, child.A8 ?? 0, child.A9 ?? 0, child.A10 ?? 0, new Date().getFullYear() - child.birthDate.getFullYear() ?? 0, child.gender ?? "m",
    child.jaundice ?? 0, child.familyMemWithASD ?? 0,
  ];
  const rmFeatures = [
    child.PR_AGE1, child.PR_Q3D,
    child.PR_QF1A, child.PR_QG1A,
    child.PR_QH1A, child.PR_QH1B,
    child.PR_QI1, child.PR_QJ1,
    child.PR_QK1, child.PR_QQ,
    child.PR_QN1_A, child.PR_QN1_B,
    child.PR_QN1_C, child.PR_QN1_D,
    child.PR_QN1_E, child.PR_QN1_F,
    child.PR_QN1_G, child.PR_QN1_H,
    child.PR_QO1_A_COMBINE,
    child.PR_QO1_B_COMBINE,
    child.PR_QO1_C_COMBINE,
    child.PR_QO1_D_COMBINE,
    child.PR_QO1_E_COMBINE,
  ];
  let result = {};
  try {
    const FormData = require("form-data");
    const fd = new FormData();

    // ✅ IMPORTANT : stringify
    fd.append("features_tsa", JSON.stringify(tsaFeatures));
    fd.append("features_rm", JSON.stringify(rmFeatures));

    // ✅ IMPORTANT : nom EXACT "image"
    fd.append("image", fs.createReadStream(child.facePhotoPath));

    const res = await axios.post(`${PYTHON_API}/predict`, fd, {
      headers: fd.getHeaders(), // 🔥 obligatoire
    });
    result = res.data; // { prob_ml, prob_snn, prob_final, prediction }
  } catch (e) {
    console.warn("Prédiction TSA échouée:", e.message);
  }

  // ── Appel 2 : Prédiction CNN (photo de visage) ────────────────
  // let cnnResult = {};
  // if (child.facePhotoPath && fs.existsSync(child.facePhotoPath)) {
  //   try {
  //     const FormData = require("form-data");
  //     const fd = new FormData();
  //     fd.append("file", fs.createReadStream(child.facePhotoPath));
  //     const cnnRes = await axios.post(`${PYTHON_API}/predict_cnn`, fd, {
  //       headers: fd.getHeaders(),
  //     });
  //     cnnResult = cnnRes.data; // { prob_cnn }
  //   } catch (e) {
  //     console.warn("Prédiction CNN échouée:", e.message);
  //   }
  // }

  // // ── Appel 3 : Prédiction RM (Isolation Forest) ────────────────
  // const rmFeatures = {
  //   PR_AGE1: child.PR_AGE1, PR_Q3D: child.PR_Q3D,
  //   PR_QF1A: child.PR_QF1A, PR_QG1A: child.PR_QG1A,
  //   PR_QH1A: child.PR_QH1A, PR_QH1B: child.PR_QH1B,
  //   PR_QI1: child.PR_QI1, PR_QJ1: child.PR_QJ1,
  //   PR_QK1: child.PR_QK1, PR_QQ: child.PR_QQ,
  //   PR_QN1_A: child.PR_QN1_A, PR_QN1_B: child.PR_QN1_B,
  //   PR_QN1_C: child.PR_QN1_C, PR_QN1_D: child.PR_QN1_D,
  //   PR_QN1_E: child.PR_QN1_E, PR_QN1_F: child.PR_QN1_F,
  //   PR_QN1_G: child.PR_QN1_G, PR_QN1_H: child.PR_QN1_H,
  //   PR_QO1_A_COMBINE: child.PR_QO1_A_COMBINE,
  //   PR_QO1_B_COMBINE: child.PR_QO1_B_COMBINE,
  //   PR_QO1_C_COMBINE: child.PR_QO1_C_COMBINE,
  //   PR_QO1_D_COMBINE: child.PR_QO1_D_COMBINE,
  //   PR_QO1_E_COMBINE: child.PR_QO1_E_COMBINE,
  // };

  // let rmResult = {};
  // try {
  //   const rmRes = await axios.post(`${PYTHON_API}/predict_rm`, rmFeatures);
  //   rmResult = rmRes.data; // { score_anomalie, is_rm, confidence }
  // } catch (e) {
  //   console.warn("Prédiction RM échouée:", e.message);
  // }

  // ── Consolidation : calcul profil final ──────────────────────
  const probTsa = result.prob_tsa ?? null;
  const probCnn = result.prob_cnn ?? null;
  const scoreRm = result.score_anomalie ?? null;
  let PR_QN1_A = 1;

  let prediction = "Normal";
  if (probTsa !== null && probTsa >= 0.5 && (scoreRm === null || scoreRm < 0.5)) {
    prediction = "TSA";
    PR_QN1_A = 2;
  } else if (scoreRm !== null && scoreRm >= 0.5 && (probTsa === null || probTsa < 0.5)) {
    prediction = "RM";
  } else if (probTsa !== null && probTsa >= 0.5 && scoreRm !== null && scoreRm >= 0.5) {
    prediction = "MIXTE";
  }

  const updates = {
    probMl: result.prob_ml ?? null,
    PR_QN1_A: PR_QN1_A,
    probCnn: probCnn,
    probTsa: probTsa,
    scoreAnomalie: scoreRm,
    confidence: result.confidence ?? null,
    prediction: result.prediction,
    lastPredictionAt: new Date(),
  };

  const updated = await Child.findByIdAndUpdate(childId, updates, { new: true });
  return updated;
}

module.exports = router;
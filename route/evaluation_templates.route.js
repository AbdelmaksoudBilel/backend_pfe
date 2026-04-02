// =============================================================================
// routes/evaluation_templates.route.js  —  CRUD Templates d'évaluation
// =============================================================================
// Base URL : /api/evaluation-templates
// Accès : admin uniquement (sauf GET qui est accessible aux deux rôles)
//
// ROUTES :
//   GET    /api/evaluation-templates           → tous les domaines + questions
//   GET    /api/evaluation-templates/:id       → un domaine avec ses questions
//   POST   /api/evaluation-templates           → créer un domaine (admin)
//   PUT    /api/evaluation-templates/:id       → modifier un domaine (admin)
//   DELETE /api/evaluation-templates/:id       → supprimer un domaine (admin)
//   POST   /api/evaluation-templates/:id/questions        → ajouter une question
//   PUT    /api/evaluation-templates/:id/questions/:qid   → modifier une question
//   DELETE /api/evaluation-templates/:id/questions/:qid   → supprimer une question
// =============================================================================

const express  = require("express");
const EvaluationTemplate = require("../models/schema_evaluation_templates");
const { protect, adminOnly } = require("../middleware/auth");

const router = express.Router();

// GET /api/evaluation-templates  →  tous les domaines actifs avec leurs questions
router.get("/", protect, async (req, res) => {
  try {
    const templates = await EvaluationTemplate.find({ isActive: true })
      .sort("domain")
      .select("-createdBy");
    res.json(templates);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /api/evaluation-templates/:id  →  un domaine spécifique
router.get("/:id", protect, async (req, res) => {
  try {
    const tpl = await EvaluationTemplate.findById(req.params.id);
    if (!tpl) return res.status(404).json({ message: "Template introuvable" });
    res.json(tpl);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST /api/evaluation-templates  →  créer un nouveau domaine (admin)
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const { domain, domainFr, description, questions } = req.body;
    if (!domain) return res.status(400).json({ message: "domain requis" });

    const tpl = await EvaluationTemplate.create({
      domain, domainFr, description,
      questions : questions || [],
      createdBy : req.user._id,
    });
    res.status(201).json(tpl);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/evaluation-templates/:id  →  modifier le domaine (nom, description)
router.put("/:id", protect, adminOnly, async (req, res) => {
  try {
    const allowed = ["domain", "domainFr", "description", "isActive"];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const tpl = await EvaluationTemplate.findByIdAndUpdate(
      req.params.id, updates, { new: true, runValidators: true }
    );
    if (!tpl) return res.status(404).json({ message: "Template introuvable" });
    res.json(tpl);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/evaluation-templates/:id  →  supprimer un domaine (admin)
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    const tpl = await EvaluationTemplate.findByIdAndDelete(req.params.id);
    if (!tpl) return res.status(404).json({ message: "Template introuvable" });
    res.json({ message: "Domaine supprimé" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =============================================================================
// GESTION DES QUESTIONS (sous-documents)
// =============================================================================

// POST /api/evaluation-templates/:id/questions  →  ajouter une question
router.post("/:id/questions", protect, adminOnly, async (req, res) => {
  try {
    const { slug, question, order, aiKeywords, formSource, formField, formLogic } = req.body;
    if (!slug || !question)
      return res.status(400).json({ message: "slug et question requis" });

    const tpl = await EvaluationTemplate.findById(req.params.id);
    if (!tpl) return res.status(404).json({ message: "Template introuvable" });

    // Vérifier unicité du slug dans ce template
    if (tpl.questions.some(q => q.slug === slug))
      return res.status(400).json({ message: `Slug "${slug}" déjà utilisé dans ce domaine` });

    tpl.questions.push({ slug, question, order, aiKeywords, formSource, formField, formLogic });
    await tpl.save();
    res.status(201).json(tpl);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PUT /api/evaluation-templates/:id/questions/:qid  →  modifier une question
router.put("/:id/questions/:qid", protect, adminOnly, async (req, res) => {
  try {
    const tpl = await EvaluationTemplate.findById(req.params.id);
    if (!tpl) return res.status(404).json({ message: "Template introuvable" });

    const q = tpl.questions.id(req.params.qid);
    if (!q) return res.status(404).json({ message: "Question introuvable" });

    const allowed = ["question", "order", "isActive", "aiKeywords", "formSource", "formField", "formLogic"];
    allowed.forEach(k => { if (req.body[k] !== undefined) q[k] = req.body[k]; });

    await tpl.save();
    res.json(tpl);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /api/evaluation-templates/:id/questions/:qid  →  supprimer une question
router.delete("/:id/questions/:qid", protect, adminOnly, async (req, res) => {
  try {
    const tpl = await EvaluationTemplate.findById(req.params.id);
    if (!tpl) return res.status(404).json({ message: "Template introuvable" });

    tpl.questions = tpl.questions.filter(q => q._id.toString() !== req.params.qid);
    await tpl.save();
    res.json(tpl);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
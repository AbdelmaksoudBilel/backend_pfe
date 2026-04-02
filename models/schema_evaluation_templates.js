// =============================================================================
// schema_evaluation_templates.js  —  Collection : evaluation_templates
// Domaines d'évaluation + questions (définis par l'admin du centre)
// =============================================================================

const mongoose = require("mongoose");

// Sous-schéma : une question dans un domaine
const QuestionSchema = new mongoose.Schema(
  {
    slug       : { type: String, required: true, trim: true },
    // ex: "taw_01" — identifiant stable pour le mapping formulaire ↔ évaluation

    question   : { type: String, required: true, trim: true },
    // texte en arabe ex: "يستجيب للنداء"

    aiKeywords : { type: [String], default: [] },
    // mots-clés pour pré-remplissage IA depuis profile_detecter

    // Lien avec le formulaire parent (pour pré-remplissage automatique)
    formSource : { type: String, default: null },
    // "qchat" | "rm" | "profile"

    formField  : { type: String, default: null },
    // ex: "A1", "PR_QH1A"

    formLogic  : { type: String, enum: ["direct", "inverse", null], default: null },
    // direct  → valeur formulaire = valeur évaluation
    // inverse → valeur inversée

    order      : { type: Number, default: 0 },
    isActive   : { type: Boolean, default: true },
  },
  { _id: true }
);

const EvaluationTemplateSchema = new mongoose.Schema(
  {
    domain      : { type: String, required: true, trim: true },  // nom arabe
    domainFr    : { type: String, trim: true },                  // nom français
    description : { type: String, trim: true },
    questions   : [QuestionSchema],
    isActive    : { type: Boolean, default: true },
    createdBy   : { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "evaluation_templates" }
);

// 14 domaines possibles :
// اللباس | الأكل | الحركة العامة | الحركة الدقيقة | التلوين
// الجانبية | الصورة الجسمية | هيكلة الفضاء | تنظيم الزمن
// الادراك الحسي | التواصل | المعرفة | السلوك الاجتماعي | النظافة

EvaluationTemplateSchema.index({ domain: 1 });

module.exports = mongoose.model("EvaluationTemplate", EvaluationTemplateSchema);
// =============================================================================
// schema_evaluation_responses.js  —  Collection : evaluation_responses
// Réponse 0/1 pour chaque question dans une session d'évaluation
// =============================================================================

const mongoose = require("mongoose");

const EvaluationResponseSchema = new mongoose.Schema(
  {
    // Liens
    sessionId  : { type: mongoose.Schema.Types.ObjectId, ref: "EvaluationSession", required: true },
    childId    : { type: mongoose.Schema.Types.ObjectId, ref: "Child",             required: true },
    templateId : { type: mongoose.Schema.Types.ObjectId, ref: "EvaluationTemplate" },
    questionId : { type: mongoose.Schema.Types.ObjectId },

    // Identifiant stable de la question (pour l'historique et le mapping)
    slug       : { type: String, required: true },
    // ex: "taw_01", "hga_15", "mrf_08a"

    // Dénormalisation pour lecture rapide
    domain     : { type: String, required: true },  // arabe
    domainFr   : { type: String },                  // français
    question   : { type: String, required: true },  // texte arabe

    // Réponse : 1 = oui (acquis) | 0 = non (non acquis)
    answer     : { type: Number, enum: [0, 1], required: true },

    // Source de la réponse
    source     : {
      type   : String,
      enum   : ["form_parent", "ai_profile", "admin_manual"],
      default: "admin_manual",
    },
    // form_parent  → rempli automatiquement depuis formulaire parent initial
    // ai_profile   → suggéré par l'IA depuis profile_detecter
    // admin_manual → saisi manuellement par admin/éducateur

    aiSuggested : { type: Boolean, default: false },
    // true si la valeur a été proposée par l'IA (admin peut la modifier)

    modified    : { type: Boolean, default: false },
    // true si admin a modifié la suggestion IA

    note        : { type: String, trim: true },
    // commentaire optionnel sur cette question spécifique
  },
  { timestamps: true, collection: "evaluation_responses" }
);

EvaluationResponseSchema.index({ sessionId: 1 });
EvaluationResponseSchema.index({ childId: 1, slug: 1 });
EvaluationResponseSchema.index({ childId: 1, domain: 1 });

module.exports = mongoose.model("EvaluationResponse", EvaluationResponseSchema);
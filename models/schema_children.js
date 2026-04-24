// backend/schemas/schema_children.js
// =============================================================================
// Schéma MongoDB — Collection : children
// Contient TOUTES les features nécessaires aux modèles ML et DL :
//   - Infos de base (nom, prénom, date naissance, genre)
//   - Photo de visage → CNN (MobileNetV2)
//   - Q-Chat-10 (A1–A10, QChatScore) → Modèle ML TSA
//   - Variables comportementales supplémentaires → Modèle ML TSA enrichi
//   - DS Survey RM (PR_*) → Modèle ML RM (Isolation Forest)
//   - Résultats des modèles (prediction, probMl, probCnn, probFusion...)
// =============================================================================

const mongoose = require("mongoose");
const { Schema } = mongoose;

const ChildSchema = new Schema({

  // ── Lien parent ────────────────────────────────────────────────
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },

  // ── Informations de base ───────────────────────────────────────
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  birthDate: { type: Date, required: true },
  gender: { type: String, enum: ["M", "F"], required: true },

  // ── Photo de visage (pour CNN MobileNetV2) ─────────────────────
  // Chemin vers le fichier uploadé via multer (stocké dans /uploads/faces/)
  facePhotoUrl: { type: String, default: null },
  facePhotoPath: { type: String, default: null }, // chemin local serveur

  // ── Q-Chat-10 (Modèle ML TSA) ──────────────────────────────────
  // Réponses binaires : 0 ou 1 (après traitement du score)
  // Questions 1–9 : 1 si réponse C/D/E (index >= 2)
  // Question 10   : 1 si réponse A/B/C (index <= 2)
  A1: { type: Number, enum: [0, 1], default: null },
  A2: { type: Number, enum: [0, 1], default: null },
  A3: { type: Number, enum: [0, 1], default: null },
  A4: { type: Number, enum: [0, 1], default: null },
  A5: { type: Number, enum: [0, 1], default: null },
  A6: { type: Number, enum: [0, 1], default: null },
  A7: { type: Number, enum: [0, 1], default: null },
  A8: { type: Number, enum: [0, 1], default: null },
  A9: { type: Number, enum: [0, 1], default: null },
  A10: { type: Number, enum: [0, 1], default: null },

  // Score total Q-Chat-10 (0–10). Score >= 3 → traits autistiques potentiels
  QChatScore: { type: Number, min: 0, max: 10, default: null },

  // Réponses brutes (index 0–4) conservées pour affichage dans l'interface
  A1_raw: { type: Number, min: 0, max: 4, default: null },
  A2_raw: { type: Number, min: 0, max: 4, default: null },
  A3_raw: { type: Number, min: 0, max: 4, default: null },
  A4_raw: { type: Number, min: 0, max: 4, default: null },
  A5_raw: { type: Number, min: 0, max: 4, default: null },
  A6_raw: { type: Number, min: 0, max: 4, default: null },
  A7_raw: { type: Number, min: 0, max: 4, default: null },
  A8_raw: { type: Number, min: 0, max: 4, default: null },
  A9_raw: { type: Number, min: 0, max: 4, default: null },
  A10_raw: { type: Number, min: 0, max: 4, default: null },

  // ── Variables comportementales supplémentaires (ML TSA enrichi) ─
  // Issues du dataset ASD children traits (AQ-10 + variables cliniques)
  jaundice: { type: Number, enum: [0, 1], default: null }, // ictère néonatal
  familyMemWithASD: { type: Number, enum: [0, 1], default: null }, // membre famille TSA
  // 0 = parent, 1 = self, 2 = relative, 3 = health care professional, 4 = others
  whoCompletedTest: { type: Number, min: 0, max: 4, default: null },
  // Échelle de réactivité sociale (SRS) — score numérique
  socialResponsivenessScale: { type: Number, default: null },
  // Troubles associés détectés par le parent
  speechDelayDisorder: { type: Number, enum: [0, 1], default: null },
  learningDisorder: { type: Number, enum: [0, 1], default: null },
  geneticDisorders: { type: Number, enum: [0, 1], default: null },
  depression: { type: Number, enum: [0, 1], default: null },
  globalDevelopmentalDelay: { type: Number, enum: [0, 1], default: null },
  socialBehaviouralIssues: { type: Number, enum: [0, 1], default: null },
  anxietyDisorder: { type: Number, enum: [0, 1], default: null },
  // Childhood Autism Rating Scale (CARS) — score 15–60
  childhoodAutismRatingScale: { type: Number, default: null },

  // ── DS Survey RM — Variables Isolation Forest ──────────────────
  // Source : Gouvernement Ontario — Developmental Services Survey
  // Âge (catégorie)
  // 1=<25 ans, 2=25-34, 3=35-44, 4=45-54, 5=55-64, 6=>65
  PR_AGE1: { type: Number, min: 1, max: 6, default: null },
  // Sexe : 1=Homme, 2=Femme
  PR_Q3D: { type: Number, min: 1, max: 2, default: null },
  // Communication — Expression : 1=Langage parlé, 2=Autres modes, 3=Jamais/rarement
  PR_QF1A: { type: Number, min: 1, max: 3, default: null },
  // Communication — Compréhension : 1=Langage parlé, 2=Autres modes, 3=Jamais/rarement
  PR_QG1A: { type: Number, min: 1, max: 3, default: null },
  // Aides à la mobilité : 1=Jamais…5=Systématiquement
  PR_QH1A: { type: Number, min: 1, max: 5, default: null },
  // Fauteuil roulant : 1=Oui, 2=Non
  PR_QH1B: { type: Number, min: 1, max: 2, default: null },
  // Prothèses auditives : 1=Jamais…5=Systématiquement
  PR_QI1: { type: Number, min: 1, max: 5, default: null },
  // Aides visuelles : 1=Jamais…5=Systématiquement
  PR_QJ1: { type: Number, min: 1, max: 5, default: null },
  // Aide repas : 1=Jamais…5=Systématiquement
  PR_QK1: { type: Number, min: 1, max: 5, default: null },
  // Niveau de soutien global : 1=Non-quotidien…4=Soutien important
  PR_QQ: { type: Number, min: 1, max: 4, default: null },
  // Troubles de santé (0=Non, 1=Oui non diagnostiqué, 2=Oui diagnostiqué)
  PR_QN1_A: { type: Number, min: 1, max: 3, default: null }, // TSA / TED
  PR_QN1_B: { type: Number, min: 1, max: 3, default: null }, // Autre trouble rare
  PR_QN1_C: { type: Number, min: 1, max: 3, default: null }, // Asthme/respiratoire
  PR_QN1_D: { type: Number, min: 1, max: 3, default: null }, // Trouble santé mentale
  PR_QN1_E: { type: Number, min: 1, max: 3, default: null }, // Démence/Alzheimer
  PR_QN1_F: { type: Number, min: 1, max: 3, default: null }, // Diabète
  PR_QN1_G: { type: Number, min: 1, max: 3, default: null }, // Épilepsie
  PR_QN1_H: { type: Number, min: 1, max: 3, default: null }, // Lésion cérébrale
  // Traits comportementaux (1=Oui malgré soutien, 2=Non grâce au soutien, 3=Non)
  PR_QO1_A_COMBINE: { type: Number, min: 1, max: 3, default: null }, // Agression physique
  PR_QO1_B_COMBINE: { type: Number, min: 1, max: 3, default: null }, // Destruction de biens
  PR_QO1_C_COMBINE: { type: Number, min: 1, max: 3, default: null }, // Auto-mutilation
  PR_QO1_D_COMBINE: { type: Number, min: 1, max: 3, default: null }, // Comportement sexuel
  PR_QO1_E_COMBINE: { type: Number, min: 1, max: 3, default: null }, // Vagabondage/fugue

  // ── Résultats des modèles ML / DL ─────────────────────────────
  // Résultat final : "TSA" | "RM" | "MIXTE" | "Normal" | null
  prediction: { type: String, enum: ["TSA", "RM", "MIXTE", "Normal", null], default: null },
  // Probabilité XGBoost (0–1)
  probMl: { type: Number, min: 0, max: 1, default: null },
  // Probabilité MobileNetV2 CNN (0–1)
  probCnn: { type: Number, min: 0, max: 1, default: null },
  // Probabilité Late Fusion (0–1) — combinaison logit pondérée
  probTsa: { type: Number, min: 0, max: 1, default: null },
  // Score anomalie Isolation Forest (RM) — normalisé 0–1
  scoreAnomalie: { type: Number, min: 0, max: 1, default: null },
  // Score de confiance global (0–1)
  confidence: { type: Number, min: 0, max: 1, default: null },
  // Profils détectés (comorbidités, niveaux, etc.)
  profileDetected: [{ type: String }],

  // ── Métadonnées ─────────────────────────────────────────────────
  // Indique si le formulaire complet (Q-Chat + DS Survey) a été rempli
  isFormComplete: { type: Boolean, default: false },
  // Date du dernier appel API de prédiction
  lastPredictionAt: { type: Date, default: null },

}, { timestamps: true });

// ── Index ──────────────────────────────────────────────────────────
ChildSchema.index({ userId: 1 });
ChildSchema.index({ prediction: 1 });
ChildSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("Child", ChildSchema);
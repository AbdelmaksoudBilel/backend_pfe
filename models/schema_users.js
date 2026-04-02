// =============================================================================
// schemas/schema_users.js  —  Collection : users
// =============================================================================

const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

const UserSchema = new mongoose.Schema(
  {
    firstName  : { type: String, required: true, trim: true },
    lastName   : { type: String, required: true, trim: true },
    email      : { type: String, required: true, unique: true, lowercase: true, trim: true },
    password   : { type: String, required: true, minlength: 8 },
    phone      : { type: String, trim: true },
    avatar     : { type: String },
    language   : { type: String, default: "fr", enum: ["fr","ar","en"] },
    role       : { type: String, enum: ["parent","admin"], default: "parent" },

    // ── Auth flow ──────────────────────────────────────────────
    isEmailVerified   : { type: Boolean, default: false },
    isApproved        : { type: Boolean, default: false },
    isFirstLogin      : { type: Boolean, default: true },  // ← redirige vers /setup-child
    verificationToken : { type: String, select: false },

    // ── Réinitialisation mot de passe ──────────────────────────
    passwordResetToken  : { type: String,  select: false },
    passwordResetExpires: { type: Date,    select: false },

    lastLogin : { type: Date },
  },
  { timestamps: true, collection: "users" }
);

// Hash mot de passe avant save (Mongoose 8 : pas de next() avec async)
UserSchema.pre("save", async function () {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 10);
});

// Comparer mot de passe
UserSchema.methods.matchPassword = async function (entered) {
  return bcrypt.compare(entered, this.password);
};

UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ role: 1, isApproved: 1 });

module.exports = mongoose.model("User", UserSchema);